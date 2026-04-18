package main

import (
	"context"
	"errors"

	"LockLift/internal/locklift"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx     context.Context
	service *locklift.Service
}

func NewApp() *App {
	return &App{
		service: locklift.NewService("LockLift"),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) InspectFile(path string) locklift.InspectResult {
	return a.service.InspectFile(path)
}

func (a *App) ReleaseLocks(path string, pids []int) locklift.ReleaseResult {
	return a.service.ReleaseLocks(path, pids)
}

func (a *App) PickFile() (string, error) {
	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要检测的文件",
	})
	if err != nil {
		return "", err
	}
	return selection, nil
}

func (a *App) PickDirectory() (string, error) {
	selection, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要检测的文件夹",
	})
	if err != nil {
		return "", err
	}
	return selection, nil
}

func (a *App) GetRecentFiles() []string {
	return a.service.GetRecentFiles()
}

func (a *App) ClearRecentFiles() error {
	return a.service.ClearRecentFiles()
}

func (a *App) IsElevated() bool {
	return locklift.IsElevated()
}

func (a *App) RelaunchElevated() error {
	if locklift.IsElevated() {
		return errors.New("当前已经是管理员模式")
	}
	if err := locklift.RelaunchElevated(); err != nil {
		return err
	}
	runtime.Quit(a.ctx)
	return nil
}

func (a *App) OpenInExplorer(path string) error {
	return locklift.OpenInExplorer(path)
}
