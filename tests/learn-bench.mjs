// The learning test bench (23 Oct 2026, Shawn: "I really want to make sure this app can learn someones device with 0
// issues"). Pretend devices, each modelled on a real protocol style from DeviceHub's brand sheets (docs/brands/), and a
// pretend maker's app for each that changes one setting while it is recorded (USBPcap's format, tests/lib). Every style
// goes through the whole of Learn a device: find the device in the recordings (takeMessages), work out the bytes
// (analyze), take the range, build the driver.json (buildDriver), check it (validate, verifySeen), then the learned
// driver drives the SAME pretend device through DeviceHub's real driver code: it reads the setting, writes a new value,
// and the pretend device must really hold it, with every other setting it has untouched.
// The recordings and the device always agree because the app talks to the device while recording.
// Run: node tests/learn-bench.mjs [--verbose] [style]   (exit 1 when a style that should learn does not)
import * as lw from '../helpers/learn-wizard.mjs';
import { validate, fromJson } from '../helpers/declarative-driver.mjs';
import { setDeviceProvider } from '../public/devices/hid.js';
import { Rec, pad } from './lib/usb-recording.mjs';

const VERBOSE = process.argv.includes('--verbose');
const ONLY = process.argv.slice(2).find((a) => !a.startsWith('--'));
const xor = (a, from, to) => { let s = 0; for (let i = from; i <= to; i++) s ^= a[i]; return s; };
const sum8 = (a, from, to) => { let s = 0; for (let i = from; i <= to; i++) s += a[i]; return s & 255; };
const u16be = (v) => [(v >> 8) & 255, v & 255], u16le = (v) => [v & 255, (v >> 8) & 255];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexColour = (b) => `#${b.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const be16 = (a, o) => (a[o] << 8) | a[o + 1], le16 = (a, o) => a[o] | (a[o + 1] << 8);

// ---------------------------------------------------------------- the styles
// Each: the device's protocol as a tiny program (handle(request) -> reply or null) over a state with the learned
// setting and the device's other settings; app(talk, v) is what the maker's app sends when the person changes it to v.
const STYLES = [
  {
    name: 'plain-output', about: 'output reports, 64 bytes, DPI as u16le, a read that reports it (the common case)',
    vid: 0x1234, pid: 0x5678, report: 'output', len: 64, reportId: 0,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 26000, step: 50 }, next: 1200,
    state: () => ({ value: 400, other: 3 }),
    handle(s, q) {
      if (q[0] === 5 && q[1] === 0x81) return pad([5, 0x81, 0, ...u16le(s.value), s.other], 64);
      if (q[0] === 5 && q[1] === 0x01) { s.value = le16(q, 3); return pad([5, 1, 0], 64); }
      return null;
    },
    app(talk, v) { talk(pad([5, 0x81], 64)); talk(pad([5, 1, 0, ...u16le(v)], 64)); talk(pad([5, 0x81], 64)); },
  },
  {
    name: 'razer-dpi-xy', about: 'Razer: 90-byte feature report, transaction id, CRC (XOR of 2..87 at 88), DPI X and Y both big-endian',
    vid: 0x1532, pid: 0x00c5, report: 'feature', len: 90, reportId: 0,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 30000, step: 50 }, next: 1200,
    state: () => ({ value: 400, other: 1 }),
    handle(s, q) {
      const r = (args) => { const a = pad([2, 0x1f, 0, 0, 0, 7, 4, q[7], ...args], 90); a[88] = xor(a, 2, 87); return a; };
      if (q[6] === 4 && q[7] === 0x85) return r([1, ...u16be(s.value), ...u16be(s.value), 0, 0]);
      if (q[6] === 4 && q[7] === 0x05) { s.value = be16(q, 9); return r([q[8], ...q.slice(9, 13), 0, 0]); }
      return null;
    },
    app(talk, v) {
      const m = (cmd, args) => { const a = pad([0, 0x1f, 0, 0, 0, 7, 4, cmd, ...args], 90); a[88] = xor(a, 2, 87); return a; };
      talk(m(0x85, [1])); talk(m(0x05, [1, ...u16be(v), ...u16be(v), 0, 0])); talk(m(0x85, [1]));
    },
  },
  {
    name: 'razer-polling', about: 'Razer: polling rate as one code (1 = 1000 Hz, 2 = 500, 8 = 125), the same report and CRC',
    vid: 0x1532, pid: 0x00c6, report: 'feature', len: 90, reportId: 0,
    setting: { label: 'Polling rate', kind: 'choice', unit: ' Hz' }, values: ['125', '500', '1000'], next: '500',
    state: () => ({ value: 1, other: 0 }),
    handle(s, q) {
      const r = (args) => { const a = pad([2, 0x1f, 0, 0, 0, 1, 0, q[7], ...args], 90); a[88] = xor(a, 2, 87); return a; };
      if (q[6] === 0 && q[7] === 0x85) return r([s.value]);
      if (q[6] === 0 && q[7] === 0x05) { s.value = q[8]; return r([q[8]]); }
      return null;
    },
    codes: { 125: 8, 500: 2, 1000: 1 },
    app(talk, v) {
      const m = (cmd, args) => { const a = pad([0, 0x1f, 0, 0, 0, 1, 0, cmd, ...args], 90); a[88] = xor(a, 2, 87); return a; };
      talk(m(0x85, [])); talk(m(0x05, [this.codes[v]])); talk(m(0x85, []));
    },
  },
  {
    name: 'hidpp-long', about: 'Logitech-like HID++: output report id 0x11, 19 bytes, a fixed feature index and software id, DPI big-endian',
    vid: 0x2001, pid: 0x4099, report: 'output', len: 19, reportId: 0x11, ids: true,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 25600, step: 50 }, next: 1200,
    state: () => ({ value: 400 }),
    handle(s, q) {
      if (q[1] === 0x0a && q[2] === 0x2a) return pad([0xff, 0x0a, 0x2a, 0, ...u16be(s.value)], 19);
      if (q[1] === 0x0a && q[2] === 0x3a) { s.value = be16(q, 4); return pad([0xff, 0x0a, 0x3a, 0, ...u16be(s.value)], 19); }
      return null;
    },
    app(talk, v) { talk(pad([0xff, 0x0a, 0x2a, 0], 19)); talk(pad([0xff, 0x0a, 0x3a, 0, ...u16be(v)], 19)); talk(pad([0xff, 0x0a, 0x2a, 0], 19)); },
  },
  {
    name: 'bragi-like', about: 'Corsair Bragi-like: request 08 01 <prop>, the reply starts 00 01 (byte 0 is not repeated), value u32le',
    vid: 0x1b1c, pid: 0x1b9e, report: 'output', len: 64, reportId: 0,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 26000, step: 50 }, next: 1200,
    state: () => ({ value: 400 }),
    handle(s, q) {
      if (q[0] === 8 && q[1] === 2 && q[2] === 0x21) return pad([0, 2, 0, ...u16le(s.value), 0, 0], 64);
      if (q[0] === 8 && q[1] === 1 && q[2] === 0x21) { s.value = le16(q, 4); return pad([0, 1, 0], 64); }
      return null;
    },
    app(talk, v) { talk(pad([8, 2, 0x21, 0], 64)); talk(pad([8, 1, 0x21, 0, ...u16le(v), 0, 0], 64)); talk(pad([8, 2, 0x21, 0], 64)); },
  },
  {
    name: 'counter', about: 'a rolling sequence number in byte 1 of every message (the reply repeats it)',
    vid: 0x2002, pid: 0x0001, report: 'output', len: 32, reportId: 0,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 16000, step: 100 }, next: 1200,
    state: () => ({ value: 400 }),
    handle(s, q) {
      if (q[0] === 0x52) return pad([0x52, q[1], ...u16le(s.value)], 32);
      if (q[0] === 0x53) { s.value = le16(q, 2); return pad([0x53, q[1], 0], 32); }
      return null;
    },
    seq: 0,
    app(talk, v) { const n = () => (this.seq = (this.seq + 7) & 255); talk(pad([0x52, n()], 32)); talk(pad([0x53, n(), ...u16le(v)], 32)); talk(pad([0x52, n()], 32)); },
  },
  {
    name: 'save-after', about: 'the app sends the value, then a separate "save to memory" message (SteelSeries-like)',
    vid: 0x1038, pid: 0x1836, report: 'output', len: 32, reportId: 0,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 12000, step: 100 }, next: 1200,
    state: () => ({ value: 400, saved: 400 }),
    handle(s, q) {
      if (q[0] === 0x92) return pad([0x92, 0, ...u16le(s.value)], 32);
      if (q[0] === 0x03) { s.value = le16(q, 2); return pad([0x03, 0], 32); }
      if (q[0] === 0x09) { s.saved = s.value; return pad([0x09, 0], 32); }
      return null;
    },
    app(talk, v) { talk(pad([0x92], 32)); talk(pad([0x03, 1, ...u16le(v)], 32)); talk(pad([0x09], 32)); talk(pad([0x92], 32)); },
    check: (s, v) => s.saved === v || 'the new value was not saved to the device\'s memory (no save message sent)',
  },
  {
    name: 'scaled', about: 'ASUS-like: DPI sent as (dpi - 50) / 50 in one byte',
    vid: 0x0b05, pid: 0x1a99, report: 'output', len: 64, reportId: 0,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 12000, step: 50 }, next: 1200,
    state: () => ({ value: 400 }),
    handle(s, q) {
      if (q[0] === 0x12 && q[1] === 4) return pad([0x12, 4, 0, 0, (s.value - 50) / 50], 64);
      if (q[0] === 0x51 && q[1] === 0x31) { s.value = q[4] * 50 + 50; return pad([0x51, 0x31], 64); }
      return null;
    },
    app(talk, v) { talk(pad([0x12, 4], 64)); talk(pad([0x51, 0x31, 0, 0, (v - 50) / 50], 64)); talk(pad([0x12, 4], 64)); },
  },
  {
    name: 'toggle', about: 'an on/off setting (angle snapping) as 01 / 00',
    vid: 0x2003, pid: 0x0002, report: 'output', len: 32, reportId: 0,
    setting: { label: 'Angle snapping', kind: 'toggle' }, values: [true, false], next: true,
    state: () => ({ value: false }),
    handle(s, q) {
      if (q[0] === 0x20 && q[1] === 0x80) return pad([0x20, 0x80, s.value ? 1 : 0], 32);
      if (q[0] === 0x20 && q[1] === 0x01) { s.value = q[2] === 1; return pad([0x20, 0x01], 32); }
      return null;
    },
    app(talk, v) { talk(pad([0x20, 0x80], 32)); talk(pad([0x20, 0x01, v ? 1 : 0], 32)); talk(pad([0x20, 0x80], 32)); },
  },
  {
    name: 'settings-block', about: 'Sinowealth/Glorious-like: the app reads the whole settings block and writes it back with one byte changed (sum8 at the end)',
    vid: 0x258b, pid: 0x2011, report: 'feature', len: 64, reportId: 4,
    setting: { label: 'Debounce', kind: 'number', unit: ' ms' }, values: [4, 10], range: { min: 2, max: 16, step: 2 }, next: 8,
    // the block: [0x11, polling, lift-off, debounce, stages, ...] with sum8 of 0..62 at 63; the person changes the
    // polling rate in the app between recordings, so the recorded blocks carry different polling bytes too
    state: () => ({ value: 6, polling: 1, lift: 2 }),
    block(s) { const a = pad([0x11, s.polling, s.lift, s.value, 4], 64); a[63] = sum8(a, 0, 62); return a; },
    handle(s, q) {
      if (q[0] === 0x91) return this.block(s);
      if (q[0] === 0x11) { s.polling = q[1]; s.lift = q[2]; s.value = q[3]; return this.block(s); }
      return null;
    },
    app(talk, v, s) { const b = this.block(s); talk((() => { const a = pad([0x91], 64); a[63] = sum8(a, 0, 62); return a; })()); const w = [...b]; w[3] = v; w[63] = sum8(w, 0, 62); talk(w); },
    // between takes and before driving, something else changed the polling rate: a learned driver must not put it back
    between: (s) => { s.polling = s.polling === 1 ? 2 : 1; },
    check: (s) => s.polling === 3 || 'writing the setting changed the polling rate too (the whole recorded block was sent back)',
    beforeDrive: (s) => { s.polling = 3; },
  },
  {
    name: 'value-first', about: 'the value sits in byte 0 of the report (report id 7 names the command)',
    vid: 0x2004, pid: 0x0003, report: 'feature', len: 8, reportId: 7,
    setting: { label: 'Brightness', kind: 'number', unit: '%' }, values: [20, 80], range: { min: 0, max: 100, step: 1 }, next: 50,
    state: () => ({ value: 50 }),
    handle(s, q) { if (q[1] === 0xee) return pad([s.value, 0xee], 8); s.value = q[0]; return pad([s.value, 0x01], 8); },
    app(talk, v) { talk(pad([0, 0xee], 8)); talk(pad([v, 0x01], 8)); talk(pad([0, 0xee], 8)); },
  },
  {
    name: 'two-places', about: 'the value goes out in one message but twice (a left and a right channel), as Razer DPI X/Y',
    vid: 0x2005, pid: 0x0004, report: 'output', len: 32, reportId: 0,
    setting: { label: 'Sidetone', kind: 'number', unit: '%' }, values: [10, 60], range: { min: 0, max: 100, step: 1 }, next: 30,
    state: () => ({ value: 0 }),
    handle(s, q) {
      if (q[0] === 0x40 && q[1] === 0x80) return pad([0x40, 0x80, s.value, s.value], 32);
      if (q[0] === 0x40 && q[1] === 0x01) { s.value = q[2]; s.right = q[3]; return pad([0x40, 0x01], 32); }
      return null;
    },
    app(talk, v) { talk(pad([0x40, 0x80], 32)); talk(pad([0x40, 0x01, v, v], 32)); talk(pad([0x40, 0x80], 32)); },
    check: (s, v) => s.right === v || 'only one of the two places was written (the right channel kept its old value)',
  },
  // ---- messier, as real apps and devices are (23 Oct 2026, second batch) ----
  {
    name: 'lighting-stream', about: 'the app streams lighting frames (a moving colour) the whole time, as iCUE and Synapse do',
    vid: 0x2006, pid: 0x0005, report: 'output', len: 64, reportId: 0,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 26000, step: 50 }, next: 1200,
    state: () => ({ value: 400, frame: 0 }),
    handle(s, q) {
      if (q[0] === 0x30) { s.frame++; return null; }                  // a lighting frame: no answer
      if (q[0] === 5 && q[1] === 0x81) return pad([5, 0x81, 0, ...u16le(s.value)], 64);
      if (q[0] === 5 && q[1] === 0x01) { s.value = le16(q, 3); return pad([5, 1, 0], 64); }
      return null;
    },
    hue: 0,
    app(talk, v) {
      const frame = () => { this.hue = (this.hue + 37) & 255; talk(pad([0x30, 0, this.hue, 255 - this.hue, (this.hue * 3) & 255], 64)); };
      frame(); frame(); talk(pad([5, 0x81], 64)); frame(); talk(pad([5, 1, 0, ...u16le(v)], 64)); frame(); frame(); talk(pad([5, 0x81], 64)); frame();
    },
  },
  {
    name: 'chatty-device', about: 'the device sends battery reports by itself, some arriving between a request and its reply',
    vid: 0x2007, pid: 0x0006, report: 'output', len: 32, reportId: 0, chatty: true,
    setting: { label: 'Polling rate', kind: 'choice', unit: ' Hz' }, values: ['250', '1000'], next: '250',
    state: () => ({ value: 1 }),
    codes: { 250: 4, 1000: 1 },
    handle(s, q) {
      if (q[0] === 0x22 && q[1] === 0x80) return pad([0x22, 0x80, s.value], 32);
      if (q[0] === 0x22 && q[1] === 0x01) { s.value = q[2]; return pad([0x22, 0x01, q[2]], 32); }
      return null;
    },
    app(talk, v) { talk(pad([0x22, 0x80], 32)); talk(pad([0x22, 0x01, this.codes[v]], 32)); talk(pad([0x22, 0x80], 32)); },
  },
  {
    name: 'bitfield', about: 'the setting lives in the low 2 bits of a byte whose other bits are other options (kept as they are)',
    vid: 0x2008, pid: 0x0007, report: 'feature', len: 16, reportId: 3,
    setting: { label: 'Lift-off distance', kind: 'choice', unit: ' mm' }, values: ['1', '2', '3'], next: '2',
    state: () => ({ value: 1, flags: 0xa0 }),
    codes: { 1: 0, 2: 1, 3: 2 },
    handle(s, q) {
      if (q[0] === 0x41) return pad([0x41, s.flags | s.value], 16);
      if (q[0] === 0x42) { s.value = q[1] & 3; s.flags = q[1] & 0xfc; return pad([0x42, q[1]], 16); }
      return null;
    },
    app(talk, v, s) { talk(pad([0x41], 16)); talk(pad([0x42, s.flags | this.codes[v]], 16)); talk(pad([0x41], 16)); },
    check: (s) => s.flags === 0xa0 || 'the other options sharing the byte were changed',
  },
  {
    name: 'double-send', about: 'the app sends the same write twice (a common "make sure" habit)',
    vid: 0x2009, pid: 0x0008, report: 'output', len: 64, reportId: 0,
    setting: { label: 'DPI', kind: 'number', unit: ' DPI' }, values: [800, 1600], range: { min: 100, max: 26000, step: 50 }, next: 1200,
    state: () => ({ value: 400 }),
    handle(s, q) {
      if (q[0] === 7 && q[1] === 0x81) return pad([7, 0x81, ...u16le(s.value)], 64);
      if (q[0] === 7 && q[1] === 0x01) { s.value = le16(q, 2); return pad([7, 1], 64); }
      return null;
    },
    app(talk, v) { talk(pad([7, 0x81], 64)); talk(pad([7, 1, ...u16le(v)], 64)); talk(pad([7, 1, ...u16le(v)], 64)); talk(pad([7, 0x81], 64)); },
  },
  {
    name: 'checksum-first', about: 'Sonix-like (a published Sharkoon SGK3 capture): byte 0 is the sum of every byte after it; the device ignores a wrong sum',
    vid: 0x0c45, pid: 0x8513, report: 'output', len: 64, reportId: 4, ids: true,
    setting: { label: 'Brightness', kind: 'number', unit: '' }, values: [1, 3], range: { min: 0, max: 4, step: 1 }, next: 2,
    state: () => ({ value: 4, bad: 0 }),
    sum: (a) => a.slice(1).reduce((x, y) => x + y, 0) & 255,
    msg(bytes) { const a = pad([0, ...bytes], 64); a[0] = this.sum(a); return a; },
    handle(s, q) {
      if (q[0] !== this.sum(q)) { s.bad++; return null; }
      if (q[2] === 0x86 && q[4] === 0x2b) return this.msg([0, 0x86, 1, 0x2b, 0, 0, s.value]);
      if (q[2] === 0x06 && q[4] === 0x2b) { s.value = q[7]; return this.msg([0, 0x06, 1, 0x2b, 0, 0, s.value]); }
      return null;
    },
    app(talk, v) { talk(this.msg([0, 0x86, 1, 0x2b])); talk(this.msg([0, 0x06, 1, 0x2b, 0, 0, v])); talk(this.msg([0, 0x86, 1, 0x2b])); },
    check: (s) => s.bad === 0 || `${s.bad} message(s) with a wrong checksum reached the device`,
  },
  {
    name: 'colour', about: 'Keychron-like (a published K3 capture): the colour as red, green, blue in a feature report, read back from another place',
    vid: 0x3434, pid: 0x0311, report: 'feature', len: 64, reportId: 0,
    setting: { label: 'Colour', kind: 'color' }, values: ['#ff0000', '#0000ff'], next: '#20c0a0',
    state: () => ({ value: '#ffffff' }),
    handle(s, q) {
      if (q[0] === 0xf0 && q[1] === 0x81) return pad([0xf0, 0x81, 0, 0, ...rgb(s.value)], 64);
      if (q[0] === 0xf0 && q[1] === 0x01) { s.value = hexColour(q.slice(2, 5)); return pad([0xf0, 0x01], 64); }
      return null;
    },
    app(talk, v) { talk(pad([0xf0, 0x81], 64)); talk(pad([0xf0, 0x01, ...rgb(v), 0, 0, 0, 0, 0, 0x10, 0x0c, 0, 0, 0, 0xaa, 0x55], 64)); talk(pad([0xf0, 0x81], 64)); },
  },
  {
    name: 'colour-twice', about: 'Corsair Dark Core-like (a published capture): the colour sent twice in one output report, the reply carries it once',
    vid: 0x1b1c, pid: 0x1b4b, report: 'output', len: 64, reportId: 0,
    setting: { label: 'Logo colour', kind: 'color' }, values: ['#0000ff', '#ff0000', '#00ff00'], next: '#804020',
    state: () => ({ value: '#ffffff' }),
    handle(s, q) {
      if (q[0] === 0x0e && q[1] === 0xaa) return pad([0x0e, 0xaa, 0, ...rgb(s.value)], 64);
      if (q[0] === 0x07 && q[1] === 0xaa) {
        if (hexColour(q.slice(10, 13)) !== hexColour(q.slice(13, 16))) return null;
        s.value = hexColour(q.slice(10, 13)); return pad([0x07, 0xaa, 0], 64);
      }
      return null;
    },
    app(talk, v) { talk(pad([0x0e, 0xaa], 64)); talk(pad([0x07, 0xaa, 0, 0, 7, 7, 0, 0, 0x64, 0, ...rgb(v), ...rgb(v), 5], 64)); talk(pad([0x0e, 0xaa], 64)); },
  },
  {
    name: 'two-messages', about: 'Keychron-like (a published K3 capture): the app sends the value in a short message and again in a longer one that also sets other things',
    vid: 0x3434, pid: 0x0312, report: 'output', len: 32, reportId: 0,
    setting: { label: 'Brightness', kind: 'number', unit: '%' }, values: [20, 80], range: { min: 0, max: 100, step: 1 }, next: 55,
    state: () => ({ value: 50, other: 0 }),
    handle(s, q) {
      if (q[0] === 0x09 && q[1] === 0x80) return pad([0x09, 0x80, s.value], 32);
      if (q[0] === 0x09 && q[1] === 0x01) { s.value = q[2]; if (q[5]) s.other = q[5]; return pad([0x09, 0x01], 32); }
      return null;
    },
    app(talk, v) { talk(pad([0x09, 0x80], 32)); talk(pad([0x09, 0x01, v], 32)); talk(pad([0x09, 0x01, v, 0, 0, 0x33, 0x44, 0xaa, 0x55], 32)); talk(pad([0x09, 0x80], 32)); },
    beforeDrive: (s) => { s.other = 0; },
    check: (s) => s.other === 0 || 'the longer message (which also sets other things) was sent',
  },
];
// the same devices recorded as Wireshark saves them (pcapng) and on Linux (usbmon): a capture someone shares is often
// one of these (23 Oct 2026: most published captures are pcapng, one in five from Linux)
for (const [from, format] of [['plain-output', 'pcapng'], ['razer-dpi-xy', 'pcapng'], ['plain-output', 'usbmon'], ['razer-dpi-xy', 'usbmon'], ['checksum-first', 'usbmon']]) {
  const st = STYLES.find((x) => x.name === from);
  STYLES.push({ ...st, name: `${from} ${format}`, about: `${st.about}, recorded as ${format}`, format });
}

// ---------------------------------------------------------------- recording a take
const DEV = 3, OTHER = 9;
function record(st, sim, v) {
  const r = new Rec();
  r.descriptor(DEV, st.vid, st.pid);
  r.descriptor(OTHER, 0x0bda, 0x8153);
  const id = st.reportId || 0;
  let n = 0;
  const talk = (q) => {
    const reply = st.handle.call(st, sim, [...q]);
    if (st.report === 'feature') { r.setFeature(DEV, id, q); if (reply) r.getFeature(DEV, id, reply); }
    else {
      r.out(DEV, st.ids && id ? [id, ...q] : q);
      // a device that talks by itself: a battery report now and then, between a request and its reply
      if (st.chatty && n++ % 2 === 0) r.inp(DEV, pad([0x0b, 0x55 - n], st.len));
      if (reply) r.inp(DEV, st.ids && id ? [id, ...reply] : reply);
    }
    r.out(OTHER, pad([5, 1, 0, 0x20, 3], 64));   // another device on the same hub
  };
  st.app.call(st, talk, v, sim);
  return st.format ? r[st.format]() : r.pcap();
}

// ---------------------------------------------------------------- a pretend HID device for the learned driver
function fakeDevice(st, sim) {
  const listeners = new Set();
  let lastFeature = null;
  const sent = [];
  return {
    sent, vendorId: st.vid, productId: st.pid, opened: true, collections: [],
    async open() {}, async close() {},
    addEventListener(t, f) { if (t === 'inputreport') listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
    async sendReport(id, data) {
      const q = [...data]; sent.push(q);
      const reply = st.handle.call(st, sim, q);
      if (reply) setTimeout(() => { const a = new Uint8Array(st.len); a.set(reply.slice(0, st.len)); for (const f of listeners) f({ reportId: id, data: new DataView(a.buffer) }); }, 1);
    },
    async sendFeatureReport(id, data) { const q = [...data]; sent.push(q); lastFeature = st.handle.call(st, sim, q); },
    async receiveFeatureReport(id, len) {
      const body = new Uint8Array(len); body.set((lastFeature || []).slice(0, len));
      const a = id ? new Uint8Array([id, ...body]) : body;
      return new DataView(a.buffer);
    },
  };
}

// ---------------------------------------------------------------- one style, start to end
async function run(st) {
  const out = { name: st.name, stage: 'record', ok: false };
  const sim = st.state();
  const hex4 = (n) => n.toString(16).padStart(4, '0').toUpperCase();
  const takes = [];
  for (const v of st.values) {
    const pcap = record(st, sim, v);
    st.between?.(sim);
    const t = lw.takeMessages([pcap], { vid: hex4(st.vid), pid: hex4(st.pid), idsOut: !!st.ids, idsIn: !!st.ids });
    if (!t.found) return { ...out, why: 'the device was not found in its own recording' };
    takes.push({ value: v, messages: t.messages, found: t.found });
  }
  out.stage = 'analyze';
  const a = lw.analyze(takes, st.setting);
  if (!a.ok) return { ...out, why: [].concat(a.why).join(' ') };
  out.stage = 'range';
  const rg = lw.withRange(a.learned, st.range || {});
  if (!rg.setting) return { ...out, why: rg.why };
  out.stage = 'build';
  const def = lw.buildDriver({ vid: hex4(st.vid), pid: hex4(st.pid), title: `Bench ${st.name}`, kind: 'Mouse', usagePage: 'FF00', usage: '0001', settings: [rg.setting] });
  const v = validate(def);
  if (!v.ok) return { ...out, why: `validate: ${v.problems.join('; ')}`, def };
  const seen = lw.verifySeen(def, [rg.setting]);
  if (seen.length) return { ...out, why: `verifySeen: ${seen.join('; ')}`, def };
  out.stage = 'drive';
  st.beforeDrive?.(sim);
  const dev = fakeDevice(st, sim);
  setDeviceProvider(() => dev);
  try {
    const drv = fromJson(def);
    if (!(await drv.connect(false))) return { ...out, why: 'the learned driver did not connect to the pretend device', def };
    const key = rg.setting.key;
    const before = await drv.read();
    const want = st.next;
    const was = sim.value;
    const got = await drv.write(key, st.setting.kind === 'choice' ? want : want);
    const held = st.setting.kind === 'choice' ? sim.value === st.codes[want] : sim.value === want;
    if (!held) return { ...out, why: `the pretend device holds ${JSON.stringify(sim.value)} after writing ${JSON.stringify(want)} (it held ${JSON.stringify(was)}; the driver read ${JSON.stringify(before[key])} and answered ${JSON.stringify(got)})`, def };
    const extra = st.check?.(sim, want);
    if (extra !== undefined && extra !== true) return { ...out, why: extra, def };
  } catch (e) {
    return { ...out, why: `driving it: ${e.message}`, def };
  } finally { setDeviceProvider(null); }
  return { ...out, stage: 'done', ok: true, def, evidence: a.learned.evidence };
}

const results = [];
for (const st of STYLES) {
  if (ONLY && st.name !== ONLY) continue;
  const r = await run(st);
  results.push(r);
  console.log(`${r.ok ? 'LEARNED' : 'FAILED '} ${st.name.padEnd(16)} ${r.ok ? '' : `[${r.stage}] ${r.why}`}`);
  if (VERBOSE) { console.log(`        ${st.about}`); if (r.def) console.log('        ' + JSON.stringify(r.def.messages)); if (r.evidence) console.log('        ' + r.evidence.join(' ')); }
}
// ---------------------------------------------------------------- the format changes these styles needed stay safe
const safety = [];
{
  const base = () => ({ format: 1, id: 'safety-bench', title: 'Safety bench', kind: 'Mouse', vid: '2002', pids: ['0001'],
    transport: { report: 'output', len: 32, reportId: 0, counter: { at: 1, step: 1 } }, links: { usb: { label: 'USB' } },
    models: [{ key: 'm', name: 'M', pids: { usb: ['0001'] } }], replies: { echo: [0] },
    messages: { read1: { bytes: '52' }, setDpi: { bytes: '53 00 {value:u16le}' } }, reads: [{ name: 'read1', message: 'read1' }],
    fields: { dpi: { from: 'read1', offset: 2, size: 2 } }, settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 16000, step: 100, write: { message: 'setDpi' } }] });
  const ok = (def) => validate(def).ok;
  safety.push([ok(base()), 'a driver with a message number passes']);
  const filled = base(); filled.messages.setDpi.bytes = '53 07 {value:u16le}';
  safety.push([!ok(filled), 'a template that fills the message-number byte is refused']);
  const badCtr = base(); badCtr.transport.counter = { at: 40, step: 1 };
  safety.push([!ok(badCtr), 'a message number outside the report is refused']);
  const noEcho = base(); noEcho.replies.echo = [];
  safety.push([!ok(noEcho), 'output reports must match replies on at least one byte']);
  const feat = base(); feat.transport.report = 'feature'; delete feat.transport.counter; feat.replies.echo = []; feat.messages.setDpi.bytes = '53 00 {value:u16le}';
  safety.push([ok(feat), 'feature reports may match no bytes (the get answers the set)']);
  // the message number counts as any byte for DeviceHub's never lists: a template one byte away from a never-listed
  // command, with the counter where that byte would go, is refused
  const never = base(); never.never = [{ bytes: '53 07 01', why: 'test: never send this' }]; never.messages.setDpi.bytes = '53 00 01 {value:u16le}';
  safety.push([validate(never).problems.some((p) => /could send 53 07 01/.test(p)), 'the message number is treated as any value by the never lists']);
  const plainNever = base(); delete plainNever.transport.counter; plainNever.never = [{ bytes: '53 07 01', why: 'test' }]; plainNever.messages.setDpi.bytes = '53 00 01 {value:u16le}';
  safety.push([ok(plainNever), 'without a message number the same template is fine (so the check above is about the counter)']);
  // a checksum in front of what it covers: the template leaves its byte 00, anything else there is refused
  const front = () => { const d = base(); delete d.transport.counter; d.transport.checksum = { type: 'sum8', from: 1, to: 31, at: 0 }; d.replies.echo = [1];
    d.messages = { read1: { bytes: '00 52' }, setDpi: { bytes: '00 53 {value:u16le}' } }; d.fields.dpi.offset = 3; return d; };
  safety.push([ok(front()), 'a checksum in front, its byte left 00 in every template, passes']);
  const frontFilled = front(); frontFilled.messages.setDpi.bytes = '07 53 {value:u16le}';
  safety.push([!ok(frontFilled), 'a template that puts something in a front checksum byte is refused']);
  const behind = front(); behind.transport.checksum = { type: 'sum8', from: 0, to: 2, at: 3 }; behind.messages.setDpi.bytes = '00 53 00 00 {value:u16le}';
  safety.push([!ok(behind), 'a template reaching past a checksum behind its range is still refused']);
}
for (const [good, what] of safety) console.log(`${good ? 'SAFE   ' : 'UNSAFE '} ${what}`);
if (safety.some(([g]) => !g)) results.push({ ok: false });

const failed = results.filter((r) => !r.ok);
console.log(`\nlearn-bench: ${results.length - failed.length} of ${results.length} styles learned and drove their device`);
process.exit(failed.length ? 1 : 0);
