// Search's commands for the PC's own switches (public/core/commands.js pcCommands, 3 Nov 2026): "gaming mode on",
// "save replay", "sleep after 30 min", "screen off after 10 min". Each line turns into one command with the right
// label, and running it calls the same route as the PC and Laptop pages. Run: node tests/pc-commands.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const src = fs.readFileSync(path.join(ROOT, 'public/core/commands.js'), 'utf8').replace(/\r\n/g, '\n');
// the three pieces, run with stand-ins for the window's API and toasts
const part = (start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
const code = [part('export const SLEEP_MINUTES', '\n'), part('const postOr = ', '\n};\n') + '\n};', part('export function pcCommands(q)', '\nconst COLORS')].join('\n').replace(/export /g, '');
const calls = [], toasts = [];
const env = { api: async (p, b) => { calls.push([p, b]); return { ok: true }; } };
const pcCommands = new Function('env', 'toast', 'isDemo', `${code}; return pcCommands;`)(env, (t) => toasts.push(t), () => false);

const run = async (q) => { const c = pcCommands(q); if (c) await c.run(); return c; };
let c = await run('gaming mode on');
ok(c?.label === 'Gaming mode on' && calls.at(-1)[0] === '/api/gaming-mode' && calls.at(-1)[1].on === true, 'gaming mode on');
c = await run('game mode off');
ok(c?.label === 'Gaming mode off' && calls.at(-1)[1].on === false, 'game mode off (either name)');
for (const q of ['save replay', 'record last', 'save a clip', 'clip that']) {
  c = await run(q);
  ok(c?.label === 'Save replay (Record last)' && calls.at(-1)[0] === '/api/replay/save', `"${q}" saves a replay`);
}
c = await run('sleep after 30 min');
ok(c?.label === 'Sleep after 30 min (plugged in)' && calls.at(-1)[0] === '/api/sleep' && calls.at(-1)[1].which === 'ac' && calls.at(-1)[1].value === 1800, 'sleep after 30 min');
c = await run('sleep 2 hours');
ok(c?.label === 'Sleep after 2 h (plugged in)' && calls.at(-1)[1].value === 7200, 'sleep 2 hours');
c = await run('sleep never');
ok(c?.label === 'Sleep after Never (plugged in)' && calls.at(-1)[1].value === 0, 'sleep never');
c = await run('screen off after 10');
ok(c?.label === 'Screen off after 10 min (plugged in)' && calls.at(-1)[1].which === 'screenAc' && calls.at(-1)[1].value === 600, 'screen off after 10');
ok(pcCommands('sleep 7 min') === null, 'a time the list does not offer: no command');
ok(pcCommands('sleep') === null && pcCommands('sleep monitors') === null, '"sleep" alone is still Sleep monitors (not this)');
ok(pcCommands('gaming mode') === null && pcCommands('replay') === null, 'half a command: nothing');
ok(toasts.includes('Gaming mode on') && toasts.includes('Replay saved'), 'each says what happened');

if (fails.length) { console.log(`pc-commands: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('pc-commands (Search: gaming mode on/off, save replay, sleep after, screen off after): all good');
