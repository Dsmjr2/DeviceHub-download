// The never list in the HID send path (22 Oct 2026, safety round 2; docs/handoff/safety-round2.md).
// helpers/never-commands.json was read only when a driver.json was checked (helpers/declarative-driver.mjs validate),
// so a device.mjs driver could still send a listed command. helpers/hid-host.mjs now asks neverHit() before every
// report a library or my-devices driver's channel sends (output report, raw write, feature report) and refuses it
// before any byte goes out. DeviceHub's own channels (the Pulsar mouse, the P75 keyboard) are never checked here:
// they are not added through addSpec, and their bytes are exactly as before (tests/hid-core.mjs).
//
//   neverHit({ vid, pid, page, reportId, bytes })   the never-list entry these bytes match, or null
//     bytes: the data bytes after the report id (as the list describes them); a pattern longer than the bytes is
//     matched against zeros, because the helper pads every report to its length.
//     page: the channel's usage page (a routed report: its route's own page, hid-host sendNow); '*' or null = any
//     page: then entries limited to one page are not applied, because the byte that starts a VIA command means
//     something else on other pages, EXCEPT the VIA (FF60) ones for a vendor that makes VIA keyboards (VIA_MAKERS,
//     final audit 22 Oct 2026): on such a device a '*' channel may well be the VIA one. Only library and my-devices
//     channels are checked at all; DeviceHub's own P75 path never is.
//   refusal(hit, productName)   the plain error a refused send throws (e.never === true)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'never-commands.json');
const up4 = (x) => String(x ?? '').trim().toUpperCase().replace(/^0X/, '').padStart(4, '0');

// "D? DA 02" -> [{ hi, lo }] nibbles, null = any (the same reading as declarative-driver.mjs)
function parsePattern(text) {
  return String(text).trim().split(/\s+/).map((t) => {
    if (!/^[0-9A-F?]{2}$/i.test(t)) throw new Error(`"${t}" is not a byte pattern`);
    const n = (c) => (c === '?' ? null : parseInt(c, 16));
    return { hi: n(t[0]), lo: n(t[1]) };
  });
}
const nibbleOk = (p, b) => (p.hi == null || p.hi === b >> 4) && (p.lo == null || p.lo === (b & 15));

let rules = null;
export function neverRules() {
  if (!rules) {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    rules = (j.commands || []).filter((c) => c && c.bytes).map((c) => ({
      ...c,
      vids: c.vid === '*' ? null : [].concat(c.vid).map(up4),
      pidList: Array.isArray(c.pids) ? c.pids.map(up4) : null,
      pageOnly: c.page ? up4(c.page) : null,
      pat: parsePattern(c.bytes),
    }));
  }
  return rules;
}

// vendors whose keyboards speak VIA (usage page FF60): Keychron (3434) and Epomaker (342D, the P75's maker)
export const VIA_MAKERS = ['3434', '342D'];

export function neverHit({ vid, pid, page = null, reportId = 0, bytes = [] } = {}) {
  const v = up4(vid), p = up4(pid);
  const pg = page == null || page === '*' ? null : up4(page);
  const b = Array.from(bytes || [], (x) => Number(x) & 0xff);
  for (const r of neverRules()) {
    if (r.vids && !r.vids.includes(v)) continue;
    if (r.pidList && !r.pidList.includes(p)) continue;
    if (r.pageOnly && r.pageOnly !== pg && !(pg == null && r.pageOnly === 'FF60' && VIA_MAKERS.includes(v))) continue;
    if (r.reportId != null && Number(r.reportId) !== Number(reportId)) continue;
    for (let start = 0; start <= (r.within || 0); start++) {
      if (r.pat.every((n, i) => nibbleOk(n, b[start + i] ?? 0))) return r;
    }
  }
  return null;
}

export function refusal(hit, productName = 'device') {
  return Object.assign(new Error(`DeviceHub did not send this to the ${productName}: it is on DeviceHub's never list (${hit.what}). Nothing was sent.`), { never: true, entry: { brand: hit.brand, what: hit.what, bytes: hit.bytes } });
}
