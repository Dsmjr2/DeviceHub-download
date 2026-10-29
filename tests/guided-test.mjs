// "Test it with me" (helpers/guided-test.mjs, public/core/guided-values.js, public/ui/guided-test.js): the second
// value it tries is inside the setting's own range and lower for a slider, the answers stay tied to the driver's exact
// text, the route only takes settings the driver has, and the page changes nothing without a click and puts every value
// back. Run: node tests/guided-test.mjs (no hardware, no network, DeviceHub need not run)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testable, testValue, readTried, saveAnswer, summary, getTried, postTried, TRIED_FILE, options as guidedOptions } from '../helpers/guided-test.mjs';
import { driverSha } from '../helpers/my-devices.mjs';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message, code: e.code }; } };

// ---- 1. the value it tries
const bright = { key: 'brightness', type: 'slider', min: 0, max: 9 };
const vol = { key: 'volume', type: 'slider', min: 0, max: 100 };
const dpi = { key: 'dpi', type: 'slider', min: 100, max: 26000, step: 50 };
ok(testValue(bright, 5) === 1 && testValue(bright, 9) === 2 && testValue(bright, 1) === 0, 'a slider goes lower (dimmer) when it can');
ok(testValue(bright, 0) === 3 && testValue(vol, 0) === 30, 'at its lowest it goes up, never past a third of the range');
ok(testValue(vol, 50) === 13 && testValue(vol, 100) === 25, 'a headset is never turned up for the test (50 to 13, 100 to 25)');
ok(testValue(dpi, 800) === 300 && (testValue(dpi, 800) - 100) % 50 === 0, 'a stepped slider lands on a step inside its range');
ok(testValue({ type: 'slider', min: 0, max: 1 }, 1) === 0 && testValue({ type: 'slider', min: 0, max: 1 }, 0) === 1, 'a two-value slider flips');
for (const s of [bright, vol, dpi]) for (const v of [s.min, s.max, Math.round((s.min + s.max) / 2)]) { const t = testValue(s, v); ok(t !== v && t >= s.min && t <= s.max, `${s.key} ${v} -> ${t} is a different value inside the range`); }
ok(testValue({ type: 'toggle' }, true) === false && testValue({ type: 'toggle' }, false) === true, 'a toggle flips');
const choice = { type: 'choice', options: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] };
ok(testValue(choice, 'a') === 'b' && testValue(choice, 'c') === 'a' && testValue(choice, 'zz') === 'a', 'a choice takes another of its own options');
ok(testValue({ type: 'color' }, '#ff0000') === '#0050ff' && testValue({ type: 'color' }, '#0000ff') === '#ff3000', 'a color takes a clearly different color');
ok(!testable({ type: 'display' }, 3) && !testable({ type: 'remap', buttons: [] }, {}) && !testable({ type: 'color', zones: [{}] }, {}) && !testable({ type: 'slider', min: 0, max: 9, readOnly: true }, 2), 'readings, remaps, zone colors and read-only settings are not tried');
ok(!testable({ type: 'choice', options: [{ value: 1 }] }, 1) && !testable({ type: 'slider', min: 0, max: 9 }, null) && testValue({ type: 'display' }, 1) === undefined, 'nothing to try: no value');

// ---- 2. the answers on this PC
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-guided-'));
try {
  const folder = path.join(root, 'my-devices', 'acme');
  fs.mkdirSync(folder, { recursive: true });
  const DRIVER = 'export default { id: "acme" };';
  fs.writeFileSync(path.join(folder, 'device.mjs'), DRIVER);
  fs.writeFileSync(path.join(folder, 'library.json'), JSON.stringify({ name: 'acme', source: 'device-library/acme' }));
  const settings = [bright, { key: 'logo', label: 'Logo', type: 'toggle' }, { key: 'batt', type: 'display' }];
  ok(JSON.stringify(readTried(folder)) === '{}', 'nothing tried yet');
  const keys = saveAnswer(folder, settings, { key: 'brightness', answer: 'yes', from: 5, to: 1 }, () => new Date('2026-10-29T12:00:00Z'));
  const file = JSON.parse(fs.readFileSync(path.join(folder, TRIED_FILE), 'utf8'));
  ok(keys.brightness.answer === 'yes' && file.driverSha === driverSha(DRIVER) && file.keys.brightness.from === 5 && file.keys.brightness.at === '2026-10-29T12:00:00.000Z', `saved with the driver's SHA-256 (${JSON.stringify(file)})`);
  saveAnswer(folder, settings, { key: 'logo', answer: 'no' });
  ok(readTried(folder).brightness.answer === 'yes' && readTried(folder).logo.answer === 'no', 'answers add up');
  for (const bad of [{ key: 'nope', answer: 'yes' }, { key: 'logo', answer: 'maybe' }, { key: 'logo', answer: 'yes', from: 'x'.repeat(300) }]) ok(!(await attempt(() => saveAnswer(folder, settings, bad))).ok, `refused: ${JSON.stringify(bad).slice(0, 60)}`);
  const sum = summary(settings, { brightness: 5, logo: true, batt: 40 }, readTried(folder));
  ok(sum.yes.join() === 'brightness' && sum.no.join() === 'logo' && !sum.untried.length && !sum.unsure.length, `the summary (${JSON.stringify(sum)})`);
  ok(summary(settings, { brightness: 5, logo: true }, {}).untried.join() === 'brightness,logo', 'untried: only the settings it can try');
  fs.writeFileSync(path.join(folder, 'device.mjs'), `${DRIVER}\n// a newer driver`);
  ok(JSON.stringify(readTried(folder)) === '{}', 'a changed driver starts the test over');

  // ---- 3. the route: a connected library driver only
  const state = async () => ({ devices: [{ id: 'acme', adapter: { plugin: 'acme', settings } }, { id: 'mouse', adapter: { id: 'mouse' } }] });
  const p = await postTried({ id: 'acme', key: 'logo', answer: 'unsure' }, { root, state });
  ok(p.ok && p.keys.logo.answer === 'unsure' && (await getTried('acme', { root, state })).keys.logo.answer === 'unsure', 'POST saves, GET reads it back');
  const was = guidedOptions.root; guidedOptions.root = root;
  ok((await getTried('acme', { state })).keys.logo.answer === 'unsure', 'the route works with its own default folder (no root passed, as the server calls it)');
  guidedOptions.root = was;
  const builtIn = await attempt(() => getTried('mouse', { root, state }));
  ok(!builtIn.ok && builtIn.code === 404, "a built-in device has no test (DeviceHub's own drivers are already tested)");
  const down = await attempt(() => getTried('acme', { root, state: async () => null }));
  ok(!down.ok && down.code === 503, 'no answer from the background part: 503');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

// ---- 4. the page: a click per change, quiet writes that leave no Undo, every value put back
const ui = fs.readFileSync(path.join(REAL, 'public/ui/guided-test.js'), 'utf8');
const code = ui.replace(/\/\/.*$/gm, '');
ok(!/toast\(|modal\(|\btitle:|alert\(|confirm\(|Notification/.test(code), 'no pop-ups, notifications or tooltips');
ok((code.match(/await write\(/g) || []).length === 2 && /write\(id, x\.key, to,[^;]*noUndo: true/.test(code) && /write\(id, s\.key, s\.from,[^;]*noUndo: true/.test(code), 'two writes only: the test value and putting it back');
ok(/button\('Change it', \(\) => tryIt\(x\)/.test(code) && !/tryIt\([^)]*\)\s*;/.test(code.replace(/button\('Change it', \(\) => tryIt\(x\)/, '')), 'the test value is written only from the Change it button');
ok(/if \(was === 'asked' && !\(await putBack\(\)\)\) return;/.test(code), 'every answer puts the old value back first');
ok(/PUT_BACK_MS = 60 \* 1000/.test(ui) && /setTimeout\(async \(\) => \{ if \(s\.stage === 'asked'[^]*putBack\(\)/.test(code), 'an unanswered question puts the value back after a minute');
ok(/from '\.\.\/core\/guided-values\.js'/.test(ui), 'the page uses the same rules as the server');
const page = fs.readFileSync(path.join(REAL, 'public/pages/my-device.js'), 'utf8');
ok(/import \{ guidedTest \} from '\.\.\/ui\/guided-test\.js'/.test(page), 'the device page has it');

if (fails.length) { console.log(`guided-test: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('guided-test (Test it with me: safe second values, answers tied to the driver, a click per change, every value put back): all good');
