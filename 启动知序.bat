@echo off
chcp 65001 >nul
cd /d "%~dp0app"
if exist "D:\python\python.exe" (
  start "知序 AI 服务" /min "D:\python\python.exe" server.py
) else (
  start "知序 AI 服务" /min python server.py
)
timeout /t 2 >nul
start "" "http://127.0.0.1:8788"
exit
