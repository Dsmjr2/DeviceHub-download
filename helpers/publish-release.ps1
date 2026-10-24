# Publishes a new DeviceHub version to the download page in one go (23 Oct 2026, Shawn: "I dont think the link is
# updated"): the code to the public download repository and the signed zip, version file and library bundle
# (helpers/make-installer.ps1), the Setup.exe (helpers/make-setup-exe.ps1), then the four files uploaded over the ones on
# the release (v1.0, the one every copy and the download link follow). Uploading uses GitHub's own command line tool (gh)
# when it is installed and signed in; otherwise the release page and the dist folder open, to drag the four files in.
#   powershell -NoProfile -ExecutionPolicy Bypass -File helpers\publish-release.ps1
param([string]$Tag = 'v1.0', [string]$Repo = 'Dsmjr2/DeviceHub-download')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'

Write-Host 'Building the new version (code, zip, version file, library bundle; signed)...' -ForegroundColor Cyan
$build = [Diagnostics.Stopwatch]::StartNew()
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'make-installer.ps1')
if ($LASTEXITCODE) { throw 'make-installer.ps1 failed (see above); nothing was uploaded' }
Write-Host "  built [$([int]$build.Elapsed.TotalSeconds) s]"
# make-installer.ps1 builds DeviceHub-Setup.exe too (it was built twice before 23 Oct 2026)

$files = 'DeviceHub-setup.zip', 'version.json', 'device-library.json', 'DeviceHub-Setup.exe' | ForEach-Object { Join-Path $dist $_ }
$missing = $files | Where-Object { -not (Test-Path $_) }
if ($missing) { throw "missing from dist: $($missing -join ', ')" }

$gh = Get-Command gh -ErrorAction SilentlyContinue
$signedIn = $false
if ($gh) { & gh auth status 2>$null | Out-Null; $signedIn = ($LASTEXITCODE -eq 0) }
if ($gh -and $signedIn) {
  # Faster (24 Oct 2026, Shawn: "Can we speed up publishing?"): the two big files (the zip, and Setup.exe, which holds
  # the zip again) go up at the same time, each on its own connection; the zip's upload no longer waits for Setup.exe's.
  # version.json and the library bundle go up only once the zip is there (a copy reads version.json first, then fetches
  # the zip it names), and from then on friends have the new version: "Published." is said then, while Setup.exe (only
  # for new people) finishes. Each step's seconds are written, so a slow one shows in logs\publish.log.
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $upTmp = Join-Path $env:TEMP "DeviceHub-publish-$PID"
  New-Item -ItemType Directory -Force $upTmp | Out-Null
  function Start-Upload($file, $name) {
    $p = Start-Process -FilePath $gh.Source -ArgumentList @('release', 'upload', $Tag, "`"$file`"", '--repo', $Repo, '--clobber') -NoNewWindow -PassThru `
      -RedirectStandardOutput (Join-Path $upTmp "$name.out") -RedirectStandardError (Join-Path $upTmp "$name.err")
    [void]$p.Handle   # keeps the exit code readable after it ends
    return $p
  }
  function Wait-Upload($p, $name) {
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { Get-Content (Join-Path $upTmp "$name.err") -ErrorAction SilentlyContinue | Write-Host; throw "the upload of $name failed (see above)" }
  }
  $mb = { param($f) [math]::Round((Get-Item $f).Length / 1MB, 1) }
  Write-Host "Uploading to $Repo release ${Tag}: the zip ($(& $mb $files[0]) MB) and Setup.exe ($(& $mb $files[3]) MB) at the same time..." -ForegroundColor Cyan
  $zipUp = Start-Upload $files[0] 'zip'
  $exeUp = Start-Upload $files[3] 'exe'
  Wait-Upload $zipUp 'DeviceHub-setup.zip'
  Write-Host "  zip uploaded [$([int]$clock.Elapsed.TotalSeconds) s]"
  & gh release upload $Tag $files[1] $files[2] --repo $Repo --clobber
  if ($LASTEXITCODE) { $exeUp.WaitForExit(); throw 'the upload of version.json and the library failed (see above)' }
  Write-Host ''
  Write-Host "Published. Every copy sees the new version on its next check (Settings > DeviceHub updates > Check). [$([int]$clock.Elapsed.TotalSeconds) s]" -ForegroundColor Green
  Write-Host 'Finishing Setup.exe (the download for new people)...'
  Wait-Upload $exeUp 'DeviceHub-Setup.exe'
  Write-Host "  Setup.exe uploaded [$([int]$clock.Elapsed.TotalSeconds) s]"
  Remove-Item $upTmp -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Write-Host ''
  Write-Host 'Built. GitHub''s gh tool is not installed or not signed in, so upload the four files yourself:' -ForegroundColor Yellow
  Write-Host "  1. On the page that opens, press Edit (the pencil), delete the four old files, drag in the four from the dist folder."
  Write-Host '  2. Press Update release.'
  Start-Process "https://github.com/$Repo/releases/tag/$Tag"
  Start-Process explorer.exe $dist
}
