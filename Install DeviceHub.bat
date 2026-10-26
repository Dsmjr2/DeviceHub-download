@echo off
setlocal
cd /d "%~dp0"
rem Unblock downloaded files so Windows SmartScreen and PowerShell do not block the installer
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0helpers\install.ps1"
echo.
pause
