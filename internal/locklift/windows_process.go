package locklift

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/sys/windows"
)

func IsElevated() bool {
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY, &token); err != nil {
		return false
	}
	defer token.Close()

	return token.IsElevated()
}

func OpenInExplorer(path string) error {
	cleaned, err := filepath.Abs(strings.TrimSpace(path))
	if err != nil {
		return err
	}
	info, err := os.Stat(cleaned)
	if err != nil {
		return err
	}

	if info.IsDir() {
		return exec.Command("explorer.exe", cleaned).Start()
	}

	return exec.Command("explorer.exe", "/select,", cleaned).Start()
}

func RelaunchElevated() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}

	workingDir := filepath.Dir(executable)
	args := buildPowerShellArgumentArray(os.Args[1:])
	command := fmt.Sprintf(
		"Start-Process -Verb RunAs -FilePath %s -WorkingDirectory %s%s",
		quotePowerShell(executable),
		quotePowerShell(workingDir),
		args,
	)

	return exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-Command",
		command,
	).Start()
}

func killProcessTree(pid int) error {
	command := exec.Command("taskkill.exe", "/PID", strconv.Itoa(pid), "/T", "/F")
	output, err := command.CombinedOutput()
	if err == nil {
		return nil
	}

	message := strings.TrimSpace(string(output))
	if message == "" {
		return err
	}

	return fmt.Errorf("%w: %s", err, message)
}

func explainKillError(err error) string {
	if err == nil {
		return ""
	}

	message := err.Error()
	lower := strings.ToLower(message)

	switch {
	case strings.Contains(lower, "access is denied"), strings.Contains(message, "拒绝访问"):
		return "结束失败：权限不足，请尝试以管理员身份重启"
	case strings.Contains(lower, "not found"), strings.Contains(message, "没有运行的任务"), strings.Contains(message, "找不到进程"):
		return "该进程已经退出，无需再次释放"
	default:
		return "结束失败：" + strings.TrimSpace(message)
	}
}

func getProcessImagePath(pid uint32) string {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(handle)

	buffer := make([]uint16, 32768)
	size := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(handle, 0, &buffer[0], &size); err != nil {
		return ""
	}

	return windows.UTF16ToString(buffer[:size])
}

func quotePowerShell(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func buildPowerShellArgumentArray(args []string) string {
	if len(args) == 0 {
		return ""
	}

	escaped := make([]string, 0, len(args))
	for _, item := range args {
		escaped = append(escaped, quotePowerShell(item))
	}

	return " -ArgumentList @(" + strings.Join(escaped, ", ") + ")"
}

func isPermissionError(err error) bool {
	return errors.Is(err, windows.ERROR_ACCESS_DENIED)
}
