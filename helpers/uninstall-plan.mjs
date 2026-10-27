// What "Uninstall DeviceHub" removes, keeps and leaves to the person (27 Oct 2026, Shawn: uninstalling removes
// everything DeviceHub itself added to the PC, and nothing else). helpers/uninstall.ps1 asks this file for the plan
// before it changes anything, and -DryRun prints it and stops.
//
// Every lasting thing DeviceHub makes on a PC, and where it is made:
//   DeviceHub's folder (%USERPROFILE%\DeviceHub), with window-profile\ (its own Chrome profile), runtime\ (Node),
//     tools\ (its OpenRGB), backups\, logs\ ........................................ helpers/install.ps1
//   Desktop and Start menu "DeviceHub.lnk" ............................................ helpers/install.ps1
//   Startup "DeviceHub.lnk" (Settings > Start with Windows) ........................... server.js /api/startup
//   Settings > Apps entry HKCU\...\Uninstall\DeviceHub ................................ helpers/install.ps1
//   C:\Program Files\DeviceHub sensors\ + task "DeviceHub sensors" (admin) ............ helpers/cpu-sensors.mjs
//   C:\Program Files\DeviceHub Wi-Fi pause\ + tasks "DeviceHub Wi-Fi pause" / "... resume" (admin) helpers/wifi-pause.mjs
//   C:\Program Files\DeviceHub board lights\ + task "DeviceHub board lights" (admin) .. helpers/board-lights.mjs
//   task "DeviceHub OpenRGB" running %LOCALAPPDATA%\Programs\OpenRGB\OpenRGB.exe ...... an older DeviceHub (22 Oct
//     2026, docs/handoff/board-lights.md); removed only when it runs exactly that file
//   any other task named "DeviceHub..." that runs a file inside DeviceHub's folder (a test task, logs\memory-24h.vbs)
//   %TEMP%\DeviceHub-downloads\, DeviceHub-openrgb.json, DeviceHub-sensors-want.txt ... installers, OpenRGB, sensors
// Kept, never deleted: backups\ (copied to Documents\DeviceHub backups first), Documents\DeviceHub backups,
// Pictures\DeviceHub Wallpapers, OneDrive\DeviceHub, the signing key (%APPDATA%\DeviceHub-signing, Shawn's PC only),
// settings written to the devices, Corsair's sound effects turned off under Equalizer APO (a fix, backed up in backups\).
// Left to the person: Equalizer APO, ReaPlugs, USBPcap and PawnIO (installed on their click, from DeviceHub or not);
// each is named with where to remove it. Equalizer APO keeps applying the sound settings DeviceHub wrote to its
// config.txt unless the person ticks "clear" (-ClearEq) or empties the file.
// No firewall rule, service, Run key or power plan is made by DeviceHub (grep of the repo, 27 Oct 2026).
//
// node helpers/uninstall-plan.mjs --dir <folder> [--key DeviceHub] [--json | --text] [--result-dir <folder>]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import * as wifi from './wifi-pause.mjs';
import * as sensors from './cpu-sensors.mjs';
import * as board from './board-lights.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const PF = () => env.ProgramFiles || 'C:\\Program Files';
// the admin parts, each removed by its own feature's tested remove script
export const PARTS = {
  wifi: { what: 'Pause Wi-Fi scans while gaming', dir: wifi.WIFI.dir, tasks: [wifi.WIFI.pauseTask, wifi.WIFI.resumeTask], script: (result) => wifi.removeScript({ result }) },
  sensors: { what: 'CPU temperature and fan speeds', dir: sensors.LHM_PATHS.dir, tasks: [sensors.LHM_PATHS.task], script: (result) => sensors.removeScript({ result }) },
  board: { what: 'Board, fan and RAM lights', dir: board.BOARD.dir, tasks: [board.BOARD.task], script: (result) => board.removeScript({ result }) },
};
export const LEGACY_TASK = 'DeviceHub OpenRGB';
export const legacyOpenRGB = (e = env) => path.join(e.LOCALAPPDATA || '', 'Programs', 'OpenRGB');
export const TEMP_ITEMS = ['DeviceHub-downloads', 'DeviceHub-openrgb.json', 'DeviceHub-sensors-want.txt'];
// programs DeviceHub offers to install (helpers/installers.mjs, board-lights.mjs): never removed by DeviceHub
export const THIRD_PARTY = [
  { name: 'Equalizer APO', match: /^Equalizer ?APO/i, action: 'install Equalizer APO' },
  { name: 'ReaPlugs', match: /^ReaPlugs/i, action: 'install ReaPlugs' },
  { name: 'USBPcap', match: /^USBPcap/i, action: 'install USBPcap' },
  { name: 'PawnIO', match: /^PawnIO$/i, action: 'install PawnIO' },
];
export const EQ_MARK = '# Written by DeviceHub';

const norm = (p) => path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
const inside = (text, dir) => String(text || '').toLowerCase().includes(norm(dir) + '\\');
const same = (a, b) => !!a && !!b && norm(a) === norm(b);

// a folder this may plan to delete: DeviceHub's own (server.js and DeviceHub.vbs in it), never a drive, the user
// folder or one of Windows' own
export function checkDir(dir, { exists = fs.existsSync, e = env } = {}) {
  const full = path.resolve(String(dir || ''));
  if (!dir || full.length < 8 || path.parse(full).root.toLowerCase() === (full + '\\').toLowerCase()) return 'not a DeviceHub folder';
  for (const bad of [e.USERPROFILE, e.SystemRoot, e.ProgramFiles, e['ProgramFiles(x86)'], e.APPDATA, e.LOCALAPPDATA, e.TEMP]) if (bad && same(bad, full)) return 'not a DeviceHub folder';
  if (!exists(path.join(full, 'server.js')) || !exists(path.join(full, 'DeviceHub.vbs'))) return `no DeviceHub found in ${full}`;
  return null;
}

// which optional programs DeviceHub's own installers opened (logs\uac-prompts.log, helpers/uac.mjs: the last 200)
export function installedByDeviceHub(logText) {
  const yes = new Set();
  for (const l of String(logText || '').split(/\r?\n/)) { try { const e = JSON.parse(l); if (e.outcome === 'yes' && /^install /.test(e.action)) yes.add(e.action); } catch {} }
  return yes;
}

// facts: { tasks: [{ name, exe, args, dir }], links: [{ path, target, args, dir }], folders: { documents, pictures },
//   apps: { key, location } | null, installed: [DisplayName], eq: first line of Equalizer APO's config.txt | null }
// exists(path), uacLog: logs\uac-prompts.log text, e: environment
export function buildPlan({ dir, key = 'DeviceHub', facts, exists = fs.existsSync, uacLog = '', e = env }) {
  const remove = [], keep = [], ask = [], others = [];
  const full = path.resolve(dir);
  const tasks = Array.isArray(facts?.tasks) ? facts.tasks : [];
  const taskNamed = (n) => tasks.find((t) => t && t.name === n);
  // 1. the admin parts (one Windows prompt for all of them)
  const parts = [];
  for (const [id, p] of Object.entries(PARTS)) {
    const pdir = path.join(e.ProgramFiles || PF(), path.basename(p.dir));
    const there = p.tasks.filter(taskNamed), folder = exists(pdir);
    if (!there.length && !folder) continue;
    parts.push(id);
    for (const t of there) remove.push({ kind: 'task', what: `task "${t}" (${p.what})`, name: t, admin: true, part: id });
    if (folder) remove.push({ kind: 'folder', what: `${pdir} (${p.what})`, path: pdir, admin: true, part: id });
    if (id === 'wifi') remove.push({ kind: 'undo', what: 'Wi-Fi background scan turned back on (in case a pause was left on)', admin: true, part: id });
  }
  const known = new Set(Object.values(PARTS).flatMap((p) => p.tasks));
  const extraTasks = [];
  for (const t of tasks) {
    if (!t || typeof t.name !== 'string' || known.has(t.name)) continue;
    if (t.name === LEGACY_TASK && String(t.exe || '').split('|').every((x) => same(x, path.join(legacyOpenRGB(e), 'OpenRGB.exe')))) {
      extraTasks.push(t.name); remove.push({ kind: 'task', what: `task "${t.name}" (an older DeviceHub's board lights)`, name: t.name, admin: true, part: 'tasks' });
    } else if (/^DeviceHub/i.test(t.name) && [t.exe, t.args, t.dir].some((x) => inside(x, full))) {
      extraTasks.push(t.name); remove.push({ kind: 'task', what: `task "${t.name}" (runs a file in ${full})`, name: t.name, admin: true, part: 'tasks' });
    } else if (/^DeviceHub/i.test(t.name)) keep.push({ what: `task "${t.name}"`, why: 'it does not run anything of this DeviceHub, so it is not DeviceHub\'s to remove' });
  }
  if (extraTasks.length) parts.push('tasks');
  // 2. the person's own parts (no prompt)
  for (const l of Array.isArray(facts?.links) ? facts.links : []) {
    if (l && l.path && [l.target, l.args, l.dir].some((x) => inside(x, full) || same(x, full))) remove.push({ kind: 'shortcut', what: l.path, path: l.path });
    else if (l && l.path) keep.push({ what: l.path, why: 'it does not open this DeviceHub' });
  }
  if (facts?.apps && same(facts.apps.location, full)) remove.push({ kind: 'apps', what: `Settings > Apps entry "${facts.apps.key || key}"`, key: facts.apps.key || key });
  const tmp = e.TEMP || os.tmpdir();
  for (const n of TEMP_ITEMS) { const p = path.join(tmp, n); if (exists(p)) remove.push({ kind: 'temp', what: p, path: p }); }
  remove.push({ kind: 'dir', what: `${full} (DeviceHub itself, its window profile, its Node and OpenRGB, its logs)`, path: full });
  // 3. kept
  const docs = facts?.folders?.documents || path.join(e.USERPROFILE || os.homedir(), 'Documents');
  const pics = facts?.folders?.pictures || path.join(e.USERPROFILE || os.homedir(), 'Pictures');
  if (exists(path.join(full, 'backups'))) keep.push({ what: path.join(full, 'backups'), why: `copied to ${path.join(docs, 'DeviceHub backups')} first; never deleted` });
  // Documents and Pictures as Windows names them (OneDrive may move them) and as helpers/wallpapers.js names them
  const home = e.USERPROFILE || os.homedir(), seen = new Set();
  for (const [p, why] of [[path.join(docs, 'DeviceHub backups'), 'your backups'], [path.join(home, 'Documents', 'DeviceHub backups'), 'your backups'],
    [path.join(pics, 'DeviceHub Wallpapers'), 'your wallpapers'], [path.join(home, 'Pictures', 'DeviceHub Wallpapers'), 'your wallpapers'],
    ...[e.OneDrive, e.OneDriveConsumer, e.OneDriveCommercial].filter(Boolean).map((o) => [path.join(o, 'DeviceHub'), 'your setup copies in OneDrive']),
    [path.join(e.APPDATA || '', 'DeviceHub-signing'), 'the release signing key (never touched)'],
    [legacyOpenRGB(e), 'an OpenRGB an older DeviceHub put there; delete the folder yourself if you do not use it']]) {
    if (seen.has(norm(p)) || !exists(p)) continue;
    seen.add(norm(p)); keep.push({ what: p, why });
  }
  keep.push({ what: 'settings saved on your devices', why: 'they belong to the devices' });
  // 4. other programs: never removed here
  const byHub = installedByDeviceHub(uacLog);
  const names = Array.isArray(facts?.installed) ? facts.installed : [];
  const eqOurs = typeof facts?.eq === 'string' && facts.eq.startsWith(EQ_MARK);
  for (const t of THIRD_PARTY) {
    const shown = names.find((n) => t.match.test(String(n)));
    if (!shown) continue;
    let line = `${t.name} stays installed${byHub.has(t.action) ? ' (DeviceHub installed it on your click)' : ''}. To remove it: Settings > Apps > Installed apps > ${shown} > Uninstall.`;
    if (t.name === 'Equalizer APO' && eqOurs) line += ' It still applies the sound settings DeviceHub wrote: tick "Clear DeviceHub\'s sound settings", or empty C:\\Program Files\\EqualizerAPO\\config\\config.txt.';
    if (t.name === 'PawnIO') line += ' Remove it only if nothing else (OpenRGB, a fan program) uses it.';
    others.push({ name: t.name, byDeviceHub: byHub.has(t.action), line });
  }
  if (eqOurs) ask.push({ id: 'clearEq', what: 'Clear DeviceHub\'s sound settings from Equalizer APO (config.txt emptied; the old file goes to your backups)', default: false });
  return { dir: full, key, remove, keep, ask, others, parts, extraTasks, admin: remove.some((r) => r.admin) };
}

// ---- the one elevated script: each part's own remove script, run in turn as a block ----
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// a remove script ends with exit; as one block of several, it returns instead so the next part still runs
export const asBlock = (script) => `& {\r\n${String(script).replace(/^([ \t]*)exit \d+[ \t]*$/gm, '$1return')}\r\n}`;
export const resultFile = (resultDir, part) => path.join(resultDir, `uninstall-${part}.txt`);
export function tasksScript(names, result) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$result = ${q(result)}`,
    'try {',
    `  foreach ($t in @(${names.map(q).join(', ')})) { if (Get-ScheduledTask -TaskName $t -TaskPath '\\' -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -TaskPath '\\' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $t -TaskPath '\\' -Confirm:$false } }`,
    "  Set-Content -LiteralPath $result -Value 'ok' -Encoding UTF8",
    '  exit 0',
    '} catch {',
    '  Set-Content -LiteralPath $result -Value "failed|$($_.Exception.Message)" -Encoding UTF8 -ErrorAction SilentlyContinue',
    '  exit 3',
    '}',
  ].join('\r\n');
}
export function adminScript(plan, { resultDir }) {
  if (!plan.parts.length) return null;
  const blocks = plan.parts.map((id) => (id === 'tasks' ? tasksScript(plan.extraTasks, resultFile(resultDir, id)) : PARTS[id].script(resultFile(resultDir, id))));
  return blocks.map(asBlock).join('\r\n');
}

// ---- reading this PC (read only): one PowerShell, the Apps key name passed in DH_KEY ----
export const FACTS_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$o = [ordered]@{}',
  "$o.tasks = @(Get-ScheduledTask -TaskPath '\\' | Where-Object { $_.TaskName -like 'DeviceHub*' } | ForEach-Object { [ordered]@{ name = $_.TaskName; exe = (@($_.Actions | ForEach-Object { $_.Execute }) -join '|'); args = (@($_.Actions | ForEach-Object { $_.Arguments }) -join '|'); dir = (@($_.Actions | ForEach-Object { $_.WorkingDirectory }) -join '|') } })",
  "$o.folders = [ordered]@{ documents = [Environment]::GetFolderPath('MyDocuments'); pictures = [Environment]::GetFolderPath('MyPictures') }",
  '$sh = New-Object -ComObject WScript.Shell',
  "$o.links = @(foreach ($f in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $p = Join-Path $f 'DeviceHub.lnk'; if (Test-Path -LiteralPath $p) { $s = $sh.CreateShortcut($p); [ordered]@{ path = $p; target = $s.TargetPath; args = $s.Arguments; dir = $s.WorkingDirectory } } })",
  "$k = Get-ItemProperty -LiteralPath ('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + $env:DH_KEY)",
  '$o.apps = if ($k) { [ordered]@{ key = $env:DH_KEY; location = [string]$k.InstallLocation } } else { $null }',
  "$o.installed = @(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -match '^(Equalizer ?APO|ReaPlugs|USBPcap|PawnIO)' } | ForEach-Object { [string]$_.DisplayName } | Select-Object -Unique)",
  "$cfg = Join-Path $env:ProgramFiles 'EqualizerAPO\\config\\config.txt'",
  '$o.eq = if (Test-Path -LiteralPath $cfg) { [string](Get-Content -LiteralPath $cfg -TotalCount 1) } else { $null }',
  '$o | ConvertTo-Json -Depth 4 -Compress',
].join('\r\n');
export const deps = {
  facts: (key) => new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', FACTS_PS], { windowsHide: true, timeout: 60000, env: { ...env, DH_KEY: key } }, (err, out) => {
    if (err) return reject(err);
    try { resolve(JSON.parse(String(out).replace(/^\uFEFF/, '').trim())); } catch (e) { reject(new Error(`could not read this PC: ${e.message}`)); }
  })),
  exists: (p) => fs.existsSync(p),
  readText: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } },
};
export async function plan({ dir, key = 'DeviceHub', resultDir = path.join(env.TEMP || os.tmpdir(), 'DeviceHub-uninstall') } = {}) {
  const bad = checkDir(dir, { exists: deps.exists });
  if (bad) throw new Error(bad);
  const p = buildPlan({ dir, key, facts: await deps.facts(key), exists: deps.exists, uacLog: deps.readText(path.join(path.resolve(dir), 'logs', 'uac-prompts.log')) });
  const script = adminScript(p, { resultDir });
  return { ...p, resultDir, results: p.parts.map((id) => ({ part: id, file: resultFile(resultDir, id) })), adminScript: script ? Buffer.from(script, 'utf16le').toString('base64') : null };
}

// the dry run, in plain words
export function text(p, { devCopy = false } = {}) {
  const out = [`DeviceHub uninstall, DRY RUN: nothing is changed. Folder: ${p.dir}`];
  if (devCopy) out.push('(This is a development copy with code history: a real uninstall refuses to remove it.)');
  out.push('', `Would remove${p.admin ? ' (Windows asks once, for the [admin] items)' : ''}:`, ...p.remove.map((r) => `  - ${r.admin ? '[admin] ' : ''}${r.what}`));
  out.push('', 'Would keep:', ...p.keep.map((k) => `  - ${k.what}: ${k.why}`));
  if (p.ask.length) out.push('', 'Asks (unticked unless you tick it):', ...p.ask.map((a) => `  - ${a.what}`));
  if (p.others.length) out.push('', 'Other programs stay:', ...p.others.map((o) => `  - ${o.line}`));
  return out.join('\r\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const dir = arg('--dir', ROOT);
  try {
    const p = await plan({ dir, key: arg('--key', 'DeviceHub'), ...(arg('--result-dir') ? { resultDir: arg('--result-dir') } : {}) });
    if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(p));
    else process.stdout.write(text(p, { devCopy: process.argv.includes('--dev-copy') }) + '\r\n');
    process.exit(0);
  } catch (e) { process.stderr.write(`uninstall plan: ${e.message}\n`); process.exit(2); }
}
