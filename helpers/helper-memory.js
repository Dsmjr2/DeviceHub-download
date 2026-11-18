// The helper's memory for Settings > Health (13 Nov 2026): the C# helper answers MEM with "private=<MB>MB ..."; the Rust
// one (on trial since 13 Nov) answers only "rust-helper", so Health showed no helper memory. Then the helper process is
// measured from outside: its private bytes, read-only (tasklist would give the working set, a different number).
const { execFile } = require('child_process');

const PRIVATE = /private=([\d.]+)MB/;
// line: the helper's own MEM answer; pid: its process; measure(pid) -> private bytes (replaceable for tests)
async function helperMemoryMB(line, pid, measure = privateBytes) {
  const own = Number((PRIVATE.exec(String(line || '')) || [])[1]);
  if (Number.isFinite(own) && own > 0) return own;
  const pidNum = Number(pid);
  if (!Number.isInteger(pidNum) || pidNum <= 0) return null;
  try { const b = await measure(pidNum); return Number.isFinite(b) && b > 0 ? +(b / 1048576).toFixed(1) : null; } catch { return null; }
}
function privateBytes(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return Promise.resolve(null);
  const ps = `(Get-Process -Id ${n} -ErrorAction Stop).PrivateMemorySize64`;
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 },
    (e, out) => {
      if (e) return reject(e);
      const val = Number(String(out).trim());
      resolve(Number.isFinite(val) ? val : null);
    }));
}
module.exports = { helperMemoryMB };
