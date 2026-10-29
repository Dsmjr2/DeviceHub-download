// A friend's copy (29 Oct 2026): the same Pulsar mouse on Pulsar's other dongle (3710:5403) was never opened, and one
// Arctis Nova 3 showed as two headsets (the Headset page's Windows sound side and its SteelSeries driver), with the
// laptop's speakers looking like a third. Run: node tests/same-headset.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// ---- the mouse: the other dongle is tried after the 8K one, and found again after the cable
const host = fs.readFileSync(new URL('../helpers/hid-host.mjs', import.meta.url), 'utf8');
check(/dongles: \['5403'\]/.test(host), 'the mouse spec lists the other Pulsar dongle');
check(/\[this\.spec\.cablePid, this\.spec\.pid, \.\.\.\(this\.spec\.dongles \|\| \[\]\)\]/.test(host), 'opening tries the cable, the 8K dongle, then the others');
check(/for \(const pid of \[this\.dongle, s\.pid, \.\.\.\(s\.dongles \|\| \[\]\)\]/.test(host), 'off the cable it goes back to the dongle it was found on');
check(/'3710:5403': 'Mouse page/.test(fs.readFileSync(new URL('../helpers/pc-map.js', import.meta.url), 'utf8')), 'the PC map says DeviceHub runs it (no second driver offered)');
const pulsar = fs.readFileSync(new URL('../public/devices/mouse-adapter.js', import.meta.url), 'utf8');
check(/did not read back cleanly, so writing it is blocked/.test(pulsar), 'a value that did not read back cleanly is never written (a dongle that talks differently stays read-only)');

// ---- one headset: the driver that runs the Headset page's USB headset is its twin and is shown once
const D = await import('../public/core/devices.js');
const put = (id, d) => { D.devices[id] = { id, status: 'connected', values: {}, ...d }; };
put('headset', { adapter: { id: 'headset', mode: 'generic', generic: { usb: 'USB\\VID_1038&PID_12EC\\8&1A2B', device: '2- Arctis Nova 3' } } });
put('steelseries-arctis', { adapter: { id: 'steelseries-arctis', plugin: 'steelseries-arctis', kind: 'Headset', title: 'SteelSeries Arctis', usbIds: ['1038:12ec', '1038:12ee'] } });
put('logi-mouse', { adapter: { id: 'logi-mouse', plugin: 'logi', kind: 'Mouse', title: 'Logitech mouse', usbIds: ['1038:12ec'] } });
check(D.headsetTwin()?.id === 'steelseries-arctis', 'the SteelSeries driver on the same USB id is the twin');
let shown = D.shownDevices().map((d) => d.id);
check(shown.includes('headset') && !shown.includes('steelseries-arctis') && shown.includes('logi-mouse'), `shown once (${shown})`);
D.devices['steelseries-arctis'].adapter.usbIds = ['1038:2202'];
check(D.headsetTwin() === null && D.shownDevices().some((d) => d.id === 'steelseries-arctis'), 'another SteelSeries headset is not hidden');
D.devices['steelseries-arctis'].adapter.usbId = '1038:12EC';
check(D.headsetTwin()?.id === 'steelseries-arctis', 'the USB id it is connected through counts too');
D.devices.headset.adapter.mode = 'direct';
check(D.headsetTwin() === null, 'the HS80 page has no twin');
const page = fs.readFileSync(new URL('../public/pages/headset.js', import.meta.url), 'utf8');
check(/twinSettingsCard\(own, redraw\)/.test(page) && /get watches\(\)/.test(page), 'the Headset page shows the twin\'s settings and redraws on its changes');
check(/meta\.usbIds = /.test(fs.readFileSync(new URL('../helpers/agent.mjs', import.meta.url), 'utf8')), 'the agent sends each driver\'s USB ids');

// ---- the laptop's speakers are named as speakers, not as a headset
const { wiredHeadsets } = createRequire(import.meta.url)('../helpers/wired-headsets.js');
const w = wiredHeadsets([{ flow: 'playback', id: 'a', name: 'Speakers (Realtek(R) Audio)' }, { flow: 'playback', id: 'b', name: 'Headphones (Realtek(R) Audio)' }], []);
check(w[0].device === 'PC speakers or jack' && w[1].device === 'Headphones (Realtek(R) Audio)', `speakers named plainly (${w.map((x) => x.device)})`);
const named = wiredHeadsets([{ flow: 'playback', id: 'a', name: 'Speakers (Realtek(R) Audio)' }], [], { [w[0].usb]: 'Audio-Technica' });
check(named[0].device === 'Audio-Technica', 'a name the person gave still wins');

// ---- a setting the model does not have is not a self-check failure (the Nova 3 has no sidetone; his copy filed
// "SteelSeries Arctis: its driver self-check failed" by itself)
const MD = await import('../helpers/my-devices.mjs');
const nova3 = { id: 'steelseries-arctis-test', title: 'SteelSeries Arctis', kind: 'Headset', settings: [{ key: 'sidetone', label: 'Sidetone', type: 'slider', min: 0, max: 3 }],
  async info() { return { Model: 'Arctis Nova 3' }; }, async read() { return {}; }, async write() { throw new Error('nothing should be written'); } };
const sc = await MD.selfCheck(nova3, nova3.write, { backup: async () => {}, makerApp: async () => ({}) });
check(sc.ran && sc.counts.failed === 0 && sc.counts.checked === 0 && sc.keys.sidetone?.skip === true, `a setting the model does not report is skipped (${JSON.stringify(sc.counts)})`);

if (fails.length) { console.log(`same-headset: ${fails.length} FAILED\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('same-headset (other Pulsar dongle, one headset shown once, speakers named plainly): all good');
