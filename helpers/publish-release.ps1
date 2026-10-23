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
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'make-installer.ps1')
if ($LASTEXITCODE) { throw 'make-installer.ps1 failed (see above); nothing was uploaded' }
Write-Host 'Building DeviceHub-Setup.exe...' -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'make-setup-exe.ps1')
if ($LASTEXITCODE) { throw 'make-setup-exe.ps1 failed (see above); nothing was uploaded' }

$files = 'DeviceHub-setup.zip', 'version.json', 'device-library.json', 'DeviceHub-Setup.exe' | ForEach-Object { Join-Path $dist $_ }
$missing = $files | Where-Object { -not (Test-Path $_) }
if ($missing) { throw "missing from dist: $($missing -join ', ')" }

$gh = Get-Command gh -ErrorAction SilentlyContinue
$signedIn = $false
if ($gh) { & gh auth status 2>$null | Out-Null; $signedIn = ($LASTEXITCODE -eq 0) }
if ($gh -and $signedIn) {
  Write-Host "Uploading to $Repo release $Tag..." -ForegroundColor Cyan
  & gh release upload $Tag @files --repo $Repo --clobber
  if ($LASTEXITCODE) { throw 'the upload failed (see above)' }
  Write-Host ''
  Write-Host 'Published. Every copy sees the new version on its next check (Settings > DeviceHub updates > Check).' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host 'Built. GitHub''s gh tool is not installed or not signed in, so upload the four files yourself:' -ForegroundColor Yellow
  Write-Host "  1. On the page that opens, press Edit (the pencil), delete the four old files, drag in the four from the dist folder."
  Write-Host '  2. Press Update release.'
  Start-Process "https://github.com/$Repo/releases/tag/$Tag"
  Start-Process explorer.exe $dist
}
