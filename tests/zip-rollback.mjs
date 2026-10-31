// A zip or Setup.exe update can go back (31 Oct 2026; only git copies could): install.ps1 keeps the app's code in
// backups\pre-update and writes data\update-rollback.txt = "files:backups\pre-update" before it copies; keep-running.bat
// copies that folder back over the app when the new version stops on start before it has run well for a minute
// (self-update.js confirm() removes the marker after that minute). Checked by hand on 31 Oct 2026 in a folder named
// "dh copy & test!x": a server.js that stopped at once was put back and the old one answered. Run: node tests/zip-rollback.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const install = fs.readFileSync(path.join(ROOT, 'helpers', 'install.ps1'), 'utf8').replace(/\r\n/g, '\n');
const bat = fs.readFileSync(path.join(ROOT, 'helpers', 'keep-running.bat'), 'latin1').replace(/\r\n/g, '\n');
const selfUpdate = fs.readFileSync(path.join(ROOT, 'helpers', 'self-update.js'), 'utf8');

const keepAt = install.indexOf("$pre = Join-Path $Target 'backups\\pre-update'"), copyAt = install.indexOf('Get-ChildItem $Source -Force | Where-Object { $keep -notcontains $_.Name }');
ok(keepAt > 0 && copyAt > keepAt, 'the version before is kept before the new one is copied');
ok(/\$code = 'public', 'helpers', 'device-library'/.test(install) && /-not \$_\.PSIsContainer -or \$code -contains \$_\.Name/.test(install), "only the app's code is kept (top files and its code folders), not this PC's data or added files");
ok(/\$keep -notcontains \$_\.Name -and/.test(install.slice(keepAt, copyAt)), "this PC's own files (data, logs, backups...) are never in it");
ok(/Set-Content -LiteralPath \(Join-Path \$Target 'data\\update-rollback\.txt'\) -Value 'files:backups\\pre-update'/.test(install), 'the marker names the folder');
ok(/catch \{ Write-Host "   the version before could not be kept/.test(install), 'a failure to keep it is said, and the update goes on');
ok(/if "!old:~0,6!"=="files:" \(\n\s+robocopy "!old:~6!" \. \/E \/IS \/IT/.test(bat), 'the launcher puts the folder back over the app');
const rb = bat.indexOf('if defined rb ('), files = bat.indexOf('if "!old:~0,6!"=="files:"'), git = bat.indexOf('git reset --quiet --keep');
ok(rb > 0 && files > rb && git > files && /del \/q !rb!/.test(bat.slice(rb, files)), 'before the git way back, and the marker is removed first (it goes back once)');
ok(/dataFile\('update-rollback\.txt', ROOT\)/.test(selfUpdate) && /setTimeout\(\(\) => \{ try \{ fs\.unlinkSync\(f\)/.test(selfUpdate), 'a version that runs well for a minute removes the marker (confirm)');

if (fails.length) { console.log(`zip-rollback: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('zip-rollback (a zip or Setup.exe update keeps the version before and goes back to it when the new one stops on start): all good');
