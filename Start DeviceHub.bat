@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  set "NODE=%~dp0runtime\node.exe"
) else (
  set "NODE=node"
)
start "" "http://localhost:5577"
"%NODE%" server.js
