// Offline test (15 Nov 2026 bug hunt round 3): while an update runs, (1) the status Settings asks for says it is
// updating, never "Up to date" from a half-merged copy, (2) a second Update is refused, (3) the window is not told to
// reload by the new files the update itself writes into public/ (the reload lost the answer: an update that then
// failed showed "Up to date"), and Settings shows the update's progress instead of a status.
// helpers/self-update.js runs as a copy in a temp folder with no git and no release (its update fails at once).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-upflight-'));
fs.mkdirSync(path.join(T, 'helpers'));
for (const f of ['self-update.js', 'safe-write.js', 'ps-quote.js', 'data-dir.js']) fs.copyFileSync(path.join(ROOT, 'helpers', f), path.join(T, 'helpers', f));
const su = createRequire(import.meta.url)(path.join(T, 'helpers', 'self-update.js'));
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  const first = su.update(); first.catch(() => {});
  const st = await su.status();
  check(st.updating === true && !st.error, `status during an update says updating (${JSON.stringify(st)})`);
  let second = null;
  try { await su.update(); } catch (e) { second = e; }
  check(second && /already/.test(second.message), `a second Update while one runs is refused (${second?.message})`);
  await first.catch(() => {});
  const after = await su.status();
  check(!after.updating, 'after it ends, status is the real one again');

  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  check(/watchFolder\(PUBLIC, \(\) => \{ if \(!hub\.count\(\)\) return; if \(require\('\.\/helpers\/self-update'\)\.updating\(\)\) return;/.test(server), 'no reload is pushed to the window while an update writes its files');
  const settings = fs.readFileSync(path.join(ROOT, 'public/pages/settings.js'), 'utf8');
  check(/if \(r\?\.updating\)/.test(settings), 'Settings shows the running update instead of a status');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`update-inflight (updating shown, a second Update refused, no reload mid-update): all ${n} passed`);
process.exit(0);
