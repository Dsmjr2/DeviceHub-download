# Publishes DeviceHub's code to the public download repository's "app" branch (21 Oct 2026), so a copy installed on
# someone else's PC can update by merging the new version with the changes made on that PC (helpers/self-update.js).
# One commit per published version and none of this repository's history; the journal and screenshots stay private.
# The zip has always carried the same files. Run by helpers/make-installer.ps1 before it builds; publishes only a
# committed version (prints the app commit, or nothing when it did not publish).
param([string]$Clone = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'DeviceHub-publish'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$url = 'https://github.com/Dsmjr2/DeviceHub-download.git'
# git in the publishing copy; its progress lines on stderr are not errors (Windows PowerShell would stop on them)
# (no param block: every word, -A or -q included, goes to git as it is)
function G { $ErrorActionPreference = 'Continue'; $out = & git -C $Clone @args 2>&1 | ForEach-Object { "$_" }; if ($LASTEXITCODE) { throw "git $($args -join ' '): $out" }; $out }

Push-Location $root
try {
  if (git status --porcelain --untracked-files=no) { Write-Host '   code not published: there are uncommitted changes' -ForegroundColor Yellow; exit 0 }
  $private = (git rev-parse --short=12 HEAD).Trim()
  $files = @(git ls-files | Where-Object { $_ -ne 'JOURNAL.md' -and $_ -notmatch '^public/preview-' -and $_ -notmatch '^screenshots/' })
} finally { Pop-Location }

if (-not (Test-Path (Join-Path $Clone '.git'))) { & git clone -q --no-checkout $url $Clone 2>&1 | Out-Null; if ($LASTEXITCODE) { throw "could not clone $url" } }
G config core.autocrlf false | Out-Null
G fetch -q origin | Out-Null
$hasApp = [bool](& git -C $Clone ls-remote --heads origin app)
if ($hasApp) { G checkout -q -f -B app origin/app | Out-Null } else { G checkout -q --orphan app | Out-Null }
# the branch's files become exactly this version's
& git -C $Clone rm -rq --cached --ignore-unmatch . 2>&1 | Out-Null
Get-ChildItem -LiteralPath $Clone -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
foreach ($f in $files) {
  $from = Join-Path $root $f; $to = Join-Path $Clone $f
  if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { continue }
  New-Item -ItemType Directory -Force (Split-Path $to -Parent) | Out-Null
  Copy-Item -LiteralPath $from $to -Force
}
G add -A | Out-Null
if (G status --porcelain) {
  G commit -q -m "DeviceHub $private" | Out-Null
  G push -q origin app | Out-Null
  Write-Host "   code published: DeviceHub $private"
} else { Write-Host '   code already published' }
(G rev-parse --short=12 HEAD).Trim()
