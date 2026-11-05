// A failed read never writes (5 Nov 2026, the Manager's audit after a Misc script took "could not read" as "empty" and
// wrote back only its own part): helpers/safe-write.js readJsonForWrite gives the default only for a missing file and
// throws for one that is empty, damaged or held, and the files DeviceHub changes in place keep every entry when their
// read fails. No devices, no network: part of npm run test:offline.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { readJsonForWrite } = require('../helpers/safe-write.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-failed-read-'));
const at = (n) => path.join(tmp, n);
try {
  // the strict read itself
  check(JSON.stringify(readJsonForWrite(at('none.json'), { a: 1 })) === '{"a":1}', 'a missing file did not give the default');
  fs.writeFileSync(at('empty.json'), '');
  check(throws(() => readJsonForWrite(at('empty.json'), {})), 'an empty file was read as the default');
  fs.writeFileSync(at('blank.json'), '  \r\n');
  check(throws(() => readJsonForWrite(at('blank.json'), {})), 'a blank file was read as the default');
  fs.writeFileSync(at('bad.json'), '{"keep": tru');
  check(throws(() => readJsonForWrite(at('bad.json'), {})), 'a damaged file was read as the default');
  fs.writeFileSync(at('bom.json'), '﻿{"keep": true}');
  check(readJsonForWrite(at('bom.json'), {})?.keep === true, 'a file with a byte-order mark did not read');
  fs.mkdirSync(at('dir.json'));
  check(throws(() => readJsonForWrite(at('dir.json'), {})), 'a path that cannot be read as a file gave the default');

  // write-only settings: a damaged trust record is never written over by the next trust() or remember()
  const { writeOnlyStore, TRUST_FILE, LAST_FILE } = await import('../helpers/write-only.mjs');
  const root = at('root'); fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const trustF = path.join(root, 'data', TRUST_FILE), lastF = path.join(root, 'data', LAST_FILE);
  const st = writeOnlyStore(root);
  st.trust('a|1:1|k', { at: 'x', value: 1 });
  st.trust('b|1:1|k', { at: 'x', value: 2 });
  check(Object.keys(JSON.parse(fs.readFileSync(trustF, 'utf8'))).length === 2, 'trust() did not keep both entries');
  fs.writeFileSync(trustF, '{"a|1:1|k": {"answer": "yes"');
  const before = fs.readFileSync(trustF, 'utf8');
  check(throws(() => st.trust('c|1:1|k', { at: 'x', value: 3 })) && fs.readFileSync(trustF, 'utf8') === before, 'trust() wrote over a record it could not read');
  fs.writeFileSync(lastF, '');
  check(throws(() => st.remember('a|1:1|k', 5)) && fs.readFileSync(lastF, 'utf8') === '', 'remember() wrote over a record it could not read');

  // the version number: a last publish that is there but damaged stops the bump (never restarts at 1.0)
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = fs.readFileSync(path.join(ROOT, 'helpers', 'release-notes.mjs'), 'utf8');
  check(/--bump[\s\S]{0,400}fs\.existsSync\(FILE\) && !readPublished\(\)[\s\S]{0,200}process\.exit\(1\)/.test(src), 'release-notes --bump does not stop on a damaged published-version.json');

  // the places that change a shared or saved file in place read it strictly (no "catch: empty" before a write)
  const src2 = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const ss = src2('helpers/settings-sync.js');
  check(/profiles: readJsonForWrite\(PROFILES, \[\]\)/.test(ss) && /const settings = readJsonForWrite\(SETTINGS/.test(ss), 'settings sync reads this PC\'s settings or profiles leniently before sending');
  check(/const cur = readJsonForWrite\(SETTINGS, \{\}\)/.test(ss), 'settings sync reads settings.json leniently before loading the main PC\'s options into it');
  check(/const st = readJsonForWrite\(STATE, \{\}\)/.test(ss), 'settings sync reads this PC\'s role leniently (a main PC could turn into a following one)');
  check(/remote\.profiles\.length \|\| !local\.profiles\.length/.test(ss), 'an empty profile list from the main PC can empty this PC\'s profiles');
  check(/readJsonForWrite\(STORE, null\)/.test(src2('helpers/eqapo.js')), 'an unreadable EQ store can be replaced by a fresh one');
  check(/const cur = readJsonForWrite\(SETTINGS_FILE, \{\}\)/.test(src2('helpers/agent.mjs')), 'the headset pick reads settings.json leniently before writing it');
  check(/readJsonForWrite\(f, \{\}\)/.test(src2('helpers/driver-share.mjs')), 'Share drivers reads settings.json leniently before writing it');
  check(/const done = \[\];\n\s+const s = readJsonForWrite\(SETTINGS, \{\}\)/.test(src2('helpers/setup-extras.js').replace(/\r\n/g, '\n')), 'loading a setup reads settings.json leniently before writing it');
  check(/const s = readJsonForWrite\(SETTINGS, \{\}\);\s+s\.oneDriveSeen/.test(src2('helpers/onedrive-setup.mjs')), 'OneDrive Not now reads settings.json leniently before writing it');
  check(/if \(unreadable\) return;/.test(src2('helpers/battery-care.mjs')), 'battery care can write over a record it could not read');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

if (fails.length) { console.log(`failed-read: ${fails.length} problem(s)\n${fails.map((f) => `- ${f}`).join('\n')}`); process.exit(1); }
console.log('failed-read: a failed read never writes; all checks passed');
