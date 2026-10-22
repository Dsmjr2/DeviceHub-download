// The never list on the library drivers' Corsair Bragi channels (final audit, 22 Oct 2026; docs/handoff/final-safety.md).
// device-library/corsair-bragi-headset and corsair-bragi-peripherals talk to the native helper directly
// (helpers/native.js request) on `hs80:<pid>:<ep>:bragi[:frame=peripheral]`, so hid-host's never check
// (helpers/never-guard.mjs) never sees their bytes. native.js asks refusal(chan, cmd) first for every channel with the
// "bragi" tag and answers "ERR <why>" without sending anything when it is not null. DeviceHub's own HS80 channels
// (hs80-direct.js `hs80:<pid>:<ep>:<kind><n>`, receiver-light.js `hs80:0A6B:8:rx`) have no such tag and are never checked.
//
// What a library driver may send there: OPEN, CLOSE, FRAME, and one GET or SET at a time. Each GET / SET is turned into
// the bytes the helper would send after the report id (hs80io.cs GetFrame / SetFrame: [ep] [cmd 02 get / 01 set] [id lo]
// [id hi or 00] [value LE x4]) and matched against NEVER below, from the Corsair entries of helpers/never-commands.json
// (docs/brands/corsair.md section 3 "Sleep now", section 4 "Never"; ckb-next, OpenLinkHub). The helper's own SET lists
// (hs80io.cs Hs80Allows / PeripheralAllows) still decide what a SET may be; this only adds the never list in front.
'use strict';

const NEVER = [
  { bytes: '?? 02 05', what: 'reading the pairing id (resource 05)' },
  { bytes: '?? 02 06', what: 'reading the encryption key (resource 06)' },
  { bytes: '?? 01 05', what: 'writing the pairing id (resource 05)' },
  { bytes: '?? 01 06', what: 'writing the encryption key (resource 06)' },
  { bytes: '?? 02 14', what: 'the bootloader firmware path (14)' },
  { bytes: '?? 02 15', what: 'the radio firmware path (15)' },
  { bytes: '?? 02 16', what: 'the radio bootloader path (16)' },
  { bytes: '?? 01 14', what: 'the bootloader firmware path (14)' },
  { bytes: '?? 01 15', what: 'the radio firmware path (15)' },
  { bytes: '?? 01 16', what: 'the radio bootloader path (16)' },
  { bytes: '?? 01 03 00 04', what: 'sleep now (property 03 = 4)' },
];
const VERBS = ['OPEN', 'CLOSE', 'FRAME'];

const pat = (text) => text.split(' ').map((t) => (t === '??' ? null : parseInt(t, 16)));
const RULES = NEVER.map((n) => ({ ...n, pat: pat(n.bytes) }));

// is this a library driver's Bragi channel? (a "bragi" part after hs80:<pid>:<ep>)
const isBragi = (chan) => { const p = String(chan).split(':'); return p[0] === 'hs80' && p.slice(3).includes('bragi'); };

// the bytes after the report id for one GET / SET, as hs80io.cs builds them; null when the command is not well formed
function frameOf(ep, cmd) {
  const w = String(cmd).trim().split(/\s+/);
  const id = /^[0-9a-f]{1,4}$/i.test(w[1] || '') ? parseInt(w[1], 16) : NaN;
  if (!Number.isInteger(id)) return null;
  if (w[0] === 'GET' && w.length === 2) return [ep, 0x02, id & 0xff, id >> 8];
  if (w[0] === 'SET' && w.length === 3 && /^-?\d+$/.test(w[2])) {
    const v = Number(w[2]) | 0;
    return [ep, 0x01, id & 0xff, 0, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  }
  return null;
}

// null = may be sent; else why not (plain words)
function refusal(chan, cmd) {
  if (!isBragi(chan)) return null;
  const verb = String(cmd).trim().split(/\s+/)[0];
  if (VERBS.includes(verb) && String(cmd).trim() === verb) return null;
  const ep = Number(String(chan).split(':')[2]) & 0xff;
  const b = frameOf(ep, cmd);
  if (!b) return `a library driver sends only OPEN, CLOSE, FRAME and one GET or SET on a Corsair channel ("${String(cmd).slice(0, 40)}" was not sent)`;
  const hit = RULES.find((r) => r.pat.every((x, i) => x == null || x === (b[i] ?? 0)));
  return hit ? `it is on DeviceHub's never list (${hit.what}); nothing was sent` : null;
}

module.exports = { refusal, isBragi, frameOf, NEVER };
