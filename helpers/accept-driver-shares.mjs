// Take shared learned drivers into the library (24 Oct 2026; helpers/driver-share.mjs, docs/handoff/driver-share.md).
// Shawn runs it on his own copy:
//
//   node helpers/accept-driver-shares.mjs            read and check only: prints what it would add, changes nothing
//   node helpers/accept-driver-shares.mjs --apply 12,15   also writes the named valid ones as device-library/<name>/ (driver.json and
//                                                    device.json, status "untested") and prints the gh commands that close
//                                                    those issues (it runs none)
//   --from <file.json>                               read the issues from a file (gh's --json output) instead of gh
//
// It lists open issues on Dsmjr2/DeviceHub-support (label "driver", and "problem" too while the relay is not yet
// redeployed with the driver label) whose body carries the driver-share mark, read-only. For each one: the driver
// unpacks and matches the record's SHA-256, passes DeviceHub's own driver check (declarative-driver validate), is not
// for a vendor DeviceHub refuses to learn, holds nothing personal, names settings the driver writes, is not already in
// the library (same USB id or same id), and (6 Nov 2026) every message it can send is on the allow-list
// (helpers/share-allow-list.json). The library entry is then "untested": a PC with that device installs it with one
// click, its settings off until turned on. It never commits, pushes, closes or comments on anything.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MARK, parseShare } from './driver-share.mjs';
import { validate } from './declarative-driver.mjs';
import { vendorRefusal } from './learn-wizard.mjs';
import { validateMeta } from './device-library.mjs';
import { brandsByVid } from './auto-setup.mjs';
import { writable, driverSha } from './my-devices.mjs';
import { personalText, personalNames } from './share-device.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = 'Dsmjr2/DeviceHub-support';
const FIELDS = 'number,title,body,labels';
const hex4 = (v) => String(v ?? '').trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');
const slug = (s, n = 40) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '');
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };

const gh = (args) => new Promise((resolve, reject) => execFile('gh', args, { windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n')[0])) : resolve(String(out || '')))));
export async function listIssues(run = gh) {
  const seen = new Map();
  for (const label of ['driver', 'problem']) {
    const list = JSON.parse(await run(['issue', 'list', '-R', REPO, '--state', 'open', '--label', label, '--limit', '200', '--json', FIELDS]) || '[]');
    for (const i of list) if (i && Number.isInteger(i.number) && String(i.body || '').includes(MARK) && !seen.has(i.number)) seen.set(i.number, i);
  }
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

// the brand by USB vendor id (docs/brands.json through auto-setup's brandsByVid), for the entry's vendor and folder name
function brandOf(root, vid) {
  try { return brandsByVid(root)[hex4(vid)]?.name || null; } catch { return null; }
}
// (5 Nov 2026, security audit) a share comes through the public relay, which takes anonymous posts, so nothing proves it
// came from a DeviceHub install. So every message the driver sends by itself on connect (its reads, identify and probe
// messages, the session around each request) is printed for Shawn to read, a vendor with no DeviceHub never list is
// called out (nothing there refuses a byte), and --apply takes only the shares named by issue number.
const neverVids = new Map();
function neverCovers(root, vid) {
  if (!neverVids.has(root)) {
    const s = new Set();
    try { for (const c of JSON.parse(fs.readFileSync(path.join(root, 'helpers', 'never-commands.json'), 'utf8')).commands || []) for (const v of [].concat(c.vid || [])) if (v !== '*') s.add(hex4(v)); } catch {}
    neverVids.set(root, s);
  }
  return neverVids.get(root).has(hex4(vid));
}
// (6 Nov 2026, the Manager for Shawn: an allow-list, not only the never list) every message a driver can send, on its
// own report id: [{ name, reportId, bytes }]; byPid's own messages too
// (9 Nov 2026, security audit run-2) a message is reviewed together with how it goes out: every report id it can be sent
// on (a message without its own id goes out on each link's id, else the transport's) and the transport's framing (output
// or feature report, usage page, length, checksum and counter bytes the driver writes after the template). The same
// template under other framing puts other bytes on the wire, so it is a different message to review.
export function frameOf(t, hid) {
  const o = (x) => (x && typeof x === 'object' ? x : null);
  const c = o(t?.checksum) && t.checksum.type !== 'none' ? `${t.checksum.type}@${t.checksum.at}:${t.checksum.from}-${t.checksum.to}${t.checksum.k != null ? `k${t.checksum.k}` : ''}` : '-';
  const n = o(t?.counter) ? `${t.counter.at}+${t.counter.step ?? 1}` : '-';
  return [t?.report || 'output', t?.usagePage || '-', t?.len ?? '-', c, n, hid?.page || '-'].join(' ').toUpperCase();
}
export function sentMessages(def) {
  const out = [];
  const linkIds = Object.values(def?.links || {}).map((l) => l?.reportId).filter((x) => x != null);
  const add = (where, msgs, t, hid = def?.hid) => {
    const frame = frameOf(t, hid);
    for (const [name, m] of Object.entries(msgs || {})) {
      const ids = m?.reportId != null ? [m.reportId] : [...new Set([...(linkIds.length ? linkIds : []), t?.reportId ?? null])];
      for (const rid of ids) out.push({ name: `${where}${name}`, reportId: rid, bytes: String(m?.bytes ?? ''), frame });
    }
  };
  add('', def?.messages, def?.transport);
  for (const [pid, o] of Object.entries(def?.byPid || {})) add(`${pid} `, o?.messages, { ...(def?.transport || {}), ...(o?.transport || {}) });
  // (9 Nov 2026, audit run-2 wave 2) a product whose hid channel opens another collection (hid.byPid.<pid>.page) sends
  // the same messages there: each is reviewed again on that page
  for (const [pid, h] of Object.entries(def?.hid?.byPid || {})) {
    if (!h || typeof h !== 'object' || h.page == null || String(h.page).toUpperCase() === String(def?.hid?.page ?? '').toUpperCase()) continue;
    const o = def?.byPid?.[pid] || def?.byPid?.[String(pid).toUpperCase()];
    add(`${pid} `, o?.messages || def?.messages, { ...(def?.transport || {}), ...(o?.transport || {}) }, { ...def.hid, ...h });
  }
  return out;
}
const msgKey = (rid, bytes, frame) => `${rid ?? ''}|${String(bytes).trim().toUpperCase().replace(/\s+/g, ' ')}|${String(frame ?? '').toUpperCase()}`;
export const ALLOW_LIST = path.join('helpers', 'share-allow-list.json');
// the messages a shared driver for this USB vendor may send: the ones Shawn read and added to helpers/share-allow-list.json
// (with a "reviewed" date), and the ones a reviewed library driver for that vendor already sends ("tested", and not
// itself taken in from a share). Nothing an anonymous poster writes can add to it.
export function reviewedMessages(root, vid) {
  const set = new Set();
  for (const m of readJson(path.join(root, ALLOW_LIST), {})?.messages || []) if (m && hex4(m.vid) === hex4(vid) && typeof m.bytes === 'string' && typeof m.reviewed === 'string' && m.reviewed) set.add(msgKey(m.reportId ?? null, m.bytes, m.frame));
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, 'device-library'), { withFileTypes: true }).filter((e) => e.isDirectory()); } catch {}
  for (const e of entries) {
    const dir = path.join(root, 'device-library', e.name);
    const meta = readJson(path.join(dir, 'device.json'), null);
    if (!meta || meta.status !== 'tested' || meta.shared || hex4(meta.vid) !== hex4(vid)) continue;
    const d = readJson(path.join(dir, 'driver.json'), null);
    if (d) for (const m of sentMessages(d)) set.add(msgKey(m.reportId, m.bytes, m.frame));
  }
  return set;
}
export const unreviewedOf = (root, def, vid) => { const ok = reviewedMessages(root, vid); return sentMessages(def).filter((m) => !ok.has(msgKey(m.reportId, m.bytes, m.frame))); };
export function autoSent(def) {
  const msgs = def?.messages || {}, out = [];
  const add = (use, name) => { if (name) out.push({ use, name, bytes: String(msgs[name]?.bytes ?? '(missing)') }); };
  for (const r of [].concat(def?.reads || [])) if (r?.notice == null) add(`read ${r?.name || ''}`.trim(), r?.message);
  for (const [n, l] of Object.entries(def?.links || {})) {
    if (l?.identify) add(`link ${n} identify`, l.identify.message);
    for (const p of [].concat(l?.probes || [])) add(`link ${n} probe ${p?.name || ''}`.trim(), p?.message);
  }
  const ss = def?.transport?.session;
  if (ss) { add('session open', ss.open); add('session close', ss.close); }
  return out;
}

// every USB id and id the library already has
function libraryIds(root) {
  const ids = new Set(), names = new Set();
  const dir = path.join(root, 'device-library');
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch {}
  for (const e of entries) {
    const m = readJson(path.join(dir, e.name, 'device.json'), null);
    if (!m) continue;
    names.add(String(m.id || ''));
    for (const p of [].concat(m.pids || [])) ids.add(`${hex4(m.vid)}:${hex4(p)}`);
  }
  return { ids, names, folders: new Set(entries.map((e) => e.name)) };
}

// each issue checked: [{ number, ok, name?, def?, text?, meta?, why? }]. Nothing is written.
export function evaluate(issues, { root = ROOT, names = personalNames(), now = () => new Date() } = {}) {
  const lib = libraryIds(root);
  const out = [];
  const taken = new Set();
  for (const i of issues || []) {
    const n = i?.number;
    const fail = (why) => out.push({ number: n, ok: false, why });
    if (!Number.isInteger(n) || n < 1) { fail('it has no issue number'); continue; }
    const p = parseShare(i.body);
    if (p.error) { fail(p.error); continue; }
    const { record: r, text } = p;
    if (r.kind !== 'devicehub-driver-share' || r.format !== 1) { fail('its record is not a driver share'); continue; }
    let def;
    try { def = JSON.parse(text); } catch { fail('its driver is not JSON'); continue; }
    const v = validate(def);
    if (!v.ok) { fail(`its driver does not pass DeviceHub's check (${(v.problems || []).slice(0, 2).join('; ')})`); continue; }
    const vid = hex4(def.hid?.vid ?? def.vid), pids = [...new Set([].concat(def.pids || [], def.hid?.pid || []).map(hex4))];
    if (vid !== hex4(r.vid) || !pids.length || pids.some((x) => !(r.pids || []).map(hex4).includes(x))) { fail('its record and its driver name different USB ids'); continue; }
    if (vendorRefusal(vid)) { fail(`USB vendor ${vid} is never learned`); continue; }
    const sent = autoSent(def), covered = neverCovers(root, vid);
    const hit = personalText(names).find(([re]) => re.test(text) || re.test(JSON.stringify(r)));
    if (hit) { fail(`it holds ${hit[1]}`); continue; }
    const keys = (def.settings || []).filter(writable).map((s) => s.key);
    const passed = Array.isArray(r.settings) ? r.settings : [];
    if (!passed.length || passed.some((k) => !keys.includes(k))) { fail('the settings it says passed are not settings this driver writes'); continue; }
    const usb = pids.map((p) => `${vid}:${p}`);
    const dup = usb.find((u) => lib.ids.has(u) || taken.has(u));
    if (dup) { fail(`the library already has a driver for ${dup}`); continue; }
    if (lib.names.has(def.id)) { fail(`the library already has a driver with the id ${def.id}`); continue; }
    const vendor = brandOf(root, vid) || 'Unknown maker';
    let name = slug(`${vendor === 'Unknown maker' ? 'learned' : vendor}-${def.title || def.id}`) || `learned-${vid}-${pids[0]}`;
    for (let k = 2; lib.folders.has(name); k++) name = `${name.slice(0, 56)}-${k}`;
    // (6 Nov 2026) every message it can send must be on the allow-list; one that is not is refused here, so it never
    // reaches --apply, and the line to add after reading it is printed
    const unreviewed = unreviewedOf(root, def, vid);
    if (unreviewed.length) { out.push({ number: n, ok: false, why: `${unreviewed.length} of its ${sentMessages(def).length} device messages are not on the allow-list (${ALLOW_LIST.replace(/\\/g, '/')})`, unreviewed: unreviewed.map((m) => ({ vid, ...m })) }); continue; }
    const today = now().toISOString().slice(0, 10);
    const sha = driverSha(text);
    // (6 Nov 2026) what the share says passed is only a claim: anyone can post one. The entry is "untested": a PC with
    // the device installs it with one click and its settings stay off until Turn on settings, never by themselves
    const shared = { issue: n, driverSha: sha, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today, devicehub: String(r.devicehub || 'unknown').slice(0, 60),
      model: String(r.model || def.title || 'unknown').slice(0, 80), firmware: typeof r.firmware === 'string' && r.firmware.trim() ? r.firmware.slice(0, 160) : null,
      claimed: passed.slice(0, 60), note: 'the settings its sender says passed on the device; not proven, since anyone can post a share' };
    const meta = { id: def.id, vendor, product: String(def.title || `USB device ${vid}:${pids[0]}`), kind: String(def.kind || 'Device'), vid, pids,
      models: [String(r.model || def.title || 'unknown')], works: [], status: 'untested', tested: [], updated: today, shared,
      source: `shared through Learn a device (DeviceHub-support #${n})` };
    const bad = validateMeta(meta);
    if (bad) { fail(`its library entry would not be valid (${bad})`); continue; }
    usb.forEach((u) => taken.add(u));
    lib.folders.add(name);
    out.push({ number: n, ok: true, name, def, text, meta, sent, covered });
  }
  return out;
}

export function apply(results, { root = ROOT } = {}) {
  const done = [];
  for (const x of results.filter((y) => y.ok)) {
    const dir = path.join(root, 'device-library', x.name);
    if (fs.existsSync(dir)) throw new Error(`device-library/${x.name} already exists; nothing written for it`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'driver.json'), x.text);
    fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify(x.meta, null, 2) + '\n');
    done.push({ name: x.name, number: x.number });
  }
  return done;
}
export const closeCommand = (x) => `gh issue close ${x.number} -R ${REPO} --comment "Added to the device library as device-library/${x.name} (untested). After the next publish, a PC with this device can install it with one click; its settings stay off until turned on. Thank you."`;

// (6 Nov 2026) the publish gate (tests/shared-drivers.mjs, helpers/publish-release.ps1): an entry taken in from a share
// may only be "tested" once Shawn marked it reviewed (shared.reviewed, a date, by hand), and every message it sends must
// still be on the allow-list. [problem, ...]
export function libraryProblems(root = ROOT) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, 'device-library'), { withFileTypes: true }).filter((e) => e.isDirectory()); } catch {}
  for (const e of entries) {
    const dir = path.join(root, 'device-library', e.name);
    const meta = readJson(path.join(dir, 'device.json'), null);
    if (!meta || !(meta.shared || /^shared through Learn a device/.test(meta.source || ''))) continue;
    if (!meta.shared || typeof meta.shared !== 'object') { out.push(`${e.name}: taken in from a share but has no "shared" record`); continue; }
    if (meta.status === 'tested' && !(typeof meta.shared.reviewed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.shared.reviewed))) out.push(`${e.name}: a shared driver is "tested" but nobody marked it reviewed (shared.reviewed)`);
    if (fs.existsSync(path.join(dir, 'device.mjs'))) { out.push(`${e.name}: a shared driver has code (device.mjs)`); continue; }
    const def = readJson(path.join(dir, 'driver.json'), null);
    if (!def) { out.push(`${e.name}: its driver.json does not read`); continue; }
    const bad = unreviewedOf(root, def, hex4(def.hid?.vid ?? def.vid ?? meta.vid));
    if (bad.length) out.push(`${e.name}: ${bad.length} device message(s) not on the allow-list (${bad.slice(0, 3).map((m) => `${m.name}: ${m.bytes}`).join('; ')})`);
  }
  return out;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const print = deps.print || ((l) => console.log(l));
  const root = deps.root || ROOT;
  const fromAt = argv.indexOf('--from');
  let issues;
  try { issues = deps.list ? await deps.list() : fromAt >= 0 ? readJson(path.resolve(argv[fromAt + 1] || ''), []) : await listIssues(); }
  catch (e) { print(`Could not read the shared drivers: ${e.message}. Is gh installed and signed in (gh auth status)?`); return 2; }
  const results = evaluate(issues, { root, ...(deps.names ? { names: deps.names } : {}), ...(deps.now ? { now: deps.now } : {}) });
  const good = results.filter((x) => x.ok), bad = results.filter((x) => !x.ok);
  print(`${results.length} shared driver${results.length === 1 ? '' : 's'}: ${good.length} valid, ${bad.length} refused.`);
  for (const x of good) {
    print(`  #${x.number} ${x.meta.product} (${x.meta.vid}:${x.meta.pids.join(', ')}): valid, every device message is on the allow-list; it would go in as device-library/${x.name}, untested (one click to install, settings off until turned on); it says ${x.meta.shared.claimed.length} settings passed on the device (not proven: anyone can post a share)`);
    if (!x.covered) print(`      WARNING: DeviceHub has no never list for USB vendor ${x.meta.vid}, so no byte below was refused; check each one`);
    for (const m of x.sent) print(`      sends by itself (${m.use}): ${m.bytes}`);
  }
  for (const x of bad) {
    print(`  #${x.number}: refused: ${x.why}`);
    if (x.unreviewed?.length) {
      print(`      read each one; to allow it, add its line to the "messages" list in ${ALLOW_LIST.replace(/\\/g, '/')}, then run this again:`);
      const day = (deps.now ? deps.now() : new Date()).toISOString().slice(0, 10);
      for (const m of x.unreviewed) print(`      ${JSON.stringify({ vid: m.vid, reportId: m.reportId, bytes: m.bytes, frame: m.frame, what: m.name, reviewed: day })}`);
    }
  }
  const at = argv.indexOf('--apply');
  if (!good.length) { if (at >= 0) { print('Not applied: no share above is valid. Nothing was written.'); return 1; } return 0; }
  if (at < 0) { print('Nothing was written. Read the bytes above, then run again with --apply <issue numbers> for the ones to add, e.g. --apply 12,15.'); return 0; }
  // (5 Nov 2026, security audit) each share is added only when named: one --apply never takes every valid share at once
  const picked = new Set(String(argv[at + 1] || '').split(',').map((s) => Number(s.trim())).filter(Number.isInteger));
  if (!picked.size) { print('Not applied: name the shares you read, e.g. --apply 12,15. Nothing was written.'); return 1; }
  const unknown = [...picked].filter((n) => !good.some((x) => x.number === n));
  if (unknown.length) { print(`Not applied: #${unknown.join(', #')} ${unknown.length === 1 ? 'is' : 'are'} not a valid share above. Nothing was written.`); return 1; }
  const chosen = results.filter((x) => x.ok && picked.has(x.number));
  let done;
  try { done = apply(chosen, { root }); } catch (e) { print(`Not applied: ${e.message}`); return 1; }
  for (const d of done) print(`  wrote device-library/${d.name}/ (issue #${d.number})`);
  print('Nothing was committed or pushed. Look over git diff, commit, then Publish (the library bundle goes with it). To close the issues:');
  for (const x of chosen) print(`  ${closeCommand(x)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
