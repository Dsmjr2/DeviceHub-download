// The HS80 without iCUE: battery, mic flip, firmware and the rest read straight from the headset through the
// native helper, over the receiver or, when the headset runs on its USB cable, over the cable (19 Oct 2026). Used when iCUE is not running;
// while iCUE runs it polls the same channel and the two would answer each other's questions, so iCUE wins.
const path = require('path');
const { execFile } = require('child_process');
const native = require('./native');

// The two ways to reach the headset. The cable one wins when it is live (a dead headset plugged in starts there).
const CONNS = { wired: { pid: '0A69', ep: 8 }, receiver: { pid: '0A6B', ep: 9 } };
let onEvent = () => {};
const FW_FILE = path.join(__dirname, '..', 'headset-firmware.json');
function lastFirmware() { try { return JSON.parse(require('fs').readFileSync(FW_FILE, 'utf8')).firmware; } catch { return null; } }

// One connection to the headset: its own channel on the native helper (helpers/native.js); requests go one at a time.
let hostCount = 0;
class Host {
  constructor(kind) { this.kind = kind; const c = CONNS[kind]; this.chan = `hs80:${c.pid}:${c.ep}:${kind}${++hostCount}`; this.chain = Promise.resolve(); }
  one(cmd, ms) {
    const p = this.chain.then(() => native.request(this.chan, cmd, ms));
    this.chain = p.catch(() => {});
    if (/^OPEN/.test(cmd)) native.onEvent(this.chan, (id, v) => { if (host === this) onEvent(id, v); });
    return p;
  }
  stop() { native.onEvent(this.chan, null); native.request(this.chan, 'CLOSE', 3000); }
}

let host = null;  // the live connection
let conn = 'receiver';
// 1.5 s per question: an asleep or switched-off headset never answers, and at the helper's default 8 s seven
// questions took a minute (19 Oct 2026: "Connecting" for a minute after the headset slept)
const one = (cmd, ms = 1500) => (host ? host.one(cmd, ms) : Promise.resolve('GONE'));
let lastTimedOut = false;
let silentAt = 0;  // when the headset last left a question unanswered (0 = it answers)

// While the headset is on the receiver, a cable connection waits ready (already loaded), asking every second
// whether the headset has appeared on the cable; the moment it has, it takes over, so the headset's own white
// light shows for about a second instead of the 5-10 s a fresh start took (19 Oct 2026).
let standby = null, standbyTimer = null, standbyBusy = false;
let log = () => {};
// (21 Oct 2026) Windows announces a plugged-in cable (the helper's device messages, helpers/agent.mjs calls
// lookForCable), so the timed look is every 10 s instead of every second: a quarter of all the helper's requests.
async function standbyTick() {
  if (!standby || standbyBusy || conn === 'wired') return;
  standbyBusy = true;
  try {
    if ((await standby.one('OPEN', 15000)) === 'OK') {
      const old = host;
      host = standby; conn = 'wired'; standby = new Host('wired');
      if (old) old.stop();
      stopLights(); startLights();
      log({ kind: 'info', device: 'headset', text: `Headset on its cable: DeviceHub took over its lights at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` });
    }
  } finally { standbyBusy = false; }
}
function startStandby() {
  if (standbyTimer) return;
  standby = new Host('wired');
  standbyTimer = setInterval(standbyTick, 10000);
}
// a device was plugged in: look for the headset's cable now, and as Windows finishes setting it up
function lookForCable() { if (!standbyTimer) return; for (const ms of [0, 1200, 3000]) setTimeout(() => standbyTick().catch(() => {}), ms); }
function stopStandby() { clearInterval(standbyTimer); standbyTimer = null; if (standby) standby.stop(); standby = null; }

// Is iCUE running? Asked from several places; one tasklist run answers them all for 10 s (19 Oct 2026: idle cost).
let icueAt = 0, icueSeen = false, icueAsk = null;
function icueRunning() {
  if (Date.now() - icueAt < 10000) return Promise.resolve(icueSeen);
  if (!icueAsk) icueAsk = new Promise((resolve) => execFile('tasklist', ['/FI', 'IMAGENAME eq iCUE.exe', '/NH'], { windowsHide: true }, (e, out) => {
    icueSeen = /iCUE\.exe/i.test(String(out)); icueAt = Date.now(); icueAsk = null; resolve(icueSeen);
  }));
  return icueAsk;
}

async function get(id) {
  const r = await one(`GET ${id.toString(16)}`);
  lastTimedOut = r === 'TIMEOUT' || r === 'NONE';  // no reply (the helper waits 400 ms) or none in time: silent
  if (lastTimedOut) silentAt = Date.now(); else if (r !== 'GONE') silentAt = 0;
  if (r === 'GONE') throw Object.assign(new Error('the HS80 receiver was unplugged'), { gone: true });
  if (r === 'NONE' || r === 'TIMEOUT') return null;
  const b = r.split(' ').map((x) => parseInt(x, 16));
  return { status: b[0], value: (b[1] | (b[2] << 8) | (b[3] << 16)) + b[4] * 2 ** 24, bytes: b.slice(1) };
}

const PROPS = { brightness: 0x02, lightMode: 0x03, autoOff: 0x0e, battery: 0x0f, firmware: 0x13, voltage: 0x53, micMuted: 0xa6 };

async function open() {
  if (await icueRunning()) throw new Error('iCUE is running; DeviceHub uses iCUE while it does');
  for (const kind of ['wired', 'receiver']) {
    stopHost();
    const h = new Host(kind);
    if ((await h.one('OPEN', 15000)) === 'OK') { host = h; conn = kind; startLights(); startStandby(); return true; }
    h.stop();
  }
  // nothing found: no cable standby (20 Oct 2026: on a PC without an HS80 it looked for one every second, forever);
  // the next open, a few seconds later, tries the cable first anyway
  return false;
}
function stopHost() { if (host) host.stop(); host = null; }
// The headset changed connection (cable connection appeared or went away): reconnect on the right one.
async function reopen() { stopLights(); stopHost(); return open(); }

async function read() {
  const out = {};
  // the headset left a question unanswered under 3 s ago: it is off or asleep; say so without asking again
  if (silentAt && Date.now() - silentAt < 3000) return Object.fromEntries(Object.keys(PROPS).map((k) => [k, null]));
  // the battery first: no answer means the headset is off or asleep, and the rest would only wait too
  const order = ['battery', ...Object.keys(PROPS).filter((k) => k !== 'battery')];
  for (const name of order) {
    const r = await get(PROPS[name]);
    out[name] = r && r.status === 0 ? r : null;
    if (name === 'battery' && lastTimedOut) { for (const k of order) out[k] ??= null; break; }
  }
  if (out.micMuted) lights.muted = out.micMuted.value === 1;
  // remembered for when iCUE runs (its SDK does not report the firmware)
  if (out.firmware) try { require('fs').writeFileSync(FW_FILE, JSON.stringify({ firmware: out.firmware.bytes.slice(0, 3).join('.'), at: new Date() })); } catch {}
  return out;
}

// ---- the lights, the way iCUE does them: software mode, and the color message twice a second ----
// Without this the headset falls back to its own lights, which show a white mic light while the mic is live.
// Shawn's choice (18 Oct 2026): the mic light only ever shows red, at half brightness, while muted.
// Light positions (measured 19 Oct 2026 by lighting each one blue): 0 = logo on the left cup, 1 = the other logo,
// 2 = mic. Shawn's settings, kept in headset-lights.json: logo color and brightness (0 = off, his usual), and
// whether the mic light shows at all (on = red at half brightness only while muted).
const LIGHTS_FILE = path.join(__dirname, '..', 'headset-lights.json');
// a new PC starts with the logos on, as the headset comes (Shawn's own choice is in his headset-lights.json)
const DEFAULTS = { logoColor: '#ffffff', logoBrightness: 100, micLight: true };
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(require('fs').readFileSync(LIGHTS_FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; } }
const lights = { muted: null, mic: [0x80, 0x00, 0x00], timer: null, ticks: 0, lastError: null, settings: loadSettings() };
function hexRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function lightMessage() {
  // a short preview (lights-preview): one position in one color, everything else off
  if (lights.preview && Date.now() < lights.preview.until) {
    const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; c[lights.preview.pos] = lights.preview.rgb;
    return [c[0][0], c[1][0], c[2][0], c[0][1], c[1][1], c[2][1], c[0][2], c[1][2], c[2][2]].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  }
  const st = lights.settings;
  const mic = lights.muted && st.micLight ? lights.mic : [0, 0, 0];
  const logo = hexRgb(st.logoColor).map((x) => Math.round((x * st.logoBrightness) / 100));
  // R0 R1 R2 G0 G1 G2 B0 B1 B2
  return [logo[0], logo[0], mic[0], logo[1], logo[1], mic[1], logo[2], logo[2], mic[2]].map((x) => x.toString(16).padStart(2, '0')).join(' ');
}
function setLightSettings(patch) {
  const next = { ...lights.settings };
  if ('logoColor' in patch) { if (!/^#[0-9a-f]{6}$/i.test(patch.logoColor)) throw new Error('logo color must look like #ff6a1a'); next.logoColor = patch.logoColor.toLowerCase(); }
  if ('logoBrightness' in patch) { if (!Number.isInteger(patch.logoBrightness) || patch.logoBrightness < 0 || patch.logoBrightness > 100) throw new Error('logo brightness must be 0-100'); next.logoBrightness = patch.logoBrightness; }
  if ('micLight' in patch) { if (typeof patch.micLight !== 'boolean') throw new Error('mic light must be on or off'); next.micLight = patch.micLight; }
  require('fs').writeFileSync(LIGHTS_FILE, JSON.stringify(next, null, 2));
  lights.settings = next;
  lightTick().catch(() => {});
  return next;
}
async function lightTick() {
  if (!host) return;
  // one round at a time, and a 5 s pause while the headset does not answer (asleep or off): ticks fired every 500 ms
  // whatever happened before, so with the headset asleep the queue grew without end and every other request
  // (the connect reading) waited behind it
  if (lights.busy || Date.now() < (lights.quietUntil || 0)) return;
  lights.busy = true;
  try { await lightRound(); } finally { lights.busy = false; }
}
async function lightRound() {
  lights.ticks++;
  // every 10 s: give way to iCUE if it was opened
  if (lights.ticks % 20 === 1 && (await icueRunning())) { stopLights(); stopStandby(); return; }
  // every second: put the headset back in software mode if it dropped out (it starts in its own white-light mode
  // whenever it switches on or reconnects, so this check decides how long that white light shows)
  if (lights.ticks % 2 === 1) {
    const m = await get(0x03);
    if (lastTimedOut) { lights.quietUntil = Date.now() + 5000; return; }
    if (m && m.status === 0 && m.value !== 2) await one('MODE 2');
  }
  // Ask for the mic position on every tick: the headset's own change notice did not always arrive
  // (19 Oct 2026, the catcher saw the light stay red 8.6 s after the mic went live).
  const m = await get(0xa6);
  if (lastTimedOut) { lights.quietUntil = Date.now() + 5000; return; }
  if (m && m.status === 0) lights.muted = m.value === 1;
  let r = await one(`LIGHT ${lightMessage()}`);
  // refused (03): the lighting channel is not open, e.g. after the headset restarted or over the cable; open it
  if (r !== '00' && r !== 'GONE' && r !== 'NONE' && r !== 'TIMEOUT') { await one('OPENLIGHT'); r = await one(`LIGHT ${lightMessage()}`); }
  lights.lastError = r === '00' ? null : r;
}
function startLights() {
  if (lights.timer) return;
  lights.ticks = 0;
  lights.timer = setInterval(() => { lightTick().catch(() => {}); }, 500);
}
function stopLights() { clearInterval(lights.timer); lights.timer = null; }
// A mic flip shows at once instead of on the next tick.
onEvent = (id, v) => { if (id === 0xa6) { lights.muted = v === 1; lightTick().catch(() => {}); } };

// One setting (02 brightness 0-1000, 0E auto-shutoff ms; the host refuses anything else), then read back.
async function set(id, value) {
  const r = await one(`SET ${id.toString(16)} ${value}`, 3000);
  if (r === 'GONE') throw Object.assign(new Error('the HS80 receiver was unplugged'), { gone: true });
  if (r !== '00') throw new Error(r === 'NONE' ? 'the headset did not answer (is it on?)' : `the headset refused it (${r})`);
  const back = await get(id);
  if (!back || back.status !== 0 || back.value !== value) throw new Error(`the headset reads ${back ? back.value : 'nothing'} after setting ${value}`);
  return back.value;
}

function preview(pos, rgb, ms) { lights.preview = { pos, rgb, until: Date.now() + ms }; return lightTick(); }

// A logo color from the Lighting card: also turns a switched-off logo on.
function setLogo(r, g, b) {
  const hex = `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  return setLightSettings({ logoColor: hex, ...(lights.settings.logoBrightness === 0 ? { logoBrightness: 100 } : {}) });
}

function close() { stopLights(); stopStandby(); stopHost(); }

module.exports = { lookForCable, lightSettings: () => ({ ...lights.settings }), setLightSettings, preview, setLog: (fn) => { log = fn; }, open, reopen, connection: () => conn, read, close, icueRunning, setLogo, set, lastFirmware, lights: () => ({ ...lights, timer: !!lights.timer }) };
