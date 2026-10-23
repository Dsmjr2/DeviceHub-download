# DeviceHub installer for another Windows PC. Run by "Install DeviceHub.bat" from the unzipped folder.
#  1. copies the app to %USERPROFILE%\DeviceHub (keeps any backups/profiles already there)
#  2. Node.js: the hand-off zip carries it (runtime\node.exe); otherwise checks for it and offers winget
#  3. Corsair's cue-sdk: carried by the zip too; otherwise npm install (only needed for the headset)
#  4. makes Desktop and Start menu shortcuts, then starts DeviceHub
param([string]$Source = (Split-Path $PSScriptRoot -Parent), [switch]$NoLaunch, [switch]$NoShortcuts, [string]$Target = (Join-Path $env:USERPROFILE 'DeviceHub'), [string]$AppsKey = 'DeviceHub', [switch]$Overwrite)
$ErrorActionPreference = 'Stop'
$hadWindow = $false   # a DeviceHub window was open when this install quit DeviceHub (see "quitting it first")
function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }

# What DeviceHub needs from this PC (20 Oct 2026), said in plain words before anything is copied. None of them stops
# the install; each says what will not work and what to do.
Step 'Checking this PC'
$build = [Environment]::OSVersion.Version.Build
if ($build -ge 22000) { Write-Host "   Windows 11 (build $build)" } else { Write-Host "   This is not Windows 11 (build $build). DeviceHub is made for Windows 11; parts may not work." -ForegroundColor Yellow }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$prebuilt = Test-Path (Join-Path $Source 'helpers\bin\helper-sources.sha256')
if (Test-Path $csc) { Write-Host '   Windows'' C# compiler found (DeviceHub builds its device helper with it)' }
elseif ($prebuilt) { Write-Host '   the device helper comes ready-built (Windows'' C# compiler is only needed if DeviceHub''s own code is changed on this PC)' }
else { Write-Host '   Windows'' C# compiler (.NET Framework 4.8) is missing, so DeviceHub cannot reach your devices. Turn on ".NET Framework 4.8 Advanced Services" in Windows Features.' -ForegroundColor Yellow }
$browser = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) { Write-Host "   window: $(if ($browser -match 'msedge') { 'Microsoft Edge' } else { 'Google Chrome' })" } else { Write-Host '   Neither Chrome nor Edge was found: DeviceHub needs one of them for its window.' -ForegroundColor Yellow }
$owner = Get-NetTCPConnection -LocalPort 5577 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($owner) {
  $isHub = $false; try { $isHub = [bool]((Invoke-RestMethod http://127.0.0.1:5577/api/version -TimeoutSec 2).version) } catch {}
  if (-not $isHub) { Write-Host "   Port 5577 is used by another program ($((Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue).ProcessName)), so DeviceHub cannot start until that program is closed." -ForegroundColor Yellow }
}

# never over a development copy (a folder with code history of its own): that is someone's own work, not an install.
# A copy installed from the zip has code history too since 21 Oct 2026, tied to the public download repository, so it
# can update by merging; that one is an install.
$gitDir = Join-Path $Target '.git'
$shared = (Test-Path -LiteralPath (Join-Path $gitDir 'config')) -and (Select-String -LiteralPath (Join-Path $gitDir 'config') -Pattern 'DeviceHub-download' -SimpleMatch -Quiet)
if ((Test-Path -LiteralPath $gitDir) -and -not $shared) {
  Write-Host ''
  Write-Host "   $Target is a development copy of DeviceHub (it has code history), so nothing is copied over it." -ForegroundColor Yellow
  Write-Host '   Use that copy as it is, or install somewhere else with -Target.' -ForegroundColor Yellow
  exit 1
}
# an installed copy with history: its own changes (made on this PC, or brought together with a new version by an
# update) are never copied over; Settings > Update merges them with a new version instead
if ($shared -and -not $Overwrite -and (Get-Command git -ErrorAction SilentlyContinue)) {
  $ErrorActionPreference = 'Continue'
  $dirty = @(& git -C $Target status --porcelain --untracked-files=no 2>$null)
  $own = [int](& git -C $Target rev-list --count HEAD --not --remotes 2>$null)
  $ErrorActionPreference = 'Stop'
  if ($dirty.Count -or $own) {
    Write-Host ''
    Write-Host '   This copy has changes made on this PC, so nothing was installed over them. Use Settings > Update (it brings them and the new version together), or ask Claude Code to "update DeviceHub".' -ForegroundColor Yellow
    exit 3
  }
}

# Never over this PC's own changes (21 Oct 2026): an installed copy carries release-files.json, a fingerprint of every app
# file as it was installed. A file that no longer matches was changed on this PC (by its owner or their Claude); copying
# the new version would undo it, so nothing is copied and the files are named. -Overwrite installs anyway.
$prints = Join-Path $Target 'release-files.json'
if (-not $Overwrite -and (Test-Path -LiteralPath $prints) -and -not (Test-Path -LiteralPath (Join-Path $Target '.git'))) {
  $was = Get-Content -LiteralPath $prints -Raw | ConvertFrom-Json
  # a file matching any version DeviceHub ever shipped (release-history.json, 23 Oct 2026) was not changed on this PC
  $shipped = $null
  # the new download's own list first (it knows every version, including the one an older install has); else the installed one
  foreach ($histFile in @((Join-Path $Source 'release-history.json'), (Join-Path $Target 'release-history.json'))) {
    if (-not $shipped -and (Test-Path -LiteralPath $histFile)) { try { $shipped = Get-Content -LiteralPath $histFile -Raw | ConvertFrom-Json } catch {} }
  }
  # helpers/bin is built output (the pre-built helper, rebuilt on this PC if its sources change): always replaced
  $changed = @($was.PSObject.Properties | Where-Object { -not $_.Name.StartsWith('helpers/bin/') } | Where-Object {
    $p = Join-Path $Target ($_.Name -replace '/', '\')
    if (-not (Test-Path -LiteralPath $p)) { return $true }
    $now = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower()
    $now -ne $_.Value -and -not ($shipped -and @($shipped.($_.Name)) -contains $now.Substring(0, 16))
  } | ForEach-Object { $_.Name })
  if ($changed.Count) {
    Write-Host ''
    Write-Host "   $($changed.Count) of DeviceHub's files were changed on this PC, so nothing was installed over them:" -ForegroundColor Yellow
    $changed | Select-Object -First 15 | ForEach-Object { Write-Host "     $_" -ForegroundColor Yellow }
    Write-Host '   In DeviceHub, Settings > DeviceHub updates > Update anyway keeps a copy of them and installs the new version; or run this again with -Overwrite to replace them.' -ForegroundColor Yellow
    exit 3
  }
}

Step "Copying DeviceHub to $Target"
$same = (Resolve-Path $Source).Path.TrimEnd('\') -ieq [IO.Path]::GetFullPath($Target).TrimEnd('\')
if ($same) { Write-Host '   already in place' } else {
  New-Item -ItemType Directory -Force $Target | Out-Null
  # an installed copy that is running holds its own files (node.exe, the helper, the headset library): quit it first,
  # or the copy stopped halfway and left a mix of old and new files (20 Oct 2026). Started again at the end.
  $full = [IO.Path]::GetFullPath($Target).TrimEnd('\') + '\'
  $mine = { @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($full, [StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.IndexOf("${full}helpers\keep-running.bat", [StringComparison]::OrdinalIgnoreCase) -ge 0) }) }
  if ((& $mine).Count) {
    Write-Host '   DeviceHub is running from there: quitting it first'
    $port = Get-NetTCPConnection -LocalPort 5577 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    # a DeviceHub window open now (Settings > Update is pressed in one) stays open and reloads itself when DeviceHub
    # is back, so the start at the end must not open a second one (23 Oct 2026, a friend's PC: two windows after
    # every update). DeviceHub.vbs /afterupdate waits for it to come back instead.
    try { $hadWindow = [int]((Invoke-RestMethod http://127.0.0.1:5577/api/windows -TimeoutSec 2).open) -gt 0 } catch {}
    if ($port -and ((& $mine).ProcessId -contains $port.OwningProcess)) { try { Invoke-RestMethod http://127.0.0.1:5577/api/quit -Method Post -TimeoutSec 5 | Out-Null } catch {} }
    for ($i = 0; $i -lt 20 -and (& $mine).Count; $i++) { Start-Sleep -Milliseconds 500 }
    # what did not quit: the launcher loop first (it would start the server again), then the rest
    & $mine | Sort-Object { $_.Name -ne 'cmd.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
  }
  # this PC's own data in an existing install is never overwritten
  $keep = 'backups', 'profiles.json', 'settings.json', 'activity.jsonl', 'battery-history.jsonl', 'mouse-battery-study.jsonl',
    'mouse-level.json', 'headset-lights.json', 'seen-devices.json', 'waiting-changes.json', 'last-device-values.json', 'waiting-monitors.json', 'last-monitor-values.json', 'daily-check.json', 'battery-care.json', 'lights-names.json', 'window-profile', '.git'
  if (-not (Test-Path (Join-Path $Source 'node_modules\cue-sdk'))) { $keep += 'node_modules' }
  # Folders are merged with robocopy (21 Oct 2026): Copy-Item onto a folder that already exists puts the new one INSIDE
  # it (public\public), so a reinstall or an update left every folder's old files running. Files are always replaced
  # (/IS /IT); files that are only on this PC (my-devices\, a VIA file) are left as they are.
  Get-ChildItem $Source -Force | Where-Object { $keep -notcontains $_.Name } | ForEach-Object {
    $dest = Join-Path $Target $_.Name
    if ($_.PSIsContainer) {
      & robocopy $_.FullName $dest /E /IS /IT /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "copying $($_.Name) failed (robocopy $LASTEXITCODE)" }
    } else { Copy-Item -LiteralPath $_.FullName $dest -Force }
  }
  $global:LASTEXITCODE = 0
  Write-Host '   done (your backups and profiles on this PC, if any, are kept)'
}
# a downloaded zip marks every file "from the internet", and Windows then warns before DeviceHub's own files open
# (SmartScreen, the script host). The person chose this download, so the installed copy's mark is cleared (20 Oct 2026).
$marked = @(Get-ChildItem $Target -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { Get-Item -LiteralPath $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue })
if ($marked.Count) { $marked | Unblock-File -ErrorAction SilentlyContinue; Write-Host "   cleared Windows' downloaded-file mark on $($marked.Count) files" }

Step 'Checking Node.js'
# the hand-off zip carries Node.js in runtime\ (helpers/make-installer.ps1): nothing to install
$bundled = Join-Path $Target 'runtime\node.exe'
$node = if (Test-Path $bundled) { Get-Item $bundled } else { Get-Command node -ErrorAction SilentlyContinue }
if (Test-Path $bundled) { Write-Host "   included: Node.js $(& $bundled --version)" }
elseif (-not $node) {
  Write-Host '   Node.js is not installed. DeviceHub needs it to run its small local server.'
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    $a = Read-Host '   Install Node.js LTS now with winget (package OpenJS.NodeJS.LTS from nodejs.org)? [Y/n]'
    if ($a -eq '' -or $a -match '^[Yy]') {
      winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
      $node = Get-Command node -ErrorAction SilentlyContinue
    }
  }
  if (-not $node) {
    Write-Host '   Install Node.js LTS from https://nodejs.org, then run "Install DeviceHub" again.' -ForegroundColor Yellow
    Start-Process 'https://nodejs.org/en/download'
    Read-Host '   Press Enter to close'
    exit 1
  }
}
if (-not (Test-Path $bundled)) { Write-Host "   Node.js $(node --version)" }

Step "Corsair's headset library (cue-sdk)"
if (Test-Path (Join-Path $Target 'node_modules\cue-sdk')) { Write-Host '   included' } else {
  Push-Location $Target
  try {
    & npm install --no-fund --no-audit --loglevel=error 2>&1 | ForEach-Object { "   $_" }
    if ($LASTEXITCODE -ne 0) { Write-Host '   Could not install it; the mouse and keyboard still work. The headset needs this library.' -ForegroundColor Yellow }
  } finally { Pop-Location }
}

# the device helper is built here, once, so the first start is quick (built on the first start it held DeviceHub up
# for up to two minutes on a slow PC, and its window gave up waiting; 20 Oct 2026)
Step 'Building the device helper'
# the zip carries it ready-built with the hash of the sources it was built from (22 Oct 2026,
# docs/handoff/prebuilt-helper.md): while the sources match, nothing is compiled
$helperExe = Join-Path $Target 'helpers\bin\DeviceHubHelper.exe'
$helperHashFile = Join-Path $Target 'helpers\bin\helper-sources.sha256'
$shipped = $false
$nodeExe = if (Test-Path $bundled) { $bundled } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
if ((Test-Path $helperExe) -and (Test-Path $helperHashFile)) {
  if ($nodeExe) {
    $ErrorActionPreference = 'Continue'
    $now = & $nodeExe (Join-Path $Target 'helpers\helper-sources.js') --hash (Join-Path $Target 'helpers') 2>$null | Select-Object -Last 1
    $ErrorActionPreference = 'Stop'
    $shipped = ($LASTEXITCODE -eq 0) -and $now -and ($now.Trim() -eq (Get-Content -LiteralPath $helperHashFile -Raw).Trim())
  }
}
if ($shipped) { Write-Host '   included, ready-built for this version' }
elseif (Test-Path $csc) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Target 'helpers\native\build.ps1') 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $helperExe)) {
    # a copy that came with a ready-built helper records what this one was built from (helpers/native.js reads it)
    if ((Test-Path $helperHashFile) -and $nodeExe) { & $nodeExe (Join-Path $Target 'helpers\helper-sources.js') --record (Join-Path $Target 'helpers') 2>&1 | Out-Null }
    Write-Host '   done'
  }
  elseif (Test-Path $helperExe) { Write-Host '   It could not be rebuilt for the changed code; the ready-built one is used, and DeviceHub tries again when it starts.' -ForegroundColor Yellow }
  else { Write-Host '   It could not be built; DeviceHub tries again when it starts. Without it the devices are not reached.' -ForegroundColor Yellow }
} elseif (Test-Path $helperExe) { Write-Host '   no C# compiler on this PC: the ready-built helper is used' -ForegroundColor Yellow }
else { Write-Host '   skipped: no C# compiler on this PC (see the check above)' -ForegroundColor Yellow }

Step 'Making shortcuts'
$sh = New-Object -ComObject WScript.Shell
$links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeviceHub.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'DeviceHub.lnk'))
if ($NoShortcuts) { $links = @(); Write-Host '   skipped (test run)' }
foreach ($p in $links) {
  $l = $sh.CreateShortcut($p)
  $l.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $l.Arguments = '"' + (Join-Path $Target 'DeviceHub.vbs') + '"'
  $l.WorkingDirectory = $Target
  $l.IconLocation = (Join-Path $Target 'DeviceHub.ico') + ',0'
  $l.Description = 'Mouse, headset and keyboard in one app'
  $l.Save()
  Write-Host "   $p"
}

# Windows Settings > Apps: DeviceHub with an Uninstall button (helpers/uninstall.ps1), for this user only
Step 'Adding DeviceHub to Windows Settings > Apps'
$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppsKey"
New-Item -Path $reg -Force | Out-Null
$kb = [int]((Get-ChildItem -LiteralPath $Target -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1KB)
$un = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Target 'helpers\uninstall.ps1')`" -Key $AppsKey"
foreach ($kv in @{ DisplayName = 'DeviceHub'; DisplayVersion = (Get-Date -Format 'yyyy.M.d'); Publisher = 'DeviceHub'; InstallLocation = $Target;
    DisplayIcon = (Join-Path $Target 'DeviceHub.ico'); UninstallString = $un; QuietUninstallString = "$un -Quiet" }.GetEnumerator()) { Set-ItemProperty $reg -Name $kv.Key -Value $kv.Value }
foreach ($kv in @{ NoModify = 1; NoRepair = 1; EstimatedSize = $kb }.GetEnumerator()) { Set-ItemProperty $reg -Name $kv.Key -Value $kv.Value -Type DWord }
Write-Host '   Settings > Apps > DeviceHub (Uninstall removes it)'

# Updates that merge (21 Oct 2026): with git on this PC (Claude Code brings it), the copy is tied to the version it came
# from in the public download repository (release.json appCommit, branch "app"). Its own changes then show as changes,
# and Settings > Update brings a new version together with them (helpers/self-update.js) instead of copying over them.
# Without git, or offline, it updates as whole versions, and never over a changed file (release-files.json).
$rel = $null; try { $rel = Get-Content -LiteralPath (Join-Path $Target 'release.json') -Raw | ConvertFrom-Json } catch {}
if ($rel.appCommit -and (Get-Command git -ErrorAction SilentlyContinue)) {
  Step 'Connecting to updates'
  $ErrorActionPreference = 'Continue'
  $g = { & git -C $Target @args 2>&1 | Out-Null; $LASTEXITCODE -eq 0 }
  $made = -not (Test-Path -LiteralPath $gitDir)
  $ok = $true
  if ($made) { $ok = (& $g init -q -b main) -and (& $g remote add origin 'https://github.com/Dsmjr2/DeviceHub-download.git') }
  if ($ok) { [void](& $g config core.autocrlf false); $ok = & $g fetch -q origin app }
  if ($ok) { $ok = & $g reset -q $rel.appCommit }
  if ($ok) { [void](& $g branch -q '--set-upstream-to=origin/app' main) }
  $ErrorActionPreference = 'Stop'
  if ($ok) { Write-Host '   done: Settings > Update brings new versions together with any changes made on this PC' }
  else {
    Write-Host '   not now (no connection?); updates come as whole versions, never over a changed file' -ForegroundColor Yellow
    if ($made) { Remove-Item -LiteralPath $gitDir -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

Step 'Done'
Write-Host '   Open DeviceHub from the Desktop or Start. Plug in your devices; they are found by themselves.'
if (-not $NoLaunch) { Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList (@('"' + (Join-Path $Target 'DeviceHub.vbs') + '"') + $(if ($hadWindow) { @('/afterupdate') } else { @() })) }
