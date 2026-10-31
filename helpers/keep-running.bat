@echo off
rem DeviceHub's keep-running loop (20 Oct 2026); what it does: the notes under the server.js line below.
rem KEEP that line ending at byte 1452 (CRLF), as before: an update replaces this file while cmd runs it, and cmd
rem reads on from that byte (27 Oct 2026; tests/data-migrate.mjs checks it).
cd /d "%~dp0.."
set "NODE=node"
if exist "%CD%\runtime\node.exe" set NODE="%CD%\runtime\node.exe"
setlocal EnableDelayedExpansion
rem the port (DEVICEHUB_PORT, as the server reads it), so a test copy can run beside the real one

set "PORT=5577"
if defined DEVICEHUB_PORT set "PORT=%DEVICEHUB_PORT%"
rem already answering (DeviceHub itself, not another program on the port): nothing to do
rem (%PORT%, not !PORT!: inside a pipe the delayed form is not filled in)
curl.exe -s -m 1 http://127.0.0.1:%PORT%/api/version 2>nul | findstr /c:"version" >nul && exit /b 0
set /a crashes=0
call :now
set /a windowStart=!secs!
:loop
if not exist logs mkdir logs
if exist logs\server.log for %%F in (logs\server.log) do if %%~zF GTR 2097152 (
  if exist logs\server.old.log del /q logs\server.old.log
  move /y logs\server.log logs\server.old.log >nul
)
rem logs\ is made here, inside the loop, so a cmd still running the version from before an update makes it too
rem (27 Oct 2026) smaller V8 memory limits, ~3 MB less (below)
!NODE! --no-warnings --max-semi-space-size=1 --max-old-space-size=512 server.js >> logs\server.log 2>&1
rem NODE (above): the quoted path, set before delayed expansion and read as !NODE!, so a folder with & or ! works (31 Oct 2026)
rem the young generation at 1 MB, the heap capped at 512 MB (it uses ~20): measured, no slower
rem What this does (20 Oct 2026: replaces the script-host loop in DeviceHub.vbs, which used ~25 MB to wait; this hidden
rem cmd uses ~4 MB): starts the server and keeps it running: after a crash it starts it again in 3 s, at most 5 times in
rem 10 minutes. A normal Quit (code 0), or a server that finds DeviceHub already running, ends the loop. Code 3 is
rem DeviceHub updating itself: started again at once, not counted. The log is moved aside over 2 MB. The log is in
rem logs\, this PC's own files in data\ (27 Oct 2026, helpers/data-migrate.js).
set code=!errorlevel!
if "!code!"=="0" exit /b 0
if "!code!"=="3" goto loop
rem code 4: the port belongs to another program (logs\server.log says so); starting again would not help
if "!code!"=="4" exit /b 4
rem a new version that crashes on start (data\update-rollback.txt), before it has run well for a minute: back to the version before it (helpers/self-update.js)
rem (beside the app when the new version stopped before it moved this PC's files into data\)
set "rb="
if exist data\update-rollback.txt set "rb=data\update-rollback.txt"
if not defined rb if exist update-rollback.txt set "rb=update-rollback.txt"
if defined rb (
  set /p old=<!rb!
  del /q !rb!
  >> logs\server.log echo [launcher] %date:~4% %time:~0,8% the new version stopped with code !code! on start; going back to !old!
  rem a version from before data\ (no helpers/data-migrate.js) reads this PC's files beside the app: they go back there first
  set "failed=data\update-failed.txt"
  git cat-file -e !old!:helpers/data-migrate.js 2>nul || (
    set "failed=update-failed.txt"
    !NODE! helpers\data-migrate.js --to-root >> logs\server.log 2>&1
  )
  rem remember the version that failed, so Update does not offer it again (helpers/self-update.js)
  git rev-parse HEAD > !failed! 2>nul
  rem --keep: files changed on this PC and not committed stay as they are (24 Oct 2026)
  git reset --quiet --keep !old! >> logs\server.log 2>&1
  goto loop
)
curl.exe -s -m 1 http://127.0.0.1:%PORT%/api/version 2>nul | findstr /c:"version" >nul && exit /b 0
call :now
set /a elapsed=!secs!-!windowStart!
if !elapsed! LSS 0 set /a elapsed+=86400
if !elapsed! GTR 600 (
  set /a crashes=0
  set /a windowStart=!secs!
)
set /a crashes+=1
>> logs\server.log echo [launcher] %date:~4% %time:~0,8% server exited with code !code!; restart !crashes! of 5
if !crashes! GTR 5 exit /b 1
ping -n 4 127.0.0.1 >nul
goto loop

:now
set "t=%time: =0%"
set /a secs=(1%t:~0,2%-100)*3600+(1%t:~3,2%-100)*60+(1%t:~6,2%-100)
exit /b 0
