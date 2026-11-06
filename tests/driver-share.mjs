// Shared learned drivers (helpers/driver-share.mjs, helpers/accept-driver-shares.mjs, 24 Oct 2026): a learned driver.json
// whose settings passed goes out once, only with the person's yes, never from the owner's PC, never with anything
// personal, never as code; back on Shawn's copy it unpacks, matches its SHA-256, every message it sends must be on the
// allow-list, and it becomes an untested library entry (6 Nov 2026), unless the library already has that USB id.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildShare, parseShare, shareFolder, MAX_BODY } from '../helpers/driver-share.mjs';
import { evaluate, apply } from '../helpers/accept-driver-shares.mjs';
import { hasRealRecord, driverShaOf } from '../helpers/my-devices.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-share-'));
const src = JSON.parse(fs.readFileSync(new URL('../device-library/keychron-via/driver.json', import.meta.url), 'utf8'));
// as if learned here: another id and USB id, so the library does not have it yet
const def = { ...src, id: 'acme-board', title: 'Acme board', vid: '1234', pids: ['5678'], hid: { ...src.hid, vid: '1234', pid: '5678' } };
if (def.models) def.models = def.models.map((m) => ({ ...m, pids: Object.fromEntries(Object.entries(m.pids || {}).map(([k]) => [k, ['5678']])) }));
const folder = path.join(root, 'my-devices', 'acme-board');
fs.mkdirSync(folder, { recursive: true });
const text = JSON.stringify(def, null, 2) + '\n';
fs.writeFileSync(path.join(folder, 'driver.json'), text);
fs.writeFileSync(path.join(folder, 'library.json'), JSON.stringify({ learned: true, status: 'read-only', devicehub: 'abc1234' }));
const key = def.settings.find((s) => s.type !== 'display').key;
const verified = { checkedAt: '2026-10-24T10:00:00Z', firmware: '1.2', devicehub: 'abc1234', keys: { [key]: { ok: true } } };
fs.writeFileSync(path.join(folder, 'verified.json'), JSON.stringify(verified));
const names = ['shawn-pc'];

const s = buildShare(folder, { names });
check(s.ok, `a learned driver whose setting passed is shared (${s.refused})`);
if (s.ok) {
  check(s.body.length <= MAX_BODY && s.fingerprint.startsWith('driver:1234') && /^Driver: Acme board/.test(s.title), 'its issue fits the relay and is named for the device');
  const back = parseShare(s.body);
  check(back.text === text && back.record.settings[0] === key && back.record.vid === '1234', 'the issue unpacks to the exact driver text and record');
  check(parseShare(s.body.replace(/(### Driver[^\n]*\n```text\n)(.)/, (m, a, c) => a + (c === 'A' ? 'B' : 'A'))).error, 'a changed driver is refused');
}
// refusals
fs.writeFileSync(path.join(folder, 'verified.json'), JSON.stringify({ ...verified, keys: { [key]: { ok: true }, other: { ok: false, why: 'x' } } }));
check(/failed/.test(buildShare(folder, { names }).refused || ''), 'a failed setting: not shared');
fs.writeFileSync(path.join(folder, 'verified.json'), JSON.stringify({ ...verified, keys: {} }));
check(/no setting has passed/.test(buildShare(folder, { names }).refused || ''), 'nothing passed yet: not shared');
fs.writeFileSync(path.join(folder, 'verified.json'), JSON.stringify(verified));
check(/user or computer name/.test(buildShare(folder, { names: ['Acme'] }).refused || ''), "this PC's user or computer name in it: not shared");
fs.writeFileSync(path.join(folder, 'device.mjs'), 'export default {}');
check(/code/.test(buildShare(folder, { names }).refused || ''), 'a driver written as code: never sent');
fs.unlinkSync(path.join(folder, 'device.mjs'));
fs.writeFileSync(path.join(folder, 'library.json'), JSON.stringify({ learned: false }));
check(/Learn a device/.test(buildShare(folder, { names }).refused || ''), 'a library copy (not learned here): not shared');
fs.writeFileSync(path.join(folder, 'library.json'), JSON.stringify({ learned: true, status: 'read-only', devicehub: 'abc1234' }));

// sending: only with the yes, never from the owner's PC, once per driver text
const sent = [];
const report = (owner = false) => async () => ({ isOwnerPc: async () => owner, sendNow: async (p) => { sent.push(p); return { sent: true }; } });
check((await shareFolder(folder, { root, report: report(), names })).why === 'not switched on' && !sent.length, 'not sent without the yes');
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'settings.json'), JSON.stringify({ shareDrivers: true }));
check((await shareFolder(folder, { root, report: report(true), names })).why === "the owner's own PC" && !sent.length, "never from the owner's PC");
check((await shareFolder(folder, { root, report: report(), names })).sent && sent.length === 1 && sent[0].channel === 'driver', 'sent once with the yes');
check((await shareFolder(folder, { root, report: report(), names })).why === 'already shared' && sent.length === 1, 'the same driver text is not sent twice');

// Shawn's side
const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-lib-'));
fs.mkdirSync(path.join(lib, 'device-library'));
fs.mkdirSync(path.join(lib, 'helpers'));
const issue = { number: 42, title: sent[0].title, body: sent[0].body };
const { main, libraryProblems, sentMessages } = await import('../helpers/accept-driver-shares.mjs');
const runIn = async (where, argv) => { const lines = []; const code = await main(argv, { root: where, list: async () => [issue], names, now: () => new Date('2026-11-06T12:00:00Z'), print: (l) => lines.push(l) }); return { code, out: lines.join('\n'), lines, written: fs.readdirSync(path.join(where, 'device-library')).length }; };
// (6 Nov 2026, the Manager for Shawn) every message must be on the allow-list: with nothing reviewed for vendor 1234 the
// share is refused, never reaches --apply, and the check-only run prints the line to add for each message
const ev0 = await evaluate([issue], { root: lib, names });
check(!ev0[0]?.ok && /not on the allow-list/.test(ev0[0]?.why || '') && ev0[0]?.unreviewed?.length === sentMessages(def).length, `a share whose messages nobody reviewed was not refused (${ev0[0]?.why})`);
const look0 = await runIn(lib, []);
const allowLines = look0.lines.map((l) => l.trim()).filter((l) => l.startsWith('{"vid"')).map((l) => JSON.parse(l));
check(look0.code === 0 && look0.written === 0 && allowLines.length === sentMessages(def).length && allowLines.every((m) => m.vid === '1234' && m.bytes && m.reviewed === '2026-11-06'), 'the check-only run does not print an allow-list line for each unreviewed message');
const blocked = await runIn(lib, ['--apply', '42']);
check(blocked.code === 1 && blocked.written === 0, 'a share with unreviewed messages reached --apply');
// a line without a reviewed date does not count
fs.writeFileSync(path.join(lib, 'helpers', 'share-allow-list.json'), JSON.stringify({ messages: allowLines.map(({ reviewed, ...m }) => m) }));
check(!(await evaluate([issue], { root: lib, names }))[0]?.ok, 'an allow-list line with no reviewed date let a share through');
// one message left off: still refused
fs.writeFileSync(path.join(lib, 'helpers', 'share-allow-list.json'), JSON.stringify({ messages: allowLines.slice(1) }));
const one = (await evaluate([issue], { root: lib, names }))[0];
check(!one?.ok && one?.unreviewed?.length === 1, 'a share with one unreviewed message was let through');
// a reviewed message on another report id or another vendor does not count
fs.writeFileSync(path.join(lib, 'helpers', 'share-allow-list.json'), JSON.stringify({ messages: allowLines.map((m, i) => (i ? m : { ...m, reportId: (Number(m.reportId) || 0) + 1 })) }));
check(!(await evaluate([issue], { root: lib, names }))[0]?.ok, 'a message reviewed for another report id was let through');
fs.writeFileSync(path.join(lib, 'helpers', 'share-allow-list.json'), JSON.stringify({ messages: allowLines.map((m, i) => (i ? m : { ...m, vid: '4321' })) }));
check(!(await evaluate([issue], { root: lib, names }))[0]?.ok, 'a message reviewed for another vendor was let through');
// all of them read and added
fs.writeFileSync(path.join(lib, 'helpers', 'share-allow-list.json'), JSON.stringify({ messages: allowLines }));
const ev = await evaluate([issue], { root: lib, names, now: () => new Date('2026-10-24T12:00:00Z') });
check(ev[0]?.ok, `the shared driver with every message reviewed is valid (${ev[0]?.why})`);
if (ev[0]?.ok) {
  const done = apply(ev, { root: lib });
  const dir = path.join(lib, 'device-library', done[0].name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8'));
  // (6 Nov 2026) what the share says passed is a claim, never a test record: the entry is untested (one click to install,
  // its settings off until turned on)
  check(meta.status === 'untested' && meta.tested.length === 0 && !hasRealRecord(meta, { driverSha: driverShaOf(dir) }) && meta.shared?.claimed?.[0] === key && meta.shared.issue === 42, `a relay share entered the library as tested or with a real-device record (${meta.status})`);
  check(libraryProblems(lib).length === 0, `a freshly taken-in share fails the publish gate (${libraryProblems(lib).join('; ')})`);
  // the publish gate: marked tested by hand without a review date, or a message changed after review
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ ...meta, status: 'tested', tested: [{ date: '2026-11-06', devicehub: 'x' }] }));
  check(libraryProblems(lib).some((p) => /nobody marked it reviewed/.test(p)), 'a shared driver marked tested without a review passed the publish gate');
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ ...meta, status: 'tested', tested: [{ date: '2026-11-06', devicehub: 'x' }], shared: { ...meta.shared, reviewed: '2026-11-06' } }));
  check(libraryProblems(lib).length === 0, 'a reviewed shared driver failed the publish gate');
  const d2 = JSON.parse(fs.readFileSync(path.join(dir, 'driver.json'), 'utf8'));
  const first = Object.keys(d2.messages)[0];
  d2.messages[first] = { ...d2.messages[first], bytes: 'FF EE DD' };
  fs.writeFileSync(path.join(dir, 'driver.json'), JSON.stringify(d2));
  check(libraryProblems(lib).some((p) => /not on the allow-list/.test(p)), 'a shared library driver with an unreviewed message passed the publish gate');
  fs.writeFileSync(path.join(dir, 'driver.json'), ev[0].text);
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify(meta, null, 2) + '\n');
  check((await evaluate([{ ...issue, number: 43 }], { root: lib, names }))[0]?.why?.includes('already has a driver'), 'a second share of the same USB id: refused');
}
// a reviewed library driver for the same vendor already sends these messages: they count as reviewed
{
  const lib3 = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-lib3-'));
  const known = path.join(lib3, 'device-library', 'acme-known');
  fs.mkdirSync(known, { recursive: true });
  fs.writeFileSync(path.join(known, 'driver.json'), JSON.stringify({ ...def, id: 'acme-known', pids: ['9999'], hid: { ...def.hid, pid: '9999' } }));
  const kmeta = { id: 'acme-known', vendor: 'Acme', product: 'Known', kind: 'Keyboard', vid: '1234', pids: ['9999'], models: ['Known'], works: [], status: 'tested', tested: [{ date: '2026-11-01', devicehub: '1.59' }] };
  fs.writeFileSync(path.join(known, 'device.json'), JSON.stringify(kmeta));
  check((await evaluate([issue], { root: lib3, names }))[0]?.ok, 'messages a reviewed library driver for the vendor already sends did not count as reviewed');
  fs.writeFileSync(path.join(known, 'device.json'), JSON.stringify({ ...kmeta, status: 'untested' }));
  check(!(await evaluate([issue], { root: lib3, names }))[0]?.ok, 'an untested library driver counted as a review');
  fs.writeFileSync(path.join(known, 'device.json'), JSON.stringify({ ...kmeta, shared: { issue: 1 } }));
  check(!(await evaluate([issue], { root: lib3, names }))[0]?.ok, 'a driver itself taken in from a share counted as a review');
  fs.rmSync(lib3, { recursive: true, force: true });
}
// (5 Nov 2026, security audit) anyone can post a share, so the bytes it sends by itself are printed, a vendor with no
// never list is called out, and --apply takes only the shares named by number
{
  const lib2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-lib2-'));
  fs.mkdirSync(path.join(lib2, 'device-library'));
  fs.mkdirSync(path.join(lib2, 'helpers'));
  fs.writeFileSync(path.join(lib2, 'helpers', 'share-allow-list.json'), JSON.stringify({ messages: allowLines }));
  const run = (argv) => runIn(lib2, argv);
  const look = await run([]);
  check(look.code === 0 && /sends by itself \(/.test(look.out) && /not proven/.test(look.out) && /untested/.test(look.out) && look.written === 0, 'the check-only run does not show the bytes a share sends by itself');
  check(/WARNING: DeviceHub has no never list for USB vendor/.test(look.out), 'a share for a vendor with no never list is not called out');
  const bare = await run(['--apply']);
  check(bare.code === 1 && bare.written === 0, '--apply with no issue numbers wrote a share');
  const wrong = await run(['--apply', '99']);
  check(wrong.code === 1 && wrong.written === 0, '--apply with a number that is not a valid share wrote something');
  const named = await run(['--apply', '42']);
  check(named.code === 0 && named.written === 1 && /issue close 42/.test(named.out) && /\(untested\)/.test(named.out), '--apply 42 did not add exactly the named share');
  fs.rmSync(lib2, { recursive: true, force: true });
}
check(!(await evaluate([{ number: 44, body: issue.body.replace('"settings": [', `"settings": ["nope", `) }], { root: lib, names }))[0]?.ok, 'a record naming settings the driver lacks: refused');
fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(lib, { recursive: true, force: true });
if (fails.length) { console.log(`driver-share: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('driver-share (learned drivers shared once with the yes, nothing personal, never code; taken in as untested library entries, every message on the allow-list): all good');
