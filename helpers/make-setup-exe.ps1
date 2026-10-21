# Builds dist\DeviceHub-Setup.exe (20 Oct 2026): one file to download and double-click, made with Windows' own
# IExpress (nothing downloaded). It holds dist\DeviceHub-setup.zip (build that first: helpers/make-installer.ps1) and
# helpers/setup-starter.ps1, which unzips it and runs the usual installer. Not code-signed: Windows SmartScreen shows
# "Windows protected your PC" until a certificate is bought (More info > Run anyway).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'
$zip = Join-Path $dist 'DeviceHub-setup.zip'
if (-not (Test-Path $zip)) { throw 'dist\DeviceHub-setup.zip is missing: run helpers/make-installer.ps1 first' }
$work = Join-Path $env:TEMP 'DeviceHub-iexpress'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory $work | Out-Null
Copy-Item $zip (Join-Path $work 'DeviceHub-setup.zip')
Copy-Item (Join-Path $PSScriptRoot 'setup-starter.ps1') (Join-Path $work 'setup-starter.ps1')
$exe = Join-Path $dist 'DeviceHub-Setup.exe'
if (Test-Path $exe) { Remove-Item $exe -Force }
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exe
FriendlyName=DeviceHub Setup
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File setup-starter.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
[SourceFiles]
SourceFiles0=$work\
[SourceFiles0]
%FILE0%=
%FILE1%=
[Strings]
FILE0="DeviceHub-setup.zip"
FILE1="setup-starter.ps1"
"@
# IExpress reads one [Strings] section: put the file names into it
$sed = $sed -replace "\[Strings\]\r?\n\[SourceFiles\]", "[SourceFiles]"
$sedFile = Join-Path $work 'DeviceHub.sed'
Set-Content $sedFile $sed -Encoding ASCII
$p = Start-Process "$env:WINDIR\System32\iexpress.exe" -ArgumentList '/N', '/Q', $sedFile -Wait -PassThru -WindowStyle Hidden
if (-not (Test-Path $exe)) { throw "IExpress did not build the exe (exit $($p.ExitCode))" }
Remove-Item $work -Recurse -Force
"built $exe ($([math]::Round((Get-Item $exe).Length / 1MB, 1)) MB)"
