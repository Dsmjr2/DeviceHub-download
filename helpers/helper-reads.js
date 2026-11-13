// Reads (and a few Rust-only pc ops) through the native helper first, PowerShell as the fallback (26 Oct 2026,
// docs/handoff/helper-reads.md). Each read used to start PowerShell (~0.5-1.5 s of CPU each, plus an Add-Type compile
// for display and sensor reads); helpers/pc-reads.cs / Rust pc.rs does the work inside DeviceHubHelper.exe, which
// already runs, and answers with the same JSON PowerShell printed. When the helper is missing, is an older build
// without the op, is restarting, or fails, PowerShell runs as before.
// Most ops are read-only, both ways; four Rust-only ops change settings or act:
//   - sleep-timer (with -Ac/-Dc/-ScreenAc/-ScreenDc: runs powercfg /change)
//   - laptop (with a mode: enables/disables Lid/Modern Standby wake settings)
//   - close-app-window (closes an app window cleanly)
//   - sleep-monitors (when probe is false: sends SC_MONITORPOWER to turn monitors off)
// Those 4 plus corsair-apo-read, startup-apps-read, startup-impact-read, and learn-hid-list exist only in Rust; when
// C# is the active helper, read() goes straight to PowerShell with no helper request or log line.
//   const r = await helperReads.read('bluetooth', { ps: () => readWithPowerShell(), extra: {}, ms: 20000 })
// DEVICEHUB_HELPER_READS=0 turns the helper path off (PowerShell only), for comparing the two.
let native = null;
const nativeMod = () => (native ||= require('./native'));
const counts = {};                    // op -> { helper, powershell }
const told = new Set();               // an op whose fallback was logged once already
const NOT_RUNNING = 'the helper is not running';
const RUST_ONLY_OPS = new Set([
  'sleep-timer',
  'laptop',
  'close-app-window',
  'sleep-monitors',
  'corsair-apo-read',
  'startup-apps-read',
  'startup-impact-read',
  'learn-hid-list',
]);

// the helper's answer to one op on its own channel (pc:<op>: a slow read never holds up another), or null
async function viaHelper(op, extra = {}, ms = 20000, nat = nativeMod()) {
  if (process.env.DEVICEHUB_HELPER_READS === '0') return { fail: 'turned off (DEVICEHUB_HELPER_READS=0)' };
  // only a helper that is already running (the server starts it for the devices and sound): a read never starts or
  // builds one, so a test or a script that reads the PC does not start a helper of its own
  if (typeof nat.running === 'function' && !nat.running()) return { fail: NOT_RUNNING };
  const reply = await nat.request(`pc:${op}`, JSON.stringify({ ...extra, op }), ms);
  let j = null;
  try { j = JSON.parse(reply); } catch { return { fail: String(reply).slice(0, 80) }; }
  if (!j || j.ok !== true || !('result' in j)) return { fail: (j && j.error) || 'no result' };
  return { result: j.result };
}

async function read(op, { ps, extra = {}, ms = 20000, helper = viaHelper, log = console.log, nat = nativeMod() } = {}) {
  const c = (counts[op] ||= { helper: 0, powershell: 0 });
  const kind = typeof nat?.helperKind === 'function' ? nat.helperKind() : 'csharp';
  if (RUST_ONLY_OPS.has(op) && kind !== 'rust') {
    c.powershell++;
    return ps();
  }
  let h = null;
  try { h = await helper(op, extra, ms, nat); } catch (e) { h = { fail: e.message }; }
  if (h && !h.fail) { c.helper++; return h.result; }
  c.powershell++;
  // said once per read, and not for a helper that is simply not running (a test, a script, the first seconds after start)
  if (h && h.fail !== NOT_RUNNING && !told.has(op)) { told.add(op); try { log(`[helper-reads] ${op}: the helper did not answer (${h ? h.fail : 'nothing'}); read with PowerShell`); } catch {} }
  return ps();
}

const stats = () => JSON.parse(JSON.stringify(counts));

module.exports = { read, viaHelper, stats };
