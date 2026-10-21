// Mouse learning sessions (19 Oct 2026): reads the Pulsar mouse's settings memory and compares two reads, so a
// setting changed in the Pulsar app shows exactly which bytes it lives in. Read-only: it enters host control, reads,
// and leaves host control; it never writes. Quit DeviceHub first (both would talk to the mouse at once).
//   node helpers/mouse-learn.mjs read <name>        reads up to 1024 bytes into learn/<name>.json
//   node helpers/mouse-learn.mjs diff <a> <b>       lists every byte that differs between two reads
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const native = require('./native.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, '..', 'learn');

function pkt(cmd, addr = 0, len = 0, data = []) {
  const p = new Array(16).fill(0);
  p[0] = cmd; p[2] = addr >> 8; p[3] = addr & 0xff; p[4] = len;
  data.forEach((b, i) => { p[5 + i] = b; });
  let sum = 0x08; for (let i = 0; i < 15; i++) sum += p[i];
  p[15] = (0x55 - (sum & 0xff)) & 0xff;
  return p.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}
const bytes = (r) => r.split(' ').map((x) => parseInt(x, 16));

async function channel() {
  // the cable when it is plugged in, else the dongle
  for (const pid of ['3506', '5406']) {
    const chan = `hid:3710:${pid}:FF02:0002:16:8`;
    if ((await native.request(chan, 'OPEN', 15000)) === 'OK') return { chan, via: pid === '3506' ? 'cable' : 'dongle' };
  }
  throw new Error('mouse not found (is DeviceHub closed, and the mouse plugged in or its dongle in?)');
}
async function req(chan, p) {
  const r = await native.request(chan, `REQ 1 900 ${p}`, 4000);
  if (!/^[0-9a-f ]+$/.test(r)) throw new Error(`no reply (${r}); move the mouse to wake it and run again`);
  return bytes(r);
}

async function read(name) {
  const { chan, via } = await channel();
  const on = await req(chan, pkt(3, 0, 1, [1]));
  if (on[5] !== 1) throw new Error('mouse is asleep or out of range: move it and run again');
  const flash = [];
  let end = 0;
  try {
    for (let addr = 0; addr < 1024; addr += 10) {
      const n = Math.min(10, 1024 - addr);
      const r = await req(chan, pkt(8, addr, n));
      if (r[1] !== 0) break;  // refused: past the end of the settings memory
      flash.push(...r.slice(5, 5 + n));
      end = addr + n;
    }
  } finally { await native.request(chan, `REQ 1 900 ${pkt(3, 0, 1, [0])}`, 4000); await native.request(chan, 'CLOSE', 3000); }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify({ at: new Date().toISOString(), via, bytes: end, flash }));
  console.log(`read ${end} bytes over the ${via} into learn/${name}.json`);
}

function diff(a, b) {
  const A = JSON.parse(fs.readFileSync(path.join(DIR, `${a}.json`), 'utf8')).flash;
  const B = JSON.parse(fs.readFileSync(path.join(DIR, `${b}.json`), 'utf8')).flash;
  const rows = [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) rows.push(`  ${String(i).padStart(4)} (0x${i.toString(16).padStart(3, '0')}): ${A[i] ?? '-'} -> ${B[i] ?? '-'}`);
  console.log(rows.length ? `${rows.length} bytes differ between ${a} and ${b}:\n${rows.join('\n')}` : `${a} and ${b} are identical`);
}

const [cmd, x, y] = process.argv.slice(2);
try {
  if (cmd === 'read' && x) await read(x);
  else if (cmd === 'diff' && x && y) diff(x, y);
  else console.log('usage: read <name> | diff <a> <b>');
} catch (e) { console.log('error:', e.message); process.exitCode = 1; }
native.stop();
setTimeout(() => process.exit(), 300);
