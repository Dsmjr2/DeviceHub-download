# Tests helpers\app-ui.ps1 (22 Oct 2026) against a small stand-in "maker's app" this test makes itself: a WinForms window
# with a DPI slider, a polling-rate list, two switches, a text box and buttons, all named. It never touches another
# app's window. The window does not take the focus or show in the taskbar, sits on the second screen when there is one
# (off-screen otherwise) and is closed as soon as the checks are done (it closes itself after 40 s whatever happens).
# The stand-in writes what its controls hold to a file ten times a second, so every change is checked from the app's
# side as well as from app-ui's read-back.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\app-ui.ps1
$ErrorActionPreference = 'Stop'
$tool = Join-Path (Split-Path $PSScriptRoot -Parent) 'helpers\app-ui.ps1'
$tag = 'DeviceHub app-ui test ' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$stateFile = Join-Path $env:TEMP "$($tag -replace ' ', '-').json"

Add-Type -AssemblyName System.Windows.Forms
$second = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
if ($second) { $a = $second.WorkingArea; $x = $a.X + $a.Width - 460; $y = $a.Y + $a.Height - 360 } else { $x = -32000; $y = -32000 }

$form = @"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition 'public class QuietForm : System.Windows.Forms.Form { protected override bool ShowWithoutActivation { get { return true; } } }'
`$f = New-Object QuietForm
`$f.Text = '$tag'; `$f.ShowInTaskbar = `$false; `$f.StartPosition = 'Manual'
`$f.Location = New-Object System.Drawing.Point($x, $y); `$f.Size = New-Object System.Drawing.Size(440, 340)
`$dpi = New-Object System.Windows.Forms.TrackBar; `$dpi.Name = 'trackDpi'; `$dpi.AccessibleName = 'DPI'
`$dpi.Minimum = 100; `$dpi.Maximum = 3200; `$dpi.SmallChange = 100; `$dpi.LargeChange = 400; `$dpi.TickFrequency = 100; `$dpi.Value = 800
`$dpi.SetBounds(10, 10, 400, 45)
`$poll = New-Object System.Windows.Forms.ComboBox; `$poll.Name = 'comboPoll'; `$poll.AccessibleName = 'Polling rate'; `$poll.DropDownStyle = 'DropDownList'
[void]`$poll.Items.AddRange(@('125 Hz', '500 Hz', '1000 Hz', 'Factory reset')); `$poll.SelectedIndex = 1; `$poll.SetBounds(10, 70, 200, 25)
`$snap = New-Object System.Windows.Forms.CheckBox; `$snap.Name = 'checkSnap'; `$snap.Text = 'Angle snapping'; `$snap.SetBounds(10, 105, 200, 25)
`$sleep = New-Object System.Windows.Forms.CheckBox; `$sleep.Name = 'checkSleep'; `$sleep.Text = 'Sleep mode'; `$sleep.Enabled = `$false; `$sleep.SetBounds(220, 105, 200, 25)
`$lod = New-Object System.Windows.Forms.TextBox; `$lod.Name = 'textLod'; `$lod.AccessibleName = 'Lift-off distance'; `$lod.Text = '1 mm'; `$lod.SetBounds(10, 140, 200, 25)
`$apply = New-Object System.Windows.Forms.Button; `$apply.Name = 'buttonApply'; `$apply.Text = 'Apply'; `$apply.SetBounds(10, 180, 120, 30)
`$fw = New-Object System.Windows.Forms.Button; `$fw.Name = 'buttonFw'; `$fw.Text = 'Firmware update'; `$fw.SetBounds(140, 180, 140, 30)
`$script:applied = 0; `$script:fwPresses = 0
`$apply.Add_Click({ `$script:applied++ }); `$fw.Add_Click({ `$script:fwPresses++ })
`$f.Controls.AddRange(@(`$dpi, `$poll, `$snap, `$sleep, `$lod, `$apply, `$fw))
`$t = New-Object System.Windows.Forms.Timer; `$t.Interval = 100
`$t.Add_Tick({ try { [IO.File]::WriteAllText('$stateFile', (ConvertTo-Json -Compress @{ dpi = `$dpi.Value; poll = "`$(`$poll.SelectedItem)"; snap = `$snap.Checked; sleep = `$sleep.Checked; lod = `$lod.Text; applied = `$script:applied; fw = `$script:fwPresses })) } catch {} })
`$t.Start()
`$bye = New-Object System.Windows.Forms.Timer; `$bye.Interval = 40000; `$bye.Add_Tick({ `$f.Close() }); `$bye.Start()
[System.Windows.Forms.Application]::Run(`$f)
"@
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($form))
$proc = Start-Process powershell -ArgumentList @('-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', $enc) -PassThru -WindowStyle Hidden

$fails = @()
function Check($ok, $what) { if (-not $ok) { $script:fails += $what; Write-Host "  FAIL: $what" } }
function State() { for ($i = 0; $i -lt 10; $i++) { try { return (Get-Content $stateFile -Raw | ConvertFrom-Json) } catch { Start-Sleep -Milliseconds 100 } } }
function Settled() { Start-Sleep -Milliseconds 250; State }   # the stand-in writes its state every 100 ms
function Tool([string[]]$a) {
  $ErrorActionPreference = 'Continue'   # a crash of the tool is a failed check, not the end of the test
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $tool @a 2>&1 | Out-String
  $code = $LASTEXITCODE
  $out = $out.Trim(); if ($out.Length -gt 4000) { $out = $out.Substring(0, 4000) + ' ...' }
  return @{ code = $code; out = $out }
}

try {
  for ($i = 0; $i -lt 50 -and -not (Test-Path $stateFile); $i++) { Start-Sleep -Milliseconds 200 }
  Check (Test-Path $stateFile) 'the stand-in window started'
  $W = @('-Window', $tag)

  $r = Tool (@('list') + $W)
  Check ($r.code -eq 0) "list exits 0 ($($r.code))"
  Check ($r.out -match 'Slider "DPI" id=trackDpi value=800 range=100\.\.3200 step=100') "list shows the DPI slider with its range ($($r.out))"
  Check ($r.out -match 'ComboBox "Polling rate" id=comboPoll selected="500 Hz"') 'list shows the polling-rate list and its choice'
  Check ($r.out -match 'CheckBox "Angle snapping" id=checkSnap toggle=Off') 'list shows the switch and its state'
  Check ($r.out -match 'CheckBox "Sleep mode" id=checkSleep toggle=Off.*\[disabled\]') 'list marks the disabled switch'
  Check ($r.out -match 'Button "Firmware update" id=buttonFw \[press\] \[REFUSED') 'list marks the firmware button as never touched'

  $r = Tool (@('get') + $W + @('-Name', 'DPI'))
  Check ($r.code -eq 0 -and $r.out -match 'value=800 ') "get reads the slider ($($r.out))"
  $r = Tool (@('get') + $W + @('-Name', 'trackDpi', '-Json'))
  Check ($r.code -eq 0 -and ($r.out | ConvertFrom-Json).value -eq 800) 'get by automation id, as JSON'

  $r = Tool (@('set') + $W + @('-Name', 'DPI', '-Value', '1600'))
  $s = Settled
  Check ($r.code -eq 0 -and $r.out -match '800 -> 1600 \(read back 1600\)' -and $s.dpi -eq 1600) "set moves the slider 800 -> 1600 ($($r.out); app: $($s.dpi))"
  $r = Tool (@('set') + $W + @('-Name', 'DPI', '-Value', '99999'))
  $s = Settled
  Check ($r.code -eq 2 -and $s.dpi -eq 1600) "a value outside the range is refused and nothing moves ($($r.code), app: $($s.dpi))"

  $r = Tool (@('set') + $W + @('-Name', 'Polling rate', '-Value', '1000 Hz'))
  $s = Settled
  Check ($r.code -eq 0 -and $r.out -match '"500 Hz" -> "1000 Hz"' -and $s.poll -eq '1000 Hz') "set picks a list choice ($($r.out); app: $($s.poll))"
  $r = Tool (@('set') + $W + @('-Name', 'Polling rate', '-Value', '8000 Hz'))
  $s = Settled
  Check ($r.code -eq 2 -and $r.out -match 'offers' -and $s.poll -eq '1000 Hz') "a choice the list does not have is refused and names the choices ($($r.out))"
  $r = Tool (@('set') + $W + @('-Name', 'Polling rate', '-Value', 'Factory reset'))
  $s = Settled
  Check ($r.code -eq 4 -and $r.out -match '^REFUSED' -and $s.poll -eq '1000 Hz') "a factory-reset choice is refused ($($r.out); app: $($s.poll))"

  $r = Tool (@('set') + $W + @('-Name', 'Angle snapping', '-Value', 'on'))
  $s = Settled
  Check ($r.code -eq 0 -and $r.out -match 'Off -> On' -and $s.snap -eq $true) "set turns a switch on ($($r.out))"
  $r = Tool (@('set') + $W + @('-Name', 'Angle snapping', '-Value', 'on'))
  Check ($r.code -eq 0 -and $r.out -match 'already On') 'set leaves a switch that is already on alone'
  $r = Tool (@('set') + $W + @('-Name', 'Angle snapping', '-Value', 'off'))
  $s = Settled
  Check ($r.code -eq 0 -and $s.snap -eq $false) 'set turns it back off'
  $r = Tool (@('set') + $W + @('-Name', 'Sleep mode', '-Value', 'on'))
  $s = Settled
  Check ($r.code -eq 1 -and $s.sleep -eq $false) "a disabled control is not written ($($r.code))"

  $r = Tool (@('set') + $W + @('-Name', 'Lift-off distance', '-Value', '2 mm'))
  $s = Settled
  Check ($r.code -eq 0 -and $r.out -match '"1 mm" -> "2 mm"' -and $s.lod -eq '2 mm') "set writes a text box ($($r.out))"

  $r = Tool (@('click') + $W + @('-Name', 'Apply'))
  $s = Settled
  Check ($r.code -eq 0 -and $r.out -match '^pressed Button "Apply"' -and $s.applied -eq 1) "click presses a button once ($($r.out); app: $($s.applied))"
  $r = Tool (@('click') + $W + @('-Name', 'Firmware update'))
  $s = Settled
  Check ($r.code -eq 4 -and $s.fw -eq 0) "click refuses the firmware button ($($r.out); app pressed $($s.fw))"
  $r = Tool (@('click') + $W + @('-Name', 'buttonFw'))
  $s = Settled
  Check ($r.code -eq 4 -and $s.fw -eq 0) 'the firmware button is refused by its automation id too'

  $r = Tool (@('get') + $W + @('-Name', 'Wheel speed'))
  Check ($r.code -eq 2) 'a control that is not there exits 2'
  $r = Tool @('get', '-Window', "$tag that is not open", '-Name', 'DPI')
  Check ($r.code -eq 2) 'a window that is not open exits 2'
} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  Remove-Item $stateFile -ErrorAction SilentlyContinue
}

if ($fails.Count) { Write-Output "app-ui (stand-in window): FAILED: $($fails -join '; ')"; exit 1 }
Write-Output 'app-ui (stand-in window): all good'
exit 0
