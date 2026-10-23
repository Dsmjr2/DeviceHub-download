// The Setup page's demo mode (?demo): a PC where 2 things need you (one Set it all up does, one it asks about first: Close SteelSeries GG),
// and a few optional and done things folded under them (public/pages/setup.js). Nothing here is sent anywhere. Every
// other kind of row is in tests/setup-page.mjs's own pretend answers. settings and battery: what each added device can
// do (the "You're all set" view, core/setup-list.js canDo). ?demo&first opens Setup by itself, as a first start does.
export const DEMO_SUMMARY = {
  works: [
    { what: 'mouse', state: 'ready', name: 'Pulsar X-Lite', short: 'Ready on the Mouse page.', page: 'mouse' },
    { what: 'headset', state: 'ready', name: 'Corsair HS80', short: 'Ready on the Headset page.', page: 'headset' },
    { what: 'keyboard', state: 'ready', name: 'Epomaker P75', short: 'Ready on the Keyboard page.', page: 'keyboard' },
    { what: 'library', name: 'razer-mouse', title: 'Razer DeathAdder V3', page: 'demo-razer', state: 'one-click', short: 'Ready-made driver installed. Turn on its settings: DeviceHub tests each one first.', action: { kind: 'turn-on', id: 'demo-razer' } },
    { what: 'library', name: 'steelseries-mouse', title: 'SteelSeries Aerox 3', page: 'demo-aerox', state: 'ready', short: 'Ready on its own page.' },
    { what: 'library', name: 'redragon-k552', title: 'Redragon K552', page: 'demo-learned', state: 'ready', short: 'Ready on its own page.' },
    { what: 'monitors', state: 'ready', name: '2 monitors', short: 'AOC AGON OLED, Acer IPS: brightness, contrast and more.', page: 'monitors' },
    { what: 'cameras', state: 'ready', name: '1 webcam', short: 'Anker PowerConf C200: picture settings on the Monitors page.', page: 'monitors' },
    { what: 'lamparrays', state: 'ready', name: 'Razer Basilisk V3', short: 'Its lights work in Windows Settings, no driver needed.', action: { kind: 'settings', page: 'lighting', label: 'Open Dynamic Lighting' } },
    { what: 'generic-dongle', usb: '258a:1007', chip: 'Sinowealth', title: '2.4G Wireless Receiver', state: 'ready', short: 'A generic 2.4G receiver (Sinowealth chip).' },
  ],
  learn: [
    { what: 'packet-size', usb: '1b1c:1b8b', title: 'Corsair Dark Core RGB Pro', state: 'not-yet', short: 'Not supported yet: it talks in messages too big for DeviceHub.' },
  ],
  optional: [{ what: 'unknown-vendor', usb: ['25a7:fa61', '1a2c:4094'], title: '2 other USB devices', state: 'optional', short: '25a7:fa61, 1a2c:4094: Learn a device can try.' }],
};
export const DEMO_LIVE = {
  'demo-razer': { title: 'Razer DeathAdder V3', kind: 'Mouse', status: 'connected', plugin: true, library: true, turnOn: true, settings: [{ label: 'DPI' }, { label: 'Polling rate' }, { label: 'Lights' }], battery: true },
  'demo-aerox': { title: 'SteelSeries Aerox 3', kind: 'Mouse', status: 'missing', seen: true, plugin: true, library: true, settings: [{ label: 'DPI' }, { label: 'Lights' }], battery: true },
  'demo-learned': { title: 'Redragon K552', kind: 'Keyboard', status: 'connected', plugin: true, library: true, learned: true, works: true, settings: [{ label: 'Lights' }, { label: 'Effect' }, { label: 'Brightness' }] },
};
export const DEMO_DIAG = { 'demo-aerox': { code: 'maker-app', problem: 'SteelSeries GG is running', fix: 'Close SteelSeries GG; DeviceHub connects within a few seconds. It stays installed for firmware updates.', action: { kind: 'close-app', app: 'gg', label: 'Close SteelSeries GG', confirm: 'Close SteelSeries GG now?' } } };
export const DEMO_TOOLS = [{ id: 'eqapo', name: 'Equalizer APO', installed: true, version: '1.4.2' }, { id: 'usbpcap', name: 'USBPcap', installed: false }];
export const DEMO_EQ = { engine: 'eqapo', headsetModel: 'HS80', notOn: [] };
export const DEMO_ORGB = { running: false, controllers: [], bundle: { shipped: true, version: '1.1', canStart: true } };
export const DEMO_BT = [{ name: 'Xbox Wireless Controller', connected: true, battery: 80 }, { name: 'AirPods Pro', connected: true, battery: 45 }];
