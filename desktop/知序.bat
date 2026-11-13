@echo off
chcp 65001 >nul
title 知序 桌面版
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo 需要 Node.js 22+：https://nodejs.org/
  pause
  exit /b 1
)
node "desktop\launch.mjs"
pause
