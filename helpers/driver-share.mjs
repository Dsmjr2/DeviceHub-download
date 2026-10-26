// Share learned drivers by themselves (24 Oct 2026, Shawn: "make connecting unknown devices absolutely seamless"; docs/
// handoff/driver-share.md). A driver learned on a friend's PC (Learn a device: my-devices\<name>\driver.json with
// library.json learned: true) whose settings then passed DeviceHub's own self-check on the real device goes to Shawn
// through the problem-report relay (helpers/auto-report.mjs sendNow), once per driver text. Shawn takes it into the
// library with `node helpers/accept-driver-shares.mjs --apply`, after which the next person with the same device gets it
// with nothing to learn or click.
//
// Only with the person's yes: settings.json "shareDrivers": true (asked once when a Learn finishes, and the switch in
// Settings > Get help). Never from the owner's PC. Only a driver.json (data DeviceHub checks, never code: a device.mjs is
// never sent), only when it passes declarative-driver validate(), never for a vendor DeviceHub refuses to learn, never
// with anything personal in it (helpers/share-device.mjs personalText: user and computer names, paths, serial numbers,
// addresses), and only the settings that passed are named. The driver travels deflated and base64'd inside the issue.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { validate } from './declarative-driver.mjs';
import { vendorRefusal } from './learn-wizard.mjs';
import { personalText, personalNames } from './share-device.mjs';
import { driverSha } from './my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MARK = '<!-- devicehub-driver-share v1 -->';
export const MAX_BODY = 11800;   // the relay takes 12000 (relay/worker.js LIMITS.body); the relay adds its own footer
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const hex4 = (v) => String(v ?? '').trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');

// settings.json shareDrivers: true (yes), false (no), undefined (not asked yet)
export const choice = (root = ROOT) => readJson(path.join(root, 'settings.json'), {})?.shareDrivers;

// the issue for one learned driver folder, or { refused: why }. verified: its verified.json (the self-check's record).
export function buildShare(folder, { verified = readJson(path.join(folder, 'verified.json')), names = personalNames(), devicehub = 'unknown', now = () => new Date() } = {}) {
  const mark = readJson(path.join(folder, 'library.json'), {});
  if (!mark?.learned) return { refused: 'only drivers made with Learn a device on this PC are shared' };
  if (fs.existsSync(path.join(folder, 'device.mjs'))) return { refused: 'a driver written as code is never sent' };
  let text;
  try { text = fs.readFileSync(path.join(folder, 'driver.json'), 'utf8'); } catch { return { refused: 'no driver.json' }; }
  let def;
  try { def = JSON.parse(text.replace(/^﻿/, '')); } catch { return { refused: 'driver.json is not JSON' }; }
  const v = validate(def);
  if (!v.ok) return { refused: `the driver does not pass DeviceHub's own check (${(v.problems || []).slice(0, 2).join('; ')})` };
  const vid = hex4(def.hid?.vid ?? def.vid), pids = [...new Set([].concat(def.pids || [], def.hid?.pid || [], def.pid || []).map(hex4))].filter((p) => /^[0-9a-f]{4}$/.test(p));
  if (!/^[0-9a-f]{4}$/.test(vid) || !pids.length) return { refused: 'the driver names no USB id' };
  if (vendorRefusal(vid)) return { refused: `USB vendor ${vid.toUpperCase()} is never learned or shared` };
  for (const [re, why] of personalText(names)) if (re.test(text)) return { refused: `it holds ${why}` };
  // the settings that passed their check on the real device; none failed
  const keys = verified?.keys && typeof verified.keys === 'object' ? verified.keys : {};
  const passed = Object.entries(keys).filter(([, k]) => k?.ok === true).map(([k]) => k);
  const failed = Object.entries(keys).filter(([, k]) => k?.ok === false && !k.waiting && !k.skip).map(([k]) => k);
  if (!passed.length) return { refused: 'no setting has passed its check on the device yet' };
  if (failed.length) return { refused: `a setting failed its check (${failed.slice(0, 3).join(', ')})` };
  const sha = driverSha(text);
  const record = {
    kind: 'devicehub-driver-share', format: 1, driverSha: sha, title: String(def.title || '').slice(0, 80), deviceKind: String(def.kind || 'Device').slice(0, 20),
    vid, pids, model: String(verified?.model || def.title || '').slice(0, 80) || 'unknown', firmware: typeof verified?.firmware === 'string' ? verified.firmware.slice(0, 160) : null,
    devicehub: String(verified?.devicehub || devicehub).slice(0, 60), date: String(verified?.checkedAt || now().toISOString()).slice(0, 10),
    settings: passed.slice(0, 60), checked: Math.min(60, Object.keys(keys).length),
  };
  const blob = zlib.deflateRawSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64').replace(/(.{100})/g, '$1\n');
  const labels = (def.settings || []).filter((s) => passed.includes(s.key)).map((s) => s.label || s.key);
  const body = [MARK,
    `A driver learned with Learn a device whose settings passed DeviceHub's own check on the device. Take it into the library with \`node helpers/accept-driver-shares.mjs --apply\` (Shawn's copy).`,
    '', `- Device: ${record.title || 'device'} (${record.deviceKind}), USB ${vid}:${pids.join(', ')}`, `- Settings that passed: ${labels.join(', ') || passed.join(', ')}`,
    '', '### Record', '```json', JSON.stringify(record, null, 2), '```', '', '### Driver (driver.json, deflated, base64)', '```text', blob, '```'].join('\n');
  if (body.length > MAX_BODY) return { refused: `the driver is too large to send this way (${body.length} characters)` };
  return { ok: true, sha, record, title: `Driver: ${record.title || 'device'} (${vid}:${pids[0]})`.slice(0, 120), fingerprint: `driver:${vid}${pids[0]}:${sha.slice(0, 12)}`, body };
}

// read a shared issue back (accept-driver-shares.mjs): { record, text } or { error }
export function parseShare(body) {
  const b = String(body || '');
  if (!b.includes(MARK)) return { error: 'not a driver share' };
  const rec = /### Record\s*```json\s*([\s\S]*?)```/.exec(b), drv = /### Driver[^\n]*\n```text\s*([\s\S]*?)```/.exec(b);
  if (!rec || !drv) return { error: 'its record or driver is missing' };
  let record, text;
  try { record = JSON.parse(rec[1]); } catch { return { error: 'its record is not JSON' }; }
  try { text = zlib.inflateRawSync(Buffer.from(drv[1].replace(/\s+/g, ''), 'base64'), { maxOutputLength: 256 * 1024 }).toString('utf8'); } catch { return { error: 'its driver could not be unpacked' }; }
  if (driverSha(text) !== record.driverSha) return { error: "its driver does not match the record's SHA-256" };
  return { record, text };
}

// the hook: a self-check ran on an added device (helpers/my-devices.mjs agentDeps selfChecked). Sends once per driver
// text when the person said yes; the sent SHA-256 is kept in library.json (sharedSha).
export async function afterCheck(a, r, { root = ROOT, report = () => import('./auto-report.mjs'), log = (t) => console.log(`[share] ${t}`) } = {}) {
  if (!a?.library?.learned || !a.library.folder || !r?.ran) return null;
  return shareFolder(path.join(root, 'my-devices', a.library.folder), { root, report, log });
}
export async function shareFolder(folder, { root = ROOT, report = () => import('./auto-report.mjs'), log = (t) => console.log(`[share] ${t}`), names } = {}) {
  if (choice(root) !== true) return { sent: false, why: 'not switched on' };
  const ar = await report();
  if (await ar.isOwnerPc(root)) return { sent: false, why: "the owner's own PC" };
  const mark = readJson(path.join(folder, 'library.json'), {});
  const s = buildShare(folder, { names, devicehub: mark?.devicehub || 'unknown' });
  if (!s.ok) return { sent: false, why: s.refused };
  if (mark.sharedSha === s.sha) return { sent: false, why: 'already shared', already: true };
  const res = await ar.sendNow({ fingerprint: s.fingerprint, title: s.title, body: s.body, version: mark?.devicehub || 'unknown', channel: 'driver' });
  if (res.sent || res.queued) {
    try { fs.writeFileSync(path.join(folder, 'library.json'), JSON.stringify({ ...mark, sharedSha: s.sha, sharedAt: new Date().toISOString() }, null, 2) + '\n'); } catch {}
    log(`${path.basename(folder)}: driver shared (${s.record.title})`);
  }
  return { sent: !!(res.sent || res.queued), why: res.why || null };
}
// every learned driver on this PC that can go now (the person just said yes)
export async function shareAll({ root = ROOT, ...o } = {}) {
  const dir = path.join(root, 'my-devices');
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name); } catch {}
  for (const n of names) {
    if (!readJson(path.join(dir, n, 'library.json'), {})?.learned) continue;
    out.push({ name: n, ...(await shareFolder(path.join(dir, n), { root, ...o })) });
  }
  return out;
}

// GET  /api/driver-share        { choice: true | false | null, owner }
// POST /api/driver-share {on}   the person's answer (settings.json shareDrivers); a yes shares every learned driver on
//                               this PC that can go now: { choice, shared: [{ name, sent, why }] }
export async function handle(url, req, res, { send, readBody, root = ROOT }) {
  if (url.pathname !== '/api/driver-share') return false;
  const ar = await import('./auto-report.mjs');
  const owner = await ar.isOwnerPc(root).catch(() => true);
  if (req.method === 'GET') { const c = choice(root); send(res, 200, { choice: typeof c === 'boolean' ? c : null, owner }); return true; }
  if (req.method !== 'POST') { send(res, 405, { error: 'GET or POST' }); return true; }
  const b = await readBody(req).catch(() => ({}));
  if (typeof b?.on !== 'boolean') { send(res, 400, { error: 'on must be true or false' }); return true; }
  const f = path.join(root, 'settings.json');
  const cur = readJson(f, {}) || {};
  (await import('./safe-write.js')).default.writeAtomic(f, JSON.stringify({ ...cur, shareDrivers: b.on }, null, 2));
  const shared = b.on && !owner ? await shareAll({ root }) : [];
  send(res, 200, { choice: b.on, shared });
  return true;
}
