// A friend's PC, exactly as his reports show it (Dsmjr2/DeviceHub-support #3, #4, #5, #7, #8, #9, #10, #11; 22-23 Oct 2026;
// docs/handoff/friend-reports-10-11.md): every device named only by what its own ids, descriptors and drivers that
// answered support. Nothing is opened, nothing reaches hardware.
//   046D:C54D LIGHTSPEED Receiver: a PRO X2 SUPERSTRIKE answers on it (logitech-hidpp-mouse, #8); no keyboard is paired
//   046D:C0A8 the SUPERSTRIKE's cable (#7)
//   03F0:0696 HyperX Cloud II Wireless (hyperx-cloud answered with its model, #4)
//   342D:E479 Epomaker P75 (DeviceHub's own VIA keyboard, "Epomaker P75 (keyboard): connected", #3 / #5)
//   25A7:FA70 "2.4G Wireless Receiver", maker's app not known (#10, #11): no brand in the brand guide owns 25A7
// Run: node tests/friend-devices.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainName, shownName, seemsFrom } from '../public/core/device-name.js';
import { summary, asText } from '../helpers/auto-setup.mjs';
import { deviceRows } from '../public/core/setup-list.js';
import { plan, deviceKind, genericItems } from '../helpers/learn-apps.mjs';
import { quietHint } from '../helpers/learn-wizard.mjs';
import { shownInReport } from '../helpers/get-help.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// the USB list as helpers/pc-map.js gives it (usages from Windows' hardware ids); the 25A7 receiver in both shapes a
// 2.4G receiver can have: keyboard only, and keyboard and mouse
const usbWith = (usages25a7) => [
  { id: '046d:c54d', vid: '046d', pid: 'c54d', name: 'LIGHTSPEED Receiver', runs: null, usages: { keyboard: true, mouse: true } },
  { id: '03f0:0696', vid: '03f0', pid: '0696', name: 'HyperX Cloud II Wireless', runs: null, usages: { keyboard: false, mouse: false } },
  { id: '342d:e479', vid: '342d', pid: 'e479', name: null, runs: 'Keyboard page', usages: { keyboard: true, mouse: false } },
  { id: '25a7:fa70', vid: '25a7', pid: 'fa70', name: '2.4G Wireless Receiver', runs: null, usages: usages25a7 },
];
const BOTH = { keyboard: true, mouse: true }, KB = { keyboard: true, mouse: false };

// ---- 1. names from the ids alone
{
  const [c54d, hx, p75, rx] = usbWith(BOTH);
  check(plainName(rx)?.title === 'Unknown 2.4G receiver (25A7:FA70)' && plainName(rx).seems === 'a keyboard and a mouse', `25A7:FA70: "Unknown 2.4G receiver (25A7:FA70)", a keyboard and a mouse (${JSON.stringify(plainName(rx))})`);
  check(plainName({ ...rx, usages: KB }).seems === 'a keyboard' && seemsFrom({}) === null, 'what it seems to be comes from its usages only');
  check(plainName(c54d) === null && plainName(hx) === null && plainName(p75) === null, 'Logitech, HyperX and Epomaker ids keep their own names (their vendor ids are those brands\')');
  check(shownName(c54d) === 'LIGHTSPEED Receiver' && shownName(hx) === 'HyperX Cloud II Wireless', 'the brand devices show their own Windows names');
  check(!/epomaker|hyperx|logitech|redragon|areson|compx/i.test(shownName(rx)), `the 25A7 receiver borrows no brand (${shownName(rx)})`);
}

// ---- 2. Setup (helpers/auto-setup.mjs summary, public/core/setup-list.js): no ghost keyboard, the receiver named plainly
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-friend-'));
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'docs', 'brands.json'), path.join(root, 'docs', 'brands.json'));
for (const [name, id] of [['logitech-hidpp-mouse', 'logitech-hidpp-mouse'], ['logitech-hidpp-keyboard', 'logitech-hidpp-keyboard'], ['hyperx-cloud', 'hyperx-cloud']]) {
  put(`my-devices/${name}/library.json`, JSON.stringify({ source: `device-library/${name}`, name, id, status: 'untested', installedAt: '2026-10-23T00:00:00.000Z' }));
  fs.copyFileSync(path.join(ROOT, 'device-library', name, 'device.json'), path.join(root, 'my-devices', name, 'device.json'));
}
put('setup.json', JSON.stringify({ version: 1, installed: [
  { name: 'logitech-hidpp-mouse', product: 'Logitech mouse', status: 'untested', usb: ['046d:c54d'], id: 'logitech-hidpp-mouse', at: '2026-10-23T00:00:00Z' },
  { name: 'logitech-hidpp-keyboard', product: 'Logitech G keyboards', status: 'untested', usb: ['046d:c54d'], id: 'logitech-hidpp-keyboard', at: '2026-10-23T00:00:00Z' },
] }));
// the agent's snapshot: the keyboard driver stepped aside on C54D (absent, helpers/my-devices.mjs isAbsent)
const agent = { devices: [
  { id: 'mouse', status: 'missing', seen: false, adapter: { title: 'Pulsar X-Lite CrazyLight', kind: 'Mouse' } },
  { id: 'headset', status: 'missing', seen: false, adapter: { title: 'Corsair HS80', kind: 'Headset' } },
  { id: 'keyboard', status: 'connected', seen: true, info: { Model: 'Epomaker P75' }, adapter: { title: 'Epomaker P75', kind: 'Keyboard' } },
  { id: 'logitech-hidpp-mouse', status: 'connected', seen: true, info: { Model: 'Logitech PRO X2 SUPERSTRIKE (by its HITS feature 0x1B0C) on receiver C54D (slot 1)' }, adapter: { plugin: 'logitech-hidpp-mouse', title: 'Logitech mouse', kind: 'Mouse', library: { turnOn: true } } },
  { id: 'logitech-hidpp-keyboard', status: 'missing', seen: false, absent: true, adapter: { plugin: 'logitech-hidpp-keyboard', title: 'Logitech keyboard', kind: 'Keyboard', library: { turnOn: true }, notMine: 'the Logitech device on receiver C54D (slot 1) has a DPI feature' } },
  { id: 'hyperx-cloud', status: 'connected', seen: true, info: { Model: 'HyperX Cloud II Wireless' }, adapter: { plugin: 'hyperx-cloud', title: 'HyperX Cloud headset', kind: 'Headset', library: { turnOn: true } } },
] };
for (const [shape, usages] of [['keyboard and mouse', BOTH], ['keyboard only', KB]]) {
  const usb = usbWith(usages);
  const s = summary({ root, sources: { agent, usb, via: [{ vid: '342D', pid: 'E479', name: 'Epomaker P75' }] } });
  const text = asText(s);
  check(!/Logitech keyboard|Logitech G keyboards/.test(JSON.stringify(s)), `${shape}: no Logitech keyboard anywhere in the setup summary`);
  check(s.works.some((x) => x.page === 'logitech-hidpp-mouse') && s.works.some((x) => x.page === 'hyperx-cloud') && s.works.some((x) => x.what === 'keyboard'), `${shape}: the SUPERSTRIKE, the HyperX and the P75 are listed`);
  const un = s.optional.find((x) => x.what === 'unknown-vendor');
  const want = `Unknown 2.4G receiver (25A7:FA70), ${seemsFrom(usages)}`;
  check(un?.title === want, `${shape}: the receiver is "${want}" (${un?.title})`);
  check(!/(epomaker|hyperx|logitech)[^.;]*25a7|25a7[^.;]*(epomaker|hyperx|logitech)/i.test(text), `${shape}: no brand is put next to 25A7 in the text report`);
  const live = Object.fromEntries(agent.devices.map((d) => [d.id, { title: d.adapter.title, kind: d.adapter.kind, status: d.status, seen: d.seen, absent: !!d.absent, plugin: !!d.adapter.plugin, library: !!d.adapter.library, turnOn: !!d.adapter.library?.turnOn }]));
  const rows = deviceRows(s, { live });
  const titles = rows.map((r) => r.title);
  check(!titles.some((t) => /Logitech keyboard/.test(t)), `${shape}: no Setup row for a Logitech keyboard (${titles.join(' | ')})`);
  check(titles.includes('Logitech mouse') && titles.includes('HyperX Cloud headset') && titles.includes('Epomaker P75') && titles.includes(want), `${shape}: Setup shows the mouse, the headset, the P75 and the unknown receiver (${titles.join(' | ')})`);
}
check(!shownInReport(agent.devices.find((d) => d.id === 'logitech-hidpp-keyboard')) && shownInReport(agent.devices.find((d) => d.id === 'logitech-hidpp-mouse')), 'Get help lists the mouse driver, never the stepped-aside keyboard driver');
fs.rmSync(root, { recursive: true, force: true });

// ---- 3. Learn a device on the 25A7 receiver: settings from its usages, never DPI for a keyboard; one question when both
{
  const cols = (usages) => [...(usages.keyboard ? [{ page: '0001', usage: '0006' }] : []), ...(usages.mouse ? [{ page: '0001', usage: '0002' }] : []), { page: '000C', usage: '0001' }, { page: 'FF00', usage: '0001' }];
  const dev = (usages) => ({ vid: '25A7', pid: 'FA70', name: '2.4G Wireless Receiver', collections: cols(usages) });
  const noMaker = async () => ({ known: false, name: null, page: null, installed: false, running: false, window: null });
  const opts = { root: ROOT, maker: noMaker, scan: async () => [] };
  let p = await plan(dev(KB), opts);
  check(deviceKind(dev(KB)) === 'keyboard' && p.kind === 'keyboard' && p.items.length && !p.items.some((i) => /dpi|polling|lift|angle/i.test(i.label)), `keyboard only: keyboard settings, no DPI (${p.items.map((i) => i.label)})`);
  p = await plan(dev(BOTH), opts);
  check(p.kind === 'mixed' && p.ask?.line === 'Is this a mouse or a keyboard?' && !p.items.length, `keyboard and mouse: one question first, no list yet (${JSON.stringify(p.ask)})`);
  p = await plan(dev(BOTH), { ...opts, kind: 'keyboard' });
  check(p.kind === 'keyboard' && p.items.map((i) => i.label).join() === genericItems('keyboard').map((i) => i.label).join() && !p.items.some((i) => /dpi/i.test(i.label)), `answered "a keyboard": keyboard settings (${p.items.map((i) => i.label)})`);
  p = await plan(dev(BOTH), { ...opts, kind: 'mouse' });
  check(p.kind === 'mouse' && p.items[0]?.label === 'DPI', 'answered "a mouse": mouse settings');
  // nothing heard, no maker's app known: the plain hint, with the cable for a keyboard
  const h = quietHint({ device: dev(KB), plan: { maker: { known: false }, kind: 'keyboard' } });
  check(/no settings software/.test(h) && /another way/.test(h) && /USB cable/.test(h), `the "nothing recorded" hint (${h})`);
  check(quietHint({ device: dev(KB), plan: { maker: { known: true, name: 'X' }, kind: 'keyboard' } }) === '', 'no hint when the maker\'s app is known');
  check(!/epomaker|hyperx|redragon/i.test(h), 'the hint names no brand');
  // a headset dongle shows a telephony collection (page 000B, its mic-mute button) and no mouse or keyboard: headset settings
  p = await plan({ vid: '25A7', pid: 'FA70', name: '2.4G Wireless Receiver', collections: [{ page: '000C', usage: '0001' }, { page: '000B', usage: '0005' }, { page: 'FF00', usage: '0001' }] }, opts);
  check(p.kind === 'headset' && !p.items.some((i) => /dpi/i.test(i.label)) && p.items.some((i) => i.label === 'Sidetone'), `a dongle with telephony usage: headset settings, never DPI (${p.items.map((i) => i.label)})`);
}

console.log(fails.length ? `friend-devices: FAILED:\n- ${fails.join('\n- ')}` : 'friend-devices (a friend\'s exact devices: names from their own ids, no ghost keyboard, Learn by usages): all good');
process.exit(fails.length ? 1 : 0);
