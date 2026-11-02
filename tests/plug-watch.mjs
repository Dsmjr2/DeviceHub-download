// A device plugged in while DeviceHub runs (helpers/plug-watch.mjs, 23 Oct 2026): nothing said about what was there at
// start; a new id with a library driver is said installed, a known gaming brand offered Learn it for me, a refused or
// shared chip id, an id DeviceHub runs and one with the person's own driver left alone; each id said once.
import { watcher, describe, newIds } from '../helpers/plug-watch.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
let usb = [{ vid: '1B1C', pid: '0A6B', name: 'HS80', runs: 'headset' }, { vid: '3434', pid: '0311', name: 'Keychron K3' }];
const pcMap = { get: async () => ({ usb }) };
const brands = { '3434': { name: 'Keychron', kinds: ['keyboard'], shared: false }, '1532': { name: 'Razer', kinds: ['mouse', 'keyboard'], shared: false },
  '258a': { name: 'Glorious', kinds: ['mouse'], shared: true }, '046d': { name: 'Logitech', kinds: ['mouse'], shared: false }, '0bda': { name: 'Realtek', kinds: ['hub'], shared: false } };
let installs = [];
const sent = [];
const w = watcher({ root: '/x', pcMap, send: (t, d) => sent.push([t, d]), brands: () => brands, owned: () => ({ mine: ['1532:0099'], copies: [] }),
  setup: async () => ({ lastRun: { installed: installs } }) });
await w.start();
check((await w.check()).length === 0 && !sent.length, 'nothing is said about what was plugged in at start');
usb = [...usb, { vid: '1532', pid: '0084', name: 'Razer DeathAdder V2' }, { vid: '1532', pid: '00B9', name: 'Basilisk V3 X' }, { vid: '258A', pid: '0036', name: 'Model O' },
  { vid: '046D', pid: 'C539', name: 'Lightspeed receiver' }, { vid: '1532', pid: '0099', name: 'Mine' }, { vid: '0BDA', pid: '5411', name: 'Hub' }];
installs = [{ name: 'razer-mouse', id: 'razer-mouse', product: 'Razer mice', usb: ['1532:00b9'] }];
const said = await w.check();
const by = Object.fromEntries(said.map((x) => [x.pid, x]));
check(by['00B9']?.installed?.id === 'razer-mouse', `a new id with a library driver is said installed (${JSON.stringify(by['00B9'])})`);
check(by['0084']?.learn && by['0084'].brand === 'Razer', `a known brand without a driver is offered Learn it for me (${JSON.stringify(by['0084'])})`);
check(!by['0036'] && !by['C539'] && !by['0099'] && !by['5411'], `a shared chip, a refused vendor, the person's own driver and a hub are left alone (${JSON.stringify(said)})`);
check(sent.length === said.length && sent.every(([t]) => t === 'newdevice'), 'each is sent to the window');
check((await w.check()).length === 0, 'each id is said once');
check(newIds(null, usb).added.length === 0 && describe(['1532:0084'], { usb: [{ vid: '1532', pid: '0084', runs: 'mouse' }], brands }).length === 0, 'an id DeviceHub runs is never announced');
// nothing to set (24 Oct 2026): a plain keyboard or mouse, a virtual device, is never offered Learn; a vendor page, Windows
// lighting or a long report (Razer's 90-byte feature report on the mouse page) is
import { settable, groupDevices, AS_IS } from '../helpers/learn-wizard.mjs';
const kb = [{ page: '0001', outLen: 2, featLen: 0 }, { page: '000C', outLen: 0, featLen: 0 }];
check(!settable(kb), 'a keyboard with only its Caps Lock light: nothing to set');
check(settable([...kb, { page: 'FF00', outLen: 0, featLen: 65 }]) && settable([{ page: '0001', outLen: 0, featLen: 91 }]) && settable([{ page: '0059', outLen: 0, featLen: 4 }]), 'a vendor page, a 90-byte feature report, LampArray: something to set');
check(!settable([{ page: 'FF00', outLen: 0, featLen: 0 }]), 'a vendor page that takes nothing: nothing to set');
check(describe(['1532:0084'], { usb: [{ vid: '1532', pid: '0084', name: 'x' }], brands, canSet: () => false }).length === 0, 'a known brand with nothing to set: not offered');
check(describe(['1532:0084'], { usb: [{ vid: '1532', pid: '0084', name: 'x' }], brands, canSet: () => null })[0]?.learn, 'not read yet: still offered');
// a brand the guide does not list (1 Nov 2026): Learn only for a mouse or keyboard with a settings channel
{
  const unknown = (u, canSet) => describe(['ABCD:0001'], { usb: [{ vid: 'abcd', pid: '0001', name: 'Gaming Mouse', ...u }], brands, canSet: () => canSet });
  const m = unknown({ usages: { mouse: true }, pages: ['FF01:0001'] }, true);
  check(m.length === 1 && m[0].learn && m[0].brand === null && m[0].name === 'Gaming Mouse', `an unknown brand's mouse with a settings channel: offered Learn (${JSON.stringify(m)})`);
  check(unknown({ usages: { mouse: true }, pages: ['FF01:0001'] }, null).length === 0, 'its channel not read yet: not offered (a known brand is, an unknown one waits for proof)');
  check(unknown({ usages: { mouse: false, keyboard: false }, pages: ['FF01:0001'] }, true).length === 0, 'not a mouse or keyboard to Windows (a webcam, a controller): not offered');
  check(unknown({ usages: { keyboard: true }, pages: [] }, true).length === 0, 'no private channel (a plain keyboard): not offered');
  // the chip makers the brand guide warns about but lists under no brand (Sonix 0c45, QinHeng 1a86): never offered (a review)
  check(describe(['0C45:0001'], { usb: [{ vid: '0c45', pid: '0001', usages: { keyboard: true }, pages: ['FF01:0001'] }], brands, shared: new Set(['0c45', '1a86']), canSet: () => true }).length === 0, 'a Sonix chip keyboard: never offered');
  check(describe(['258A:0001'], { usb: [{ vid: '258a', pid: '0001', usages: { mouse: true }, pages: ['FF01:0001'] }], brands, canSet: () => true }).length === 0, 'a shared chip maker\'s id: never offered');
}
const g = groupDevices({ collections: [{ vid: '3434', pid: '0311', page: '0001', usage: '0006', outLen: 2 }, { vid: '1532', pid: '0084', page: 'FF00', usage: '0001', featLen: 91 }] });
check(g.find((d) => d.pid === '0311')?.settable === false && g.find((d) => d.pid === '0084')?.settable === true && /works as it is/.test(AS_IS), 'the wizard marks what can be set');
{ const sent2 = []; let u2 = [];
  const w2 = watcher({ root: '/x', pcMap: { get: async () => ({ usb: u2 }) }, send: (t, d) => sent2.push(d), brands: () => brands, owned: () => ({ mine: [], copies: [] }), setup: async () => ({ lastRun: { installed: [] } }),
    hid: async () => ({ collections: [{ vid: '1532', pid: '0085', page: '0001', outLen: 2 }, { vid: '1532', pid: '0086', page: 'FF00', featLen: 91 }] }) });
  await w2.start();
  u2 = [{ vid: '1532', pid: '0085', name: 'plain' }, { vid: '1532', pid: '0086', name: 'gaming' }, { vid: '1532', pid: '0087', name: 'not listed yet' }];
  await w2.check();
  check(sent2.map((x) => x.pid).join() === '0086,0087', `plug-in: the plain one is left alone, one not listed yet is still offered (${sent2.map((x) => x.pid)})`); }
// an auto setup that failed is tried again at the next device change, and a first read that failed is read again (1 Nov 2026)
{
  let u3 = [{ vid: '1532', pid: '0001', name: 'old' }], fail = true, n = 0, reads = 0;
  const sent3 = [];
  const w3 = watcher({ root: '/x', pcMap: { get: async () => { if (reads++ === 0) throw new Error('not ready'); return { usb: u3 }; } }, send: (t, d) => sent3.push(d), brands: () => brands, owned: () => ({ mine: [], copies: [] }),
    setup: async () => { n++; if (fail) throw new Error('library not read'); return { lastRun: { installed: [] } }; }, hid: async () => ({ collections: [] }) });
  const started = w3.start();
  await new Promise((r) => setTimeout(r, 10100));
  await started;
  u3 = [...u3, { vid: '1532', pid: '0086', name: 'gaming' }];
  await w3.check();
  check(n === 1 && sent3.length === 0, `a setup that fails says nothing yet (${n}, ${sent3.length})`);
  fail = false;
  await w3.check();
  check(n === 2 && sent3.map((x) => x.pid).join() === '0086', `the next device change tries it again and says it (${n}, ${sent3.map((x) => x.pid)})`);
  check(!sent3.some((x) => x.pid === '0001'), 'the device there before (first read failed, read again) is not said as new');
}

if (fails.length) { console.log(`plug-watch: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('plug-watch (a device plugged in: library driver said installed, a known brand offered Learn it for me, the rest left alone, once each): all good');
