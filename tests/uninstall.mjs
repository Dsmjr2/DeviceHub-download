// Uninstall DeviceHub (helpers/uninstall-plan.mjs, helpers/uninstall.ps1), offline: every task, shortcut, folder and
// Apps entry is a stand-in. Nothing is elevated, stopped or removed; the real script runs only with -DryRun.
// Run: node tests/uninstall.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as un from '../helpers/uninstall-plan.mjs';
import * as wifi from '../helpers/wifi-pause.mjs';
import * as sensors from '../helpers/cpu-sensors.mjs';
import * as board from '../helpers/board-lights.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------- stand-in PC ----------
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-uninstall-'));
const e = { USERPROFILE: path.join(T, 'Users', 'ann'), ProgramFiles: path.join(T, 'PF'), APPDATA: path.join(T, 'Users', 'ann', 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(T, 'Users', 'ann', 'AppData', 'Local'), TEMP: path.join(T, 'Temp'), SystemRoot: path.join(T, 'Windows'), OneDrive: path.join(T, 'Users', 'ann', 'OneDrive') };
const dir = path.join(e.USERPROFILE, 'DeviceHub');
const files = new Set([path.join(dir, 'server.js'), path.join(dir, 'DeviceHub.vbs'), path.join(dir, 'backups'),
  path.join(e.ProgramFiles, 'DeviceHub sensors'), path.join(e.ProgramFiles, 'DeviceHub Wi-Fi pause'),
  path.join(e.TEMP, 'DeviceHub-downloads'), path.join(e.APPDATA, 'DeviceHub-signing'), path.join(e.USERPROFILE, 'Pictures', 'DeviceHub Wallpapers'),
  path.join(e.LOCALAPPDATA, 'Programs', 'OpenRGB')].map((p) => path.resolve(p).toLowerCase()));
const exists = (p) => files.has(path.resolve(p).toLowerCase());
const startup = path.join(e.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'DeviceHub.lnk');
const desk = path.join(e.USERPROFILE, 'Desktop', 'DeviceHub.lnk');
const facts = {
  tasks: [
    { name: 'DeviceHub sensors', exe: 'powershell.exe', args: '-File "C:\\Program Files\\DeviceHub sensors\\reader.ps1"', dir: '' },
    { name: 'DeviceHub Wi-Fi resume', exe: 'powershell.exe', args: '', dir: '' },
    { name: 'DeviceHub OpenRGB', exe: path.join(e.LOCALAPPDATA, 'Programs', 'OpenRGB', 'OpenRGB.exe'), args: '--server', dir: '' },
    { name: 'DeviceHub memory 24h', exe: 'wscript.exe', args: `"${dir}\\logs\\memory-24h.vbs"`, dir: '' },
    { name: 'DeviceHub of a friend', exe: 'C:\\Tools\\other.exe', args: '', dir: '' },          // named like it, not ours
    { name: 'DeviceHub2 task', exe: 'wscript.exe', args: `"${dir}2\\DeviceHub.vbs"`, dir: '' },  // a sibling folder
  ],
  links: [{ path: startup, target: 'C:\\Windows\\System32\\wscript.exe', args: `"${dir}\\DeviceHub.vbs"`, dir }, { path: desk, target: 'C:\\Other\\app.exe', args: '', dir: 'C:\\Other' }],
  folders: { documents: path.join(e.USERPROFILE, 'Documents'), pictures: path.join(e.USERPROFILE, 'Pictures') },
  apps: { key: 'DeviceHub', location: dir + '\\' },
  installed: ['Equalizer APO', 'PawnIO', 'Some Game'],
  eq: '# Written by DeviceHub (Headset page); DeviceHub replaces this file when its sound settings change.',
};
const uacLog = [JSON.stringify({ at: 'x', area: 'board lights', action: 'install PawnIO', outcome: 'yes' }), JSON.stringify({ action: 'install Equalizer APO', outcome: 'declined' }), 'not json'].join('\n');
const p = un.buildPlan({ dir, facts, exists, uacLog, e });
const rm = (pred) => p.remove.filter(pred);
const names = rm((r) => r.kind === 'task').map((r) => r.name);

// ---------- what is removed: exactly DeviceHub's ----------
check(names.includes('DeviceHub sensors') && names.includes('DeviceHub Wi-Fi resume'), 'the feature tasks that are there are removed');
check(!names.includes('DeviceHub Wi-Fi pause') && !names.includes('DeviceHub board lights'), 'tasks that are not there are not listed');
check(names.includes('DeviceHub OpenRGB') && names.includes('DeviceHub memory 24h'), 'the older DeviceHub task and a task running a file in the folder are removed');
check(!names.includes('DeviceHub of a friend') && !names.includes('DeviceHub2 task'), 'a task only named like DeviceHub, or running a sibling folder, is left alone');
check(p.keep.some((k) => k.what === 'task "DeviceHub of a friend"'), 'the task left alone is said');
check(rm((r) => r.kind === 'folder').map((r) => path.basename(r.path)).sort().join('|') === 'DeviceHub Wi-Fi pause|DeviceHub sensors', 'only the Program Files folders that are there');
check(rm((r) => r.admin).every((r) => ['task', 'folder', 'undo'].includes(r.kind)) && p.admin, 'tasks and Program Files folders need the admin prompt');
check(rm((r) => r.kind === 'undo').length === 1, 'Wi-Fi pause there: the scan is turned back on');
check(p.parts.join('|') === 'wifi|sensors|tasks', `the admin parts in order (got ${p.parts})`);
check(rm((r) => r.kind === 'shortcut').map((r) => r.path).join('|') === startup, 'only shortcuts opening this DeviceHub');
check(p.keep.some((k) => k.what === desk), 'a DeviceHub.lnk that opens something else stays');
check(rm((r) => r.kind === 'apps').length === 1, 'the Apps entry for this folder is removed');
check(un.buildPlan({ dir, facts: { ...facts, apps: { key: 'DeviceHub', location: 'C:\\Elsewhere\\DeviceHub' } }, exists, e }).remove.every((r) => r.kind !== 'apps'), 'an Apps entry for another folder stays');
check(rm((r) => r.kind === 'temp').map((r) => path.basename(r.path)).join('|') === 'DeviceHub-downloads', 'only DeviceHub\'s own temporary files that are there');
check(p.remove[p.remove.length - 1].kind === 'dir' && p.remove[p.remove.length - 1].path === path.resolve(dir), 'the folder itself last');
const removed = p.remove.map((r) => String(r.path || '').toLowerCase());
for (const never of ['DeviceHub-signing', 'DeviceHub Wallpapers', 'DeviceHub backups', 'OneDrive', path.join('Programs', 'OpenRGB')]) check(!removed.some((x) => x.includes(never.toLowerCase())), `never removed: ${never}`);
check(p.keep.some((k) => /DeviceHub-signing/.test(k.what)) && p.keep.some((k) => /backups$/.test(k.what) && /never deleted/.test(k.why)) && p.keep.some((k) => /Wallpapers/.test(k.what)), 'the signing key, backups and wallpapers are listed as kept');

// ---------- other programs, the EQ question ----------
const pawn = p.others.find((o) => o.name === 'PawnIO'), eqo = p.others.find((o) => o.name === 'Equalizer APO');
check(pawn?.byDeviceHub === true && /DeviceHub installed it/.test(pawn.line) && /Settings > Apps/.test(pawn.line), 'PawnIO: installed by DeviceHub (its prompt record), stays, how to remove it');
check(eqo && eqo.byDeviceHub === false && /config\.txt/.test(eqo.line), 'Equalizer APO: a declined install is not "by DeviceHub"; its config is mentioned');
check(!p.others.some((o) => /Some Game|ReaPlugs|USBPcap/.test(o.name)), 'only the optional programs that are installed');
check(p.ask.length === 1 && p.ask[0].id === 'clearEq' && p.ask[0].default === false, 'clearing the EQ is asked, unticked');
check(un.buildPlan({ dir, facts: { ...facts, eq: 'Preamp: -6 dB' }, exists, e }).ask.length === 0, 'the person\'s own EQ config is not offered for clearing');
check(!p.remove.some((r) => /EqualizerAPO|PawnIO|ReaPlugs|USBPcap/i.test(r.what)), 'no other program is removed');

// ---------- the one admin script ----------
const resultDir = path.join(e.TEMP, 'r');
const s = un.adminScript(p, { resultDir });
check(!/^\s*exit /m.test(s), 'no part ends the whole script (exit becomes return)');
check(s.indexOf('wlan set autoconfig') > -1 && s.indexOf('wlan set autoconfig') < s.indexOf(sensors.LHM_PATHS.task), 'the Wi-Fi scan is turned back on first');
for (const [id, mod] of [['wifi', wifi], ['sensors', sensors]]) {
  const own = mod.removeScript({ result: un.resultFile(resultDir, id) });
  check(s.includes(own.split('\r\n').filter((l) => !/^\s*exit /.test(l)).slice(0, 6).join('\r\n')), `the ${id} part is its own tested remove script`);
}
check(!s.includes(board.BOARD.task), 'board lights not set up: not in the script');
check(/@\('DeviceHub OpenRGB', 'DeviceHub memory 24h'\)/.test(s) && !/a friend|DeviceHub2/.test(s), 'the extra tasks by exact name only');
check(!/DeviceHub-signing|\\\.git|\\dist\\|Remove-Item[^\r\n]*Users\\ann\\DeviceHub'/.test(s), 'the script never touches the signing key, .git, dist or the DeviceHub folder');
check(un.adminScript(un.buildPlan({ dir, facts: { tasks: [], links: [] }, exists: (x) => !/PF/.test(x) && exists(x), e }), { resultDir }) === null, 'nothing set up as admin: no prompt');
check(un.asBlock('a\r\n  exit 3\r\nb') === '& {\r\na\r\n  return\r\nb\r\n}', 'asBlock');

// ---------- the folder check ----------
check(un.checkDir(dir, { exists, e }) === null, 'a DeviceHub folder passes');
for (const bad of [e.USERPROFILE, 'C:\\', e.ProgramFiles, path.join(T, 'empty')]) check(un.checkDir(bad, { exists: (x) => exists(x) || /server\.js|DeviceHub\.vbs/.test(x), e }) !== null || bad === path.join(T, 'empty'), `refused: ${bad}`);
check(un.checkDir(path.join(T, 'empty'), { exists, e }) !== null, 'a folder without DeviceHub is refused');
check(un.installedByDeviceHub(uacLog).has('install PawnIO') && !un.installedByDeviceHub(uacLog).has('install Equalizer APO'), 'the prompt log: yes only');

// ---------- the dry-run text ----------
const t = un.text(p, { devCopy: true });
check(/DRY RUN: nothing is changed/.test(t) && /\[admin\] task "DeviceHub sensors"/.test(t) && /Other programs stay/.test(t) && /development copy/.test(t), 'the dry run says what it would do');

// ---------- uninstall.ps1 ----------
const ps1 = fs.readFileSync(path.join(ROOT, 'helpers', 'uninstall.ps1'), 'utf8');
const at = (re) => { const m = re.exec(ps1); return m ? m.index : -1; };
check(at(/if \(\$DryRun\) \{/) > 0 && at(/if \(\$DryRun\) \{/) < at(/if \(\$devCopy\) \{ Say/) && at(/if \(\$DryRun\) \{/) < at(/Remove-Item/), '-DryRun stops before the development-copy refusal and before anything is removed');
check((ps1.match(/-Verb RunAs/g) || []).length === 1 && /-Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'/.test(ps1), 'one hidden admin prompt with Windows\' own PowerShell, the script encoded');
check(at(/-Verb RunAs/) < at(/api\/quit/) && /declined[^\r\n]*exit 4/.test(ps1), 'the admin parts go first; declined, nothing at all is removed');
check(/\$\{d\}window-profile/.test(ps1) && !/CommandLine\.IndexOf\(\$Dir, /.test(ps1), 'only DeviceHub\'s own programs are stopped (its Chrome by its window-profile)');
check(/\$r\.kind -eq 'shortcut' -or \$r\.kind -eq 'temp'/.test(ps1), 'shortcuts and temporary files: exactly the plan\'s');
check(/\$ClearEq -and/.test(ps1) && /Written by DeviceHub\*/.test(ps1), 'Equalizer APO\'s config is emptied only when ticked and DeviceHub wrote it');
check(/Copy-Item -Path \(Join-Path \$b '\*'\) -Destination \$kept/.test(ps1) && !/Remove-Item[^\r\n]*\$kept/.test(ps1), 'backups are copied out and never deleted');
check(/if \(\$devCopy\) \{ Say/.test(ps1), 'a development copy is never removed');

// the real script, dry run only (Windows): prints the plan for this checkout and changes nothing
if (process.platform === 'win32') {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'helpers', 'uninstall.ps1'), '-Dir', ROOT, '-DryRun'], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  check(r.status === 0 && /DRY RUN: nothing is changed/.test(r.stdout || ''), `uninstall.ps1 -DryRun on this checkout: exit ${r.status} ${String(r.stderr || '').slice(0, 200)}`);
  check(fs.existsSync(path.join(ROOT, 'server.js')), 'the dry run removed nothing');
}

fs.rmSync(T, { recursive: true, force: true });
if (fails.length) { console.log(`uninstall: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('uninstall: all checks passed');
process.exit(0);
