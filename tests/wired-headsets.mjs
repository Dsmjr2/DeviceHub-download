// Wired headsets on the PC's jack (22 Oct 2026; helpers/wired-headsets.js, public/core/headset-pick.js): offered as a
// choice, never taken by themselves, named as the person likes. Run: node tests/wired-headsets.mjs (no Windows needed)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { wiredHeadsets, keyOf, isJack } = require('../helpers/wired-headsets.js');
const { cleanPick, genericFor, chosenOther, headsetChoices } = await import('../public/core/headset-pick.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const E = (flow, id, name) => ({ flow, id, name });
const all = [
  E('playback', '{0.0.0.00000000}.{aaa}', 'Headphones (Realtek(R) Audio)'),
  E('playback', '{0.0.0.00000000}.{bbb}', 'Speakers (Realtek(R) Audio)'),
  E('playback', '{0.0.0.00000000}.{ccc}', 'AG276QZD2 (NVIDIA High Definition Audio)'),
  E('playback', '{0.0.0.00000000}.{ddd}', 'Realtek Digital Output (Realtek(R) Audio)'),
  E('playback', '{0.0.0.00000000}.{usb}', 'Headset Earphone (CORSAIR HS80 RGB Wireless Gaming Receiver)'),
  E('recording', '{0.0.1.00000000}.{mic}', 'Microphone (Realtek(R) Audio)'),
  E('recording', '{0.0.1.00000000}.{mix}', 'Stereo Mix (Realtek(R) Audio)'),
  E('recording', '{0.0.1.00000000}.{cam}', 'CameraMic (Anker PowerConf C200)'),
];
let w = wiredHeadsets(all, ['{0.0.0.00000000}.{usb}', '{0.0.1.00000000}.{cam}']);
check(w.length === 2 && w.every((x) => isJack(x.usb)), `the two Realtek jacks, not the monitor, the digital out or the USB headset (${w.map((x) => x.device).join(', ')})`);
const hp = w.find((x) => /Headphones/.test(x.device));
check(hp && hp.recording.length === 1 && /Microphone/.test(hp.recording[0].name), 'its mic is the same sound card\'s, never Stereo Mix or the webcam');
check(keyOf('{0.0.0.00000000}.{aaa}') === hp.usb && /^JACK_[0-9A-F]{8}$/.test(hp.usb), 'a stable JACK_ key from Windows\' id');
w = wiredHeadsets(all, ['{0.0.0.00000000}.{usb}'], { [hp.usb]: 'Audio-Technica ATH-M50x' });
check(w.some((x) => x.device === 'Audio-Technica ATH-M50x'), 'the name the person gave it');
check(cleanPick(hp.usb) === hp.usb && cleanPick('JACK_12') === null && cleanPick('jack_0000abcd') === 'JACK_0000ABCD', 'the picker accepts JACK_ keys, and nothing malformed');
const list = [...w];
check(genericFor(list, null) === null, 'with nothing picked, wired speakers or headphones are never taken for a headset');
check(genericFor(list, hp.usb)?.usb === hp.usb && chosenOther(list, hp.usb)?.usb === hp.usb, 'picked: the wired headset runs');
const usbHs = { usb: 'VID_1038&PID_12E0', device: 'Arctis Nova 7', playback: [{ id: 'x' }], recording: [] };
check(genericFor([...list, usbHs], null)?.usb === 'VID_1038&PID_12E0', 'a USB headset still comes first with nothing picked');
const choices = headsetChoices([...list, usbHs], { hs80: true });
check(choices[0].key === 'hs80' && choices.some((c) => c.key === hp.usb), 'the wired one is a choice beside the HS80');
// the HS80's sidetone is never read or set for a wired headset, and the EQ does not take one by itself
const adapter = fs.readFileSync(new URL('../public/devices/headset-adapter.js', import.meta.url), 'utf8');
check(/isJack\(generic\.usb\)\) \{ sidetone = null; return; \}/.test(adapter) && /a wired headset has no sidetone control/.test(adapter), 'no sidetone for a wired headset');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
check(/!\/\^JACK_\/\.test\(x\.usb\)/.test(server), 'the EQ never takes a wired headset unless it is picked');
if (fails.length) { console.log(`wired-headsets: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('wired-headsets (a headset on the PC\'s jack): all good');
