// Start-up apps on the PC page (27 Oct 2026, helpers/startup-apps.js): the StartupApproved bytes read as on/off, what
// Task Manager writes to turn one off or on, an HKCU app changed with the person's own rights, an HKLM app through one
// Windows prompt, the key backed up before any write and read back after, and nothing ever deleted. Stand-ins for the
// registry read, reg.exe and the elevation: nothing on this PC is read or written. Run: node tests/startup-apps.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const sa = require('../helpers/startup-apps.js');
const { deps, stateOf, bytesFor, fromRead, adminScript, reset } = sa._test;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-startup-apps-'));
deps.root = root;
const NOW = new Date('2026-10-27T12:00:00Z');
deps.now = () => NOW;
const records = [];
deps.record = (e) => { records.push(e); };

// ---- the bytes ----
check(stateOf('020000000000000000000000').on === true, '02 = on');
check(stateOf('060000000000000000000000').on === true, '06 = on (Windows Security)');
check(stateOf(null).on === true && stateOf('').on === true, 'no value = on');
const off = stateOf('03000000a72fa8a57a5fdd01');
check(off.on === false && /^20\d\d-/.test(off.offSince || ''), '03 = off, with the time it was turned off');
check(stateOf('030000000000000000000000').on === false && stateOf('030000000000000000000000').offSince === null, '03 with no time = off, no date');
check(bytesFor(true) === '02' + '00'.repeat(11), 'on writes 02 and zeros');
const offHex = bytesFor(false, NOW);
check(offHex.length === 24 && offHex.startsWith('03000000') && stateOf(offHex).offSince === NOW.toISOString(), 'off writes 03 and the time now as a FILETIME');

// ---- the list ----
const item = (o) => ({ scope: 'HKCU', key: 'Run', name: 'OneDrive', command: '"C:\\x\\OneDrive.exe" /background', target: 'C:\\x\\OneDrive.exe', args: '', found: true, publisher: 'Microsoft Corporation', description: 'Microsoft OneDrive', approved: '020000000000000000000000', ...o });
let reg = {
  items: [
    item({}),
    item({ name: 'Edge', target: 'C:\\x\\msedge.exe', description: 'Microsoft Edge', approved: '03000000a72fa8a57a5fdd01' }),
    item({ scope: 'HKLM', name: 'SecurityHealth', target: 'C:\\WINDOWS\\system32\\SecurityHealthSystray.exe', description: 'Windows Security notification icon', approved: '060000000000000000000000' }),
    item({ key: 'StartupFolder', name: 'DeviceHub.lnk', target: 'C:\\Windows\\System32\\wscript.exe', args: `"${root}\\DeviceHub.vbs" /background`, publisher: 'Microsoft Corporation', description: 'Microsoft Windows Based Script Host', approved: null }),
    item({ key: 'StartupFolder', name: 'iCUE Launcher - Shortcut.lnk', target: 'C:\\gone\\iCUE Launcher.exe', found: false, publisher: '', description: '', approved: '03000000a884fd686188dc01' }),
    item({ scope: 'HKXX', name: 'bad' }),
  ],
  approvedKeys: { 'HKCU|Run': true, 'HKCU|Run32': false, 'HKCU|StartupFolder': true, 'HKLM|Run': true, 'HKLM|Run32': true, 'HKLM|StartupFolder': true },
  impact: { readable: false, why: 'Attempted to perform an unauthorized operation.', apps: [] },
};
let l = fromRead(reg, NOW);
check(l.total === 5 && l.on === 3, `five apps, three on (${l.on} of ${l.total})`);
const by = (n) => l.apps.find((a) => a.name === n);
check(by('Microsoft OneDrive')?.publisher === 'Microsoft Corporation', 'name and maker from the program');
const self = by('DeviceHub');
check(self && self.self === true && self.publisher === '', "DeviceHub's own entry is named and marked, not 'Microsoft'");
check(by('iCUE Launcher - Shortcut')?.publisher === 'Program not found', 'a shortcut to a removed program says so');
check(by('Windows Security notification icon')?.admin === true, 'an HKLM app is marked as needing admin');
check(l.apps.every((a) => a.impact === '—') && /admins only/.test(l.impact.note), 'unreadable sign-in timing: every impact is "—", one line says why');
const readable = fromRead({ ...reg, impact: { readable: true, apps: [{ file: 'OneDrive.exe', degradeMs: 4200 }, { file: 'msedge.exe', degradeMs: 1200 }, { file: 'SecurityHealthSystray.exe', degradeMs: 300 }] } }, NOW);
const ri = (n) => readable.apps.find((a) => a.name === n).impact;
check(ri('Microsoft OneDrive') === 'High' && ri('Microsoft Edge') === 'Medium' && ri('Windows Security notification icon') === 'Low' && ri('DeviceHub') === 'Not measured' && readable.impact.note === null, 'readable timing: High / Medium / Low only for an app Windows named, else Not measured');

// ---- the cache: one read for two page opens ----
let reads = 0;
const calls = [], scripts = [];
deps.read = async () => { reads++; return JSON.parse(JSON.stringify(reg)); };
deps.run = async (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args[0] === 'export') fs.writeFileSync(args[2], 'Windows Registry Editor Version 5.00\r\n');
  if (args[0] === 'add') { const it = reg.items.find((x) => x.scope === 'HKCU' && args[1].endsWith(`\\${x.key}`) && x.name === args[3]); if (it) it.approved = args[7]; }
  return { code: 0, out: '' };
};
reset();
await sa.list(); await sa.list();
check(reads === 1, 'the list is read once, then kept');

// ---- HKCU: OneDrive off, with the person's own rights ----
let r = await sa.set('HKCU|Run|OneDrive', false);
check(r.ok === true && /off at start-up/.test(r.text), `OneDrive turned off (${r.text})`);
const exp = calls.findIndex((c) => c[1] === 'export'), add = calls.findIndex((c) => c[1] === 'add');
check(exp >= 0 && add > exp, 'the key is backed up before the write');
check(calls[exp][2] === 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', 'the backup is the StartupApproved key');
check(r.backup && fs.existsSync(path.join(root, 'backups', r.backup)), 'the backup file is in backups\\');
check(calls[add].join(' ').includes('/t REG_BINARY /d ' + offHex) && calls[add][4] === 'OneDrive', 'writes 03 + now to that one value');
check(scripts.length === 0, 'HKCU asks Windows for nothing');
check(r.apps.apps.find((a) => a.id === 'HKCU|Run|OneDrive').on === false, 'read back: off');
// on again
calls.length = 0;
r = await sa.set('HKCU|Run|OneDrive', true);
check(r.ok && calls.find((c) => c[1] === 'add')?.includes('02' + '00'.repeat(11)), 'on again writes 02 + zeros');
// already that way: nothing written
calls.length = 0;
r = await sa.set('HKCU|Run|OneDrive', true);
check(r.ok && calls.length === 0, 'already on: nothing written, no backup');
// a write that does not read back is not called done
deps.run = async (cmd, args) => { calls.push([cmd, ...args]); if (args[0] === 'export') fs.writeFileSync(args[2], 'x'); return { code: 0, out: '' }; };
r = await sa.set('HKCU|Run|OneDrive', false);
check(r.ok === false && /did not read back/.test(r.text), 'a value that did not read back says so');
// a backup that was not written stops the change
let wrote = false;
deps.run = async (cmd, args) => { if (args[0] === 'add') wrote = true; return { code: 1, out: 'denied' }; };
let threw = null;
try { await sa.set('HKCU|Run|OneDrive', false); } catch (e) { threw = e.message; }
check(/backup was not written/.test(threw || '') && !wrote, 'no backup, no write');
// an id that is not in the list is refused
threw = null;
try { await sa.set('HKCU|Run|Something else', false); } catch (e) { threw = e.message; }
check(/not in the start-up list/.test(threw || ''), 'only an app in the list can be changed');
deps.run = async (cmd, args) => { calls.push([cmd, ...args]); if (args[0] === 'export') fs.writeFileSync(args[2], 'x'); return { code: 0, out: '' }; };

// ---- HKLM: one Windows prompt; Yes ----
calls.length = 0;
deps.elevate = async (script) => {
  scripts.push(script);
  const m = /Set-Content -LiteralPath '([^']+)'/.exec(script);
  fs.writeFileSync(m[1], 'started');
  reg.items.find((x) => x.name === 'SecurityHealth').approved = offHex;
  return { code: 0 };
};
r = await sa.set('HKLM|Run|SecurityHealth', false);
check(r.ok === true && scripts.length === 1, 'HKLM asks Windows once and is read back');
check(calls.some((c) => c[1] === 'export' && c[2].startsWith('HKLM\\')) && !calls.some((c) => c[1] === 'add'), 'HKLM: backed up first, written only by the admin script');
check(records.at(-1)?.outcome === 'yes' && /turn Windows Security notification icon off/.test(records.at(-1)?.action), 'the prompt is recorded (uac-prompts.log)');
const s = scripts[0];
check(/New-ItemProperty -LiteralPath \$k -Name \$n -PropertyType Binary/.test(s) && s.includes("'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'"), 'the admin script writes only that StartupApproved value');
check(!s.includes('SecurityHealth'), 'the name travels as base64, never as code');
// declined: nothing changed, recorded
reg.items.find((x) => x.name === 'SecurityHealth').approved = '060000000000000000000000';
deps.elevate = async () => ({ error: 'The operation was canceled by the user.', declined: true });
r = await sa.set('HKLM|Run|SecurityHealth', false);
check(r.ok === false && r.uac === 'declined' && records.at(-1)?.outcome === 'declined', 'declined: nothing changed, recorded');
// unanswered within the wait: the late Yes does nothing
deps.uacWaitMs = 30;
deps.elevate = (script, signal) => new Promise((resolve) => { signal.addEventListener('abort', () => resolve({ error: 'aborted' })); });
r = await sa.set('HKLM|Run|SecurityHealth', false);
check(r.ok === false && r.uac === 'unanswered' && records.at(-1)?.outcome === 'unanswered', 'not answered in time: stopped, recorded');
const sc = adminScript('Run', 'x', offHex, { started: 'C:\\s.txt', cancel: 'C:\\c.txt' });
check(sc.indexOf("Test-Path -LiteralPath 'C:\\c.txt'") < sc.indexOf('New-ItemProperty'), 'a cancelled prompt exits before any write');

// ---- never deletes, never tasks or services ----
const src = fs.readFileSync(path.join(here, '..', 'helpers', 'startup-apps.js'), 'utf8');
const ps1 = fs.readFileSync(path.join(here, '..', 'helpers', 'startup-apps-read.ps1'), 'utf8');
check(calls.every((c) => c[0] === 'reg.exe' && ['export', 'add'].includes(c[1])), 'reg.exe only exports and adds');
check(scripts.concat(sc).every((x) => !/Remove-Item|Remove-ItemProperty|reg(\.exe)? delete|schtasks|Set-Service|Stop-Service/i.test(x)), 'the admin script never deletes, never touches tasks or services');
check(!/Remove-ItemProperty|reg\.exe['"]?, \[?['"]delete|schtasks|Register-ScheduledTask|Set-Service|unlinkSync/i.test(src), 'the module never deletes a value, a shortcut or a file');
check(!/Set-Item|New-Item|Remove-Item|reg\.exe|Set-Content|Out-File/i.test(ps1), 'the read script only reads');
try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.join(here, '..', 'helpers', 'startup-apps-read.ps1')}', [ref]$null, [ref]$e); $e.Count`], { windowsHide: true, timeout: 30000 }).toString().trim();
  check(out === '0', `the read script parses (${out} errors)`);
} catch (e) { check(false, `PowerShell parse check did not run: ${e.message}`); }

fs.rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `startup-apps: FAILED: ${fails.join('; ')}` : 'startup-apps (Start-up apps on the PC page): all good');
process.exit(fails.length ? 1 : 0);
