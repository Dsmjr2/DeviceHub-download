// "Get help" (22 Oct 2026; helpers/get-help.mjs): the report is built from DeviceHub's facts, anything personal is
// taken out (or the report is refused when it cannot be), and the GitHub link stays within its limit with log lines
// dropped first. Pretend devices and a pretend DeviceHub folder in TEMP; nothing is opened and nothing is sent.
// Run: node tests/get-help.mjs (no hardware, no network, DeviceHub need not run)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strip, dropBluetooth, findPersonal, makeIssue, gather, report, open, relevantLog, driverOf, issueUrl, options, handle, MAX_URL, ISSUES } from '../helpers/get-help.mjs';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-help-'));
fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const opened = [];
Object.assign(options, { root, names: ['zorblax', 'QUUXPC-7'], open: async (u) => { opened.push(u); } });
const NAMES = ['zorblax', 'QUUXPC-7'];

try {
  // ---- personal data: taken out, and the result passes Share's own check
  const raw = [
    'saved C:\\Users\\zorblax\\DeviceHub\\backups\\x.json and file:///C:/Users/zorblax/DeviceHub/server.js',
    'mac home /Users/zorblax/thing and /home/zorblax/x',
    'HID\\VID_3710&PID_5406&MI_01\\7&2a1b3c4d&0&0000 opened',
    'serial number: AB12CD34EF and serial=XYZ-98765',
    'paired 0C:1D:2E:3F:4A:5B over Bluetooth',
    'mail me at zorb.lax@gmail.com, not test@example.com',
    'from 192.168.1.23 and fe80::1c2b:3d4e:5f60:7a8b and 2001:0db8:85a3:0000:0000:8a2e:0370:7334',
    'on QUUXPC-7 as zorblax',
    'kept: DeviceHub on http://127.0.0.1:5577 · firmware 5.8.48 · Windows 10.0.22631 · at 11:40:00 · C:\\Users\\Public\\x',
  ].join('\n');
  ok(findPersonal(raw, NAMES).length >= 8, `the raw text is caught by the check (${findPersonal(raw, NAMES).length} lines)`);
  const s = strip(raw, NAMES);
  ok(findPersonal(s.text, NAMES).length === 0, `nothing personal left after taking it out: ${JSON.stringify(findPersonal(s.text, NAMES))}\n${s.text}`);
  ok(!/zorblax|QUUXPC|AB12CD34EF|XYZ-98765|0C:1D|gmail|192\.168|fe80|2001:0db8|2a1b3c4d/i.test(s.text), `every personal piece gone:\n${s.text}`);
  ok(s.text.includes('saved %USERPROFILE%\\<path> and') && !/backups|x\.json|server\.js/.test(s.text.split('\n')[0]) &&s.text.includes('VID_3710&PID_5406 (instance id removed)'), 'stand-ins keep the rest readable');
  ok(s.text.includes('127.0.0.1:5577') && s.text.includes('5.8.48') && s.text.includes('10.0.22631') && s.text.includes('11:40:00') && s.text.includes('C:\\Users\\Public') && s.text.includes('test@example.com'), `harmless text kept:\n${s.text.split('\n').at(-1)}`);
  for (const why of ['your Windows user folder', 'a device serial number', 'a serial number', 'a MAC address', 'an e-mail address', 'an IP address', "this PC's user or computer name"]) ok(s.removed[why] > 0, `counted: ${why}`);

  // ---- the facts: a library driver on this PC
  put('my-devices/acme/driver.json', JSON.stringify({ id: 'acme-mouse', title: 'Acme Glide', kind: 'Mouse', hid: { vid: '1234', pid: 'ABCD', page: 'FF00', usage: '0001', len: 20 }, settings: [] }));
  put('my-devices/acme/library.json', JSON.stringify({ source: 'device-library/acme-glide', name: 'acme-glide', id: 'acme-mouse', status: 'read-only', libraryTested: '2026-10-20' }));
  put('my-devices/learned/library.json', JSON.stringify({ name: 'learned', id: 'x', status: 'read-only', learned: true }));
  put('my-devices/learned/driver.json', '{}');
  const STATE = { devices: [
    { id: 'acme-mouse', status: 'missing', error: 'could not open C:\\Users\\zorblax\\x', adapter: { id: 'acme-mouse', title: 'Acme Glide', kind: 'Mouse', plugin: 'acme', library: { turnOn: true } }, info: { Firmware: '1.2', 'Serial number': 'SN0001', Connection: 'Dongle' } },
    { id: 'keyboard', status: 'connected', adapter: { id: 'keyboard', title: 'Epomaker P75', kind: 'Keyboard' }, info: { Protocol: 'VIA 12' } },
  ] };
  const LOG = [
    'DeviceHub on http://localhost:5577',
    '[agent] running',
    '[my-devices] acme: Acme Glide added from C:\\Users\\zorblax\\DeviceHub\\my-devices\\acme',
    '[keyboard] VIA keyboards: EPOMAKER P75 (342D:E479)',
    'Error: keyboard reports brightness=253 after writing 243',
    '[devices] Windows reported a device change at 4:44:02 PM; no cable change',
    '[acme-mouse] open failed 32 on HID\\VID_1234&PID_ABCD\\8&aaaa&0&0000',
    '[acme-mouse] open failed 32 on HID\\VID_1234&PID_ABCD\\8&aaaa&0&0000',
    '[watchdog] 2026-10-22T11:40:00.000Z helper restarted: no heartbeat (1 in the last hour)',
    '[battery] Zorb Buds Pro: could not read the Bluetooth battery',
  ];
  const deps = {
    root, version: async () => 'abc123.def', windows: async () => 'Windows 11 23H2 (build 22631)', state: async () => STATE,
    usb: async () => [{ id: '1234:abcd', name: 'Acme Glide Receiver' }, { id: '342d:e479', name: 'P75' }],
    diagnose: async () => ({ findings: [{ code: 'held', problem: 'Another program holds the mouse\'s channel', why: 'Windows refused to open it for DeviceHub (sharing violation).', fix: 'Close any lighting app, then press Connect.' }] }),
    log: async () => LOG.join('\n').split('\n'),
    bluetooth: async () => [{ name: 'Zorb Buds Pro', percent: 80 }, { name: 'X' }],
  };
  const f = await gather('acme-mouse', deps);
  // support issue 3 (22 Oct 2026): DeviceHub's own slots for devices this PC never had are left out of a report
  {
    const st = { devices: [
      { id: 'mouse', status: 'missing', seen: false, adapter: { title: 'Pulsar X-Lite CrazyLight' } },
      { id: 'headset', status: 'missing', seen: false, adapter: { title: 'Corsair HS80' } },
      { id: 'keyboard', status: 'connected', seen: true, adapter: { title: 'Epomaker P75' } },
      { id: 'hyperx-cloud', status: 'error', seen: false, adapter: { title: 'HyperX Cloud headset', plugin: 'hyperx-cloud' } },
    ] };
    const g = await gather(null, { ...deps, state: async () => st });
    const ids = g.devices.map((x) => x.id).join(',');
    ok(ids === 'keyboard,hyperx-cloud', `a report lists only the devices this PC has (${ids})`);
    const mine = await gather(null, { ...deps, state: async () => ({ devices: st.devices.map((x) => ({ ...x, seen: true })) }) });
    ok(mine.devices.length === 4 && mine.devices.some((x) => x.id === 'mouse' && x.status === 'missing'), 'a device seen here before still shows as missing');
  }
  ok(f.device.usb[0].id === '1234:abcd' && f.device.usb[0].name === 'Acme Glide Receiver' && f.device.usb[0].present === true, `USB id and Windows' name (${JSON.stringify(f.device.usb)})`);
  ok(/from the device library: acme-glide \(status read-only, tested 2026-10-20, settings not turned on yet\)/.test(f.device.driver), `library driver named with its status (${f.device.driver})`);
  ok(!f.device.info.some(([k]) => /serial/i.test(k)) && f.device.info.some(([k, v]) => k === 'Firmware' && v === '1.2'), 'device info without the serial number');
  ok(f.log.some((l) => l.includes('open failed 32') && l.includes('(2 times)')) && f.log.some((l) => l.startsWith('[watchdog]')) && f.log.some((l) => l.startsWith('[my-devices] acme')), `its own log lines and the helper's, repeats counted (${JSON.stringify(f.log)})`);
  ok(!f.log.some((l) => /keyboard|no cable change|\[agent\] running/.test(l)), 'other devices\' lines and routine noise left out');
  ok(driverOf({ id: 'keyboard', adapter: {}, info: { Protocol: 'VIA 12' } }, root) === 'built into DeviceHub (VIA)', 'built-in VIA keyboard');
  ok(driverOf({ id: 'headset', adapter: { mode: 'generic' } }, root).includes('sound-only'), 'headset in its sound-only mode');
  ok(/^learned on this PC with the learning wizard \(driver\.json/.test(driverOf({ id: 'x', adapter: { plugin: 'learned' } }, root)), 'learned driver');
  ok(/^added on this PC by hand/.test(driverOf({ id: 'y', adapter: { plugin: 'nofolder' } }, root)), 'a hand-made driver');

  // ---- the report and its link
  const r = await report('acme-mouse', deps);
  ok(r.ok && r.token && r.url.startsWith(`${ISSUES}?`), `report made with a link (${r.error || ''})`);
  const q = new URL(r.url).searchParams;
  ok(q.get('title') === r.title && q.get('body') === r.body, 'the link carries exactly the report shown');
  ok(r.title === 'Help: Acme Glide (1234:abcd), not connected', `title (${r.title})`);
  for (const want of ['DeviceHub: 0.1.0 (build abc123.def)', 'Windows: Windows 11 23H2 (build 22631)', '- USB: 1234:abcd Acme Glide Receiver, plugged in', 'Another program holds', '### Log', '%USERPROFILE%', 'VID_1234&PID_ABCD (instance id removed)'])
    ok(r.body.includes(want), `body has "${want}"`);
  ok(!/zorblax|aaaa&0/.test(r.body + r.title), 'no user name or instance id in the report');
  ok(r.removed.some((x) => x.why === 'your Windows user folder' && x.count >= 2), `what was taken out is listed (${JSON.stringify(r.removed)})`);
  ok(findPersonal(`${r.title}\n${r.body}`, NAMES).length === 0, 'the report passes the check');

  // ---- general report (Settings > Health): every device, problem lines
  const g = await report('', deps);
  ok(g.ok && g.title.startsWith('Help: DeviceHub') && g.body.includes('- Acme Glide (acme-mouse): missing') && g.body.includes('brightness=253'), `general report (${g.title})`);
  // final audit (22 Oct 2026): the whole path after the user folder, and Bluetooth device names, are taken out
  ok(g.body.includes('[battery] <Bluetooth device>: could not read the Bluetooth battery') && !/Zorb Buds/.test(g.body), `a Bluetooth device's name is not in the log lines (${g.body.split('\n').filter((l) => /battery\]/.test(l)).join(' | ')})`);
  ok(!/my-devices\\acme|DeviceHub\\my-devices/.test(r.body) && r.body.includes('%USERPROFILE%\\<path>'), 'the path after %USERPROFILE% is blanked, not only the user name');
  const nb = await report('', { ...deps, bluetooth: async () => { throw new Error('no list'); } });
  ok(nb.ok && !/Bluetooth|Zorb/.test(nb.body), 'Bluetooth names that cannot be read: every log line about Bluetooth is left out');
  ok(dropBluetooth(['a Pad Pro b', 'Pad Prox'], ['Pad Pro']).join('|') === 'a <Bluetooth device> b|Pad Prox' && dropBluetooth(['x Bluetooth y', 'z'], null).join() === 'z', 'dropBluetooth: whole names only; no list = no Bluetooth lines');
  ok(strip('C:\\Users\\zorblax\\Documents\\My Secret Project\\notes for sam.txt (read)').text === '%USERPROFILE%\\<path> (read)' && strip('saved C:\\Users\\zorblax\\a b\\x.json and more').text === 'saved %USERPROFILE%\\<path> and more',`folder and file names with spaces go too (${strip('C:\\Users\\zorblax\\Documents\\My Secret Project\\notes for sam.txt (read)').text})`);

  // ---- open: only a link DeviceHub made, checked again
  ok((await open('nope')).ok === false && opened.length === 0, 'an unknown token opens nothing');
  const o = await open(r.token);
  ok(o.ok && opened.length === 1 && opened[0] === r.url, 'Open on GitHub opens the made link once');
  let code = null, body = null;
  const handled = await handle(new URL('http://127.0.0.1:5577/api/help/open'), { method: 'POST' }, {}, (res, c, b) => { code = c; body = b; }, async () => ({ token: 'x'.repeat(24) }));
  ok(handled && code === 400 && body.ok === false && opened.length === 1, 'the open route refuses a token it did not make');
  ok(await handle(new URL('http://127.0.0.1:5577/api/other'), { method: 'GET' }, {}, () => {}, async () => ({})) === false, 'other routes are not answered');

  // ---- refused: a name the stand-in itself still matches cannot be cleaned, so nothing can be opened
  const bad = makeIssue({ ...f, title: 'Help: x' }, { names: ['name'] });
  ok(!bad.ok && !bad.url && bad.refused.length > 0, `refused when something personal stays (${JSON.stringify(bad.refused?.slice(0, 2))})`);

  // ---- the URL limit: log lines dropped first, then the body cut; never over the limit
  const long = { ...f, log: Array.from({ length: 12 }, (_, i) => `[acme-mouse] line ${i} ${'x'.repeat(180)}`) };
  const fit = makeIssue(long, { names: NAMES, max: 2500 });
  ok(fit.ok && fit.length <= 2500 && fit.logLeftOut > 0 && fit.logShown < 12 && !fit.cut, `log lines dropped to fit (${fit.length}, ${fit.logShown} shown, ${fit.logLeftOut} left out)`);
  ok(fit.logShown === 0 || fit.body.includes('line 11 '), 'the newest log lines are the ones kept');
  const huge = { ...f, log: long.log, findings: Array.from({ length: 8 }, (_, i) => ({ problem: `Problem ${i}`, why: 'é "quoted" & <odd> '.repeat(400), fix: 'Fix. '.repeat(200) })) };
  const short = makeIssue(huge, { names: NAMES });
  ok(short.ok && short.length <= MAX_URL && !short.cut && short.logShown === 0 && !short.body.includes('Problem 3'), `long findings shortened to fit (${short.length})`);
  const cut = makeIssue({ ...huge, device: { ...huge.device, error: 'Z & "q" '.repeat(2000) } }, { names: NAMES });
  ok(cut.ok && cut.length <= MAX_URL && cut.cut && cut.body.endsWith("(Cut to fit GitHub's link limit.)"), `cut to fit (${cut.length} <= ${MAX_URL})`);
  ok(new URL(cut.url).searchParams.get('body') === cut.body, 'a cut link still decodes to the body shown');
  ok(MAX_URL === 8000 && issueUrl('a b', 'c+d').includes('title=a%20b') && issueUrl('a', 'c+d').includes('c%2Bd'), 'same limit and encoding as Share');
  ok(relevantLog(['x'.repeat(500)], null).length === 0 && relevantLog([`Error: ${'y'.repeat(500)}`], null)[0].length <= 200, 'long log lines cut to 200 characters');
} catch (e) {
  fails.push(`threw: ${e.stack || e}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (fails.length) { console.log(`get-help: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exitCode = 1; }
else console.log('get-help: all checks passed (report built, personal data taken out or refused, link within the limit, opened only on request)');
