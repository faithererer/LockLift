package locklift

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const maxFolderScanFiles = 2048

var errStopWalk = errors.New("stop-walk")

type Service struct {
	state          *stateStore
	selfPID        int
	protectedNames map[string]string
}

func NewService(appName string) *Service {
	return newService(appName, "")
}

func newService(appName string, baseDir string) *Service {
	return &Service{
		state:   newStateStore(appName, baseDir),
		selfPID: os.Getpid(),
		protectedNames: map[string]string{
			"system":          "系统关键进程不能释放",
			"registry":        "系统关键进程不能释放",
			"smss.exe":        "系统关键进程不能释放",
			"csrss.exe":       "系统关键进程不能释放",
			"wininit.exe":     "系统关键进程不能释放",
			"services.exe":    "系统关键进程不能释放",
			"lsass.exe":       "系统关键进程不能释放",
			"winlogon.exe":    "系统关键进程不能释放",
			"fontdrvhost.exe": "系统关键进程不能释放",
		},
	}
}

func (s *Service) InspectFile(path string) InspectResult {
	result := InspectResult{
		Path:       strings.TrimSpace(path),
		IsElevated: IsElevated(),
		Processes:  []LockingProcess{},
	}

	target, err := validateLocalPath(path)
	if err != nil {
		result.Message = err.Error()
		result.Error = err.Error()
		return result
	}

	result.Path = target.Path
	result.TargetKind = target.Kind
	result.Exists = true
	result.IsFile = target.Kind == "file"
	result.ScannedFileCount = len(target.ScanFiles)
	result.Truncated = target.Truncated
	result.Warning = target.Warning

	processes, err := findLockingProcessesForPaths(target.ScanFiles)
	if err != nil {
		result.Message = "扫描文件占用失败"
		result.Error = err.Error()
		return result
	}

	for index := range processes {
		processes[index] = s.applyProtection(processes[index])
	}

	sort.Slice(processes, func(i, j int) bool {
		if processes[i].CanKill != processes[j].CanKill {
			return processes[i].CanKill
		}
		left := strings.ToLower(processes[i].Name)
		right := strings.ToLower(processes[j].Name)
		if left == right {
			return processes[i].PID < processes[j].PID
		}
		return left < right
	})

	result.Processes = processes
	result.Summary = summarize(processes)
	result.HasLocks = len(processes) > 0
	result.NeedsElevationHint = !result.IsElevated && result.Summary.KillableCount > 0

	if len(processes) == 0 {
		if target.Kind == "directory" {
			result.Message = "当前目录中没有发现占用进程"
		} else {
			result.Message = "当前没有发现占用进程"
		}
	} else {
		if target.Kind == "directory" {
			result.Message = fmt.Sprintf("目录扫描完成：共发现 %d 个占用进程，可释放 %d 个", result.Summary.Total, result.Summary.KillableCount)
		} else {
			result.Message = fmt.Sprintf("共发现 %d 个占用进程，可释放 %d 个", result.Summary.Total, result.Summary.KillableCount)
		}
	}

	_ = s.state.addRecentFile(target.Path)
	return result
}

func (s *Service) ReleaseLocks(path string, pids []int) ReleaseResult {
	result := ReleaseResult{
		Path:          strings.TrimSpace(path),
		RequestedPIDs: dedupePIDs(pids),
		Attempts:      []ReleaseAttempt{},
	}

	if len(result.RequestedPIDs) == 0 {
		result.Message = "请先选择要释放的进程"
		result.Error = result.Message
		result.Inspect = s.InspectFile(path)
		return result
	}

	inspect := s.InspectFile(path)
	if inspect.Error != "" {
		result.Message = inspect.Message
		result.Error = inspect.Error
		result.Inspect = inspect
		return result
	}

	processIndex := make(map[int]LockingProcess, len(inspect.Processes))
	for _, item := range inspect.Processes {
		processIndex[item.PID] = item
	}

	for _, pid := range result.RequestedPIDs {
		attempt := ReleaseAttempt{PID: pid}
		process, ok := processIndex[pid]
		if !ok {
			process = s.applyProtection(describeProcess(pid))
		}
		attempt.Name = process.Name

		switch {
		case !process.CanKill:
			attempt.Message = process.BlockReason
			result.FailedCount++
		default:
			err := killProcessTree(pid)
			if err != nil {
				attempt.Message = explainKillError(err)
				result.FailedCount++
			} else {
				attempt.Success = true
				attempt.Message = "已结束该占用进程"
				result.ReleasedCount++
			}
		}

		result.Attempts = append(result.Attempts, attempt)
	}

	result.Inspect = s.InspectFile(path)
	if result.ReleasedCount == 0 && result.FailedCount > 0 {
		result.Message = fmt.Sprintf("释放未完成：%d 个失败", result.FailedCount)
		return result
	}
	if result.FailedCount == 0 {
		result.Message = fmt.Sprintf("已成功释放 %d 个进程", result.ReleasedCount)
		return result
	}

	result.Message = fmt.Sprintf("已释放 %d 个进程，%d 个失败", result.ReleasedCount, result.FailedCount)
	return result
}

func (s *Service) GetRecentFiles() []string {
	return s.state.getRecentFiles()
}

func (s *Service) ClearRecentFiles() error {
	return s.state.clear()
}

func (s *Service) applyProtection(process LockingProcess) LockingProcess {
	nameKey := strings.ToLower(strings.TrimSpace(process.Name))

	switch {
	case process.PID == s.selfPID:
		process.CanKill = false
		process.BlockReason = "当前应用自身不能被释放"
	case process.PID <= 4:
		process.CanKill = false
		process.BlockReason = "系统关键进程不能释放"
	case s.protectedNames[nameKey] != "":
		process.CanKill = false
		process.BlockReason = s.protectedNames[nameKey]
	}

	return process
}

type inspectedTarget struct {
	Path      string
	Kind      string
	ScanFiles []string
	Truncated bool
	Warning   string
}

func validateLocalPath(path string) (inspectedTarget, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return inspectedTarget{}, fmt.Errorf("请输入文件或文件夹路径")
	}

	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return inspectedTarget{}, fmt.Errorf("路径无效，请重新输入")
	}

	cleaned := filepath.Clean(absolute)
	if strings.HasPrefix(cleaned, `\\`) {
		return inspectedTarget{}, fmt.Errorf("暂不支持网络共享路径，请选择本地文件或文件夹")
	}

	info, err := os.Stat(cleaned)
	if err != nil {
		if os.IsNotExist(err) {
			return inspectedTarget{}, fmt.Errorf("路径不存在，请重新选择")
		}
		if isPermissionError(err) {
			return inspectedTarget{}, fmt.Errorf("没有权限访问该路径，请尝试以管理员身份重启")
		}
		return inspectedTarget{}, fmt.Errorf("无法访问该路径，请确认路径是否正确")
	}

	if info.IsDir() {
		files, truncated, err := collectDirectoryFiles(cleaned, maxFolderScanFiles)
		if err != nil {
			return inspectedTarget{}, fmt.Errorf("扫描目录内容失败，请确认目录可访问")
		}
		warning := ""
		if truncated {
			warning = fmt.Sprintf("目录文件较多，当前仅扫描前 %d 个文件", maxFolderScanFiles)
		}
		return inspectedTarget{
			Path:      cleaned,
			Kind:      "directory",
			ScanFiles: files,
			Truncated: truncated,
			Warning:   warning,
		}, nil
	}

	return inspectedTarget{
		Path:      cleaned,
		Kind:      "file",
		ScanFiles: []string{cleaned},
	}, nil
}

func summarize(processes []LockingProcess) InspectSummary {
	summary := InspectSummary{Total: len(processes)}
	for _, item := range processes {
		if item.CanKill {
			summary.KillableCount++
		} else {
			summary.BlockedCount++
		}
	}
	return summary
}

func dedupePIDs(pids []int) []int {
	seen := make(map[int]struct{}, len(pids))
	result := make([]int, 0, len(pids))
	for _, pid := range pids {
		if pid <= 0 {
			continue
		}
		if _, ok := seen[pid]; ok {
			continue
		}
		seen[pid] = struct{}{}
		result = append(result, pid)
	}
	return result
}

func describeProcess(pid int) LockingProcess {
	exePath := getProcessImagePath(uint32(pid))
	name := ""
	if exePath != "" {
		name = filepath.Base(exePath)
	}
	if name == "" {
		name = fmt.Sprintf("PID %d", pid)
	}

	return LockingProcess{
		PID:     pid,
		Name:    name,
		AppType: "未知",
		ExePath: exePath,
		CanKill: true,
	}
}

func collectDirectoryFiles(root string, limit int) ([]string, bool, error) {
	files := make([]string, 0, min(limit, 128))
	truncated := false

	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}

		files = append(files, path)
		if len(files) >= limit {
			truncated = true
			return errStopWalk
		}
		return nil
	})
	if err != nil && !errors.Is(err, errStopWalk) {
		return nil, false, err
	}

	return files, truncated, nil
}
