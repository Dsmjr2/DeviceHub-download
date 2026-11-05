// The idle cost of DeviceHub's own loops (3 Nov 2026, measured on Shawn's laptop: 1.28% of a core idle before, 0.73%
// after). With Windows' device messages arriving, the looks for devices that are not plugged in become backstops:
// the HS80's sound devices every 30 s (helpers/audio-follow.js) instead of every 2, its receiver every 60 s
// (helpers/receiver-light.js), a missing mouse or keyboard every 2 minutes and the headset every 60 s
// (public/core/devices.js); a plug is heard at once (helpers/native.js onDeviceChange). Without the messages, as before.
// Run: node tests/idle-loops.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// audio-follow: with no HS80, one look in 30 s once device messages arrive; every look (2 s) without them
{
  const follow = require('../helpers/audio-follow.js');
  let calls = 0;
  const call = async (what) => { if (what === 'hs80-endpoints') calls++; return { endpoints: [], defaults: {} }; };
  const realSet = global.setInterval;
  let step = null;
  global.setInterval = (fn) => { step = fn; return 0; };
  follow.start(call, () => {});
  global.setInterval = realSet;
  await new Promise((r) => setTimeout(r, 20));
  const first = calls;
  for (let i = 0; i < 10; i++) await step();
  ok(first >= 1 && calls === first * 11, `without device messages: every look asks Windows (${calls}, ${first} per look)`);
  follow.useWindowsEvents(true);
  await step();
  const now = calls;
  for (let i = 0; i < 10; i++) await step();
  ok(calls === now, `with device messages and no HS80: no look for 30 s (${calls - now} extra)`);
  follow.stop?.();
}

const rx = src('helpers/receiver-light.js');
ok(/events \? 60000 : 2000/.test(rx) && /onDeviceChange\(/.test(rx), 'the receiver: a 60 s backstop with device messages, looked for at once on a plug');
const dev = src('public/core/devices.js');
ok(/env\.wakeEvents \? 120000 : 20000/.test(dev) && /d\.adapter\.pollRead && env\.wakeEvents && Date\.now\(\) - \(lastTry\[d\.id\] \|\| 0\) < 60000/.test(dev), 'a missing mouse or keyboard every 2 minutes, the headset every 60 s, with device messages');
const nat = src('helpers/native.js');
ok(/if \(chan === 'dev'\) for \(const fn of deviceListeners\)/.test(nat), 'device messages reach every listener, the agent\'s own handler kept');
const agent = src('helpers/agent.mjs');
ok((agent.match(/'\.\/audio-follow', '\.\/receiver-light'/g) || []).length === 2, 'the agent tells both loops when device messages come and go');

if (fails.length) { console.log(`idle-loops: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('idle-loops (backstop looks while device messages arrive; a plug heard at once): all good');
process.exit(0);
