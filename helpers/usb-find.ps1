# Finds a device's capture number (19 Oct 2026): records every device on one USB controller for a few seconds with
# USBPcap (read-only, administrator rights), while DeviceHub reads the device, so its messages show which number it is.
#   powershell -File usb-find.ps1 -Interface \\.\USBPcap2 -Seconds 10
param([string]$Interface = '\\.\USBPcap2', [int]$Seconds = 10)
$exe = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'learn'
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir 'find-all.pcap'
Set-Content (Join-Path $dir 'find-all.status.txt') "$(Get-Date -Format 'HH:mm:ss') recording all devices on $Interface for $Seconds s"
$p = Start-Process -FilePath $exe -ArgumentList @('-d', $Interface, '-A', '-s', '96', '-o', "`"$out`"") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds $Seconds
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Start-Sleep -Milliseconds 500
Add-Content (Join-Path $dir 'find-all.status.txt') "$(Get-Date -Format 'HH:mm:ss') done: $((Get-Item $out -ErrorAction SilentlyContinue).Length) bytes"
