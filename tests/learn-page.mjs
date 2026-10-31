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
const src = (f) => fs.readFileSync(path.join(REAL, f), 'utf8');
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

const lw = src('helpers/learn-wizard.mjs');
ok(/const failed = !!last && !last\.ok;/.test(lw) && /line\('capture', has && !failed,/.test(lw), 'a capture driver never tested is not a stop; one that failed its test is');
const la = src('helpers/learn-auto.mjs');
ok(/say\(r, 'Listening\.'\);\n[^\n]*\n\s*try \{ lw\.options\.deps\.saveCheck\?\.\(lw\.options\.root, \{ ok: true/.test(la), 'listening for a session counts as a passed test');

if (fails.length) { console.log(`learn-page: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('learn-page (one Learn it button, nothing else to choose first, failing checks only with their fixes): all good');
