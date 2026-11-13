// The helper's memory for Settings > Health (13 Nov 2026): the C# helper answers MEM with "private=<MB>MB ..."; the Rust
// one (on trial since 13 Nov) answers only "rust-helper", so Health showed no helper memory. Then the helper process is
// measured from outside: its private bytes, read-only (tasklist would give the working set, a different number).
const { execFile } = require('child_process');

const PRIVATE = /private=([\d.]+)MB/;
// line: the helper's own MEM answer; pid: its process; measure(pid) -> private bytes (replaceable for tests)
async function helperMemoryMB(line, pid, measure = privateBytes) {
  const own = Number((PRIVATE.exec(String(line || '')) || [])[1]);
  if (own) return own;
  if (!pid) return null;
  try { const b = await measure(pid); return b > 0 ? +(b / 1048576).toFixed(1) : null; } catch { return null; }
}
function privateBytes(pid) {
  const ps = `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).PrivateMemorySize64`;
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 },
    (e, out) => (e ? reject(e) : resolve(Number(String(out).trim())))));
}
module.exports = { helperMemoryMB };
