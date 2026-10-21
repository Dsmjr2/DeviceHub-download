// PC lights through OpenRGB (20 Oct 2026): motherboard, RAM, GPU and case lights are reached by OpenRGB, never by
// DeviceHub itself. Most of them sit on the motherboard's SMBus, where a wrong write can damage a RAM stick's memory
// chip (OpenRGB's own warning), so DeviceHub only talks to OpenRGB's local SDK server (127.0.0.1:6742, started in
// OpenRGB with "Start Server" or `OpenRGB --server`) and OpenRGB does the hardware part. Nothing is installed and
// nothing is sent when OpenRGB is not running.
//
// The protocol is OpenRGB's documented SDK (Documentation/OpenRGBSDK.md in OpenRGB's repository). DeviceHub asks for
// protocol 3 at most (OpenRGB 0.7+), which every current OpenRGB serves: brightness in modes, no segments.
// Same rules as the devices: every controller's colors and mode are backed up before the first change
// (backups/openrgb-<time>.json), each change is read back, and Put back restores the backup exactly (its mode and
// every LED color).
const net = require('net');
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./safe-write');

const PORT = 6742, HOST = '127.0.0.1', WANT = 3;
const ID = { count: 0, data: 1, version: 40, name: 50, updateLeds: 1050, customMode: 1100, updateMode: 1101 };
let backupDir = null, cache = { at: 0, value: null }, busy = Promise.resolve();
const serial = (f) => { const p = busy.then(f, f); busy = p.catch(() => {}); return p; };

function header(dev, id, size) {
  const b = Buffer.alloc(16);
  b.write('ORGB', 0, 'latin1'); b.writeUInt32LE(dev, 4); b.writeUInt32LE(id, 8); b.writeUInt32LE(size, 12);
  return b;
}
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

// One connection for one job: connect (short timeout, so a closed OpenRGB costs nothing), agree the protocol, run, close.
function session(job, ms = 4000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: PORT });
    let buf = Buffer.alloc(0), waiters = [], done = false;
    const finish = (err, v) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(v); };
    const timer = setTimeout(() => finish(new Error('OpenRGB did not answer in time')), ms);
    sock.on('error', (e) => finish(e.code === 'ECONNREFUSED' ? Object.assign(new Error('OpenRGB is not running (no SDK server on port 6742)'), { notRunning: true }) : e));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 16) {
        if (buf.toString('latin1', 0, 4) !== 'ORGB') return finish(new Error('not an OpenRGB answer'));
        const size = buf.readUInt32LE(12);
        if (buf.length < 16 + size) break;
        const pkt = { dev: buf.readUInt32LE(4), id: buf.readUInt32LE(8), data: buf.subarray(16, 16 + size) };
        buf = buf.subarray(16 + size);
        const i = waiters.findIndex((w) => w.id === pkt.id);
        if (i >= 0) waiters.splice(i, 1)[0].resolve(pkt);   // anything else (e.g. "device list updated") is ignored
      }
    });
    const send = (dev, id, data = Buffer.alloc(0)) => sock.write(Buffer.concat([header(dev, id, data.length), data]));
    const ask = (dev, id, data, wait = ms) => new Promise((res, rej) => {
      const w = { id, resolve: res };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(Object.assign(new Error('no answer'), { noAnswer: true })); } }, wait);
      send(dev, id, data);
    });
    sock.on('connect', async () => {
      try {
        // protocol 3 exactly (OpenRGB 0.7+): every saved mode block has the same shape, so a backup always restores in
        // the format OpenRGB reads it in. No answer (a slow or pre-0.5 OpenRGB) is an error, never a guess.
        let proto;
        try { proto = Math.min(WANT, (await ask(0, ID.version, u32(WANT), 3000)).data.readUInt32LE(0)); }
        catch (e) { throw e.noAnswer ? new Error('OpenRGB did not say its protocol version (it needs 0.7 or newer; 1.1 is best)') : e; }
        if (proto < WANT) throw new Error(`OpenRGB speaks protocol ${proto}; DeviceHub needs OpenRGB 0.7 or newer (1.1 is best)`);
        const name = Buffer.from('DeviceHub\0', 'latin1');
        send(0, ID.name, name);
        finish(null, await job({ proto, send, ask }));
      } catch (e) { finish(e); }
    });
  });
}

// ---- reading a controller (Device Data block, protocol 0-3)
function reader(b) {
  let o = 0;
  const r = {
    u16: () => { const v = b.readUInt16LE(o); o += 2; return v; },
    u32: () => { const v = b.readUInt32LE(o); o += 4; return v; },
    i32: () => { const v = b.readInt32LE(o); o += 4; return v; },
    str: () => { const n = r.u16(); const s = b.toString('utf8', o, o + n).replace(/\0+$/, ''); o += n; return s; },
    skip: (n) => { o += n; },
    get at() { return o; },
  };
  return r;
}
const hex = (c) => `#${[c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const color = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return (r | (g << 8) | (b << 16)) >>> 0; };

function parseController(data, proto, index) {
  const r = reader(data);
  r.u32();                                   // data_size
  const c = { index, type: r.i32(), name: r.str() };
  c.vendor = proto >= 1 ? r.str() : '';
  c.description = r.str(); c.version = r.str(); c.serial = r.str(); c.location = r.str();
  const numModes = r.u16();
  c.activeMode = r.i32();
  c.modes = [];
  for (let i = 0; i < numModes; i++) {
    const start = r.at;
    const m = { name: r.str(), value: r.i32(), flags: r.u32() };
    r.u32(); r.u32();                        // speed min, max
    if (proto >= 3) { r.u32(); r.u32(); }     // brightness min, max
    r.u32(); r.u32();                        // colors min, max
    m.speed = r.u32();
    if (proto >= 3) m.brightness = r.u32();
    m.direction = r.u32(); m.colorMode = r.u32();
    const nc = r.u16(); for (let k = 0; k < nc; k++) r.u32();
    m.raw = data.subarray(start, r.at).toString('base64');   // kept whole, to put this mode back exactly
    c.modes.push(m);
  }
  const numZones = r.u16();
  c.zones = [];
  for (let i = 0; i < numZones; i++) {
    const z = { name: r.str(), type: r.i32() };
    r.u32(); r.u32(); z.leds = r.u32();      // leds min, max, count
    const ml = r.u16(); if (ml) r.skip(ml);  // matrix map (height, width, data)
    c.zones.push(z);
  }
  const numLeds = r.u16();
  for (let i = 0; i < numLeds; i++) { r.str(); r.u32(); }
  const numColors = r.u16();
  c.colors = [];
  for (let i = 0; i < numColors; i++) c.colors.push(hex(r.u32()));
  return c;
}

async function readAll({ proto, ask }) {
  const n = (await ask(0, ID.count)).data.readUInt32LE(0);
  const list = [];
  for (let i = 0; i < n; i++) {
    const pkt = await ask(i, ID.data, proto ? u32(proto) : Buffer.alloc(0));
    list.push(parseController(pkt.data, proto, i));
  }
  return list;
}
const shapeOut = (c) => ({
  index: c.index, name: c.name, vendor: c.vendor, type: TYPES[c.type] || 'other', location: c.location,
  zones: c.zones.map((z) => ({ name: z.name, leds: z.leds })), leds: c.colors.length,
  mode: c.modes[c.activeMode]?.name || null, color: c.colors[0] || null,
  same: c.colors.every((x) => x === c.colors[0]),
});
// RGBController device types (OpenRGB's RGBController.h)
const TYPES = ['motherboard', 'ram', 'gpu', 'cooler', 'led strip', 'keyboard', 'mouse', 'mousemat', 'headset', 'headset stand', 'gamepad', 'light', 'speaker', 'virtual', 'storage', 'case', 'microphone', 'accessory', 'keypad'];

async function status(fresh = false) {
  if (!fresh && cache.value && Date.now() - cache.at < 10000) return cache.value;
  let value;
  try {
    value = await serial(() => session(async (s) => ({ running: true, protocol: s.proto, controllers: (await readAll(s)).map(shapeOut) })));
  } catch (e) {
    value = { running: false, reason: e.notRunning ? 'not running' : e.message, controllers: [] };
  }
  cache = { at: Date.now(), value };
  return value;
}

// One light is known by its name, where OpenRGB found it and its LED count, never by its number in the list (the
// numbers change when OpenRGB rescans or restarts).
const keyOf = (c) => `${c.name}|${c.location}|${c.colors.length}`;
const PER_LED = 1;   // a mode's color_mode: MODE_COLORS_PER_LED (OpenRGB's RGBController.h)
// what each light was before DeviceHub first changed it, kept until DeviceHub stops (and in backups/)
const saved = new Map();
function backupNew(list) {
  const fresh = list.filter((c) => !saved.has(keyOf(c)));
  if (!fresh.length) return null;
  for (const c of fresh) {
    const m = c.modes[c.activeMode];
    saved.set(keyOf(c), { key: keyOf(c), name: c.name, location: c.location, activeMode: c.activeMode, modeName: m?.name || null, mode: m?.raw || null, perLed: m?.colorMode === PER_LED, colors: c.colors, proto: WANT });
  }
  if (!backupDir) return null;
  const file = path.join(backupDir, `openrgb-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeAtomic(file, JSON.stringify({ takenAt: new Date().toISOString(), why: 'before the first change through OpenRGB', protocol: WANT, controllers: fresh.map((c) => saved.get(keyOf(c))) }, null, 1));
  return file;
}
// lights DeviceHub runs itself (its own mouse, headset, keyboard): left to DeviceHub, never written through OpenRGB too
let ownDevice = null;
const isOwn = (c) => !!ownDevice && ownDevice.test(c.location || '');
const leds = (n, hexes) => {
  const body = Buffer.alloc(6 + 4 * n);
  body.writeUInt32LE(body.length, 0); body.writeUInt16LE(n, 4);
  for (let i = 0; i < n; i++) body.writeUInt32LE(color(typeof hexes === 'string' ? hexes : hexes[i]), 6 + 4 * i);
  return body;
};

// Set one light (or all) to one color. Custom mode is OpenRGB's "Direct" (colors set from the PC).
async function setColor(target, hexColor) {
  if (!/^#[0-9a-f]{6}$/i.test(hexColor)) throw new Error('color must look like #rrggbb');
  return serial(() => session(async (s) => {
    const before = await readAll(s);
    const chosen = before.filter((c) => (target === 'all' ? !isOwn(c) : c.index === Number(target)));
    if (!chosen.length) throw new Error(target === 'all' ? 'no OpenRGB lights to set' : 'no such OpenRGB device');
    const file = backupNew(chosen);
    const want = hexColor.toLowerCase();
    for (const c of chosen) { s.send(c.index, ID.customMode); s.send(c.index, ID.updateLeds, leds(c.colors.length, want)); }
    await new Promise((r) => setTimeout(r, 250));
    const after = new Map((await readAll(s)).map((c) => [keyOf(c), c]));
    cache.at = 0;
    const failed = chosen.filter((c) => { const a = after.get(keyOf(c)); return !a || a.modes[a.activeMode]?.colorMode !== PER_LED || !a.colors.every((x) => x === want); }).map((c) => c.name);
    if (failed.length) throw new Error(`OpenRGB reports another color or mode on ${failed.join(', ')}`);
    return { changed: chosen.map((c) => c.name), backup: file };
  }));
}

// Put every light back as it was before DeviceHub first changed it: matched by name and place in a fresh read (a light
// no longer there is skipped and named), then its colors and its mode. For a per-LED mode the mode goes first (the
// colors only show in it); for an effect mode the colors first and the mode last, so nothing overrides the effect.
async function restore() {
  if (!saved.size) throw new Error('nothing changed through OpenRGB yet');
  return serial(() => session(async (s) => {
    const now = new Map((await readAll(s)).map((c) => [keyOf(c), c]));
    const missing = [], done = [];
    for (const b of saved.values()) {
      const c = now.get(b.key);
      if (!c) { missing.push(b.name); continue; }
      if (b.proto !== s.proto) { missing.push(`${b.name} (another protocol)`); continue; }
      const mode = () => { if (!b.mode) return; const m = Buffer.from(b.mode, 'base64'); const body = Buffer.alloc(8 + m.length); body.writeUInt32LE(body.length, 0); body.writeInt32LE(b.activeMode, 4); m.copy(body, 8); s.send(c.index, ID.updateMode, body); };
      if (b.perLed) { mode(); s.send(c.index, ID.updateLeds, leds(b.colors.length, b.colors)); }
      else { s.send(c.index, ID.updateLeds, leds(b.colors.length, b.colors)); mode(); }
      done.push(b);
    }
    await new Promise((r) => setTimeout(r, 250));
    const after = new Map((await readAll(s)).map((c) => [keyOf(c), c]));
    cache.at = 0;
    const off = done.filter((b) => { const a = after.get(b.key); return !a || a.activeMode !== b.activeMode || (b.perLed && a.colors.join() !== b.colors.join()); }).map((b) => b.name);
    if (off.length || missing.length) throw new Error([off.length ? `not put back: ${off.join(', ')}` : null, missing.length ? `not found now: ${missing.join(', ')}` : null].filter(Boolean).join('; '));
    for (const b of done) saved.delete(b.key);
    return { restored: done.map((b) => b.name) };
  }));
}

module.exports = { start: (dir, opts = {}) => { backupDir = dir; ownDevice = opts.ownDevice || null; }, status, setColor, restore, _test: { parseController, PORT } };
