// Demo mode (?demo): simulated devices with the same keys as the real adapters, for trying the UI without hardware.
// Values start from what Shawn's devices reported on 16 Oct 2026; the keyboard keymap comes from the latest backup.
import { DPI_SLOTS } from './pulsar.js';
import { rgbToHsv255 } from './keyboard-adapter.js';
import { encodeMacro, decodeMacro } from './macros.js';
import { DEMO_KEYMAP } from './demo-keymap.js';
import { headsetChoices } from '../core/headset-pick.js';

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
  // a pretend second USB headset with ?demo&headsets=2 (22 Oct 2026): the Headset page's picker, and the sound-only
  // page a second headset gets
  const two = /[?&]headsets=2(&|$)/.test(globalThis.location?.search || '');
  const OTHER = { usb: 'VID_1038&PID_12E0', device: 'Arctis Nova 7 Wireless Gaming Headset' };
  const ov = { 'vol:playback': 55, 'mute:playback': false, 'vol:recording': 70, 'mute:recording': false, headsetOn: true };
  let picked = 'hs80';
  const other = () => picked !== 'hs80';
  const headset = {
    id: 'headset', kind: 'Headset',
    get title() { return other() ? OTHER.device : 'Corsair HS80'; },
    get vendor() { return other() ? { label: "its maker's app", app: null } : { label: 'iCUE', app: 'icue' }; },
    get unsupported() { return other() ? ['lights', 'battery', 'its own settings (teach them in Learn a device)'] : ['firmware updates', 'receiver pairing']; },
    get mode() { return other() ? 'generic' : undefined; },
    get generic() { return other() ? { ...OTHER } : null; },
    get headsets() { return two ? headsetChoices([{ usb: 'VID_1B1C&PID_0A6B', device: 'CORSAIR HS80 RGB Wireless Gaming Headset' }, OTHER]) : []; },
    get picked() { return picked; },
    choose(k) { if (this.headsets.some((c) => c.key === k)) picked = k; },
    get props() { if (other()) return {}; return { micEnabled: propInfo('micEnabled', 2), surroundEnabled: propInfo('surroundEnabled', 3), sidetoneEnabled: propInfo('sidetoneEnabled', 4), equalizerPreset: propInfo('equalizerPreset', 5), batteryLevel: propInfo('batteryLevel', 9) }; },
    get endpoints() { if (other()) return [{ flow: 'playback', name: 'Headphones (Arctis Nova 7)' }, { flow: 'recording', name: 'Microphone (Arctis Nova 7)' }]; return [{ flow: 'playback', name: 'Headset (CORSAIR HS80 RGB Wireless)' }, { flow: 'recording', name: 'Microphone (CORSAIR HS80 RGB Wireless)' }]; },
    connect: async () => (await wait(), true),
    info: async () => (other() ? { Model: OTHER.device, 'USB id': '1038:12e0', Control: 'Windows sound (any USB headset)' } : { Model: 'HS80 RGB Wireless', Serial: 'demo', LEDs: 1, Control: 'iCUE SDK + Windows audio' }),
    battery: async () => (other() ? null : { percent: hv['prop:batteryLevel'] }),
    read: async () => (await wait(), other() ? { ...ov } : { ...hv }),
    write: async (k, v) => {
      await wait(200);
      if (other()) { if (!/^(vol|mute):(playback|recording)$/.test(k)) throw new Error(`${OTHER.device}: DeviceHub does not know its own settings yet`); return (ov[k] = v); }
      if (k.startsWith('prop:')) throw new Error(`${k.slice(5)} is read-only in iCUE`); return (hv[k] = v);
    },
    hasLighting: () => !other(),
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
  const added = addedDemo();
  return added ? [mouse, headset, keyboard, added] : [mouse, headset, keyboard];
}

// A pretend device added in my-devices that reports a battery (22 Oct 2026, docs/handoff/battery-added-devices.md),
// only with ?demo&added: its tile's Live liquid, its page's battery graph (pretend readings, no server request), its time
// left and its battery-saving line. &pct=<0-100> sets its level, &charging=1 says it charges, &kind=Headset (or
// Keyboard, or anything else for the plain tile) changes its drawing. Nothing is written anywhere.
function addedDemo() {
  const q = new URLSearchParams(globalThis.location?.search || '');
  if (!q.has('added')) return null;
  const pct = Math.max(0, Math.min(100, Number(q.get('pct') ?? 42) || 0)), charging = q.get('charging') === '1';
  const kind = String(q.get('kind') || 'Mouse').slice(0, 20);
  const v = { lights: true, dpi: 1600, signal: 'Strong' };
  // a week of readings every 5 minutes, ending at the level asked for: about 1.5% an hour down, a charge each evening
  const history = (days) => {
    const now = Date.now(), step = 5 * 60 * 1000, rows = [];
    let level = pct;
    for (let t = now; t > now - days * 24 * 3600 * 1000; t -= step) {
      const hour = new Date(t).getHours(), chg = hour === 19 || hour === 20;
      rows.push({ at: t, pct: Math.round(Math.max(0, Math.min(100, level))), charging: chg || (t === now && charging) });
      level = Math.min(100, Math.max(0, level + (chg ? -4 : 0.125)));   // going back in time: before a charge it was lower
    }
    return rows.reverse();
  };
  const title = `Pretend wireless ${kind.toLowerCase()}`;
  return {
    id: 'demo-added', title, kind, plugin: 'demo-added', vendor: { label: "its maker's app", app: null }, unsupported: [],
    settings: [
      { key: 'lights', label: 'Lights', type: 'toggle' },
      { key: 'dpi', label: 'DPI', type: 'slider', min: 400, max: 3200, step: 400 },
      { key: 'signal', label: 'Signal', type: 'display' },
    ],
    batteryCare: { lowBattery: { key: 'lights', value: false }, charging: { key: 'lights', value: false } },
    connect: async () => (await wait(), true),
    info: async () => ({ Model: title, Connection: '2.4 GHz receiver' }),
    battery: async () => ({ percent: pct, charging }),
    read: async () => (await wait(), { ...v }),
    write: async (k, x) => (await wait(200), (v[k] = x)),
    demoHistory: history,
    demoEstimate: charging ? null : { ratePerHour: 1.5, hoursLeft: +(pct / 1.5).toFixed(1) },
  };
}
export { DPI_SLOTS };
