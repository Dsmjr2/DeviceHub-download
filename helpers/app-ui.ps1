# Drives a maker's app through Windows UI Automation (22 Oct 2026, Shawn: "Less asking of 'click this button'"), so
# Claude can change ONE setting in G HUB, Synapse, iCUE and the like itself while helpers\hs80-learn.ps1 records.
# Windows' own System.Windows.Automation, nothing downloaded. Run it with Windows PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File helpers\app-ui.ps1 windows
#   ... app-ui.ps1 list  -Window 'G HUB'                      (title part or process name, e.g. lghub)
#   ... app-ui.ps1 get   -Window lghub -Name 'DPI'            (control name or automation id)
#   ... app-ui.ps1 set   -Window lghub -Name 'DPI' -Value 1600
#   ... app-ui.ps1 set   -Window iCUE  -Name 'Polling rate' -Value '1000 Hz'
#   ... app-ui.ps1 set   -Window iCUE  -Name 'Angle snapping' -Value on
#   ... app-ui.ps1 click -Window iCUE  -Name 'Apply'
# Options: -Type Slider|ComboBox|Button|... narrows the match, -Index n picks the n-th of several matches (1-based),
# -ProcessId n picks the window by process, -Json for machine-readable list/get, -UseKeys lets `set` move a slider that
# refuses a direct value with the arrow keys (only while that slider itself has the keyboard focus), -WaitMs how long a
# Chromium/Electron window may take to build its accessibility tree.
# Every action prints what it did and the read-back. Exit codes: 0 done, 1 the action failed or read back differently,
# 2 window/control not found or ambiguous or a bad value, 3 the window exposes no controls, 4 refused for safety.
# Safety: never touches a control (or a list item) whose name or id contains firmware, update, reset, factory, flash,
# bootloader, delete or format; never writes to a disabled or read-only control.
param(
  [Parameter(Position = 0)][string]$Command = '',
  [string]$Window = '',
  [string]$Name = '',
  [string]$Value = $null,
  [string]$Type = '',
  [int]$Index = 0,
  [int]$ProcessId = 0,
  [int]$Depth = 40,
  [int]$Max = 5000,
  [int]$WaitMs = 5000,
  [switch]$Json,
  [switch]$UseKeys
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, UIAutomationProvider, WindowsBase, System.Windows.Forms
# .NET's own client-side stand-in for WinForms windows shows every WinForms control as a nameless "Pane" with nothing
# to set (measured 22 Oct 2026 on the test's stand-in window). Telling it "no stand-in" for WinForms class names lets
# Windows read those controls' own accessibility instead (names, sliders, lists, switches, all correct).
# (a PowerShell script block as the callback fails inside .NET with a null reference: it has to be compiled, ~0.5 s)
if (-not ('AppUiNoWinFormsProxy' -as [type])) {
  $refs = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location,
    [System.Windows.Automation.Provider.IRawElementProviderSimple].Assembly.Location, 'WindowsBase')
  Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System; using System.Windows.Automation; using System.Windows.Automation.Provider;
public static class AppUiNoWinFormsProxy {
  static IRawElementProviderSimple None(IntPtr h, int child, int obj) { return null; }
  public static void Register() {
    ClientSettings.RegisterClientSideProviders(new [] { new ClientSideProviderDescription(None, "WindowsForms10.", null, ClientSideProviderMatchIndicator.AllowSubstringMatch) });
  }
}
'@
}
[AppUiNoWinFormsProxy]::Register()
# Invoke can block while the app shows a modal dialog: press from a second runspace and stop waiting after ms (the
# press itself still happened)
function InvokeWithin($e, [int]$ms) {
  $p = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $ps = [powershell]::Create(); [void]$ps.AddScript('param($p) $p.Invoke()').AddArgument($p)
  $h = $ps.BeginInvoke()
  if (-not $h.AsyncWaitHandle.WaitOne($ms)) { return 'timeout' }
  try { [void]$ps.EndInvoke($h) } catch { return "error: $($_.Exception.InnerException.Message)" }
  if ($ps.Streams.Error.Count) { return "error: $($ps.Streams.Error[0])" }
  $ps.Dispose(); return 'ok'
}
$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TrueCond = [System.Windows.Automation.Condition]::TrueCondition
$Forbidden = 'firmware|update|reset|factory|flash|bootloader|delete|format'
$Inv = [System.Globalization.CultureInfo]::InvariantCulture

function Fail([int]$code, [string]$msg) { [Console]::Out.WriteLine($msg); exit $code }   # straight to the console: Fail runs inside functions whose output is captured
function Pat($e, $pattern) { $p = $null; if ($e.TryGetCurrentPattern($pattern, [ref]$p)) { return $p } return $null }
function TypeOf($e) { try { return ($e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '') } catch { return '?' } }

function Info($e) {
  $c = $e.Current
  $o = [ordered]@{ type = (TypeOf $e); name = $c.Name; id = $c.AutomationId; class = $c.ClassName; enabled = $c.IsEnabled }
  $p = Pat $e ([System.Windows.Automation.RangeValuePattern]::Pattern)
  if ($p) { $r = $p.Current; $o.value = $r.Value; $o.min = $r.Minimum; $o.max = $r.Maximum; $o.step = $r.SmallChange; $o.readOnly = $r.IsReadOnly }
  else {
    $p = Pat $e ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($p) { $o.value = $p.Current.Value; $o.readOnly = $p.Current.IsReadOnly }
  }
  $p = Pat $e ([System.Windows.Automation.TogglePattern]::Pattern)
  if ($p) { $o.toggle = "$($p.Current.ToggleState)" }
  $p = Pat $e ([System.Windows.Automation.SelectionPattern]::Pattern)
  if ($p) { $o.selected = @($p.Current.GetSelection() | ForEach-Object { $_.Current.Name }) -join ', ' }
  $p = Pat $e ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($p) { $o.isSelected = $p.Current.IsSelected }
  $p = Pat $e ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  if ($p) { $o.expanded = "$($p.Current.ExpandCollapseState)" }
  if (Pat $e ([System.Windows.Automation.InvokePattern]::Pattern)) { $o.press = $true }
  return $o
}

function Line($o) {
  $s = "$($o.type) ""$($o.name)"""
  if ($o.id) { $s += " id=$($o.id)" }
  if ($null -ne $o.min) { $s += " value=$($o.value) range=$($o.min)..$($o.max) step=$($o.step)" }
  elseif ($null -ne $o.value -and "$($o.value)" -ne '') { $s += " value=""$($o.value)""" }
  if ($o.toggle) { $s += " toggle=$($o.toggle)" }
  if ($o.Contains('selected') -and $o.selected) { $s += " selected=""$($o.selected)""" }
  if ($o.isSelected) { $s += ' (selected)' }
  if ($o.expanded) { $s += " $($o.expanded)" }
  if ($o.press) { $s += ' [press]' }
  if ($o.readOnly) { $s += ' [read-only]' }
  if (-not $o.enabled) { $s += ' [disabled]' }
  if ($o.name -match $Forbidden -or $o.id -match $Forbidden) { $s += ' [REFUSED: never touched]' }
  return $s
}

# ---- the window ---------------------------------------------------------------------------------------------------
$procNames = @{}
function ProcName([int]$id) {
  if (-not $procNames.ContainsKey($id)) { $n = ''; try { $n = (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch {}; $procNames[$id] = $n }
  return $procNames[$id]
}
function TopWindows() {
  $all = $A::RootElement.FindAll($TS::Children, $TrueCond)
  $r = @()
  foreach ($w in $all) { try { $c = $w.Current; $r += [pscustomobject]@{ el = $w; title = $c.Name; pid = $c.ProcessId; proc = (ProcName $c.ProcessId); class = $c.ClassName } } catch {} }
  return $r
}
function FindWindow() {
  if (-not $Window -and -not $ProcessId) { Fail 2 'say which window: -Window <part of its title or its process name> (or -ProcessId n); `windows` lists them' }
  $wins = TopWindows
  if ($ProcessId) { $wins = @($wins | Where-Object { $_.pid -eq $ProcessId }) }
  if ($Window) {
    $exact = @($wins | Where-Object { $_.title -eq $Window -or $_.proc -eq ($Window -replace '\.exe$', '') })
    if ($exact.Count) { $wins = $exact } else { $wins = @($wins | Where-Object { $_.title -and $_.title.IndexOf($Window, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }
  }
  $wins = @($wins | Where-Object { $_.title })   # an app's untitled helper windows are never the one meant
  if (-not $wins.Count) { Fail 2 "no window matches ""$Window$(if ($ProcessId) { " pid $ProcessId" })"": is the app open (not only in the tray)? ``windows`` lists them" }
  if ($wins.Count -gt 1) {
    $msg = "several windows match ""$Window"": " + (($wins | ForEach-Object { """$($_.title)"" ($($_.proc) pid $($_.pid))" }) -join '; ') + '. Use a longer title part or -ProcessId.'
    Fail 2 $msg
  }
  return $wins[0]
}

# Chromium (Electron, CEF, WebView2) builds its accessibility tree only once a UI Automation client asks for it, and
# fills it in over a second or two: ask, then wait until the count of controls stops growing.
function Descendants($w) { return $w.FindAll($TS::Descendants, $TrueCond) }
function WakeWeb($win) {
  $hosts = $win.el.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Chrome_RenderWidgetHostHWND')))
  $isWeb = $hosts.Count -gt 0 -or $win.class -like 'Chrome_WidgetWin*'
  if (-not $isWeb) { return @{ web = $false } }
  foreach ($h in $hosts) { try { [void]$h.FindFirst($TS::Children, $TrueCond); [void]$h.Current.Name } catch {} }
  $t0 = Get-Date; $last = -1; $stable = 0; $count = 0
  while (((Get-Date) - $t0).TotalMilliseconds -lt $WaitMs) {
    $count = (Descendants $win.el).Count
    if ($count -eq $last -and $count -gt 12) { $stable++; if ($stable -ge 2) { break } } else { $stable = 0 }
    $last = $count
    Start-Sleep -Milliseconds 400
  }
  $webCount = 0
  foreach ($h in $hosts) { try { $webCount += $h.FindAll($TS::Descendants, $TrueCond).Count } catch {} }
  return @{ web = $true; hosts = $hosts.Count; webControls = $webCount; waited = [int]((Get-Date) - $t0).TotalMilliseconds }
}
$EmptyAdvice = 'This window shows UI Automation no controls inside its page. Chromium/Electron apps (G HUB, Synapse, GG, iCUE 5 web parts) ' +
  'build that tree only for an accessibility client; some never do unless started with --force-renderer-accessibility, or while a screen ' +
  'reader runs. Do not change Windows settings or restart the app for this without the person''s yes: fall back to asking them to change the setting.'

# ---- finding a control --------------------------------------------------------------------------------------------
function IsInside($child, $parent, $root) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $p = $walker.GetParent($child)
  while ($p -and -not [System.Windows.Automation.Automation]::Compare($p, $root)) {
    if ([System.Windows.Automation.Automation]::Compare($p, $parent)) { return $true }
    $p = $walker.GetParent($p)
  }
  return $false
}
function FindControl($win) {
  if (-not $Name) { Fail 2 'say which control: -Name <its name or automation id> (`list` shows them)' }
  $all = Descendants $win.el
  $byName = @(); $byId = @(); $byPart = @()
  foreach ($e in $all) {
    try { $c = $e.Current } catch { continue }
    if ($Type -and (TypeOf $e) -ne $Type) { continue }
    if ($c.Name -eq $Name) { $byName += $e } elseif ($c.AutomationId -eq $Name) { $byId += $e }
    elseif ($c.Name -and $c.Name.IndexOf($Name, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $byPart += $e }
  }
  $found = $byName; if (-not $found.Count) { $found = $byId }; if (-not $found.Count) { $found = $byPart }
  if (-not $found.Count) {
    $msg = "no control named ""$Name""$(if ($Type) { " of type $Type" }) in ""$($win.title)"""
    if ($script:wake.web -and $script:wake.webControls -lt 3) { $msg += ". $EmptyAdvice" }
    Fail 2 $msg
  }
  if ($Index -gt 0) {
    if ($Index -gt $found.Count) { Fail 2 "-Index $Index but only $($found.Count) control(s) match ""$Name""" }
    return $found[$Index - 1]
  }
  if ($found.Count -gt 1) {
    # a combo box and the list or edit inside it often share its name: keep the outermost
    $outer = @($found | Where-Object { $e = $_; -not ($found | Where-Object { -not [System.Windows.Automation.Automation]::Compare($_, $e) -and (IsInside $e $_ $win.el) }) })
    if ($outer.Count -eq 1) { return $outer[0] }
    $i = 0
    $msg = "$($found.Count) controls match ""$Name"": " + (($found | ForEach-Object { $i++; "$i) $(Line (Info $_))" }) -join '; ') + '. Add -Index n or -Type.'
    Fail 2 $msg
  }
  return $found[0]
}

function Guard($e, [string]$what) {
  $c = $e.Current
  if ($c.Name -match $Forbidden -or $c.AutomationId -match $Forbidden) {
    Fail 4 "REFUSED: ""$($c.Name)"" ($(TypeOf $e), id=$($c.AutomationId)) looks like a firmware/update/reset/delete control; DeviceHub never presses those. Nothing was $what."
  }
  if ($Value -and $Value -match $Forbidden) { Fail 4 "REFUSED: the value ""$Value"" looks like a firmware/update/reset/delete choice. Nothing was $what." }
}

# ---- actions ------------------------------------------------------------------------------------------------------
function Truthy([string]$v) {
  switch -regex ($v.Trim().ToLower()) { '^(on|true|1|yes|checked|selected)$' { return $true } '^(off|false|0|no|unchecked)$' { return $false } }
  Fail 2 "-Value ""$v"" is not on or off"
}
function Settle() { Start-Sleep -Milliseconds 350 }

function SetRange($e, $p) {
  $target = 0.0
  if (-not [double]::TryParse($Value, [System.Globalization.NumberStyles]::Float, $Inv, [ref]$target)) { Fail 2 "-Value ""$Value"" is not a number" }
  $r = $p.Current; $old = $r.Value
  if ($target -lt $r.Minimum -or $target -gt $r.Maximum) { Fail 2 "$Value is outside this slider's range $($r.Minimum)..$($r.Maximum); nothing was set" }
  $how = 'set'
  if (-not $r.IsReadOnly) {
    try { $p.SetValue($target) } catch { if (-not $UseKeys) { Fail 1 "the slider refused the value: $($_.Exception.Message). Try again with -UseKeys." } }
    Settle
  }
  $new = $p.Current.Value
  if ([math]::Abs($new - $target) -gt 1e-6 -and $UseKeys) { $how = 'moved with the arrow keys'; $new = KeySlide $e $p $target }
  elseif ($r.IsReadOnly) { Fail 1 "the slider is read-only to UI Automation (value $old); nothing was set. Try again with -UseKeys." }
  $tag = "$(TypeOf $e) ""$($e.Current.Name)"""
  if ([math]::Abs($new - $target) -gt 1e-6) { Fail 1 "$tag $how`: $old -> $new, but $target was asked for (read back $new)" }
  Write-Output "$tag $how`: $old -> $new (read back $new)"
}

function KeySlide($e, $p, [double]$target) {
  try { $e.SetFocus() } catch { Fail 1 "could not give the slider the keyboard focus ($($_.Exception.Message)); nothing was typed" }
  Start-Sleep -Milliseconds 200
  for ($i = 0; $i -lt 400; $i++) {
    $now = $p.Current.Value
    if ([math]::Abs($now - $target) -le 1e-6) { return $now }
    $focused = $A::FocusedElement
    if (-not $focused -or -not [System.Windows.Automation.Automation]::Compare($focused, $e)) { Fail 1 "the slider lost the keyboard focus at $now; stopped typing" }
    $key = if ($now -lt $target) { '{RIGHT}' } else { '{LEFT}' }
    [System.Windows.Forms.SendKeys]::SendWait($key)
    Start-Sleep -Milliseconds 60
    $after = $p.Current.Value
    if ($after -eq $now) { Fail 1 "an arrow key did not move the slider (stuck at $now); stopped" }
    if (($now -lt $target -and $after -gt $target) -or ($now -gt $target -and $after -lt $target)) { return $after }   # steps jump over it
  }
  return $p.Current.Value
}

function ItemNames($root) {
  $items = $root.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
  return @($items)
}
function FindItem($root, [string]$text) {
  foreach ($it in (ItemNames $root)) { try { if ($it.Current.Name -eq $text) { return $it } } catch {} }
  return $null
}
function ReadChoice($e) {
  $sp = Pat $e ([System.Windows.Automation.SelectionPattern]::Pattern)
  if ($sp) { $sel = @($sp.Current.GetSelection() | ForEach-Object { $_.Current.Name }) -join ', '; if ($sel) { return $sel } }
  $vp = Pat $e ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($vp) { return $vp.Current.Value }
  return ''
}
function SetChoice($e, $win) {
  $old = ReadChoice $e
  $item = FindItem $e $Value
  $ec = Pat $e ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  $opened = $false
  if (-not $item -and $ec) {
    $ec.Expand(); $opened = $true
    $t0 = Get-Date
    while (-not $item -and ((Get-Date) - $t0).TotalMilliseconds -lt 2500) {
      Start-Sleep -Milliseconds 200
      $item = FindItem $e $Value
      if (-not $item) { $item = FindItem $win.el $Value }   # web pages often draw the open list elsewhere in the page
    }
  }
  if (-not $item) {
    $names = @(ItemNames $e | ForEach-Object { $_.Current.Name }) -join '", "'
    if ($opened) { try { $ec.Collapse() } catch {} }
    $offers = ''; if ($names) { $offers = ': it offers "' + $names + '"' }
    Fail 2 ("no choice ""$Value"" in $(TypeOf $e) ""$($e.Current.Name)""" + $offers + '; nothing was changed')
  }
  if ($item.Current.Name -match $Forbidden) { if ($opened) { try { $ec.Collapse() } catch {} }; Fail 4 "REFUSED: the choice ""$($item.Current.Name)"" looks like a firmware/update/reset/delete action. Nothing was changed." }
  $si = Pat $item ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($si) { $si.Select() }
  elseif (Pat $item ([System.Windows.Automation.InvokePattern]::Pattern)) { [void](InvokeWithin $item 5000) }
  else { Fail 1 "the choice ""$Value"" can be neither selected nor pressed" }
  Settle
  if ($opened) { try { if ((Pat $e ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)).Current.ExpandCollapseState -ne 'Collapsed') { $ec.Collapse() } } catch {} }
  $new = ReadChoice $e
  $tag = "$(TypeOf $e) ""$($e.Current.Name)"""
  if ($new -ne $Value) { Fail 1 "$tag selected ""$Value"": ""$old"" -> ""$new"", which is not what was asked (read back ""$new"")" }
  Write-Output "$tag selected: ""$old"" -> ""$new"" (read back ""$new"")"
}

function SetToggle($e, $p) {
  $want = Truthy $Value
  $old = "$($p.Current.ToggleState)"
  $wanted = if ($want) { 'On' } else { 'Off' }
  for ($i = 0; $i -lt 3 -and "$($p.Current.ToggleState)" -ne $wanted; $i++) { $p.Toggle(); Settle }
  $new = "$($p.Current.ToggleState)"
  $tag = "$(TypeOf $e) ""$($e.Current.Name)"""
  if ($new -ne $wanted) { Fail 1 "$tag toggled: $old -> $new, but $wanted was asked for (read back $new)" }
  if ($old -eq $new) { Write-Output "$tag was already $new; nothing pressed (read back $new)" } else { Write-Output "$tag toggled: $old -> $new (read back $new)" }
}

function SetText($e, $p) {
  if ($p.Current.IsReadOnly) { Fail 1 "$(TypeOf $e) ""$($e.Current.Name)"" is read-only; nothing was set" }
  $old = $p.Current.Value
  $p.SetValue($Value); Settle
  $new = $p.Current.Value
  $tag = "$(TypeOf $e) ""$($e.Current.Name)"""
  if ($new -ne $Value) { Fail 1 "$tag set: ""$old"" -> ""$new"", but ""$Value"" was asked for (read back ""$new"")" }
  Write-Output "$tag set: ""$old"" -> ""$new"" (read back ""$new"")"
}

function DoSet($e, $win) {
  if ($null -eq $Value -or $Value -eq '') { Fail 2 'say the new value: -Value <v>' }
  Guard $e 'changed'
  if (-not $e.Current.IsEnabled) { Fail 1 "$(TypeOf $e) ""$($e.Current.Name)"" is disabled; nothing was set" }
  $t = TypeOf $e
  $p = Pat $e ([System.Windows.Automation.TogglePattern]::Pattern); if ($p) { SetToggle $e $p; return }
  $p = Pat $e ([System.Windows.Automation.RangeValuePattern]::Pattern); if ($p) { SetRange $e $p; return }
  if ($t -eq 'ComboBox' -or $t -eq 'List' -or (Pat $e ([System.Windows.Automation.SelectionPattern]::Pattern))) { SetChoice $e $win; return }
  $p = Pat $e ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($p) {
    if (-not (Truthy $Value)) { Fail 2 "a $t can only be selected (-Value on), not unselected" }
    $old = $p.Current.IsSelected; $p.Select(); Settle; $new = $p.Current.IsSelected
    if (-not $new) { Fail 1 "$t ""$($e.Current.Name)"" select: selected $old -> $new (read back $new)" }
    Write-Output "$t ""$($e.Current.Name)"" selected: $old -> $new (read back $new)"; return
  }
  $p = Pat $e ([System.Windows.Automation.ValuePattern]::Pattern); if ($p) { SetText $e $p; return }
  Fail 1 "$t ""$($e.Current.Name)"" has no value, choice or switch UI Automation can set (try ``click``, or ask the person)"
}

function DoClick($e) {
  Guard $e 'pressed'
  $t = TypeOf $e; $n = $e.Current.Name
  if (-not $e.Current.IsEnabled) { Fail 1 "$t ""$n"" is disabled; nothing was pressed" }
  if (Pat $e ([System.Windows.Automation.InvokePattern]::Pattern)) {
    $r = InvokeWithin $e 5000
    if ($r -like 'error*') { Fail 1 "$t ""$n"" press failed: $r" }
    Settle
    $after = try { Line (Info $e) } catch { 'gone from the window' }
    if ($r -eq 'timeout') { Write-Output "pressed $t ""$n"" (the app is still busy after 5 s: it may be showing a dialog); now: $after"; return }
    Write-Output "pressed $t ""$n""; now: $after"; return
  }
  $p = Pat $e ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($p) { $old = $p.Current.IsSelected; $p.Select(); Settle; $new = $p.Current.IsSelected; if (-not $new) { Fail 1 "$t ""$n"" did not become selected" }; Write-Output "selected $t ""$n"": $old -> $new (read back $new)"; return }
  $p = Pat $e ([System.Windows.Automation.TogglePattern]::Pattern)
  if ($p) { $old = "$($p.Current.ToggleState)"; $p.Toggle(); Settle; $new = "$($p.Current.ToggleState)"; if ($new -eq $old) { Fail 1 "$t ""$n"" did not change ($old)" }; Write-Output "toggled $t ""$n"": $old -> $new (read back $new)"; return }
  Fail 1 "$t ""$n"" cannot be pressed through UI Automation (no press, select or toggle); ask the person"
}

function DoList($win) {
  $nodes = New-Object System.Collections.ArrayList
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  function Walk($el, [int]$d) {
    if ($nodes.Count -ge $Max -or $d -gt $Depth) { return }
    $c = $walker.GetFirstChild($el)
    while ($c) {
      if ($nodes.Count -ge $Max) { return }
      try { $o = Info $c; $o.depth = $d; [void]$nodes.Add($o) } catch {}
      Walk $c ($d + 1)
      try { $c = $walker.GetNextSibling($c) } catch { $c = $null }
    }
  }
  Walk $win.el 1
  $script:listCount = $nodes.Count
  if ($Json) { ConvertTo-Json -Depth 4 -InputObject @{ window = $win.title; process = $win.proc; pid = $win.pid; web = $script:wake; controls = @($nodes) }; return }
  Write-Output "window ""$($win.title)"" ($($win.proc) pid $($win.pid), $($win.class))"
  foreach ($o in $nodes) { Write-Output ((' ' * (2 * $o.depth)) + (Line $o)) }
  Write-Output "$($nodes.Count) controls$(if ($nodes.Count -ge $Max) { " (stopped at -Max $Max)" })"
}

# ---- main ---------------------------------------------------------------------------------------------------------
switch ($Command) {
  'windows' {
    foreach ($w in (TopWindows | Where-Object { $_.title } | Sort-Object proc)) { Write-Output """$($w.title)""  $($w.proc) pid $($w.pid)  $($w.class)" }
    exit 0
  }
  { $_ -in 'list', 'get', 'set', 'click' } {
    $win = FindWindow
    $script:wake = WakeWeb $win
    if ($script:wake.web -and -not $Json) { Write-Output "note: Chromium/Electron window: $($script:wake.webControls) controls in its page after $($script:wake.waited) ms" }
    if ($Command -eq 'list') {
      DoList $win
      $n = $script:listCount
      if ($script:wake.web -and $script:wake.webControls -lt 3) { Write-Output $EmptyAdvice; exit 3 }
      if ($n -eq 0) { Write-Output 'the window exposes no controls to UI Automation: ask the person to change the setting'; exit 3 }
      exit 0
    }
    $e = FindControl $win
    if ($Command -eq 'get') { $o = Info $e; if ($Json) { ConvertTo-Json -InputObject $o } else { Write-Output (Line $o) }; exit 0 }
    if ($Command -eq 'set') { DoSet $e $win; exit 0 }
    DoClick $e; exit 0
  }
  default { Fail 2 'usage: app-ui.ps1 windows | list -Window w | get -Window w -Name n | set -Window w -Name n -Value v [-UseKeys] | click -Window w -Name n' }
}
