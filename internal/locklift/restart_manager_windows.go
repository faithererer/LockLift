package locklift

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	cchRmSessionKey = 32
	cchRmMaxAppName = 255
	cchRmMaxSvcName = 63

	rmAppTypeUnknown     = 0
	rmAppTypeMainWindow  = 1
	rmAppTypeOtherWindow = 2
	rmAppTypeService     = 3
	rmAppTypeExplorer    = 4
	rmAppTypeConsole     = 5
	rmAppTypeCritical    = 1000

	restartManagerScanAttempts = 4
	restartManagerRetryDelay   = 120 * time.Millisecond
)

var (
	modRstrtmgr             = windows.NewLazySystemDLL("rstrtmgr.dll")
	procRmStartSession      = modRstrtmgr.NewProc("RmStartSession")
	procRmRegisterResources = modRstrtmgr.NewProc("RmRegisterResources")
	procRmGetList           = modRstrtmgr.NewProc("RmGetList")
	procRmEndSession        = modRstrtmgr.NewProc("RmEndSession")
)

type rmUniqueProcess struct {
	ProcessID        uint32
	ProcessStartTime windows.Filetime
}

type rmProcessInfo struct {
	Process          rmUniqueProcess
	AppName          [cchRmMaxAppName + 1]uint16
	ServiceShortName [cchRmMaxSvcName + 1]uint16
	ApplicationType  uint32
	AppStatus        uint32
	TSSessionID      uint32
	Restartable      int32
}

func findLockingProcessesForPaths(paths []string) ([]LockingProcess, error) {
	normalized := normalizeRestartManagerPaths(paths)
	if len(normalized) == 0 {
		return nil, nil
	}

	var last []LockingProcess
	for attempt := 0; attempt < restartManagerScanAttempts; attempt++ {
		processes, err := findLockingProcessesOnce(normalized)
		if err != nil {
			return nil, err
		}
		if len(processes) > 0 {
			return processes, nil
		}

		last = processes
		if attempt < restartManagerScanAttempts-1 {
			time.Sleep(restartManagerRetryDelay)
		}
	}

	return last, nil
}

func findLockingProcessesOnce(paths []string) ([]LockingProcess, error) {
	sessionHandle, err := rmStartSession()
	if err != nil {
		return nil, err
	}
	defer rmEndSession(sessionHandle)

	if err := rmRegisterFiles(sessionHandle, paths); err != nil {
		return nil, err
	}

	processes, err := rmGetProcessList(sessionHandle)
	if err != nil {
		return nil, err
	}

	unique := make(map[int]LockingProcess, len(processes))
	for _, item := range processes {
		pid := int(item.Process.ProcessID)
		exePath := getProcessImagePath(item.Process.ProcessID)
		name := strings.TrimSpace(windows.UTF16ToString(item.AppName[:]))
		if name == "" {
			if exePath != "" {
				name = filepath.Base(exePath)
			} else {
				name = strings.TrimSpace(windows.UTF16ToString(item.ServiceShortName[:]))
			}
		}
		if name == "" {
			name = "未知进程"
		}

		unique[pid] = LockingProcess{
			PID:     pid,
			Name:    name,
			AppType: mapApplicationType(item.ApplicationType),
			ExePath: exePath,
			CanKill: true,
		}
	}

	result := make([]LockingProcess, 0, len(unique))
	for _, item := range unique {
		result = append(result, item)
	}

	sort.Slice(result, func(i, j int) bool {
		left := strings.ToLower(result[i].Name)
		right := strings.ToLower(result[j].Name)
		if left == right {
			return result[i].PID < result[j].PID
		}
		return left < right
	})

	return result, nil
}

func normalizeRestartManagerPaths(paths []string) []string {
	seen := make(map[string]struct{}, len(paths))
	result := make([]string, 0, len(paths))

	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}

		absolute, err := filepath.Abs(trimmed)
		if err == nil {
			trimmed = absolute
		}

		cleaned := filepath.Clean(trimmed)
		key := strings.ToLower(cleaned)
		if _, ok := seen[key]; ok {
			continue
		}

		seen[key] = struct{}{}
		result = append(result, cleaned)
	}

	return result
}

func rmStartSession() (uint32, error) {
	var sessionHandle uint32
	sessionKey := make([]uint16, cchRmSessionKey+1)

	code, _, _ := procRmStartSession.Call(
		uintptr(unsafe.Pointer(&sessionHandle)),
		0,
		uintptr(unsafe.Pointer(&sessionKey[0])),
	)
	if code != 0 {
		return 0, fmt.Errorf("启动 Restart Manager 会话失败: %w", syscall.Errno(code))
	}

	return sessionHandle, nil
}

func rmRegisterFiles(sessionHandle uint32, paths []string) error {
	files := make([]*uint16, 0, len(paths))
	for _, path := range paths {
		filePath, err := windows.UTF16PtrFromString(path)
		if err != nil {
			return err
		}
		files = append(files, filePath)
	}

	code, _, _ := procRmRegisterResources.Call(
		uintptr(sessionHandle),
		uintptr(len(files)),
		uintptr(unsafe.Pointer(&files[0])),
		0,
		0,
		0,
		0,
	)
	if code != 0 {
		return fmt.Errorf("注册文件资源失败: %w", syscall.Errno(code))
	}

	return nil
}

func rmGetProcessList(sessionHandle uint32) ([]rmProcessInfo, error) {
	var needed uint32
	var count uint32
	var rebootReasons uint32

	code, _, _ := procRmGetList.Call(
		uintptr(sessionHandle),
		uintptr(unsafe.Pointer(&needed)),
		uintptr(unsafe.Pointer(&count)),
		0,
		uintptr(unsafe.Pointer(&rebootReasons)),
	)
	if code == 0 && needed == 0 {
		return nil, nil
	}
	if code != uintptr(windows.ERROR_MORE_DATA) && code != 0 {
		return nil, fmt.Errorf("读取占用进程列表失败: %w", syscall.Errno(code))
	}

	if needed == 0 {
		return nil, nil
	}

	items := make([]rmProcessInfo, needed)
	count = needed
	code, _, _ = procRmGetList.Call(
		uintptr(sessionHandle),
		uintptr(unsafe.Pointer(&needed)),
		uintptr(unsafe.Pointer(&count)),
		uintptr(unsafe.Pointer(&items[0])),
		uintptr(unsafe.Pointer(&rebootReasons)),
	)
	if code != 0 {
		return nil, fmt.Errorf("获取占用进程详情失败: %w", syscall.Errno(code))
	}

	return items[:count], nil
}

func rmEndSession(sessionHandle uint32) {
	procRmEndSession.Call(uintptr(sessionHandle))
}

func mapApplicationType(appType uint32) string {
	switch appType {
	case rmAppTypeMainWindow:
		return "桌面应用"
	case rmAppTypeOtherWindow:
		return "后台窗口"
	case rmAppTypeService:
		return "服务"
	case rmAppTypeExplorer:
		return "资源管理器"
	case rmAppTypeConsole:
		return "控制台"
	case rmAppTypeCritical:
		return "系统关键进程"
	default:
		return "未知"
	}
}
