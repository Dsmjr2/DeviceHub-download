// A stand-in OpenRGB SDK server, written from OpenRGB's protocol document (not from helpers/openrgb.js), on a spare
// port: proves DeviceHub reads lights, sets one color with a read-back, and puts everything back exactly, including
// (20 Oct 2026 review) a light that appears after the first change, a list that changes order before Put back, the
// mode's own bytes and the order they are sent in, DeviceHub's own headset left alone, and a too-old OpenRGB refused.
// Run: node tests/openrgb-mock.mjs  (no OpenRGB, no hardware)
import net from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);

const PORT = 46742;
const str = (s) => { const b = Buffer.from(s + '\0', 'utf8'); const l = Buffer.alloc(2); l.writeUInt16LE(b.length); return Buffer.concat([l, b]); };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const rgb = (r, g, b) => (r | (g << 8) | (b << 16)) >>> 0;
const DIRECT = () => ({ name: 'Direct', value: 0, flags: 0, speed: 0, brightness: 100, direction: 0, colorMode: 1, colors: [] });

// the pretend PC: a Gigabyte board on an effect mode, lit RAM on Direct, and the user's headset (DeviceHub's own)
const light = (type, name, location, zones, active, modes) => ({ type, name, vendor: 'Example', location, zones, active, modes, colors: Array.from({ length: zones.reduce((a, z) => a + z[1], 0) }, (_, i) => rgb(10 + i, 20 + type, 30)) });
let devs = [
  light(0, 'B450 AORUS PRO WIFI-CF', 'SMBus 0x68', [['Motherboard', 5], ['D_LED1 header', 10]], 1, [DIRECT(), { name: 'Static', value: 1, flags: 0, speed: 0, brightness: 80, direction: 0, colorMode: 2, colors: [rgb(255, 0, 0)] }, { name: 'Breathing', value: 2, flags: 0, speed: 40, brightness: 60, direction: 1, colorMode: 2, colors: [rgb(0, 0, 255)] }]),
  light(1, 'Trident Z RGB', 'SMBus 0x58', [['DIMM', 8]], 0, [DIRECT()]),
  light(8, 'CORSAIR HS80', 'HID: \\\\?\\hid#vid_1b1c&pid_0a6b&mi_03#x', [['Logo', 2]], 0, [DIRECT()]),
];
const snapshot = () => JSON.stringify(devs.map((d) => ({ name: d.name, active: d.active, modes: d.modes, colors: d.colors })).sort((a, b) => a.name.localeCompare(b.name)));

let serverProto = 4;
const modeBlock = (m) => Buffer.concat([str(m.name), i32(m.value), u32(m.flags), u32(0), u32(100), u32(0), u32(100), u32(0), u32(m.colors.length), u32(m.speed), u32(m.brightness), u32(m.direction), u32(m.colorMode), u16(m.colors.length), ...m.colors.map(u32)]);
function deviceData(d) {   // protocol 3
  const body = Buffer.concat([
    i32(d.type), str(d.name), str(d.vendor), str('pretend'), str('1.0'), str(''), str(d.location),
    u16(d.modes.length), i32(d.active), ...d.modes.map(modeBlock),
    u16(d.zones.length), ...d.zones.map(([n, c]) => Buffer.concat([str(n), i32(1), u32(c), u32(c), u32(c), u16(0)])),
    u16(d.colors.length), ...d.colors.map((_, i) => Buffer.concat([str(`LED ${i + 1}`), u32(i)])),
    u16(d.colors.length), ...d.colors.map(u32),
  ]);
  return Buffer.concat([u32(body.length + 4), body]);
}
// an UpdateMode payload, read at protocol 3 as OpenRGB reads it
function parseMode(b) {
  let o = 8; const s = () => { const n = b.readUInt16LE(o); o += 2; const v = b.toString('utf8', o, o + n - 1); o += n; return v; };
  const U = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const m = { name: s(), value: b.readInt32LE((o += 4) - 4), flags: U() }; U(); U(); U(); U(); U(); U();
  m.speed = U(); m.brightness = U(); m.direction = U(); m.colorMode = U();
  const n = b.readUInt16LE(o); o += 2; m.colors = []; for (let i = 0; i < n; i++) m.colors.push(U());
  return { idx: b.readInt32LE(4), m };
}
const pkt = (dev, id, data = Buffer.alloc(0)) => Buffer.concat([Buffer.from('ORGB'), u32(dev), u32(id), u32(data.length), data]);
let sent = [];
const server = net.createServer((s) => {
  let buf = Buffer.alloc(0);
  s.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 16) {
      const dev = buf.readUInt32LE(4), id = buf.readUInt32LE(8), size = buf.readUInt32LE(12);
      if (buf.length < 16 + size) break;
      const data = buf.subarray(16, 16 + size); buf = buf.subarray(16 + size);
      if (id >= 1000) sent.push(`${devs[dev].name}:${id}`);
      if (id === 40) s.write(pkt(0, 40, u32(serverProto)));
      else if (id === 0) s.write(pkt(0, 0, u32(devs.length)));
      else if (id === 1) s.write(pkt(dev, 1, deviceData(devs[dev])));
      else if (id === 1100) devs[dev].active = 0;   // Direct
      else if (id === 1050) { const n = data.readUInt16LE(4); for (let i = 0; i < n; i++) devs[dev].colors[i] = data.readUInt32LE(6 + 4 * i); }
      else if (id === 1101) { const { idx, m } = parseMode(data); devs[dev].active = idx; devs[dev].modes[idx] = m; }
    }
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// point the client at the stand-in
const src = fs.readFileSync(new URL('../helpers/openrgb.js', import.meta.url), 'utf8').replace('PORT = 6742', `PORT = ${PORT}`);
const tmp = path.join(os.tmpdir(), `devicehub-openrgb-${process.pid}`);
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'openrgb.js'), src);
fs.copyFileSync(new URL('../helpers/safe-write.js', import.meta.url), path.join(tmp, 'safe-write.js'));
fs.copyFileSync(new URL('../helpers/find-lights.js', import.meta.url), path.join(tmp, 'find-lights.js'));
fs.copyFileSync(new URL('../helpers/last-answer.js', import.meta.url), path.join(tmp, 'last-answer.js'));
const orgb = require(path.join(tmp, 'openrgb.js'));
orgb.start(tmp, { ownDevice: /vid_1b1c&pid_0a6b/i });

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const original = snapshot();
const st = await orgb.status(true);
check(st.running && st.protocol === 3, `running at protocol 3 (got ${st.running}, ${st.protocol}, ${st.reason})`);
check(st.controllers.length === 3, 'three lights');
const mb = st.controllers[0];
check(mb.name === 'B450 AORUS PRO WIFI-CF' && mb.type === 'motherboard', 'motherboard name and type');
check(mb.leds === 15 && mb.zones.length === 2 && mb.zones[1].leds === 10 && mb.mode === 'Static', 'zones, LEDs and mode');
check(st.controllers[1].type === 'ram' && st.controllers[1].leds === 8, 'RAM read after the board (parsing stays in step)');

const r = await orgb.setColor('all', '#3366FF');
check(r.changed.length === 2 && !r.changed.includes('CORSAIR HS80'), `all = the board and RAM, not DeviceHub's own headset (${r.changed})`);
check(devs[2].colors.every((c) => c !== rgb(0x33, 0x66, 0xff)), 'the headset was not written');
check(devs.slice(0, 2).every((d) => d.colors.every((c) => c === rgb(0x33, 0x66, 0xff)) && d.active === 0), 'board and RAM: Direct and #3366ff');
check(r.backup && fs.existsSync(r.backup), 'backup written before the change');

// a light that OpenRGB finds later: backed up before its first change too
devs.push(light(15, 'Case fan hub', 'HID: hub', [['Fans', 12]], 1, [DIRECT(), { name: 'Rainbow', value: 5, flags: 0, speed: 70, brightness: 90, direction: 2, colorMode: 0, colors: [] }]));
const withHub = snapshot();
const r2 = await orgb.setColor('all', '#ff0000');
check(r2.changed.includes('Case fan hub') && r2.backup && fs.existsSync(r2.backup), 'the new light was backed up and set');

// OpenRGB rescans: the list comes back in another order; Put back must match by name and place, not number
devs = [devs[3], devs[1], devs[2], devs[0]];
sent = [];
await orgb.restore();
// the board and RAM as at the very start, the hub as it was when it appeared
const hubThen = JSON.parse(withHub).find((d) => d.name === 'Case fan hub');
const expected = [...JSON.parse(original), hubThen].sort((x, y) => x.name.localeCompare(y.name));
check(snapshot() === JSON.stringify(expected), 'put back: every light, its mode bytes and its colors as before, despite the new order');
const boardSent = sent.filter((x) => x.startsWith('B450'));
check(boardSent.join() === 'B450 AORUS PRO WIFI-CF:1050,B450 AORUS PRO WIFI-CF:1101', `effect mode: colors first, mode last (${boardSent})`);
const ramSent = sent.filter((x) => x.startsWith('Trident'));
check(ramSent.join() === 'Trident Z RGB:1101,Trident Z RGB:1050', `per-LED mode: mode first, then colors (${ramSent})`);
check(!sent.some((x) => x.startsWith('CORSAIR')), 'the headset was not touched by Put back');
let refused = false; try { await orgb.restore(); } catch { refused = true; }
check(refused, 'nothing left to put back after a full Put back');

let bad = false; try { await orgb.setColor(0, 'blue'); } catch { bad = true; }
check(bad, 'a bad color is refused');
serverProto = 2;
const old = await orgb.status(true);
check(!old.running && /0\.7 or newer/.test(old.reason), `a protocol-2 OpenRGB is refused (${old.reason})`);
server.close();
const closed = await orgb.status(true);
check(!closed.running && closed.reason === 'not running', `closed OpenRGB reads as not running (${closed.reason})`);
fs.rmSync(tmp, { recursive: true, force: true });
const real = fails.filter(Boolean);
console.log(real.length ? `openrgb: FAILED: ${real.join('; ')}` : 'openrgb (stand-in server): all good');
process.exit(real.length ? 1 : 0);
