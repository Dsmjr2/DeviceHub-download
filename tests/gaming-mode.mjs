// Gaming mode, the one switch for the PC (helpers/gaming-mode.mjs, /api/gaming-mode, the PC page's card): Best
// performance, sleep never, Wi-Fi scans paused (only if set up), instant replay on; every value kept BEFORE it changes
// and put back on Off or on the next start. Run: node tests/gaming-mode.mjs (stand-ins: nothing on this PC changes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGamingMode } from '../helpers/gaming-mode.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

function pc({ mode = 'balanced', plans = null, sleepAc = 1200, wifiSetUp = true, scans = 'on', obs = true, replayOn = false } = {}) {
  const w = { mode, plan: plans?.active, sleepAc, scans, replayOn, stored: null, backups: [], logs: [], calls: [] };
  const parts = {
    power: { get: async () => w.mode, set: async (m) => { w.calls.push(`power ${m}`); w.mode = m; return w.mode; } },
    plan: { active: async () => w.plan, fast: async () => plans?.fast || null, set: async (g) => { w.calls.push(`plan ${g}`); w.plan = g; } },
    sleep: { read: async () => ({ ok: true, ac: w.sleepAc }), change: async (which, v) => { w.calls.push(`sleep ${which} ${v}`); w.sleepAc = v; return { ok: true, ac: v }; } },
    wifi: { status: async () => ({ setUp: wifiSetUp, scans: w.scans }), pause: async () => { w.calls.push('wifi pause'); w.scans = 'paused'; return { ok: true }; }, resume: async () => { w.calls.push('wifi resume'); w.scans = 'on'; return { ok: true }; } },
    replay: { status: async () => ({ installed: obs, on: w.replayOn }), set: async (b) => { w.calls.push(`replay ${b.on}`); w.replayOn = b.on; return {}; } },
    store: { read: () => (w.stored ? JSON.parse(w.stored) : null), write: (s) => { w.stored = JSON.stringify(s); } },
    backup: (d) => w.backups.push(d), log: (t, k) => w.logs.push({ t, k }),
  };
  return { w, gm: createGamingMode(parts) };
}

{
  const { w, gm } = pc();
  const s = await gm.on();
  ok(s.on && w.mode === 'performance' && w.sleepAc === 0 && w.scans === 'paused' && w.replayOn === true, 'on: Best performance, sleep never, Wi-Fi paused, instant replay on');
  ok(s.steps.length === 4 && s.steps.every((x) => x.ok), 'four steps, each said');
  ok(w.backups.some((b) => b.before.power === 'balanced') && w.backups.some((b) => b.before.sleepAc === 1200), 'the values before were backed up before they changed');
  const before = JSON.parse(w.stored).before;
  ok(before.power === 'balanced' && before.sleepAc === 1200 && before.wifi === true && before.replay === false, 'and kept in the state file');
  await gm.on();
  ok(w.calls.filter((c) => c === 'power performance').length === 1, 'on twice: nothing done the second time');
  const off = await gm.off();
  ok(!off.on && w.mode === 'balanced' && w.sleepAc === 1200 && w.scans === 'on' && w.replayOn === false, 'off: every value back as it was');
  ok(w.calls.slice(-4).join(', ') === 'replay false, wifi resume, sleep ac 1200, power balanced', 'put back in the reverse order');
}
{
  // already how Gaming mode wants it: nothing changed, nothing put back
  const { w, gm } = pc({ mode: 'performance', sleepAc: 0, scans: 'paused', replayOn: true });
  await gm.on(); await gm.off();
  ok(w.calls.length === 0, 'nothing to change: nothing changed on, nothing changed back');
}
{
  // a desktop without the power mode switch: the fastest plan, and the plan before back
  const { w, gm } = pc({ mode: 'other', plans: { active: 'aaaa', fast: { guid: 'ffff', name: 'High performance' } } });
  await gm.on();
  ok(w.plan === 'ffff', 'no power mode switch: the High performance plan');
  await gm.off();
  ok(w.plan === 'aaaa', 'and the plan before back');
}
{
  // Wi-Fi pause not set up, OBS not installed: left alone, said so, the rest still done
  const { w, gm } = pc({ wifiSetUp: false, obs: false });
  const s = await gm.on();
  ok(w.mode === 'performance' && w.sleepAc === 0 && !w.calls.some((c) => /wifi|replay/.test(c)), 'not set up / not installed: left alone');
  ok(s.steps.filter((x) => !x.ok).length === 2 && s.steps.some((x) => /not set up/.test(x.text)) && s.steps.some((x) => /not installed/.test(x.text)), 'and said, step by step');
}
{
  // a step that fails does not stop the others, and off still puts back what changed
  const { w, gm } = pc();
  const parts = gm;
  w.mode = 'balanced';
  const broken = pc();
  broken.gm.on = broken.gm.on;
  const g2 = createGamingMode({
    power: { get: async () => 'balanced', set: async () => 'balanced' },      // Windows does not take it
    plan: { active: async () => null, fast: async () => null, set: async () => {} },
    sleep: { read: async () => ({ ok: true, ac: 900 }), change: async (wch, v) => { broken.w.sleepAc = v; } },
    wifi: { status: async () => ({ setUp: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: true }) },
    replay: { status: async () => ({ installed: false }), set: async () => {} },
    store: { read: () => (broken.w.stored ? JSON.parse(broken.w.stored) : null), write: (s) => { broken.w.stored = JSON.stringify(s); } },
  });
  const s = await g2.on();
  ok(s.steps[0].ok === false && /Windows reads balanced/.test(s.steps[0].text) && broken.w.sleepAc === 0, 'power not taken: said; sleep still set');
  await g2.off();
  ok(broken.w.sleepAc === 900, 'and off puts the sleep back');
  void parts;
}
{
  // left on through a crash: the next start puts it all back
  const { w, gm } = pc();
  await gm.on();
  const again = createGamingMode({
    power: { get: async () => w.mode, set: async (m) => { w.mode = m; return m; } }, plan: { active: async () => null, fast: async () => null, set: async () => {} },
    sleep: { read: async () => ({ ok: true, ac: w.sleepAc }), change: async (wch, v) => { w.sleepAc = v; } },
    wifi: { status: async () => ({ setUp: true, scans: w.scans }), pause: async () => ({ ok: true }), resume: async () => { w.scans = 'on'; return { ok: true }; } },
    replay: { status: async () => ({ installed: true, on: w.replayOn }), set: async (b) => { w.replayOn = b.on; } },
    store: { read: () => JSON.parse(w.stored), write: (s) => { w.stored = JSON.stringify(s); } }, log: (t) => w.logs.push({ t }),
  });
  await again.onStart();
  ok(w.mode === 'balanced' && w.sleepAc === 1200 && w.scans === 'on' && w.replayOn === false && w.logs.some((l) => /DeviceHub started/.test(l.t)), 'a start with Gaming mode left on puts everything back');
}

// "while a game runs" (auto): a game turns it on, its end (gone 20 s) off; one the person turned on is never turned off
{
  let t = 0;
  const w = { mode: 'balanced', sleepAc: 1200, stored: null };
  const parts = {
    power: { get: async () => w.mode, set: async (m) => { w.mode = m; return m; } }, plan: { active: async () => null, fast: async () => null, set: async () => {} },
    sleep: { read: async () => ({ ok: true, ac: w.sleepAc }), change: async (wh, v) => { w.sleepAc = v; } },
    wifi: { status: async () => ({ setUp: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: true }) },
    replay: { status: async () => ({ installed: false }), set: async () => {} },
    store: { read: () => (w.stored ? JSON.parse(w.stored) : null), write: (s) => { w.stored = JSON.stringify(s); } }, now: () => t,
  };
  const gm = createGamingMode(parts);
  await gm.tick('Fortnite');
  ok(!gm.status().on, 'auto off: a game changes nothing');
  ok(gm.setAuto(true).auto === true, 'auto switched on');
  await gm.tick('Fortnite');
  ok(gm.status().on && gm.status().byGame === 'Fortnite' && w.mode === 'performance', 'a game starts: Gaming mode on, by that game');
  await gm.tick(null);
  t += 10000; await gm.tick(null);
  ok(gm.status().on, 'gone 10 s: still on (a game restarting itself is not a quit)');
  t += 11000; await gm.tick(null);
  ok(!gm.status().on && w.mode === 'balanced' && w.sleepAc === 1200 && gm.status().auto === true, 'gone 20 s: off, all put back, auto kept');
  await gm.on();
  t += 60000; await gm.tick(null); await gm.tick(null);
  ok(gm.status().on, 'turned on by hand: a game ending never turns it off');
  await gm.off();
}
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
ok(/\/api\/gaming-mode/.test(server) && /gaming-mode\.json/.test(server), 'the route, and its state in data\\gaming-mode.json');
ok(/\(await gamingMode\(\)\)\.off\('DeviceHub quit'\)/.test(server), 'quitting DeviceHub puts everything back first');

if (fails.length) { console.log(`gaming-mode: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('gaming-mode (one switch: Best performance, sleep never, Wi-Fi paused, instant replay on; all put back): all good');
