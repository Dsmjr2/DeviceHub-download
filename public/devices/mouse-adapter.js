// Pulsar X-Lite CrazyLight on the 8K dongle (VID 0x3710, PID 0x5406), config collection = usage page 0xFF02.
// A setting is writable only when its stored check byte proves we are reading it correctly.
// Value keys: pollingRate liftOff debounce motionSync angleSnap ripple turbo dpiStage (1-based) dpi0..dpi7 stageCount
//             sleep (seconds) dpiEffect (off/steady/breathing) color0..color7 (#rrggbb) effectBrightness (1-10)
//             effectSpeed (1-5); a button's value is an action key (back, dpiCycle ...) or "keys:04,05" (key codes)
import { getDevice } from './hid.js';
import { PulsarMouse, ADDR, POLLING, LIFT_OFF, DPI_SLOTS, DPI_MAX, snapDpi, BUTTONS, ACTIONS, BRIGHTNESS_LEVELS, parseKeys } from './pulsar.js';

const FILTERS = [{ vendorId: 0x3710, usagePage: 0xff02 }];
let mouse = null;
let decoded = null;
let flash = null;

const pollCode = Object.fromEntries(Object.entries(POLLING).map(([hz, c]) => [c, Number(hz)]));
export const SETTINGS = {
  pollingRate: { label: 'Polling rate', addr: ADDR.pollingRate, enc: (v) => POLLING[v], dec: (b) => pollCode[b] ?? null, show: (v) => `${v} Hz` },
  liftOff: { label: 'Lift-off distance', addr: ADDR.liftOff, enc: (v) => v, dec: (b) => (LIFT_OFF[b] ? b : null), show: (v) => LIFT_OFF[v] },
  debounce: { label: 'Debounce', addr: ADDR.debounce, enc: (v) => v, dec: (b) => (b <= 15 ? b : null), show: (v) => `${v} ms` },
  motionSync: { label: 'Motion sync', addr: ADDR.motionSync, enc: (v) => (v ? 1 : 0), dec: (b) => (b <= 1 ? b === 1 : null), show: (v) => (v ? 'on' : 'off') },
  angleSnap: { label: 'Angle snapping', addr: ADDR.angleSnap, enc: (v) => (v ? 1 : 0), dec: (b) => (b <= 1 ? b === 1 : null), show: (v) => (v ? 'on' : 'off') },
  ripple: { label: 'Ripple control', addr: ADDR.ripple, enc: (v) => (v ? 1 : 0), dec: (b) => (b <= 1 ? b === 1 : null), show: (v) => (v ? 'on' : 'off') },
  turbo: { label: 'Turbo mode', addr: ADDR.turbo, enc: (v) => (v ? 1 : 0), dec: (b) => (b <= 1 ? b === 1 : null), show: (v) => (v ? 'on' : 'off') },
  stageCount: { label: 'DPI stages in the cycle', addr: ADDR.stageCount, enc: (v) => v, dec: (b) => (b >= 1 && b <= DPI_SLOTS ? b : null), show: (v) => `${v}` },
  dpiStage: { label: 'Active DPI stage', addr: ADDR.dpiStage, enc: (v) => v - 1, dec: (b) => (b < DPI_SLOTS ? b + 1 : null), show: (v) => `stage ${v}` },
  // the DPI light's brightness (steady) and speed (breathing), as the Pulsar app's levels (learned 19 Oct 2026)
  effectBrightness: { label: 'DPI light brightness', addr: ADDR.effectBrightness, enc: (v) => BRIGHTNESS_LEVELS[v - 1], dec: (b) => (BRIGHTNESS_LEVELS.includes(b) ? BRIGHTNESS_LEVELS.indexOf(b) + 1 : null), show: (v) => `${v} of 10` },
  effectSpeed: { label: 'DPI light speed', addr: ADDR.effectSpeed, enc: (v) => v, dec: (b) => (b >= 1 && b <= 5 ? b : null), show: (v) => `${v} of 5` },
};
export { POLLING, LIFT_OFF, DPI_SLOTS, DPI_MAX, snapDpi, BUTTONS, ACTIONS };

const adapter = {
  id: 'mouse',
  title: 'Pulsar X-Lite CrazyLight',
  kind: 'Mouse',
  vendor: { label: 'Pulsar app', app: 'pulsar' },
  // everything else is in DeviceHub now (19 Oct 2026); firmware updates have their own place under Settings > Updates
  unsupported: ['firmware updates'],
  owns: (d) => d === mouse?.device,
  get decoded() { return decoded; },

  // Is a setting proven readable (its check byte matched and the value is one we know)?
  trusted(key) {
    const b = /^btn([0-5])$/.exec(key);
    if (b) return decoded?.buttons?.[Number(b[1])] != null && b[1] !== '0';
    if (/^dpi[0-7]$/.test(key)) return decoded?.dpis[Number(key.slice(3))] != null;
    if (/^color[0-7]$/.test(key)) return decoded?.colors?.[Number(key.slice(5))] != null;
    if (key === 'sleep') return !!(decoded?.sleep?.ok && decoded?.sleepMirror?.ok && decoded.sleep.value >= 1 && decoded.sleep.value <= 180);
    if (key === 'dpiEffect') return !!(decoded?.effectMode?.ok && decoded?.effectOn?.ok && [1, 2].includes(decoded.effectMode.value) && decoded.effectOn.value <= 1);
    const s = SETTINGS[key], d = decoded?.[key];
    return !!(s && d?.ok && s.dec(d.value) != null);
  },

  async connect(prompt) {
    const d = await getDevice(FILTERS, { prompt });
    if (!d) return false;
    mouse = new PulsarMouse(d);
    await mouse.open();
    return true;
  },

  async info() {
    let v = {};
    try { v = await mouse.version(); } catch {}
    const cable = !!mouse.device.onCable;
    // on the cable the dongle is not in the path (it reads 0.00), so only the mouse is shown
    return cable ? { Model: 'Pulsar X-Lite CrazyLight', Connection: 'USB cable (charging)', 'Mouse firmware': v.mouse || '—' }
      : { Model: 'Pulsar X-Lite CrazyLight', Connection: 'Dongle', Receiver: `Pulsar 8K Dongle (${mouse.device.productId.toString(16)})`, 'Mouse firmware': v.mouse || '—', 'Dongle firmware': v.dongle || '—' };
  },

  // In DeviceHub's background agent the reading goes through helpers/mouse-level.js (levelFilter): the mouse's own
  // number is voltage-based and reads high on the charger and just after, so DeviceHub's tracked level is shown.
  async battery() {
    let b;
    try { b = await mouse.battery(); } catch { return null; }
    return b && this.levelFilter ? this.levelFilter(b) : b;
  },

  async read() { return this.decodeFlash(await mouse.snapshot()); },
  // a background look (waking, the minute check): the DPI stage read again, the rest as last read (pulsar.js)
  async wakeRead() { return this.decodeFlash(await mouse.wakeSnapshot()); },
  // while it sleeps: the quick question before a whole read (public/core/devices.js refreshUnlocked)
  async awake() { try { return await mouse.isAwake(); } catch { return false; } },

  // For the backup before a change (19 Oct 2026, speed): the mouse's flash as DeviceHub last read it, when that full
  // read is under 30 s old, kept current by every write's own read-back. Saves reading all 200 bytes before every
  // single-byte change; nothing else writes to the mouse while the Pulsar app is closed. Null = read it for real.
  freshRead() { const f = mouse.freshFlash(30000); return f ? this.decodeFlash(f) : null; },

  decodeFlash(f) {
    flash = f;
    decoded = PulsarMouse.decode(flash);
    const out = {};
    for (const [k, s] of Object.entries(SETTINGS)) out[k] = decoded[k].ok ? s.dec(decoded[k].value) : null;
    decoded.dpis.forEach((dpi, i) => { out[`dpi${i}`] = dpi; });
    decoded.buttons.forEach((a, i) => { out[`btn${i}`] = a; });
    out.sleep = this.trusted('sleep') ? decoded.sleep.value * 10 : null;
    out.dpiEffect = this.trusted('dpiEffect') ? (decoded.effectOn.value === 0 ? 'off' : decoded.effectMode.value === 1 ? 'steady' : 'breathing') : null;
    decoded.colors.forEach((c, i) => { out[`color${i}`] = c ? `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}` : null; });
    return out;
  },

  // flash0to199 holds the settings and, since 19 Oct 2026, the buttons' key blocks too (bytes 0-447)
  rawBackup: async () => ({ flash0to199: flash, checks: decoded }),

  async write(key, value) {
    const btnKey = /^btn([1-5])$/.exec(key); // btn0 (left click) is never written
    if (btnKey) {
      const i = Number(btnKey[1]);
      if (!this.trusted(key)) throw new Error(`${BUTTONS[i]} did not read back as a known action, so remapping it is blocked`);
      // a keyboard key or key combination: "keys:04,05"
      const codes = parseKeys(value);
      if (codes) { const back = await mouse.writeKeys(i, codes); decoded.buttons[i] = back; return back; }
      if (!Object.hasOwn(ACTIONS, value)) throw new Error(`"${value}" is not a button action DeviceHub knows`);
      const back = await mouse.writeButton(i, value);
      decoded.buttons[i] = back;
      return back;
    }
    const dpiKey = /^dpi([0-7])$/.exec(key);
    if (dpiKey) {
      const slot = Number(dpiKey[1]);
      if (!this.trusted(key)) throw new Error(`DPI stage ${slot + 1} did not read back cleanly, so writing it is blocked`);
      if (!Number.isInteger(value) || snapDpi(value) !== value) throw new Error(`${value} DPI cannot be stored exactly; try ${snapDpi(Number(value) || 800)}`);
      const back = await mouse.writeDpi(slot, value);
      decoded.dpis[slot] = back;
      return back;
    }
    const colorKey = /^color([0-7])$/.exec(key);
    if (colorKey) {
      const slot = Number(colorKey[1]);
      if (!this.trusted(key)) throw new Error(`stage ${slot + 1}'s color did not read back cleanly, so writing it is blocked`);
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`"${value}" is not a color like #ff6a1a`);
      const back = await mouse.writeColor(slot, [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)));
      decoded.colors[slot] = back;
      return `#${back.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
    }
    if (key === 'sleep') {
      if (!this.trusted('sleep')) throw new Error('auto sleep did not read back cleanly, so writing it is blocked');
      if (!Number.isInteger(value) || value % 10 || value < 10 || value > 1800) throw new Error('auto sleep must be 10 seconds to 30 minutes, in 10-second steps');
      const back = await mouse.writeSleep(value / 10);
      decoded.sleep = decoded.sleepMirror = { value: back, ok: true };
      return back * 10;
    }
    if (key === 'dpiEffect') {
      // off = light switch 0 (mode kept); steady / breathing = mode 1 / 2, then switch 1. Each byte is read back.
      if (!this.trusted('dpiEffect')) throw new Error('the DPI light did not read back cleanly, so writing it is blocked');
      if (!['off', 'steady', 'breathing'].includes(value)) throw new Error(`"${value}" is not off, steady or breathing`);
      if (value !== 'off') decoded.effectMode = { value: await mouse.writeChecked(ADDR.effectMode, value === 'steady' ? 1 : 2), ok: true };
      decoded.effectOn = { value: await mouse.writeChecked(ADDR.effectOn, value === 'off' ? 0 : 1), ok: true };
      return value;
    }
    const s = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : null;
    if (!s) throw new Error(`${key} is not a mouse setting DeviceHub can write`);
    // Only stages inside the DPI button's cycle can be made active.
    const count = decoded?.stageCount?.ok ? decoded.stageCount.value : null;
    if (key === 'stageCount' && Number.isInteger(value) && value < (decoded?.dpiStage?.ok ? decoded.dpiStage.value + 1 : 1)) throw new Error(`the mouse is on stage ${decoded.dpiStage.value + 1}; switch to a lower stage first`);
    if (key === 'dpiStage' && count >= 1 && count <= DPI_SLOTS && value > count) throw new Error(`stage ${value} is outside the ${count}-stage cycle`);
    if (!this.trusted(key)) throw new Error(`${s.label} did not read back cleanly, so writing it is blocked`);
    // The stored byte must be a whole 0-255 code that decodes back to exactly the requested value.
    const code = s.enc(value);
    if (!Number.isInteger(code) || code < 0 || code > 255 || s.dec(code) !== value) throw new Error(`${value} is not a valid ${s.label}`);
    const back = await mouse.writeChecked(s.addr, code);
    decoded[key] = { value: back, ok: true };
    return s.dec(back);
  },
};
export default adapter;
