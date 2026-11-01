@echo off
setlocal
cd /d "%~dp0"
rem Opened from inside the zip in Explorer, only this file is unpacked to a temp folder (1 Nov 2026, a new-setup audit)
if not exist "%~dp0helpers\install.ps1" (
  echo Right-click the zip and choose Extract All first, then run Install DeviceHub.bat from the extracted folder.
  echo.
  pause
  exit /b 1
)
rem Unblock downloaded files so Windows SmartScreen and PowerShell do not block the installer
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0helpers\install.ps1"
echo.
pause
