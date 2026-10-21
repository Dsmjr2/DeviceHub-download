// Crash-proof saving (20 Oct 2026): every DeviceHub data file is written to a temporary file next to it, flushed to
// disk, then swapped in with one rename. A crash or power cut mid-save leaves either the old file or the new one,
// never a half-written file (which would have lost that setting). The rename is retried briefly when Windows holds the
// file for a moment (antivirus, a reader), and the temporary file is removed if the save fails.
const fs = require('fs');
const path = require('path');

let seq = 0;
function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${++seq}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, typeof data === 'string' || Buffer.isBuffer(data) ? data : String(data)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      const until = Date.now() + 25 * (i + 1); while (Date.now() < until) { /* wait a moment for Windows to let go */ }
    }
  }
}

// leftovers from a save that was cut off (the old or new file is still whole next to them)
function cleanLeftovers(dir) {
  try { for (const f of fs.readdirSync(dir)) if (/^\..+\.\d+\.\d+\.tmp$/.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} } } catch {}
}

module.exports = { writeAtomic, cleanLeftovers };
