// helpers/diagnose.mjs (22 Oct 2026): why a device does not work, from fake inputs (tasklist text, USB lists, log
// lines, device states). No hardware, no DeviceHub running, nothing opened, closed or written.
// Run: node tests/diagnose.mjs
import { diagnose, analyze, parseTasklist, runningMakers, parseLog, deviceProfile, bluetoothMatch, action, MAKER_APPS } from '../helpers/diagnose.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const NOW = Date.parse('2026-10-22T12:00:00Z');

// ---- tasklist
const TASKS = ['"System Idle Process","0","Services","0","8 K"', '"iCUE.exe","4120","Console","1","210,000 K"', '"Corsair.Service.exe","3000","Services","0","50,000 K"',
  '"lghub_agent.exe","5120","Console","1","90,000 K"', '"lghub_updater.exe","5100","Services","0","9,000 K"', '"Pulsar.exe","7000","Console","1","80,000 K"',
  '"LightingService.exe","900","Services","0","20,000 K"', '"node.exe","1","Console","1","1 K"', ''].join('\r\n');
const images = parseTasklist(TASKS);
check(images.length === 8 && images.includes('iCUE.exe') && images.includes('Pulsar.exe'), `tasklist parsed (${images.join(', ')})`);
const makers = runningMakers(images);
const mk = (k) => makers.find((m) => m.key === k);
check(mk('icue') && mk('icue').images.join() === 'iCUE.exe', 'iCUE found (Corsair.Service is not iCUE)');
check(mk('ghub') && mk('ghub').closable.join() === 'lghub_agent.exe', 'G HUB found; its updater is never closed');
check(mk('armoury') && mk('armoury').closable.length === 0, "Armoury Crate's LightingService found but never closed (a service)");
check(mk('pulsar') && !mk('synapse') && !mk('gg'), 'Pulsar found; apps not running are not listed');
check(parseTasklist('').length === 0 && runningMakers([]).length === 0, 'empty tasklist -> nothing');
check(Object.keys(MAKER_APPS).length === 11, 'eleven makers known');

// ---- server.log
const LOG = [
  '[launcher] 10/20/2026 09:00:00 server exited with code 1; restart 1 of 5',          // over 24 h ago
  'DeviceHub on http://localhost:5577',
  '[helper] could not be built: csc.exe not found',                                      // an older run
  '[launcher] 10/22/2026 07:00:00 server exited with code -1; restart 1 of 5',          // a restart from outside
  '[launcher] 10/22/2026 08:00:00 server exited with code 3221225477; restart 1 of 5',  // a crash, today
  'DeviceHub on http://localhost:5577',
  '[agent] running',
  '[watchdog] 2026-10-22T11:40:00.000Z helper restarted: no heartbeat for 20 s (1 in the last hour)',
  '[watchdog] 2026-10-22T09:00:00.000Z helper restarted: no heartbeat (1 in the last hour)',   // over an hour ago
].join('\n');
const L = parseLog(LOG, NOW);
// the dates are local time; on any time zone the crash at 08:00 local on 22 Oct is within 24 h of noon UTC on 22 Oct
check(L.crashes.length === 1, `one crash today, the -1 restart and the old one not counted (${JSON.stringify(L.crashes)})`);
check(L.helperBuild === null, "an older run's build failure is history");
check(L.watchdog.length === 1 && /heartbeat/.test(L.watchdog[0].why), `one helper restart in the last hour (${JSON.stringify(L.watchdog)})`);
const L2 = parseLog('DeviceHub on http://localhost:5577\n[helper] could not be built: error CS0246: missing type\n[launcher] 10/22/2026 11:00:00 the new version stopped with code 1 on start; going back to abc', NOW);
check(L2.helperBuild === 'error CS0246: missing type' && L2.rollback?.code === 1, 'build failure in this run and an update rollback read');
check(parseLog('', NOW).crashes.length === 0, 'empty log -> nothing');

// ---- device states and profiles
const dev = (id, status, more = {}) => ({ id, status, info: {}, battery: null, values: {}, error: null, adapter: { id, title: { mouse: 'Pulsar X-Lite', headset: 'Corsair HS80', keyboard: 'Epomaker P75' }[id] || 'Thing', kind: { mouse: 'Mouse', headset: 'Headset', keyboard: 'Keyboard' }[id] || 'Light' }, ...more });
const state = (...devices) => () => ({ state: { devices }, ms: 40 });
const USB = (...ids) => () => ids.map((id) => ({ id }));
const none = () => '';
const base = (devices, extra = {}) => ({ state: state(...devices), tasklist: none, usb: USB(), log: () => '', specs: [], probe: () => { throw new Error('probe should not run'); }, bluetooth: () => [], now: () => NOW, ...extra });  // the log's fixed times are read against NOW, not the real clock
const first = async (id, deps) => (await diagnose(id, deps)).findings[0];

let f = await first('mouse', base([dev('mouse', 'missing')]));
check(f.code === 'unplugged' && /Pulsar 8K dongle is not plugged in/.test(f.problem) && f.action?.kind === 'retry', `mouse, no dongle on USB -> plug it in (${f.code}: ${f.problem})`);

f = await first('mouse', base([dev('mouse', 'missing')], { usb: USB('3710:5406'), tasklist: () => TASKS }));
check(f.code === 'maker-app' && f.problem === 'The Pulsar app is running' && f.action?.kind === 'close-app' && f.action.app === 'pulsar' && f.action.confirm, `mouse + Pulsar app -> close it, with a confirm (${f.code})`);

f = await first('headset', base([dev('headset', 'missing')], { usb: USB('1b1c:0a6b'), tasklist: () => TASKS }));
check(f.code === 'maker-app' && /through iCUE/.test(f.why), `headset + iCUE -> iCUE explained (${f.code}: ${f.why})`);

let r = await diagnose('headset', base([dev('headset', 'connected', { battery: { percent: 80, charging: false } })], { usb: USB('1b1c:0a6b'), tasklist: () => TASKS }));
check(r.findings.length === 1 && r.findings[0].code === 'none' && /looks fine/.test(r.findings[0].problem) && !r.findings[0].action, 'connected headset with iCUE open -> looks fine (no close offered)');

let probed = null;
f = await first('keyboard', base([dev('keyboard', 'missing')], { usb: USB('342d:e479'), specs: [{ id: 'keyboard', vid: '342D', pid: 'E479', page: 'FF60', usage: '0061' }], probe: (h) => { probed = h; return { err: 32 }; } }));
check(f.code === 'held' && /sharing violation/.test(f.why) && probed?.page === 'FF60', `keyboard plugged in, channel refused -> another program holds it (${f.code})`);

f = await first('keyboard', base([dev('keyboard', 'error', { error: 'open failed 5' })], { usb: USB('342d:e479') }));
check(f.code === 'held' && /access denied/.test(f.why), `an access-denied error text -> held (${f.code})`);

f = await first('keyboard', base([dev('keyboard', 'missing')], { usb: USB('342d:e479'), specs: [{ id: 'keyboard', vid: '342D', pid: 'E479', page: 'FF60', usage: '0061' }], probe: () => ({ err: 0 }) }));
check(f.code === 'not-opened', `keyboard plugged in, channel free -> press Connect (${f.code})`);

f = await first('mouse', base([dev('mouse', 'asleep', { error: 'mouse is asleep or out of range: move it and retry' })], { usb: USB('3710:5406') }));
check(f.code === 'asleep' && /dongle is plugged in/.test(f.why) && /Move it/.test(f.fix), `mouse asleep, dongle there -> move it (${f.code}: ${f.why})`);

f = await first('mouse', base([dev('mouse', 'missing')], { usb: USB('3710:5406'), specs: [{ id: 'mouse', vid: '3710', pid: '5406', page: 'FF02', usage: '0002', cablePid: '3506' }], probe: () => ({ err: 0 }) }));
check(f.code === 'off' && /out of range/.test(f.why), `mouse missing, dongle there, channel free -> switched off or out of range (${f.code})`);

f = await first('mouse', base([dev('mouse', 'missing', { battery: { percent: 4, charging: false } })], { usb: USB('3710:5406'), probe: () => ({ err: 0 }) }));
check(f.code === 'battery-low' && /4%/.test(f.problem), `mouse missing with 4% when last read -> charge it (${f.code})`);

f = await first('mouse', base([dev('mouse', 'missing', { adapter: { id: 'mouse', title: 'Pulsar X-Lite', kind: 'Mouse', trusted: { dpi: true, liftOff: false } } })], { usb: USB('3710:5406'), probe: () => ({ err: 0 }) }));
r = await diagnose('mouse', base([dev('mouse', 'connected', { adapter: { id: 'mouse', title: 'Pulsar X-Lite', kind: 'Mouse', trusted: { dpi: true, liftOff: false } } })], { usb: USB('3710:5406') }));
check(r.findings[0].code === 'locked' && /lift-off distance/i.test(r.findings[0].why), `a mouse setting that failed its check -> locked, in words (${r.findings[0].code})`);
r = await diagnose('mouse', base([dev('mouse', 'connected', { adapter: { id: 'mouse', title: 'Pulsar X-Lite', kind: 'Mouse', trusted: { btn0: false, btn2: true } } })], { usb: USB('3710:5406') }));
check(r.findings[0].code === 'none', 'left click (btn0, never written) locked -> not a problem');

// a device added on this PC, over Bluetooth
const thing = dev('thing', 'missing', { info: { Model: 'Acme Glow Bar' }, adapter: { id: 'thing', title: 'Acme Glow Bar', kind: 'Light', plugin: 'acme' } });
f = await first('thing', base([thing], { bluetooth: () => [{ name: 'Acme Glow Bar 2', connected: false }, { name: 'AirPods', connected: true }] }));
check(f.code === 'bt' && f.action?.kind === 'settings' && f.action.page === 'bluetooth', `paired but not connected -> Bluetooth settings (${f.code})`);
check(bluetoothMatch({ info: { Model: 'X' }, adapter: { title: 'Mouse' } }, [{ name: 'Mouse pad' }]) === null, 'short names never match Bluetooth devices');

// a LampArray light under Windows Dynamic Lighting
const lamp = dev('lamp', 'connected', { adapter: { id: 'lamp', title: 'Desk strip', kind: 'Light', plugin: 'strip' } });
r = await diagnose('lamp', base([lamp], { specs: [{ id: 'lamp', vid: '1234', pid: 'ABCD', page: '0059', usage: '0001' }], usb: USB('1234:abcd'), lampArrays: () => [{ vid: '1234', pid: 'ABCD' }], dynamicLighting: () => true }));
check(r.findings[0].code === 'dynamic-lighting' && r.findings[0].action?.page === 'lighting', `LampArray with Dynamic Lighting on -> turn it off for the device (${r.findings[0].code})`);
r = await diagnose('lamp', base([lamp], { specs: [{ id: 'lamp', vid: '1234', pid: 'ABCD' }], usb: USB('1234:abcd'), lampArrays: () => [{ vid: '1234', pid: 'ABCD' }], dynamicLighting: () => false }));
check(r.findings[0].code === 'none' && r.checked.includes('Windows Dynamic Lighting'), 'Dynamic Lighting off -> nothing, and said what was checked');

// DeviceHub itself
f = await first('mouse', base([], { state: () => ({ serverDown: true }) }));
check(f.code === 'server-down', 'server not answering -> start DeviceHub');
f = await first('mouse', base([], { state: () => ({ agentDown: true, ms: 10 }) }));
check(f.code === 'agent-down', 'agent not answering -> its background part');
f = await first('keyboard', base([dev('keyboard', 'connected')], { state: () => ({ state: { devices: [dev('keyboard', 'connected')] }, ms: 4200 }), usb: USB('342d:e479') }));
check(f.code === 'slow' && /4\.2 s/.test(f.why), `4.2 s to answer -> slow (${f.code})`);
f = await first('mouse', base([dev('mouse', 'missing')], { log: () => 'DeviceHub on http://localhost:5577\n[helper] could not be built: csc.exe exited with 1' }));
check(f.code === 'helper-build' && f.action?.kind === 'open-folder', `helper not built -> first, before the dongle (${f.code})`);
r = await diagnose('mouse', base([dev('mouse', 'missing')], { log: () => LOG, usb: USB() }));
check(r.findings.some((x) => x.code === 'crashes') && r.findings.some((x) => x.code === 'helper-restart') && r.findings[0].code === 'unplugged', 'crashes and helper restarts listed after the main cause');

// unknown device; nothing found
let threw = null;
try { await diagnose('nope', base([dev('mouse', 'missing')])); } catch (e) { threw = e; }
check(threw?.code === 404, 'unknown device -> 404');
r = await diagnose('keyboard', base([dev('keyboard', 'missing')], { usb: () => null, tasklist: () => null }));
check(r.findings[0].code === 'none' && /Checked: /.test(r.findings[0].why) && r.findings[0].action?.kind === 'retry', `nothing found -> says what was checked (${r.findings[0].why})`);

// the probe never runs while a maker's app explains it, or while the device is connected / asleep
await diagnose('mouse', base([dev('mouse', 'missing')], { usb: USB('3710:5406'), tasklist: () => TASKS, specs: [{ id: 'mouse', vid: '3710', pid: '5406', page: 'FF02', usage: '0002' }] }));
await diagnose('mouse', base([dev('mouse', 'asleep')], { usb: USB('3710:5406'), specs: [{ id: 'mouse', vid: '3710', pid: '5406', page: 'FF02', usage: '0002' }] }));
check(true, 'probe not run (it throws if it is)');

// library driver read-only (analyze directly: the facts libraryFacts reads from my-devices/<name>)
r = analyze({ snap: dev('thing', 'connected'), profile: { usb: [], vids: [] }, library: { status: 'read-only', readOnly: [{ label: 'Brightness', why: 'not checked yet' }] } });
check(r.findings[0].code === 'read-only' && /"read-only"/.test(r.findings[0].why), 'library driver not checked yet -> read-only until its check');
r = analyze({ snap: dev('thing', 'connected'), profile: { usb: [], vids: [] }, library: { status: 'tested', readOnly: [{ label: 'Effect', why: 'it read back 2 after writing 3', failed: true }] } });
check(r.findings[0].code === 'read-only' && /read back 2/.test(r.findings[0].why) && r.findings[0].action?.kind === 'check-again', 'a failed self-check -> why, and a Check again button');
r = analyze({ snap: dev('thing', 'connected'), profile: { usb: [], vids: [] }, library: { status: 'read-only', readOnly: [{ label: 'DPI', why: 'the mouse is using its onboard profiles', waiting: true }] } });
check(r.findings[0].code === 'read-only' && /could not be checked yet: the mouse is using its onboard/.test(r.findings[0].why) && r.findings[0].action?.kind === 'check-again', 'a waiting setting -> why, and a Check again button');
// safety round 2: a driver waiting for Turn on settings says so and offers the button; unchecked + connected = Check again
// the check waits on the maker's app (23 Oct 2026, a friend's Logitech mouse: 9 settings, "press Check again" while G HUB
// held it): the fix is closing that app, by its name or process name
r = analyze({ snap: dev('thing', 'connected'), profile: { usb: [], vids: [] }, library: { status: 'read-only', readOnly: [{ label: 'Lift-off distance', why: "lghub.exe (the maker's app) is open, so nothing was written; it runs on a later connect once that app is closed", waiting: true }] } });
check(r.findings[0].action?.kind === 'close-app' && r.findings[0].action.app === 'ghub' && /Close Logitech G HUB/.test(r.findings[0].fix), `waiting on G HUB -> Close Logitech G HUB (${JSON.stringify(r.findings[0])})`);
r = analyze({ snap: dev('thing', 'connected'), profile: { usb: [], vids: [] }, library: { status: 'untested', turnOn: true, readOnly: [{ label: 'Brightness', why: 'not checked yet' }] } });
check(r.findings[0].code === 'read-only' && r.findings[0].action?.kind === 'turn-on' && /current value back once/.test(r.findings[0].fix || JSON.stringify(r.findings[0])), `waiting for its click -> Turn on settings (${JSON.stringify(r.findings[0])})`);
r = analyze({ snap: dev('thing', 'connected'), profile: { usb: [], vids: [] }, library: { status: 'read-only', readOnly: [{ label: 'Brightness', why: 'not checked yet' }] } });
check(r.findings[0].action?.kind === 'check-again', 'connected with an unchecked setting -> Check again');
r = analyze({ snap: dev('thing', 'missing'), profile: { usb: [], vids: [] }, library: { status: 'tested', readOnly: [{ label: 'Effect', why: 'x', failed: true }] } });
check(r.findings.find((x) => x.code === 'read-only')?.action?.kind === 'retry', 'not connected: Connect, not Check again');

// profiles: another VIA keyboard; the generic headset
const p = deviceProfile(dev('keyboard', 'missing'), [{ id: 'keyboard', vid: '3434', pid: '0361', page: 'FF60', usage: '0061', productName: 'Keychron Q1' }]);
check(p.usb.length === 1 && p.usb[0].id === '3434:0361' && p.hid.vid === '3434', `another VIA keyboard -> its own ids (${JSON.stringify(p.usb)})`);
check(deviceProfile(dev('headset', 'missing', { adapter: { kind: 'Headset', mode: 'generic' } })).usb.length === 0, 'a generic USB headset has no known ids');

// 22 Oct 2026 (Dsmjr2/DeviceHub-support#2): a library driver with many product ids (the Logitech mouse: receivers and
// cables). Only its first id, C539, was listed, so a mouse driver working through a Bolt receiver read "not plugged in".
{
  const logiSpecs = [{ id: 'logitech-hidpp-mouse', vid: '046D', pid: 'C539', page: 'FF00', usage: '0002', pids: ['C539', 'C53A', 'C548', 'C094', 'C09B'] }];
  const logi = (status, more = {}) => dev('logitech-hidpp-mouse', status, { ...more, adapter: { id: 'logitech-hidpp-mouse', title: 'Logitech mouse', kind: 'Mouse', plugin: 'logitech-hidpp-mouse', ...(more.adapter || {}) } });
  const lp = deviceProfile(logi('missing'), logiSpecs);
  check(lp.usb.map((u) => u.id).join() === '046d:c539,046d:c53a,046d:c548,046d:c094,046d:c09b', `every id of a many-id driver is listed (${lp.usb.map((u) => u.id)})`);
  const lv = deviceProfile(logi('asleep', { adapter: { usbId: '046d:c548' } }), logiSpecs);
  check(lv.usb[0].id === '046d:c548' && /connected through/.test(lv.usb[0].label) && lv.usb.filter((u) => u.id === '046d:c548').length === 1 && lv.hid.pid === 'C548', `the id it is connected through comes first, once (${JSON.stringify(lv.usb[0])}, hid ${lv.hid.pid})`);
  // the report's case: the driver connected through a Bolt receiver (C548): not "not plugged in"
  let rr = await diagnose('logitech-hidpp-mouse', base([logi('error', { error: 'this Logitech device has no DPI feature (0x2201): it is not a mouse this driver runs' })], { usb: USB('046d:c548'), specs: logiSpecs, probe: () => ({ err: 0 }) }));
  check(!rr.findings.some((x) => x.code === 'unplugged'), `plugged in through another of its ids: not "not plugged in" (${rr.findings.map((x) => x.code)})`);
  // stepped aside: the plain not-mine finding first, nothing about plugs, no open-and-close probe
  rr = await diagnose('logitech-hidpp-mouse', base([logi('missing', { adapter: { notMine: 'the Logitech device on receiver C539 (slot 1) is a keyboard, not a mouse this driver runs: the mouse driver leaves it alone', usbId: '046d:c539' } })], { usb: USB('046d:c539'), specs: logiSpecs }));
  check(rr.findings[0].code === 'not-mine' && /keyboard/.test(rr.findings[0].why) && /Nothing is wrong/.test(rr.findings[0].fix), `a stepped-aside driver: not-mine first (${rr.findings.map((x) => x.code)})`);
  check(!rr.findings.some((x) => ['unplugged', 'off', 'not-opened', 'error'].includes(x.code)), `and no plug, off or error finding (${rr.findings.map((x) => x.code)})`);
  rr = await diagnose('logitech-hidpp-mouse', base([logi('missing', { adapter: { notMine: 'x is a keyboard', usbId: '046d:c539' } })], { usb: USB(), specs: logiSpecs }));
  check(rr.findings[0].code === 'not-mine' && !rr.findings.some((x) => x.code === 'unplugged'), 'stepped aside, then unplugged since: still the plain finding, no plug alarm');
  // asleep at connect through a receiver
  rr = await diagnose('logitech-hidpp-mouse', base([logi('asleep', { adapter: { usbId: '046d:c539' } })], { usb: USB('046d:c539'), specs: logiSpecs }));
  check(rr.findings[0].code === 'asleep' && /connected through is plugged in/.test(rr.findings[0].why), `asleep on its receiver: asleep, the receiver named as plugged in (${rr.findings[0].why})`);
  // none of many ids plugged in: one plain sentence, not five labels
  rr = await diagnose('logitech-hidpp-mouse', base([logi('missing')], { usb: USB(), specs: logiSpecs }));
  const un = rr.findings.find((x) => x.code === 'unplugged');
  check(un && /none of the 5 USB ids/.test(un.why) && (un.why.match(/receiver or cable/g) || []).length === 1, `nothing plugged in: one sentence (${un?.why})`);
}

// every finding: one problem, one why, one fix, and only the four kinds of action
for (const x of [...(await diagnose('mouse', base([dev('mouse', 'missing')], { usb: USB('3710:5406'), tasklist: () => TASKS, log: () => LOG }))).findings]) {
  check(x.problem && x.why && x.fix && (!x.action || ['settings', 'retry', 'close-app', 'open-folder'].includes(x.action.kind)), `finding shape: ${JSON.stringify(x)}`);
}

// actions refuse what they must (nothing is started, closed or opened by these)
const refuses = async (b, re) => { try { await action(b); return false; } catch (e) { return re.test(e.message); } };
check(await refuses({ kind: 'close-app', app: 'icue' }, /confirm/), 'closing an app without the confirm click is refused');
check(await refuses({ kind: 'close-app', app: 'explorer', confirm: true }, /unknown app/), 'only a known maker app can be closed');
check(await refuses({ kind: 'settings', page: 'ms-settings:windowsupdate' }, /unknown settings page/), 'only the listed Settings pages open');
check(await refuses({ kind: 'format' }, /unknown action/), 'an unknown action is refused');

console.log(fails.length ? `diagnose: FAILED: ${fails.join('; ')}` : 'diagnose (fake inputs): all good');
process.exit(fails.length ? 1 : 0);
