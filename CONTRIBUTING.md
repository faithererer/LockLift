# Contributing

感谢你愿意改进 LockLift。

## 开发环境

- Windows 10 / 11
- Go 1.23+
- Node.js 18+
- Wails v2

## 本地运行

```powershell
wails dev
```

## 提交前建议

```powershell
go test ./...
cd frontend
npm run check
npm run build
```

## 提交原则

- 保持 Windows 行为稳定，尤其是进程结束、权限判断和文件占用检测逻辑。
- 不要提交 `build/bin`、`frontend/dist` 或 `frontend/node_modules`。
- 不要把任何真实的本机路径、账号、邮箱、数据库地址、密码或内网信息写入仓库。
- 如果修改了桌面窗口行为，请同时验证窄窗口和大窗口布局。
