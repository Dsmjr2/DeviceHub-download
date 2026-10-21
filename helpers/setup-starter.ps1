# Runs inside DeviceHub-Setup.exe (20 Oct 2026; built by helpers/make-installer.ps1 with Windows' own IExpress).
# IExpress unpacks this script and DeviceHub-setup.zip into a temporary folder and runs this; it unzips DeviceHub
# beside it, runs the same installer as the zip (helpers/install.ps1: copies DeviceHub to %USERPROFILE%\DeviceHub,
# shortcuts, starts it) and removes the temporary copy. Nothing is downloaded.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$tmp = Join-Path $env:TEMP ("DeviceHub-setup-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
  Write-Host 'Unpacking DeviceHub...' -ForegroundColor Cyan
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $here 'DeviceHub-setup.zip'), $tmp)
  # DEVICEHUB_TEST_TARGET (testing the real Setup.exe beside an installed DeviceHub): installs there, no shortcuts,
  # not started; the tester starts it on a spare port
  if ($env:DEVICEHUB_TEST_TARGET) { & (Join-Path $tmp 'DeviceHub\helpers\install.ps1') -Source (Join-Path $tmp 'DeviceHub') -Target $env:DEVICEHUB_TEST_TARGET -NoShortcuts -NoLaunch -AppsKey 'DeviceHubTest' }
  else { & (Join-Path $tmp 'DeviceHub\helpers\install.ps1') -Source (Join-Path $tmp 'DeviceHub') }
  Write-Host ''
  Write-Host 'DeviceHub is installed and opening. This window closes by itself.' -ForegroundColor Green
  if (-not $env:DEVICEHUB_TEST_TARGET) { Start-Sleep 4 }
} catch {
  Write-Host ''
  Write-Host "DeviceHub was not installed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Press Enter to close.'
  [void](Read-Host)
} finally {
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
