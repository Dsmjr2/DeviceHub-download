# Builds helpers\bin\DeviceHubHelper.exe with Windows' own C# compiler (.NET Framework 4.8; nothing downloaded).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Force (Join-Path $root 'bin') | Out-Null
$src = 'native\helper.cs', 'native\hs80io.cs', 'native\tray.cs', 'native\winbrand.cs','hidio.cs', 'audio.cs', 'audio-topology.cs', 'audio-default.cs', 'audio-apps.cs', 'mic-rec.cs', 'mic-guard.cs', 'monitors.cs', 'camera.cs', 'pointer.cs' | ForEach-Object { Join-Path $root $_ }
& $csc /nologo /optimize+ /platform:x64 /target:exe "/out:$(Join-Path $root 'bin\DeviceHubHelper.exe')" /r:System.Web.Extensions.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll @src
exit $LASTEXITCODE
