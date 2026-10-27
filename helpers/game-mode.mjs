// Game mode (27 Oct 2026, Shawn: "when a game starts, switch to that game's setup; when it quits, put everything back
// exactly as it was"). It extends auto-switch (public/core/autoswitch.js) on the Profiles page: auto-switch moves
// between whole profiles, game mode changes only the few things the person picked for one game and puts back what was
// there before. A game set up here is left out of auto-switch, so one game is never handled by both.
//   game-mode.json        { games: [{ id, name, exes: ['valorant-win64-shipping.exe'], setup: { dpi, polling, lights,
//                           eq, hdr, quiet } }] }; a switch left out of setup is "Keep as is"
//   game-mode-state.json  what was there before (before), what was set (applied), the set-up games running in the
//                         order they started (order): saved BEFORE each change, so a restart or sleep mid-game still
//                         puts everything back on the next start once the game is gone
// The rules: before a switch changes, its current value is read and saved (state file + backups\game-mode-*.json);
// one switch at a time, each write confirms itself by reading back; on quit each saved value goes back the same way.
// Two games: both games' switches, the newest one's where both pick one; what was there before the FIRST comes back at
// the end (and when one quits, only the switches the other game still picks stay).
// Nothing runs for a game that is not set up, and with no game set up nothing is checked at all.
// No DOM, no Windows calls here: helpers/agent.mjs passes the real switches, tests/game-mode.mjs stand-ins.

export const SWITCHES = ['dpi', 'polling', 'lights', 'eq', 'hdr', 'quiet'];
export const LABELS = { dpi: 'DPI', polling: 'Polling rate', lights: 'Lights', eq: 'EQ', hdr: 'HDR', quiet: 'Notifications' };
const POLLS = [125, 250, 500, 1000, 2000, 4000, 8000];
const lower = (s) => String(s || '').trim().toLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// one switch's value as the person set it, or undefined (Keep as is / not a value it takes)
function cleanValue(k, v) {
  if (v == null) return undefined;
  if (k === 'dpi') return Number.isInteger(v) && v >= 50 && v <= 26000 ? v : undefined;
  if (k === 'polling') return POLLS.includes(v) ? v : undefined;
  if (k === 'lights') return /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : undefined;
  if (k === 'eq') return typeof v === 'string' && v && v.length <= 80 ? v : undefined;
  if (k === 'hdr') return v && typeof v === 'object' && typeof v.screen === 'string' && v.screen && typeof v.on === 'boolean'
    ? { id: typeof v.id === 'string' ? v.id.slice(0, 200) : '', screen: v.screen.slice(0, 80), name: String(v.name || '').slice(0, 80), on: v.on } : undefined;
  if (k === 'quiet') return v === true ? true : undefined;
  return undefined;
}
// the games list as saved: names, program names and only the switches that hold a value
export function cleanGames(list) {
  if (!Array.isArray(list)) throw new Error('send the whole games list');
  if (list.length > 50) throw new Error('at most 50 games');
  const ids = new Set();
  return list.map((g, i) => {
    const name = String(g?.name || '').trim().slice(0, 60);
    if (!name) throw new Error('every game needs a name');
    const exes = [...new Set((Array.isArray(g.exes) ? g.exes : []).map(lower).filter((x) => /^[^\\/:*?"<>|]{1,80}\.exe$/.test(x)))].slice(0, 30);
    if (!exes.length) throw new Error(`${name}: no program to look for`);
    let id = /^[a-z0-9-]{1,40}$/.test(String(g.id || '')) ? g.id : `g${Date.now().toString(36)}${i}`;
    while (ids.has(id)) id = `${id}x`.slice(-40);
    ids.add(id);
    const setup = {};
    for (const k of SWITCHES) { const v = cleanValue(k, g.setup?.[k]); if (v !== undefined) setup[k] = v; }
    return { id, name, exes, setup, ...(g.source ? { source: String(g.source).slice(0, 20) } : {}) };
  });
}
const emptyState = () => ({ order: [], before: {}, applied: {}, active: null });
function cleanState(s) {
  const o = emptyState();
  if (!s || typeof s !== 'object') return o;
  if (Array.isArray(s.order)) o.order = s.order.filter((x) => typeof x === 'string');
  for (const k of SWITCHES) { if (s.before && Object.hasOwn(s.before, k)) o.before[k] = s.before[k]; if (s.applied && Object.hasOwn(s.applied, k)) o.applied[k] = s.applied[k]; }
  if (s.active && typeof s.active.name === 'string') o.active = { id: String(s.active.id || ''), name: s.active.name };
  return o;
}

// switches: { <key>: { read(target) -> value now | undefined (not there now), same?(value) -> true when already so,
//   write(value, before) (confirms by reading back; throws when it did not take), wait?() -> why to wait | null } }
// store: { games() -> list, state() -> saved state | null, save(state), backup(data) }
export function createGameMode({ switches, store, procs, log = () => {}, busy = () => null, onChange = () => {}, maxTries = 3 }) {
  let state = cleanState(store.state());
  let ticking = false;
  const fails = {};          // key -> failed writes in a row (this run); at maxTries it is left alone until a restart
  const told = new Set();    // the one Activity line per reason to wait, per key
  let games = [];
  const reload = () => { try { games = cleanGames(store.games() || []); } catch { games = []; } };
  reload();
  const setUp = () => games.filter((g) => Object.keys(g.setup).length);
  const exes = () => new Set(setUp().flatMap((g) => g.exes));
  const save = () => store.save(state);
  // anything to look at: a game set up, or something still to put back
  const needed = () => setUp().length > 0 || state.order.length > 0 || Object.keys(state.before).length > 0;

  async function tick() {
    if (ticking || !needed()) return { idle: !needed() };
    ticking = true;
    try { return await step(); } finally { ticking = false; }
  }

  async function step() {
    let names;
    try { names = new Set((await procs()).map(lower)); } catch { return { skipped: 'no program list' }; }   // no list: change nothing
    const byId = new Map(setUp().map((g) => [g.id, g]));
    const runs = (g) => g.exes.some((x) => names.has(x));
    const order = state.order.filter((id) => byId.has(id) && runs(byId.get(id)));
    const started = setUp().filter((g) => runs(g) && !order.includes(g.id));
    order.push(...started.map((g) => g.id));
    const closed = state.order.filter((id) => !order.includes(id));
    if (!same(order, state.order)) { state.order = order; save(); }
    const top = order.length ? byId.get(order[order.length - 1]) : null;
    // every running set-up game's switches, the newest game's winning where two pick the same one
    const target = Object.assign({}, ...order.map((id) => byId.get(id).setup));
    const why = busy();
    if (why) return { waiting: why };
    const r = { applied: 0, restored: 0, failed: 0, waiting: 0 };
    let backupData = null;
    const keep = (k, v) => {   // the value before, saved to disk before anything changes
      state.before[k] = v; save();
      backupData ||= { at: new Date().toISOString(), why: `before ${top.name} game mode`, game: top.name, before: {} };
      backupData.before[k] = v;
      store.backup(backupData);
    };
    // what the game no longer sets (it closed, or the newer game does not set it): put back first
    for (const k of Object.keys(state.before)) {
      if (Object.hasOwn(target, k) && switches[k]) continue;
      const out = await putBack(k);
      if (out) r[out]++;
    }
    for (const [k, v] of Object.entries(target)) {
      const out = await setOne(k, v, keep);
      if (out) r[out]++;
    }
    const wasActive = state.active;
    const nowActive = top ? { id: top.id, name: top.name } : null;
    if (!same(wasActive, nowActive)) {
      if (nowActive) log(`${nowActive.name} started · game mode on`, 'good');
      else if (wasActive && !Object.keys(state.before).length) log(`${wasActive.name} closed · settings put back`, 'good');
      if (nowActive || !Object.keys(state.before).length) { state.active = nowActive; save(); onChange(); }
    }
    if (!order.length && !Object.keys(state.before).length && Object.keys(state.applied).length) { state.applied = {}; save(); }
    return { ...r, top: top?.id || null, started: started.map((g) => g.id), closed };
  }

  async function waitWhy(k, sw) {
    const why = sw.wait ? await sw.wait() : null;
    if (why && !told.has(`${k}|${why}`)) { told.add(`${k}|${why}`); log(`Game mode: ${LABELS[k]} waits (${why})`, 'info'); }
    return why;
  }

  async function setOne(k, v, keep) {
    const sw = switches[k];
    if (!sw) return null;
    if (Object.hasOwn(state.applied, k) && same(state.applied[k], v)) return null;   // set already (a later change by hand is left alone)
    if ((fails[k] || 0) >= maxTries) return null;
    if (await waitWhy(k, sw)) return 'waiting';
    let now;
    try { now = await sw.read(v); } catch { return 'waiting'; }
    if (now === undefined) return 'waiting';   // not there now (asleep, unplugged, no Equalizer APO): the next check
    if (!Object.hasOwn(state.before, k)) keep(k, now);
    try {
      if (!(sw.same && await sw.same(v, now))) await sw.write(v, state.before[k]);
      state.applied[k] = v; fails[k] = 0; save();
      return 'applied';
    } catch (e) {
      fails[k] = (fails[k] || 0) + 1;
      if (fails[k] >= maxTries) log(`Game mode: ${LABELS[k]} did not change (${e.message})`, 'bad');
      return 'failed';
    }
  }

  async function putBack(k) {
    const sw = switches[k];
    const v = state.before[k];
    if (!sw) { delete state.before[k]; delete state.applied[k]; save(); return null; }
    if ((fails[`back|${k}`] || 0) >= maxTries) return null;
    if (await waitWhy(k, sw)) return 'waiting';
    try {
      let now;
      try { now = await sw.read(v); } catch { return 'waiting'; }
      if (now === undefined) return 'waiting';
      if (!(sw.same && await sw.same(v, now))) await sw.write(v, v);
      delete state.before[k]; delete state.applied[k]; fails[`back|${k}`] = 0; save();
      return 'restored';
    } catch (e) {
      fails[`back|${k}`] = (fails[`back|${k}`] || 0) + 1;
      // kept in the state file: the next DeviceHub start tries again
      if (fails[`back|${k}`] >= maxTries) log(`Game mode: ${LABELS[k]} could not be put back (${e.message})`, 'bad');
      return 'failed';
    }
  }

  return {
    tick, reload, needed, exes,
    games: () => games,
    // for the window: the game whose setup is on now ("Valorant mode on"), and whether something waits to go back
    status: () => ({ active: state.active, restoring: !state.order.length && Object.keys(state.before).length > 0, saved: Object.keys(state.before) }),
  };
}
