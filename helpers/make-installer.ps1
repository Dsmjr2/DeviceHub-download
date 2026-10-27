# Builds dist\DeviceHub-setup.zip, the installer to hand to anyone (19 Oct 2026). It holds only the app's own files
# (what git tracks), never this PC's data: backups, profiles, settings, activity, battery history and study, the mouse
# level, light settings, seen devices, logs, captures or the window profile. It also carries Node.js and the headset
# library, so the person needs nothing else installed. After building, it opens the zip and refuses to finish if any
# of this PC's data got in. The person unzips it and runs "Install DeviceHub.bat". It also carries the device helper
# ready-built (helpers\bin, 22 Oct 2026), so a new PC needs no C# compiler.
# Test builds: -NoPublish (no publish-code.ps1), -NoTools (no bundled tools), -NoSign (version.json left unsigned).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
# the code goes to the public download repository first (helpers/publish-code.ps1; only a committed version): an
# installed copy is tied to that commit, so its updates can merge with changes made on its PC. -NoPublish for a test build.
$appCommit = $null
if ($args -notcontains '-NoPublish') { $appCommit = (& (Join-Path $PSScriptRoot 'publish-code.ps1') | Select-Object -Last 1); if ($appCommit -notmatch '^[0-9a-f]{7,40}$') { $appCommit = $null } }
Push-Location $root
try {
  # the makers' product photos (public/img xlite, hs80, p75) stay on the publisher's PC (27 Oct 2026, Shawn: "just keep
  # this on mine"); a copy without them shows the drawings (public/core/theme.js)
  $files = git ls-files | Where-Object { $_ -notmatch '^public/preview-' -and $_ -notmatch '^screenshots/' -and $_ -ne 'JOURNAL.md' -and $_ -ne 'eq-presets.json' -and $_ -notmatch '^public/img/(xlite|hs80|p75)\.png$' }
  if (-not $files) { throw 'git ls-files returned nothing' }
  $dist = Join-Path $root 'dist'
  New-Item -ItemType Directory -Force $dist | Out-Null
  $zip = Join-Path $dist 'DeviceHub-setup.zip'
  # ---- PRE-BUILT HELPER (22 Oct 2026; docs/handoff/prebuilt-helper.md) ----
  # the device helper is built here from the current sources, into a folder of its own (this PC's own
  # helpers\bin\DeviceHubHelper.exe is never replaced), and goes in as helpers\bin\DeviceHubHelper.exe with
  # helpers\bin\helper-sources.sha256, the hash of the sources it was built from (helpers/helper-sources.js). A new
  # PC then runs it without compiling; it is rebuilt there only if the sources change (helpers/native.js).
  $helperDir = Join-Path $env:TEMP "DeviceHub-helper-$PID"
  if (Test-Path $helperDir) { Remove-Item $helperDir -Recurse -Force }
  New-Item -ItemType Directory $helperDir | Out-Null
  $helperExe = Join-Path $helperDir 'DeviceHubHelper.exe'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'native\build.ps1') -Out $helperExe
  if ($LASTEXITCODE -or -not (Test-Path $helperExe)) { throw 'the device helper could not be built (see above); the installer must carry it' }
  $helperHash = (& (Get-Command node).Source (Join-Path $PSScriptRoot 'helper-sources.js') --hash $PSScriptRoot | Select-Object -Last 1)
  if ($LASTEXITCODE -or $helperHash -notmatch '^[0-9a-f]{64}$') { throw 'the device helper sources could not be hashed' }
  $helperHashFile = Join-Path $helperDir 'helper-sources.sha256'
  [IO.File]::WriteAllText($helperHashFile, "$helperHash`n")
  $helperFiles = [ordered]@{ 'helpers/bin/DeviceHubHelper.exe' = $helperExe; 'helpers/bin/helper-sources.sha256' = $helperHashFile }
  # ---- end PRE-BUILT HELPER ----
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  function Ent($p) { ('DeviceHub/' + $p) -replace '/', '\' }  # zip entry names, one separator
  $z = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
  try {
    foreach ($f in $files) {
      $full = Join-Path $root $f
      if (Test-Path $full -PathType Leaf) { [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $full, (Ent $f), 'Optimal') }
    }
    foreach ($k in $helperFiles.Keys) { [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $helperFiles[$k], (Ent $k), 'Optimal') }

    # Node.js and the headset library (19 Oct 2026): the official node.exe already on this PC, copied unchanged, and
    # the production libraries from node_modules
    $node = (Get-Command node -ErrorAction Stop).Source
    $ver = & $node --version
    if ([int]($ver.TrimStart('v').Split('.')[0]) -lt 18) { throw "Node.js $ver is too old to bundle (18 or newer)" }
    if ((& $node -p process.arch) -ne 'x64') { throw 'the bundled Node.js must be the x64 build' }
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $node, (Ent 'runtime/node.exe'), 'Optimal')
    $libs = 'cue-sdk', 'node-addon-api', 'node-gyp-build'
    $lic = (Get-Content (Join-Path (Join-Path $root 'helpers') 'runtime-licenses.txt') -Raw) + "`r`nBundled Node.js version: $ver`r`nIts full license, with every part's (27 Oct 2026): https://github.com/nodejs/node/blob/$ver/LICENSE (a copy for v24.14.0: helpers\licenses\nodejs-v24.14.0-LICENSE.txt; THIRD-PARTY-NOTICES.txt lists every program DeviceHub ships)`r`n"
    foreach ($lib in $libs) {
      $dir = Join-Path (Join-Path $root 'node_modules') $lib
      if (-not (Test-Path $dir)) { throw "node_modules/$lib is missing: run npm install first" }
      Get-ChildItem $dir -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($root.Length + 1)
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $_.FullName, (Ent $rel), 'Optimal')
      }
      $l = Get-ChildItem $dir -File | Where-Object { $_.Name -like 'LICENSE*' } | Select-Object -First 1
      $bar = '-' * 78
      if ($l) { $lic += "`r`n$bar`r`n$lib`r`n$bar`r`n" + (Get-Content $l.FullName -Raw) }
    }
    $e = $z.CreateEntry((Ent 'runtime/LICENSES.txt'))
    $w = New-Object System.IO.StreamWriter $e.Open(); $w.Write($lic); $w.Dispose()
    # which version this is (21 Oct 2026): a copy installed from the zip compares it with the newest release's
    # version.json to offer updates (helpers/self-update.js)
    $commit = (git rev-parse --short=12 HEAD).Trim()
    if (git status --porcelain --untracked-files=no) { $commit += '-modified' }
    $builtAt = (Get-Date).ToUniversalTime().ToString('o')
    $e = $z.CreateEntry((Ent 'release.json'))
    $w = New-Object System.IO.StreamWriter $e.Open(); $w.Write((@{ commit = $commit; builtAt = $builtAt; appCommit = $appCommit } | ConvertTo-Json -Compress)); $w.Dispose()
    # a fingerprint (SHA-256) of every app file (21 Oct 2026): an update or reinstall compares the installed copy with
    # it and never writes over a file that was changed on that PC (helpers/install.ps1, helpers/self-update.js)
    $prints = [ordered]@{}
    foreach ($f in $files) { $full = Join-Path $root $f; if (Test-Path $full -PathType Leaf) { $prints[$f] = (Get-FileHash $full -Algorithm SHA256).Hash.ToLower() } }
    # the pre-built helper too, like any other file (an update replaces it with the release's own)
    foreach ($k in $helperFiles.Keys) { $prints[$k] = (Get-FileHash $helperFiles[$k] -Algorithm SHA256).Hash.ToLower() }
    $e = $z.CreateEntry((Ent 'release-files.json'))
    $w = New-Object System.IO.StreamWriter $e.Open(); $w.Write(($prints | ConvertTo-Json -Compress)); $w.Dispose()
    # every version of every app file DeviceHub ever had (23 Oct 2026, helpers/release-history.mjs): a file on a PC that
    # matches one of them was not changed there (an update that stopped halfway), so an update goes over it
    $list = Join-Path $env:TEMP "DeviceHub-files-$PID.txt"; $hist = Join-Path $env:TEMP "DeviceHub-history-$PID.json"
    [IO.File]::WriteAllLines($list, [string[]]$files)
    & (Get-Command node).Source (Join-Path $PSScriptRoot 'release-history.mjs') $list $hist
    if ($LASTEXITCODE -or -not (Test-Path $hist)) { throw 'the release history could not be made' }
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $hist, (Ent 'release-history.json'), 'Optimal')
    Remove-Item $list, $hist -Force -ErrorAction SilentlyContinue
    # ---- BUNDLED TOOLS (22 Oct 2026, the owner's decision; helpers/bundled-tools.json, docs/handoff/bundled-tools.md) ----
    # Equalizer APO's installer and OpenRGB's portable build, each the official file checked against its pinned SHA-256
    # by helpers/fetch-bundled.mjs (it downloads into bundled-cache\, outside git, and leaves out every driver and PawnIO
    # file except OpenRGB's six PawnIO modules, which go only into tools\openrgb\board-modules\ for board lights), go in
    # under tools\equalizerapo\ and tools\openrgb\ with their license text and tools\README.txt.
    # -NoTools: a test build without them.
    if ($args -notcontains '-NoTools') {
      $manifest = Join-Path $env:TEMP "DeviceHub-bundled-$PID.json"
      & (Get-Command node).Source (Join-Path $PSScriptRoot 'fetch-bundled.mjs') --manifest $manifest
      if ($LASTEXITCODE) { throw 'the bundled tools could not be fetched and checked (see above); nothing was put in the zip' }
      $bundled = Get-Content $manifest -Raw | ConvertFrom-Json
      Remove-Item $manifest -Force
      foreach ($b in $bundled) { [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $b.src, (Ent $b.dest), 'Optimal') }
    }
    # ---- end BUNDLED TOOLS ----
  } finally { $z.Dispose() }
  # ---- FILE LIST (27 Oct 2026, smaller updates; helpers/update-files.js) ----
  # dist\DeviceHub-files.json.gz: every file in the zip with its SHA-256 and size; "r" = also in the public download
  # repository at the app commit (an update downloads only those that changed), "d" = the file itself for the ones made
  # at each build (release.json, the helper, ...). Node, node_modules and the bundled tools are named only: a copy whose
  # own differ takes the whole zip. Only for a published, unmodified version (the repository must hold the same files).
  $filesGz = Join-Path $dist 'DeviceHub-files.json.gz'
  if (Test-Path $filesGz) { Remove-Item $filesGz -Force }
  $filesInfo = $null
  $clone = Join-Path (Split-Path $root -Parent) 'DeviceHub-publish'
  if ($appCommit -and $commit -notlike '*-modified' -and (Test-Path (Join-Path $clone '.git'))) {
    $fullApp = (& git -C $clone rev-parse "$appCommit^{commit}").Trim()
    $inRepo = @{}; foreach ($f in $files) { $inRepo[$f] = $true }
    $sha = [Security.Cryptography.SHA256]::Create()
    $fileList = [ordered]@{}
    $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
    try {
      foreach ($en in $z.Entries) {
        if ($en.FullName.EndsWith('\') -or $en.FullName.EndsWith('/')) { continue }
        $name = ($en.FullName -replace '[\\/]', '/') -replace '^DeviceHub/', ''
        $ms = New-Object IO.MemoryStream; $st = $en.Open(); $st.CopyTo($ms); $st.Dispose()
        $bytes = $ms.ToArray(); $ms.Dispose()
        $item = [ordered]@{ h = ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLower(); s = $bytes.Length }
        if ($inRepo.ContainsKey($name)) { $item.r = 1 }
        elseif ($name -notlike 'node_modules/*' -and $name -notlike 'tools/*' -and $name -ne 'runtime/node.exe' -and $bytes.Length -le 1MB) { $item.d = [Convert]::ToBase64String($bytes) }
        $fileList[$name] = $item
      }
    } finally { $z.Dispose() }
    $json = [Text.Encoding]::UTF8.GetBytes((@{ commit = $fullApp; files = $fileList } | ConvertTo-Json -Compress -Depth 4))
    $fs = [IO.File]::Create($filesGz); $gz = New-Object IO.Compression.GZipStream($fs, [IO.Compression.CompressionLevel]::Optimal); $gz.Write($json, 0, $json.Length); $gz.Dispose(); $fs.Dispose()
    $filesInfo = [ordered]@{ size = (Get-Item $filesGz).Length; sha256 = (Get-FileHash $filesGz -Algorithm SHA256).Hash.ToLower() }
    Write-Host "   file list: $($fileList.Count) files, $([math]::Round($filesInfo.size / 1KB)) KB"
  }
  # ---- end FILE LIST ----
  # the release's version file, published beside the zip: version, size and SHA-256, so an update is checked whole
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  $vj = [ordered]@{ commit = $commit; builtAt = $builtAt; appCommit = $appCommit; size = (Get-Item $zip).Length; sha256 = $hash }
  if ($filesInfo) { $vj.files = $filesInfo }
  $vj | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $dist 'version.json') -Encoding ascii -NoNewline
  Remove-Item $helperDir -Recurse -Force -ErrorAction SilentlyContinue
  # signed with the publisher's key, kept only on this PC (helpers/sign-release.mjs): copies install only what it signs.
  # -NoSign: a test build left unsigned (copies refuse it as an update), so the key is not used for it.
  if ($args -notcontains '-NoSign') {
    & (Get-Command node).Source (Join-Path $PSScriptRoot 'sign-release.mjs') (Join-Path $dist 'version.json')
    if ($LASTEXITCODE) { throw 'the release could not be signed' }
  }
  # ---- LIBRARY BUNDLE (22 Oct 2026; helpers/make-library-bundle.mjs, docs/handoff/library-updates.md) ----
  # dist\device-library.json: every device-library entry, signed with the same key over a payload of its own. UPLOAD IT
  # beside version.json on the release: copies fetch it once a day (helpers/library-updates.mjs). It can also be
  # rebuilt and uploaded on its own between app releases: node helpers/make-library-bundle.mjs
  # (-NoSign: not made either; it is signed with the same key)
  if ($args -notcontains '-NoSign') {
    & (Get-Command node).Source (Join-Path $PSScriptRoot 'make-library-bundle.mjs') (Join-Path $dist 'device-library.json')
    if ($LASTEXITCODE) { throw 'the device library bundle could not be built' }
  }
  # ---- end LIBRARY BUNDLE ----

  # never this PC's data
  $private = 'backups', 'profiles.json', 'settings.json', 'activity.jsonl', 'battery-history.jsonl', 'mouse-battery-study.jsonl',
    'mouse-level.json', 'headset-lights.json', 'headset-firmware.json', 'seen-devices.json', 'updates-cache.json', 'server.log',
    'server.old.log', 'captures', 'window-profile', 'screenshots', 'waiting-changes.json', 'waiting-monitors.json',
    'last-device-values.json', 'last-monitor-values.json', 'daily-check.json', 'battery-care.json', 'setup.json', 'openrgb-config', 'bundled-cache', 'wallpaper-previous', 'lights-names.json', 'eq-presets.json', 'read-cache', 'pc-check-cache.json'
  $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $names = $z.Entries | ForEach-Object { ($_.FullName -replace '[\\/]', '/') -replace '^DeviceHub/', '' }
    $bad = $names | Where-Object { $n = $_; $private | Where-Object { $n -eq $_ -or $n.StartsWith("$_/") } }
    if ($bad) { throw "private files got into the zip: $($bad -join ', ')" }
    # node_modules holds only the three bundled libraries
    $extra = $names | Where-Object { $_ -like 'node_modules/*' } | ForEach-Object { $_.Split('/')[1] } | Sort-Object -Unique | Where-Object { $_ -notin $libs }
    if ($extra) { throw "unexpected libraries in the zip: $($extra -join ', ')" }
    if ($names -notcontains 'runtime/node.exe') { throw 'runtime/node.exe is missing from the zip' }
    $photos = $names | Where-Object { $_ -match '^public/img/(xlite|hs80|p75)\.png$' }
    if ($photos) { throw "the makers' product photos got into the zip: $($photos -join ', ')" }
    # the third-party notices and every license text they name (27 Oct 2026; THIRD-PARTY-NOTICES.txt, helpers\licenses), tracked in git so they go in with the app's files
    $noLic = @('THIRD-PARTY-NOTICES.txt', 'helpers/licenses/GPL-2.0.txt', 'helpers/licenses/GPL-3.0.txt', 'helpers/licenses/LGPL-3.0.txt', 'helpers/licenses/LGPL-2.1.txt', 'helpers/licenses/hidapi-BSD.txt', 'helpers/licenses/DirectXShaderCompiler-LICENSE.txt', 'helpers/licenses/nodejs-v24.14.0-LICENSE.txt') | Where-Object { $names -notcontains $_ }
    if ($noLic) { throw "license files missing from the zip (commit them first): $($noLic -join ', ')" }
    # helpers/bin holds exactly the pre-built helper and the hash of its sources
    $bin = @($names | Where-Object { $_ -like 'helpers/bin/*' } | Sort-Object)
    if (($bin -join ',') -ne 'helpers/bin/DeviceHubHelper.exe,helpers/bin/helper-sources.sha256') { throw "helpers/bin in the zip is not the pre-built helper and its hash: $($bin -join ', ')" }
    # never a driver or anything PawnIO, WinRing0 or inpout (helpers/bundled-tools.json neverKeep), anywhere in the zip,
    # except OpenRGB's listed PawnIO modules (boardModules), and those only in tools/openrgb/board-modules/, never
    # beside OpenRGB.exe (it loads modules from its own folder only; helpers/board-lights.mjs copies them for board lights)
    $tbl = Get-Content (Join-Path $PSScriptRoot 'bundled-tools.json') -Raw | ConvertFrom-Json
    $never = $tbl.neverKeep
    $orgbT = $tbl.tools | Where-Object { $_.id -eq 'openrgb' }
    $modules = @($orgbT.boardModules.PSObject.Properties.Name | ForEach-Object { "$($orgbT.folder)/$($orgbT.boardModulesFolder)/$_" })
    $drv = $names | Where-Object { $n = $_.Split('/')[-1]; $_ -like 'tools/*' -and $modules -notcontains $_ -and ($never | Where-Object { $n -match $_ }) }
    if ($drv) { throw "a driver or PawnIO file got into the zip: $($drv -join ', ')" }
    $loose = $names | Where-Object { $_ -like 'tools/*' -and $_ -match '\.bin$' -and $modules -notcontains $_ }
    if ($loose) { throw "a PawnIO module is outside tools/openrgb/board-modules: $($loose -join ', ')" }
    if ($args -notcontains '-NoTools' -and ($names -notcontains 'tools/equalizerapo/EqualizerAPO-x64-1.4.2.exe' -or $names -notcontains 'tools/openrgb/OpenRGB.exe' -or $names -notcontains 'tools/README.txt')) { throw 'the bundled tools are missing from the zip' }
    $noMod = $modules | Where-Object { $names -notcontains $_ }
    if ($args -notcontains '-NoTools' -and $noMod) { throw "the board-lights modules are missing from the zip: $($noMod -join ', ')" }
    $mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
    "built $zip ($($names.Count) files, $mb MB, Node.js $ver included); checked: none of this PC's data is in it"
  } finally { $z.Dispose() }
} finally { Pop-Location }
# and the one-file installer from that zip (helpers/make-setup-exe.ps1)
& (Join-Path $PSScriptRoot 'make-setup-exe.ps1')
