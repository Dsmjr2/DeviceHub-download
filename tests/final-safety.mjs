// The smaller fixes of the final audit (22 Oct 2026; docs/handoff/final-safety.md), offline:
//   6. Settings > Self-test reads PC lights without starting the OpenRGB inside DeviceHub (no ?fresh=1)
//   7. git never asks for anything: self-update and settings sync both blank GIT_ASKPASS / SSH_ASKPASS and run ssh in
//      batch mode
//   8. the installer button's progress poll ends: after 10 minutes, or after 5 failed reads in a row
// Run: node tests/final-safety.mjs (no hardware, nothing started)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// 6.
const settings = src('public/pages/settings.js');
const lights = settings.split('\n').find((l) => /check\('PC lights'/.test(l)) || '';
check(/env\.api\('\/api\/openrgb'\)/.test(lights) && !/fresh/.test(lights), `the self-test reads /api/openrgb without ?fresh=1 (${lights.trim().slice(0, 120)})`);
const server = src('server.js');
check(/url\.pathname === '\/api\/openrgb'\) return send\(res, 200, await openrgb\.status\(url\.searchParams\.has\('fresh'\)\)\)/.test(server), 'the server starts OpenRGB only for ?fresh=1 (openrgb.status(fresh))');

// 7.
for (const f of ['helpers/self-update.js', 'helpers/settings-sync.js']) {
  const t = src(f);
  const env = (t.match(/env: \{ \.\.\.process\.env,[^}]*\}/) || [''])[0];
  check(/GIT_TERMINAL_PROMPT: '0'/.test(env) && /GCM_INTERACTIVE: 'never'/.test(env) && /GIT_ASKPASS: ''/.test(env) && /SSH_ASKPASS: ''/.test(env) && /GIT_SSH_COMMAND: 'ssh -o BatchMode=yes'/.test(env), `${f}: git runs with no prompt of any kind (${env})`);
}

// 8.
const ib = await import('../public/ui/installer-button.js');
check(ib.FOLLOW_MS === 10 * 60 * 1000 && ib.FOLLOW_ERRORS === 5, 'the poll limits are 10 minutes and 5 errors');
{
  let t = 0, asked = 0;
  const r = await ib.follow('eqapo', () => {}, { wait: async (ms) => { t += ms; }, now: () => t, api: async () => { asked++; throw new Error('not answering'); } });
  check(r && r.ok === false && asked === 5 && /did not answer/.test(r.text), `5 failed reads in a row end it (${asked} reads: ${r?.text})`);
}
{
  let t = 0, asked = 0;
  const r = await ib.follow('eqapo', () => {}, { wait: async (ms) => { t += ms; }, now: () => t, api: async () => { asked++; if (asked % 4 === 0) throw new Error('busy'); return { tool: 'other' }; } });
  check(r && r.ok === false && /10 minutes/.test(r.text) && t >= ib.FOLLOW_MS && t < ib.FOLLOW_MS + 1000, `a poll that never finishes ends after 10 minutes, errors between answers not counting up (${asked} reads, ${t} ms: ${r?.text})`);
}
{
  let t = 0, n = 0;
  const r = await ib.follow('eqapo', () => {}, { wait: async (ms) => { t += ms; }, now: () => t, api: async () => (++n < 3 ? { tool: 'other' } : { tool: 'eqapo', done: true, ok: true, text: 'Installed' }) }).catch((e) => ({ thrown: e.message }));
  check(r?.ok === true && r.text === 'Installed', `a finished install answers as before (${JSON.stringify(r)})`);
}

console.log(fails.length ? `final-safety: FAILED: ${fails.join('; ')}` : 'final-safety (self-test never starts OpenRGB, git never prompts, the installer poll ends): all good');
process.exit(fails.length ? 1 : 0);
