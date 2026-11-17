# 推送知序仓库到 GitHub
# 说明：走 ssh.github.com:443，避免国内网络对 22 端口的限制
# 用法：在任意目录执行 powershell -ExecutionPolicy Bypass -File scripts\push-github.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

$key = Join-Path $env:USERPROFILE '.ssh\zhixu_github'
if (-not (Test-Path $key)) {
  throw "找不到 SSH 密钥：$key（应为 zhixu_github 私钥）"
}

$env:GIT_SSH_COMMAND = "ssh -i $($key -replace '\\','/') -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o HostName=ssh.github.com -o Port=443"

Write-Host "推送到 origin（main + tags）…" -ForegroundColor Cyan
git push origin main --tags
Write-Host "完成。" -ForegroundColor Green
