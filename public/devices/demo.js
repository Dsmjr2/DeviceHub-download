// Demo mode (?demo): simulated devices with the same keys as the real adapters, for trying the UI without hardware.
// Values start from what Shawn's devices reported on 16 Oct 2026; the keyboard keymap comes from the latest backup.
import { DPI_SLOTS } from './pulsar.js';
import { rgbToHsv255 } from './keyboard-adapter.js';
import { encodeMacro, decodeMacro } from './macros.js';
import { DEMO_KEYMAP } from './demo-keymap.js';

const wait = (ms = 140) => new Promise((r) => setTimeout(r, ms + Math.random() * 120));

export function demoAdapters() {
  const mv = { pollingRate: 4000, liftOff: 3, debounce: 2, motionSync: false, angleSnap: false, ripple: false, dpiStage: 3, stageCount: 3, sleep: 30, turbo: false, dpiEffect: 'off', color0: '#33f8f2', color1: '#0000ff', color2: '#00ff00', color3: '#ffff00', color4: '#ff00ff', color5: '#00ffff', color6: '#ffffff', color7: '#ff8000',
    dpi0: 750, dpi1: 800, dpi2: 1600, dpi3: 3200, dpi4: 6400, dpi5: 12800, dpi6: 12800, dpi7: 12800,
    btn0: 'left', btn1: 'right', btn2: 'middle', btn3: 'back', btn4: 'forward', btn5: 'dpiCycle' };
  const mouse = {
    id: 'mouse', title: 'Pulsar X-Lite CrazyLight', kind: 'Mouse', vendor: { label: 'Pulsar app', app: 'pulsar' },
    unsupported: ['firmware updates'],  // the same lists as the real devices (19 Oct 2026)
    trusted: () => true,
    connect: async () => (await wait(), true),
    info: async () => ({ Model: 'Pulsar X-Lite CrazyLight', Receiver: 'Pulsar 8K Dongle (5406)', 'Mouse firmware': '3.03', 'Dongle firmware': '2.25' }),
    battery: async () => ({ percent: 90, charging: false }),
    read: async () => (await wait(), { ...mv }),
    write: async (k, v) => (await wait(260), (mv[k] = v)),
  };

  const hv = { 'prop:micEnabled': true, 'prop:surroundEnabled': false, 'prop:sidetoneEnabled': true, 'prop:equalizerPreset': 2, 'prop:batteryLevel': 64, 'vol:playback': 42, 'mute:playback': false, 'vol:recording': 80, 'mute:recording': false, led: '#ff6a1a', headsetOn: true };
  const propInfo = (name, prop) => ({ name, prop, canRead: true, canWrite: false, value: hv[`prop:${name}`] });
  const headset = {
    id: 'headset', title: 'Corsair HS80', kind: 'Headset', vendor: { label: 'iCUE', app: 'icue' },
    unsupported: ['firmware updates', 'receiver pairing'],
    get props() { return { micEnabled: propInfo('micEnabled', 2), surroundEnabled: propInfo('surroundEnabled', 3), sidetoneEnabled: propInfo('sidetoneEnabled', 4), equalizerPreset: propInfo('equalizerPreset', 5), batteryLevel: propInfo('batteryLevel', 9) }; },
    get endpoints() { return [{ flow: 'playback', name: 'Headset (CORSAIR HS80 RGB Wireless)' }, { flow: 'recording', name: 'Microphone (CORSAIR HS80 RGB Wireless)' }]; },
    connect: async () => (await wait(), true),
    info: async () => ({ Model: 'HS80 RGB Wireless', Serial: 'demo', LEDs: 1, Control: 'iCUE SDK + Windows audio' }),
    battery: async () => ({ percent: hv['prop:batteryLevel'] }),
    read: async () => (await wait(), { ...hv }),
    write: async (k, v) => { await wait(200); if (k.startsWith('prop:')) throw new Error(`${k.slice(5)} is read-only in iCUE`); return (hv[k] = v); },
    hasLighting: () => true,
  };

  const kv = { brightness: 200, effect: 1, speed: 128, hue: 20, saturation: 255 };
  let session = null;
  const keyboard = {
    id: 'keyboard', title: 'Epomaker P75', kind: 'Keyboard', vendor: { label: 'Epomaker driver', app: 'epomaker' },
    unsupported: ['per-key colors', 'battery level', 'sleep timer', 'wireless pairing setup'],
    get session() { return session; },
    async connect() {
      await wait();
      const keymap = DEMO_KEYMAP.map((l) => l.map((r) => [...r]));
      session = { info: { name: 'EPOMAKER P75', protocol: 12, layers: 5 }, keymap, encoders: Array.from({ length: 5 }, (_, l) => (l === 0 ? [0xaa, 0xa9] : [1, 1])),
        macros: { mi: { count: 16, size: 2398 }, list: Array(16).fill('').map((m, i) => (i === 0 ? 'gg{Enter}' : '')), raw: [] }, original: keymap.map((l) => l.map((r) => [...r])) };
      return true;
    },
    info: async () => ({ Model: 'EPOMAKER P75', Protocol: 'VIA 12', Layers: 5, Matrix: '6 × 15', Knob: 'yes', Macros: '16 slots' }),
    battery: async () => null,
    read: async () => (await wait(), { ...kv }),
    async write(k, v) {
      await wait(180);
      const [kind, a, b, c] = k.split(':');
      if (kind === 'key') return (session.keymap[a][b][c] = v);
      if (kind === 'enc') return (session.encoders[a][c === '1' ? 1 : 0] = v);
      if (kind === 'macro') { decodeMacro(encodeMacro(v)); return (session.macros.list[a] = v); }
      return (kv[k] = v);
    },
    lightingKeys(r, g, b, brightness) { const { hue, sat } = rgbToHsv255(r, g, b); return [['hue', hue], ['saturation', sat], ['brightness', Math.round((brightness / 100) * 255)]]; },
    hasLighting: () => true,
  };
  return [mouse, headset, keyboard];
}
export { DPI_SLOTS };
