// Offline test of the real mouse adapter against a simulated Pulsar mouse whose flash starts as the snapshot
// read from Shawn's mouse on 16 Oct 2026. Checks good writes land, bad writes are refused before anything is sent.
const FLASH = '32,53,3,82,2,83,0,85,0,85,3,82,74,74,0,193,79,79,0,183,159,159,0,23,63,63,68,147,127,127,136,207,55,55,34,197,55,55,34,197,55,55,34,197,52,248,242,55,0,0,255,86,0,255,0,86,255,255,0,87,255,163,0,179,242,10,234,111,242,10,234,111,242,10,234,111,2,83,128,213,3,82,0,85,255,0,255,87,0,85,128,213,3,82,0,85,1,1,0,83,1,2,0,82,1,4,0,80,1,8,0,76,1,16,0,68,2,1,0,82,2,2,0,81,2,3,0,80,7,0,0,78,8,4,0,73,4,10,3,68,0,0,0,85,0,0,0,85,0,0,0,85,0,0,0,85,0,0,0,85,1,255,0,255,7,9,70,0,85,2,83,0,85,3,82,0,85,0,85,0,85,0,85,3,82,0,85,10,75,0,85,0,85,0,85,0,0,128,63,150'.split(',').map(Number);
const flash = [...FLASH, ...Array(56).fill(0)];
const writes = [];
const listeners = new Set();
const device = {
  vendorId: 0x3710, productId: 0x5406, productName: 'Pulsar 8K Dongle (simulated)', opened: false,
  collections: [{ usagePage: 0xff02, usage: 2, inputReports: [], outputReports: [], featureReports: [] }],
  async open() { this.opened = true; },
  addEventListener(t, f) { listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
  async sendReport(id, data) {
    const p = Uint8Array.from(data);
    let sum = 8; for (let i = 0; i < 15; i++) sum += p[i];
    if (p[15] !== ((0x55 - (sum & 0xff)) & 0xff)) throw new Error('bad checksum sent');
    const r = new Uint8Array(16); r[0] = p[0];
    const addr = (p[2] << 8) | p[3], len = p[4];
    if (p[0] === 0x03) { r[5] = 1; }
    else if (p[0] === 0x04) { r[5] = 90; }
    else if (p[0] === 0x12 || p[0] === 0x1d) { r[5] = 3; r[6] = 3; }
    else if (p[0] === 0x08) { for (let i = 0; i < len; i++) r[5 + i] = flash[addr + i]; }
    else if (p[0] === 0x07) { writes.push([addr, ...p.slice(5, 5 + len)]); for (let i = 0; i < len; i++) flash[addr + i] = p[5 + i]; }
    setTimeout(() => listeners.forEach((f) => f({ reportId: 8, data: new DataView(r.buffer) })), 1);
  },
};
Object.defineProperty(globalThis.navigator, 'hid', { value: { getDevices: async () => [device], requestDevice: async () => [device] }, configurable: true });

const { default: mouse } = await import('../public/devices/mouse-adapter.js');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : '  FAIL'} ${m}`); if (!c) fails++; };
const refused = async (key, value, why) => {
  const before = writes.length;
  try { await mouse.write(key, value); ok(false, `${why}: was accepted`); } catch (e) { ok(writes.length === before, `${why}: refused, nothing sent (${e.message})`); }
};

await mouse.connect(false);
const v = await mouse.read();
ok(v.pollingRate === 4000 && v.liftOff === 3 && v.dpi2 === 1600 && v.dpi5 === 12800 && v.stageCount === 3, `reads the real snapshot: ${v.pollingRate} Hz, LOD ${v.liftOff}, DPI ${v.dpi0}/${v.dpi1}/${v.dpi2}, ${v.stageCount} stages`);
ok(await mouse.write('debounce', 4) === 4 && flash[169] === 4 && flash[170] === 0x51, 'debounce 2 -> 4 lands with its check byte');
ok(await mouse.write('pollingRate', 1000) === 1000 && flash[0] === 1, 'polling 4000 -> 1000 lands as code 1');
ok(await mouse.write('dpi1', 900) === 900, 'DPI stage 2 -> 900');
ok(await mouse.write('dpi4', 16000) === 16000, 'DPI stage 5 -> 16000 (high range)');
ok(await mouse.write('dpiStage', 2) === 2 && flash[4] === 1, 'active stage -> 2');
ok(v.btn0 === 'left' && v.btn1 === 'right' && v.btn5 === 'dpiCycle', `buttons decode: ${[0, 1, 2, 3, 4, 5].map((i) => v[`btn${i}`]).join(', ')}`);
ok(await mouse.write('btn4', 'dpiUp') === 'dpiUp' && flash.slice(112, 116).join() === '2,2,0,81', 'forward button -> DPI up lands as 2,2,0,81');
ok(await mouse.write('btn4', 'forward') === 'forward' && flash.slice(112, 116).join() === '1,16,0,68', 'forward button restored to 1,16,0,68');
await refused('btn0', 'right', 'remap left click');
await refused('btn1', 'keyboardA', 'unknown action');
await refused('btn6', 'back', 'button 7');
await refused('btn1', 'toString', 'action "toString"');
await refused('debounce', -1, 'debounce -1');
await refused('debounce', 16, 'debounce 16');
await refused('dpiStage', 0, 'stage 0');
await refused('dpiStage', 2.5, 'stage 2.5');
await refused('dpiStage', 5, 'stage 5 (outside the 3-stage cycle)');
await refused('dpi', 800, 'key "dpi"');
await refused('dpiX', 800, 'key "dpiX"');
await refused('dpi1.5', 800, 'key "dpi1.5"');
await refused('dpi8', 800, 'slot 9');
await refused('dpi0', 805, 'DPI 805');
await refused('dpi0', 30000, 'DPI 30000');
await refused('pollingRate', 3000, 'polling 3000 Hz');
await refused('liftOff', 4, 'lift-off code 4');
await refused('motionSync', 'true', 'motion sync "true" (text)');
await refused('sleepRaw', 5, 'sleep timer');
await refused('__proto__', 1, 'key "__proto__"');
const addrs = new Set(writes.map((w) => w[0]));
ok([...addrs].every((a) => [169, 0, 16, 28, 4, 112].includes(a)), `only intended addresses were written: ${[...addrs].join(', ')}`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exitCode = fails ? 1 : 0;
