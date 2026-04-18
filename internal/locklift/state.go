package locklift

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const maxRecentFiles = 8

type persistedState struct {
	RecentFiles []string `json:"recentFiles"`
}

type stateStore struct {
	mu   sync.Mutex
	path string
}

func newStateStore(appName string, baseDir string) *stateStore {
	root := baseDir
	if root == "" {
		if configDir, err := os.UserConfigDir(); err == nil {
			root = filepath.Join(configDir, appName)
		} else {
			root = filepath.Join(os.TempDir(), appName)
		}
	}

	return &stateStore{
		path: filepath.Join(root, "state.json"),
	}
}

func (s *stateStore) getRecentFiles() []string {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.load()
	if err != nil {
		return nil
	}

	filtered := make([]string, 0, len(state.RecentFiles))
	for _, item := range state.RecentFiles {
		if item == "" {
			continue
		}
		info, err := os.Stat(item)
		if err != nil {
			continue
		}
		if !info.Mode().IsRegular() && !info.IsDir() {
			continue
		}
		filtered = append(filtered, item)
	}

	if len(filtered) != len(state.RecentFiles) {
		state.RecentFiles = filtered
		_ = s.save(state)
	}

	return filtered
}

func (s *stateStore) clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.save(persistedState{RecentFiles: []string{}})
}

func (s *stateStore) addRecentFile(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.load()
	if err != nil {
		return err
	}

	next := []string{path}
	for _, item := range state.RecentFiles {
		if item == "" || item == path {
			continue
		}
		next = append(next, item)
		if len(next) >= maxRecentFiles {
			break
		}
	}

	state.RecentFiles = next
	return s.save(state)
}

func (s *stateStore) load() (persistedState, error) {
	var state persistedState

	content, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return persistedState{RecentFiles: []string{}}, nil
		}
		return state, err
	}

	if len(content) == 0 {
		return persistedState{RecentFiles: []string{}}, nil
	}

	if err := json.Unmarshal(content, &state); err != nil {
		return persistedState{RecentFiles: []string{}}, nil
	}

	if state.RecentFiles == nil {
		state.RecentFiles = []string{}
	}

	return state, nil
}

func (s *stateStore) save(state persistedState) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}

	content, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	temp := s.path + ".tmp"
	if err := os.WriteFile(temp, content, 0o644); err != nil {
		return err
	}

	return os.Rename(temp, s.path)
}
