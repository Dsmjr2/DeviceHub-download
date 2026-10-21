// The HS80 receiver's own white light: off. The receiver shows its built-in light in lighting mode 1; iCUE switches it
// to mode 2 (software) when it starts and never sends it a color, so it stays dark (measured 19 Oct 2026). Without
// iCUE, DeviceHub does the same: it reads the receiver's mode (property 03 on address 08) every 5 s and sets it back
// to 2 if the receiver was re-plugged or restarted. While the receiver is unplugged it is looked for every 2 s, so a
// re-plugged receiver goes dark within about 2 s instead of flashing for up to 30 s (Shawn, 19 Oct 2026: "I do not
// want it to do any color or ever flash"). Nothing else on the receiver is touched.

const native = require('./native');
const CHAN = 'hs80:0A6B:8:rx';
let timer = null, opened = false, icueRunning = async () => false, log = () => {};
const line = (cmd, ms = 8000) => native.request(CHAN, cmd, ms);
native.onExit(() => { opened = false; });

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (await icueRunning()) { if (opened) { await line('CLOSE'); opened = false; } return; }  // iCUE runs the receiver itself
    if (!opened) { opened = (await line('OPEN', 15000)) === 'OK'; if (!opened) return; }
    const r = await line('GET 03');
    if (r === 'GONE') { opened = false; return; }
    if (!/^00 /.test(r)) return;
    if (parseInt(r.split(' ')[1], 16) === 1) {
      const st = await line('MODE 2');
      log(st === '00' ? { kind: 'info', device: 'headset', text: 'Receiver light turned off' } : { kind: 'bad', device: 'headset', text: `Could not turn the receiver light off (${st})` });
    }
  } finally { busy = false; }
}

let stopped = false;
function loop() {
  if (stopped) return;
  tick().catch(() => {}).finally(() => { if (!stopped) timer = setTimeout(loop, require('./power').every(opened ? 5000 : 2000)); });
}
function startLight(icueCheck, logFn) { icueRunning = icueCheck; log = logFn; stopped = false; loop(); }
function stopLight() { stopped = true; clearTimeout(timer); if (opened) line('CLOSE', 3000); opened = false; }

module.exports = { start: startLight, stop: stopLight };
