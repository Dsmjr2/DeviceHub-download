// The Setup page's demo mode (?demo): one of every kind of row, with pretend answers (public/pages/setup.js). Nothing
// here is sent anywhere.
export const DEMO_SUMMARY = {
  works: [
    { what: 'mouse', state: 'ready', name: 'Pulsar X-Lite', short: 'Ready on the Mouse page.', page: 'mouse' },
    { what: 'headset', state: 'ready', name: 'Corsair HS80', short: 'Ready on the Headset page.', page: 'headset' },
    { what: 'keyboard', state: 'ready', name: 'Epomaker P75', short: 'Ready on the Keyboard page.', page: 'keyboard' },
    { what: 'library', name: 'razer-mouse', title: 'Razer DeathAdder V3', page: 'demo-razer', state: 'one-click', short: 'Ready-made driver installed. Turn on its settings: DeviceHub tests each one first.', action: { kind: 'turn-on', id: 'demo-razer' } },
    { what: 'library', name: 'steelseries-mouse', title: 'SteelSeries Aerox 3', page: 'demo-aerox', state: 'one-click', short: 'Ready-made driver installed. Connect it, then turn on its settings.' },
    { what: 'library', name: 'redragon-k552', title: 'Redragon K552', page: 'demo-learned', state: 'ready', short: 'Ready on its own page.' },
    { what: 'monitors', state: 'ready', name: '2 monitors', short: 'AOC AGON OLED, Acer IPS: brightness, contrast and more.', page: 'monitors' },
    { what: 'cameras', state: 'ready', name: '1 webcam', short: 'Anker PowerConf C200: picture settings on the Monitors page.', page: 'monitors' },
    { what: 'lamparrays', state: 'ready', name: 'Razer Basilisk V3', short: 'Its lights work in Windows Settings, no driver needed.', action: { kind: 'settings', page: 'lighting', label: 'Open Dynamic Lighting' } },
    { what: 'generic-dongle', usb: '258a:1007', chip: 'Sinowealth', title: '2.4G Wireless Receiver', state: 'ready', short: 'A generic 2.4G receiver (Sinowealth chip). These usually have no settings to learn; it works as a normal mouse or keyboard.' },
  ],
  learn: [
    { what: 'library-untested', name: 'logitech-g502x', title: 'Logitech G502 X', state: 'one-click', short: 'A ready-made driver is there, not yet tried on this model. Install it, then turn on its settings.', action: { kind: 'library-install', name: 'logitech-g502x' } },
    { what: 'learn', usb: '3434:0610', title: 'Keychron Q1 Pro', state: 'not-yet', short: "No driver yet. Learn a device makes one while you use the maker's app." },
    { what: 'learn', usb: '1038:1824', title: 'SteelSeries Rival 3', state: 'not-yet', short: "No driver yet. Learn a device makes one while you use the maker's app." },
    { what: 'packet-size', usb: '1b1c:1b8b', title: 'Corsair Dark Core RGB Pro', state: 'not-yet', short: 'Not supported yet: it talks in messages too big for DeviceHub.' },
  ],
  optional: [{ what: 'unknown-vendor', usb: ['25a7:fa61', '1a2c:4094'], title: '2 other USB devices', state: 'optional', short: '25a7:fa61, 1a2c:4094: Learn a device can try.' }],
};
export const DEMO_LIVE = {
  'demo-razer': { title: 'Razer DeathAdder V3', kind: 'Mouse', status: 'connected', plugin: true, library: true, turnOn: true },
  'demo-aerox': { title: 'SteelSeries Aerox 3', kind: 'Mouse', status: 'missing', seen: true, plugin: true, library: true, turnOn: true },
  'demo-learned': { title: 'Redragon K552', kind: 'Keyboard', status: 'connected', plugin: true, library: true, learned: true, works: true },
};
export const DEMO_DIAG = { 'demo-aerox': { code: 'maker-app', problem: 'SteelSeries GG is running', fix: 'Close SteelSeries GG; DeviceHub connects within a few seconds. It stays installed for firmware updates.', action: { kind: 'close-app', app: 'gg', label: 'Close SteelSeries GG', confirm: 'Close SteelSeries GG now?' } } };
export const DEMO_TOOLS = [{ id: 'eqapo', name: 'Equalizer APO', installed: true, version: '1.4.2' }, { id: 'usbpcap', name: 'USBPcap', installed: false }];
export const DEMO_EQ = { engine: 'eqapo', headsetModel: 'HS80', notOn: [{ flow: 'playback', name: 'HS80 Wireless' }] };
export const DEMO_ORGB = { running: false, controllers: [], bundle: { shipped: true, version: '1.1', canStart: true } };
export const DEMO_BT = [{ name: 'Xbox Wireless Controller', connected: true, battery: 80 }, { name: 'AirPods Pro', connected: true, battery: 45 }];

