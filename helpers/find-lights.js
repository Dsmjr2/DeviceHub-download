// Find my lights (22 Oct 2026, Shawn: a built-in way to do what was done by hand on his PC): every zone of one OpenRGB
// light gets its own easy-to-name color at once, the person says what lit up in each color ("Case fans", "Top logo",
// "RAM"), and DeviceHub keeps those names for that board and hides the zones that lit nothing. Then the lights go back
// exactly as they were just before the test. Only on the person's click; no timers. docs/handoff/find-lights.md.
//
//   start(target)                      one color per zone in ONE send for the light (Direct mode + every LED), read back
//   save({ target, names, hidden })    names { zoneIndex: 'name' } and hidden [zoneIndex] into lights-names.json (per
//                                      board name), then the lights put back as before the test
//   cancel()                           the lights put back as before the test, nothing saved
//   state()                            the test running now, or { running: false }
//
// It runs inside helpers/openrgb.js (create(parts) gets that file's own reading, backup, send and put-back steps), so
// the same rules hold: the first change backs the light up (backups/openrgb-*.json), every send is read back, and
// DeviceHub's own devices are never written through OpenRGB.
const { writeAtomic } = require('./safe-write');

// easy to name on a fan: the first ten in the order Shawn asked for, then more for a board with many zones
const COLORS = [
  ['Red', '#ff0000'], ['Orange', '#ff6a00'], ['Yellow', '#ffd400'], ['Green', '#00ff00'], ['Cyan', '#00ffff'],
  ['Blue', '#0000ff'], ['Purple', '#8a00ff'], ['Pink', '#ff40b0'], ['White', '#ffffff'], ['Lime', '#a0ff00'],
  ['Teal', '#00a08a'], ['Sky blue', '#0090ff'], ['Magenta', '#ff00ff'], ['Gold', '#ffa000'], ['Violet', '#c080ff'], ['Coral', '#ff6060'],
];
const OFF = '#000000';
// a name the person typed: one line, no control characters, short
const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

function create(p) {
  let test = null;   // { key, name, index, before (backup entry), zones }
  const shown = (s, list) => list.filter((c) => p.usable(s, c)).map(p.shapeOut);
  const view = () => (test ? { running: true, index: test.index, name: test.name, zones: test.zones } : { running: false });

  // one color per zone: [{ index, name, leds, color, colorName }] and every LED's color for the send
  function plan(c) {
    const zones = [], colors = [];
    let next = 0;
    c.zones.forEach((z, i) => {
      const pick = z.leds > 0 && next < COLORS.length ? COLORS[next++] : null;
      zones.push({ index: i, name: z.name, leds: z.leds, color: pick ? pick[1] : null, colorName: pick ? pick[0] : null, ...(z.leds > 0 && !pick ? { notInTest: true } : {}) });
      for (let k = 0; k < z.leds; k++) colors.push(pick ? pick[1] : OFF);
    });
    while (colors.length < c.colors.length) colors.push(OFF);   // LEDs outside every zone (none on a normal light)
    return { zones, colors: colors.slice(0, c.colors.length) };
  }

  function start(target) {
    return p.serial(() => p.withOpenRGB('write', async (s) => {
      p.writable(s);
      let list = await p.readAll(s);
      const c = list.find((x) => x.index === Number(target) && p.usable(s, x) && !p.isOwn(x));
      if (!c) throw new Error('no such OpenRGB light');
      if (!c.zones.length || !c.colors.length) throw new Error(`${c.name} has no zones to test`);
      // the same light again: its colors from before the first test stay the ones put back
      let before = test && test.key === p.keyOf(c) ? test.before : null;
      if (test && !before) { await p.putBack(s, [test.before]); test = null; list = await p.readAll(s); }
      const now = list.find((x) => p.keyOf(x) === p.keyOf(c)) || c;
      if (!before) before = p.entryOf(now);
      const backup = p.backupNew([now]);
      const { zones, colors } = plan(now);
      if (!zones.some((z) => z.color)) throw new Error(`${now.name} has no lights in its zones to test`);
      const r = await p.sendColors(s, [now], new Map([[p.keyOf(now), colors]]));
      if (r.failed.length) {
        try { await p.putBack(s, [before]); } catch {}
        test = null;
        throw new Error(`OpenRGB did not show the test colors on ${r.failed.join(', ')}`);
      }
      test = { key: p.keyOf(now), name: now.name, index: now.index, before, zones };
      p.forget();
      return { ...view(), backup, controllers: shown(s, r.list) };
    }));
  }

  // the person's answers, saved for this board: only the zones in this test change
  function writeNames(names, hidden) {
    const file = p.names.file();
    if (!file) throw new Error('DeviceHub has nowhere to keep light names on this copy');
    const tested = test.zones.filter((z) => z.color).map((z) => z.index);
    const data = p.names.read();
    const board = data.boards[test.name] || { names: {}, hidden: [] };
    board.names = board.names || {}; board.hidden = Array.isArray(board.hidden) ? board.hidden : [];
    const hide = new Set((Array.isArray(hidden) ? hidden : []).map(Number).filter((i) => tested.includes(i)));
    const saved = {};
    for (const i of tested) {
      const n = clean(names && typeof names === 'object' ? names[i] : '');
      if (n) { board.names[i] = n; saved[i] = n; } else delete board.names[i];
      board.hidden = board.hidden.filter((x) => x !== i);
      if (hide.has(i) && !n) board.hidden.push(i);
    }
    board.hidden.sort((a, b) => a - b);
    board.savedAt = new Date().toISOString();
    if (Object.keys(board.names).length || board.hidden.length) data.boards[test.name] = board; else delete data.boards[test.name];
    writeAtomic(file, JSON.stringify(data, null, 1));
    p.names.reload();
    return { names: saved, hidden: [...hide].filter((i) => !saved[i]).sort((a, b) => a - b) };
  }

  function save({ target, names, hidden } = {}) {
    if (!test) return Promise.reject(new Error('The light test is not running now: press Find my lights again.'));
    if (target !== undefined && target !== null && Number(target) !== test.index) return Promise.reject(new Error('That is not the light being tested.'));
    return p.serial(() => p.withOpenRGB('write', async (s) => {
      p.writable(s);
      const saved = writeNames(names, hidden);
      let r;
      try { r = await p.putBack(s, [test.before]); }
      catch (e) { p.forget(); throw new Error(`Names saved, but the lights were not put back (${e.message}). Press Cancel to try again.`); }
      const name = test.name;
      test = null;
      p.forget();
      return { saved, name, restored: true, controllers: shown(s, r.list) };
    }));
  }

  function cancel() {
    if (!test) return Promise.reject(new Error('no light test is running'));
    return p.serial(() => p.withOpenRGB('write', async (s) => {
      p.writable(s);
      const r = await p.putBack(s, [test.before]);
      test = null;
      p.forget();
      return { restored: true, controllers: shown(s, r.list) };
    }));
  }

  return { start, save, cancel, state: view };
}

module.exports = { create, COLORS };
