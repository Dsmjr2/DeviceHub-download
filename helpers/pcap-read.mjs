// Reads a USBPcap capture (pcap, link type 249) and prints the HID/interrupt/control messages, skipping audio.
//   node helpers/pcap-read.mjs capture.pcap [--all]
import fs from 'node:fs';

export function readPcap(file) {
  const b = fs.readFileSync(file);
  const le = b.readUInt32LE(0) === 0xa1b2c3d4;
  if (!le) throw new Error('not a little-endian pcap file');
  const link = b.readUInt32LE(20);
  if (link !== 249) throw new Error(`link type ${link}, expected 249 (USBPcap)`);
  const out = [];
  let o = 24, t0 = null;
  while (o + 16 <= b.length) {
    const sec = b.readUInt32LE(o), usec = b.readUInt32LE(o + 4), incl = b.readUInt32LE(o + 8);
    const p = b.subarray(o + 16, o + 16 + incl);
    o += 16 + incl;
    if (p.length < 27) continue;
    const headerLen = p.readUInt16LE(0);
    const t = sec + usec / 1e6;
    if (t0 == null) t0 = t;
    const rec = {
      t: +(t - t0).toFixed(4),
      irp: p.readBigUInt64LE(2), status: p.readUInt32LE(10), fn: p.readUInt16LE(14),
      in: (p[16] & 1) === 1,           // 1 = completion coming back up (device -> host)
      bus: p.readUInt16LE(17), device: p.readUInt16LE(19), endpoint: p[21], transfer: p[22], length: p.readUInt32LE(23),
      stage: p.length > 27 && p[22] === 2 ? p[27] : null,
    };
    rec.data = [...p.subarray(headerLen)];
    out.push(rec);
  }
  return out;
}

const KIND = ['iso', 'interrupt', 'control', 'bulk'];
if (process.argv[1]?.endsWith('pcap-read.mjs')) {
  const [file, flag] = process.argv.slice(2);
  const recs = readPcap(file);
  const hex = (a) => a.map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const counts = {};
  for (const r of recs) counts[KIND[r.transfer] || r.transfer] = (counts[KIND[r.transfer] || r.transfer] || 0) + 1;
  console.log(`${recs.length} records:`, JSON.stringify(counts));
  for (const r of recs) {
    if (r.transfer === 0 && flag !== '--all') continue;         // audio
    if (!r.data.length) continue;                              // submissions / completions without payload
    const dir = (r.endpoint & 0x80) ? 'IN ' : 'OUT';
    console.log(`${r.t.toFixed(3).padStart(8)}s  ${KIND[r.transfer] || r.transfer} ep${(r.endpoint & 0x7f)} ${dir} ${r.data.length}B  ${hex(r.data.slice(0, 24))}`);
  }
}
