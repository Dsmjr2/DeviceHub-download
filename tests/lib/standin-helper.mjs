// A stand-in for DeviceHubHelper.exe (tests only): a small node script that speaks the helper's line protocol
// (`<chan> <seq> [@deadline=<ms>] <cmd>` in, `<chan> <seq> <reply>` out) and touches no device. Used through
// DEVICEHUB_HELPER_JS (helpers/native.js runs it with node). Commands:
//   PID          answers its own process id (tells one helper process from the next)
//   HANG         never answers
//   FREEZE       answers OK, then never answers anything again (a frozen helper)
//   EXIT <code>  stops at once with that exit code
//   SLOW <ms>    answers OK after <ms>
//   anything else answers OK
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = String.raw`
import readline from 'node:readline';
let frozen = false;
const out = (chan, seq, reply) => process.stdout.write(chan + ' ' + seq + ' ' + reply + '\n');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const a = line.indexOf(' '); if (a < 0) return;
  const b = line.indexOf(' ', a + 1); if (b < 0) return;
  const chan = line.slice(0, a), seq = line.slice(a + 1, b);
  let cmd = line.slice(b + 1);
  if (cmd.startsWith('@deadline=')) cmd = cmd.slice(cmd.indexOf(' ') + 1);
  if (frozen) return;
  const [verb, arg] = cmd.split(' ');
  if (verb === 'HANG') return;
  if (verb === 'EXIT') process.exit(Number(arg) || 0);
  if (verb === 'FREEZE') { frozen = true; return out(chan, seq, 'OK'); }
  if (verb === 'PID') return out(chan, seq, String(process.pid));
  if (verb === 'SLOW') return setTimeout(() => out(chan, seq, 'OK'), Number(arg) || 50);
  out(chan, seq, 'OK');
});
rl.on('close', () => process.exit(0));
`;

// writes the stand-in into dir and returns its path
export function writeStandIn(dir, name = 'standin-helper.mjs') {
  const f = path.join(dir, name);
  fs.writeFileSync(f, SCRIPT);
  return f;
}
