@echo off
rem Installs DeviceHub on this PC (see helpers\install.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0helpers\install.ps1"
echo.
pause
