$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $projectRoot "frontend"
$preferredGo = if ($env:LOCKLIFT_GO) {
    $env:LOCKLIFT_GO
}
elseif (Test-Path (Join-Path $env:ProgramFiles "Go\bin\go.exe")) {
    Join-Path $env:ProgramFiles "Go\bin\go.exe"
}
elseif (Test-Path (Join-Path $env:LocalAppData "Programs\Go\bin\go.exe")) {
    Join-Path $env:LocalAppData "Programs\Go\bin\go.exe"
}
else {
    $null
}
$preferredWails = if ($env:LOCKLIFT_WAILS) { $env:LOCKLIFT_WAILS } else { $null }

function Resolve-Executable {
    param(
        [string]$Preferred,
        [string]$CommandName
    )

    if ($Preferred -and (Test-Path $Preferred)) {
        return $Preferred
    }

    $resolved = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($resolved) {
        return $resolved.Source
    }

    return $null
}

$goExe = Resolve-Executable -Preferred $preferredGo -CommandName "go.exe"
if (-not $goExe) {
    throw "未找到 Go 编译器，请先安装 Go。"
}

$wailsExe = Resolve-Executable -Preferred $preferredWails -CommandName "wails.exe"
if (-not $wailsExe) {
    Write-Host "未找到 Wails CLI，正在自动安装..." -ForegroundColor Cyan
    $env:GOPROXY = "https://goproxy.cn,direct"
    & $goExe install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
    $goPath = (& $goExe env GOPATH).Trim()
    if ($goPath) {
        $preferredWails = Join-Path $goPath "bin\wails.exe"
    }
    $wailsExe = Resolve-Executable -Preferred $preferredWails -CommandName "wails.exe"
}

if (-not $wailsExe) {
    throw "Wails CLI 安装失败，请检查 Go 环境。"
}

$env:PATH = "$(Split-Path $goExe -Parent);$(Split-Path $wailsExe -Parent);$env:PATH"

Push-Location $frontendDir
try {
    npm install
}
finally {
    Pop-Location
}

& $wailsExe generate module

try {
    & $wailsExe build -clean -platform windows/amd64
}
catch {
    Write-Warning "清理旧产物失败，正在回退到非清理强制构建..."
    & $wailsExe build -platform windows/amd64 -f
}

Write-Host ""
Write-Host "构建完成：" -ForegroundColor Green
Write-Host (Join-Path $projectRoot "build\bin\LockLift.exe")
