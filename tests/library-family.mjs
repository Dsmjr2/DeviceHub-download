// A brand's new model with nothing to learn (24 Oct 2026): a device-library entry with a family ("FF00:0002", the
// protocol's own HID collection) matches a model it does not list, only with that collection, never an id another entry
// names; the install keeps the extra id (library.json familyPids) and a copy already installed gets it added.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { match, installFromLibrary, validateMeta, ROOT } from '../helpers/device-library.mjs';
import { addFamilyPids, libraryMark } from '../helpers/my-devices.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const usb = [{ vid: '046d', pid: 'c0ff', name: 'new Logitech mouse', pages: ['FF00:0001', 'FF00:0002'] }, { vid: '046d', pid: '0825', name: 'webcam', pages: [] }, { vid: '046d', pid: 'c539', name: 'receiver', pages: ['FF00:0002'] }];
const m = match(usb, { root: ROOT, readOnly: true, untested: true });
const mouse = m.find((x) => x.name === 'logitech-hidpp-mouse'), kb = m.find((x) => x.name === 'logitech-hidpp-keyboard');
check(mouse?.familyPids?.join() === 'c0ff' && kb?.familyPids?.join() === 'c0ff', `an unlisted Logitech model with the HID++ collection matches both Logitech drivers by family (${JSON.stringify(m.map((x) => [x.name, x.familyPids]))})`);
check(!m.some((x) => (x.familyPids || []).includes('0825')), 'a Logitech webcam (no HID++ collection) is not matched');
check(!m.some((x) => (x.familyPids || []).includes('c539')), 'a listed id is never taken by a family');
check(!match([{ vid: '046d', pid: 'c0ff', pages: ['FF43:0602'] }], { root: ROOT, readOnly: true, untested: true }).some((x) => x.familyPids), 'another collection: no family match');
check(validateMeta({ id: 'x-y', vendor: 'v', product: 'p', kind: 'Mouse', vid: '1234', pids: ['0001'], models: ['m'], status: 'untested', works: [], tested: [], family: ['00FF:1'] }) !== null, 'a family that is not a vendor collection is refused');

// install keeps the family id; a copy already there gets a new one added (kept in library.json)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fam-'));
fs.cpSync(path.join(ROOT, 'device-library', 'logitech-hidpp-mouse'), path.join(root, 'device-library', 'logitech-hidpp-mouse'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(root, 'public'), { recursive: true });
fs.cpSync(path.join(ROOT, 'helpers'), path.join(root, 'helpers'), { recursive: true, filter: (s) => !/[\\/]bin([\\/]|$)/.test(s) });
const r = await installFromLibrary('logitech-hidpp-mouse', { root, readOnly: true, familyPids: ['c0ff'] });
check(r.ok, `installed (${r.error})`);
const folder = path.join(root, 'my-devices', 'logitech-hidpp-mouse');
check(libraryMark(folder)?.familyPids?.join() === 'c0ff', 'the family id is kept in library.json');
check(addFamilyPids(root, 'logitech-hidpp-mouse', ['C0FE', 'c0ff']).join() === 'C0FE' && libraryMark(folder).familyPids.join() === 'c0ff,c0fe', 'a new family id is added to the copy once');
check(addFamilyPids(root, 'logitech-hidpp-mouse', ['c0fe']).length === 0, 'the same id is not added twice');
fs.rmSync(root, { recursive: true, force: true });

// ---- the families by brand (1 Nov 2026): Corsair Bragi FF42:0001 added; SteelSeries, Razer Kraken, HyperX refused ----
const fam = (u) => match(u, { root: ROOT, readOnly: true, untested: true }).filter((x) => x.familyPids).map((x) => `${x.name}:${x.familyPids.join()}`).sort().join(' ');
check(fam([{ vid: '1b1c', pid: '1c77', name: 'new Corsair mouse', pages: ['FF42:0001'] }]) === 'corsair-bragi-peripherals:1c77', `an unlisted Corsair id with the Bragi collection matches the Corsair mouse and keyboard driver only (${fam([{ vid: '1b1c', pid: '1c77', pages: ['FF42:0001'] }])})`);
check(fam([{ vid: '1b1c', pid: '1c77', pages: [] }, { vid: '1b1c', pid: '1c78', pages: ['FF1B:0001'] }]) === '', 'a Corsair id without the Bragi collection is not matched');
const corsairHeadset = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'corsair-bragi-headset', 'device.json'), 'utf8'));
check(fam([{ vid: '1b1c', pid: corsairHeadset.pids[0], pages: ['FF42:0001'] }]) === '', 'a Corsair headset the headset entry lists is never taken by family');
check(fam([{ vid: '1b1c', pid: '1c77', pages: ['FF42:0002'] }]) === '', 'another usage on FF42: no family match');
// refused: one SteelSeries collection is shared by headsets, mice and keyboards with different command sets; Razer
// Kraken V4 has no library driver; HyperX has a different frame per generation
for (const [u, why] of [[{ vid: '1038', pid: '2ff0', pages: ['FFC0:0001'] }, 'SteelSeries FFC0:0001'], [{ vid: '1038', pid: '12ff', pages: ['FF43:0202'] }, 'SteelSeries FF43:0202'],
  [{ vid: '1532', pid: '05ff', pages: ['FF14:0001'] }, 'Razer FF14:0001'], [{ vid: '03f0', pid: '0fff', pages: ['FF90:0303', 'FF00:0001'] }, 'HyperX (HP)'], [{ vid: '0951', pid: '1fff', pages: ['FF00:0001'] }, 'HyperX (Kingston)']]) {
  check(fam([u]) === '', `${why}: no family (${fam([u])})`);
}
for (const n of ['steelseries-mouse', 'steelseries-apex', 'steelseries-arctis', 'razer-mouse', 'razer-keyboard', 'hyperx-cloud', 'hyperx-peripherals', 'hyperx-kingston', 'hyperx-kingston-peripherals']) {
  check(!JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', n, 'device.json'), 'utf8')).family, `${n} has no family (its protocol differs between models)`);
}

// 2 Nov 2026: the owner's HS80 (DeviceHub's own Headset page, pc-map RUNS) has the Bragi collection too; it is never
// matched by family, so it no longer makes auto setup skip the whole entry beside a listed Corsair mouse
{
  const hs80 = ['0a6b', '0a69', '0a6a', '0a71'].map((pid) => ({ vid: '1b1c', pid, name: 'CORSAIR HS80 RGB Wireless', pages: ['FF42:0001'] }));
  const both = [...hs80, { vid: '1b1c', pid: '1bf0', name: 'CORSAIR M75', pages: ['FF42:0001'] }];
  const e = match(both, { root: ROOT, readOnly: true }).find((x) => x.name === 'corsair-bragi-peripherals');
  check(e && e.matched.map((u) => u.pid).join() === '1bf0' && !e.familyPids, `an HS80 beside a listed M75: the entry matches the M75 only, no family ids (${JSON.stringify(e && [e.matched, e.familyPids])})`);
  const { FAMILY_NEVER } = await import('../device-library/corsair-bragi-peripherals/device.mjs');
  check(['0A69', '0A6A', '0A6B', '0A71'].every((p) => FAMILY_NEVER.includes(p)), 'every HS80 id DeviceHub runs is in the driver\'s FAMILY_NEVER');
  const { run: autoRun } = await import('../helpers/auto-setup.mjs');
  const r3 = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fam3-'));
  fs.cpSync(path.join(ROOT, 'device-library', 'corsair-bragi-peripherals'), path.join(r3, 'device-library', 'corsair-bragi-peripherals'), { recursive: true });
  const usbNow = [...hs80.slice(0, 1).map((u) => ({ ...u, runs: 'Headset page' })), both.at(-1)];
  const rec = await autoRun({ root: r3, usb: usbNow, load: async () => [], examples: false });
  const got = rec.lastRun.installed.find((x) => x.name === 'corsair-bragi-peripherals');
  check(got && fs.existsSync(path.join(r3, 'my-devices', 'corsair-bragi-peripherals', 'device.mjs')) && !rec.lastRun.skipped.some((x) => x.name === 'corsair-bragi-peripherals'),
    `auto setup installs the Corsair mouse and keyboard driver beside the HS80 (${JSON.stringify(rec.lastRun)})`);
  fs.rmSync(r3, { recursive: true, force: true });
}

// a helper-channel driver (no hid) installed with a family id: my-devices hands the ids to it, and it is read-only
{
  const { load } = await import('../helpers/my-devices.mjs');
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fam2-'));
  fs.cpSync(path.join(ROOT, 'device-library', 'corsair-bragi-peripherals'), path.join(r2, 'device-library', 'corsair-bragi-peripherals'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public'), path.join(r2, 'public'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'helpers'), path.join(r2, 'helpers'), { recursive: true, filter: (s) => !/[\\/]bin([\\/]|$)/.test(s) });
  const ri = await installFromLibrary('corsair-bragi-peripherals', { root: r2, readOnly: true, familyPids: ['1c77'] });
  check(ri.ok, `Corsair installed with a family id (${ri.error})`);
  // 2 Nov 2026: Learn a device lists an unlisted Corsair id the Bragi family runs as having a driver (the copy's
  // library.json familyPids, or the entry's family by its HID collection), never as a new device to learn again
  {
    const lw = await import('../helpers/learn-wizard.mjs');
    const col = (pid, page) => ({ vid: '1B1C', pid, iface: 1, col: 1, page, usage: '0001', inLen: 65, outLen: 65, featLen: 0, inIds: [], outIds: [], featIds: [], product: `Corsair ${pid}` });
    const route = async (method, step, body) => { let out = null; await lw.handle(new URL(`http://x/api/learn/${step}`), { method }, {}, (res, code, j) => { out = { code, ...j }; }, async () => body); return out; };
    const listWith = async (r) => {
      lw.options.root = r; lw.options.preflight = false;
      lw.options.deps = { ...lw.deps, listHid: async () => ({ collections: [col('1C77', 'FF42'), col('1C78', 'FF42'), col('1C79', 'FF00')] }) };
      return Object.fromEntries(((await route('GET', 'devices')).devices || []).map((d) => [d.pid, d]));
    };
    const by = await listWith(r2);
    check(by['1C77']?.library && by['1C77'].driver?.where === 'my-devices' && by['1C77'].ready?.name === 'corsair-bragi-peripherals', `an id in the copy's familyPids is listed with its driver, ready (${JSON.stringify(by['1C77'])})`);
    check(by['1C78']?.library && by['1C78'].ready?.name === 'corsair-bragi-peripherals', `an id the installed entry's family matches (not yet in familyPids) is listed with that copy (${JSON.stringify(by['1C78'])})`);
    check(!by['1C79']?.library && !by['1C79']?.driver, `a Corsair id without the Bragi collection has no driver: the control (${JSON.stringify(by['1C79'])})`);
    const b1 = await route('POST', 'begin', { vid: '1B1C', pid: '1C77' });
    check(b1.ok === false && /already has a driver/.test(b1.error || ''), `Learn it is not offered as a new device for it (${JSON.stringify(b1)})`);
    await route('POST', 'quit');
    // not installed yet: the library entry is its driver, found by family; Learn would add beside it, never a new driver
    const r4 = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fam4-'));
    fs.cpSync(path.join(ROOT, 'device-library', 'corsair-bragi-peripherals'), path.join(r4, 'device-library', 'corsair-bragi-peripherals'), { recursive: true });
    const by4 = await listWith(r4);
    check(by4['1C77']?.library && by4['1C77'].driver?.where === 'library' && by4['1C77'].driver.name === 'corsair-bragi-peripherals' && by4['1C77'].note === lw.ADDS_BESIDE_NOTE, `a library-only family match is listed as having a driver (${JSON.stringify(by4['1C77'])})`);
    const b4 = await route('POST', 'begin', { vid: '1B1C', pid: '1C77' });
    check(b4.ok && b4.addsTo?.name === 'corsair-bragi-peripherals', `and learning it adds to that driver, not a new one (${JSON.stringify(b4.addsTo || b4.error)})`);
    await route('POST', 'quit');
    fs.rmSync(r4, { recursive: true, force: true });
    lw.options.deps = lw.deps; lw.options.root = ROOT;
  }
  const reg = {};
  const loaded = await load(r2, { register: (a) => { reg[a.id] = a; }, addSpec() {}, taken: (id) => !!reg[id], selfCheck: {} });
  const a = reg['corsair-bragi-peripherals'];
  check(a && JSON.stringify(a.familyPids) === '["1C77"]', `the loaded Corsair driver gets its family ids (${JSON.stringify(loaded)} ${JSON.stringify(a?.familyPids)})`);
  check(a?.library?.status === 'read-only' && !a.library.proven, 'it is loaded guarded and read-only (no real-device record)');
  const e = await a.write('polling', 500).then(() => null, (x) => x);
  check(e && /read-only|Turn on settings/.test(e.message), `a write before Turn on settings is refused by the guard (${e?.message})`);
  check(addFamilyPids(r2, 'corsair-bragi-peripherals', ['1c78']).join() === '1C78' && a.familyPids.join() === '1C77,1C78', `a new family id reaches the loaded helper-channel driver (${a?.familyPids})`);
  fs.rmSync(r2, { recursive: true, force: true });
}
if (fails.length) { console.log(`library-family: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('library-family (a brand\'s unlisted model matched by its protocol\'s collection, kept and added to the copy): all good');
