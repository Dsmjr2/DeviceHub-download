// Reads a USBPcap capture (pcap, link type 249) and prints the HID/interrupt/control messages, skipping audio.
//   node helpers/pcap-read.mjs capture.pcap [--all]
import fs from 'node:fs';

export function readPcap(file) {
  return readPcapBuffer(fs.readFileSync(file));
}

// the same from bytes already read (helpers/learn-wizard.mjs, tests); each record also carries ts: its absolute time.
// Reads pcap (micro- or nanosecond, either byte order) and pcapng (what Wireshark saves by default), with USBPcap's
// link type 249 or Linux usbmon's 189 / 220 (23 Oct 2026, published captures: most come as pcapng, some from Linux).
// usbmon records come out in USBPcap's shape: a control submit is the setup stage with any OUT data after it, a
// completion with data is the IN data stage, interrupt OUT on submit and IN on completion.
export function readPcapBuffer(b) {
  if (b.length < 24) throw new Error('not a pcap file (too short)');
  const packets = b.readUInt32BE(0) === 0x0a0d0d0a ? pcapngPackets(b) : pcapPackets(b);
  const out = [];
  let t0 = null;
  for (const { link, ts, p } of packets) {
    const rec = link === 249 ? usbpcapRecord(p) : link === 189 || link === 220 ? usbmonRecord(p, link) : null;
    if (!rec) continue;
    if (t0 == null) t0 = ts;
    rec.t = +(ts - t0).toFixed(4); rec.ts = ts;
    out.push(rec);
  }
  if (!out.length && !packets.length) throw new Error('no packets in this capture');
  if (!out.length && !packets.some((x) => [249, 189, 220].includes(x.link))) throw new Error(`link type ${packets[0].link}, expected 249 (USBPcap) or 189 / 220 (Linux usbmon)`);
  return out;
}
const LINKS = [249, 189, 220];
function pcapPackets(b) {
  const magic = b.readUInt32LE(0);
  const le = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  const be = b.readUInt32BE(0) === 0xa1b2c3d4 || b.readUInt32BE(0) === 0xa1b23c4d;
  if (!le && !be) throw new Error('not a pcap or pcapng file');
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const nano = (le ? magic : b.readUInt32BE(0)) === 0xa1b23c4d;
  const link = u32(20) & 0xffff;
  if (!LINKS.includes(link)) throw new Error(`link type ${link}, expected 249 (USBPcap) or 189 / 220 (Linux usbmon)`);
  const out = [];
  let o = 24;
  while (o + 16 <= b.length) {
    const sec = u32(o), frac = u32(o + 4), incl = u32(o + 8);
    if (o + 16 + incl > b.length) break;
    out.push({ link, ts: sec + frac / (nano ? 1e9 : 1e6), p: b.subarray(o + 16, o + 16 + incl) });
    o += 16 + incl;
  }
  return out;
}
function pcapngPackets(b) {
  const out = [];
  let le = true, ifaces = [], o = 0;
  while (o + 12 <= b.length) {
    const type = b.readUInt32BE(o) === 0x0a0d0d0a ? 0x0a0d0d0a : le ? b.readUInt32LE(o) : b.readUInt32BE(o);
    if (type === 0x0a0d0d0a) { le = b.readUInt32LE(o + 8) === 0x1a2b3c4d; ifaces = []; }   // a new section: its own byte order and interfaces
    const u32 = (x) => (le ? b.readUInt32LE(x) : b.readUInt32BE(x));
    const u16 = (x) => (le ? b.readUInt16LE(x) : b.readUInt16BE(x));
    const len = u32(o + 4);
    if (len < 12 || o + len > b.length) break;
    if (type === 1) {
      // interface: its link type, and its time resolution (option 9: 10^-n, or 2^-n with the top bit)
      let res = 1e6;
      for (let q = o + 16; q + 4 <= o + len - 4;) {
        const code = u16(q), ol = u16(q + 2);
        if (code === 0) break;
        if (code === 9 && ol >= 1) { const v = b[q + 4]; res = v & 0x80 ? 2 ** (v & 0x7f) : 10 ** v; }
        q += 4 + ((ol + 3) & ~3);
      }
      ifaces.push({ link: u16(o + 8), res });
    } else if (type === 6 || type === 2) {
      // enhanced packet (6), or the old packet block (2, a 16-bit interface id)
      const id = type === 6 ? u32(o + 8) : u16(o + 8);
      const ifc = ifaces[id];
      const hi = u32(o + 12), lo = u32(o + 16), cap = u32(o + 20);
      if (ifc && o + 28 + cap <= o + len) out.push({ link: ifc.link, ts: (hi * 2 ** 32 + lo) / ifc.res, p: b.subarray(o + 28, o + 28 + cap) });
    } else if (type === 3 && ifaces[0]) {
      // simple packet: interface 0, no time
      const cap = Math.min(u32(o + 8), len - 16);
      out.push({ link: ifaces[0].link, ts: 0, p: b.subarray(o + 12, o + 12 + cap) });
    }
    o += len;
  }
  return out;
}
function usbpcapRecord(p) {
  if (p.length < 27) return null;
  const headerLen = p.readUInt16LE(0);
  return {
    irp: p.readBigUInt64LE(2), status: p.readUInt32LE(10), fn: p.readUInt16LE(14),
    in: (p[16] & 1) === 1,           // 1 = completion coming back up (device -> host)
    bus: p.readUInt16LE(17), device: p.readUInt16LE(19), endpoint: p[21], transfer: p[22], length: p.readUInt32LE(23),
    stage: p.length > 27 && p[22] === 2 ? p[27] : null,
    data: [...p.subarray(headerLen)],
  };
}
// Linux usbmon (pcap-linktype(7) LINUX_USB 189: a 48-byte header, LINUX_USB_MMAPPED 220: 64), written host-endian
function usbmonRecord(p, link) {
  const hl = link === 220 ? 64 : 48;
  if (p.length < hl) return null;
  const kind = String.fromCharCode(p[8]);
  if (kind !== 'S' && kind !== 'C') return null;
  const transfer = p[9], endpoint = p[10], device = p[11], bus = p.readUInt16LE(12);
  const setup = p[14] === 0, data = [...p.subarray(hl)];
  const base = { irp: p.readBigUInt64LE(0), status: p.readInt32LE(28) >>> 0, fn: 0, bus, device, endpoint, transfer, length: p.readUInt32LE(32) };
  if (transfer === 2) {
    if (kind === 'S' && setup) return { ...base, in: false, stage: 0, data: [...p.subarray(40, 48), ...data] };
    if (kind === 'C' && data.length) return { ...base, in: true, stage: 1, data };
    return null;
  }
  return { ...base, in: kind === 'C', stage: null, data: (endpoint & 0x80) ? (kind === 'C' ? data : []) : (kind === 'S' ? data : []) };
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
