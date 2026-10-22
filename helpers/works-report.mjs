// "Works on my device" (22 Oct 2026; docs/handoff/works-reports.md). Once a library driver's settings have passed
// DeviceHub's self-check on this PC (Turn on settings pressed, checks passed), its page offers one button. It builds a
// small record of what passed, with nothing personal in it, shows it in full on the page, and only on the person's click
// opens a filled-in GitHub issue (label "works") through the same open path Get help uses (helpers/get-help.mjs
// /api/help/open). DeviceHub sends nothing itself: the person presses Submit on GitHub. Shawn's
// helpers/accept-works-reports.mjs reads those issues and adds each valid record to the driver's device.json `tested`,
// which promotes the driver to tested (helpers/my-devices.mjs realRecord accepts exactly that shape).
//
//   GET /api/help/works?id=<device>  -> { ok, record, title, body, url, token } or { ok: false, why, refused? }
//   POST /api/help/open { token }    opens it (get-help.mjs open: its own link check and personal-data check again)
//
// The record (what goes on GitHub, in a ```json block under "### Record"):
//   { kind, format, driver: <library entry name>, driverSha: <SHA-256 of the driver text, CRLF made LF>, date: <the day
//     the check passed, YYYY-MM-DD>, devicehub: <version>, model, firmware: <text or null>, settings: [<keys that
//     passed>], checked: <how many settings were checked> }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { personalNames, personalText } from './share-device.mjs';
import { findPersonal, rememberLink, ISSUES } from './get-help.mjs';
import { MAX_URL } from './share-route.mjs';
import { libraryMark, readVerified, driverShaOf, needsTurnOn, provenCopy, writable, worksRecordProblem } from './my-devices.mjs';
import { list, devicehubVersion } from './device-library.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEVICEHUB_PORT) || 5577;
export const LABEL = 'works';
export const REPO = 'Dsmjr2/DeviceHub-download';
export const KIND = 'devicehub-works-report';
export const FORMAT = 1;
export const TITLE_START = 'Works on my device:';
export const ISSUE_FIELDS = ['kind', 'format', 'driver', 'driverSha', 'date', 'devicehub', 'model', 'firmware', 'settings', 'checked'];
export const HOW = "Works on my device: each listed setting passed DeviceHub's self-check on a real device (its own value written once and read back)";
// root: the DeviceHub folder; names: extra personal names (tests)
export const options = { root: ROOT, names: [] };

const no = (why) => ({ ok: false, why });
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// the record for one device's snapshot (/api/agent/state's entry): { ok, record, labels } or { ok: false, why }
export function buildRecord(snap, { root = options.root } = {}) {
  const a = snap?.adapter;
  if (!a?.plugin) return no('This device has no driver from the device library.');
  const folder = path.join(root, 'my-devices', a.plugin);
  const mark = libraryMark(folder);
  if (!mark) return no('This driver was added on this PC by hand, not from the device library. Use Share this driver instead.');
  if (mark.learned) return no('This driver was made on this PC with Learn a device. Use Share this driver instead.');
  if (mark.learnedKeys?.length) return no("Learn a device added settings to this copy, so it is not the library's driver any more.");
  const entry = list({ root }).find((e) => e.name === mark.name && !e.error);
  if (!entry) return no(`Its library entry (${mark.name || 'unknown'}) is not in this copy of DeviceHub.`);
  const sha = driverShaOf(folder);
  if (!sha || sha !== driverShaOf(entry.dir)) return no("This copy is not the same as the library's driver (it was changed on this PC, or the library has a newer one), so it cannot be reported.");
  const settings = (a.settings || []).filter(writable);
  if (!settings.length) return no('It has no settings to check.');
  const proven = provenCopy(folder, mark);
  if (a.library?.turnOn || settings.some((s) => needsTurnOn(mark, proven, s.key))) return no('Press Turn on settings first. This button comes after its settings pass their check.');
  const v = readVerified(folder);
  if (!v.checkedAt) return no('Its settings have not been checked on this PC yet.');
  if (v.driver && v.driver !== a.id) return no('Its check on this PC was for another driver.');
  const passed = settings.filter((s) => v.keys?.[s.key]?.ok === true);
  if (!passed.length) return no('No setting has passed its check on this PC yet.');
  const model = clip(snap.info?.Model, 80) || clip(a.title, 80) || mark.name;
  const record = {
    kind: KIND, format: FORMAT, driver: mark.name, driverSha: sha, date: String(v.checkedAt).slice(0, 10),
    devicehub: clip(v.devicehub || devicehubVersion(root), 60), model, firmware: v.firmware ? clip(v.firmware, 160) : null,
    settings: passed.map((s) => s.key), checked: settings.length,
  };
  // the same shape the accept script checks; refused here too, so nothing malformed is ever offered
  const bad = issueRecordProblem(record);
  if (bad) return no(`The record could not be made (${bad}).`);
  return { ok: true, record, labels: passed.map((s) => clip(s.label || s.key, 60)) };
}

// what is wrong with a record from an issue, or null. Exactly ISSUE_FIELDS, then the tested record it becomes must pass
// my-devices.mjs worksRecordProblem.
export function issueRecordProblem(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'it is not an object';
  const extra = Object.keys(r).filter((k) => !ISSUE_FIELDS.includes(k));
  if (extra.length) return `it has fields a works report never has (${extra.join(', ')})`;
  const missing = ISSUE_FIELDS.filter((k) => !(k in r));
  if (missing.length) return `it is missing ${missing.join(', ')}`;
  if (r.kind !== KIND || r.format !== FORMAT) return 'it is not a DeviceHub works report';
  return worksRecordProblem(toTested(r, 1));
}

// the device.json `tested` record a valid issue record becomes (helpers/accept-works-reports.mjs)
export function toTested(r, issue) {
  return { status: 'tested', real: true, by: 'works report', how: HOW, date: r.date, devicehub: r.devicehub, driver: r.driver, driverSha: r.driverSha, model: r.model, firmware: r.firmware, settings: r.settings, checked: r.checked, issue };
}

// ---------- the issue ----------
const fence = (text) => '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length + 1)));
export const issueUrl = (title, body) => `${ISSUES}?${new URLSearchParams({ title, labels: LABEL, body }).toString().replace(/\+/g, '%20')}`;
export function makeIssue(record, labels = []) {
  const json = JSON.stringify(record, null, 2), fn = fence(json);
  const title = `${TITLE_START} ${record.model} (${record.driver})`;
  const body = [
    `DeviceHub's library driver **${record.driver}** works on my device.`,
    '',
    `These settings passed DeviceHub's self-check (each one's own value written once and read back): ${labels.length ? labels.join(', ') : record.settings.join(', ')}. ${record.settings.length} of ${record.checked} checked.`,
    '',
    '### Record',
    `${fn}json`, json, fn,
    '',
    "Made with DeviceHub's Works on my device button. DeviceHub sent nothing; the person who opened this pressed Submit.",
  ].join('\n');
  return { title, body, url: issueUrl(title, body) };
}

// the record out of an issue's body (the first ```json block under "### Record"), or throws
export function parseRecord(body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n');
  const at = text.indexOf('### Record');
  if (at < 0) throw new Error('it has no "### Record" part');
  const m = /(`{3,})json\n([\s\S]*?)\n\1/.exec(text.slice(at));
  if (!m) throw new Error('its record is not in a ```json block');
  try { return JSON.parse(m[2]); } catch (e) { throw new Error(`its record is not JSON (${e.message})`); }
}

// anything personal: Share's own check (share-device.mjs personalText) plus Get help's IP addresses over the whole text.
// The firmware is checked with Share's rules only: a firmware version like 1.0.2.15 is not an IP address.
export function personalIn(record, text, names = []) {
  const fw = typeof record?.firmware === 'string' ? record.firmware : '';
  const rest = fw ? String(text).split(JSON.stringify(fw).slice(1, -1)).join('<firmware>').split(fw).join('<firmware>') : String(text);
  const out = findPersonal(rest, names);
  if (fw) for (const [re, why] of personalText(names)) if (re.test(fw)) out.push({ line: 0, why: `the firmware: ${why}` });
  return out;
}

// ---------- the route ----------
async function agentState(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/agent/state`, { signal: AbortSignal.timeout(10000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
// deps (tests): state() -> /api/agent/state, root, names
export async function report(id, deps = {}) {
  const root = deps.root || options.root;
  const state = deps.state ? await deps.state() : await agentState(deps.port || PORT);
  if (!state) return no("DeviceHub's background part did not answer. Try again in a moment.");
  const snap = (state.devices || []).find((d) => d.id === String(id || ''));
  if (!snap) return no('There is no such device.');
  const b = buildRecord(snap, { root });
  if (!b.ok) return b;
  const issue = makeIssue(b.record, b.labels);
  const names = personalNames([...(options.names || []), ...(deps.names || [])]);
  const refused = personalIn(b.record, `${issue.title}\n${issue.body}`, names);
  if (refused.length) return { ok: false, why: 'Something in it looks personal, so DeviceHub will not open it. Nothing was sent.', refused, record: b.record };
  if (issue.url.length > MAX_URL) return no("The record is too long for GitHub's link.");
  return { ok: true, record: b.record, title: issue.title, body: issue.body, url: issue.url, token: rememberLink(issue.url, (text, n) => personalIn(b.record, text, n)) };
}
