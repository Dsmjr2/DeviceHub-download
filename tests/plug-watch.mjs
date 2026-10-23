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
if (fails.length) { console.log(`plug-watch: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('plug-watch (a device plugged in: library driver said installed, a known brand offered Learn it for me, the rest left alone, once each): all good');
