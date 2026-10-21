# Builds dist\DeviceHub-setup.zip, the installer to hand to anyone (19 Oct 2026). It holds only the app's own files
# (what git tracks), never this PC's data: backups, profiles, settings, activity, battery history and study, the mouse
# level, light settings, seen devices, logs, captures or the window profile. It also carries Node.js and the headset
# library, so the person needs nothing else installed. After building, it opens the zip and refuses to finish if any
# of this PC's data got in. The person unzips it and runs "Install DeviceHub.bat".
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
# the code goes to the public download repository first (helpers/publish-code.ps1; only a committed version): an
# installed copy is tied to that commit, so its updates can merge with changes made on its PC. -NoPublish for a test build.
$appCommit = $null
if ($args -notcontains '-NoPublish') { $appCommit = (& (Join-Path $PSScriptRoot 'publish-code.ps1') | Select-Object -Last 1); if ($appCommit -notmatch '^[0-9a-f]{7,40}$') { $appCommit = $null } }
Push-Location $root
try {
  $files = git ls-files | Where-Object { $_ -notmatch '^public/preview-' -and $_ -notmatch '^screenshots/' -and $_ -ne 'JOURNAL.md' }
  if (-not $files) { throw 'git ls-files returned nothing' }
  $dist = Join-Path $root 'dist'
  New-Item -ItemType Directory -Force $dist | Out-Null
  $zip = Join-Path $dist 'DeviceHub-setup.zip'
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  function Ent($p) { ('DeviceHub/' + $p) -replace '/', '\' }  # zip entry names, one separator
  $z = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
  try {
    foreach ($f in $files) {
      $full = Join-Path $root $f
      if (Test-Path $full -PathType Leaf) { [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $full, (Ent $f), 'Optimal') }
    }

    # Node.js and the headset library (19 Oct 2026): the official node.exe already on this PC, copied unchanged, and
    # the production libraries from node_modules
    $node = (Get-Command node -ErrorAction Stop).Source
    $ver = & $node --version
    if ([int]($ver.TrimStart('v').Split('.')[0]) -lt 18) { throw "Node.js $ver is too old to bundle (18 or newer)" }
    if ((& $node -p process.arch) -ne 'x64') { throw 'the bundled Node.js must be the x64 build' }
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $node, (Ent 'runtime/node.exe'), 'Optimal')
    $libs = 'cue-sdk', 'node-addon-api', 'node-gyp-build'
    $lic = (Get-Content (Join-Path (Join-Path $root 'helpers') 'runtime-licenses.txt') -Raw) + "`r`nBundled Node.js version: $ver`r`n"
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
    $e = $z.CreateEntry((Ent 'release-files.json'))
    $w = New-Object System.IO.StreamWriter $e.Open(); $w.Write(($prints | ConvertTo-Json -Compress)); $w.Dispose()
  } finally { $z.Dispose() }
  # the release's version file, published beside the zip: version, size and SHA-256, so an update is checked whole
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  @{ commit = $commit; builtAt = $builtAt; appCommit = $appCommit; size = (Get-Item $zip).Length; sha256 = $hash } | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $dist 'version.json') -Encoding ascii -NoNewline
  # signed with the publisher's key, kept only on this PC (helpers/sign-release.mjs): copies install only what it signs
  & (Get-Command node).Source (Join-Path $PSScriptRoot 'sign-release.mjs') (Join-Path $dist 'version.json')
  if ($LASTEXITCODE) { throw 'the release could not be signed' }

  # never this PC's data
  $private = 'backups', 'profiles.json', 'settings.json', 'activity.jsonl', 'battery-history.jsonl', 'mouse-battery-study.jsonl',
    'mouse-level.json', 'headset-lights.json', 'headset-firmware.json', 'seen-devices.json', 'updates-cache.json', 'server.log',
    'server.old.log', 'captures', 'window-profile', 'screenshots', 'waiting-changes.json', 'waiting-monitors.json',
    'last-device-values.json', 'last-monitor-values.json', 'daily-check.json', 'battery-care.json'
  $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $names = $z.Entries | ForEach-Object { ($_.FullName -replace '[\\/]', '/') -replace '^DeviceHub/', '' }
    $bad = $names | Where-Object { $n = $_; $private | Where-Object { $n -eq $_ -or $n.StartsWith("$_/") } }
    if ($bad) { throw "private files got into the zip: $($bad -join ', ')" }
    # node_modules holds only the three bundled libraries
    $extra = $names | Where-Object { $_ -like 'node_modules/*' } | ForEach-Object { $_.Split('/')[1] } | Sort-Object -Unique | Where-Object { $_ -notin $libs }
    if ($extra) { throw "unexpected libraries in the zip: $($extra -join ', ')" }
    if ($names -notcontains 'runtime/node.exe') { throw 'runtime/node.exe is missing from the zip' }
    $mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
    "built $zip ($($names.Count) files, $mb MB, Node.js $ver included); checked: none of this PC's data is in it"
  } finally { $z.Dispose() }
} finally { Pop-Location }
# and the one-file installer from that zip (helpers/make-setup-exe.ps1)
& (Join-Path $PSScriptRoot 'make-setup-exe.ps1')
