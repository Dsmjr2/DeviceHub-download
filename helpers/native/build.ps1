# Builds helpers\bin\DeviceHubHelper.exe with Windows' own C# compiler (.NET Framework 4.8; nothing downloaded).
# -Out <file>: build to another file instead (helpers/make-installer.ps1 builds the installer's copy there, so the
# helper this folder runs is never replaced). The source list is also in helpers/helper-sources.js: keep them the same.
param([string]$Out = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not $Out) { $Out = Join-Path $root 'bin\DeviceHubHelper.exe' }
New-Item -ItemType Directory -Force (Split-Path $Out -Parent) | Out-Null
$src = 'native\helper.cs', 'native\hs80io.cs', 'native\tray.cs', 'native\winbrand.cs','hidio.cs', 'audio.cs', 'audio-topology.cs', 'audio-default.cs', 'audio-apps.cs', 'mic-rec.cs', 'mic-guard.cs', 'monitors.cs', 'camera.cs', 'pointer.cs' | ForEach-Object { Join-Path $root $_ }
& $csc /nologo /optimize+ /platform:x64 /target:exe "/out:$Out" /r:System.Web.Extensions.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll @src
exit $LASTEXITCODE
