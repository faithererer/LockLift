# LockLift

LockLift 是一个面向 Windows 的文件 / 文件夹占用检测与释放工具。

它会先展示是谁在占用目标路径，再由用户勾选要释放的进程，避免误杀；释放动作本质上是结束被选中的占用进程树。

## 功能

- 支持检测本地文件占用
- 支持递归扫描文件夹内文件占用
- 支持手输路径、系统选择器和拖拽输入
- 支持展示占用进程名、PID、程序路径和可否释放
- 自动保护当前应用自身和明显的系统关键进程
- 支持以管理员身份重启
- 支持最近检测路径记录
## 界面截图
<img width="3060" height="1830" alt="image" src="https://github.com/user-attachments/assets/d81a5193-a74d-4a91-a140-463426d94116" />

## 技术栈

- Wails v2
- Go 1.26
- React + TypeScript + Vite
- Tailwind CSS
- Framer Motion

后端主检测逻辑使用 Windows Restart Manager API。

## 本地开发

```powershell
wails dev
```

## 测试

```powershell
go test ./...
cd frontend
npm run check
```

## 构建

推荐直接使用仓库内脚本：

```powershell
./scripts/build.ps1
```

如果 `go.exe` 或 `wails.exe` 不在 `PATH` 中，也可以先设置：

```powershell
$env:LOCKLIFT_GO="C:\Path\To\go.exe"
$env:LOCKLIFT_WAILS="C:\Path\To\wails.exe"
```

默认产物：

```text
build\bin\LockLift.exe
```

## 平台说明

当前版本主要面向 Windows 10 / 11。

## 发布说明

当前仓库同时维护两类 Windows 发布产物：

- 便携版 `LockLift.exe`
- 安装器相关模板与发布资源
