@echo off
cd /d "%~dp0"
start "" "http://localhost:5577"
node server.js
