// Learn a device, streamlined (30 Oct 2026, Shawn after a friend's PC: "the learn a device area is a mess and confusing"):
// one Learn it button per device that can be learned, which starts at once (no separate checks step, no step numbers);
// devices that already work are one line of links to their pages, not a list of fixes; the rest folded away; a failed
// check shows only the failing lines with their fixes; a capture driver never tested is not a stop of its own.
// Run: node tests/learn-page.mjs (no device needed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
// plain line endings: the checks below match "\n", which a CRLF file never has (3 Nov 2026)
const src = (f) => fs.readFileSync(path.join(REAL, f), 'utf8').replace(/\r\n/g, '\n');
const page = src('public/pages/learn.js');
const code = page.replace(/\/\/.*$/gm, '');

const pick = code.slice(code.indexOf('function pickStep()'), code.indexOf('function runningCopy('));
ok(/button\(st\.busy \? 'Starting…' : 'Learn it', \(\) => startAuto\(d\)/.test(pick), 'a device that can be learned has one Learn it button, which starts learning');
ok(!/Choose the settings'|Learn it for me'|Test my learning setup|stepNo|nextStep|USB \$\{d\.vid\}|settings channel/.test(pick), 'no second button, checks button, step number, device-page fixes, USB id or "settings channel" on the list');
ok(/'Already working'/.test(pick) && /h\('a', \{ href:/.test(pick) && /A setting is missing on one of these\?/.test(pick), 'what already works: links to their pages; a missing setting is folded away');
ok(/Other USB devices \(\$\{cannot\.length\}\): can't be learned/.test(pick) && /h\('details'/.test(pick), 'what cannot be learned is folded away');
ok(/st\.autoStart && wanted[\s\S]{0,140}startAuto\(wanted\)/.test(pick), "Setup's Learn it for me starts at once");
ok(!/preflightStep|stepNo\(|Step \$\{/.test(code), 'no checks step and no step numbers anywhere');

const failed = code.slice(code.indexOf("if (a.phase === 'failed' || a.phase === 'stopped' || a.phase === 'idle')"), code.indexOf("const now = ask?.kind === 'change'"));
ok(/const bad = \(a\.preflight\?\.lines \|\| \[\]\)\.filter\(\(x\) => !x\.ok\)/.test(failed) && /pfLines\(bad, d,/.test(failed), 'a failed check shows only its failing lines, each with its fix');
ok(/unknownApp \? 'primary' : 'ghost small'/.test(failed), "an app DeviceHub does not know: Choose the settings myself is the next step");

// 2 Nov 2026: A setting is missing? never saves (or installs a library driver) by itself; a Save button on the Sent step does
const runItemSrc = code.slice(code.indexOf('async function runItem()'), code.indexOf('function changeOf('));
const analyzeSrc = code.slice(code.indexOf('async function analyzeQueued('), code.indexOf("st.step = 'found'; st.found = null;"));
ok(runItemSrc.length > 100 && !/'save'/.test(runItemSrc) && /sendToShawn\(/.test(runItemSrc), 'when recording ends nothing is saved by itself; the recordings still go to Shawn');
ok(analyzeSrc.length > 100 && !/'save'/.test(analyzeSrc), 'what is learned is only added to the draft, never saved, while recording');
ok((code.match(/run\('save'/g) || []).length === 3 && /function saveStep\(\)[\s\S]{0,400}button\(st\.busy \? 'Saving…' : 'Save', \(\) => run\('save'/.test(code), 'the only saves are the person\'s buttons: Save the driver, Add USB id, and Save on the Sent step');
ok(/function sentStep\(\)[\s\S]{0,400}saveStep\(\)/.test(code), 'the Sent step shows the Save step');
{
  const fn = code.slice(code.indexOf('export function saveLine('), code.indexOf('function saveStep('));
  const saveLine = new Function(`${fn.replace('export ', '')}; return saveLine;`)();
  const base = { device: { name: 'Kite mouse' }, learned: [{ label: 'Lights' }], addsTo: { name: 'kite-mouse', where: 'my-devices' } };
  const l1 = saveLine(base);
  ok(/^Add Lights to Kite mouse\? Nothing is added until you press Save\. It stays read-only until you press Turn on settings/.test(l1 || ''), `the Save step says what is added and to which device (${l1})`);
  const l2 = saveLine({ ...base, learned: [{ label: 'Lights' }, { label: 'Sleep' }], addsTo: { name: 'corsair-bragi-peripherals', where: 'library' } });
  ok(/Add Lights and Sleep to Kite mouse\? DeviceHub also sets up its driver \(corsair-bragi-peripherals\) from the device library\./.test(l2 || ''), `and that a library driver is set up too (${l2})`);
  ok(saveLine({ ...base, saved: { added: ['lights'] } }) === null && saveLine({ ...base, learned: [] }) === null && saveLine({ ...base, addsTo: null }) === null, 'no Save step once saved, with nothing learned, or with no driver to add to');
}

const lw = src('helpers/learn-wizard.mjs');
ok(/const failed = !!last && !last\.ok;/.test(lw) && /line\('capture', has && !failed,/.test(lw), 'a capture driver never tested is not a stop; one that failed its test is');
const la = src('helpers/learn-auto.mjs');
ok(/say\(r, 'Listening\.'\);\n[^\n]*\n\s*try \{ lw\.options\.deps\.saveCheck\?\.\(lw\.options\.root, \{ ok: true/.test(la), 'listening for a session counts as a passed test');

if (fails.length) { console.log(`learn-page: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('learn-page (one Learn it button, nothing else to choose first, failing checks only with their fixes): all good');
