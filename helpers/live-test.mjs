// Run: node helpers/live-test.mjs (DeviceHub running). Changes real devices one step and puts each back.
// Whole-app live test (20 Oct 2026): real clicks in the real app (hidden window) on the real devices. Every change
// reads the value just before, checks the device took it, and puts back exactly what was read. Mouse only if awake.
import { spawn } from 'node:child_process';
import path from 'node:path';
const B = 'http://127.0.0.1:5577';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u) => (await fetch(B + u)).json();
const dev = async (id) => (await J('/api/agent/state')).devices.find((d) => d.id === id);
const mon = async (name) => (await J('/api/monitors')).find((m) => m.name === name);
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9431', `--user-data-dir=${path.join(process.env.TEMP || '.', 'devicehub-livetest-profile')}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 150 && !t; i++) { try { t = await (await fetch('http://127.0.0.1:9431/json')).json(); } catch { await sleep(200); } }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const w = new Map(); const errors = [];
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console: ' + d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 160)); });
const send = (method, params = {}) => new Promise((r) => { const id = ++n; w.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1200, deviceScaleFactor: 1, mobile: false });
const go = async (page) => { await send('Page.navigate', { url: `${B}/#/${page}` }); await sleep(5000); };
const results = [];
const report = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`); };
const until = async (check, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await check()) return Date.now() - t0; await sleep(150); } return null; };
// scope: a card whose text matches; then the control by aria-label
const scopeJs = (scope) => (scope ? `([...document.querySelectorAll('#main .panel')].find((p) => new RegExp(${JSON.stringify(scope)}).test(p.querySelector('h2,h3')?.textContent || p.textContent.slice(0, 80))) || document)` : 'document.querySelector("#main")');
const setSlider = (scope, label, value) => ev(`(() => { const s = [...${scopeJs(scope)}.querySelectorAll('input[type=range]')].find((i) => i.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!s) return 'missing'; s.value = ${value}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
const clickSwitch = (scope, label) => ev(`(() => { const s = [...${scopeJs(scope)}.querySelectorAll('[role=switch]')].find((i) => i.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!s) return 'missing'; s.click(); return 'ok'; })()`);
// slider: step by delta, wait for the read-back, then put back exactly
async function sliderTest(name, scope, label, read, delta, near = 0) {
  const before = await read();
  if (before == null) return report(name, false, 'no reading');
  const target = before + delta;
  if ((await setSlider(scope, label, target)) === 'missing') return report(name, false, `no "${label}" slider`);
  const ms = await until(async () => Math.abs((await read()) - target) <= near);
  await sleep(700);
  await setSlider(scope, label, before);
  const back = await until(async () => Math.abs((await read()) - before) <= near);
  report(name, ms != null && back != null, `${before} -> ${target} in ${ms ?? 'never'} ms, back to ${await read()}`);
}
async function switchTest(name, scope, label, read) {
  const before = await read();
  if ((await clickSwitch(scope, label)) === 'missing') return report(name, false, `no "${label}" switch`);
  const ms = await until(async () => (await read()) !== before);
  await sleep(1500);
  await clickSwitch(scope, label);
  const back = await until(async () => (await read()) === before);
  report(name, ms != null && back != null, `${before} -> ${!before} in ${ms ?? 'never'} ms, back to ${await read()}`);
}

// ---- Keyboard
const kb0 = (await dev('keyboard')).values;
console.log('keyboard before:', JSON.stringify(kb0));
await go('keyboard');
await switchTest('keyboard Lights switch', 'Lighting', 'Lights', async () => (await dev('keyboard')).values.effect !== 0);
// with the lights on for the rest: color dot, brightness, speed, effect
if (kb0.effect === 0) { await clickSwitch('Lighting', 'Lights'); await until(async () => (await dev('keyboard')).values.effect !== 0); await sleep(1200); }
{
  await ev(`document.querySelector('.swatch[aria-label="color #3ddc97"]').click()`);
  const ms = await until(async () => { const v = (await dev('keyboard')).values; return v.saturation > 100 && Math.abs(v.hue - 107) < 8; });
  report('keyboard color dot (green)', ms != null, `in ${ms ?? 'never'} ms, ${JSON.stringify((await dev('keyboard')).values)}`);
  await sleep(1200);
}
await sliderTest('keyboard brightness', 'Lighting', 'Brightness', async () => (await dev('keyboard')).values.brightness, -60, 4);
await sleep(800);
await sliderTest('keyboard effect speed', 'Lighting', 'Effect speed', async () => (await dev('keyboard')).values.speed, 60, 4);
// effect: pick Breathing in the select and back
{
  const pick = (x) => ev(`(() => { const s = ${scopeJs('Lighting')}.querySelector('select'); if (!s) return 'missing'; s.value = '${x}'; s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
  const before = (await dev('keyboard')).values.effect;
  const r = await pick(5);
  const ms = await until(async () => (await dev('keyboard')).values.effect === 5);
  await sleep(1200); await pick(before);
  const back = await until(async () => (await dev('keyboard')).values.effect === before);
  report('keyboard effect select', r === 'ok' && ms != null && back != null, `${before} -> 5 in ${ms ?? 'never'} ms, back to ${(await dev('keyboard')).values.effect}`);
}
// a key change (Layer 4, an unused key) and back, over the same route the key picker uses
{
  const s = (await dev('keyboard')).adapter.session; const before = s.keymap[4][0][1];
  const h = { 'Content-Type': 'application/json', Origin: B };
  const wr = (v) => fetch(B + '/api/agent/write', { method: 'POST', headers: h, body: JSON.stringify({ id: 'keyboard', key: 'key:4:0:1', value: v, label: 'Live test key', display: String(v) }) }).then((r) => r.json());
  const a = await wr(0x04); const after = (await dev('keyboard')).adapter.session.keymap[4][0][1];
  const b = await wr(before); const back = (await dev('keyboard')).adapter.session.keymap[4][0][1];
  report('keyboard key change (Layer 4) and back', !a.error && after === 0x04 && back === before, `${before} -> ${after} -> ${back}${a.error ? ' ' + a.error : ''}`);
}
// put the lighting back exactly as read at the start
{
  const h = { 'Content-Type': 'application/json', Origin: B };
  for (const k of ['hue', 'saturation', 'brightness', 'speed', 'effect']) {
    const cur = (await dev('keyboard')).values[k];
    if (cur !== kb0[k]) await fetch(B + '/api/agent/write', { method: 'POST', headers: h, body: JSON.stringify({ id: 'keyboard', key: k, value: kb0[k], label: 'Live test restore', display: String(kb0[k]) }) });
  }
  const end = (await dev('keyboard')).values;
  const same = Object.keys(kb0).every((k) => Math.abs(end[k] - kb0[k]) <= (k === 'brightness' || k === 'speed' ? 4 : 0));
  report('keyboard lighting restored', same, JSON.stringify(end));
}

// ---- Headset (Windows volume works with the headset off)
await go('headset');
await sliderTest('headset volume', null, 'Volume', async () => (await dev('headset')).values['vol:playback'], -5, 1);
// EQ: pick another preset and back to the one in use
{
  const eq0 = await J('/api/eq');
  const inUse = await ev(`document.querySelector('.eq-preset .inuse')?.closest('.eq-preset')?.querySelector('span')?.textContent`);
  const names = await ev(`[...document.querySelectorAll('.eq-preset')].map((b) => b.querySelector('span')?.textContent)`);
  const other = (names || []).find((x) => x !== inUse && /Pure Direct/.test(x)) || (names || []).find((x) => x !== inUse);
  const click = (txt) => ev(`(() => { const b = [...document.querySelectorAll('.eq-preset')].find((x) => x.querySelector('span')?.textContent === ${JSON.stringify(txt)}); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
  const now = () => ev(`document.querySelector('.eq-preset .inuse')?.closest('.eq-preset')?.querySelector('span')?.textContent`);
  if (!inUse || !other) report('EQ preset pick and back', false, `in use: ${inUse}, presets: ${names?.length}`);
  else {
    await click(other); const ms = await until(async () => (await now()) === other);
    await sleep(1200); await click(inUse); const back = await until(async () => (await now()) === inUse);
    report('EQ preset pick and back', ms != null && back != null, `${inUse.slice(0, 30)} -> ${other.slice(0, 30)} in ${ms ?? 'never'} ms, back: ${(await now())?.slice(0, 30)}`);
  }
  const ex = async (k) => (await J('/api/eq')).extras?.[k];
  if (eq0.extras) {
    await ev(`(() => { const d = document.querySelector('details.more'); if (d && !d.open) d.querySelector('summary').click(); })()`); await sleep(800);
    await switchTest('EQ Natural sound', null, 'Natural sound', () => ex('correction'));
    await switchTest('EQ Loudness boost', null, 'Loudness boost', () => ex('loudness'));
    const ex0 = (await J('/api/eq')).extras;
    console.log('(sound tools keys: ' + Object.keys(ex0).join(', ') + ')');
    for (const [label, key] of [['Cut rumble', 'micRumble'], ['Voice clarity', 'micClarity'], ['Smooth highs', 'micDeEss'], ['Even volume', 'micLevel']]) {
      const k = key in ex0 ? key : Object.keys(ex0).find((x) => x.toLowerCase().includes(key.slice(0, 4)));
      if (!k) { console.log(`(no extras key for ${label})`); continue; }
      await switchTest(`EQ ${label}`, null, label, () => ex(k));
    }
    await sliderTest('EQ balance', 'Sound tools', 'Balance', () => ex('balance'), 1, 0);
  } else console.log('(EQ extras not in /api/eq; skipped)');
}

// ---- Monitors
await go('monitors');
await sliderTest('AOC brightness', 'AGON', 'Brightness', async () => (await mon('AOC AGON OLED'))?.brightness?.value, -5, 0);
await sliderTest('Acer contrast', 'Acer', 'Contrast', async () => (await mon('Acer IPS'))?.contrast?.value, -5, 0);

// ---- Camera (Monitors page): one picture setting and one Auto, each put back
{
  const cam = async () => (await J('/api/cameras?fresh=1'))[0];
  const c0 = await cam();
  if (!c0) console.log('(no camera; camera not tested)');
  else {
    await go('monitors'); await sleep(2500);
    await sliderTest('camera brightness', 'Camera', 'Brightness', async () => (await cam())?.controls.brightness?.value, -5, 0);
    if (c0.controls.focus?.canAuto) await switchTest('camera focus auto', 'Camera', 'Focus auto', async () => (await cam())?.controls.focus?.auto);
    // white balance on Auto reads outside its own range (168 of 2300-6500): Auto off must still work, and back on
    if (c0.controls.whiteBalance?.canAuto) await switchTest('camera white balance auto', 'Camera', 'White balance auto', async () => (await cam())?.controls.whiteBalance?.auto);
    const c1 = await cam();
    const same = Object.keys(c0.controls).every((k) => c1.controls[k].auto === c0.controls[k].auto && (c0.controls[k].auto || c1.controls[k].value === c0.controls[k].value));
    report('camera put back', same, JSON.stringify(Object.fromEntries(Object.entries(c1.controls).map(([k, v]) => [k, v.auto ? 'auto' : v.value]))));
  }
}

// ---- Mouse (only if awake): every setting on its page except Windows' own pointer settings. Its auto sleep (Shawn's:
// 20 s) is raised to 30 min for the test and put back after, so it does not fall asleep halfway (20 Oct 2026)
if ((await dev('mouse')).status === 'connected') {
  const hh = { 'Content-Type': 'application/json', Origin: B };
  const sleep0 = (await dev('mouse')).values.sleep;
  await fetch(B + '/api/agent/write', { method: 'POST', headers: hh, body: JSON.stringify({ id: 'mouse', key: 'sleep', value: 1800, label: 'Auto sleep (during the test)', display: '30 min' }) });
  const mv = async () => (await dev('mouse')).values;
  const m0 = await mv();
  await go('mouse');
  for (const [label, key] of [['Motion sync', 'motionSync'], ['Angle snapping', 'angleSnap'], ['Ripple control', 'ripple'], ['Turbo mode', 'turbo']]) {
    await switchTest(`mouse ${label}`, null, label, async () => (await mv())[key]);
  }
  await sliderTest('mouse debounce', null, 'Debounce', async () => (await mv()).debounce, 1, 0);
  await sliderTest('mouse auto sleep', null, 'Auto sleep', async () => (await mv()).sleep, -10, 0);
  // a choice button in a segmented row, found by its text, inside the row whose buttons include `other`
  const seg = (other, txt) => ev(`(() => { const row = [...document.querySelectorAll('#main .seg, #main [role=radiogroup]')].find((r) => r.textContent.includes(${JSON.stringify(other)})); const b = row && [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(txt)}); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
  async function segTest(name, other, read, from, fromTxt, to, toTxt) {
    const before = await read();
    if (before !== from) return report(name, false, `expected ${from}, read ${before}`);
    if ((await seg(other, toTxt)) === 'missing') return report(name, false, `no "${toTxt}" button`);
    const ms = await until(async () => (await read()) === to); await sleep(1200);
    await seg(other, fromTxt); const back = await until(async () => (await read()) === from);
    report(name, ms != null && back != null, `${from} -> ${to} in ${ms ?? 'never'} ms, back to ${await read()}`);
  }
  await segTest('mouse polling rate', '1K', async () => (await mv()).pollingRate, m0.pollingRate, m0.pollingRate === 1000 ? '1K' : String(m0.pollingRate), 500, '500');
  // the mouse's own numbers (public/devices/pulsar.js LIFT_OFF): 1 Medium, 2 High, 3 Low
  const LIFT = { 1: 'Medium', 2: 'High', 3: 'Low' };
  await segTest('mouse lift-off', 'Medium', async () => (await mv()).liftOff, m0.liftOff, LIFT[m0.liftOff], m0.liftOff === 2 ? 1 : 2, m0.liftOff === 2 ? 'Medium' : 'High');
  // DPI of the active stage and one button remap, over the same route the page uses
  const h = { 'Content-Type': 'application/json', Origin: B };
  const wr = (key, value) => fetch(B + '/api/agent/write', { method: 'POST', headers: h, body: JSON.stringify({ id: 'mouse', key, value, label: `Live test ${key}`, display: String(value) }) }).then((r) => r.json());
  {
    const k = `dpi${m0.dpiStage - 1}`, before = m0[k], to = before + 100;
    const a = await wr(k, to); const mid = (await mv())[k]; const b2 = await wr(k, before); const back = (await mv())[k];
    report('mouse DPI of the active stage', !a.error && mid === to && back === before, `${before} -> ${mid} -> ${back}${a.error ? ' ' + a.error : ''}`);
  }
  {
    const before = m0.btn4, to = before === 'forward' ? 'back' : 'forward';
    const a = await wr('btn4', to); const mid = (await mv()).btn4; const b2 = await wr('btn4', before); const back = (await mv()).btn4;
    report('mouse button remap (forward button)', !a.error && mid === to && back === before, `${before} -> ${mid} -> ${back}${a.error ? ' ' + a.error : ''}`);
  }
  const m1 = await mv();
  const diff = Object.keys(m0).filter((k) => !/battery|charging|level/i.test(k) && JSON.stringify(m0[k]) !== JSON.stringify(m1[k]));
  report('mouse put back exactly', !diff.length, diff.length ? 'differs: ' + diff.map((k) => `${k} ${JSON.stringify(m0[k])} -> ${JSON.stringify(m1[k])}`).join(', ') : 'every value as before');
  await fetch(B + '/api/agent/write', { method: 'POST', headers: hh, body: JSON.stringify({ id: 'mouse', key: 'sleep', value: sleep0, label: 'Auto sleep back', display: `${sleep0} s` }) });
  report('mouse auto sleep put back', (await dev('mouse')).values.sleep === sleep0, `${(await dev('mouse')).values.sleep} s (was ${sleep0} s)`);
} else console.log(`(mouse ${(await dev('mouse')).status}: move it to wake it; mouse not tested live)`);

// ---- Settings and the other pages: open each, no script errors
for (const p of ['overview', 'lighting', 'profiles', 'backups', 'settings']) { await go(p); const txt = await ev(`document.querySelector('#main')?.innerText.length`); report(`page ${p} opens`, txt > 100, `${txt} characters`); }

console.log(errors.length ? 'script errors: ' + errors.join(' | ') : 'no script errors');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed${failed.length ? '; failed: ' + failed.map((f) => f.name).join(', ') : ''}`);
ws.close(); c.kill(); process.exit(0);
