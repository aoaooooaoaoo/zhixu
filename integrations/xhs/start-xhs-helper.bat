@echo off
chcp 65001 >nul
title 知序 · 小红书登录抓取助手
cd /d "%~dp0..\.."
if exist "D:\python\python.exe" (
  rem 只是借用 python 所在目录不影响；这里用 node
)
where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 node，请先安装 Node.js 22+
  pause
  exit /b 1
)
node "integrations\xhs\xhs_helper.mjs"
pause
