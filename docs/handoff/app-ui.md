# app-ui: Claude changes the setting in the maker's app itself (22 Oct 2026)

Shawn: "Less asking of 'click this button'". During a learning session (CLAUDE.md, "Adding your own devices" step 3)
the person used to change every setting in the maker's app by hand while `helpers\hs80-learn.ps1` recorded.
`helpers\app-ui.ps1` lets Claude do the clicking through Windows UI Automation, so the person says yes once at the
start of the session and Claude works through the settings one at a time.

New files only: `helpers\app-ui.ps1`, `tests\app-ui.ps1`, this note. Nothing else was edited. It uses Windows' own
`System.Windows.Automation` (in Windows PowerShell 5.1); nothing is downloaded or installed.

## Commands

Run with Windows PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -File helpers\app-ui.ps1 <command> ...`

| Command | What it does |
|---|---|
| `windows` | every open top-level window: title, process name, pid, class (to find the maker's app) |
| `list -Window <title part or process name>` | the window's controls as a tree: type, name, automation id, value and range for sliders, toggle state, selected choice, expanded/collapsed, `[press]`, `[read-only]`, `[disabled]`, `[REFUSED: never touched]` |
| `get -Window ... -Name <name or automation id>` | one control's current state (same fields; `-Json` for machine use) |
| `set -Window ... -Name ... -Value <v>` | a slider or spin box (RangeValue), a list or combo choice (SelectionItem, expanding the list first when needed), a switch or check box (`on`/`off`, Toggle), a text box (Value); then reads it back and prints `old -> new (read back x)` |
| `click -Window ... -Name ...` | presses a button (Invoke), or selects a radio/tab item, or toggles; prints what it pressed and the control's state after |

Options: `-Type Slider|ComboBox|Button|CheckBox|...` narrows the match; `-Index n` picks the n-th of several matches;
`-ProcessId n` picks the window by process; `-Json` (list, get); `-WaitMs` (default 5000) how long a
Chromium/Electron window may take to build its tree; `-UseKeys` lets `set` move a slider that ignores a direct value
with the arrow keys, one press at a time, re-reading after each and stopping the moment the focus is anywhere but that
slider.

Matching: exact name first, then exact automation id, then a name that contains the text. Several matches: a combo
box and the list inside it share a name, so the outermost wins; otherwise it lists the candidates and exits 2.
A window must match exactly one titled top-level window (exact title or process name first, then a title part).

Exit codes: 0 done and read back as asked; 1 the action failed or read back differently (or the control is disabled
or read-only); 2 window/control/choice not found, ambiguous, or a value out of range; 3 the window exposes no
controls; 4 refused for safety.

## Safety refusals

- Any control, or list choice, whose name or automation id contains **firmware, update, reset, factory, flash,
  bootloader, delete or format** is never set or pressed (exit 4, "REFUSED: ... Nothing was pressed/changed"); `list`
  marks them `[REFUSED: never touched]`. A `-Value` containing those words is refused too. Matching is a plain
  substring, on purpose broad: "Device information" is refused too (it contains "format"). Change that setting by hand.
- Never writes a disabled or read-only control, never sets a slider outside its own range, never picks a choice the
  list does not offer (it names the choices it has instead).
- Every `set` reads back; a read-back that differs from the request is exit 1, the same rule as device writes.
- `click` gives up waiting after 5 s if the app opens a dialog, and says so (the press happened; look before going on).
- It only reads other windows' titles (`windows`, and to find `-Window`); it acts on the one window named.

## The real test result

`powershell -NoProfile -ExecutionPolicy Bypass -File tests\app-ui.ps1` makes its own stand-in "maker's app": a
WinForms window with a DPI TrackBar (100..3200, step 100, at 800), a Polling rate ComboBox (125/500/1000 Hz and a
"Factory reset" choice), an Angle snapping CheckBox, a disabled Sleep mode CheckBox, a Lift-off distance TextBox, and
Apply and Firmware update buttons, all named. The window does not take the focus, is not in the taskbar, sits in the
bottom-right corner of the second screen (off-screen when there is only one) and is killed when the checks end (it
closes itself after 40 s regardless). The stand-in writes its controls' values to a temp file ten times a second, so
every change is checked from the app's side as well as from app-ui's read-back. No other app's window is touched.

Result on 22 Oct 2026, Shawn's PC (two screens, the test window on DISPLAY2): **`app-ui (stand-in window): all good`**,
24 s (the window is open for about 22 of them; each app-ui call starts a PowerShell, about 1.3 s). 24 checks: the window started; list
shows every control with its state; get by name and by automation id (JSON); set the slider 800 -> 1600 (app saw
1600); an out-of-range value refused, nothing moved; set the list to 1000 Hz (app saw it); a missing choice refused,
naming the choices; the "Factory reset" choice refused (exit 4, app unchanged); a switch on, already-on left alone,
off again; the disabled switch not written (exit 1); the text box set; Apply pressed once (app counted 1); Firmware
update refused by name and by automation id (app counted 0 presses); a missing control and a missing window exit 2.

Real output from that window:

```
  Slider "DPI" id=trackDpi value=800 range=100..3200 step=100
  ComboBox "Polling rate" id=comboPoll selected="500 Hz" Collapsed
      ListItem "Factory reset" [REFUSED: never touched]
  CheckBox "Sleep mode" id=checkSleep toggle=Off [disabled]
  Button "Firmware update" id=buttonFw [press] [REFUSED: never touched]
Slider "DPI" set: 800 -> 1600 (read back 1600)
ComboBox "Polling rate" selected: "500 Hz" -> "1000 Hz" (read back "1000 Hz")
REFUSED: "Firmware update" (Button, id=buttonFw) looks like a firmware/update/reset/delete control; DeviceHub never presses those. Nothing was pressed.
```

Found while testing: .NET's managed UI Automation client puts its own stand-in over WinForms windows that shows every
control as a nameless `Pane` with nothing to set. app-ui registers an empty stand-in for `WindowsForms10.*` classes so
Windows reads the controls' own accessibility instead (correct names, types and patterns). This needs a few lines of
C# compiled at start (about 0.5 s); a PowerShell script block in its place fails inside .NET.

Not covered by the test: `-UseKeys` (it needs the test window to take the keyboard focus, which would pull focus onto
Shawn's screen), and Chromium/Electron windows (no maker's app was opened or touched for this job).

## What to expect with Electron and other web-style apps

From how Chromium and the toolkits expose accessibility (not measured on the real apps):

- **Chromium-based apps** (Electron, CEF, WebView2: SteelSeries GG, Razer Synapse 4, Logitech G HUB's web UI, many
  smaller makers' apps) build the accessibility tree of their page only when an accessibility client asks for it, and
  fill it in over a second or so. app-ui asks (it queries the `Chrome_RenderWidgetHostHWND`), then waits until the
  count of controls stops growing (up to `-WaitMs`) and prints `note: Chromium/Electron window: N controls in its page`.
  Recent Chromium (about 126 and later, Electron 31+) answers UI Automation natively; older ones go through Windows'
  MSAA bridge, which still gives names, buttons and values.
- **What comes through**: real HTML controls (`<input type=range>`, `<select>`, checkboxes, buttons) and ARIA ones
  (`role=slider` with `aria-valuenow`, `role=switch`, `role=radio`, `role=listbox`/`option`) show with their patterns.
  Many apps draw "buttons" as plain `div`s with a click handler: those may show as Group/Text, sometimes with a press
  (Chromium's default action), sometimes with nothing usable.
- **ARIA sliders** often show a value but ignore a set from outside (the page's script never hears it): `set` then
  reads back the old value and exits 1. Try again with `-UseKeys` (the arrow keys, which ARIA sliders are meant to
  handle), or ask the person.
- **Dropdowns** drawn by the page usually put their open list somewhere else in the page; app-ui expands the box, then
  looks for the choice in the whole window.
- **Qt apps** (iCUE is a Qt Quick app; some makers' Qt Widgets tools): Qt exposes its controls through its own
  accessibility bridge; standard ones are usually fine, custom-drawn items may appear as plain groups.
- **Nothing exposed** (`list` exits 3, with the advice line): some apps only build the page's tree while a screen
  reader runs or when started with `--force-renderer-accessibility`. Starting Narrator, setting Windows' screen-reader
  flag or restarting the maker's app with a flag are all changes to the person's PC: do not do them without asking;
  the normal answer is **fall back to asking the person to change the setting, as before**.
- Names in these apps are often visible text, not labels ("1600" on a DPI button, an icon-only button with no name).
  Use `list` first and pick by what it shows; use `-Type` and `-Index` when the same text appears twice.

## Lines to add to CLAUDE.md, "Adding your own devices" step 3

Add after the sentence ending "...write down which bytes moved." in step 3:

```
   **Claude changes the setting itself** (22 Oct 2026): at the start of the session ask once, "I'll change the
   settings in <maker's app> myself, one at a time, while it records: OK?" With that yes, open the app (or ask the
   person to), then `powershell -NoProfile -ExecutionPolicy Bypass -File helpers\app-ui.ps1 list -Window '<app>'`
   to find each setting. For each one: start `hs80-learn.ps1 -Name <setting>-<from>-<to>`, wait 3 s, run
   `app-ui.ps1 set -Window '<app>' -Name '<setting>' -Value <to>` (or `click` for an Apply/Save button the app needs),
   wait for the recording to end, then put the old value back the same way, so the device ends as it started. Write
   down app-ui's `old -> new (read back ...)` line beside the capture. app-ui refuses anything named firmware, update,
   reset, factory, flash, bootloader, delete or format, and never presses them: those stay with the person and the
   maker's app. If `list` exits 3 (the app shows UI Automation nothing; common with Electron apps), a `set` exits 1
   (an ARIA slider ignored the value; `-UseKeys` may move it), or a setting is not in the list, fall back to asking
   the person to change that one setting, as before. Never turn on a screen reader, change a Windows setting or
   restart the maker's app with extra flags to make it visible without asking. Details: docs/handoff/app-ui.md.
```

And under "Checks", optionally: `powershell -NoProfile -ExecutionPolicy Bypass -File tests\app-ui.ps1` (Windows only,
about 25 s, opens a small test window on the second screen for that time; it is not part of `npm test`).
