' DeviceHub launcher. Starts the background server (devices, auto-switch, tray icon) with no console window if it is
' not already running, then opens DeviceHub as its own app window in Chrome (falls back to Edge).
' With /background (used by "Start with Windows") it only starts the server and tray icon.
' With /serve (started by this launcher itself) it runs the server and keeps it running: if the server crashes it is
' started again after 3 s, at most 5 times in 10 minutes (19 Oct 2026). A normal Quit, or a server that finds
' DeviceHub already running, exits with code 0 and is not restarted.
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
dir = fs.GetParentFolderName(WScript.ScriptFullName)
background = False
serve = False
For Each a In WScript.Arguments
  If LCase(a) = "/background" Then background = True
  If LCase(a) = "/serve" Then serve = True
Next

' Is DeviceHub already answering on its port? (then a second watchdog has nothing to do)
Function Running()
  On Error Resume Next
  Running = False
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 1000, 1000, 1000, 1000
  x.Open "GET", "http://127.0.0.1:5577/api/version", False
  x.Send
  If Err.Number = 0 Then
    ' DeviceHub itself answers (another program on the port would answer differently)
    If x.Status = 200 And InStr(x.responseText, """version""") > 0 Then Running = True
  End If
  Err.Clear
End Function

' How many DeviceHub windows are open (0 when DeviceHub is not running yet)
Function WindowsOpen()
  On Error Resume Next
  WindowsOpen = 0
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 1000, 1000, 1000, 1000
  x.Open "GET", "http://127.0.0.1:5577/api/windows", False
  x.Send
  If Err.Number = 0 Then
    If x.Status = 200 Then
      p = InStr(x.responseText, """open"":")
      If p > 0 Then
        n = 0: i = p + 7
        Do While i <= Len(x.responseText) And IsNumeric(Mid(x.responseText, i, 1))
          n = n * 10 + CInt(Mid(x.responseText, i, 1)): i = i + 1
        Loop
        WindowsOpen = n
      End If
    End If
  End If
  Err.Clear
End Function

' Node.js: the copy shipped in runtime\ when there is one (the hand-off installer), else the one installed on the PC
nodeExe = "node"
If fs.FileExists(dir & "\runtime\node.exe") Then nodeExe = """" & dir & "\runtime\node.exe"""

' The keep-running loop is helpers\keep-running.bat in a hidden cmd (20 Oct 2026: ~4 MB instead of this script host's
' ~25 MB). /serve, from older shortcuts, starts it the same way.
keep = "cmd /c """"" & dir & "\helpers\keep-running.bat"""""
If serve Then
  sh.Run keep, 0, False
  WScript.Quit
End If

sh.Run keep, 0, False
If background Then WScript.Quit

' A DeviceHub window already open (it keeps a live-update stream to the server): bring it to the front instead of
' opening a second one (20 Oct 2026: six restarts had left six windows, ~440 MB)
If WindowsOpen() > 0 Then
  If sh.AppActivate("DeviceHub") Then WScript.Quit
End If

' Wait for DeviceHub to answer (its first start builds its helper: a few seconds). If it does not within 20 s, say
' why in plain words instead of opening a window onto nothing (20 Oct 2026); the reason is the last "[start]" line
' of server.log when the server wrote one (e.g. its port taken by another program)
WScript.Sleep 1200
For i = 1 To 19
  If Running() Then Exit For
  WScript.Sleep 1000
Next
If Not Running() Then
  reason = "It did not start within 20 seconds."
  logFile = dir & "\server.log"
  ' only this start's lines: a log written in the last minute
  If fs.FileExists(logFile) Then If DateDiff("s", fs.GetFile(logFile).DateLastModified, Now) > 60 Then logFile = ""
  If logFile <> "" Then
    Set lf = fs.OpenTextFile(logFile, 1)
    Do While Not lf.AtEndOfStream
      ln = lf.ReadLine
      If InStr(ln, "[start]") = 1 Then reason = Mid(ln, 9)
    Loop
    lf.Close
  End If
  MsgBox "DeviceHub could not start." & vbCrLf & vbCrLf & reason & vbCrLf & vbCrLf & "Details: " & dir & "\server.log", vbExclamation, "DeviceHub"
  WScript.Quit
End If
chrome =sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
If Not fs.FileExists(chrome) Then chrome = sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe"
If Not fs.FileExists(chrome) Then chrome = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
' Opens maximized (Shawn, 19 Oct 2026: "opens full screen").
' Its own small Chrome profile (window-profile\): an app window in the main profile takes the title bar colour from
' Shawn's Chrome theme (blue). Installed as an app there (one click, 19 Oct 2026), the window uses the app's exact
' colour; until then it opens as a plain app window. Nothing from the main profile is used.
' No extensions and no Chrome component downloads in this window (19 Oct 2026): Adobe's and others were loading
' into it, and Chrome's AI models and lists had grown the profile to 221 MB; DeviceHub needs none of them.
' Light window (20 Oct 2026, for the laptop): DeviceHub opens as an app window in the Chrome already running, which
' shares Chrome's own processes (measured: +182 MB instead of ~550 MB for a Chrome of its own; same engine, same
' speed). Its title bar then follows the Chrome theme. settings.json "lightWindow" true / false (Settings > Startup,
' per PC, never synced); when it is not set, a PC with a battery (a laptop) uses it.
light = False
lightSet = False
If fs.FileExists(dir & "\settings.json") Then
  txt = fs.OpenTextFile(dir & "\settings.json", 1).ReadAll
  If InStr(txt, """lightWindow"": true") > 0 Or InStr(txt, """lightWindow"":true") > 0 Then light = True: lightSet = True
  If InStr(txt, """lightWindow"": false") > 0 Or InStr(txt, """lightWindow"":false") > 0 Then light = False: lightSet = True
End If
If Not lightSet Then
  On Error Resume Next
  Set bats = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT * FROM Win32_Battery")
  n = 0
  n = bats.Count
  If n > 0 Then light = True
  Err.Clear
  On Error GoTo 0
End If
If light Then
  sh.Run """" & chrome & """" & " --app=http://localhost:5577/ --start-maximized", 1, False
  WScript.Quit
End If
profile = dir & "\window-profile"
appId = "gbcckkpijkfkcllfaiefimkinkmpohlk"
If fs.FolderExists(profile & "\Default\Web Applications\Manifest Resources\" & appId) Then
  sh.Run """" & chrome & """" & " --user-data-dir=""" & profile & """ --no-first-run --no-default-browser-check --hide-crash-restore-bubble --disable-extensions --disable-component-update --start-maximized --app-id=" & appId, 1, False
Else
  sh.Run """" & chrome & """" & " --user-data-dir=""" & profile & """ --no-first-run --no-default-browser-check --hide-crash-restore-bubble --disable-extensions --disable-component-update --app=http://localhost:5577/ --start-maximized", 1, False
End If
