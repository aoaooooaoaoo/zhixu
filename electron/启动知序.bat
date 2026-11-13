@echo off
chcp 65001 >nul
title 知序
cd /d "%~dp0"
rem 某些环境（如某些开发工具）会设置 ELECTRON_RUN_AS_NODE，导致 Electron 以 Node 模式运行，这里先清掉
set ELECTRON_RUN_AS_NODE=
if exist "release\Zhixu-portable-1.0.0.exe" (
  start "" "release\Zhixu-portable-1.0.0.exe"
  exit /b 0
)
if exist "release\win-unpacked\知序.exe" (
  start "" "release\win-unpacked\知序.exe"
  exit /b 0
)
echo 没找到打包产物，先运行：npm run build
pause
