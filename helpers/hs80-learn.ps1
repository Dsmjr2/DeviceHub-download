# Learning sessions (19 Oct 2026; -Match picks the device by its USB name, e.g. 'EPOMAKER P75' with -Prefix p75): records the USB traffic of every HS80 connection (the receiver and, when it
# is plugged in, the headset's own cable) for a fixed time with USBPcap, so what iCUE sends when Shawn presses a
# button there can be read afterwards (helpers/pcap-events.mjs). Read-only: it only listens. Needs administrator
# rights (USBPcap), so it is started with one Windows prompt. iCUE's pairing uses both connections at once.
#   powershell -File hs80-learn.ps1 -Name pair -Seconds 150
param([string]$Name = 'capture', [int]$Seconds = 150, [string]$Match = 'CORSAIR HS80', [string]$Prefix = 'hs80', [string]$Interface = '', [int]$Device = 0)
$exe = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'learn'
New-Item -ItemType Directory -Force $dir | Out-Null
$status = Join-Path $dir "$Prefix-$Name.status.txt"
function Say($t) { Add-Content $status "$(Get-Date -Format 'HH:mm:ss')  $t" }
Set-Content $status ''
# every HS80 connection: its interface and device number in USBPcap's list (printed on stderr)
$found = @()
$ifaces = & $exe --extcap-interfaces 2>$null | ForEach-Object { if ($_ -match 'value=(\\\\\.\\USBPcap\d+)') { $Matches[1] } }
foreach ($i in $ifaces) {
  foreach ($line in (cmd /c "`"$exe`" --extcap-interface $i --extcap-config 2>&1")) {
    # a connection's top entry: "display=CORSAIR HS80 ..." with a plain device number as its parent
    if ($line -match "display=($([regex]::Escape($Match))[^}]*)\}") { $label = $Matches[1]; if ($line -match 'parent=(\d+)\}') { $found += @{ iface = $i; device = $Matches[1]; label = $label } } }
  }
}
# a device given by number (one that shows only as "USB Input Device", e.g. the P75: helpers/usb-find.ps1 finds it)
if ($Interface -and $Device) { $found = @(@{ iface = $Interface; device = "$Device"; label = "$Prefix device $Device" }) }
# only the top-level device entries (the composite device, not each of its interfaces)
$found = $found | Group-Object { "$($_.iface)|$($_.device)" } | ForEach-Object { $_.Group[0] }
if (-not $found) { Say 'no HS80 connection found in USBPcap'; exit 1 }
$procs = @()
$n = 0
foreach ($f in $found) {
  $n++
  $out = Join-Path $dir "$Prefix-$Name-$n.pcap"
  Say "recording $($f.label) ($($f.iface) device $($f.device)) into $out"
  $procs += Start-Process -FilePath $exe -ArgumentList @('-d', $f.iface, '--devices', $f.device, '-s', '128', '-o', "`"$out`"") -PassThru -WindowStyle Hidden
}
Say "recording for $Seconds s"
Start-Sleep -Seconds $Seconds
foreach ($p in $procs) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } }
Start-Sleep -Milliseconds 500
Say 'done'
