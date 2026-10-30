// Corsair helper for server.js. Devices and LEDs go through Corsair's official cue-sdk package;
// properties (battery, mic, sidetone, EQ preset) and Windows audio go through the native helper, because
// the package ships those calls commented out. iCUE must be running for the SDK parts.
const path = require('path');
const sdk = require('cue-sdk');
const direct = require('./hs80-direct');

let connected = false;
let lastColor = null; // iCUE drops SDK colors when this process exits; kept so a reconnect can restore them

// Only a change between connected and not is logged: while iCUE is closed the SDK retries every few seconds, and
// logging each Connecting / Timeout filled server.log (5.7 MB by 19 Oct 2026).
sdk.CorsairConnect((evt) => {
  const was = connected;
  connected = evt.data.state === sdk.CorsairSessionState.CSS_Connected;
  if (connected !== was) console.log('[corsair] session', connected ? 'connected to iCUE' : `lost (${sdk.CorsairSessionStateToString(evt.data.state)})`);
});

// ---- properties and Windows audio: the native helper's 'cue' and 'audio' channels (helpers/native.js) ----
const native = require('./native');
const CUE_OPS = new Set(['props', 'write']);
// the names given to headsets on the Headset page (settings.json "headsetNames": { "VID_..&PID_.." or "JACK_..": name })
function headsetNames() {
  try { const n = JSON.parse(require('fs').readFileSync(require('./data-dir').dataFile('settings.json'), 'utf8')).headsetNames; return n && typeof n === 'object' ? n : {}; } catch { return {}; }
}
async function ask(q) {
  const r = await native.request(CUE_OPS.has(q.op) ? 'cue' : 'audio', JSON.stringify(q), 15000);
  if (r === 'GONE' || r === 'TIMEOUT') throw new Error(`audio helper ${r === 'GONE' ? 'stopped' : 'timed out'}`);
  return JSON.parse(r);
}

function need() { if (!connected) throw new Error('iCUE SDK not connected (is iCUE running?)'); }
const DEVICE_TYPES = { [sdk.CorsairDeviceType.CDT_Headset]: 'headset', [sdk.CorsairDeviceType.CDT_HeadsetStand]: 'headset stand' };

async function props(id) {
  const r = await ask({ op: 'props', id });
  if (!r.ok) throw new Error(r.error);
  return Object.fromEntries(r.props.map((p) => [p.name, p]));
}

async function handle(action, body) {
  // Windows audio (volume / mute) does not need iCUE.
  if (action === 'audio-list') {
    const r = await ask({ op: 'audio-list', match: body.match ?? 'HS80' });   // '' = every device (any-headset mode filters by id)
    if (!r.ok) throw new Error(r.error);
    return { endpoints: r.endpoints };
  }
  if (action === 'audio-set') {
    const r = await ask({ op: 'audio-set', id: body.id, volume: body.volume, muted: body.muted });
    if (!r.ok) throw new Error(r.error);
    return r.endpoint;
  }
  // Straight to the receiver, for when iCUE is not running (helpers/hs80-direct.js).
  if (action === 'direct-open') return { found: await direct.open() };
  if (action === 'direct-read') return { values: await direct.read(), connection: direct.connection() };
  // the headset light-interval test (helpers/hs80-direct.js setLightEvery): how often an unchanged light message is sent
  if (action === 'light-every') return direct.setLightEvery(Number(body.n));
  if (action === 'direct-reopen') return { found: await direct.reopen(), connection: direct.connection() };
  if (action === 'direct-logo') {
    const ok = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
    if (![body.r, body.g, body.b].every(ok)) throw new Error('color values must be whole numbers 0-255');
    await direct.setLogo(body.r, body.g, body.b);
    return { ok: true };
  }
  if (action === 'direct-set') {
    const id = { brightness: 0x02, autoOff: 0x0e }[body.name];
    if (!id || !Number.isInteger(body.value)) throw new Error('unknown headset setting');
    return { value: await direct.set(id, body.value) };
  }
  // Windows' default speaker / mic among the HS80's two connections (helpers/audio-follow.js uses these).
  // every speaker with its apps, and moving apps that did not follow a new default (helpers/audio-apps.cs)
  if (action === 'outputs') { const r = await ask({ op: 'outputs' }); if (!r.ok) throw new Error(r.error); return r; }
  if (action === 'follow' || action === 'switch-output') {
    if (typeof body.id !== 'string') throw new Error('bad speaker');
    const r = await ask({ op: action, id: body.id }); if (!r.ok) throw new Error(r.error); return r;
  }
  // mic test recording, in the helper's memory only (helpers/mic-rec.cs)
  if (action === 'mic-guard' || action === 'mics' || action === 'power' || action === 'procs') { const r = await ask({ op: action }); if (!r.ok) throw new Error(r.error); return r; }
  if (['mic-rec-start', 'mic-rec-status', 'mic-rec-stop', 'mic-rec-read', 'mic-rec-clear'].includes(action)) {
    const q = { op: action };
    if (action === 'mic-rec-start' && typeof body.id === 'string') q.id = body.id;
    if (action === 'mic-rec-read') { q.offset = Math.max(0, Number(body.offset) || 0); q.length = Math.min(1 << 20, Math.max(1, Number(body.length) || (1 << 20))); }
    const r = await ask(q); if (!r.ok) throw new Error(r.error); return r;
  }
  // a headset's USB id ("VID_xxxx&PID_yyyy"): any USB headset; the HS80 when none is given (20 Oct 2026)
  const usb = typeof body?.usb === 'string' && /^VID_[0-9A-F]{4}&PID_[0-9A-F]{4}$/i.test(body.usb) ? body.usb.toUpperCase() : undefined;
  if (action === 'usb-headsets') {
    const r = await ask({ op: 'usb-headsets' }); if (!r.ok) throw new Error(r.error);
    // plus wired headsets on the PC's jack (helpers/wired-headsets.js; used only when picked), and the names the person
    // gave any headset on the Headset page (settings.json "headsetNames")
    const names = headsetNames();
    const usbList = (r.headsets || []).map((x) => (names[String(x.usb).toUpperCase()] ? { ...x, device: names[String(x.usb).toUpperCase()] } : x));
    let wired = [], list = usbList;
    try {
      const wh = require('./wired-headsets');
      const all = await ask({ op: 'audio-list', match: '' });
      const onUsb = await ask({ op: 'hs80-endpoints', usb: 'USB\\' });   // every sound device on a USB device, any state
      // every sound device on Bluetooth (BTHENUM, BTHHFENUM, BTHLEDevice): one headset, not two jacks (29 Oct 2026)
      const onBt = await ask({ op: 'hs80-endpoints', usb: 'BTH' }).catch(() => ({ ok: false }));
      const btIds = onBt.ok ? (onBt.endpoints || []).map((e) => e.id) : [];
      if (all.ok && onUsb.ok) {
        wired = wh.wiredHeadsets(all.endpoints, (onUsb.endpoints || []).map((e) => e.id), names, btIds);
        const folded = wh.foldBluetooth(usbList, wh.bluetoothHeadsets(all.endpoints, new Set(btIds), names));
        list = folded.headsets;
        wired = [...folded.bluetooth, ...wired];
      }
    } catch {}
    return { headsets: [...list, ...wired] };
  }
  if (action === 'hs80-endpoints') { const r = await ask({ op: 'hs80-endpoints', usb }); if (!r.ok) throw new Error(r.error); return r; }
  if (action === 'set-default') {
    if (typeof body.id !== 'string' || ![0, 1].includes(body.flow)) throw new Error('bad endpoint');
    const r = await ask({ op: 'set-default', id: body.id, flow: body.flow });
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  if (action === 'set-enabled') {
    if (typeof body.id !== 'string' || typeof body.on !== 'boolean') throw new Error('bad endpoint');
    const r = await ask({ op: 'set-enabled', id: body.id, on: body.on });
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  // Sidetone: a Windows audio control on the receiver, so it works with or without iCUE.
  if (action === 'sidetone') { const r = await ask({ op: 'sidetone', usb }); if (!r.ok) throw new Error(r.error); return r.sidetone || {}; }
  if (action === 'sidetone-set') {
    const r = await ask({ op: 'sidetone-set', db: body.db, on: body.on, usb });
    if (!r.ok) throw new Error(r.error);
    return r.sidetone;
  }
  if (action === 'light-settings') return direct.lightSettings();
  if (action === 'light-settings-set') return direct.setLightSettings(body || {});
  if (action === 'lights-preview') {
    if (![0, 1, 2].includes(body.pos) || !Array.isArray(body.rgb) || body.rgb.length !== 3 || !body.rgb.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) throw new Error('bad preview');
    await direct.preview(body.pos, body.rgb, Math.min(10000, Number(body.ms) || 4000));
    return { ok: true };
  }
  if (action === 'direct-close') { direct.close(); return { ok: true }; }
  // Mic boost: iCUE's own setting, applied by starting iCUE briefly (helpers/mic-boost.js)
  // ...or DeviceHub's own boost in Equalizer APO when it is installed and finds the headset mic (server.js sets it)
  if (action === 'mic-boost') return boostVia && (await boostVia.ready()) ? boostVia.read() : require('./mic-boost').read();
  if (action === 'mic-boost-set') return boostVia && (await boostVia.ready()) ? boostVia.set(body.db) : require('./mic-boost').set(body.db, require('path').join(__dirname, '..', 'backups'), () => connected);
  if (action === 'last-firmware') return { firmware: direct.lastFirmware() };
  // shared, cached 10 s; iCUE opened by DeviceHub itself to apply a mic boost does not count (the headset stays direct)
  if (action === 'icue-running') return { running: !require('./mic-boost').applying() && (await direct.icueRunning()) };
  need();
  switch (action) {
    case 'devices': {
      const { data, error } = sdk.CorsairGetDevices({ deviceTypeMask: sdk.CorsairDeviceType.CDT_All });
      if (error) throw new Error(sdk.CorsairErrorToString(error));
      return { devices: data.map((d) => ({ id: d.id, model: d.model, serial: d.serial, type: DEVICE_TYPES[d.type] || sdk.CorsairDeviceTypeToString(d.type), ledCount: d.ledCount })) };
    }
    case 'info': {
      const { data, error } = sdk.CorsairGetDeviceInfo(body.id);
      if (error) throw new Error(sdk.CorsairErrorToString(error));
      return { model: data.model, serial: data.serial, ledCount: data.ledCount };
    }
    case 'props':
      return { props: await props(body.id) };
    case 'write': {
      const r = await ask({ op: 'write', id: body.id, prop: body.prop, value: body.value });
      if (!r.ok) throw new Error(r.error);
      return r.prop;
    }
    case 'lighting': {
      const ok = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
      if (![body.r, body.g, body.b].every(ok)) throw new Error('color values must be whole numbers 0-255');
      const leds = sdk.CorsairGetLedPositions(body.id);
      if (leds.error) throw new Error(sdk.CorsairErrorToString(leds.error));
      const colors = leds.data.map((l) => ({ id: l.id, r: body.r, g: body.g, b: body.b, a: 255 }));
      const set = sdk.CorsairSetLedColors(body.id, colors);
      if (set.error) throw new Error(sdk.CorsairErrorToString(set.error));
      // CorsairGetLedColors fills in the array it is given (no `data` in its result).
      const readBack = leds.data.map((l) => ({ id: l.id, r: 0, g: 0, b: 0, a: 0 }));
      const back = sdk.CorsairGetLedColors(body.id, readBack);
      if (back.error) throw new Error(`could not read the color back: ${sdk.CorsairErrorToString(back.error)}`);
      const wrong = readBack.filter((c) => c.r !== body.r || c.g !== body.g || c.b !== body.b);
      if (!readBack.length) throw new Error('iCUE reported no LEDs on the headset');
      if (wrong.length) throw new Error(`iCUE reads ${wrong.map((c) => `rgb(${c.r},${c.g},${c.b})`).join(', ')} after setting rgb(${body.r},${body.g},${body.b})`);
      lastColor = { id: body.id, r: body.r, g: body.g, b: body.b };
      return { leds: colors.length, confirmed: true };
    }
    case 'release':
      // hands lighting back to iCUE by reconnecting (drops our color layer)
      sdk.CorsairDisconnect(); lastColor = null;
      sdk.CorsairConnect((evt) => { connected = evt.data.state === sdk.CorsairSessionState.CSS_Connected; });
      return { ok: true };
    default:
      throw new Error(`unknown action ${action}`);
  }
}

// where mic boost lives when not in iCUE: { ready(), read(), set(db) } (server.js, Equalizer APO)
let boostVia = null;
module.exports = { handle, setBoostVia: (v) => { boostVia = v; } };
