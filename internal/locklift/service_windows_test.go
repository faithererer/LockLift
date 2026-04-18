//go:build windows

package locklift

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestInspectFileRejectsInvalidPath(t *testing.T) {
	service := newService("LockLiftTest", t.TempDir())

	result := service.InspectFile(`\\server\share\demo.txt`)
	if result.Error == "" {
		t.Fatalf("expected error for network path")
	}

	result = service.InspectFile(t.TempDir())
	if result.Error != "" {
		t.Fatalf("expected directory inspection to be supported, got %s", result.Error)
	}
	if result.TargetKind != "directory" {
		t.Fatalf("expected directory target kind, got %s", result.TargetKind)
	}
}

func TestInspectFileMarksCurrentProcessAsProtected(t *testing.T) {
	service := newService("LockLiftTest", t.TempDir())
	filePath := filepath.Join(t.TempDir(), "self-lock.txt")
	if err := os.WriteFile(filePath, []byte("lock"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	handle := openExclusiveFile(t, filePath)
	defer windows.CloseHandle(handle)

	result := service.InspectFile(filePath)
	if !result.HasLocks {
		t.Fatalf("expected current process to be reported as locking the file")
	}

	found := false
	for _, process := range result.Processes {
		if process.PID == os.Getpid() {
			found = true
			if process.CanKill {
				t.Fatalf("expected current process to be protected")
			}
			if process.BlockReason == "" {
				t.Fatalf("expected block reason for protected process")
			}
		}
	}

	if !found {
		t.Fatalf("expected current process pid %d in locking list", os.Getpid())
	}
}

func TestReleaseLocksKillsLockerProcess(t *testing.T) {
	service := newService("LockLiftTest", t.TempDir())
	filePath := filepath.Join(t.TempDir(), "locked.txt")
	if err := os.WriteFile(filePath, []byte("lock me"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	cmd, ready := startLockerHelper(t, filePath)
	defer func() {
		_ = exec.Command("taskkill.exe", "/PID", intToString(cmd.Process.Pid), "/T", "/F").Run()
	}()

	select {
	case <-ready:
	case <-time.After(10 * time.Second):
		t.Fatalf("helper process did not signal readiness")
	}

	inspect := waitForInspectWithLocks(t, service, filePath, 10*time.Second)
	if !inspect.HasLocks {
		t.Fatalf("expected file to be locked by helper process")
	}

	found := false
	for _, process := range inspect.Processes {
		if process.PID == cmd.Process.Pid {
			found = true
			if !process.CanKill {
				t.Fatalf("expected helper process to be killable")
			}
		}
	}
	if !found {
		t.Fatalf("expected helper pid %d in locking list", cmd.Process.Pid)
	}

	release := service.ReleaseLocks(filePath, []int{cmd.Process.Pid})
	if release.ReleasedCount != 1 {
		t.Fatalf("expected one process released, got %d", release.ReleasedCount)
	}
	if release.FailedCount != 0 {
		t.Fatalf("expected no release failures, got %d", release.FailedCount)
	}

	waitDone := make(chan error, 1)
	go func() {
		waitDone <- cmd.Wait()
	}()

	select {
	case <-waitDone:
	case <-time.After(10 * time.Second):
		t.Fatalf("helper process did not exit after release")
	}

	if release.Inspect.HasLocks {
		t.Fatalf("expected file to be unlocked after release")
	}
}

func TestInspectDirectoryIncludesLockedChildFile(t *testing.T) {
	service := newService("LockLiftTest", t.TempDir())
	root := t.TempDir()
	filePath := filepath.Join(root, "nested", "locked.txt")
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filePath, []byte("lock me"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	cmd, ready := startLockerHelper(t, filePath)
	defer func() {
		_ = exec.Command("taskkill.exe", "/PID", intToString(cmd.Process.Pid), "/T", "/F").Run()
	}()

	select {
	case <-ready:
	case <-time.After(10 * time.Second):
		t.Fatalf("helper process did not signal readiness")
	}

	result := waitForInspectWithLocks(t, service, root, 10*time.Second)
	if result.TargetKind != "directory" {
		t.Fatalf("expected directory target kind, got %s", result.TargetKind)
	}
	if result.ScannedFileCount == 0 {
		t.Fatalf("expected directory scan to include child files")
	}
	if !result.HasLocks {
		t.Fatalf("expected directory scan to surface locked child file")
	}
}

func startLockerHelper(t *testing.T, filePath string) (*exec.Cmd, chan struct{}) {
	t.Helper()

	lockScript := strings.Join([]string{
		"$ErrorActionPreference = 'Stop'",
		"$target = " + quotePowerShellLiteral(filePath),
		"$stream = [System.IO.File]::Open($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)",
		"[Console]::Out.WriteLine('ready')",
		"Start-Sleep -Seconds 3600",
	}, "; ")

	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-Command",
		lockScript,
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		t.Fatalf("start helper: %v", err)
	}

	ready := make(chan struct{})
	go func() {
		reader := bufio.NewReader(stdout)
		line, _ := reader.ReadString('\n')
		if strings.TrimSpace(line) == "ready" {
			close(ready)
		}
	}()

	return cmd, ready
}

func openExclusiveFile(t *testing.T, filePath string) windows.Handle {
	t.Helper()

	pointer, err := windows.UTF16PtrFromString(filePath)
	if err != nil {
		t.Fatalf("utf16 path: %v", err)
	}

	handle, err := windows.CreateFile(
		pointer,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		t.Fatalf("create file lock: %v", err)
	}

	return handle
}

func intToString(value int) string {
	return strconv.Itoa(value)
}

func waitForInspectWithLocks(t *testing.T, service *Service, path string, timeout time.Duration) InspectResult {
	t.Helper()

	deadline := time.Now().Add(timeout)
	var last InspectResult

	for {
		last = service.InspectFile(path)
		if last.HasLocks || last.Error != "" || time.Now().After(deadline) {
			return last
		}

		time.Sleep(250 * time.Millisecond)
	}
}

func quotePowerShellLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
