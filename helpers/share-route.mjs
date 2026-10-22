// "Share this driver" with one click (22 Oct 2026; docs/handoff/share-route.md): the routes behind the button on an
// added device's page (public/pages/my-device.js). They use helpers/share-device.mjs as it is, so the button and the
// command line refuse exactly the same things.
//
//   POST /api/share/check   { name }        name = the my-devices folder. What would be shared, or why it is refused
//                                           (file, line, plain words, how to fix). Nothing is kept.
//   POST /api/share/prepare { name, by }    makes the library entry in share-staging/<entry>/ (gitignored, never in
//                                           my-devices/ or device-library/) and returns the package: device.json,
//                                           the driver's text and a GitHub link that opens a filled-in submission.
//   POST /api/share/open-folder { entry }   opens share-staging/<entry>/ in Explorer (for attaching the driver file)
//
// Status: "tested" only when every setting of the driver passed DeviceHub's self-check on this device
// (my-devices/<name>/verified.json, helpers/my-devices.mjs), else "read-only".
// NOTHING is sent from here: the person's browser opens the link and they press Submit on GitHub themselves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, driverFileOf, loadDriver } from './device-library.mjs';
import { readVerified } from './my-devices.mjs';
import { shareDevice, UPSTREAM } from './share-device.mjs';

// GitHub answers a new-issue link with title and body in its query string; past about 8 KB the link fails (HTTP 414
// or a cut body), so a link is kept at or under this many characters, encoded.
export const MAX_URL = 8000;
export const ISSUES = `${UPSTREAM}/issues/new`;
export const LABEL = 'device-library';

// root: the DeviceHub folder; staging: where prepared entries go; names: extra personal names for the scan (tests);
// openFolder(dir): shows a folder (Explorer); tests replace it so nothing opens
export const options = {
  root: ROOT,
  staging: null,
  names: [],
  openFolder: (dir) => spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref(),
};
const stagingDir = () => options.staging || path.join(options.root, 'share-staging');
const FOLDER = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}$/;   // a my-devices folder name, nothing path-like
const ENTRY = /^[a-z0-9][a-z0-9-]{1,60}$/;               // a library entry name

const within = (parent, child) => path.resolve(child).toLowerCase().startsWith(path.resolve(parent).toLowerCase() + path.sep);

function deviceFolder(name) {
  if (typeof name !== 'string' || !FOLDER.test(name) || name.includes('..')) return { error: 'that is not the name of a device added on this PC' };
  const dir = path.join(options.root, 'my-devices', name);
  if (!within(path.join(options.root, 'my-devices'), dir) || !driverFileOf(dir)) return { error: `there is no driver in my-devices\\${name}` };
  return { dir };
}

// "tested" only if every setting passed the self-check on this device
export function statusOf(dir, a) {
  const v = readVerified(dir);
  const keys = (a.settings || []).map((s) => s.key);
  const passed = keys.filter((k) => v.keys?.[k]?.ok === true);
  const n = keys.length;
  if (n && passed.length === n && (!v.driver || v.driver === a.id)) {
    return { status: 'tested', why: `All ${n} setting${n === 1 ? '' : 's'} passed DeviceHub's self-check on this device (each one's own value written and read back${v.checkedAt ? `, ${String(v.checkedAt).slice(0, 10)}` : ''}), so others get it ready to use.` };
  }
  const why = !v.checkedAt
    ? 'DeviceHub has no self-check record for it on this PC'
    : `${passed.length} of ${n} settings passed DeviceHub's self-check on this device`;
  return { status: 'read-only', why: `${why}, so it is shared as read-only: others get it, and each setting becomes changeable on their PC once it passes the self-check there.` };
}

// plain words for one refused item, with how to fix it
function refusal(x, name) {
  const where = `${x.file}${x.line ? `, line ${x.line}` : ''}`;
  const fix = x.file.endsWith('/') ? `move the ${x.file.slice(0, -1)} folder out of my-devices\\${name}`
    : x.line && /device\.mjs$/i.test(x.file) ? 'take that line out of device.mjs (or replace it with something that is not about you)'
    : x.line ? `move ${x.file} out of my-devices\\${name}, or take that line out of it`
    : `move ${x.file} out of my-devices\\${name}`;
  return { file: x.file, line: x.line || null, why: x.why, text: `${where}: ${x.why}`, fix: fix[0].toUpperCase() + fix.slice(1) };
}

// runs share-device into a fresh work folder; { ok, work, r, status, why } or { ok: false, ... }
async function build(name, by) {
  const f = deviceFolder(name);
  if (f.error) return { ok: false, error: f.error, refused: [] };
  let a;
  const file = driverFileOf(f.dir);
  try { a = (await loadDriver(f.dir, 'sharecheck')).a; } catch (e) {
    return { ok: false, error: `${file} does not load: ${String(e.message || e).split('\n')[0]}`, refused: [] };
  }
  const st = a && Array.isArray(a.settings) ? statusOf(f.dir, a) : { status: 'read-only', why: '' };
  fs.mkdirSync(stagingDir(), { recursive: true });
  const work = fs.mkdtempSync(path.join(stagingDir(), '.work-'));
  let r;
  try {
    r = await shareDevice(f.dir, { root: options.root, libraryDir: work, status: st.status, by: by || undefined, names: options.names,
      how: st.status === 'tested' ? 'every setting passed DeviceHub\'s self-check (own value written and read back)' : 'settings read on the device; writes not proven on it' });
  } catch (e) { r = { ok: false, error: e.message, refused: [] }; }
  if (!r.ok) {
    fs.rmSync(work, { recursive: true, force: true });
    return { ok: false, error: r.refused?.length ? 'Something in the folder is about you or this PC, so nothing was shared.' : r.error, refused: (r.refused || []).map((x) => refusal(x, name)) };
  }
  return { ok: true, work, r, a, file, ...st };
}

const summary = (b, name) => ({
  ok: true,
  name,
  entry: b.r.name,
  title: b.a.title,
  kind: b.r.meta.kind,
  usb: `${b.r.meta.vid}:${b.r.meta.pids.join('/')}`,
  works: b.r.meta.works,
  doesNotWork: b.r.meta.doesNotWork,
  status: b.status,
  statusWhy: b.why,
  shared: [`${b.file}: the driver, exactly as it runs here`, 'device.json: what the device is, what works, the status and the date'],
  stays: b.r.leftOut || [],   // other files in the folder (verified.json, notes): never shared
  checked: 'Every file in the folder was checked for backups, logs, USB captures, settings dumps, serial numbers, device instance ids, Bluetooth and network addresses, e-mail addresses, paths with a user\'s name, and this PC\'s user and computer names. None were found.',
  next: 'GitHub opens in your browser with the submission filled in. Read it, then press Submit yourself (you need a free GitHub account). DeviceHub sends nothing; nothing leaves this PC until you press Submit.',
});

export async function check(name) {
  const b = await build(name);
  if (!b.ok) return b;
  try { return summary(b, name); } finally { fs.rmSync(b.work, { recursive: true, force: true }); }
}

// the longest run of backticks in a text, so the code block's fence is always longer
const fence = (text) => '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length + 1)));
const block = (lang, text) => { const f = fence(text); return `${f}${lang}\n${text.replace(/\s+$/, '')}\n${f}`; };
export const issueUrl = (title, body) => `${ISSUES}?${new URLSearchParams({ title, labels: LABEL, body }).toString().replace(/\+/g, '%20')}`;

// the GitHub link: the driver in the body when it fits, else device.json only and the driver to attach
export function makeLink({ entry, title, meta, deviceJson, driver, attachName, driverFile = 'device.mjs' }) {
  const head = [
    'Shared from DeviceHub\'s "Share this driver" button.',
    '',
    `- Device: ${title} (${meta.kind}), USB ${meta.vid}:${meta.pids.join('/')}`,
    `- Status: ${meta.status}${meta.status === 'tested' ? ' (every setting written once and read back on the device)' : ' (read correctly on the device; writes not proven there)'}`,
    `- Works: ${(meta.works || []).join(', ') || 'not listed'}`,
    meta.doesNotWork?.length ? `- Still in the maker's app: ${meta.doesNotWork.join(', ')}` : null,
    `- Shared by: ${meta.tested?.at(-1)?.by || 'not given'}`,
    '',
    `Please add it to the library as \`device-library/${entry}/\`.`,
    '',
    '### device.json',
    block('json', deviceJson),
    '',
  ].filter((x) => x !== null);
  const ttl = `Library: ${title} (${meta.vid}:${meta.pids[0]})`;
  const full = issueUrl(ttl, [...head, `### ${driverFile}`, block(driverFile.endsWith('.json') ? 'json' : 'js', driver)].join('\n'));
  if (full.length <= MAX_URL) return { method: 'issue', url: full };
  const attach = [...head, `### ${driverFile}`, `The driver is too long to fit in a link. DeviceHub saved it as \`${attachName}\` and opened its folder: drag that file into this box to attach it, then press Submit.`].join('\n');
  let url = issueUrl(ttl, attach);
  if (url.length > MAX_URL) url = issueUrl(ttl, [head[0], '', `Please add it as \`device-library/${entry}/\`. DeviceHub saved device.json and \`${attachName}\` in one folder: drag both files into this box to attach them, then press Submit.`].join('\n'));
  return { method: 'attach', url };
}

export async function prepare(name, by) {
  by = typeof by === 'string' ? by.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  if (by && /@|[\\/]|https?:/i.test(by)) return { ok: false, error: 'The public name is shown to everyone: use a name or nickname, not an e-mail address, a link or a path.', refused: [] };
  const b = await build(name, by);
  if (!b.ok) return b;
  const entry = b.r.name;
  const to = path.join(stagingDir(), entry);
  try {
    if (!within(stagingDir(), to)) throw new Error('bad entry name');
    fs.rmSync(to, { recursive: true, force: true });   // an earlier package of the same driver, ours alone
    fs.renameSync(path.join(b.work, entry), to);
  } finally { fs.rmSync(b.work, { recursive: true, force: true }); }
  const driver = fs.readFileSync(path.join(to, b.file), 'utf8').replace(/\r\n/g, '\n');
  const deviceJson = fs.readFileSync(path.join(to, 'device.json'), 'utf8').replace(/\r\n/g, '\n');
  const attachName = `${entry}.${b.file}.txt`;   // GitHub does not take .mjs attachments; .txt it does
  fs.writeFileSync(path.join(to, attachName), driver);
  const link = makeLink({ entry, title: b.a.title, meta: b.r.meta, deviceJson, driver, attachName, driverFile: b.file });
  return {
    ...summary(b, name),
    folder: to,
    files: { 'device.json': deviceJson, [b.file]: driver },
    attach: link.method === 'attach' ? { file: path.join(to, attachName), name: attachName } : null,
    method: link.method,
    url: link.url,
    steps: link.method === 'issue'
      ? ['GitHub opens with the driver filled in.', 'Sign in if it asks, read it over, and press Submit.', 'DeviceHub\'s maker adds it to the library; the next person with this device gets it.']
      : ['GitHub opens with device.json filled in, and the folder with the driver file opens beside it.', `Drag ${attachName} into the GitHub box, then press Submit.`, 'DeviceHub\'s maker adds it to the library; the next person with this device gets it.'],
  };
}

export function openFolder(entry) {
  if (typeof entry !== 'string' || !ENTRY.test(entry)) return { ok: false, error: 'not a prepared entry' };
  const dir = path.join(stagingDir(), entry);
  if (!within(stagingDir(), dir) || !fs.existsSync(dir)) return { ok: false, error: 'that entry was not prepared: press Share again' };
  options.openFolder(dir);
  return { ok: true, folder: dir };
}

// server.js: returns true when it answered the request
export async function handle(url, req, res, send, readBody) {
  if (!url.pathname.startsWith('/api/share/')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  const act = url.pathname.slice('/api/share/'.length);
  try {
    const b = await readBody(req);
    if (act === 'check') { const r = await check(b?.name); send(res, r.ok || r.refused?.length ? 200 : 400, r); return true; }
    if (act === 'prepare') { const r = await prepare(b?.name, b?.by); send(res, r.ok || r.refused?.length ? 200 : 400, r); return true; }
    if (act === 'open-folder') { const r = openFolder(b?.entry); send(res, r.ok ? 200 : 400, r); return true; }
    send(res, 404, { error: 'no such share route' });
  } catch (e) { send(res, 400, { error: e.message }); }
  return true;
}
