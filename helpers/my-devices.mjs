// Devices added on a PC (21 Oct 2026): each one in its own folder, my-devices\<name>\device.mjs, loaded at start by the
// agent. They are the PC owner's (or their Claude's) files: an update never touches them, so a device added for
// someone keeps working when DeviceHub updates. Folders starting with "_" or "." are skipped; my-devices\_example is
// the worked example (DEVICEHUB_EXAMPLE_DEVICE=1 loads it, for tests). ADD-YOUR-DEVICES.md and CLAUDE.md say how to
// write one.
//
// device.mjs exports one adapter, the same shape as the built-in ones (public/devices/*-adapter.js) plus two things:
//   id, title, kind                  'logi-mouse', 'Logitech G Pro X', 'Mouse' (id: a-z, 0-9, -; not mouse/headset/keyboard)
//   connect(), info(), read(), write(key, value)   read-back confirmed; battery(), rawBackup(), unsupported optional
//   settings: [{ key, label, type: 'slider' | 'toggle' | 'choice', min, max, step, unit, options: [{ value, label }],
//               live, hint }]       what its page shows (DeviceHub draws the page; no page code is needed)
//   hid: { vid, pid, page, usage, len, reportId, replyMs, cablePid }   optional: the HID channel DeviceHub opens for
//        it, so connect() can use getDevice() from public/devices/hid.js like the built-in drivers
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BUILT_IN = ['mouse', 'headset', 'keyboard'];
const TYPES = ['slider', 'toggle', 'choice'];

// what is wrong with one, or null
export function problem(a) {
  if (!a || typeof a !== 'object') return 'device.mjs exports no device';
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(a.id || '')) return 'its id must be 2-31 characters: a-z, 0-9 and -';
  if (BUILT_IN.includes(a.id)) return `the id "${a.id}" is a built-in device's`;
  for (const k of ['title', 'kind']) if (typeof a[k] !== 'string' || !a[k].trim()) return `it needs a ${k}`;
  for (const f of ['connect', 'info', 'read', 'write']) if (typeof a[f] !== 'function') return `it needs ${f}()`;
  if (!Array.isArray(a.settings)) return 'it needs settings: [] (what its page shows)';
  for (const s of a.settings) {
    if (!s || typeof s.key !== 'string' || typeof s.label !== 'string' || !TYPES.includes(s.type)) return `setting ${JSON.stringify(s?.key)}: needs key, label and type (${TYPES.join(', ')})`;
    if (s.type === 'slider' && !(Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min)) return `setting ${s.key}: a slider needs min and max`;
    if (s.type === 'choice' && !(Array.isArray(s.options) && s.options.length)) return `setting ${s.key}: a choice needs options`;
  }
  if (a.hid && !(/^[0-9A-F]{4}$/i.test(a.hid.vid || '') && /^[0-9A-F]{4}$/i.test(a.hid.pid || ''))) return 'hid needs vid and pid (4 hex digits each)';
  return null;
}

// loads every device folder; returns [{ name, id?, error? }] for the log
export async function load(root, { register, addSpec, taken }) {
  const dir = path.join(root, 'my-devices');
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return out; }
  for (const name of names.sort()) {
    if (/^[_.]/.test(name) && !(name === '_example' && process.env.DEVICEHUB_EXAMPLE_DEVICE === '1')) continue;
    const file = path.join(dir, name, 'device.mjs');
    if (!fs.existsSync(file)) { out.push({ name, error: 'no device.mjs in it' }); continue; }
    try {
      const a = (await import(pathToFileURL(file).href)).default;
      const why = problem(a) || (taken(a.id) ? `the id "${a.id}" is already used` : null);
      if (why) { out.push({ name, error: why }); continue; }
      a.plugin = name;
      if (a.hid) addSpec({ id: a.id, ...a.hid });
      register(a);
      out.push({ name, id: a.id });
    } catch (e) { out.push({ name, error: String(e.message || e).split('\n')[0] }); }
  }
  return out;
}
