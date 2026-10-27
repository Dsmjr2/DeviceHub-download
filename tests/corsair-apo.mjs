// Corsair's old sound effects under Equalizer APO (27 Oct 2026, helpers/corsair-apo.js): the check flags only the
// headset's active devices Equalizer APO is on whose PreMixChild / PostMixChild is a Corsair effect, and only with iCUE
// gone; the fix asks Windows once, records the answer and reports the elevated script's result. Stand-ins for the
// registry read and the elevation: nothing is elevated, no registry value is read or written. Run: node tests/corsair-apo.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ca = require('../helpers/corsair-apo.js');
const { deps, fromRead, files, reset } = ca._test;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-corsair-apo-'));
deps.root = root;
const records = [];
deps.record = (e) => { records.push(e); };

const SPK = '{d0b128fe-b947-446a-a8d9-459a160b3bbf}', MIC = '{bf6c2ff5-0f00-4247-b349-95236c330b6e}';
const corsairIn = { clsid: '{0f532764-01a1-4e0c-90d7-ada476f65d35}', name: 'Corsair Gaming Headset Drivers APOLFX Input Class', dll: 'C:\\WINDOWS\\system32\\CorsairGamingAudioPO64.dll' };
const corsairOut = { clsid: '{d2a93a2b-19e0-43e5-98f5-dbdc2492edb0}', name: 'Corsair Gaming Headset Drivers APOLFX Output Class', dll: 'C:\\WINDOWS\\system32\\CorsairGamingAudioPO64.dll' };
// a different Corsair id, found by its file only: not a hardcoded list
const corsairOther = { clsid: '{11111111-2222-3333-4444-555555555555}', name: '', dll: 'C:\\Program Files\\Corsair\\x\\fx.dll' };
const other = { clsid: '{C9453E73-8C5C-4463-9984-AF8BAB2F5447}', name: 'Realtek effects', dll: 'C:\\WINDOWS\\system32\\RtkApo.dll' };
const row = (o) => ({ flow: 'Render', guid: SPK, state: '1', on: true, name: 'HS80 Wireless', child: true, pre: null, post: null, ...o });
const guids = { render: [SPK], capture: [MIC] };

// ---- the check ----
const before = { icue: false, rows: [row({ pre: corsairOut, post: corsairOther }), row({ flow: 'Capture', guid: MIC, pre: corsairIn })] };
let r = fromRead(before);
check(r.flagged.length === 2 && r.flagged[0].flow === 'playback' && r.flagged[1].flow === 'recording', 'the speaker and the mic are both flagged');
check(r.flagged[0].effects.map((e) => e.slot).join() === 'PreMixChild,PostMixChild', 'a Corsair effect is found by its name or by its file');
check(fromRead({ icue: false, rows: [row({}), row({ flow: 'Capture', guid: MIC })] }).flagged.length === 0, 'already fixed (empty values): nothing is flagged (Shawn\'s PC)');
check(fromRead({ ...before, icue: true }).flagged.length === 0, 'iCUE installed: nothing is flagged');
check(fromRead({ icue: false, rows: [row({ pre: other })] }).flagged.length === 0, 'another maker\'s effect is left alone');
check(fromRead({ icue: false, rows: [row({ pre: corsairOut, state: '4' })] }).flagged.length === 0, 'a device Windows does not use now is not flagged');
check(fromRead({ icue: false, rows: [row({ pre: corsairOut, on: false })] }).flagged.length === 0, 'a device Equalizer APO is not on is not flagged');
check(fromRead(null).flagged.length === 0, 'a failed read flags nothing');

let reads = 0, state = before;
deps.read = async (list) => { reads++; check(list.every(([f, g]) => /^(Render|Capture)$/.test(f) && /^\{[0-9a-f-]{36}\}$/i.test(g)), 'only checked device ids reach the read'); return state; };
reset();
check((await ca.check({ render: ['not a guid; rm -rf'], capture: [] })).flagged.length === 0 && reads === 0, 'a bad id is never read');
await ca.check(guids); await ca.check(guids);
check(reads === 1, 'the check is cached between page reads');

// ---- the fix: Yes, the script reports ok, the values read back empty ----
let asked = null;
deps.elevate = async (env) => {
  asked = env;
  fs.writeFileSync(env.DH_STARTED, 'started');
  fs.writeFileSync(env.DH_RESULT, '\uFEFFok|3|corsair-apo-a.reg;corsair-apo-b.reg');
  state = { icue: false, rows: [row({}), row({ flow: 'Capture', guid: MIC })] };
  return { code: 0 };
};
reset();
r = await ca.fix(guids);
check(r.ok && /Fixed/.test(r.text) && r.corsairApo.flagged.length === 0, 'Yes: fixed, and the check reads clean afterwards');
check(asked && asked.DH_GUIDS === `${SPK},${MIC}`, 'only the flagged devices are passed to the script');
check(asked && path.basename(asked.DH_SCRIPT) === 'corsair-apo-fix.ps1' && asked.DH_SCRIPT.startsWith(path.join(here, '..', 'helpers')), 'the script is DeviceHub\'s own file, not one in TEMP');
check(asked && asked.DH_BACKUPS === path.join(root, 'backups') && asked.DH_RESULT.startsWith(path.join(root, 'logs')), 'backups and the result go into DeviceHub\'s own folders');
check(records.at(-1)?.outcome === 'yes', 'the Yes is recorded like every Windows prompt');

// nothing flagged: no prompt at all
let prompted = false;
deps.elevate = async () => { prompted = true; return { code: 0 }; };
reset();
r = await ca.fix(guids);
check(r.ok && !prompted, 'nothing to fix: Windows is not asked');

// declined
state = before;
deps.elevate = async () => ({ error: 'This command cannot be run due to the error: The operation was canceled by the user.', declined: true });
reset();
r = await ca.fix(guids);
check(!r.ok && r.uac === 'declined' && records.at(-1)?.outcome === 'declined', 'declined: said and recorded');

// the script failed (the backup could not be written)
deps.elevate = async (env) => { fs.writeFileSync(env.DH_STARTED, 'started'); fs.writeFileSync(env.DH_RESULT, 'failed|the backup of x was not written'); return { code: 3 }; };
reset();
r = await ca.fix(guids);
check(!r.ok && /backup/.test(r.text), 'a failed script says why');

// not answered: the cancel file is written so a late Yes does nothing
deps.uacWaitMs = 30;
deps.elevate = (env, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ error: 'aborted' })));
reset();
r = await ca.fix(guids);
check(!r.ok && r.uac === 'unanswered' && fs.existsSync(files().cancel) && records.at(-1)?.outcome === 'unanswered', 'not answered: the wait stops, a late Yes is cancelled');

// ---- the elevated script itself: what it may touch (read as text and parsed, never run) ----
const fix = fs.readFileSync(path.join(here, '..', 'helpers', 'corsair-apo-fix.ps1'), 'utf8');
const sets = [...fix.matchAll(/Set-ItemProperty[^\r\n]*/g)].map((m) => m[0]);
check(sets.length === 1 && /-Name \$n -Value ''/.test(sets[0]), 'the script only ever sets a value to empty');
check(/@\('PreMixChild', 'PostMixChild'\)/.test(fix) && !/Remove-Item|Remove-ItemProperty|New-ItemProperty/.test(fix), 'only PreMixChild / PostMixChild, nothing removed or added');
check(!/MMDevices/i.test(fix), 'the script never names MMDevices');
check(fix.indexOf('reg.exe export') > 0 && fix.indexOf('reg.exe export') < fix.indexOf('Set-ItemProperty') && /was not written/.test(fix), 'each key is exported to backups and checked before any change');
check(/Restart-Service -Name Audiosrv/.test(fix) && /if \(\$Cancel -and \(Test-Path/.test(fix), 'restarts Windows Audio; a cancelled prompt does nothing');
check(/-Verb RunAs -WindowStyle Hidden/.test(ca._test.ELEVATE), 'one hidden elevated PowerShell');
const read = fs.readFileSync(path.join(here, '..', 'helpers', 'corsair-apo-read.ps1'), 'utf8');
check(!/Set-Item|New-Item|Remove-Item|reg\.exe|Restart-Service/.test(read), 'the check script only reads');
// both scripts parse (PowerShell's own parser; nothing runs)
try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$n = 0; foreach ($f in '${path.join(here, '..', 'helpers', 'corsair-apo-fix.ps1')}','${path.join(here, '..', 'helpers', 'corsair-apo-read.ps1')}') { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e); $n += $e.Count }; $n`], { windowsHide: true, timeout: 30000 }).toString().trim();
  check(out === '0', `both scripts parse (${out} errors)`);
} catch (e) { check(false, `PowerShell parse check did not run: ${e.message}`); }

fs.rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `corsair-apo: FAILED: ${fails.join('; ')}` : "corsair-apo (Corsair's old sound effects under Equalizer APO): all good");
process.exit(fails.length ? 1 : 0);
