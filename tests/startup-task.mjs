// Start with Windows as a sign-in task (18 Nov 2026, helpers/startup-task.js), offline: no task is made or removed;
// the Task Scheduler calls are stand-ins. Also the uninstaller removes the task without a Windows prompt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as un from '../helpers/uninstall-plan.mjs';

const require = createRequire(import.meta.url);
const st = require('../helpers/startup-task.js');
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

// the task itself
const S = st.ENABLE_PS;
check(st.TASK === 'DeviceHub start', 'the task is "DeviceHub start"');
check(/-AtLogOn -User \$me/.test(S), 'it starts at this person\'s sign-in only');
check(/-RunLevel Limited/.test(S) && !/Highest/.test(S), 'it runs without admin rights');
check(/-Priority 4\b/.test(S), 'it runs at normal priority (a task\'s default 7 is below normal; DeviceHub would inherit it)');
check(/-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/.test(S) && /-DontStopIfGoingOnBatteries/.test(S) && /-AllowStartIfOnBatteries/.test(S), 'no time limit, and it starts and keeps going on battery');
check(/-MultipleInstances IgnoreNew/.test(S), 'never two at once');
check(S.includes(`-Argument ('"' + $vbs + '" /background')`) && S.includes('System32\\wscript.exe'), 'it runs only wscript DeviceHub.vbs /background');
check(/\$env:DH_ROOT/.test(S) && !/[A-Z]:\\\\Users/i.test(S), 'the folder comes in through the environment, never pasted into the script');
check(/-Force/.test(S), 'turning it on again replaces the task (a moved folder)');

// enable / disable / status with stand-ins for schtasks and PowerShell
const calls = [];
let present = false, refuse = false;
st.deps.run = async (file, args, env = {}) => {
  calls.push({ file, args, env });
  if (file === 'schtasks.exe' && args[0] === '/query') return { code: present ? 0 : 1, out: '', err: '' };
  if (file === 'schtasks.exe' && args[0] === '/delete') { present = false; return { code: 0, out: 'SUCCESS', err: '' }; }
  if (file === 'powershell.exe') { if (refuse) return { code: 1, out: '', err: 'Access is denied.\r\nmore' }; present = true; return { code: 0, out: 'OK\r\n', err: '' }; }
  return { code: 1, out: '', err: 'unexpected' };
};
check((await st.status()) === false, 'no task: status false');
const root = path.join(os.tmpdir(), "O'Brien DeviceHub");
let r = await st.enable(root);
check(r.ok && present, 'enable makes the task');
check(calls.at(-1).env.DH_ROOT === path.resolve(root) && !calls.at(-1).args.join(' ').includes("O'Brien"), 'a folder with an apostrophe goes through DH_ROOT only');
check((await st.status()) === true, 'then status is true');
r = await st.disable();
check(r.ok && !present && calls.some((c) => c.args[0] === '/delete' && c.args.includes('DeviceHub start') && c.args.includes('/f')), 'disable removes exactly that task');
const before = calls.length;
r = await st.disable();
check(r.ok && !calls.slice(before).some((c) => c.args[0] === '/delete'), 'disable with no task removes nothing');
refuse = true;
r = await st.enable(root);
check(!r.ok && r.error === 'Access is denied.' && !present, `a refused task says why (server.js then keeps the shortcut) (${r.error})`);

// the uninstaller: the person's own task goes without the admin prompt; another folder's stays
const dir = path.join(os.tmpdir(), 'dh-st', 'Users', 'ann', 'DeviceHub');
const facts = { tasks: [{ name: 'DeviceHub start', exe: 'C:\\Windows\\System32\\wscript.exe', args: `"${dir}\\DeviceHub.vbs" /background`, dir }], links: [], folders: {}, apps: null, installed: [], eq: null };
const exists = (p) => path.resolve(p).toLowerCase() === path.resolve(dir, 'server.js').toLowerCase() || path.resolve(p).toLowerCase() === path.resolve(dir).toLowerCase();
const p = un.buildPlan({ dir, facts, exists, e: { USERPROFILE: path.dirname(dir), TEMP: os.tmpdir(), ProgramFiles: 'C:\\PF-none', LOCALAPPDATA: 'C:\\LA-none', APPDATA: 'C:\\AD-none' } });
const t = p.remove.find((x) => x.name === 'DeviceHub start');
check(t && t.kind === 'usertask' && !t.admin, `the uninstaller removes "DeviceHub start" without admin (${JSON.stringify(t)})`);
check(!p.parts.includes('tasks') && !p.admin, 'and asks Windows for nothing because of it');
const other = un.buildPlan({ dir, facts: { ...facts, tasks: [{ ...facts.tasks[0], args: '"C:\\Elsewhere\\DeviceHub.vbs" /background', dir: 'C:\\Elsewhere' }] }, exists, e: { USERPROFILE: path.dirname(dir), TEMP: os.tmpdir(), ProgramFiles: 'C:\\PF-none', LOCALAPPDATA: 'C:\\LA-none', APPDATA: 'C:\\AD-none' } });
check(!other.remove.some((x) => x.name === 'DeviceHub start'), 'a "DeviceHub start" task for another folder stays');
const ps1 = fs.readFileSync(new URL('../helpers/uninstall.ps1', import.meta.url), 'utf8');
check(/\$r\.kind -eq 'usertask'\) \{ & schtasks\.exe \/delete \/tn \$r\.name \/f/.test(ps1), 'uninstall.ps1 removes a usertask with schtasks, no prompt');

// server.js: the route keeps the shortcut as the fallback, and an old shortcut moves over once at start
const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const order = (...parts) => { let at = 0; for (const p of parts) { const i = srv.indexOf(p, at); if (i < 0) return false; at = i + p.length; } return true; };
check(order('const r = await task.enable(ROOT);', 'if (r.ok) { if (fs.existsSync(STARTUP_LNK)) fs.unlinkSync(STARTUP_LNK); }', '[startup] the sign-in task could not be made', 'await makeShortcut(STARTUP_LNK); }'),'turning it on makes the task, and the shortcut only when the task is refused');
check(/await task\.disable\(\);\s*if \(fs\.existsSync\(STARTUP_LNK\)\) fs\.unlinkSync\(STARTUP_LNK\);/.test(srv), 'turning it off removes both');
check(order("if (!target.toLowerCase().includes(path.join(ROOT, 'DeviceHub.vbs').toLowerCase())) return;", 'const r = await task.enable(ROOT);', '[startup] kept the Startup folder shortcut', 'return; }', 'try { fs.unlinkSync(STARTUP_LNK); } catch {}'),'the move at start: only a shortcut to this DeviceHub, removed only after the task was made');
check(/if \(!TEST && !ISOLATED\) setTimeout\(\(\) => \{ startupToTask\(\)/.test(srv), 'never in a test or isolated copy');

if (problems.length) { console.log(`startup-task: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('startup-task (sign-in task: own, normal priority, fallback shortcut, move at start, uninstall without prompt): all good');
