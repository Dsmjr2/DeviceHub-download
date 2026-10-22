// Accept "Works on my device" reports (22 Oct 2026; docs/handoff/works-reports.md). Shawn runs it on his own copy:
//
//   node helpers/accept-works-reports.mjs            read and check only: prints what it would add, changes nothing
//   node helpers/accept-works-reports.mjs --apply    also writes each valid record into device-library/<driver>/device.json
//                                                    and prints the gh commands that close those issues (it runs none)
//   --from <file.json>                               read the issues from a file (gh's --json output) instead of gh
//
// It lists open issues on Dsmjr2/DeviceHub-download labeled "works" with `gh issue list` (read-only), plus open issues
// whose title starts "Works on my device:" (GitHub drops the label from a new-issue link opened by someone without
// triage rights; the record inside is checked the same way either way). For each one it checks the record: exactly the
// fields a works report has, the driver exists in device-library/, its SHA-256 matches the library's CURRENT driver, the
// settings are the driver's, the date and version are there, and nothing personal (Share's check plus IP addresses). A
// valid record becomes { status: "tested", real: true, ... } in that driver's `tested` list (the shape
// helpers/my-devices.mjs realRecord accepts), the entry's status becomes "tested" and its "updated" today, so the next
// library bundle carries it. It never commits, never pushes, never closes or comments on an issue.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRecord, issueRecordProblem, toTested, personalIn, REPO, LABEL, TITLE_START } from './works-report.mjs';
import { validateMeta, driverFileOf, loadDriver } from './device-library.mjs';
import { driverShaOf, realRecord, writable } from './my-devices.mjs';
import { personalNames } from './share-device.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /^[a-z0-9][a-z0-9-]{1,60}$/;
const FIELDS = 'number,title,body,labels';

const gh = (args) => new Promise((resolve, reject) => execFile('gh', args, { windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n')[0])) : resolve(String(out || '')))));
// the open works issues, read-only: labeled "works", and titled "Works on my device:" (each issue once)
export async function listIssues(run = gh) {
  const labeled = JSON.parse(await run(['issue', 'list', '-R', REPO, '--state', 'open', '--label', LABEL, '--limit', '200', '--json', FIELDS]) || '[]');
  const titled = JSON.parse(await run(['issue', 'list', '-R', REPO, '--state', 'open', '--search', `"${TITLE_START}" in:title`, '--limit', '200', '--json', FIELDS]) || '[]');
  const seen = new Map();
  for (const i of [...labeled, ...titled]) if (i && Number.isInteger(i.number) && !seen.has(i.number)) seen.set(i.number, i);
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

// each issue checked: [{ number, ok, driver?, record?, why? }]. Nothing is written.
export async function evaluate(issues, { root = ROOT, names = personalNames() } = {}) {
  const out = [];
  const keysOf = new Map();   // driver -> its writable setting keys ([] when its list depends on the model connected)
  const adding = new Set();   // issue numbers already taken in this run
  for (const i of issues || []) {
    const n = i?.number;
    const fail = (why, driver) => out.push({ number: n, ok: false, why, ...(driver ? { driver } : {}) });
    if (!Number.isInteger(n) || n < 1) { fail('it has no issue number'); continue; }
    if (adding.has(n)) continue;
    let r;
    try { r = parseRecord(i.body); } catch (e) { fail(e.message); continue; }
    const bad = issueRecordProblem(r);
    if (bad) { fail(`its record is not valid: ${bad}`, typeof r?.driver === 'string' ? r.driver : null); continue; }
    if (!NAME.test(r.driver)) { fail('its driver is not a library entry name'); continue; }
    const dir = path.join(root, 'device-library', r.driver);
    if (!fs.existsSync(dir) || !driverFileOf(dir)) { fail(`there is no device-library/${r.driver} with a driver in it`, r.driver); continue; }
    let meta;
    try { meta = readJson(path.join(dir, 'device.json')); } catch (e) { fail(`device-library/${r.driver}/device.json does not read (${e.message})`, r.driver); continue; }
    const metaBad = validateMeta(meta);
    if (metaBad) { fail(`device-library/${r.driver}/device.json: ${metaBad}`, r.driver); continue; }
    const sha = driverShaOf(dir);
    if (sha !== r.driverSha) { fail("its driver is not the library's current driver (the SHA-256 differs): ask for a new report with the current driver", r.driver); continue; }
    if (!keysOf.has(r.driver)) {
      let keys = null;
      try { const { a } = await loadDriver(dir, 'works'); keys = (Array.isArray(a?.settings) ? a.settings : []).filter(writable).map((s) => s.key); } catch (e) { keys = { error: String(e.message || e).split('\n')[0] }; }
      keysOf.set(r.driver, keys);
    }
    const keys = keysOf.get(r.driver);
    if (keys?.error) { fail(`its driver does not load here (${keys.error})`, r.driver); continue; }
    const unknown = keys.length ? r.settings.filter((k) => !keys.includes(k)) : [];
    if (unknown.length) { fail(`it names settings the driver does not have (${unknown.join(', ')})`, r.driver); continue; }
    if (keys.length && r.checked > keys.length) { fail(`it says ${r.checked} settings were checked; the driver has ${keys.length}`, r.driver); continue; }
    const personal = personalIn(r, `${i.title || ''}\n${JSON.stringify(r, null, 2)}`, names);
    if (personal.length) { fail(`it holds something personal (${[...new Set(personal.map((x) => x.why))].join(', ')})`, r.driver); continue; }
    if ((meta.tested || []).some((t) => t?.issue === n)) { fail(`already in device-library/${r.driver}/device.json`, r.driver); continue; }
    const record = toTested(r, n);
    // the gate itself: the record must count as a real-device record for exactly this driver
    if (!realRecord(record, meta.status, sha)) { fail('it would not count as a real-device record (realRecord refused it)', r.driver); continue; }
    adding.add(n);
    out.push({ number: n, ok: true, driver: r.driver, record, note: keys.length ? null : 'its settings list depends on the model connected, so the setting names were not compared' });
  }
  return out;
}

// writes the valid records (grouped per driver); returns [{ driver, file, added: [issue numbers], was, status }]
export function apply(results, { root = ROOT, now = () => new Date() } = {}) {
  const today = now().toISOString().slice(0, 10);
  const by = new Map();
  for (const x of results.filter((y) => y.ok)) { if (!by.has(x.driver)) by.set(x.driver, []); by.get(x.driver).push(x); }
  const done = [];
  for (const [driver, list] of by) {
    const file = path.join(root, 'device-library', driver, 'device.json');
    const meta = readJson(file);
    const was = meta.status;
    meta.tested = Array.isArray(meta.tested) ? meta.tested : [];
    for (const x of list) if (!meta.tested.some((t) => t?.issue === x.number)) meta.tested.push(x.record);
    meta.status = 'tested';
    meta.updated = today > String(meta.updated || '') ? today : meta.updated;
    const bad = validateMeta(meta);
    if (bad) throw new Error(`device-library/${driver}/device.json would not be valid (${bad}); nothing written for it`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n');
    fs.renameSync(tmp, file);
    done.push({ driver, file, added: list.map((x) => x.number), was, status: meta.status });
  }
  return done;
}

export const closeCommand = (x) => `gh issue close ${x.number} -R ${REPO} --comment "Added to device-library/${x.driver} as a tested record. Thank you."`;

// the whole run; deps (tests): list() -> issues, root, names, now, print(line)
export async function main(argv = process.argv.slice(2), deps = {}) {
  const print = deps.print || ((l) => console.log(l));
  const root = deps.root || ROOT;
  const doApply = argv.includes('--apply');
  const fromAt = argv.indexOf('--from');
  let issues;
  try {
    issues = deps.list ? await deps.list() : fromAt >= 0 ? readJson(path.resolve(argv[fromAt + 1] || '')) : await listIssues();
  } catch (e) { print(`Could not read the works issues: ${e.message}. Is gh installed and signed in (gh auth status)?`); return 2; }
  const results = await evaluate(issues, { root, ...(deps.names ? { names: deps.names } : {}) });
  const good = results.filter((x) => x.ok), bad = results.filter((x) => !x.ok);
  print(`${results.length} open works report${results.length === 1 ? '' : 's'}: ${good.length} valid, ${bad.length} refused.`);
  for (const x of good) print(`  #${x.number} ${x.driver}: valid, ${x.record.settings.length} of ${x.record.checked} settings passed (${x.record.model}${x.record.firmware ? `, ${x.record.firmware}` : ''})${x.note ? `; ${x.note}` : ''}`);
  for (const x of bad) print(`  #${x.number}${x.driver ? ` ${x.driver}` : ''}: refused: ${x.why}`);
  if (!good.length) return 0;
  if (!doApply) { print('Nothing was written. Run again with --apply to add the valid ones.'); return 0; }
  let done;
  try { done = apply(results, { root, now: deps.now }); } catch (e) { print(`Not applied: ${e.message}`); return 1; }
  for (const d of done) print(`  wrote device-library/${d.driver}/device.json: ${d.added.length} record${d.added.length === 1 ? '' : 's'} added (issue ${d.added.map((n) => `#${n}`).join(', ')}), status ${d.was} -> ${d.status}`);
  print('Nothing was committed or pushed. Look over git diff, commit, then rebuild the library bundle (node helpers/make-library-bundle.mjs). To close the issues:');
  for (const x of good) print(`  ${closeCommand(x)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
