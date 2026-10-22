// The Logitech keyboard library driver (device-library/logitech-hidpp-keyboard) against simulated keyboards only: nothing
// is opened, nothing reaches hardware. The simulated keyboards answer as Solaar (settings_templates.py ReportRate,
// ExtendedReportRate, OnboardProfiles, DisableKeyboardKeys, FnSwap / NewFnSwap, BrightnessControl) and libratbag
// (onboard profiles info) describe, with HID++ 2.0 error replies. Expected request bytes are typed out by hand.
// Covers every setting: write, read back, put back, out-of-range refused, refused while G HUB runs, the never list.
// Run: node tests/sim-logitech-keyboard.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogitechKeyboard, F, NEVER, PIDS, BLE, HidppError, halvingMarks } from '../device-library/logitech-hidpp-keyboard/device.mjs';
import { problem, fits, hidSpecs, ownClash } from '../helpers/my-devices.mjs';
import { validateMeta } from '../helpers/device-library.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
process.on('uncaughtException', (e) => { console.log(`sim-logitech-keyboard: FAILED: ${e.message}`); process.exit(1); });
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// a simulated keyboard. features: { id: index }; slot: 0xFF wired or the receiver slot it answers on
// replyIndex: the device index in its replies (a Bluetooth keyboard answers 0xFF with 0x00, Solaar base.py)
function simKeyboard({ pid, slot, features, state, rateExt, rateMask, profiles, disableMask, bright, replyIndex }) {
  const byIndex = Object.fromEntries(Object.entries(features).map(([id, i]) => [i, Number(id)]));
  const ls = new Set();
  const dev = {
    opened: false, productId: pid, sent: [], bad: [], state, failNext: null,
    async open() { this.opened = true; },
    addEventListener(t, fn) { if (t === 'inputreport') ls.add(fn); },
    removeEventListener(t, fn) { ls.delete(fn); },
    async sendReport(rid, data) {
      const b = Array.from(data);
      this.sent.push(b);
      if (rid !== 0x11 || b.length !== 19) { this.bad.push(`report ${rid} of ${b.length}`); return; }
      if ((b[2] & 0x0f) !== 0x0b) this.bad.push('software id not 0x0B');
      const [d, idx, fs] = b, p = b.slice(3);
      if (d !== slot) return;                                           // an empty receiver slot: no answer
      const emit = (bytes) => setTimeout(() => { for (const fn of [...ls]) fn({ reportId: 0x11, data: new DataView(Uint8Array.from(bytes).buffer) }); }, 1);
      const ri = replyIndex ?? d;
      const reply = (out) => emit([ri, idx, fs, ...out, ...Array(16).fill(0)].slice(0, 19));
      const err = (code) => emit([ri, 0xff, idx, fs, code, ...Array(14).fill(0)]);
      if (this.failNext) { const c = this.failNext; this.failNext = null; return err(c); }
      const fn = fs & 0xf0, id = idx === 0 ? 0 : byIndex[idx];
      if (id === 0 && fn === 0x00) { const want = (p[0] << 8) | p[1]; return reply(features[want] ? [features[want], 0, 1] : [0, 0, 0]); }
      if (id === 0 && fn === 0x10) return reply([4, 2, p[2]]);
      if (id === F.UNIFIED_BATTERY && fn === 0x00) return reply([0, 0x03]);
      if (id === F.UNIFIED_BATTERY && fn === 0x10) return reply([state.percent, 4, state.charge, 0]);
      if (id === F.EXT_REPORT_RATE && fn === 0x10 && rateExt) return reply([0, rateMask]);
      if (id === F.EXT_REPORT_RATE && fn === 0x20 && rateExt) return reply([state.rateIndex]);
      if (id === F.EXT_REPORT_RATE && fn === 0x30 && rateExt) { if (!(rateMask & (1 << p[0]))) return err(0x02); state.rateIndex = p[0]; return reply([]); }
      if (id === F.REPORT_RATE && fn === 0x00) return reply([rateMask]);
      if (id === F.REPORT_RATE && fn === 0x10) return reply([state.rateMs]);
      if (id === F.REPORT_RATE && fn === 0x20) { if (!(rateMask & (1 << (p[0] - 1)))) return err(0x02); state.rateMs = p[0]; return reply([]); }
      if (id === F.ONBOARD_PROFILES && fn === 0x00) return reply([1, 1, 1, profiles, 0, 0, 3, 0x10, 0]);
      if (id === F.ONBOARD_PROFILES && fn === 0x20) return reply([state.mode]);
      if (id === F.ONBOARD_PROFILES && fn === 0x10) { if (![1, 2].includes(p[0])) return err(0x02); state.mode = p[0]; return reply([]); }
      if (id === F.ONBOARD_PROFILES && fn === 0x40) return reply([state.sector >> 8, state.sector & 0xff]);
      if (id === F.ONBOARD_PROFILES && fn === 0x30) { const s = (p[0] << 8) | p[1]; if (s < 1 || s > profiles) return err(0x02); state.sector = s; return reply([]); }
      if (id === F.DISABLE_KEYS && fn === 0x00) return reply([disableMask]);
      if (id === F.DISABLE_KEYS && fn === 0x10) return reply([state.disabled]);
      if (id === F.DISABLE_KEYS && fn === 0x20) { if (p[0] & ~disableMask) return err(0x02); state.disabled = p[0]; return reply([]); }
      if ((id === F.NEW_FN_INVERSION || id === F.FN_INVERSION) && fn === 0x00) return reply([state.fnSwap]);
      if ((id === F.NEW_FN_INVERSION || id === F.FN_INVERSION) && fn === 0x10) { if (p[0] > 1) return err(0x02); state.fnSwap = p[0]; return reply([]); }
      if (id === F.BRIGHTNESS && fn === 0x00) return reply([bright.max >> 8, bright.max & 0xff, bright.steps, bright.onOff ? 0x04 : 0, bright.min >> 8, bright.min & 0xff]);
      if (id === F.BRIGHTNESS && fn === 0x10) return reply([state.level >> 8, state.level & 0xff]);
      if (id === F.BRIGHTNESS && fn === 0x20) { const v = (p[0] << 8) | p[1]; if (v < bright.min || v > bright.max) return err(0x03); state.level = v; return reply([]); }
      if (id === F.BRIGHTNESS && fn === 0x30) return reply([state.on ? 1 : 0]);
      if (id === F.BRIGHTNESS && fn === 0x40) { state.on = p[0] === 1; return reply([]); }
      return err(0x07);
    },
  };
  return dev;
}
const lookedUp = (dev) => dev.sent.filter((b) => b[1] === 0 && (b[2] & 0xf0) === 0x00).map((b) => (b[3] << 8) | b[4]);
// pingMs: an empty slot never answers, so a short wait keeps the test quick
const make = (dev, app = { name: null }) => Object.assign(createLogitechKeyboard({ open: async (p) => (p === dev.productId ? dev : null), vendorApp: async () => app.name }), { pingMs: 150 });

// ---- the library self-check (helpers/my-devices.mjs selfCheck): every writable setting written with its own value and
// read back, a backup first, nothing moved ----
async function selfChecked(d, state, { waiting = [] } = {}) {
  const os = await import('node:os');
  const { selfCheck } = await import('../helpers/my-devices.mjs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-selfcheck-'));
  const before = JSON.stringify(state);
  const backups = [];
  const r = await selfCheck(d, d.write, { folder, mark: { status: 'untested', source: 'device-library' }, backup: async (b) => backups.push(b), version: 'test' });
  fs.rmSync(folder, { recursive: true, force: true });
  const writable = d.settings.filter((s) => s.type !== 'display' && s.selfCheck !== false);
  check(backups.length === 1, 'the self-check took a backup first');
  // driver safety (22 Oct 2026): the onboard profile is never self-checked (numbering unconfirmed)
  if (d.settings.some((s) => s.key === 'profile')) check(r.keys?.profile?.skip === true && r.keys.profile.ok === false, `the self-check skips the onboard profile (${JSON.stringify(r.keys?.profile)})`);
  check(writable.length > 0 && writable.every((s) => (waiting.includes(s.key) ? r.keys?.[s.key]?.waiting === true : r.keys?.[s.key]?.ok === true)), `the self-check passes every setting (waiting: ${waiting.join(', ') || 'none'}) (${JSON.stringify(r.keys || r)})`);
  check(!d.settings.filter((s) => s.type === 'display').some((s) => r.keys?.[s.key]), 'readings are not self-checked');
  check(JSON.stringify(state) === before, 'the self-check left the device as it was');
}

// ---- 1. a G915 on its Lightspeed receiver (slot 1): 0x8061, onboard profiles, key locks, new F-key swap, brightness steps ----
{
  const kb = simKeyboard({ pid: 0xc541, slot: 1,
    features: { [F.UNIFIED_BATTERY]: 2, [F.EXT_REPORT_RATE]: 5, [F.ONBOARD_PROFILES]: 6, [F.DISABLE_KEYS]: 8, [F.NEW_FN_INVERSION]: 9, [F.BRIGHTNESS]: 11 },
    state: { percent: 81, charge: 0, rateIndex: 3, mode: 1, sector: 1, disabled: 0x00, fnSwap: 1, level: 100, on: true },
    rateExt: true, rateMask: 0x0f, profiles: 3, disableMask: 0x1f, bright: { max: 100, steps: 5, onOff: true, min: 1 } });
  const app = { name: null };
  const d = make(kb, app);
  check(problem(d) === null, `the driver has the my-devices shape (${problem(d)})`);
  check(await d.connect(), 'G915 on its receiver connects');
  check(d.index === 1 && h(kb.sent[0].slice(0, 6)) === '01 00 1b 00 00 5a', `ping on slot 1 = 01 00 1B 00 00 5A (${h(kb.sent[0].slice(0, 6))})`);
  check(kb.sent.some((b) => h(b.slice(0, 5)) === '01 00 0b 45 21') && kb.sent.some((b) => h(b.slice(0, 5)) === '01 00 0b 80 40'), 'getFeature 0x4521 and 0x8040');
  check(!lookedUp(kb).some((id) => NEVER.includes(id)), 'no DFU / reset / pairing feature is ever looked up');
  check(problem(d) === null, `connected, the settings have the my-devices shape (${problem(d)})`);
  const keys = d.settings.map((s) => s.key).join();
  check(keys === 'reportRate,mode,profile,lockWinKey,lockCapsLock,lockNumLock,lockScrollLock,lockInsert,fnSwap,brightness', `settings from the features (${keys})`);
  check(d.settings.find((s) => s.key === 'reportRate').options.map((o) => o.value).join() === '125,250,500,1000', 'rates from the 0x8061 list');
  const br = d.settings.find((s) => s.key === 'brightness');
  check(br.type === 'choice' && br.options.map((o) => o.value).join() === halvingMarks(100, 5).join() && halvingMarks(100, 5).join() === '0,13,25,50,100', `brightness steps = Solaar halving_marks(100, 5) = 0,13,25,50,100 (${JSON.stringify(br.options)})`);
  let v = await d.read();
  check(v.reportRate === 1000 && v.mode === 'onboard' && v.profile === 1 && v.lockWinKey === false && v.fnSwap === true && v.brightness === 100, `read: ${JSON.stringify(v)}`);
  // driver safety (22 Oct 2026): the onboard profile is read only, never self-checked, and its select fn 0x30 is never
  // sent, not even for the profile already active, until the numbering is confirmed on a real keyboard
  const prof = d.settings.find((s) => s.key === 'profile');
  check(prof.readOnly === true && prof.selfCheck === false && /confirmed on a real keyboard/.test(prof.hint), `profile is read-only and selfCheck:false, and its hint says why (${JSON.stringify(prof)})`);
  let n = kb.sent.length;
  let e;
  for (const val of [3, 1]) {
    e = await refusal(() => d.write('profile', val));
    check(/read-only/.test(e?.message || '') && kb.state.sector === 1, `profile ${val} refused as read-only (${e?.message})`);
  }
  check(kb.sent.length === n, 'a profile write sends nothing (no fn 0x30, not even a read)');
  e = await refusal(() => d.write('profile', 4));
  check(/one of/.test(e?.message || '') && kb.state.sector === 1, `profile 4 of 3 refused (${e?.message})`);
  // a built-in (read-only) profile in use is not reported, and named in info
  kb.state.sector = 0x0101;
  v = await d.read();
  check(v.profile === undefined && /built-in read-only profile 1/.test((await d.info())['Active profile'] || ''), 'a built-in profile is shown in info, not as a profile number');
  kb.state.sector = 1;
  // report rate: onboard mode -> waiting, nothing sent
  n = kb.sent.length;
  e = await refusal(() => d.write('reportRate', 500));
  check(e?.waiting === true && /Host/.test(e.message) && !kb.sent.slice(n).some((b) => b[1] === 5 && (b[2] & 0xf0) === 0x30), `report rate in onboard mode waits, unsent (${e?.message})`);
  check((await d.write('mode', 'host')) === 'host' && kb.state.mode === 2 && kb.sent.some((b) => h(b.slice(0, 4)) === '01 06 1b 02'), 'host mode = 01 06 1B 02, read back');
  e = await refusal(() => d.write('profile', 2));
  check(/read-only/.test(e?.message || '') && kb.state.sector === 1, 'profile select is refused in host mode too');
  n = kb.sent.length;
  check((await d.write('reportRate', 250)) === 250 && kb.state.rateIndex === 1 && kb.sent.slice(n).some((b) => h(b.slice(0, 4)) === '01 05 3b 01'), '250 Hz = 01 05 3B 01 (0x8061 index 1), read back');
  e = await refusal(() => d.write('reportRate', 8000));
  check(/one of/.test(e?.message || '') && kb.state.rateIndex === 1, `8000 Hz (not in its list) refused (${e?.message})`);
  check((await d.write('reportRate', 1000)) === 1000 && (await d.write('mode', 'onboard')) === 'onboard' && kb.state.mode === 1, 'rate and mode put back');
  // Windows-key lock: one bit, the others kept
  kb.state.disabled = 0x02;
  n = kb.sent.length;
  check((await d.write('lockWinKey', true)) === true && kb.state.disabled === 0x12 && kb.sent.slice(n).some((b) => h(b.slice(0, 4)) === '01 08 2b 12'), 'Windows key off = 01 08 2B 12 (Num Lock bit kept)');
  check((await d.write('lockWinKey', false)) === false && kb.state.disabled === 0x02, 'Windows key back on, Num Lock bit still kept');
  check((await d.write('lockNumLock', false)) === false && kb.state.disabled === 0x00, 'Num Lock lock put back');
  e = await refusal(() => d.write('lockWinKey', 1));
  check(/true \/ false/.test(e?.message || ''), 'a toggle takes true / false only');
  // F-key swap
  n = kb.sent.length;
  check((await d.write('fnSwap', false)) === false && kb.state.fnSwap === 0 && kb.sent.slice(n).some((b) => h(b.slice(0, 4)) === '01 09 1b 00'), 'F-key swap off = 01 09 1B 00, read back');
  check((await d.write('fnSwap', true)) === true && kb.state.fnSwap === 1, 'F-key swap put back');
  // brightness: steps, off through on/off, back on
  n = kb.sent.length;
  check((await d.write('brightness', 25)) === 25 && kb.state.level === 25 && kb.sent.slice(n).some((b) => h(b.slice(0, 4)) === '01 0b 4b 01') && kb.sent.slice(n).some((b) => h(b.slice(0, 5)) === '01 0b 2b 00 19'), 'brightness 25 = on (4B 01) then level (2B 00 19)');
  n = kb.sent.length;
  check((await d.write('brightness', 0)) === 0 && kb.state.on === false && !kb.sent.slice(n).some((b) => b[1] === 11 && (b[2] & 0xf0) === 0x20), 'brightness 0 = off through 0x40 [00], no level written');
  e = await refusal(() => d.write('brightness', 40));
  check(/one of/.test(e?.message || ''), `a level between the keyboard's steps is refused (${e?.message})`);
  check((await d.write('brightness', 100)) === 100 && kb.state.on && kb.state.level === 100, 'brightness put back to 100');
  // an error reply
  kb.failNext = 0x05;
  e = await refusal(() => d.write('fnSwap', false));
  check(e instanceof HidppError && e.code === 5 && kb.state.fnSwap === 1, `an error reply is reported with its code (${e?.message})`);
  // G HUB running
  app.name = 'lghub.exe';
  n = kb.sent.length;
  for (const [k, val] of [['mode', 'host'],['lockWinKey', true], ['fnSwap', false], ['brightness', 50]]) {
    e = await refusal(() => d.write(k, val));
    check(/G HUB/.test(e?.message || '') && e.waiting === true, `${k} refused while G HUB runs (${e?.message})`);
  }
  check(kb.sent.length === n, 'nothing was sent while G HUB runs');
  app.name = null;
  // never: profile memory, DFU, pairing
  for (const fn of [0x50, 0x60, 0x70, 0x80]) { e = await refusal(() => d.call(F.ONBOARD_PROFILES, fn, [0, 0])); check(/refused/.test(e?.message || ''), `call() refuses 0x8100 fn 0x${fn.toString(16)}`); }
  for (const id of NEVER) { e = await refusal(() => d.call(id, 0x00)); check(/refused/.test(e?.message || ''), `call() refuses 0x${id.toString(16)}`); }
  check(kb.sent.filter((b) => b[1] === 6).every((b) => [0x00, 0x10, 0x20, 0x30, 0x40].includes(b[2] & 0xf0)), '0x8100: only info, mode and profile functions were sent');
  check(!kb.sent.some((b) => b[1] === 6 && (b[2] & 0xf0) === 0x30), '0x8100 fn 0x30 (profile select) was never sent');
  const bat = await d.battery();
  check(bat.percent === 81 && bat.charging === false, `battery ${JSON.stringify(bat)}`);
  v = await d.read();
  check(d.settings.every((s) => v[s.key] === undefined || fits(s, v[s.key])), 'every value read fits its setting');
  check(kb.bad.length === 0, `frames well formed (${kb.bad.join('; ')})`);
  const raw = await d.rawBackup();
  check(raw.features['0x4521']?.index === 8 && raw.values.brightness === 100, 'rawBackup holds features and values');
  await selfChecked(d, kb.state, { waiting: ['reportRate'] });

  // driver safety (22 Oct 2026): the self-check really sends each value it read (nothing skipped as unchanged); reads go
  // on while G HUB runs and every write is refused; an F-key byte that is neither 0 nor 1 is never written back as one
  {
    const { selfCheck } = await import('../helpers/my-devices.mjs');
    const writesOf = (from) => kb.sent.slice(from).filter((b) => (b[1] === 6 && (b[2] & 0xf0) === 0x10) || (b[1] === 8 && (b[2] & 0xf0) === 0x20) || (b[1] === 9 && (b[2] & 0xf0) === 0x10) || (b[1] === 11 && [0x20, 0x40].includes(b[2] & 0xf0)));
    let n0 = kb.sent.length;
    const r = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
    const w = writesOf(n0).map((b) => h(b.slice(1, 3)));
    check(r.keys?.mode?.ok && r.keys?.fnSwap?.ok && r.keys?.brightness?.ok && ['06 1b', '08 2b', '09 1b', '0b 2b'].every((x) => w.includes(x)), `the self-check really sent mode, key locks, F-key swap and brightness (${w})`);
    app.name = 'lghub.exe';
    const v2 = await d.read();
    check(v2.fnSwap === true && v2.mode === 'onboard', 'reads go on while G HUB runs');
    n0 = kb.sent.length;
    e = await refusal(() => d.write('fnSwap', true));
    check(/G HUB/.test(e?.message || '') && kb.sent.length === n0, 'a same-value write is refused while G HUB runs, nothing sent');
    app.name = null;
    kb.state.fnSwap = 2;
    check((await d.read()).fnSwap === null, 'raw F-key byte 2 reads as not on / off');
    n0 = kb.sent.length;
    const r2 = await selfCheck(d, d.write, { only: ['fnSwap'], previous: r, backup: async () => true, makerApp: async () => null });
    check(!r2.keys?.fnSwap?.ok && kb.state.fnSwap === 2 && !writesOf(n0).length, `raw 2 is never written back (${JSON.stringify(r2.keys?.fnSwap)})`);
    kb.state.fnSwap = 1;
  }
}

// ---- 2. a wired G815: 0x8060, old F-key swap, a brightness slider without steps or on/off, no locks ----
{
  const kb = simKeyboard({ pid: 0xc33f, slot: 0xff, features: { [F.REPORT_RATE]: 3, [F.ONBOARD_PROFILES]: 4, [F.FN_INVERSION]: 5, [F.BRIGHTNESS]: 6 },
    state: { rateMs: 1, mode: 2, sector: 2, fnSwap: 0, level: 300, on: true }, rateMask: 0x8b, profiles: 3, bright: { max: 1000, steps: 0, onOff: false, min: 10 } });
  const d = make(kb);
  check(await d.connect() && d.index === 0xff, 'wired G815 connects at index 0xFF');
  check(/G815/.test((await d.info()).Model), 'the wired model is named from its product id');
  const br = d.settings.find((s) => s.key === 'brightness');
  check(br.type === 'slider' && br.min === 10 && br.max === 1000, `brightness slider from the info read (${JSON.stringify(br)})`);
  check(!d.settings.some((s) => s.key.startsWith('lock')), 'no key locks without 0x4521');
  let v = await d.read();
  check(v.mode === 'host' && v.profile === undefined && v.reportRate === 1000 && v.fnSwap === false && v.brightness === 300, `G815 read: ${JSON.stringify(v)}`);
  check((await d.write('reportRate', 500)) === 500 && kb.state.rateMs === 2 && kb.sent.some((b) => h(b.slice(0, 4)) === 'ff 03 2b 02'), '500 Hz = FF 03 2B 02 (0x8060 [ms])');
  check((await d.write('reportRate', 1000)) === 1000, 'rate put back');
  check((await d.write('fnSwap', true)) === true && kb.sent.some((b) => h(b.slice(0, 4)) === 'ff 05 1b 01') && (await d.write('fnSwap', false)) === false, 'old F-key swap 0x40A0 = FF 05 1B 01, put back');
  check((await d.write('brightness', 640)) === 640 && kb.sent.some((b) => h(b.slice(0, 5)) === 'ff 06 2b 02 80') && !kb.sent.some((b) => b[1] === 6 && (b[2] & 0xf0) === 0x40), 'brightness 640 = FF 06 2B 02 80, no on/off write');
  let e = await refusal(() => d.write('brightness', 5));
  check(/10-1000/.test(e?.message || '') && kb.state.level === 640, `brightness below the minimum refused (${e?.message})`);
  e = await refusal(() => d.write('brightness', 1001));
  check(/10-1000/.test(e?.message || ''), 'brightness above the maximum refused');
  check((await d.write('brightness', 300)) === 300 && kb.state.level === 300, 'brightness put back');
  check((await d.battery()) === null, 'a wired keyboard without battery features has no battery');
  // in onboard mode (the usual state) the profile is checked and the report rate waits for host mode
  kb.state.mode = 1;
  await selfChecked(d, kb.state, { waiting: ['reportRate'] });
  kb.state.mode = 2;
}

// ---- 2b. a G915 on its second receiver C547 (OpenRGB LogitechControllerDetect.cpp; docs/brands/logitech.md section 1) ----
{
  check(PIDS.includes(0xc547), 'C547 is one of the product ids of the driver');
  const kb = simKeyboard({ pid: 0xc547, slot: 1, features: { [F.UNIFIED_BATTERY]: 2, [F.DISABLE_KEYS]: 8, [F.NEW_FN_INVERSION]: 9 },
    state: { percent: 55, charge: 1, disabled: 0x00, fnSwap: 1 }, rateMask: 0, profiles: 0, disableMask: 0x1f, bright: {} });
  const d = make(kb);
  check(await d.connect() && d.index === 1 && /G915 receiver C547/.test((await d.info()).Model), 'a G915 on receiver C547 connects on slot 1');
  check((await d.write('lockWinKey', true)) === true && (await d.write('lockWinKey', false)) === false && kb.state.disabled === 0, 'and writes and puts back on C547');
}

// ---- 3. a mouse on a keyboard receiver (slot 1 silent, slot 2 answers) is refused ----
{
  const mouse = simKeyboard({ pid: 0xc545, slot: 2, features: { [F.ADJUSTABLE_DPI]: 3 }, state: {}, rateMask: 0, profiles: 0, disableMask: 0, bright: {} });
  const e = await refusal(() => make(mouse).connect());
  check(/mouse/.test(e?.message || ''), `a mouse is left to the mouse driver (${e?.message})`);
  const m547 = simKeyboard({ pid: 0xc547, slot: 1, features: { [F.ADJUSTABLE_DPI]: 3 }, state: {}, rateMask: 0, profiles: 0, disableMask: 0, bright: {} });
  const e2 = await refusal(() => make(m547).connect());
  check(/mouse/.test(e2?.message || ''), `a mouse on C547 is refused too (${e2?.message})`);
}

// ---- 4. the library entry ----
{
  const d = createLogitechKeyboard({ open: async () => null, vendorApp: async () => null });
  check((await d.connect()) === false, 'nothing plugged in: connect() is false');
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'logitech-hidpp-keyboard', 'device.json'), 'utf8'));
  check(validateMeta(meta) === null && meta.status === 'untested' && meta.tested.length === 0, `device.json well formed and untested (${validateMeta(meta)})`);
  check(meta.pids.map((p) => parseInt(p, 16)).sort().join() === [...PIDS].sort().join() && meta.id === d.id, 'device.json lists exactly the driver\'s ids');
  const mouse = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'logitech-hidpp-mouse', 'device.json'), 'utf8'));
  check(!meta.pids.some((p) => mouse.pids.includes(p)), 'no product id is shared with the mouse driver');
}

// ---- 5. Bluetooth (22 Oct 2026, docs/handoff/logitech-ble.md): the G915 TKL on its Bluetooth id B35F (Linux
// hid-logitech-hidpp.c). HID++ 2.0 at device index 0xFF, replies with index 0x00 (Solaar base.py), the collection with
// 19-byte reports on any page, no report rate; the same bytes and values as on its cable ----
{
  check(PIDS.includes(0xb35f) && BLE[0xb35f] === 'G915 TKL' && Object.keys(BLE).length === 1, 'B35F (G915 TKL over Bluetooth) is the one Bluetooth id');
  check(Object.keys(BLE).every((p) => Number(p) >= 0xb317 && Number(p) <= 0xb3ff), 'every Bluetooth id is in Solaar\'s Bluetooth keyboard range 0xB317-0xB3FF');
  check(ownClash('046d', PIDS.map((p) => p.toString(16))).length === 0, 'no keyboard id (Bluetooth included) is one DeviceHub runs itself (pc-map RUNS)');

  // the channel: filters from the driver's own open, then hid-host's names, with a stand-in for the native helper
  const { createRequire } = await import('node:module');
  const native = createRequire(import.meta.url)('../helpers/native.js');
  const lines = [];
  native.request = async (chan, cmd) => { lines.push(`${chan} ${cmd}`); return cmd === 'OPEN' && chan.startsWith('hid:046D:B35F:') ? 'OK' : 'NONE'; };
  native.onEvent = () => {};
  const host = await import('../helpers/hid-host.mjs');
  const { setDeviceProvider } = await import('../public/devices/hid.js');
  const asked = [];
  setDeviceProvider(async (filters) => { asked.push(filters); return null; });
  const plain = createLogitechKeyboard({ vendorApp: async () => null });
  check((await plain.connect()) === false && asked.length === PIDS.length, 'the driver asks once per product id');
  const bleFilter = asked.find((f) => f[0].productId === 0xb35f), usbFilter = asked.find((f) => f[0].productId === 0xc343);
  check(bleFilter.length === 1 && bleFilter[0].usagePage === undefined && usbFilter[0].usagePage === 0xff00 && usbFilter[0].usage === 0x0002, `Bluetooth asks without a usage page, the cable on FF00 / 0002 (${JSON.stringify(bleFilter)} / ${JSON.stringify(usbFilter)})`);
  setDeviceProvider(null);
  const specs = hidSpecs(plain);
  const bs = specs.find((s) => s.pid === 'B35F');
  check(bs && bs.page === '*' && bs.usage === '*' && bs.inputLen === 19 && bs.outputLen === 19 && bs.reportId === 0x11 && bs.reply === 'raw', `the B35F spec: any page / usage, 19-byte input and output, report 0x11, raw (${JSON.stringify(bs)})`);
  check(specs.filter((s) => s.pid !== 'B35F').every((s) => s.page === 'FF00' && s.usage === '0002' && s.inputLen === undefined && s.outputLen === undefined), 'every USB id keeps the FF00 / 0002 spec it had');
  for (const s of specs) host.addSpec(s);
  const hb = await host.provider(bleFilter);
  check(hb && lines.includes('hid:046D:B35F:*:*:19:17:il=19:ol=19:rw=1 OPEN'), `Bluetooth channel = hid:046D:B35F:*:*:19:17:il=19:ol=19:rw=1 (${lines.filter((l) => /B35F/.test(l)).join(' | ')})`);
  check(hb?.spec.never === true, 'the never list is checked on the Bluetooth channel too');
  await host.provider(usbFilter);
  check(lines.includes('hid:046D:C343:FF00:0002:19:17:rw=1 OPEN'), `the cable's channel name is unchanged (${lines.filter((l) => /C343/.test(l)).join(' | ')})`);
  hb?.close();

  const feats = { [F.UNIFIED_BATTERY]: 2, [F.ONBOARD_PROFILES]: 6, [F.DISABLE_KEYS]: 8, [F.NEW_FN_INVERSION]: 9, [F.BRIGHTNESS]: 11 };
  const st = () => ({ percent: 66, charge: 0, mode: 1, sector: 1, disabled: 0x00, fnSwap: 1, level: 100, on: true });
  const kit = { profiles: 3, disableMask: 0x1f, bright: { max: 100, steps: 5, onOff: true, min: 1 } };
  const run = async (kb, app = { name: null }) => {
    const d = make(kb, app);
    check(await d.connect(), `keyboard ${kb.productId.toString(16)} connects`);
    const n0 = kb.sent.length;
    const vals = await d.read();
    const w = [await d.write('lockWinKey', true), await d.write('lockWinKey', false), await d.write('fnSwap', false), await d.write('fnSwap', true),
      await d.write('brightness', 25), await d.write('brightness', 100), await d.write('mode', 'host'), await d.write('mode', 'onboard')];
    const bat = await d.battery();
    return { d, vals, w, bat, frames: kb.sent.slice(n0).map(h), keys: d.settings.map((s) => s.key).join(), info: await d.info() };
  };
  const cable = await run(simKeyboard({ pid: 0xc343, slot: 0xff, features: feats, state: st(), rateMask: 0, ...kit }));
  const bt = simKeyboard({ pid: 0xb35f, slot: 0xff, replyIndex: 0x00, features: { ...feats, [F.EXT_REPORT_RATE]: 5, [F.REPORT_RATE]: 4 }, state: { ...st(), rateIndex: 3 }, rateExt: true, rateMask: 0x0f, ...kit });
  const app = { name: null };
  const ble = await run(bt, app);
  const d = ble.d;
  check(d.ble === true && d.index === 0xff && h(bt.sent[0].slice(0, 6)) === 'ff 00 1b 00 00 5a', `Bluetooth: ping at index 0xFF, no receiver slots (${h(bt.sent[0].slice(0, 6))})`);
  check(bt.sent.every((b) => b[0] === 0xff) && bt.bad.length === 0, `Bluetooth: every request a 19-byte long report to 0xFF (${bt.bad.join('; ')})`);
  check(!lookedUp(bt).some((id) => id === 0x8060 || id === 0x8061) && !lookedUp(bt).some((id) => NEVER.includes(id)), `Bluetooth: neither report rate nor any never-list feature is looked up (${lookedUp(bt).map((x) => x.toString(16))})`);
  check(ble.keys === 'mode,profile,lockWinKey,lockCapsLock,lockNumLock,lockScrollLock,lockInsert,fnSwap,brightness' && ble.keys === cable.keys, `Bluetooth: the cable's settings, no report rate (${ble.keys})`);
  check(JSON.stringify(ble.vals) === JSON.stringify(cable.vals) && ble.vals.fnSwap === true && ble.vals.brightness === 100, `Bluetooth reads the same values (${JSON.stringify(ble.vals)})`);
  check(ble.frames.join('|') === cable.frames.join('|') && ble.frames.length > 10, `Bluetooth sends the same bytes as the cable (${ble.frames.length} frames)`);
  check(ble.frames.includes(h([0xff, 8, 0x2b, 0x10, ...Array(15).fill(0)])), 'Windows key off over Bluetooth = FF 08 2B 10');
  check(ble.w.join() === 'true,false,false,true,25,100,host,onboard' && JSON.stringify(bt.state) === JSON.stringify({ ...st(), rateIndex: 3 }), 'Bluetooth: each write read back and put back; the keyboard ends as it started');
  check(JSON.stringify(ble.bat) === JSON.stringify(cable.bat) && ble.bat.percent === 66, `Bluetooth battery the same (${JSON.stringify(ble.bat)})`);
  check(ble.info.Connection === 'Bluetooth' && ble.info.Model === 'Logitech G915 TKL' && cable.info.Connection === 'USB cable', `info: ${ble.info.Model}, ${ble.info.Connection}`);
  let e = await refusal(() => d.write('reportRate', 1000));
  check(/not a setting/.test(e?.message || '') && bt.state.rateIndex === 3, `Bluetooth: report rate is not a setting (${e?.message})`);
  for (const id of [0x1816, 0x0309, 0x1500]) { e = await refusal(() => d.call(id, 0x00)); check(/refused/.test(e?.message || ''), `Bluetooth: call() refuses pairing feature 0x${id.toString(16)}`); }
  app.name = 'lghub_agent.exe';
  let n = bt.sent.length;
  e = await refusal(() => d.write('fnSwap', false));
  check(/G HUB/.test(e?.message || '') && e.waiting === true && bt.sent.length === n, 'Bluetooth: refused while G HUB runs, nothing sent');
  app.name = null;
  bt.failNext = 0x05;
  e = await refusal(() => d.write('fnSwap', false));
  check(e instanceof HidppError && e.code === 5 && bt.state.fnSwap === 1, `Bluetooth: an error reply with index 0x00 is reported with its code (${e?.message})`);
  await selfChecked(d, bt.state);
}

// ---- 6. receiver slots (22 Oct 2026, docs/handoff/logitech-c539.md): a G915 receiver with a mouse in slot 1 and the
// keyboard in slot 2; a mouse alone (stepped aside, no error); nothing answering (asleep); one owner per slot ----
{
  const { SLOT_OWNERS } = await import('../device-library/logitech-hidpp-keyboard/device.mjs');
  const mouseOwners = (await import('../device-library/logitech-hidpp-mouse/device.mjs')).SLOT_OWNERS;
  const { NOT_A_FAULT } = await import('../helpers/auto-report.mjs');
  check(SLOT_OWNERS === mouseOwners, 'the keyboard and mouse drivers share one slot-owner table');
  const simReceiver = (pid, kids) => ({
    opened: false, productId: pid, sent: [], closed: 0, kids,
    async open() { this.opened = true; },
    close() { this.closed++; },
    addEventListener(t, fn) { for (const k of Object.values(kids)) k.addEventListener(t, fn); },
    removeEventListener(t, fn) { for (const k of Object.values(kids)) k.removeEventListener(t, fn); },
    async sendReport(id, data) { this.sent.push(Array.from(data)); const k = kids[data[0]]; if (k && !k.asleep) return k.sendReport(id, data); },
  });
  const kit = { state: { percent: 80, charge: 0, mode: 2 }, rateMask: 0, profiles: 0, disableMask: 0, bright: {} };
  const mouse = (pid, slot) => simKeyboard({ pid, slot, features: { [F.ADJUSTABLE_DPI]: 3 }, ...kit });
  const board = (pid, slot) => simKeyboard({ pid, slot, features: { [F.UNIFIED_BATTERY]: 2 }, ...kit });

  let rx = simReceiver(0xc541, { 1: mouse(0xc541, 1), 2: board(0xc541, 2) });
  let d = make(rx);
  check(await d.connect() && d.index === 2 && !d.asleep && SLOT_OWNERS.get('C541:2') === d.id, `G915 receiver: mouse in slot 1 left alone, keyboard in slot 2 run (slot ${d.index})`);
  check(rx.sent.filter((b) => b[0] === 1).every((b) => b[1] === 0 && [0x00, 0x10].includes(b[2] & 0xf0)), 'the mouse in slot 1 got only ping and getFeature');
  check((await d.battery())?.percent === 80, 'the keyboard in slot 2 reads');

  rx = simReceiver(0xc545, { 1: mouse(0xc545, 1) });
  d = make(rx);
  let e = await refusal(() => d.connect());
  check(e?.notMine === true && /mouse/.test(e.message) && rx.closed === 1 && d.chan === null && NOT_A_FAULT.test(e.message), `a mouse alone: stepped aside, receiver let go, not a fault (${e?.message})`);

  const sleepy = board(0xc541, 1); sleepy.asleep = true;
  rx = simReceiver(0xc541, { 1: sleepy });
  d = make(rx);
  check((await d.connect()) === true && d.asleep && rx.sent.length === 6, 'nothing answering: asleep, one ping per slot');
  e = await refusal(() => d.read());
  check(/asleep/.test(e?.message || '') && NOT_A_FAULT.test(e.message), `asleep: read says so (${e?.message})`);
  e = await refusal(() => d.write('fnSwap', true));
  check(e?.waiting === true, 'asleep: a write waits');
  sleepy.asleep = false; d.wokeAt = 0;
  check((await d.awake()) === true && d.index === 1 && !d.asleep, 'switched on: found in slot 1');

  // one owner per slot: slot 1 held by the mouse driver is never asked
  SLOT_OWNERS.clear();
  SLOT_OWNERS.set('C541:1', 'logitech-hidpp-mouse');
  rx = simReceiver(0xc541, { 1: board(0xc541, 1), 2: board(0xc541, 2) });
  d = make(rx);
  check(await d.connect() && d.index === 2 && !rx.sent.some((b) => b[0] === 1), 'a slot the mouse driver holds is skipped');
  SLOT_OWNERS.clear();
}

console.log(fails.length ? `sim-logitech-keyboard: FAILED: ${fails.join('; ')}` : 'sim-logitech-keyboard (Logitech HID++ keyboard driver, simulated): all good');
process.exit(fails.length ? 1 : 0);
