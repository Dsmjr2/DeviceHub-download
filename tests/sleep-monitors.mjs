// Monitors > Sleep (helpers/sleep-monitors.ps1, 3 Nov 2026): on a PC with S3 sleep the screens get Windows' monitor-off
// message as before; on a Modern Standby PC (where that message is the whole PC going to standby: Shawn's laptop) the
// screens are blanked instead and the PC kept running, the panel's brightness saved, lowered and put back, and nothing
// sent that could turn the display off or the PC to standby. Checked on the script's text, plus Windows' own answer
// about this PC (-Probe, read only). Run: node tests/sleep-monitors.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const ps = fs.readFileSync(path.join(ROOT, 'helpers/sleep-monitors.ps1'), 'utf8').replace(/\r\n/g, '\n');
const body = ps.slice(ps.indexOf('try {\n  Start-Sleep'));
const s3 = body.slice(0, body.indexOf('# Modern Standby: blank'));
const modern = body.slice(body.indexOf('# Modern Standby: blank'));

ok(/if \(-not \[DhDisplayPower\]::ModernStandby\(\)\) \{\s*\[DhDisplayPower\]::Off\(\)/.test(s3), 'S3 sleep: the monitor-off message, as before');
ok(!/::Off\(\)/.test(modern), 'Modern Standby: the monitor-off message is never sent');
ok(/KeepOn\(\$true\)/.test(modern) && /KeepOn\(\$false\)/.test(modern) && /0x80000003u/.test(ps), 'Modern Standby: Windows told the display and the system are in use while blanked, then let go');
ok(/TopMost = \$true/.test(modern) && /Screen\]::AllScreens/.test(modern) && /Cursor\]::Hide/.test(modern), 'a black topmost window on every screen, the cursor hidden');
ok(/Set-Panel \$p\.Instance 0/.test(modern) && /Set-Panel \$p\.Instance \$p\.Was/.test(modern) && /finally \{/.test(modern), 'the panel to its lowest, and back to exactly what it was (in finally)');
ok(/Set-Content -Path \$keep/.test(modern) && /\$Restore/.test(ps), 'the brightness before is kept on disk until put back, and -Restore puts it back');
ok(/LastInput\(\) -eq \$start/.test(modern), 'any key, move, click or touch ends it');
ok(!/D6|0xd6|SetVCPFeature|monitors\.cs/i.test(ps.replace(/^\s*#.*$/gm, '')), 'monitor power over DDC/CI is never sent');
ok(/b\[20\] != 0/.test(ps), 'Modern Standby from GetPwrCapabilities (AoAc)');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
ok(/sleep-monitors-brightness\.json/.test(server) && /'-Restore'/.test(server), 'DeviceHub puts a cut-short blank\'s brightness back at its start');

// this PC's answer, read only (Windows' own power capabilities)
try {
  const kind = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'helpers/sleep-monitors.ps1'), '-Probe'], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
  ok(['modern', 's3'].includes(kind), `-Probe answers modern or s3 (${kind})`);
} catch (e) { fails.push(`-Probe did not run: ${e.message.split('\n')[0]}`); }

if (fails.length) { console.log(`sleep-monitors: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('sleep-monitors (S3: monitor-off message; Modern Standby: blanked, PC kept running, brightness put back): all good');
