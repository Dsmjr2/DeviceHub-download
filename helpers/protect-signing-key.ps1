# Locks DeviceHub's release signing key (22 Oct 2026, Shawn: yes to a password on the signing key). Run once:
#   powershell -NoProfile -ExecutionPolicy Bypass -File helpers\protect-signing-key.ps1
# It asks for a password (twice, nothing shown), then:
#   1. release-key.backup.pem: the key encrypted with that password (AES-256). Copy it somewhere safe (a USB stick).
#   2. release-key.dpapi: the key locked to this Windows login (DPAPI), which publishing uses with nothing to type.
#   3. checks both give back the same key and that it still matches the app's public key, and only then removes the
#      plain release-key.pem.
# Restore after a Windows reinstall: put the backup back in %APPDATA%\DeviceHub-signing, then
#   powershell -NoProfile -Command "Read-Host 'Password' -AsSecureString | % { [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }" | node helpers\signing-key.mjs --restore
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'DeviceHub-signing'
$plain = Join-Path $dir 'release-key.pem'
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path $plain)) { Write-Host 'There is no plain signing key to lock (it may be locked already).' -ForegroundColor Yellow; exit 1 }

function Read-Pass($prompt) {
  $s = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
$p1 = Read-Pass 'Choose a password for the signing key backup (12 or more characters)'
if ($p1.Length -lt 12) { Write-Host 'Too short: use 12 or more characters. Nothing was changed.' -ForegroundColor Yellow; exit 1 }
$p2 = Read-Pass 'Type it again'
if ($p1 -ne $p2) { Write-Host 'The two did not match. Nothing was changed.' -ForegroundColor Yellow; exit 1 }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $root 'runtime\node.exe' }
$p1 | & $node (Join-Path $PSScriptRoot 'protect-signing-key-step.mjs')
if ($LASTEXITCODE -ne 0) { Write-Host 'Something did not check out, so the plain key was left as it was.' -ForegroundColor Yellow; exit 1 }
Write-Host ''
Write-Host "Done. Copy this file somewhere safe (a USB stick), and keep the password somewhere safe too:" -ForegroundColor Green
Write-Host "   $(Join-Path $dir 'release-key.backup.pem')"
