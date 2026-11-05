// Gaming mode (3 Nov 2026, Shawn's 7-hour plan: "one click for the power plan, sleep off, the existing Wi-Fi scan
// pause and instant replay on; everything restored when leaving it"). Not the per-game Game mode (helpers/game-mode.mjs,
// device switches per game): this is one switch for the PC, on the PC page.
// On: Windows' power to Best performance (the power mode switch where Windows has it, else the fastest power plan),
// Sleep after (plugged in) to Never, Wi-Fi scans paused (only if the person set that pause up), instant replay on (only
// with OBS installed). Each one is read first, kept in data\gaming-mode.json (and backups\gaming-mode-<time>.json)
// BEFORE it changes, changed through the path its own card uses (read back there), and put back on Off, in the reverse
// order. A DeviceHub that starts with Gaming mode left on (a crash, a restart) puts everything back.
// No DOM, no Windows calls here: server.js passes the real parts, tests/gaming-mode.mjs stand-ins.

export const MODES = ['efficiency', 'balanced', 'performance'];

export function createGamingMode({ power, plan, sleep, wifi, replay, store, backup = () => {}, log = () => {}, now = () => Date.now() }) {
  let busy = false;
  const state = () => store.read() || { on: false };
  // the person's "while a game runs" choice (auto) stays in the same file through every on and off
  const save = (s) => { const auto = !!(store.read() || {}).auto; store.write({ ...s, auto }); };
  const lock = async (fn) => {
    if (busy) throw Object.assign(new Error('Gaming mode is already changing.'), { code: 409 });
    busy = true;
    try { return await fn(); } finally { busy = false; }
  };

  // byGame: turned on because a game started (3 Nov 2026: "Turn on by itself while a game runs"); only such a Gaming mode
  // is turned off again when the game ends, never one the person turned on
  async function turnOn({ byGame = null } = {}) {
    return lock(async () => {
      if (state().on) return status();
      const at = new Date(now()).toISOString();
      const s = { on: true, at, before: {}, steps: [], ...(byGame ? { byGame } : {}) };
      const step = (what, ok, text) => { s.steps.push({ what, ok, text }); save(s); };
      save(s);
      // 1. Windows' power: the power mode switch, or the fastest plan
      try {
        const mode = await power.get();
        if (MODES.includes(mode)) {
          if (mode !== 'performance') {
            s.before.power = mode; save(s); backup({ at, before: s.before });
            const got = await power.set('performance');
            if (got !== 'performance') throw new Error(`Windows reads ${got || 'nothing'}`);
            step('power', true, `Power mode: ${mode} → Best performance`);
          } else step('power', true, 'Power mode was already Best performance');
        } else {
          const active = await plan.active(), fast = await plan.fast();
          if (!fast) step('power', false, 'No high performance power plan on this PC');
          else if (active === fast.guid) step('power', true, `Power plan was already ${fast.name}`);
          else {
            s.before.plan = active; save(s); backup({ at, before: s.before });
            await plan.set(fast.guid);
            if ((await plan.active()) !== fast.guid) throw new Error('Windows still has the plan before');
            step('power', true, `Power plan → ${fast.name}`);
          }
        }
      } catch (e) { step('power', false, `Power not changed: ${e.message}`); }
      // 2. sleep (plugged in) never
      try {
        const r = await sleep.read();
        if (!r.ok) throw new Error(r.why || 'not read');
        if (r.ac !== 0) { s.before.sleepAc = r.ac; save(s); backup({ at, before: s.before }); await sleep.change('ac', 0, { undoing: true }); step('sleep', true, 'Sleep after (plugged in) → Never'); }
        else step('sleep', true, 'Sleep was already Never');
      } catch (e) { step('sleep', false, `Sleep not changed: ${e.message}`); }
      // 3. Wi-Fi scans paused, only when the person set that up
      try {
        const w = await wifi.status();
        if (!w.setUp) step('wifi', false, 'Wi-Fi scan pause is not set up (PC check, beside the Wi-Fi line), so it was left alone');
        else if (w.scans === 'paused') step('wifi', true, 'Wi-Fi scans were already paused');
        else {
          const r = await wifi.pause('Gaming mode');
          if (r.ok) { s.before.wifi = true; save(s); step('wifi', true, 'Wi-Fi scans paused'); } else step('wifi', false, r.text);
        }
      } catch (e) { step('wifi', false, `Wi-Fi not paused: ${e.message}`); }
      // 4. instant replay on, with OBS
      try {
        const r = await replay.status();
        if (!r.installed) step('replay', false, 'OBS Studio is not installed, so instant replay was left off');
        else if (r.on) step('replay', true, 'Instant replay was already on');
        else { s.before.replay = false; save(s); await replay.set({ on: true }); step('replay', true, 'Instant replay on'); }
      } catch (e) { step('replay', false, `Instant replay not turned on: ${e.message}`); }
      save(s);
      log(`Gaming mode on: ${s.steps.filter((x) => x.ok).length} of ${s.steps.length} done`, s.steps.every((x) => x.ok) ? 'good' : 'info');
      return status();
    });
  }

  // everything back, in the reverse order; whatever cannot go back is said, and the rest still goes back
  async function turnOff(why = 'turned off') {
    return lock(async () => {
      const s = state();
      if (!s.on) return status();
      const b = s.before || {}, out = [];
      const undo = async (what, fn, text) => { try { await fn(); out.push({ what, ok: true, text }); } catch (e) { out.push({ what, ok: false, text: `${text}: not put back (${e.message})` }); } };
      if (b.replay === false) await undo('replay', () => replay.set({ on: false }), 'Instant replay off again');
      if (b.wifi) await undo('wifi', async () => { const r = await wifi.resume('Gaming mode off'); if (!r.ok) throw new Error(r.text); }, 'Wi-Fi scans back on');
      if (b.sleepAc != null) await undo('sleep', () => sleep.change('ac', b.sleepAc, { undoing: true }), 'Sleep after (plugged in) back');
      if (b.power) await undo('power', async () => { const got = await power.set(b.power); if (got !== b.power) throw new Error(`Windows reads ${got}`); }, `Power mode back to ${b.power}`);
      if (b.plan) await undo('power', async () => { await plan.set(b.plan); if ((await plan.active()) !== b.plan) throw new Error('Windows has another plan'); }, 'Power plan back');
      save({ on: false, at: new Date(now()).toISOString(), last: out });
      log(`Gaming mode off (${why}): ${out.length ? out.map((x) => x.text).join('; ') : 'nothing to put back'}`, out.every((x) => x.ok) ? 'good' : 'bad');
      return status();
    });
  }

  function status() {
    const s = state();
    return { ok: true, on: !!s.on, auto: !!s.auto, byGame: s.on ? s.byGame || null : null, at: s.at || null, steps: s.on ? s.steps || [] : [], last: s.on ? null : s.last || null };
  }
  function setAuto(on) { store.write({ ...state(), auto: !!on }); return status(); }
  // every few seconds while auto is on: the running game (or null) turns it on, and its end (gone a while) off again
  let goneSince = null;
  async function tick(game, { goneMs = 20000 } = {}) {
    const s = state();
    if (!s.auto || busy) return;
    if (game) { goneSince = null; if (!s.on) await turnOn({ byGame: game }); return; }
    if (!s.on || !s.byGame) return;
    goneSince ??= now();
    if (now() - goneSince >= goneMs) { goneSince = null; await turnOff(`${s.byGame} ended`); }
  }
  // DeviceHub started with Gaming mode left on: everything back
  async function onStart() { if (state().on) return turnOff('DeviceHub started'); return null; }
  return { on: turnOn, off: turnOff, status, onStart, setAuto, tick };
}
