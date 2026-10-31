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
  ok(nb.ok && !/Zorb/.test(nb.body) && !nb.body.split('\n').some((l) => /bluetooth/i.test(l) && !/^- Bluetooth: /.test(l)), 'Bluetooth names that cannot be read: every log line about Bluetooth is left out (the picture says only that the list could not be read)');
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

  // ---- Get help on every screen (22 Oct 2026, docs/handoff/get-help-everywhere.md): each area builds its report from
  // its page's GET routes (stand-ins here, with personal bits planted in them), the page's own context goes in, and
  // nothing personal comes out
  const API = {
    '/api/agent/state': STATE,
    '/api/monitors': [{ id: 'AOCA610#5&3da353e&0&UID37121', name: 'AOC AGON OLED', model: 'AG276QZD2', ddc: true, brightness: { value: 50, max: 100 }, contrast: { value: 48, max: 100 }, red: { value: 50, max: 100 }, error: 'read failed at C:\\Users\\zorblax\\x.log', supports: [{}, {}] },
      { id: 'X#1', name: 'Old screen', ddc: false }],
    '/api/cameras': [{ id: '\\\\?\\usb#vid_291a&pid_3369&mi_00#7&3924ec', name: 'Anker PowerConf C200', controls: { brightness: {}, zoom: {} } }],
    '/api/gpu': { available: true, gpus: [{ name: 'NVIDIA GeForce RTX 4070', tempC: 36, fanPct: 0, loadPct: 8 }] },
    '/api/eq': { available: true, engine: 'eqapo', presets: [{ id: 'a', name: "Zorblax's secret mix", builtIn: false }, { id: 'b', name: 'Flat', builtIn: true }], activeId: 'a', headroom: true, extras: { correction: false, filters: [], micBoost: 6, micRumble: true }, micFound: true, headsetModel: 'HS80', speakers: [{ guid: 'g', name: 'OLED', on: true }], notOn: [{ name: 'Headset Earphone (HS80)' }] },
    '/api/profiles': [{ name: "Zorblax's games", devices: { mouse: {}, headset: {} }, games: ['zorb.exe'], savedAt: '2026-10-19T05:31:30Z' }, { name: 'Work', devices: {}, monitors: { m: {} } }],
    '/api/settings': { autoSwitch: true, reportInstall: 'abcdef', user: 'zorblax' },
    '/api/backups': [{ name: 'mouse-2026-10-22T01-00-00-000Z.json', at: '2026-10-22T01:00:00Z' }, { name: 'mouse-2026-10-21T01-00-00-000Z.json', at: '2026-10-21T01:00:00Z' }, { name: 'openrgb-2026-10-23T02-29-54-233Z.json', at: '2026-10-23T02:29:54Z' }],
    '/api/setup': { found: { usb: 6, library: 1 }, works: [{ what: 'mouse', name: 'Pulsar X-Lite', state: 'ready', short: 'Ready.' }], installed: [{ name: 'Acme Glide', usb: '1234:abcd', state: 'needs-turn-on', short: 'Press Turn on settings.' }], optional: [], learn: [] },
    '/api/learn/state': { usbpcap: true, active: true, device: { vid: '1234', pid: 'ABCD', name: 'Acme Glide' }, listener: 'ready', listenerError: null, setting: { label: 'DPI', kind: 'number' }, takes: [{ value: 800, heard: 12 }, { value: 1600, heard: 14 }], learned: [{ label: 'Poll rate', kind: 'choice' }], maker: { known: true, name: 'Acme Hub', installed: true, running: true } },
    '/api/wallpapers': { dir: 'C:\\Users\\zorblax\\Pictures\\DeviceHub Wallpapers', items: [{ name: 'zorblax-wedding.jpg' }, { name: 'b.png' }], totalBytes: 2500000, windows: true, previousKept: true, previous: 'C:\\Users\\zorblax\\OneDrive\\Desktop\\x.jpg' },
    '/api/activity': [{ at: '2026-10-22T10:00:00Z', kind: 'bad', text: 'AOC AGON OLED: brightness not changed (no reply)' }, { at: '2026-10-22T10:01:00Z', kind: 'good', text: 'Profile applied' }, { at: '2026-10-22T10:02:00Z', kind: 'bad', text: 'Profile "x" failed on C:\\Users\\zorblax\\p.json' }],
    '/api/lights/diagnose': { board: 'B450 AORUS PRO WIFI', lines: ['- OpenRGB: 1.1, running'], problems: [{ problem: 'No fan lights found', why: 'The board drives them over SMBus.', fix: 'Press Add board, fan and RAM lights.' }] },
  };
  const gets = [];
  const adeps = { ...deps, get: async (p) => { gets.push(p); return API[p] ?? null; },
    log: async () => [...LOG, 'Error: monitor DDC/CI read failed for AOC AGON OLED', '[setup] could not install the library driver', 'Error: wallpaper set failed', 'Error: learn capture failed: USBPcap stopped', 'Error: profile apply failed', 'Error: backup restore failed', 'Error: eqapo config not written'] };
  const ctx = { page: 'Monitors', error: 'AGON: not changed: no reply from zorb.lax@gmail.com at 192.168.1.23', step: 'recording', progress: 'setting 2 of 3: DPI', heard: 'the last recording heard 12 messages', results: 'Poll rate: learned', item: 'Acme Glide', status: 'Press Turn on settings.', detail: 'x', bogus: 'not a key' };
  const WANT = {
    monitors: ['### Monitors and camera', 'Monitor: AOC AGON OLED (AG276QZD2): answers over DDC/CI; controls brightness, contrast, color balance', 'Old screen: no DDC/CI answer', 'Camera: Anker PowerConf C200: 2 picture settings', 'Recently (2026-10-22 10:00 UTC): AOC AGON OLED', 'monitor DDC/CI read failed', 'Old screen takes no settings from the PC'],
    fans: ['### Fans', 'Graphics card: NVIDIA GeForce RTX 4070: 36 °C', 'OpenRGB: 1.1, running', 'No fan lights found'],
    eq: ['### Sound and EQ', 'Device: Corsair', 'Engine: Equalizer APO', 'Presets: 2 (1 of your own); in use: one of your own', 'mic boost 6 dB', 'not switched on for: Headset Earphone (HS80)', 'Equalizer APO is not on for the headset', 'eqapo config not written'],
    profiles: ['### Profiles', 'Profiles: 2', 'Profile 1: mouse, headset; switches for 1 game', 'Profile 2: monitors', 'Switch profiles when games start: on', 'profile apply failed'],
    backups: ['### Backups', 'Copies: 3 in all', '- mouse: 2, newest 2026-10-22 01:00 UTC', '- openrgb: 1', 'backup restore failed'],
    setup: ['### Setup', 'Found: 6 USB devices, 1 library match', 'Items: 2, 1 not ready', 'Acme Glide (USB 1234:abcd): needs-turn-on, Press Turn on settings.', '- Device: Acme Glide (acme-mouse): missing'],
    learn: ['### Learn a device', 'USBPcap: installed', 'Device: Acme Glide (USB 1234:ABCD)', "Maker's app: Acme Hub, installed, open", 'Setting being learned: DPI (number)', 'Recordings: 800 (12 messages), 1600 (14 messages)', 'Learned so far: Poll rate (choice)', 'learn capture failed'],
    wallpapers: ['### Wallpapers', 'Pictures: 2 (2.5 MB)', 'can be set from here: yes', 'wallpaper set failed'],
  };
  for (const [area, want] of Object.entries(WANT)) {
    const dev = area === 'eq' ? 'headset' : area === 'setup' ? 'acme-mouse' : '';
    const st2 = { devices: [...STATE.devices, { id: 'headset', status: 'connected', adapter: { title: 'Corsair HS80' } }] };
    const rr = await report(dev, { ...adeps, get: async (p) => (p === '/api/agent/state' ? st2 : API[p] ?? null) }, { area, context: ctx });
    ok(rr.ok && rr.token, `${area}: a report is built (${rr.refused ? JSON.stringify(rr.refused) : ''})`);
    if (!rr.ok) continue;
    for (const w of want) ok(rr.body.includes(w) || rr.title.includes(w), `${area}: has "${w}"\n${rr.body}`);
    ok(rr.title.startsWith(`Help: ${want[0].slice(4)}`) && rr.title.length <= 120, `${area}: title (${rr.title})`);
    ok(rr.body.includes('### On the page') && rr.body.includes('- Page: Monitors') && rr.body.includes('- Step: recording') && rr.body.includes('- Heard so far: the last recording heard 12 messages') && !rr.body.includes('not a key'), `${area}: the page's context is in it, only the known keys`);
    ok(!/zorblax|zorb\.lax|gmail|192\.168|QUUXPC|3da353e|UID37121|3924ec|wedding|secret mix|zorb\.exe|reportInstall|abcdef/i.test(`${rr.title}\n${rr.body}`), `${area}: nothing personal in it:\n${rr.body}`);
    ok(findPersonal(`${rr.title}\n${rr.body}`, NAMES).length === 0, `${area}: passes the personal-data check`);
    ok(rr.canSend === false, `${area}: Send to Shawn is not offered where reports are not started (here)`);
    ok(new URL(rr.url).searchParams.get('body') === rr.body && rr.length <= MAX_URL, `${area}: the GitHub link is the same report, within the limit`);
  }
  ok(!gets.some((p) => !p.startsWith('/api/')), 'areas read only DeviceHub routes');
  // the device page and the Lighting page keep their own reports, with the page's context added
  const dr = await report('acme-mouse', adeps, { area: 'device', context: { page: 'Acme Glide', error: 'Acme Glide: DPI not changed', status: 'missing' } });
  ok(dr.ok && dr.title === 'Help: Acme Glide (1234:abcd), not connected' && dr.body.includes('- Shown on the page: Acme Glide: DPI not changed') && dr.body.includes('- Status shown: missing'), `device page: its own report plus the page's context\n${dr.body}`);
  const lr = await report('', { ...adeps, lights: async () => API['/api/lights/diagnose'] }, { area: 'lights', context: { page: 'Lighting' } });
  ok(lr.ok && lr.title.startsWith('Help: PC lights (B450') && lr.body.includes('- Page: Lighting'), `Lighting: the lights report plus the page (${lr.title})`);
  // an unknown area is a device report (or DeviceHub in general), never an error
  const ur = await report('', adeps, { area: 'nope', context: 'not an object' });
  ok(ur.ok && ur.title.startsWith('Help: DeviceHub') && !ur.body.includes('### On the page'), 'an unknown area and a bad context fall back to the general report');
  // the POST route
  let pr = null;
  await handle(new URL('http://127.0.0.1:5577/api/help/report'), { method: 'POST', socket: {} }, {}, (res, c, b) => { pr = { c, b }; }, async () => ({ id: 'nope-device', area: 'device', context: { page: 'x' } }));
  ok(pr && pr.c >= 400 && pr.b.error, `POST /api/help/report answers in place (${JSON.stringify(pr)})`);
} catch (e) {
  fails.push(`threw: ${e.stack || e}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// 31 Oct 2026 (an audit of what leaked): a user folder name with a space or an apostrophe, text cut short before the
// check, Bluetooth and &COLnn instance ids, a MAC written without colons
for (const [input, gone] of [
  ['C:\\Users\\Sam Smith\\Pictures\\Mum.jpg', /Smith|Mum/], ["C:\\Users\\O'Brien\\Pictures\\x.jpg", /Brien/], ["C:\\Users\\sam's files\\x", /files/],
  ['user someone.else@gma…', /someone|gma/], ['mac AA:BB:CC:DD:E…', /AA:BB/], ['ip 192.168.1.…', /192\.168/],
  ['BTHENUM\\{0000110e-0000-1000-8000-00805f9b34fb}_VID&0001004c_PID&2002\\7&1234abcd&0&A0B1C2D3E4F5_C00000000', /A0B1C2D3E4F5/],
  ['USB\\VID_046D&PID_C539&MI_00&COL01\\7&abc123&0&0000', /abc123/],
]) { const t = strip(input).text; ok(!gone.test(t) && !findPersonal(t).length, `scrubbed: ${input} -> ${t}`); }
ok(strip('C:\\Users\\Public\\Documents\\x.txt').text === 'C:\\Users\\Public\\Documents\\x.txt', 'the Public folder stays as it is');
// and the sentence after a bare user folder stays (a first try at the above ate it to the end of the line)
ok(strip('C:\\Users\\sam is missing and so is y').text === '%USERPROFILE% is missing and so is y', `the text after a user folder stays (${strip('C:\\Users\\sam is missing and so is y').text})`);
ok(/^%USERPROFILE% then error at D:\\games\\x$/.test(strip('C:\\Users\\sam then error at D:\\games\\x').text), 'a later path on the line stays');
ok(strip('version 1.2.… and 12:30:… ok').text === 'version 1.2.… and 12:30:… ok', 'a cut version number or time is not taken for an address');

if (fails.length) { console.log(`get-help: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exitCode = 1; }
else console.log('get-help: all checks passed (report built, personal data taken out or refused, link within the limit, opened only on request)');
