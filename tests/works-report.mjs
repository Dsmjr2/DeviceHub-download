// "Works on my device" and "Turn on settings for all" (22 Oct 2026; docs/handoff/works-reports.md): the record has
// nothing personal and only what passed, it opens through Get help's open path, the accept script adds only valid
// records (exact shape, the library's current driver, the driver's own settings), realRecord accepts exactly that shape
// and nothing weaker, a driver with one self-checks without the click, and Turn on settings for all goes one device at a
// time through each device's own path. A pretend DeviceHub folder in TEMP; nothing is opened, sent or run on gh.
// Run: node tests/works-report.mjs (no hardware, no network, DeviceHub need not run)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realRecord, hasRealRecord, worksRecordProblem, provenCopy, driverSha, driverShaOf, needsTurnOn, guard } from '../helpers/my-devices.mjs';
import { buildRecord, makeIssue, parseRecord, issueRecordProblem, toTested, report, personalIn, options as worksOptions, LABEL, REPO } from '../helpers/works-report.mjs';
import { evaluate, apply, main, listIssues, closeCommand } from '../helpers/accept-works-reports.mjs';
import { turnOnAll, lineFor, waitingForTurnOn } from '../helpers/turn-on-all.mjs';
import { open as helpOpen, options as helpOptions, SAFE_URL, ISSUES } from '../helpers/get-help.mjs';
import { installFromLibrary, installNote } from '../helpers/device-library.mjs';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-works-'));
fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const readJ = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const NAMES = ['zorblax', 'QUUXPC-7'];
const opened = [];
Object.assign(helpOptions, { root, names: NAMES, open: async (u) => { opened.push(u); } });
Object.assign(worksOptions, { root, names: NAMES });

// a pretend library entry and its installed copy (CRLF in the library, LF in the copy: the same SHA-256)
const DRIVER = [
  "export default { id: 'acme-glide', title: 'Acme Glide', kind: 'Mouse', hid: { vid: '7777', pid: '0101' },",
  "  settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200 }, { key: 'sleep', label: 'Sleep after', type: 'choice', options: [{ value: 1, label: '1 min' }] }, { key: 'batt', label: 'Battery', type: 'display' }],",
  '  async connect() { return true; }, async info() { return { Model: "Glide Pro" }; }, async read() { return { dpi: 800, sleep: 1, batt: 50 }; }, async write(k, v) { return v; } };',
].join('\n');
const META = { id: 'acme-glide', vendor: 'Acme', product: 'Glide', kind: 'Mouse', vid: '7777', pids: ['0101'], models: ['Acme Glide Pro'], works: ['DPI', 'Sleep after'], status: 'untested', tested: [] };
put('device-library/acme-glide/device.mjs', DRIVER.replace(/\n/g, '\r\n'));
put('device-library/acme-glide/device.json', JSON.stringify(META, null, 2));
const SHA = driverSha(DRIVER);
ok(driverShaOf(path.join(root, 'device-library/acme-glide')) === SHA && /^[0-9a-f]{64}$/.test(SHA), 'the driver SHA-256 is the same with CRLF and LF line ends');

const copy = 'my-devices/acme-glide';
put(`${copy}/device.mjs`, DRIVER);
put(`${copy}/device.json`, JSON.stringify(META, null, 2));
const MARK = { source: 'device-library/acme-glide', name: 'acme-glide', id: 'acme-glide', status: 'untested', installedAt: '2026-10-22T10:00:00Z', devicehub: '0.1.0' };
const setMark = (m) => put(`${copy}/library.json`, JSON.stringify(m));
const setVerified = (keys, extra = {}) => put(`${copy}/verified.json`, JSON.stringify({ checkedAt: '2026-10-22T11:00:00.000Z', firmware: 'Mouse firmware 1.0.2.15', driver: 'acme-glide', devicehub: '0.1.0', keys, ...extra }));
const SETTINGS = [{ key: 'dpi', label: 'DPI', type: 'slider' }, { key: 'sleep', label: 'Sleep after', type: 'choice' }, { key: 'batt', label: 'Battery', type: 'display' }];
const snap = (over = {}) => ({ id: 'acme-glide', status: 'connected', info: { Model: 'Glide Pro', Serial: 'AB12CD34' }, adapter: { id: 'acme-glide', title: 'Acme Glide', kind: 'Mouse', plugin: 'acme-glide', settings: SETTINGS, library: { turnOn: false, learned: false } }, ...over });

try {
  // ---- 1. realRecord: exactly the works shape, nothing weaker
  const rec = toTested({ driver: 'acme-glide', driverSha: SHA, date: '2026-10-22', devicehub: '0.1.0', model: 'Glide Pro', firmware: 'Mouse firmware 1.0.2.15', settings: ['dpi', 'sleep'], checked: 2 }, 7);
  ok(worksRecordProblem(rec) === null && realRecord(rec, 'untested') && realRecord(rec, 'untested', SHA), `the full works record counts (${worksRecordProblem(rec)})`);
  ok(!realRecord(rec, 'untested', 'f'.repeat(64)), 'a works record for another driver text does not count');
  const weaker = {
    'real missing': (({ real, ...r }) => r)(rec), 'real "yes"': { ...rec, real: 'yes' }, 'status read-only': { ...rec, status: 'read-only' },
    'no status': (({ status, ...r }) => r)(rec), 'another by': { ...rec, by: 'Sam' }, 'no date': (({ date, ...r }) => r)(rec), 'bad date': { ...rec, date: 'yesterday' },
    'no version': { ...rec, devicehub: '' }, 'short sha': { ...rec, driverSha: 'abc' }, 'no model': { ...rec, model: ' ' }, 'firmware missing': (({ firmware, ...r }) => r)(rec),
    'no settings': { ...rec, settings: [] }, 'settings twice': { ...rec, settings: ['dpi', 'dpi'] }, 'checked too few': { ...rec, checked: 1 }, 'no issue': (({ issue, ...r }) => r)(rec),
    'extra field': { ...rec, serial: 'x' }, 'simulation': { ...rec, simulation: true }, 'how says simulated': { ...rec, how: 'simulated device' }, 'how says read-only': { ...rec, how: 'settings read, nothing written' },
    'sha only': { by: 'Sam', date: '2026-10-22', devicehub: '0.1.0', status: 'tested', how: 'x', driverSha: SHA },
  };
  for (const [what, r] of Object.entries(weaker)) ok(!realRecord(r, 'tested') && !hasRealRecord({ status: 'tested', tested: [r] }), `a weaker record does not count: ${what}`);
  ok(realRecord({ by: 'Sam', date: '2026-10-23', devicehub: '0.2.0', status: 'tested', how: 'each setting written once and read back' }), "a share-device record (no works fields) keeps today's rule");
  ok(hasRealRecord({ status: 'untested', tested: [rec] }, { driverSha: SHA }) && !hasRealRecord({ status: 'untested', tested: [rec] }, { driverSha: '0'.repeat(64) }), 'hasRealRecord compares the driver SHA-256 when it is given');

  // ---- 2. the record on this PC: only after the check passed, nothing personal, only what passed
  setMark({ ...MARK }); setVerified({ dpi: { ok: true, value: 800, readBack: 800 }, sleep: { ok: true, value: 1, readBack: 1 } });
  ok(/Turn on settings first/.test(buildRecord(snap(), { root }).why || ''), 'before Turn on settings: no record');
  setMark({ ...MARK, settingsOn: { at: '2026-10-22T10:30:00Z' } });
  let b = buildRecord(snap(), { root });
  ok(b.ok && b.record.driver === 'acme-glide' && b.record.driverSha === SHA && b.record.model === 'Glide Pro' && b.record.date === '2026-10-22' && b.record.firmware === 'Mouse firmware 1.0.2.15' && b.record.checked === 2 && b.record.settings.join() === 'dpi,sleep', `the record (${JSON.stringify(b)})`);
  ok(b.ok && !JSON.stringify(b.record).includes('AB12CD34') && issueRecordProblem(b.record) === null, 'the record carries only its own fields (no serial from info)');
  ok(/Turn on settings first/.test(buildRecord(snap({ adapter: { ...snap().adapter, library: { turnOn: true } } }), { root }).why || ''), 'a page still showing Turn on settings: no record');
  setVerified({ dpi: { ok: true, value: 800, readBack: 800 }, sleep: { ok: false, why: 'x' } });
  b = buildRecord(snap(), { root });
  ok(b.ok && b.record.settings.join() === 'dpi' && b.record.checked === 2, 'a failed setting is left out of "settings"');
  setVerified({ dpi: { ok: false, why: 'x' }, sleep: { waiting: true, why: 'y' } });
  ok(/No setting has passed/.test(buildRecord(snap(), { root }).why || ''), 'nothing passed: no record');
  fs.rmSync(path.join(root, copy, 'verified.json'));
  ok(/not been checked/.test(buildRecord(snap(), { root }).why || ''), 'never checked: no record');
  setVerified({ dpi: { ok: true, value: 800, readBack: 800 }, sleep: { ok: true, value: 1, readBack: 1 } });
  setMark({ ...MARK, settingsOn: { at: '2026-10-22T10:30:00Z' }, learned: true });
  ok(/Learn a device/.test(buildRecord(snap(), { root }).why || ''), 'a learned driver: no record');
  setMark({ ...MARK, settingsOn: { at: '2026-10-22T10:30:00Z' }, learnedKeys: ['dpi'] });
  ok(/not the library's driver/.test(buildRecord(snap(), { root }).why || ''), 'a copy the wizard added settings to: no record');
  setMark({ ...MARK, settingsOn: { at: '2026-10-22T10:30:00Z' } });
  put(`${copy}/device.mjs`, `${DRIVER}\n// changed here`);
  ok(/not the same as the library's driver/.test(buildRecord(snap(), { root }).why || ''), 'a changed copy: no record');
  put(`${copy}/device.mjs`, DRIVER);
  ok(/no driver from the device library/.test(buildRecord({ id: 'mouse', adapter: { id: 'mouse' } }, { root }).why || ''), 'a built-in device: no record');

  // ---- 3. the issue, and the open path Get help uses
  b = buildRecord(snap(), { root });
  const issue = makeIssue(b.record, b.labels);
  ok(issue.url.startsWith(`${ISSUES}?`) && issue.url.includes(`labels=${LABEL}`) && SAFE_URL.test(issue.url), `a GitHub new-issue link with the label (${issue.url.slice(0, 120)})`);
  ok(JSON.stringify(parseRecord(issue.body)) === JSON.stringify(b.record) && /DPI, Sleep after/.test(issue.body), 'the record reads back out of the issue body');
  const r = await report('acme-glide', { root, state: async () => ({ devices: [snap()] }) });
  ok(r.ok && r.token && r.url === issue.url, `report() makes it and a token (${r.why || ''})`);
  ok(opened.length === 0, 'nothing opens before the click');
  const o = await helpOpen(r.token);
  ok(o.ok && opened.length === 1 && opened[0] === issue.url, `it opens through Get help's open (${o.error || ''})`);
  ok(!(await report('nope', { root, state: async () => ({ devices: [snap()] }) })).ok && !(await report('acme-glide', { root, state: async () => null })).ok, 'no device, or no answer: nothing');
  ok(personalIn(b.record, issue.body, NAMES).length === 0, 'a firmware version like 1.0.2.15 is not taken for an IP address');
  const mine = await report('acme-glide', { root, state: async () => ({ devices: [snap({ info: { Model: 'zorblax mouse' } })] }) });
  ok(!mine.ok && !mine.token && /personal/.test(mine.why || ''), 'a model with the PC user name in it is refused, with no link');
  ok(personalIn({ ...b.record, firmware: 'fw for zorb.lax@gmail.com' }, 'x', NAMES).length > 0, 'personal firmware text is refused');

  // ---- 4. the accept script
  const body = (rec2) => makeIssue(rec2, []).body;
  const issues = [
    { number: 7, title: makeIssue(b.record).title, body: issue.body },
    { number: 8, title: 'Works on my device: x', body: body({ ...b.record, driverSha: 'a'.repeat(64) }) },
    { number: 9, title: 'Works on my device: x', body: body({ ...b.record, driver: 'acme-nothing' }) },
    { number: 10, title: 'Works on my device: x', body: body({ ...b.record, serial: 'AB12CD34' }) },
    { number: 11, title: 'Works on my device: x', body: body({ ...b.record, model: 'QUUXPC-7 mouse' }) },
    { number: 12, title: 'Works on my device: x', body: body({ ...b.record, settings: ['dpi', 'rgb'], checked: 2 }) },
    { number: 13, title: 'Works on my device: x', body: 'it works!' },
    { number: 14, title: 'Works on my device: x', body: body({ ...b.record, settings: ['batt'], checked: 1 }) },
  ];
  let ev = await evaluate(issues, { root, names: NAMES });
  const at = (n) => ev.find((x) => x.number === n);
  ok(at(7)?.ok && at(7).record.real === true && at(7).record.issue === 7 && at(7).record.status === 'tested', `a valid report is accepted (${JSON.stringify(at(7))})`);
  ok(/current driver/.test(at(8)?.why || ''), `another driver text is refused (${at(8)?.why})`);
  ok(/no device-library\/acme-nothing/.test(at(9)?.why || ''), `an unknown driver is refused (${at(9)?.why})`);
  ok(/never has \(serial\)/.test(at(10)?.why || ''), `an extra field is refused (${at(10)?.why})`);
  ok(/personal/.test(at(11)?.why || ''), `personal text is refused (${at(11)?.why})`);
  ok(/does not have \(rgb\)/.test(at(12)?.why || ''), `a setting the driver does not have is refused (${at(12)?.why})`);
  ok(/Record/.test(at(13)?.why || ''), `an issue with no record is refused (${at(13)?.why})`);
  ok(/does not have \(batt\)/.test(at(14)?.why || ''), `a reading (never written) is not a setting that passed (${at(14)?.why})`);
  ok(ev.filter((x) => x.ok).length === 1, 'only the valid one');

  const before = fs.readFileSync(path.join(root, 'device-library/acme-glide/device.json'), 'utf8');
  const lines = [];
  ok(await main([], { root, names: NAMES, list: async () => issues, print: (l) => lines.push(l) }) === 0 && fs.readFileSync(path.join(root, 'device-library/acme-glide/device.json'), 'utf8') === before, 'without --apply nothing is written');
  ok(lines.some((l) => /Nothing was written/.test(l)) && !lines.some((l) => /gh issue close/.test(l)), 'without --apply: no close commands');
  lines.length = 0;
  ok(await main(['--apply'], { root, names: NAMES, list: async () => issues, print: (l) => lines.push(l), now: () => new Date('2026-10-25T09:00:00Z') }) === 0, 'with --apply it runs');
  const meta = readJ('device-library/acme-glide/device.json');
  ok(meta.status === 'tested' && meta.updated === '2026-10-25' && meta.tested.length === 1 && meta.tested[0].issue === 7 && worksRecordProblem(meta.tested[0]) === null, `the record is added and the entry promoted (${JSON.stringify(meta)})`);
  ok(hasRealRecord(meta, { driverSha: SHA }), 'the added record is a real-device record for the current driver');
  ok(lines.some((l) => l === `  ${closeCommand({ number: 7, driver: 'acme-glide' })}`) && lines.some((l) => /Nothing was committed or pushed/.test(l)), 'it prints the close command and says nothing was committed');
  ok(!lines.some((l) => /gh issue close (8|9|1\d)\b/.test(l)), 'no close command for a refused report');
  ev = await evaluate(issues.slice(0, 1), { root, names: NAMES });
  ok(!ev[0].ok && /already in/.test(ev[0].why), 'a report already added is not added twice');
  ok(apply([], { root }).length === 0, 'nothing valid: nothing written');

  // gh: read-only listing only, each issue once
  const calls = [];
  const fake = async (args) => { calls.push(args); return JSON.stringify(args.includes('--label') ? [{ number: 3, title: 't', body: 'b' }, { number: 5, title: 't', body: 'b' }] : [{ number: 5, title: 't', body: 'b' }, { number: 4, title: 't', body: 'b' }]); };
  const got = await listIssues(fake);
  ok(got.map((x) => x.number).join() === '3,4,5', `the labeled and titled issues, each once (${got.map((x) => x.number)})`);
  ok(calls.length === 2 && calls.every((a) => a[0] === 'issue' && a[1] === 'list' && a.includes(REPO) && a.includes('open') && !a.some((x) => /close|edit|comment|create|delete/.test(x))), `gh is only asked to list (${JSON.stringify(calls)})`);
  const src = fs.readFileSync(path.join(REAL, 'helpers/accept-works-reports.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/['"]push['"]|execFile\(\s*['"]git|spawn\(/.test(src) && !/run\(\[\s*'issue',\s*'(close|edit|comment)/.test(src), 'the accept script never runs git or a gh write');

  // ---- 5. a driver with such a record self-checks on connect without the click
  const inst = await installFromLibrary('acme-glide', { root: (() => { fs.rmSync(path.join(root, copy), { recursive: true, force: true }); return root; })() });
  ok(inst.ok && inst.proven && /change normally/.test(inst.note), `installed proven (${JSON.stringify(inst)})`);
  const mark2 = readJ(`${copy}/library.json`);
  ok(provenCopy(path.join(root, copy), mark2) && !needsTurnOn(mark2, true, 'dpi'), 'the copy is proven: no Turn on settings needed');
  const drv = (await import(`file:///${path.join(root, copy, 'device.mjs').replace(/\\/g, '/')}?t=${Date.now()}`)).default;
  guard(drv, path.join(root, copy), mark2, { backup: async () => ({}), makerApp: async () => null, log: () => {}, version: '0.1.0' });
  ok(drv.library.turnOn === false && drv.library.proven === true, `the guarded driver does not wait for the click (${JSON.stringify(drv.library)})`);
  await drv.connect();
  const ver = readJ(`${copy}/verified.json`);
  ok(ver.keys?.dpi?.ok === true && ver.keys?.sleep?.ok === true && !ver.keys?.batt, `its self-check ran on connect with no click (${JSON.stringify(ver.keys)})`);
  put(`${copy}/device.mjs`, `${DRIVER}\n// edited`);
  ok(!provenCopy(path.join(root, copy), mark2), 'the copy edited after the record: not proven any more');
  ok(/Turn on settings/.test(installNote(meta, '0'.repeat(64))) && /change normally/.test(installNote(meta, SHA)), 'installNote follows the driver SHA-256');

  // ---- 6. Turn on settings for all: one at a time, the per-device path, one line each
  const dev = (id, status, turnOn, over = {}) => ({ id, status, adapter: { id, title: `Dev ${id}`, plugin: id, library: { turnOn } }, ...over });
  const state = { devices: [dev('a', 'connected', true), dev('b', 'idle', true), dev('c', 'connected', false), dev('d', 'connected', true), { id: 'mouse', status: 'connected', adapter: { id: 'mouse', title: 'Mouse' } }, dev('e', 'connected', true)] };
  const log = [];
  let busy = 0, overlap = false;
  const fakeFetch = async (url, o = {}) => {
    if (url.endsWith('/api/agent/state')) return { ok: true, json: async () => state };
    const id = JSON.parse(o.body).id;
    log.push(id);
    if (busy) overlap = true;
    busy++;
    await new Promise((res) => setTimeout(res, 5));
    busy--;
    if (id === 'd') return { ok: true, json: async () => ({ ran: false, on: true, why: 'Acme Hub (the maker\'s app) is open, so nothing was written', waiting: true }) };
    if (id === 'e') throw new Error('connection reset');
    return { ok: true, json: async () => ({ ran: true, on: true, counts: { passed: 3, checked: 4, waiting: 0, failed: 1 } }) };
  };
  const all = await turnOnAll({ port: 1, fetch: fakeFetch });
  ok(log.join() === 'a,d,e' && !overlap, `only waiting, connected devices, one after another (${log}, overlap ${overlap})`);
  ok(all.ok && all.results.length === 4 && all.line === 'Turned on 2 of 4 devices.', `the summary line (${all.line})`);
  const ln = Object.fromEntries(all.results.map((x) => [x.id, x.line]));
  ok(ln.a === 'Dev a: settings turned on, 3 of 4 settings passed, 1 stays read-only.', `a: ${ln.a}`);
  ok(/^Dev b: not connected/.test(ln.b) && /maker's app\) is open/.test(ln.d) && /^Dev e: not turned on: connection reset/.test(ln.e), `b, d, e: ${ln.b} | ${ln.d} | ${ln.e}`);
  ok(!waitingForTurnOn(state.devices[4]) && !waitingForTurnOn(state.devices[2]) && waitingForTurnOn(state.devices[0]), 'built-in and turned-on devices are never pressed');
  ok((await turnOnAll({ port: 1, fetch: async () => { throw new Error('down'); } })).ok === false, 'no answer: nothing pressed');
  ok(lineFor('X', { ran: false, on: false, why: 'its settings could not be saved' }) === 'X: not turned on: its settings could not be saved', 'a plain line when it was not turned on');

  // ---- 7. the pages: in place, no pop-ups, notifications or tooltips
  const ui = fs.readFileSync(path.join(REAL, 'public/ui/works-report.js'), 'utf8');
  ok(!/toast\(|modal\(|\btitle:|alert\(|confirm\(|Notification/.test(ui), 'the Works on my device panel has no pop-ups, notifications or tooltips');
  ok(/\/api\/help\/works/.test(ui) && /\/api\/help\/open/.test(ui), 'it uses the works route and Get help\'s open route');
  const page = fs.readFileSync(path.join(REAL, 'public/pages/my-device.js'), 'utf8');
  ok(/offersWorks\(d\) \? worksReport\(d[,)]/.test(page), 'the device page offers it');
  // Turn on settings for all moved from the Overview's Set up card to the Setup page's Do all (22 Oct 2026)
  const sp = fs.readFileSync(path.join(REAL, 'public/pages/setup.js'), 'utf8');
  ok(/Turn on settings for all/.test(sp) && /kind: 'turn-on-all'/.test(sp), 'the Setup page has Turn on settings for all');
  const diag = fs.readFileSync(path.join(REAL, 'helpers/diagnose.mjs'), 'utf8');
  ok(/kind === 'turn-on-all'/.test(diag), 'the diagnose action routes it');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (fails.length) { console.log(`works-report: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('works-report: all checks passed');
