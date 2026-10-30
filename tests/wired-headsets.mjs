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
// one headset over Bluetooth (29 Oct 2026): its music and call sound devices are one headset, folded into the same
// headset on USB when it is on both, and never listed as a jack
{
  const { bluetoothHeadsets, foldBluetooth } = require('../helpers/wired-headsets.js');
  const bt = [
    E('playback', 'b1', 'Headphones (Arctis Nova 3P)'),
    E('playback', 'b2', 'Headset (Arctis Nova 3P Hands-Free AG Audio)'),
    E('recording', 'b3', 'Headset (Arctis Nova 3P Hands-Free AG Audio)'),
    E('playback', 'b4', 'Headphones (WH-1000XM4)'),
    E('playback', 'b5', 'Headset (WH-1000XM4 Hands-Free)'),
    E('recording', 'b6', 'Headset (WH-1000XM4 Hands-Free)'),
  ];
  const ids = bt.map((e) => e.id);
  const everything = [...all, ...bt];
  const jacks = wiredHeadsets(everything, ['{0.0.0.00000000}.{usb}'], {}, ids);
  check(jacks.length === 2 && !jacks.some((x) => /Arctis|WH-1000/.test(x.device)), `Bluetooth sound devices are not jacks (${jacks.map((x) => x.device)})`);
  const b = bluetoothHeadsets(everything, new Set(ids), {});
  const nova = b.find((x) => x.device === 'Arctis Nova 3P'), sony = b.find((x) => x.device === 'WH-1000XM4');
  check(b.length === 2 && nova && sony, `two Bluetooth headsets, one each, named as the headset (${b.map((x) => x.device)})`);
  check(nova.playback[0].id === 'b1' && nova.playback.length === 2 && nova.recording.map((m) => m.id).join() === 'b3', 'the stereo output first, then hands-free; the hands-free mic');
  check(isJack(nova.usb) && nova.bluetooth === true && nova.usb === bluetoothHeadsets(everything, new Set(ids), {})[0].usb, 'a stable key the picker accepts');
  const usbNova = { usb: 'VID_1038&PID_2269', device: 'Arctis Nova 3P Wireless', playback: [{ id: 'u1' }], recording: [] };
  const hs80 = { usb: 'VID_1B1C&PID_0A6B', device: 'CORSAIR HS80 RGB Wireless Gaming Receiver', playback: [{ id: 'u2' }], recording: [] };
  const folded = foldBluetooth([usbNova, hs80], b);
  check(folded.headsets.length === 2 && folded.headsets[0].bluetooth?.playback?.length === 2 && !folded.headsets[1].bluetooth, 'the Nova on its dongle gets its Bluetooth side; the HS80 does not');
  check(folded.bluetooth.length === 1 && folded.bluetooth[0].device === 'WH-1000XM4', 'a headset on Bluetooth only stays a choice of its own');
  check(!usbNova.bluetooth, 'the USB list given in is not changed');
  const named = bluetoothHeadsets(everything, new Set(ids), { [sony.usb]: 'Sony headphones' });
  check(named.some((x) => x.device === 'Sony headphones'), 'the name the person gave it');
  const corsair = fs.readFileSync(new URL('../helpers/corsair.js', import.meta.url), 'utf8');
  check(/op: 'hs80-endpoints', usb: 'BTH' \}/.test(corsair) && /foldBluetooth\(usbList/.test(corsair), "the headset list asks Windows which sound devices are on Bluetooth (the helper's own list, no new program)");
}
if (fails.length) { console.log(`wired-headsets: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('wired-headsets (a headset on the PC\'s jack): all good');
