// Auto-switch: every 5 s, if a profile's game is running, apply that profile; when it closes, go back to the default profile.
// Applying uses the normal path (backup, one write at a time, re-read). Nothing happens unless the setting is on.
import { loadProfiles, apply, wifiProfile } from './profiles.js';
import { isDemo, log } from './devices.js';
import { env } from './env.js';

export const auto = { settings: { autoSwitch: false, defaultProfile: '' }, active: null, running: [], busy: false };
const listeners = new Set();
export const onAuto = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export async function loadSettings() {
  if (isDemo()) return auto.settings;
  try { auto.settings = { ...auto.settings, ...(await env.api('/api/settings')) }; } catch {}
  emit();
  return auto.settings;
}
// Sends only the changed keys; the server merges them and returns the full settings.
export async function saveSettings(patch) {
  auto.settings = { ...auto.settings, ...patch };
  if (!isDemo()) { try { auto.settings = { ...auto.settings, ...(await env.api('/api/settings', patch)) }; } catch {} }
  emit();
}

export async function runningWindows() {
  try { return await env.api('/api/processes?windows'); } catch { return []; }
}

const norm = (s) => s.trim().toLowerCase();
// A profile's games list may hold ANY_GAME: then any program from the game folders counts (server: /api/games).
export const ANY_GAME = '*games*';
let gameNames = new Set(), gameTitles = {}, gamesAt = 0;
async function games() {
  if (Date.now() - gamesAt > 600000) {
    try { gameNames = new Set((await env.api('/api/games')).map(norm)); gamesAt = Date.now(); } catch {}
    try { gameTitles = await env.api('/api/games?titles=1'); } catch {}
  }
  return gameNames;
}
export const gameTitle = (exe) => gameTitles[norm(exe)] || prettyExe(exe);
// a program name without a known title: 'wardogsclient-win64-shipping.exe' -> 'Wardogsclient'
export function prettyExe(exe) {
  const t = String(exe).replace(/\.exe$/i, '').replace(/[-_](win64|wingdk|steam|shipping)/gi, '').replace(/[-_]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : String(exe);
}
const gameRunning = (g, running, all) => (g === ANY_GAME ? [...running].find((r) => all.has(r)) : running.has(norm(g)) ? norm(g) : null);

async function tick() {
  if (!auto.settings.autoSwitch || auto.busy || isDemo()) return;
  let running;
  try { running = new Set((await env.api('/api/processes')).map(norm)); } catch { return; }
  const profiles = await loadProfiles();
  const all = await games();
  const match = profiles.find((p) => (p.games || []).some((g) => gameRunning(g, running, all)));
  const target = match || profiles.find((p) => p.name === auto.settings.defaultProfile) || null;
  // Game closed and there is no default to go back to: forget it, so starting the game again re-applies its profile.
  if (!match && !target && auto.active) { auto.active = null; wifiProfile(null); emit(); return; }
  // a profile applied while a device was asleep: its leftover changes are tried again quietly every check (10 s) until
  // they land (the mouse wakes when it is touched) or another profile takes over
  if (target && auto.retry === target.name) {
    auto.busy = true;
    try {
      const r = await apply(target, { retry: true });
      if (!r.failed && !r.asleep) { auto.retry = null; log(`${target.name} profile finished: the ${r.done === 1 ? 'change' : `${r.done} changes`} waiting for a device to wake went through`, 'good', undefined, { auto: true }); }
    } finally { auto.busy = false; }
    return;
  }
  if (!target || target.name === auto.active) return;
  if (!match && !auto.active) return; // nothing was auto-applied yet: leave the current setup alone
  auto.busy = true;
  try {
    const why = match ? `${gameTitle((match.games || []).map((g) => gameRunning(g, running, all)).find(Boolean))} started` : 'Game closed';
    const r = await apply(target);
    auto.active = match ? target.name : null;
    auto.retry = r.failed || r.asleep ? target.name : null;
    // auto: true makes an open window show it as a toast (the agent has no screen of its own).
    const waiting = r.asleep && r.failed <= r.asleep;
    log(`${why} · ${target.name} profile${waiting ? ' (the mouse was asleep: finishes when it wakes)' : r.failed ? ` (${r.failed} failed, trying again)` : ''}`, r.failed && !waiting ? 'bad' : 'good', undefined, { auto: true });
    env.toast(`${target.name} profile on`, r.failed && !waiting ? 'bad' : 'good', { detail: `${why}${waiting ? ' · finishes when the mouse wakes' : r.failed ? ` · ${r.failed} failed` : ''}` });
  } finally { auto.busy = false; emit(); }
}

export function startAutoSwitch() {
  loadSettings();
  setInterval(tick, 10000);  // a game is noticed within 10 s; each look starts tasklist, so not more often
}
