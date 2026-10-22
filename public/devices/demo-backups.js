// Demo mode's pretend backups (22 Oct 2026, docs/handoff/backups-redesign.md): the Backups page in ?demo lists and
// opens these instead of the real backups\ and setups\ folders, so every button there can be tried without reading
// or changing anything real. Times are counted back from when the page opens, so Today / Yesterday show.
const ago = (h) => new Date(Date.now() - h * 3600000);
const stamp = (d) => d.toISOString().replace(/[:.]/g, '-');

const MOUSE_INFO = { Model: 'Pulsar X-Lite CrazyLight', Receiver: 'Pulsar 8K Dongle (5406)', 'Mouse firmware': '3.03', 'Dongle firmware': '2.25' };
const MOUSE = { pollingRate: 1000, liftOff: 1, debounce: 2, motionSync: false, angleSnap: false, ripple: false, dpiStage: 1, stageCount: 3, sleep: 30, turbo: false,
  dpi0: 750, dpi1: 800, dpi2: 1600, dpi3: 3200, btn1: 'right', btn2: 'middle', btn3: 'back', btn4: 'forward', btn5: 'dpiCycle' };
const HEADSET = { 'vol:playback': 42, 'mute:playback': false, 'vol:recording': 80, 'mute:recording': false, led: '#2f7bff', headsetOn: true };
const KEYBOARD = { brightness: 128, effect: 1, speed: 128, hue: 0, saturation: 255 };

// [device, hours ago, why, settings changes]
const MADE = [
  ['mouse', 0.4, 'before pollingRate', {}],
  ['mouse', 3.1, 'before Lift-off distance', { pollingRate: 4000 }],
  ['mouse', 26, 'before a change', { pollingRate: 2000, liftOff: 2 }],
  ['mouse', 30, 'before debounce', { debounce: 4 }],
  ['mouse', 52, 'before btn5', { btn5: 'forward' }],
  ['mouse', 75, 'before dpi1', { dpi1: 1200 }],
  ['headset', 1.2, 'before Headset color', {}],
  ['headset', 28, 'before vol:playback', { led: '#ff6a1a' }],
  ['keyboard', 2.5, 'before brightness', {}],
  ['keyboard', 49, 'before effect', { brightness: 255 }],
  ['keyboard', 99, 'before a change', { brightness: 255, effect: 3 }],
  ['keyboard', 140, 'before speed', { brightness: 200, effect: 3, speed: 60 }],
  ['windows-pointer', 5, 'before scrollLines', null],
];

const files = {};
const list = [];
for (const [device, h, why, change] of MADE) {
  const at = ago(h);
  const name = `${device}-${stamp(at)}.json`;
  const base = device === 'mouse' ? MOUSE : device === 'headset' ? HEADSET : KEYBOARD;
  files[name] = change
    ? { device, takenAt: at.toISOString(), why, data: { info: device === 'mouse' ? MOUSE_INFO : { Model: device === 'headset' ? 'Corsair HS80' : 'Epomaker P75' }, settings: { ...base, ...change } } }
    : { device, takenAt: at.toISOString(), why, data: { ok: true, speed: 10, precision: false, scrollLines: 3, doubleClick: 500 } };
  list.push({ name, size: JSON.stringify(files[name], null, 2).length, at: at.toISOString() });
}
list.sort((a, b) => new Date(b.at) - new Date(a.at));

// two weekly whole-setup copies: the newer one matches a little, the older one more differently
const setup = (h, mouse, profiles) => ({
  kind: 'devicehub-setup', version: 1, savedAt: ago(h).toISOString(),
  devices: {
    mouse: { device: 'mouse', takenAt: ago(h).toISOString(), why: 'setup file', data: { info: MOUSE_INFO, settings: { ...MOUSE, ...mouse } } },
    headset: { device: 'headset', takenAt: ago(h).toISOString(), why: 'setup file', data: { settings: HEADSET } },
    keyboard: { device: 'keyboard', takenAt: ago(h).toISOString(), why: 'setup file', data: { settings: KEYBOARD } },
  },
  profiles,
});
const DEMO_PROFILE = { name: 'Demo: aim training', color: '#c47b55', devices: { mouse: { dpiStage: 1, pollingRate: 8000 } } };
const weeklyFiles = {
  'DeviceHub setup demo-1.json': setup(50, { pollingRate: 2000 }, [DEMO_PROFILE]),
  'DeviceHub setup demo-2.json': setup(218, { pollingRate: 1000, debounce: 4 }, [DEMO_PROFILE, { name: 'Demo: desktop', color: '#8299a8', devices: { mouse: { pollingRate: 1000 } } }]),
};
const weekly = Object.entries(weeklyFiles).map(([name, f]) => ({ name, at: f.savedAt, size: JSON.stringify(f, null, 1).length }));

const copy = (x) => JSON.parse(JSON.stringify(x));
export const demoBackups = {
  list: () => copy(list),
  read: (name) => { if (!files[name]) throw new Error('no such backup'); return copy(files[name]); },
  weekly: () => copy(weekly),
  readWeekly: (name) => { if (!weeklyFiles[name]) throw new Error('no such setup file'); return copy(weeklyFiles[name]); },
};
