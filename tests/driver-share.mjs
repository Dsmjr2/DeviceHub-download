// Shared learned drivers (helpers/driver-share.mjs, helpers/accept-driver-shares.mjs, 24 Oct 2026): a learned driver.json
// whose settings passed goes out once, only with the person's yes, never from the owner's PC, never with anything
// personal, never as code; back on Shawn's copy it unpacks, matches its SHA-256 and becomes a tested library entry that
// realRecord counts, unless the library already has that USB id.
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
fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ shareDrivers: true }));
check((await shareFolder(folder, { root, report: report(true), names })).why === "the owner's own PC" && !sent.length, "never from the owner's PC");
check((await shareFolder(folder, { root, report: report(), names })).sent && sent.length === 1 && sent[0].channel === 'driver', 'sent once with the yes');
check((await shareFolder(folder, { root, report: report(), names })).why === 'already shared' && sent.length === 1, 'the same driver text is not sent twice');

// Shawn's side
const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-lib-'));
fs.mkdirSync(path.join(lib, 'device-library'));
const issue = { number: 42, title: sent[0].title, body: sent[0].body };
const ev = await evaluate([issue], { root: lib, names, now: () => new Date('2026-10-24T12:00:00Z') });
check(ev[0]?.ok, `the shared driver is valid (${ev[0]?.why})`);
if (ev[0]?.ok) {
  const done = apply(ev, { root: lib });
  const dir = path.join(lib, 'device-library', done[0].name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8'));
  check(meta.status === 'tested' && hasRealRecord(meta, { driverSha: driverShaOf(dir) }), `it enters the library as tested, a real-device record for exactly this driver (${done[0].name})`);
  check((await evaluate([{ ...issue, number: 43 }], { root: lib, names }))[0]?.why?.includes('already has a driver'), 'a second share of the same USB id: refused');
}
check(!(await evaluate([{ number: 44, body: issue.body.replace('"settings": [', `"settings": ["nope", `) }], { root: lib, names }))[0]?.ok, 'a record naming settings the driver lacks: refused');
fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(lib, { recursive: true, force: true });
if (fails.length) { console.log(`driver-share: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('driver-share (learned drivers shared once with the yes, nothing personal, never code; taken in as tested library entries): all good');
