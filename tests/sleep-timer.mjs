// "Sleep after" on the Laptop page (helpers/sleep-timer.js, helpers/sleep-timer.ps1, /api/sleep): reads first, backs up,
// writes one value from the list, reads back, keeps Undo; never anything else. Run: node tests/sleep-timer.mjs
// (a pretend Windows: nothing on this PC is changed)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sleepLabel } from '../public/pages/laptop.js';

const require = createRequire(import.meta.url);
const { create, CHOICES, label } = require('../helpers/sleep-timer.js');
const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

// a pretend Windows: the plan's two values; `stuck` makes a write not take
function fakeWindows(state) {
  const calls = [];
  const run = async (args = []) => {
    calls.push(args);
    if (args[0] === '-Ac' && !state.stuck) state.ac = Number(args[1]);
    if (args[0] === '-Dc' && !state.stuck) state.dc = Number(args[1]);
    if (args[0] === '-ScreenAc' && !state.stuck) state.screenAc = Number(args[1]);
    if (args[0] === '-ScreenDc' && !state.stuck) state.screenDc = Number(args[1]);
    return { ok: true, plan: 'p', ac: state.ac, dc: state.dc, screenAc: state.screenAc, screenDc: state.screenDc, battery: state.battery !== false };
  };
  return { run, calls };
}

{
  const w = { ac: 1200, dc: 600 };
  const win = fakeWindows(w);
  const backups = [], logs = [];
  const t = create({ run: win.run, backupDir: 'B', writeFile: (f, x) => backups.push([f, JSON.parse(x)]), log: (e) => logs.push(e) });
  const r0 = await t.read();
  ok(r0.ok && r0.ac === 1200 && r0.dc === 600 && r0.undo === null && r0.choices.includes(0), 'reads both values, nothing to undo yet');
  const r1 = await t.change('ac', 3600);
  ok(r1.ac === 3600 && w.ac === 3600 && w.dc === 600, 'plugged in set to 1 h; on battery untouched');
  ok(backups.length === 1 && backups[0][1].ac === 1200 && backups[0][1].dc === 600 && /sleep-.*\.json$/.test(backups[0][0]), 'the old values were backed up first');
  ok(win.calls[win.calls.length - 2].length === 0 && win.calls[win.calls.length - 1].join(' ') === '-Ac 3600', 'read just before the one write');
  ok(r1.undo && r1.undo.which === 'ac' && r1.undo.value === 1200, 'Undo holds what it replaced');
  ok(logs.some((l) => l.kind === 'good' && /20 min → 1 h/.test(l.text)), 'the change is in Activity');
  const r2 = await t.revert();
  ok(r2.ac === 1200 && r2.undo === null, 'Undo puts 20 min back and is used up');
  let threw = null; try { await t.revert(); } catch (e) { threw = e; }
  ok(threw && threw.code === 400, 'nothing to undo twice');
  const n = win.calls.length;
  const same = await t.change('dc', 600);
  ok(same.dc === 600 && win.calls.length === n + 1, 'the value it already has: read, nothing written');
  for (const [which, v] of [['ac', 1234], ['ac', -1], ['xx', 600], ['dc', 'never']]) {
    let e = null; try { await t.change(which, v); } catch (x) { e = x; }
    ok(e && e.code === 400, `refused: ${which} = ${v}`);
  }
  await t.change('dc', 0);
  ok(w.dc === 0, 'Never is 0');
  w.stuck = true;
  let e = null; try { await t.change('ac', 300); } catch (x) { e = x; }
  ok(e && /reads 20 min after setting 5 min/.test(e.message) && logs.some((l) => l.kind === 'bad'), 'a write that does not read back is reported as failed');
}
// one change at a time
{
  const w = { ac: 1200, dc: 600 };
  let release;
  const slow = async (args = []) => { if (args.length) await new Promise((r) => { release = r; }); if (args[0] === '-Ac') w.ac = Number(args[1]); return { ok: true, ac: w.ac, dc: w.dc, battery: false }; };
  const t = create({ run: slow });
  const first = t.change('ac', 600);
  await new Promise((r) => setTimeout(r, 5));
  let e = null; try { await t.change('ac', 900); } catch (x) { e = x; }
  ok(e && e.code === 409, 'a second change waits its turn (refused while the first runs)');
  release(); await first;
}
ok(label(0) === 'Never' && label(3600) === '1 h' && label(1200) === '20 min', 'Activity labels');
ok(sleepLabel(0) === 'Never' && sleepLabel(3600) === '1 hour' && sleepLabel(7200) === '2 hours' && sleepLabel(300) === '5 min', 'page labels');
ok(CHOICES.every((v) => Number.isInteger(v) && v >= 0) && CHOICES.includes(0), 'the list: whole seconds, with Never');

const ps = fs.readFileSync(path.join(REAL, 'helpers/sleep-timer.ps1'), 'utf8');
ok(/29f6c1db-86da-48c5-9fdb-f2b67b1f44da/.test(ps) && [...new Set(ps.match(/PowerWrite\w+/g))].sort().join() === 'PowerWriteACValueIndex,PowerWriteDCValueIndex'
  && (ps.match(/new Guid\(/g) || []).length === 4 && /3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e/.test(ps), 'the script writes only the sleep and screen-off timeouts');
// the screen's own timeout (3 Nov 2026), on a desktop too
{
  const w = { ac: 1200, dc: 600, screenAc: 600, screenDc: 300, battery: false };
  const win = fakeWindows(w);
  const backups = [], logs = [];
  const t = create({ run: win.run, backupDir: 'B', writeFile: (f, x) => backups.push(JSON.parse(x)), log: (e) => logs.push(e) });
  const r0 = await t.read();
  ok(r0.screenAc === 600 && r0.screenDc === 300 && r0.battery === false, 'reads the screen-off timeouts; a desktop says it has no battery');
  const r1 = await t.change('screenAc', 900);
  ok(r1.screenAc === 900 && w.ac === 1200 && backups[0].screenAc === 600 && logs.some((l) => /Screen off after \(plugged in\): 10 min → 15 min/.test(l.text)), 'screen off after 15 min, backed up, the sleep timeout untouched');
  const r2 = await t.revert();
  ok(r2.screenAc === 600, 'Undo puts the screen back to 10 min');
  let e = null; try { await t.change('screen', 600); } catch (x) { e = x; } ok(e?.code === 400, 'an unknown one is refused');
}
ok(!/RunAs|powercfg|hibernate|Set-ItemProperty|reg add/i.test(ps.replace(/^#.*$/gm, '')), 'no elevation, no powercfg, no hibernate or registry writes');
const server = fs.readFileSync(path.join(REAL, 'server.js'), 'utf8');
ok(/\/api\/sleep\/undo/.test(server) && /sleep-timer'\)\.create\(\{ backupDir: BACKUPS/.test(server), 'the routes back up to backups\\');
// a laptop: Windows' plan settings as a 2x2 grid, read again on focus and every 10 s, the Modern Standby hint (3 Nov 2026)
const rows = fs.readFileSync(path.join(REAL, 'public/ui/power-rows.js'), 'utf8');
ok(/line\('Turn off the display', 'screenDc', 'screenAc'\)/.test(rows) && /line\('Put the computer to sleep', 'dc', 'ac'\)/.test(rows) && /'On battery'\), h\('div', \{ class: 'pg-head' \}, 'Plugged in'\)/.test(rows), 'the grid: both settings, On battery and Plugged in');
ok(/addEventListener\('focus', again\)/.test(rows) && /Date\.now\(\) - st\.at > 10000/.test(rows), 'read again when the window comes back and every 10 s, so a change in Windows shows');
ok(/s\.modernStandby\s*\?/.test(rows) && /\$out\.modernStandby = \[DhSleep2\]::ModernStandby\(\)/.test(ps), 'the Modern Standby hint from GetPwrCapabilities');

if (fails.length) { console.log(`sleep-timer: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('sleep-timer (Sleep after on the Laptop page: read, back up, one write from the list, read back, Undo): all good');
