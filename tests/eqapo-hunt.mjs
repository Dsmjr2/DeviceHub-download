// Offline test (15 Nov 2026 bug hunt, helpers/eqapo.js and public/pages/eq-panel.js), stand-in Program Files, store and
// sound devices; no real file is touched:
// 1 a speaker's EQ is carried to another device only when its old device is gone (a monitor's new GUID), never to a
//   second device that merely has the same short name ("Speakers")
// 2 a change that could not be played (config.txt not written) is not saved as if it had been
// 3 on the page, a Sound tools switch whose change failed goes back (it stayed flipped)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-eqhunt-'));
const cfgDir = path.join(root, 'EqualizerAPO', 'config'), cfg = path.join(cfgDir, 'config.txt'), backups = path.join(root, 'backups');
process.env.DEVICEHUB_EQ_STORE = path.join(root, 'eq-presets.json');
fs.mkdirSync(cfgDir, { recursive: true }); fs.mkdirSync(backups);
fs.writeFileSync(cfg, '# Written by DeviceHub (Headset page)\r\n');
process.env.ProgramFiles = root;
const require = createRequire(import.meta.url);
const A = '{11111111-1111-1111-1111-111111111111}', B = '{22222222-2222-2222-2222-222222222222}', A2 = '{33333333-3333-3333-3333-333333333333}';
let speakers = [{ guid: A, name: 'Speakers' }], failDevices = false;
const devices = async () => { if (failDevices) throw new Error('sound devices could not be listed'); return { headset: [], mic: [], speakers, mics: [] }; };
const eq = require('../helpers/eqapo.js')(null, devices, backups);
const stored = () => JSON.parse(fs.readFileSync(process.env.DEVICEHUB_EQ_STORE, 'utf8'));

try {
  await eq.setExtras({ speaker: { guid: A, on: true, stages: [6, 6, 6, 0, 0, 0, 0, 0, 0, 0] } });
  check(stored().extras.speakers[A]?.on === true, 'speaker A has its EQ on');

  // a USB DAC plugged in, also named "Speakers"
  speakers = [{ guid: A, name: 'Speakers' }, { guid: B, name: 'Speakers' }];
  await eq.setExtras({ loudness: true });
  const sB = stored().extras.speakers[B];
  check(!sB || (!sB.on && sB.stages.every((x) => x === 0)), `a second device named "Speakers" does not get A's EQ (${JSON.stringify(sB)})`);
  check(!new RegExp(`Device:[^\\r\\n]*${B.slice(1, 9)}`, 'i').test(fs.readFileSync(cfg, 'utf8')), 'and config.txt has no section for it');
  const rB = (await eq.read()).speakers.find((s) => s.guid === B);
  check(rB && !rB.on, 'the page shows the second device off');

  // A's monitor got a new GUID (A is gone): its EQ carries over, as before
  speakers = [{ guid: A2, name: 'Speakers' }];
  await eq.setExtras({ loudness: false });
  check(stored().extras.speakers[A2]?.on === true && stored().extras.speakers[A2].stages[0] === 6, 'a device whose old GUID is gone keeps its EQ');

  // a change that could not be played is not saved
  failDevices = true;
  let threw = false;
  try { await eq.setExtras({ correction: true }); } catch { threw = true; }
  failDevices = false;
  check(threw, 'a change that could not be written fails');
  check(!stored().extras.correction, 'and is not saved as on');
  threw = false; failDevices = true;
  try { await eq.setHeadroom({ on: false }); } catch { threw = true; }
  failDevices = false;
  check(threw && stored().headroom !== false, 'Prevent distortion is not saved off when it could not be written');

  // the page: a switch whose change failed goes back
  const panel = fs.readFileSync(new URL('../public/pages/eq-panel.js', import.meta.url), 'utf8');
  check(!/toggle\(\{[^\n]*onCommit: \(on\) => setExtras\(/.test(panel), 'Sound tools switches use a commit that fails when the change failed');
  check(/catch \(e\) \{ toast\('Not changed', 'bad', \{ detail: e\.message \}\); throw e; \}/.test(panel), 'Prevent distortion goes back when its change failed');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`eqapo-hunt (no EQ onto a same-named device, a failed change not saved, switches go back): all ${n} passed`);
process.exit(0);
