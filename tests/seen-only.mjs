// Rows tied to one device or its maker's app show only when this PC has that device (22 Oct 2026, Shawn: "I also dont
// want my devices like icue etc if there is no device that uses that"): Settings > Device firmware has a row per
// built-in device this PC has had (core/firmware-parts.js on core/devices.js shownDevices()), and none at all on a PC
// with none of them; the Get help picker lists only those devices. Pure function plus a read of the page's source.
// Run: node tests/seen-only.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { firmwareParts } = await import(pathToFileURL(path.join(ROOT, 'public/core/firmware-parts.js')).href);
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

check(firmwareParts([]).length === 0, 'nothing seen: no Device firmware rows at all');
check(firmwareParts(null).length === 0, 'no list yet: no rows');
const HS = { id: 'headset', adapter: { title: 'Corsair HS80' } }, P75 = { id: 'keyboard', adapter: { title: 'Epomaker P75' } };
check(firmwareParts([HS]).join() === 'headset', 'only the headset seen: only its iCUE row');
check(firmwareParts([{ id: 'headset', adapter: { title: 'HyperX Cloud II Wireless' } }, { id: 'keyboard', adapter: { title: 'Keychron Q1' } }]).length === 0, "another headset or VIA keyboard in the built-in slots: none of Shawn's firmware rows");
check(firmwareParts([{ id: 'demo-razer' }, P75]).join() === 'keyboard', 'an added device does not bring a built-in row');
check(firmwareParts([P75, { id: 'mouse' }, HS]).join() === 'mouse,headset,keyboard', "Shawn's PC (all three seen): all three rows, in their usual order");

const src = fs.readFileSync(path.join(ROOT, 'public/pages/settings.js'), 'utf8');
const fw = src.slice(src.indexOf('function updatesRows'), src.indexOf('// Health'));
check(/firmwareParts\(shownDevices\(\)\)/.test(fw) && /if \(!parts\.length\) return \[\];/.test(fw), 'Settings: Device firmware asks which devices this PC has, and goes with none');
for (const [id, word] of [['mouse', 'Pulsar app'], ['headset', 'iCUE'], ['keyboard', 'Epomaker']]) {
  check(new RegExp(`!parts\\.includes\\('${id}'\\) \\? null : row\\(`).test(fw) && fw.includes(word), `Settings: the ${word} row only with the ${id}`);
}
check(/shownDevices\(\)\.filter\(\(d\) => d\?\.adapter\)/.test(src) && !/Object\.values\(devices\)\.filter\(\(d\) => d\?\.adapter\)\.map\(\(d\) => h\('option'/.test(src), 'Get help lists only the devices this PC has');

if (fails.length) { console.log(`seen only: ${fails.length} failed:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('seen only: all good');
