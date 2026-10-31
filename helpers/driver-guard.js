// A device driver's error never stops DeviceHub (22 Oct 2026, support issues 3-5: a library driver's reply timer
// rejected a promise nobody was waiting on any more, "Error: no reply to 06 ff bb 08", and Node ended the server with
// code 1; the launcher started it again and the headset dropped out each time).
//
// install() adds process-wide handlers for an unhandled promise rejection and an uncaught exception. When the error
// comes from a driver added on this PC (my-devices\<folder>\..., which is where library and learned drivers run from),
// from the device library's own copy, or from the driver.json runner (helpers/declarative-driver.mjs), it is logged in
// one line and handed to onDriverFault(folder, error), which marks that device asleep or in error; DeviceHub keeps
// running. Any other error behaves as before: an uncaught exception or rejection from DeviceHub's own code is logged
// and the server exits with code 1, so the launcher restarts it and the problem report still counts it as a crash.

// which driver an error came from: the my-devices or device-library folder name in its stack, or "driver.json" for the
// declarative runner (its stack names no folder). null = not a driver's error.
function driverOf(err) {
  const stack = String((err && err.stack) || '');
  if (!stack) return null;
  const m = /[\\/](?:my-devices|device-library)[\\/]([^\\/:]+)[\\/]/i.exec(stack);
  if (m) return m[1];
  if (/declarative-driver\.mjs/i.test(stack)) return 'driver.json';
  // a device's reply timer (public/devices/hid.js marks its errors; helpers/hid-host.mjs is the same channel in the
  // server): a device that did not answer, never a reason to stop DeviceHub (31 Oct 2026)
  if ((err && err.device === true) || /[\\/]public[\\/]devices[\\/]hid\.js|hid-host\.mjs/i.test(stack)) return 'a device';
  return null;
}

const firstLine = (err) => String((err && (err.message || err)) || 'unknown error').split(/\r?\n/)[0].slice(0, 300);

let installed = false;
let handler = null;          // onDriverFault(folder, err), set by the agent once it runs
const counts = new Map();    // folder -> faults caught, for the log (one line per fault, never a flood)

function setDriverFaultHandler(fn) { handler = typeof fn === 'function' ? fn : null; }

// what happens to one error: 'driver' (kept running) or 'own' (DeviceHub's own: the caller exits)
function handle(err, kind, { log = (t) => console.log(t) } = {}) {
  const folder = driverOf(err);
  if (!folder) return 'own';
  const n = (counts.get(folder) || 0) + 1;
  counts.set(folder, n);
  // the first few in full, then one line in every 50, so a driver stuck in a loop does not fill server.log
  if (n <= 5 || n % 50 === 0) log(`[driver] ${folder}: ${kind}: ${firstLine(err)} (DeviceHub kept running${n > 1 ? `; ${n} so far` : ''})`);
  try { if (handler) handler(folder, err); } catch (e) { log(`[driver] ${folder}: marking it failed: ${firstLine(e)}`); }
  return 'driver';
}

function install({ log = (t) => console.log(t), exit = (code) => process.exit(code) } = {}) {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => {
    if (handle(reason, 'unhandled rejection', { log }) === 'driver') return;
    console.error('[crash] unhandled rejection:', (reason && reason.stack) || reason);
    exit(1);
  });
  process.on('uncaughtException', (err) => {
    if (handle(err, 'uncaught error', { log }) === 'driver') return;
    console.error('[crash] uncaught error:', (err && err.stack) || err);
    exit(1);
  });
}

module.exports = { install, driverOf, handle, setDriverFaultHandler };
