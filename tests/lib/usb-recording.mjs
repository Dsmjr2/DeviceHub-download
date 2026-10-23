// A USBPcap recording written by hand (the format USBPcapCMD writes: pcap, link type 249), for the learning tests.
// Moved out of tests/learn-wizard.mjs (23 Oct 2026) so tests/learn-bench.mjs records with the same writer.
//   const r = new Rec(); r.descriptor(device, vid, pid); r.out(...); r.inp(...); r.setFeature(...); r.getFeature(...);
//   r.pcap() -> Buffer (USBPcap's own), r.pcapng() (as Wireshark saves it), r.usbmon() (Linux, link type 220)
export class Rec {
  constructor() { this.recs = []; this.ts = 1761100000; this.irp = 1000n; }
  add(r) { this.ts += 0.004; this.recs.push({ ts: this.ts, bus: 1, ...r }); }
  // the device descriptor USBPcap injects for a connected device
  descriptor(device, vid, pid) {
    const irp = this.irp++;
    const d = [18, 1, 0, 2, 0, 0, 0, 64, vid & 255, vid >> 8, pid & 255, pid >> 8, 0, 1, 1, 2, 0, 1];
    this.add({ irp, in: false, device, endpoint: 0x80, transfer: 2, stage: 0, data: [0x80, 6, 0, 1, 0, 0, 18, 0] });
    this.add({ irp, in: true, device, endpoint: 0x80, transfer: 2, stage: 3, data: d });
  }
  out(device, bytes, ep = 1) { this.add({ irp: this.irp++, in: false, device, endpoint: ep, transfer: 1, data: bytes }); }
  inp(device, bytes, ep = 0x81) { this.add({ irp: this.irp++, in: true, device, endpoint: ep, transfer: 1, data: bytes }); }
  setFeature(device, id, bytes) {
    const irp = this.irp++, payload = id ? [id, ...bytes] : bytes;
    this.add({ irp, in: false, device, endpoint: 0, transfer: 2, stage: 0, data: [0x21, 9, id, 3, 0, 0, payload.length & 255, payload.length >> 8] });
    this.add({ irp, in: false, device, endpoint: 0, transfer: 2, stage: 1, data: payload });
    this.add({ irp, in: true, device, endpoint: 0, transfer: 2, stage: 3, data: [] });
  }
  getFeature(device, id, bytes) {
    const irp = this.irp++, payload = id ? [id, ...bytes] : bytes;
    this.add({ irp, in: false, device, endpoint: 0x80, transfer: 2, stage: 0, data: [0xa1, 1, id, 3, 0, 0, payload.length & 255, payload.length >> 8] });
    this.add({ irp, in: true, device, endpoint: 0x80, transfer: 2, stage: 1, data: payload });
  }
  pcap() {
    const parts = [];
    const g = Buffer.alloc(24);
    g.writeUInt32LE(0xa1b2c3d4, 0); g.writeUInt16LE(2, 4); g.writeUInt16LE(4, 6); g.writeUInt32LE(65535, 16); g.writeUInt32LE(249, 20);
    parts.push(g);
    for (const { ts, p } of this.packets()) {
      const h = Buffer.alloc(16);
      h.writeUInt32LE(Math.floor(ts), 0); h.writeUInt32LE(Math.round((ts % 1) * 1e6), 4); h.writeUInt32LE(p.length, 8); h.writeUInt32LE(p.length, 12);
      parts.push(h, p);
    }
    return Buffer.concat(parts);
  }
  // the same as Wireshark saves it by default (pcapng: a section, one interface, enhanced packet blocks), 23 Oct 2026
  pcapng(link = 249, packets = this.packets()) {
    const block = (type, body) => { const n = 12 + ((body.length + 3) & ~3); const b = Buffer.alloc(n); b.writeUInt32LE(type, 0); b.writeUInt32LE(n, 4); body.copy(b, 8); b.writeUInt32LE(n, n - 4); return b; };
    const shb = Buffer.alloc(16); shb.writeUInt32LE(0x1a2b3c4d, 0); shb.writeUInt16LE(1, 4); shb.writeInt32LE(-1, 8); shb.writeInt32LE(-1, 12);
    const idb = Buffer.alloc(8); idb.writeUInt16LE(link, 0); idb.writeUInt32LE(65535, 4);
    const parts = [block(0x0a0d0d0a, shb), block(1, idb)];
    for (const { ts, p } of packets) {
      const us = BigInt(Math.round(ts * 1e6));
      const e = Buffer.alloc(20 + p.length); e.writeUInt32LE(0, 0); e.writeUInt32LE(Number(us >> 32n), 4); e.writeUInt32LE(Number(us & 0xffffffffn), 8);
      e.writeUInt32LE(p.length, 12); e.writeUInt32LE(p.length, 16); p.copy(e, 20);
      parts.push(block(6, e));
    }
    return Buffer.concat(parts);
  }
  // the same recorded on Linux (usbmon, link type 220, saved as pcapng): a submit and a completion per transfer, a
  // control transfer's setup in the header with its OUT data after, its IN data on the completion
  usbmon() {
    const packets = [], byIrp = new Map();
    const pkt = (r, kind, data, setup = null) => {
      const p = Buffer.alloc(64 + data.length);
      p.writeBigUInt64LE(BigInt(r.irp), 0); p[8] = kind.charCodeAt(0); p[9] = r.transfer; p[10] = r.endpoint; p[11] = r.device; p.writeUInt16LE(r.bus, 12);
      p[14] = setup ? 0 : 0x2d; p[15] = data.length ? 0 : 0x3c; p.writeUInt32LE(data.length, 32); p.writeUInt32LE(data.length, 36);
      if (setup) Buffer.from(setup).copy(p, 40);
      Buffer.from(data).copy(p, 64);
      packets.push({ ts: r.ts, p });
    };
    for (const r of this.recs) {
      if (r.transfer === 1) {
        const inEp = (r.endpoint & 0x80) !== 0;
        pkt(r, 'S', inEp ? [] : r.data); pkt(r, 'C', inEp ? r.data : []);
        continue;
      }
      const t = byIrp.get(r.irp) || { setup: null, out: [], done: false };
      byIrp.set(r.irp, t);
      if (r.stage === 0) { t.setup = r.data.slice(0, 8); if (!(t.setup[0] & 0x80)) continue; pkt(r, 'S', [], t.setup); continue; }
      if (r.stage === 1 && !r.in) { pkt(r, 'S', r.data, t.setup); continue; }        // OUT data: the submit carries it
      if (r.stage === 1 && r.in) { pkt(r, 'C', r.data); t.done = true; continue; }    // IN data: the completion carries it
      if (r.stage === 3 && !t.done) { if (!(t.setup?.[0] & 0x80) && !packets.some((x) => x.p.readBigUInt64LE(0) === BigInt(r.irp))) pkt(r, 'S', [], t.setup); if (r.data.length) pkt(r, 'C', r.data); }
    }
    return this.pcapng(220, packets);
  }
  packets() {
    const out = [];
    for (const r of this.recs) {
      const hl = r.transfer === 2 ? 28 : 27;
      const p = Buffer.alloc(hl + r.data.length);
      p.writeUInt16LE(hl, 0); p.writeBigUInt64LE(BigInt(r.irp), 2); p.writeUInt32LE(0, 10); p.writeUInt16LE(9, 14);
      p[16] = r.in ? 1 : 0; p.writeUInt16LE(r.bus, 17); p.writeUInt16LE(r.device, 19); p[21] = r.endpoint; p[22] = r.transfer;
      p.writeUInt32LE(r.data.length, 23);
      if (hl === 28) p[27] = r.stage ?? 0;
      Buffer.from(r.data).copy(p, hl);
      out.push({ ts: r.ts, p });
    }
    return out;
  }
}
export const pad = (bytes, len) => { const a = new Array(len).fill(0); bytes.forEach((b, i) => { a[i] = b; }); return a; };
