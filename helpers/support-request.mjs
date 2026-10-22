// Request support in one click, no GitHub account (22 Oct 2026; docs/handoff/support-request.md). For a device
// DeviceHub has no driver for, the Request support button sends Shawn a short request through the same relay and the
// same checks as the automatic problem reports (helpers/auto-report.mjs sendNow: relay set up, reports on, never from
// the owner's PC, once per device per install per day). Where this copy does not send (reports off, no relay, the
// owner's PC, not started), the button does what it did before: the GitHub request, shown first (helpers/get-help.mjs
// requestSupport).
//
//   POST /api/help/request/send { vid, pid, name }   (routed by get-help.mjs handle; no server.js change)
//     -> { sent: true, line } | { sent: false, queued: true, line } | { sent: false, fallback: true, why }
//
// What it says: the device's USB id and Windows' name for it, its maker from the brand guide (or the generic 2.4G
// receiver line), each HID interface with its usage page and report lengths from Windows' own HID list
// (helpers/learn-hid-list.ps1 via learn-wizard's listHid: every collection opened with access 0, nothing sent to any
// device), the maker's app when its folder is on this PC (helpers/vendor-files.mjs APPS, a folder check only), and
// DeviceHub's and Windows' versions. Every part goes through get-help's strip(), then auto-report's finalCheck() with
// get-help's findPersonal(): a flagged line is dropped; a flagged title, or a body still flagged, sends nothing and
// falls back to the GitHub request (which shows what is personal).
import fs from 'node:fs';
import path from 'node:path';
import * as ar from './auto-report.mjs';
import { strip, findPersonal, windowsVersion } from './get-help.mjs';
import { personalNames } from './share-device.mjs';
import { devicehubVersion } from './device-library.mjs';
import { genericDongle } from '../public/core/generic-dongle.js';

export const SENT_LINE = 'Sent to Shawn. When a driver is added, DeviceHub picks it up by itself.';
export const QUEUED_LINE = 'Shawn could not be reached just now. DeviceHub tries again in a few minutes by itself.';

// tests replace these
export const options = {
  listHid: async () => (await import('./learn-wizard.mjs')).deps.listHid(),
  windows: () => windowsVersion(),
  env: process.env,
  names: [],
};

const hex4 = (x) => (/^[0-9a-f]{4}$/i.test(String(x || '')) ? String(x).toUpperCase() : null);
export const fingerprint = (vid, pid) => `support:${vid}:${pid}`.toLowerCase();

// the HID collections of this vid:pid from learn-hid-list's JSON, one plain line each
const USAGE = { '0001:0002': 'mouse', '0001:0006': 'keyboard', '0001:0004': 'joystick', '0001:0005': 'game pad', '0001:0080': 'system controls', '000C:0001': 'media keys' };
export function interfaces(json, vid, pid) {
  const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
  const mine = arr(json?.collections).filter((c) => hex4(c?.vid) === vid && hex4(c?.pid) === pid);
  const lines = mine.map((c) => {
    const page = hex4(c.page) || '????', usage = hex4(c.usage) || '????';
    const what = USAGE[`${page}:${usage}`] || (parseInt(page, 16) >= 0xff00 ? "the maker's own messages" : null);
    const ids = (k) => arr(c[k]).filter((x) => x).join(', ');
    const rid = [['in', 'inIds'], ['out', 'outIds'], ['feature', 'featIds']].map(([n, k]) => (ids(k) ? `${n} ${ids(k)}` : null)).filter(Boolean).join('; ');
    return `  - interface ${c.iface ?? '?'}${c.col != null ? `, collection ${c.col}` : ''}: usage page ${page}, usage ${usage}${what ? ` (${what})` : ''}; report lengths in ${c.inLen || 0}, out ${c.outLen || 0}, feature ${c.featLen || 0}${rid ? `; report ids ${rid}` : ''}`;
  });
  const product = mine.map((c) => c.product).find(Boolean) || null;
  return { lines: lines.slice(0, 12), more: Math.max(0, lines.length - 12), product };
}

// the maker's app for this vendor id when its install folder is on this PC (a folder check; nothing is read or run)
export async function makerApps(vid, env = options.env) {
  const vf = await import('./vendor-files.mjs');
  const b = vf.bases(env);
  return vf.APPS.filter((a) => !a.web && a.vids.includes(vid) && (a.install || []).some((r) => {
    const base = b[r.base];
    if (!base || r.match) return false;
    try { return fs.statSync(path.join(base, r.path)).isDirectory(); } catch { return false; }
  })).map((a) => a.name);
}

// { title, body } before the personal-data checks
export function compose({ vid, pid, name, brand, dongle, hid, apps, version, windows }) {
  const id = `${vid}:${pid}`;
  const title = `Support request: ${name || (brand ? `${brand.name} device` : 'USB device')} (${id})`.replace(/\s+/g, ' ').slice(0, 120);
  const L = ['**Please add a driver for this device.** The person pressed Request support in DeviceHub.', '',
    '### The device', `- Name: ${name || 'Windows gives it no name'}`, `- USB: ${id}`];
  if (dongle) L.push(`- Maker: ${dongle.line}`);
  else L.push(`- Maker: ${brand ? `${brand.name}${brand.kinds?.length ? ` (${brand.kinds.join(', ')})` : ''}${brand.shared ? ", but this vendor id is a chip maker's, so unconfirmed" : ''}` : "not in DeviceHub's brand guide"}`);
  L.push('- DeviceHub has: no driver for it yet');
  if (hid === null) L.push("- HID interfaces: Windows' HID list could not be read");
  else if (!hid.lines.length) L.push('- HID interfaces: none found for this id (it may not be plugged in now)');
  else L.push('- HID interfaces (Windows\' HID list, read-only):', ...hid.lines, ...(hid.more ? [`  - and ${hid.more} more`] : []));
  L.push(`- Maker's app on this PC: ${apps?.length ? apps.join(', ') : 'none found'}`, '');
  L.push('### This PC', `- DeviceHub: ${version}`, `- Windows: ${windows}`, '');
  L.push('Sent by DeviceHub when the person pressed Request support. Anything personal was taken out first.');
  return { title, body: L.join('\n') };
}

// the whole request, stripped and checked: { ok, title, body, version } or { ok: false, why }
export async function build(q) {
  const vid = hex4(q?.vid), pid = hex4(q?.pid);
  if (!vid || !pid) return { ok: false, bad: true, why: 'vid and pid must be 4 hex digits' };
  const root = ar.options.root;
  const names = personalNames([...(ar.options.names || []), ...(options.names || [])]);
  const s = (x) => strip(String(x ?? '').replace(/[\u0000-\u001f]/g, ' '), names).text;
  let json = null;
  try { json = await Promise.race([options.listHid(), new Promise((r) => setTimeout(() => r(undefined), 45000).unref?.())]); } catch { json = null; }
  const hid = json ? interfaces(json, vid, pid) : null;
  if (hid) hid.lines = hid.lines.map(s);
  const name = s(String(q.name || '').trim().slice(0, 80) || hid?.product || '').trim();
  let brand = null;
  try { brand = (await import('./auto-setup.mjs')).brandsByVid(root)[vid.toLowerCase()] || null; } catch {}
  const dongle = genericDongle({ vid, pid, name });
  let apps = [];
  try { apps = await makerApps(vid); } catch {}
  let windows = 'unknown';
  try { windows = s(await options.windows()); } catch {}
  const version = s(devicehubVersion(root));
  const f = compose({ vid, pid, name, brand, dongle, hid, apps: apps.map(s), version, windows });
  const fin = ar.finalCheck(findPersonal, f.title, f.body, names);
  if (!fin.ok) return { ok: false, why: fin.why };
  return { ok: true, title: f.title, body: fin.body, version, fingerprint: fingerprint(vid, pid) };
}

// one click: { sent, queued, fallback, line, why }
export async function send(q) {
  const st = await ar.status();
  if (!st.active) return { sent: false, fallback: true, why: !st.configured ? 'no relay set up' : st.owner ? "the owner's own PC" : 'problem reports are off' };
  const vid = hex4(q?.vid), pid = hex4(q?.pid);
  if (vid && pid && ar.sentToday(fingerprint(vid, pid))) return { sent: true, already: true, line: SENT_LINE };
  const b = await build(q);
  if (!b.ok) return { sent: false, fallback: true, bad: b.bad, why: b.why };
  const r = await ar.sendNow({ fingerprint: b.fingerprint, title: b.title, body: b.body, version: b.version });
  if (r.sent) return { sent: true, already: !!r.already, line: SENT_LINE };
  if (r.queued) return { sent: false, queued: true, line: QUEUED_LINE };
  return { sent: false, fallback: true, why: r.why };
}
