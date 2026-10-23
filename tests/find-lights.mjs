// Find my lights (helpers/find-lights.js through helpers/openrgb.js) against a stand-in OpenRGB SDK server on a spare
// port, written from OpenRGB's protocol document like tests/openrgb-mock.mjs: every zone gets its own color in ONE send
// for the light, the names are saved per board and used (before ZONE_NAMES), hidden zones are marked, Save and Cancel
// put the lights back as they were just before the test, and DeviceHub's own headset is never part of it.
// Run: node tests/find-lights.mjs  (no OpenRGB, no hardware)
import net from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);

const PORT = 46746;
const str = (s) => { const b = Buffer.from(s + '\0', 'utf8'); const l = Buffer.alloc(2); l.writeUInt16LE(b.length); return Buffer.concat([l, b]); };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const rgb = (r, g, b) => (r | (g << 8) | (b << 16)) >>> 0;
const hexOf = (c) => `#${[c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const DIRECT = () => ({ name: 'Direct', value: 0, flags: 0, speed: 0, brightness: 100, direction: 0, colorMode: 1, colors: [] });
const STATIC = () => ({ name: 'Static', value: 1, flags: 0, speed: 0, brightness: 80, direction: 0, colorMode: 2, colors: [rgb(255, 0, 0)] });

const light = (type, name, location, zones, active, modes) => ({ type, name, vendor: 'Example', location, zones, active, modes, colors: Array.from({ length: zones.reduce((a, z) => a + z[1], 0) }, (_, i) => rgb(10 + i, 20 + type, 30)) });
let devs = [
  // a board: logo, a fan header with fans, a fan header with nothing sized (0 LEDs), a second logo
  light(0, 'B450 AORUS PRO WIFI-CF', 'SMBus 0x68', [['Motherboard', 5], ['D_LED1 header', 10], ['D_LED2 header', 0], ['???', 3]], 1, [DIRECT(), STATIC()]),
  light(1, 'Trident Z RGB', 'SMBus 0x58', [['DIMM', 8]], 0, [DIRECT()]),
  light(8, 'CORSAIR HS80', 'HID: \\\\?\\hid#vid_1b1c&pid_0a6b&mi_03#x', [['Logo', 2]], 0, [DIRECT()]),
  // a strip with more zones than there are test colors
  light(4, 'Long strip', 'HID: strip', Array.from({ length: 18 }, (_, i) => [`Segment ${i + 1}`, 1]), 0, [DIRECT()]),
];
const snapshot = () => JSON.stringify(devs.map((d) => ({ name: d.name, active: d.active, modes: d.modes, colors: d.colors })));

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
      if (id === 40) s.write(pkt(0, 40, u32(4)));
      else if (id === 0) s.write(pkt(0, 0, u32(devs.length)));
      else if (id === 1) s.write(pkt(dev, 1, deviceData(devs[dev])));
      else if (id === 1100) devs[dev].active = 0;
      else if (id === 1050) { const n = data.readUInt16LE(4); for (let i = 0; i < n; i++) devs[dev].colors[i] = data.readUInt32LE(6 + 4 * i); }
      else if (id === 1101) { const { idx, m } = parseMode(data); devs[dev].active = idx; devs[dev].modes[idx] = m; }
    }
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const tmp = path.join(os.tmpdir(), `devicehub-find-lights-${process.pid}`);
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'openrgb.js'), fs.readFileSync(new URL('../helpers/openrgb.js', import.meta.url), 'utf8').replace('PORT = 6742', `PORT = ${PORT}`));
for (const f of ['safe-write.js', 'find-lights.js']) fs.copyFileSync(new URL(`../helpers/${f}`, import.meta.url), path.join(tmp, f));
const namesFile = path.join(tmp, 'lights-names.json');
const orgb = require(path.join(tmp, 'openrgb.js'));
orgb.start(tmp, { ownDevice: /vid_1b1c&pid_0a6b/i, namesFile });

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const refused = async (f) => { try { await f(); return false; } catch { return true; } };
const zoneHexes = (d) => { let at = 0; return d.zones.map(([, n]) => { const c = d.colors.slice(at, at + n).map(hexOf); at += n; return c; }); };

const st0 = await orgb.status(true);
check(st0.running && st0.controllers.length === 4, `four lights (${st0.reason})`);
check(st0.controllers[0].zones[0].name === 'Top logo' && st0.controllers[0].zones[1].name === 'D_LED1 header', 'before any test: the built-in names (ZONE_NAMES) and OpenRGB\'s own');
check(!st0.findTest.running, 'no test running at first');
check(await refused(() => orgb.findSave({ target: 0, names: { 0: 'x' } })), 'Save with no test running is refused');
check(await refused(() => orgb.findCancel()), 'Cancel with no test running is refused');
check(await refused(() => orgb.findStart(2)), 'DeviceHub\'s own headset is never tested through OpenRGB');

// 1. one color per zone, in one send for the light
const beforeTest = snapshot();
sent = [];
const r = await orgb.findStart(0);
const board = devs[0];
check(sent.join() === 'B450 AORUS PRO WIFI-CF:1100,B450 AORUS PRO WIFI-CF:1050', `one send for the whole board, nothing else touched (${sent})`);
const z = zoneHexes(board);
check(z[0].every((c) => c === '#ff0000') && z[1].every((c) => c === '#ff6a00') && z[3].every((c) => c === '#ffd400'), `each zone its own color: red, orange, yellow (${z.map((x) => x[0])})`);
check(r.zones[0].colorName === 'Red' && r.zones[1].colorName === 'Orange' && r.zones[2].color === null && r.zones[3].colorName === 'Yellow', 'the answer names each zone\'s color; a zone with no LEDs gets none');
check(r.running && r.index === 0 && r.name === 'B450 AORUS PRO WIFI-CF', 'the answer names the light under test');
check(new Set(r.zones.filter((x) => x.color).map((x) => x.color)).size === 3, 'colors are all different');
check(r.backup && fs.existsSync(r.backup), 'backed up before the first change');
check((await orgb.status(false)).findTest.running, 'the running test shows in the status, even from its cache');

// 2. Save: names per board, hidden zones, the lights back as before the test
const saved = await orgb.findSave({ target: 0, names: { 0: '  Case\nlogo ', 1: 'Case fans', 3: '' }, hidden: [3, 2, 99] });
check(snapshot() === beforeTest, 'Save puts the board back exactly as before the test (mode and colors)');
check(saved.saved.names[0] === 'Case logo' && saved.saved.names[1] === 'Case fans' && saved.saved.names[3] === undefined && JSON.stringify(saved.saved.hidden) === '[3]', `names cleaned and kept (${JSON.stringify(saved.saved)})`);
const file = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
const b = file.boards['B450 AORUS PRO WIFI-CF'];
check(b && b.names[0] === 'Case logo' && b.names[1] === 'Case fans' && !b.names[3], `names in lights-names.json, per board (${JSON.stringify(file)})`);
check(JSON.stringify(b.hidden) === '[3]', `only tested zones can be hidden (zone 2 had no lights, 99 is not a zone) (${b.hidden})`);
const st1 = await orgb.status(true);
const zs = st1.controllers[0].zones;
check(zs[0].name === 'Case logo' && zs[0].named, 'a saved name comes before the built-in one (ZONE_NAMES)');
check(zs[1].name === 'Case fans' && zs[2].name === 'Bottom logo' && !zs[2].hidden, 'other zones keep their names');
check(zs[3].hidden && !zs[0].hidden && !zs[1].hidden, 'the zone that lit nothing is hidden');
check(!st1.findTest.running, 'no test running after Save');

// the names outlast a restart (read from the file again)
orgb.start(tmp, { ownDevice: /vid_1b1c&pid_0a6b/i, namesFile });
const st2 = await orgb.status(true);
check(st2.controllers[0].zones[1].name === 'Case fans' && st2.controllers[0].zones[3].hidden, 'names and hidden zones read back from lights-names.json');

// 3. Cancel: back to the colors from just before the test (not to before DeviceHub's first change), names untouched
await orgb.setColor(1, '#123456');
const ramBefore = snapshot();
sent = [];
await orgb.findStart(1);
check(sent.join() === 'Trident Z RGB:1100,Trident Z RGB:1050' && devs[1].colors.every((c) => hexOf(c) === '#ff0000'), `a one-zone light: one send, red (${sent})`);
// pressing Find my lights again on the same light keeps the colors from before the first press
await orgb.findStart(1);
await orgb.findCancel();
check(snapshot() === ramBefore && devs[1].colors.every((c) => hexOf(c) === '#123456'), 'Cancel puts the RAM back to #123456, its color just before the test');
check(JSON.stringify(JSON.parse(fs.readFileSync(namesFile, 'utf8'))) === JSON.stringify(file), 'Cancel saves nothing');

// 4. a test on another light while one runs: the first goes back first
const beforeTwo = snapshot();
await orgb.findStart(0);
await orgb.findStart(3);
check(JSON.stringify(devs[0].colors) === JSON.stringify(JSON.parse(beforeTwo)[0].colors), 'starting on another light puts the first one back');
const strip = zoneHexes(devs[3]).map((x) => x[0]);
check(new Set(strip.slice(0, 16)).size === 16 && strip[16] === '#000000' && strip[17] === '#000000', `more zones than colors: 16 colors, the rest off (${strip.slice(14)})`);
const s3 = orgb.findState();
check(s3.zones[16].notInTest && s3.zones[17].notInTest, 'the zones past 16 are marked as not in this test');
await orgb.findSave({ target: 3, names: { 0: 'Desk strip', 16: 'not tested' }, hidden: [1, 17] });
check(snapshot() === beforeTwo, 'Save on the strip puts everything back as before');
const sb = JSON.parse(fs.readFileSync(namesFile, 'utf8')).boards['Long strip'];
check(sb.names[0] === 'Desk strip' && !sb.names[16] && JSON.stringify(sb.hidden) === '[1]', `untested zones are not saved (${JSON.stringify(sb)})`);
check(await refused(() => orgb.findSave({ target: 0, names: {} })), 'Save after Save is refused (no test running)');

// 5. a wrong light is refused while a test runs
await orgb.findStart(0);
check(await refused(() => orgb.findSave({ target: 1, names: {} })), 'Save for another light than the one tested is refused');
await orgb.findCancel();
check(snapshot() === beforeTwo, 'and Cancel still puts it back');

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `find-lights: FAILED: ${fails.join('; ')}` : 'find-lights (stand-in OpenRGB): all good');
process.exit(fails.length ? 1 : 0);
