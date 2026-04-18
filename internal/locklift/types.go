package locklift

type LockingProcess struct {
	PID         int    `json:"pid"`
	Name        string `json:"name"`
	AppType     string `json:"appType"`
	ExePath     string `json:"exePath"`
	CanKill     bool   `json:"canKill"`
	BlockReason string `json:"blockReason"`
}

type InspectSummary struct {
	Total         int `json:"total"`
	KillableCount int `json:"killableCount"`
	BlockedCount  int `json:"blockedCount"`
}

type InspectResult struct {
	Path               string           `json:"path"`
	TargetKind         string           `json:"targetKind"`
	Exists             bool             `json:"exists"`
	IsFile             bool             `json:"isFile"`
	IsElevated         bool             `json:"isElevated"`
	HasLocks           bool             `json:"hasLocks"`
	NeedsElevationHint bool             `json:"needsElevationHint"`
	ScannedFileCount   int              `json:"scannedFileCount"`
	Truncated          bool             `json:"truncated"`
	Processes          []LockingProcess `json:"processes"`
	Summary            InspectSummary   `json:"summary"`
	Message            string           `json:"message"`
	Warning            string           `json:"warning,omitempty"`
	Error              string           `json:"error,omitempty"`
}

type ReleaseAttempt struct {
	PID     int    `json:"pid"`
	Name    string `json:"name"`
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type ReleaseResult struct {
	Path          string           `json:"path"`
	RequestedPIDs []int            `json:"requestedPids"`
	ReleasedCount int              `json:"releasedCount"`
	FailedCount   int              `json:"failedCount"`
	Attempts      []ReleaseAttempt `json:"attempts"`
	Inspect       InspectResult    `json:"inspect"`
	Message       string           `json:"message"`
	Error         string           `json:"error,omitempty"`
}
