// Share a working device back (22 Oct 2026; device-library/README.md): makes a device-library entry from a driver in
// my-devices, so the next person with the same device gets it.
//
//   node helpers/share-device.mjs <my-devices folder> [--status tested|read-only|untested] [--by <public name>]
//        [--vendor <name>] [--product <name>] [--name <vendor-product>] [--vid <hex>] [--pid <hex>[,<hex>]]
//        [--model <name>[,<name>]] [--works "<a>;<b>"] [--how "<how it was tested>"]
//
// It copies device.mjs (or, for a driver as data, driver.json: docs/DRIVER-FORMAT.md) and writes device.json under device-library/<vendor-product>/. It REFUSES when the folder holds
// anything personal (backups, logs, USB captures, settings dumps, serial numbers, Bluetooth addresses, e-mail
// addresses, this PC's user or computer name, paths with a user's name) and lists every file and line it refused.
// It never sends anything anywhere: it prints the steps for the person to open a pull request themselves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { problem } from './my-devices.mjs';
import { ROOT, STATUSES, devicehubVersion, hex4, validateMeta, driverFileOf, loadDriver } from './device-library.mjs';

export const UPSTREAM = 'https://github.com/Dsmjr2/DeviceHub-download';
// the only file copied into the library: the folder's driver, device.mjs or (when it has none) driver.json
const KNOWN = ['device.mjs', 'driver.json', 'device.json', 'readme.md'];   // read, not refused (device.json is re-written)
const GENERIC_NAMES = new Set(['user', 'users', 'admin', 'administrator', 'owner', 'public', 'default', 'guest', 'pc', 'desktop', 'home', 'root']);

// names of files and folders that are personal by what they are
const PERSONAL_NAME = [
  [/(^|\/)(backups?|captures?|logs?|dumps?|recordings?)(\/|$)/i, 'a backups/captures/logs folder'],
  [/\.(pcap|pcapng|etl|har)$/i, 'a USB or network capture'],
  [/\.(log|jsonl|csv|bak|old|dmp|bin|dump|sav)$/i, 'a log, history, backup or memory dump'],
  [/(backup|dump|capture|snapshot|settings|profile|serial|history|recording)[^/]*$/i, 'a backup, settings dump or capture (by its name)'],
];

// what is personal inside a text file
function personalText(user) {
  const out = [
    [/[A-Za-z]:[\\/]+Users[\\/]+(?!(Public|Default)\b)[^\\/'"`\s]+/i, 'a path with a user\'s name (C:\\Users\\<name>)'],
    [/\/(Users|home)\/[A-Za-z0-9._-]+/, 'a path with a user\'s name (/Users or /home)'],
    [/serial(\s*(number|no|#))?['"`]?\s*[:=]\s*['"`]?[A-Za-z0-9-]{4,}/i, 'a serial number'],
    [/VID_[0-9A-F]{4}&PID_[0-9A-F]{4}(&MI_[0-9A-F]{2})?[\\#]+[^\s'"`\\#]{4,}/i, 'a Windows device instance id (carries the serial number)'],
    [/\b([0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i, 'a Bluetooth or network (MAC) address'],
    [/[A-Za-z0-9._%+-]+@(?!(example\.(com|org)|localhost)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an e-mail address'],
  ];
  for (const n of user) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out.push([new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'i'), `this PC's user or computer name ("${n}")`]);
  }
  return out;
}

// the names this PC is known by (left out when too short or too generic to mean a person)
export function personalNames(extra = []) {
  let u = '';
  try { u = os.userInfo().username; } catch {}
  const names = [u, process.env.USERNAME, process.env.USER, process.env.COMPUTERNAME, os.hostname(), ...extra];
  return [...new Set(names.filter(Boolean).map(String).map((s) => s.trim()).filter((s) => s.length >= 3 && !GENERIC_NAMES.has(s.toLowerCase())))];
}

// every file in the folder; refused: [{ file, line?, why }], leftOut: files neither shipped nor refused
export function scanFolder(folder, { names = personalNames() } = {}) {
  const refused = [], leftOut = [], files = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(folder, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const hit = PERSONAL_NAME.find(([re]) => re.test(`${r}/`));
        if (hit) refused.push({ file: `${r}/`, why: hit[1] });
        walk(r);
      } else files.push(r);
    }
  };
  walk('');
  const textRules = personalText(names);
  for (const f of files) {
    const base = f.toLowerCase();
    if (!KNOWN.includes(base)) {
      const hit = PERSONAL_NAME.find(([re]) => re.test(f));
      if (hit) { if (!refused.some((x) => f.startsWith(x.file))) refused.push({ file: f, why: hit[1] }); continue; }
    }
    const buf = fs.readFileSync(path.join(folder, f));
    if (buf.length > 2 * 1024 * 1024 || buf.includes(0)) { refused.push({ file: f, why: 'a binary or very large file (could be a dump or capture)' }); continue; }
    const lines = buf.toString('utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const [re, why] of textRules) if (re.test(text)) refused.push({ file: f, line: i + 1, why });
    });
    if (!KNOWN.includes(base)) leftOut.push(f);
  }
  return { files, refused, leftOut: leftOut.filter((f) => !refused.some((x) => x.file === f)) };
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const listArg = (v, sep = ',') => (v == null ? null : String(v).split(sep).map((s) => s.trim()).filter(Boolean));

// makes the entry; returns { ok, name, dir, meta, refused, leftOut, steps } or { ok: false, error, refused }
export async function shareDevice(folder, opts = {}) {
  const root = opts.root || ROOT;
  const libraryDir = opts.libraryDir || path.join(root, 'device-library');
  if (!folder) return { ok: false, error: 'name a my-devices folder', refused: [] };
  let dir = path.resolve(folder);
  if (!fs.existsSync(dir)) dir = path.join(root, 'my-devices', folder);
  const file = driverFileOf(dir);
  if (!file) return { ok: false, error: `no device.mjs or driver.json in ${dir}`, refused: [] };
  if (path.resolve(dir).toLowerCase().startsWith(path.resolve(libraryDir).toLowerCase() + path.sep)) return { ok: false, error: 'that folder is already in the library', refused: [] };

  const scan = scanFolder(dir, { names: personalNames(opts.names || []) });
  if (scan.refused.length) return { ok: false, error: 'the folder holds something personal: nothing was shared', refused: scan.refused, leftOut: scan.leftOut };

  let a;
  try { a = (await loadDriver(dir, 'share')).a; } catch (e) { return { ok: false, error: `${file} does not load: ${String(e.message || e).split('\n')[0]}`, refused: [] }; }
  const why = problem(a);
  if (why) return { ok: false, error: `${file}: ${why}`, refused: [] };

  let old = {};
  try { old = JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8')); } catch {}
  const status = opts.status || 'untested';
  if (!STATUSES.includes(status)) return { ok: false, error: `--status must be ${STATUSES.join(', ')}`, refused: [] };
  const vid = opts.vid || a.hid?.vid || old.vid;
  const pids = listArg(opts.pid) || [...new Set([a.hid?.pid, a.hid?.cablePid, ...(old.pids || [])].filter(Boolean))];
  if (!vid || !pids.length) return { ok: false, error: 'no vendor and product id: the driver has no hid { vid, pid }; pass --vid and --pid', refused: [] };
  const vendor = opts.vendor || old.vendor || String(a.title).split(/\s+/)[0];
  const product = opts.product || old.product || (String(a.title).toLowerCase().startsWith(vendor.toLowerCase()) ? String(a.title).slice(vendor.length).trim() : a.title) || a.title;
  const name = opts.name || slug(`${vendor} ${product}`);
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) return { ok: false, error: `"${name}" is not a library name (a-z, 0-9, -)`, refused: [] };
  const to = path.join(libraryDir, name);
  if (fs.existsSync(to)) return { ok: false, error: `device-library/${name} already exists: pass --name for another, or add your test to its device.json`, refused: [] };

  const meta = {
    id: a.id,
    vendor,
    product,
    kind: a.kind,
    vid: hex4(vid),
    pids: pids.map(hex4),
    models: listArg(opts.model) || old.models || [a.title],
    works: listArg(opts.works, ';') || a.settings.map((s) => s.label),
    doesNotWork: Array.isArray(a.unsupported) ? a.unsupported : (old.doesNotWork || []),
    status,
    tested: [...(Array.isArray(old.tested) ? old.tested : []), { by: opts.by || 'not given', date: new Date().toISOString().slice(0, 10), devicehub: devicehubVersion(root), how: opts.how || (status === 'tested' ? 'each setting written once and read back' : status === 'read-only' ? 'settings read, nothing written' : 'not tested yet') }],
  };
  const bad = validateMeta(meta);
  if (bad) return { ok: false, error: `device.json: ${bad}`, refused: [] };

  fs.mkdirSync(libraryDir, { recursive: true });
  fs.mkdirSync(to);
  for (const f of [file]) fs.copyFileSync(path.join(dir, f), path.join(to, f), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(to, 'device.json'), JSON.stringify(meta, null, 2) + '\n', { flag: 'wx' });
  const steps = [
    `Look over device-library\\${name}\\${file} and device.json once more: nothing in them may be about you or this PC.`,
    `Open ${UPSTREAM} in a browser (signed in to GitHub) and press Fork.`,
    `In your fork, switch to the "app" branch, then Add file > Upload files: drag the device-library\\${name} folder in, choose "Create a new branch", and Propose changes.`,
    `Open the pull request into Dsmjr2/DeviceHub-download's "app" branch, titled "Library: ${a.title}", and say what you tested (status "${status}").`,
    'DeviceHub never sends this for you; nothing has left this PC.',
  ];
  if (status !== 'tested') steps.unshift(`Its status is "${status}": others are offered it but it does not install by itself. After writing each setting once and reading it back, share again with --status tested.`);
  return { ok: true, name, dir: to, meta, file, refused: [], leftOut: scan.leftOut, steps };
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(=(.*))?$/.exec(argv[i]);
    if (!m) { o._.push(argv[i]); continue; }
    o[m[1]] = m[3] ?? argv[++i];
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const o = parseArgs(process.argv.slice(2));
  const r = await shareDevice(o._[0], o);
  if (!r.ok) {
    console.log(`Not shared: ${r.error}`);
    for (const x of r.refused || []) console.log(`  refused ${x.file}${x.line ? `:${x.line}` : ''}: ${x.why}`);
    if (r.refused?.length) console.log('Take those out of the folder (or the lines out of device.mjs) and run this again.');
    process.exit(1);
  }
  console.log(`Library entry made: device-library\\${r.name} (${r.meta.vendor} ${r.meta.product}, ${r.meta.vid}:${r.meta.pids.join('/')}, ${r.meta.status})`);
  for (const f of r.leftOut) console.log(`  left out (not copied): ${f}`);
  console.log('To send it to everyone with this device:');
  r.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}
