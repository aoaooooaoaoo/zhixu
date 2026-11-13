# 知序 · 启动 QQ 分享桥
# 自动从 NapCat 配置读取 OneBot WebSocket 端口/token，不需要手抄 token。
# 用法：右键“使用 PowerShell 运行”，或在终端执行：
#   powershell -ExecutionPolicy Bypass -File integrations\qq\start-bridge.ps1

$ErrorActionPreference = 'Stop'
$configDir = 'D:\NapCat\qqdata\NapCat\config'
$qqConfig = Get-ChildItem $configDir -Filter 'onebot11_*.json' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $qqConfig) {
  Write-Host "找不到 NapCat OneBot 配置：$configDir\onebot11_*.json" -ForegroundColor Red
  Write-Host "请先启动 NapCat（D:\NapCat\start-zhixu-napcat.bat），并确认 OneBot WebSocket 已启用。" -ForegroundColor Yellow
  exit 1
}

$cfg = Get-Content $qqConfig.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
$ws = $cfg.network.websocketServers | Where-Object { $_.enable } | Select-Object -First 1
if (-not $ws) {
  Write-Host "NapCat 里没有启用的 WebSocket 服务器；请在 WebUI → 网络配置里启用。" -ForegroundColor Red
  exit 1
}

$env:QQ_WS_URL = "ws://$($ws.host):$($ws.port)/"
$env:QQ_ACCESS_TOKEN = [string]$ws.token
$env:ZHIXU_INBOX_URL = 'http://127.0.0.1:8788/api/inbox'
if (-not $env:QQ_REPLY) { $env:QQ_REPLY = '1' }

Write-Host "OneBot: $($env:QQ_WS_URL)" -ForegroundColor Cyan
Write-Host "知序收件箱: $($env:ZHIXU_INBOX_URL)" -ForegroundColor Cyan
if (-not $env:QQ_ALLOWED_USERS) {
  Write-Host "提示：未设置 QQ_ALLOWED_USERS，当前接受所有私聊；建议改成你的主 QQ 号。" -ForegroundColor Yellow
}

Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
node qq_bridge.mjs
