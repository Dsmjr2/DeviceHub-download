// Every data file damaged at once (as after a power cut mid-save), in a throwaway copy of DeviceHub on a spare port
// with devices and background parts off: DeviceHub must start, answer, save settings again, and keep each damaged
// file as <name>.damaged-<time> (20 Oct 2026). Not part of npm test (it copies the app): node tests/damaged-files.mjs
// The EQ is left out on purpose: a test copy must never write Equalizer APO's shared config file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-damaged-'));
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); else console.log(`  ok: ${what}`); };
// the app's own files (what git tracks) and its libraries
for (const f of execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)) {
  const src = path.join(ROOT, f); if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(path.join(T, f)), { recursive: true }); fs.copyFileSync(src, path.join(T, f));
}
fs.cpSync(path.join(ROOT, 'node_modules'), path.join(T, 'node_modules'), { recursive: true });
const DAMAGED = ['settings.json', 'profiles.json', 'eq-presets.json', 'seen-devices.json', 'headset-lights.json', 'mouse-level.json', 'settings-sync-state.json', 'updates-cache.json', 'headset-firmware.json'];
// written beside the app, where a version from before 27 Oct 2026 kept them: the start moves them into data\ first
// (helpers/data-migrate.js), then finds them damaged there
for (const f of DAMAGED) fs.writeFileSync(path.join(T, f), '{"half a file, cut off by a power c');
fs.writeFileSync(path.join(T, 'activity.jsonl'), '{"at":"2026-10-20T01:00:00Z","text":"ok","kind":"good"}\n{"broken\n\u0000\u0000\n');
fs.writeFileSync(path.join(T, 'battery-history.jsonl'), 'not json at all\n');
fs.mkdirSync(path.join(T, 'backups'), { recursive: true });

const port = 5591, B = `http://127.0.0.1:${port}`;
const p = spawn(process.execPath, ['server.js'], { cwd: T, env: { ...process.env, DEVICEHUB_PORT: String(port), DEVICEHUB_AGENT: '0', DEVICEHUB_TRAY: '0', DEVICEHUB_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
let exited = null; p.on('exit', (c) => { exited = c; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false; for (let i = 0; i < 40 && !up && exited === null; i++) { await sleep(500); try { up = (await (await fetch(`${B}/api/version`)).json()).version != null; } catch {} }
check(up, `starts and answers with every data file damaged${exited !== null ? ` (it exited with ${exited})` : ''}`);
if (up) {
  const get = async (u) => { const r = await fetch(B + u); return { status: r.status, body: await r.text() }; };
  const post = async (u, b) => { const r = await fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify(b) }); return { status: r.status, body: await r.text() }; };
  for (const u of ['/api/settings', '/api/profiles', '/api/activity', '/api/health', '/api/backups', '/api/battery-history?id=mouse', '/api/setups']) {
    const r = await get(u); check(r.status === 200, `${u} answers (${r.status})`);
  }
  const s = await post('/api/settings', { lightWindow: false });
  check(s.status === 200, `settings save again (${s.status})`);
  check(JSON.parse(fs.readFileSync(path.join(T, 'data', 'settings.json'), 'utf8')).lightWindow === false, 'the new data\\settings.json holds the saved value');
  check([...DAMAGED, 'activity.jsonl', 'battery-history.jsonl'].every((f) => !fs.existsSync(path.join(T, f))) && /\[data\] moved/.test(out), 'the files beside the app were moved into data\\ at the start, with one log line');
  const kept = fs.readdirSync(path.join(T, 'data')).filter((f) => /\.damaged-/.test(f));
  check(kept.some((f) => f.startsWith('settings.json.damaged-')) && kept.some((f) => f.startsWith('profiles.json.damaged-')), `damaged files kept: ${kept.join(', ') || 'none'}`);
  for (const pg of ['/', '/core/devices.js']) { const r = await get(pg); check(r.status === 200, `page ${pg} loads`); }
  try { await post('/api/quit', {}); } catch {}
}
await sleep(1500); try { p.kill(); } catch {}
if (/TypeError|SyntaxError|ReferenceError|Unhandled/.test(out)) fails.push('errors in its log: ' + out.split('\n').filter((l) => /Error|Unhandled/.test(l)).slice(0, 3).join(' | '));
fs.rmSync(T, { recursive: true, force: true });
console.log(fails.length ? `damaged files: FAILED: ${fails.join('; ')}` : 'damaged files: all good');
process.exit(fails.length ? 1 : 0);
