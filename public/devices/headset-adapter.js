// Corsair HS80 RGB Wireless through the local helper (server.js -> helpers/corsair.js):
//  - iCUE SDK: model, battery, mic / sidetone / surround / EQ preset status, LED color
//  - Windows Core Audio: headset volume and mic level / mute (iCUE not needed)
//  - without iCUE: battery, mic flip, firmware, sleep timer straight from the receiver (helpers/hs80-direct.js)
// Write keys: prop:<name> (only if iCUE marks it writable), vol:<flow>, mute:<flow>, led (#rrggbb)
let call = async (action, body) => {
  const r = await fetch(`/api/corsair/${action}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
};
// Inside the server's agent the Corsair helper is called directly instead of over HTTP.
export function setCorsairCall(fn) { call = fn; }

let dev = null;
let props = {};
let endpoints = [];
let led = null;
let mode = null;    // 'icue' (iCUE running, through its SDK) or 'direct' (straight to the receiver, read-only)
let raw = {};       // direct mode: the receiver's own readings
let lastFirmware = null;
let via = null;
// Any USB headset (20 Oct 2026): with no HS80, the first USB headset Windows has (a USB device with headphones or a
// headset output and a mic, helpers/audio-default.cs) runs here on its sound features alone: volume, mutes, mic level,
// sidetone when Windows names one, and through the server its EQ, mic boost and mic filters. Its lights, battery and
// own settings need its protocol (ADD-YOUR-DEVICES.md). DEVICEHUB_HEADSET_GENERIC=1 treats the HS80 as unknown, to
// test this route on a real headset.
let generic = null;   // { usb, device, ids } in that mode
const forceGeneric = () => globalThis.process?.env?.DEVICEHUB_HEADSET_GENERIC === '1';
async function findGeneric() {
  let list = [];
  try { list = (await call('usb-headsets', {})).headsets || []; } catch { return null; }
  const h = list.find((x) => forceGeneric() || !/^VID_1B1C&PID_0A6/.test(x.usb));
  return h ? { usb: h.usb, device: h.device || h.usb, ids: new Set([...h.playback, ...h.recording].map((e) => e.id)) } : null;
}
// a sidetone control's own range: percent as loudness, 100% = its top (the HS80's is -42..+4 dB)
const pctOf = (db, min, max) => (db <= min ? 0 : Math.max(0, Math.min(100, Math.round(100 * 10 ** ((db - max) / 20)))));
const dbOf = (pct, min, max) => (pct <= 0 ? min : Math.max(min, Math.min(max, max + 20 * Math.log10(pct / 100))));           // direct mode: 'wired' (USB cable) or 'receiver'  // from the last direct reading; iCUE's SDK does not report it

const ep = (flow) => endpoints.find((e) => e.flow === flow);
let sidetone = null;  // { db, on, min, max } from Windows

// iCUE's sidetone percent is a loudness scale: 100% = +4 dB, 50% = -2 dB, 10% = -16 dB (measured against iCUE
// 18 Oct 2026: 10% read -15.6 dB, 50% read -2.0 dB), and the control stops at -42 dB.
export const sidetonePct = (db) => (db <= -42 ? 0 : Math.max(0, Math.min(100, Math.round(100 * 10 ** ((db - 4) / 20)))));
export const sidetoneDb = (pct) => (pct <= 0 ? -42 : Math.max(-42, Math.min(4, 4 + 20 * Math.log10(pct / 100))));

// Windows audio answers are capped at 3 s: right after the receiver is re-plugged Windows is still setting up the
// HS80 sound devices and each question could wait the helper's full 15 s, which kept the headset on "Connecting" for
// about a minute (19 Oct 2026). A capped answer shows "—" and asks for a re-read a few seconds later.
let audioLate = false;
const soon = (p, ms = 3000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => { audioLate = true; rej(new Error('Windows audio not ready yet')); }, ms))]);
export const takeAudioLate = () => { const x = audioLate; audioLate = false; return x; };

async function readBoost(v) {
  try { const b = await call('mic-boost', {}); if (b.available) v.micBoost = b.db; } catch {}
}
async function readSidetone(v) {
  try { sidetone = await soon(call('sidetone', generic ? { usb: generic.usb } : {})); } catch { sidetone = null; }
  if (sidetone && sidetone.db != null) { v.sidetone = generic ? pctOf(sidetone.db, sidetone.min, sidetone.max) : sidetonePct(sidetone.db); if (sidetone.on != null) v.sidetoneOn = sidetone.on; }
}

const adapter = {
  id: 'headset',
  get title() { return generic ? generic.device : 'Corsair HS80'; },
  kind: 'Headset',
  get vendor() { return generic ? { label: "its maker's app", app: null } : { label: 'iCUE', app: 'icue' }; },
  get unsupported() { return generic ? ['lights', 'battery', 'its own settings (DeviceHub needs its protocol: ADD-YOUR-DEVICES.md)'] : ['firmware updates', 'receiver pairing']; },
  get generic() { return generic; },
  autoReconnect: true,
  pollRead: true,
  get props() { return props; },
  get endpoints() { return endpoints; },
  get mode() { return mode; },

  async connect() {
    mode = null; dev = null; generic = null;
    if (!forceGeneric() && (await adapter.connectHs80())) return true;
    const g = await findGeneric();
    if (!g) return false;
    generic = g; mode = 'generic'; dev = { id: 'generic' };
    return true;
  },

  async connectHs80() {
    if ((await call('icue-running', {})).running) {
      let devices;
      // iCUE starting up is not an error: the headset just cannot be found until its SDK answers.
      try { ({ devices } = await call('devices')); } catch (e) { if (/not connected|iCUE/i.test(e.message)) return false; throw e; }
      dev = devices.find((d) => /HS80/i.test(d.model)) || devices.find((d) => d.type === 'headset') || null;
      if (dev) mode = 'icue';
      return !!dev;
    }
    try { if (!(await call('direct-open', {})).found) return false; } catch { return false; }
    mode = 'direct'; dev = { id: 'direct' };
    const first = await call('direct-read', {});  // so info() has the firmware and sleep timer
    raw = first.values; via = first.connection;
    return true;
  },

  async info() {
    if (mode === 'generic') return { Model: generic.device, 'USB id': generic.usb.replace('VID_', '').replace('&PID_', ':').toLowerCase(), Control: 'Windows sound (any USB headset)' };
    if (mode === 'direct') {
      const f = raw.firmware?.bytes;
      if (f) lastFirmware = `${f[0]}.${f[1]}.${f[2]}`;
      // while the headset is off, the firmware it gave when last on (helpers/hs80-direct.js keeps it); the sleep timer
      // is the Sleep when silent slider, so it is not repeated here (Shawn, 21 Oct 2026)
      let kept = {};
      if (!f) try { kept = await call('last-firmware', {}); } catch {}
      return { Model: 'CORSAIR HS80 RGB Wireless', Firmware: f ? `${f[0]}.${f[1]}.${f[2]}` : kept.firmware || 'turn the headset on to read it', Control: `DeviceHub direct over the ${via === 'wired' ? 'USB cable' : 'receiver'} (no iCUE)` };
    }
    let i;
    try { i = await call('info', { id: dev.id }); } catch (e) { throw Object.assign(e, { gone: true }); }
    if (!lastFirmware) try { lastFirmware = (await call('last-firmware', {})).firmware; } catch {}
    return { Model: `${i.model} RGB Wireless`, Firmware: lastFirmware || '—', Serial: i.serial || '—', LEDs: i.ledCount, Control: 'iCUE SDK + Windows audio' };
  },

  async battery() {
    if (mode === 'generic') return null;
    const b = props.batteryLevel;
    return b && b.value != null ? { percent: b.value } : null;
  },

  async read() {
    if (mode === 'generic') {
      const now = await findGeneric();
      if (!now || now.usb !== generic.usb) throw Object.assign(new Error(`${generic.device} was unplugged`), { gone: true });
      generic = now;
      try { endpoints = ((await soon(call('audio-list', { match: '' }))).endpoints || []).filter((e) => generic.ids.has(e.id)); } catch { endpoints = []; }
      const v = {};
      for (const e of endpoints) { v[`vol:${e.flow}`] = e.volume; v[`mute:${e.flow}`] = e.muted; }
      await readSidetone(v);
      await readBoost(v);
      v.headsetOn = true;
      if (takeAudioLate()) setTimeout(() => adapter.onLate?.(), 5000);
      return v;
    }
    if (mode === 'direct') {
      // iCUE started: hand the headset back to it (reconnect picks the iCUE route).
      if ((await call('icue-running', {})).running) throw Object.assign(new Error('iCUE started; switching the headset over to it'), { gone: true });
      const r = await call('direct-read', {});
      raw = r.values; via = r.connection;
      const on = !!raw.battery;
      props = on ? {
        batteryLevel: { name: 'batteryLevel', value: Math.round(raw.battery.value / 10), canWrite: false },
        micEnabled: { name: 'micEnabled', value: raw.micMuted ? raw.micMuted.value === 0 : null, canWrite: false },
      } : {};
      try { endpoints = (await soon(call('audio-list', { match: 'HS80' }))).endpoints; } catch { endpoints = []; }
      const v = Object.fromEntries(Object.entries(props).map(([k, p]) => [`prop:${k}`, p.value]));
      for (const e of endpoints) { v[`vol:${e.flow}`] = e.volume; v[`mute:${e.flow}`] = e.muted; }
      try {
        const ls = await call('light-settings', {});
        v.logoBrightness = ls.logoBrightness; v.micLight = ls.micLight; led = ls.logoColor;
      } catch {}
      if (on && raw.autoOff) v.autoOff = Math.round(raw.autoOff.value / 60000);
      await readSidetone(v);
      await readBoost(v);
      v.led = led;
      v.headsetOn = on;
      if (takeAudioLate()) setTimeout(() => adapter.onLate?.(), 5000);
      return v;
    }
    const { devices } = await call('devices');
    if (!devices.some((d) => d.id === dev.id)) throw Object.assign(new Error('the HS80 receiver was unplugged'), { gone: true });
    props = (await call('props', { id: dev.id })).props;
    try { endpoints = (await soon(call('audio-list', { match: 'HS80' }))).endpoints; } catch { endpoints = []; }
    const v = Object.fromEntries(Object.entries(props).map(([k, p]) => [`prop:${k}`, p.value]));
    for (const e of endpoints) { v[`vol:${e.flow}`] = e.volume; v[`mute:${e.flow}`] = e.muted; }
    await readSidetone(v);
    await readBoost(v);
    v.led = led;
    v.headsetOn = !!props.batteryLevel;
    if (takeAudioLate()) setTimeout(() => adapter.onLate?.(), 5000);
    return v;
  },

  async write(key, value) {
    const [kind, name] = key.split(':');
    if (key === 'sidetone') {
      if (!(Number.isInteger(value) && value >= 0 && value <= 100)) throw new Error('sidetone must be 0-100');
      const g = generic ? { usb: generic.usb } : {};
      const after = await call('sidetone-set', { db: generic && sidetone ? dbOf(value, sidetone.min, sidetone.max) : sidetoneDb(value), ...g });
      const got = generic ? pctOf(after.db, after.min, after.max) : sidetonePct(after.db);
      if (Math.abs(got - value) > 1) throw new Error(`Windows reads ${got}% after setting ${value}%`);
      return value;
    }
    if (key === 'micBoost') {
      if (!(Number.isInteger(value) && value >= 0 && value <= 10)) throw new Error('mic boost must be 0-10 dB');
      return (await call('mic-boost-set', { db: value })).db;
    }
    if (key === 'sidetoneOn') {
      if (typeof value !== 'boolean') throw new Error('sidetone must be on or off');
      const after = await call('sidetone-set', { on: value, ...(generic ? { usb: generic.usb } : {}) });
      if (after.on !== value) throw new Error(`Windows reads sidetone ${after.on ? 'on' : 'off'} after turning it ${value ? 'on' : 'off'}`);
      return value;
    }
    if (mode === 'generic' && ['logoBrightness', 'micLight', 'brightness', 'autoOff', 'led'].includes(key)) throw new Error(`${generic.device}: DeviceHub does not know its own settings yet (ADD-YOUR-DEVICES.md)`);
    if (key === 'logoBrightness' || key === 'micLight') {
      if (mode !== 'direct') throw new Error('iCUE is open: it runs the headset lights while it is');
      const after = await call('light-settings-set', { [key]: value });
      if (after[key] !== value) throw new Error(`DeviceHub reads ${after[key]} after setting ${value}`);
      return value;
    }
    if (key === 'brightness' || key === 'autoOff') {
      if (mode !== 'direct') throw new Error('iCUE is open: change this in iCUE, or close iCUE to change it here');
      const ok = key === 'brightness' ? Number.isInteger(value) && value >= 0 && value <= 100 : Number.isInteger(value) && value >= 1 && value <= 120;
      if (!ok) throw new Error(key === 'brightness' ? 'brightness must be 0-100' : 'sleep timer must be 1-120 minutes');
      const raw10 = key === 'brightness' ? value * 10 : value * 60000;
      const back = (await call('direct-set', { name: key, value: raw10 })).value;
      return key === 'brightness' ? Math.round(back / 10) : Math.round(back / 60000);
    }
    if (mode === 'direct' && kind === 'prop') throw new Error('needs iCUE running (DeviceHub only reads these directly)');
    if (mode === 'direct' && key === 'led') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`"${value}" is not a color like #ff6a1a`);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
      await call('direct-logo', { r, g, b });  // the logo only: the mic light stays red-when-muted
      led = value;
      return value;
    }
    if (kind === 'prop') {
      const p = props[name];
      if (!p?.canWrite) throw new Error(`${name} is read-only in iCUE`);
      return (await call('write', { id: dev.id, prop: p.prop, value })).value;
    }
    if (kind === 'vol' || kind === 'mute') {
      if (!['playback', 'recording'].includes(name)) throw new Error(`unknown audio device ${name}`);
      if (kind === 'vol' && !(Number.isInteger(value) && value >= 0 && value <= 100)) throw new Error('volume must be 0-100');
      if (kind === 'mute' && typeof value !== 'boolean') throw new Error('mute must be on or off');
      const e = ep(name);
      if (!e) throw new Error(`no ${generic ? generic.device : 'HS80'} ${name} device in Windows (is the headset on?)`);
      const after = await call('audio-set', { id: e.id, ...(kind === 'vol' ? { volume: value } : { muted: value }) });
      Object.assign(e, after);
      const got = kind === 'vol' ? after.volume : after.muted;
      if (got !== value) throw new Error(`Windows reports ${got} after setting ${value}`);
      return got;
    }
    if (key === 'led') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`"${value}" is not a color like #ff6a1a`);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
      await call('lighting', { id: dev.id, r, g, b }); // the helper reads the color back from iCUE and throws on a mismatch
      led = value;
      return value;
    }
    throw new Error(`unknown setting ${key}`);
  },

  hasLighting: () => !!mode && mode !== 'generic',
};
export default adapter;
