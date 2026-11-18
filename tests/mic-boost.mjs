// Offline test: helpers/mic-boost.js — read(), set() validation/missing file, applying(), and applyToText()
// ensuring all MicBoostValue entries update without stateful /g lastIndex misses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-mic-boost-'));
const cfgDir = path.join(T, 'Corsair', 'CUE5');
const cfgPath = path.join(cfgDir, 'config.cuecfg');
const prevAppData = process.env.APPDATA;
process.env.APPDATA = T;

const require = createRequire(import.meta.url);
const micBoost = require('../helpers/mic-boost.js');

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  // 1. read() when config.cuecfg is missing
  check(micBoost.read().available === false, 'read() returns available:false when config missing');
  check(micBoost.applying() === false, 'applying() is false initially');

  // 2. set() rejects invalid dB values before touching files
  for (const bad of [-1, 11, 1.5, '5', NaN, null, undefined]) {
    let threw = false;
    try { await micBoost.set(bad, T); } catch (e) { threw = /0-10 dB/.test(e.message); }
    check(threw, `set(${String(bad)}) rejects invalid dB`);
  }

  // 3. set() rejects missing config.cuecfg
  let missingThrew = false;
  try { await micBoost.set(5, T); } catch (e) { missingThrew = /not found/.test(e.message); }
  check(missingThrew, 'set() rejects missing iCUE config file');

  // 4. read() parses multiple MicBoostValue entries
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(cfgPath, '<cue>\n  <value name="MicBoostValue">4</value>\n  <value name="MicBoostValue">4</value>\n</cue>');
  const r = micBoost.read();
  check(r.available === true && r.db === 4 && r.all.length === 2 && r.all[1] === 4, 'read() reads all MicBoostValue entries');

  // 5. read() returns available:false when config has no MicBoostValue
  fs.writeFileSync(cfgPath, '<cue><value name="Other">1</value></cue>');
  check(micBoost.read().available === false, 'read() returns available:false when no MicBoostValue exists');

  // 6. applyToText() updates all occurrences and handles longer -> shorter text without /g lastIndex bug
  const longXml = `${' '.repeat(200)}<value name="MicBoostValue">3</value>\n<value name="MicBoostValue">7</value>`;
  const shortXml = `<value name="MicBoostValue">2</value>`;
  const outLong = micBoost._test.applyToText(longXml, 9);
  const outShort = micBoost._test.applyToText(shortXml, 0);
  check((outLong.match(/<value name="MicBoostValue">9<\/value>/g) || []).length === 2, 'applyToText updates all entries');
  check(outShort === '<value name="MicBoostValue">0</value>', 'applyToText works on shorter XML right after longer XML');

  // 7. applyToText() throws when no MicBoostValue is present or inputs are invalid
  let noMatchThrew = false;
  try { micBoost._test.applyToText('<cue></cue>', 5); } catch (e) { noMatchThrew = /no mic boost setting/.test(e.message); }
  check(noMatchThrew, 'applyToText throws when no MicBoostValue present');

  let nonStrThrew = false;
  try { micBoost._test.applyToText(null, 5); } catch (e) { nonStrThrew = /no mic boost setting/.test(e.message); }
  check(nonStrThrew, 'applyToText throws cleanly for non-string XML');

  let noBackupThrew = false;
  try { await micBoost.set(5, null); } catch (e) { noBackupThrew = /backup folder/.test(e.message); }
  check(noBackupThrew, 'set() rejects missing backup folder before touching iCUE');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  if (prevAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = prevAppData;
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`mic-boost (read, validation, applyToText, lastIndex safety): all ${n} passed`);
process.exit(0);
