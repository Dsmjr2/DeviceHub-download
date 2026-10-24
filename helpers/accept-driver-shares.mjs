// Take shared learned drivers into the library (24 Oct 2026; helpers/driver-share.mjs, docs/handoff/driver-share.md).
// Shawn runs it on his own copy:
//
//   node helpers/accept-driver-shares.mjs            read and check only: prints what it would add, changes nothing
//   node helpers/accept-driver-shares.mjs --apply    also writes each valid one as device-library/<name>/ (driver.json and
//                                                    device.json, status "tested") and prints the gh commands that close
//                                                    those issues (it runs none)
//   --from <file.json>                               read the issues from a file (gh's --json output) instead of gh
//
// It lists open issues on Dsmjr2/DeviceHub-support (label "driver", and "problem" too while the relay is not yet
// redeployed with the driver label) whose body carries the driver-share mark, read-only. For each one: the driver
// unpacks and matches the record's SHA-256, passes DeviceHub's own driver check (declarative-driver validate), is not
// for a vendor DeviceHub refuses to learn, holds nothing personal, names settings the driver writes, is not already in
// the library (same USB id or same id), and its record is one my-devices realRecord counts as a real-device record for
// exactly that driver text. The library entry is then "tested": the next PC with that device gets it by itself, with
// nothing to learn and no Turn on settings. It never commits, pushes, closes or comments on anything.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MARK, parseShare } from './driver-share.mjs';
import { validate } from './declarative-driver.mjs';
import { vendorRefusal } from './learn-wizard.mjs';
import { validateMeta } from './device-library.mjs';
import { brandsByVid } from './auto-setup.mjs';
import { realRecord, writable, driverSha } from './my-devices.mjs';
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
    const today = now().toISOString().slice(0, 10);
    const sha = driverSha(text);
    const tested = { status: 'tested', real: true, by: 'works report', how: "learned on a friend's PC with Learn a device; its settings passed DeviceHub's self-check on the device, then shared by its owner",
      date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today, devicehub: String(r.devicehub || 'unknown').slice(0, 60), driver: name, driverSha: sha,
      model: String(r.model || def.title || 'unknown').slice(0, 80), firmware: typeof r.firmware === 'string' && r.firmware.trim() ? r.firmware.slice(0, 160) : null,
      settings: passed.slice(0, 60), checked: Math.max(passed.length, Math.min(60, Number(r.checked) || passed.length)), issue: n };
    if (!realRecord(tested, 'tested', sha)) { fail('it would not count as a real-device record (realRecord refused it)'); continue; }
    const labels = (def.settings || []).filter((s) => passed.includes(s.key)).map((s) => `${s.label || s.key} (checked on the device)`);
    const meta = { id: def.id, vendor, product: String(def.title || `USB device ${vid}:${pids[0]}`), kind: String(def.kind || 'Device'), vid, pids,
      models: [String(r.model || def.title || 'unknown')], works: labels, status: 'tested', tested: [tested], updated: today,
      source: `shared from a friend's PC through Learn a device (DeviceHub-support #${n})` };
    const bad = validateMeta(meta);
    if (bad) { fail(`its library entry would not be valid (${bad})`); continue; }
    usb.forEach((u) => taken.add(u));
    lib.folders.add(name);
    out.push({ number: n, ok: true, name, def, text, meta });
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
export const closeCommand = (x) => `gh issue close ${x.number} -R ${REPO} --comment "Added to the device library as device-library/${x.name} (tested). Everyone with this device gets it after the next publish. Thank you."`;

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
  for (const x of good) print(`  #${x.number} ${x.meta.product} (${x.meta.vid}:${x.meta.pids.join(', ')}): valid, as device-library/${x.name}; ${x.meta.tested[0].settings.length} settings passed on the device`);
  for (const x of bad) print(`  #${x.number}: refused: ${x.why}`);
  if (!good.length) return 0;
  if (!argv.includes('--apply')) { print('Nothing was written. Run again with --apply to add the valid ones.'); return 0; }
  let done;
  try { done = apply(results, { root }); } catch (e) { print(`Not applied: ${e.message}`); return 1; }
  for (const d of done) print(`  wrote device-library/${d.name}/ (issue #${d.number})`);
  print('Nothing was committed or pushed. Look over git diff, commit, then Publish (the library bundle goes with it). To close the issues:');
  for (const x of good) print(`  ${closeCommand(x)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
