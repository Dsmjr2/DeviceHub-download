' DeviceHub's memory every 10 minutes for 24 hours, into logs\memory-24h.csv (27 Oct 2026, the 24-hour leak test).
' Run by the scheduled task "DeviceHub memory 24h" through wscript, so no window opens. Reads /api/health only.
Option Explicit
Dim fs, http, csv, line, t
Set fs = CreateObject("Scripting.FileSystemObject")
csv = fs.GetParentFolderName(WScript.ScriptFullName) & "\memory-24h.csv"
If Not fs.FileExists(csv) Then fs.CreateTextFile(csv).WriteLine "time,uptimeS,serverMB,heapMB,helperMB,windowMB"
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 5000, 5000, 20000, 20000
http.open "GET", "http://127.0.0.1:5577/api/health", False
http.send
t = http.responseText
If Err.Number <> 0 Then t = ""
On Error GoTo 0
line = Now & "," & Pick(t, "uptimeS") & "," & Pick(t, "serverMB") & "," & Pick(t, "heapMB") & "," & Pick(t, "helperMB") & "," & Pick(t, "windowMB")
fs.OpenTextFile(csv, 8, True).WriteLine line

Function Pick(s, key)
  Dim i, j
  Pick = ""
  i = InStr(s, """" & key & """:")
  If i = 0 Then Exit Function
  i = i + Len(key) + 3
  j = i
  Do While j <= Len(s) And InStr(",}", Mid(s, j, 1)) = 0
    j = j + 1
  Loop
  Pick = Mid(s, i, j - i)
End Function
