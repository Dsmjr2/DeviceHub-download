// Game mode on this PC (27 Oct 2026; the rules are in helpers/game-mode.mjs): the real switches, the files, and the
// check every ~5 s (x3 on battery with the battery saver) that runs only while a game is set up or something waits to
// go back. Each switch goes through the path its page already uses:
//   dpi, polling  the mouse (public/core/devices.js write: backed up, written, read back), DPI = the active stage's
//   lights        one color on the keyboard and headset (as the Lighting page), and the PC lights through OpenRGB
//                 when it runs (helpers/openrgb.js capture / putBackAll keep every light's mode and colors)
//   eq            the Equalizer APO preset (/api/eq, /api/eq/activate; never while an EQ change is unsaved)
//   hdr           one screen's HDR (/api/display/set; never while a display change waits for Keep)
//   quiet         Windows notifications off (helpers/notifications.js: the per-user ToastEnabled value)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createGameMode } from './game-mode.mjs';

const require = createRequire(import.meta.url);
const { writeAtomic } = require('./safe-write.js');
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export function realSwitches({ core, api, openrgb = require('./openrgb.js'), notifications = require('./notifications.js') }) {
  const dev = (id) => (core.devices[id]?.status === 'connected' ? core.devices[id] : null);
  // one confirmed write: the device's own read-back value must be the one asked for
  const put = async (id, key, value, label, display) => {
    const back = await core.write(id, key, value, { label, display: String(display), silent: true, quietFail: true, noUndo: true });
    if (JSON.stringify(back) !== JSON.stringify(value)) throw new Error(`${label} read back as ${back}`);
  };
  const mouse = () => { const d = dev('mouse'); return d && d.values?.dpiStage != null ? d : null; };
  const dpiKey = (d, v) => `dpi${(typeof v === 'number' ? d.values.dpiStage : v.stage) - 1}`;

  const KB = ['hue', 'saturation', 'brightness'];
  const kb = () => { const d = dev('keyboard'); return d && d.adapter.hasLighting?.() && KB.every((k) => d.values?.[k] != null) ? d : null; };
  const hs = () => { const d = dev('headset'); return d && d.adapter.hasLighting?.() && d.values?.led ? d : null; };
  // a color keeps the keyboard's own brightness (only hue and saturation change); Off is brightness 0
  const kbWant = (d, hex) => (hex === '#000000' ? [['brightness', 0]] : d.adapter.lightingKeys(...hexToRgb(hex), 100).filter(([k]) => k !== 'brightness'));

  const display = async () => api('/api/display');
  const screenOf = (list, v) => (list?.screens || []).find((s) => (v.id && s.id === v.id)) || (list?.screens || []).find((s) => s.screen === v.screen) || null;

  return {
    dpi: {
      read: () => { const d = mouse(); const v = d?.values[`dpi${d.values.dpiStage - 1}`]; return v == null ? undefined : { stage: d.values.dpiStage, dpi: v }; },
      same: (v) => { const d = mouse(); return !!d && d.values[dpiKey(d, v)] === (typeof v === 'number' ? v : v.dpi); },
      write: async (v) => { const d = mouse(); if (!d) throw new Error('the mouse is not connected'); const key = dpiKey(d, v); const n = typeof v === 'number' ? v : v.dpi; await put('mouse', key, n, `DPI stage ${Number(key.slice(3)) + 1}`, `${n} DPI`); },
    },
    polling: {
      read: () => { const d = dev('mouse'); return d?.values?.pollingRate ?? undefined; },
      same: (v) => dev('mouse')?.values?.pollingRate === v,
      write: (v) => put('mouse', 'pollingRate', v, 'Polling rate', `${v} Hz`),
    },
    lights: {
      // what each light is now; undefined when no light is there to change
      async read() {
        const out = {};
        const k = kb(); if (k) out.keyboard = Object.fromEntries(KB.map((x) => [x, k.values[x]]));
        const h = hs(); if (h) out.headset = h.values.led;
        try { out.pc = await openrgb.capture(); } catch { /* OpenRGB not running or read-only: PC lights are left as they are */ }
        return Object.keys(out).length ? out : undefined;
      },
      // the PC lights cannot be compared cheaply, so with them in the saved value it always writes (each part confirms)
      same(v, now) {
        if (now?.pc || v?.pc) return false;
        const k = kb(), h = hs();
        if (typeof v === 'string') return (!k || kbWant(k, v).every(([x, n]) => k.values[x] === n)) && (!h || String(h.values.led).toLowerCase() === v);
        return (!v.keyboard || (k && KB.every((x) => k.values[x] === v.keyboard[x]))) && (!v.headset || (h && String(h.values.led).toLowerCase() === String(v.headset).toLowerCase()));
      },
      async write(v, before) {
        const k = kb(), h = hs();
        if (typeof v === 'string') {
          if (k && before?.keyboard) for (const [x, n] of kbWant(k, v)) await put('keyboard', x, n, `Lighting ${x}`, n);
          if (h && before?.headset) await put('headset', 'led', v, 'LED color', v);
          if (before?.pc) await openrgb.setColor('all', v);
          return;
        }
        if (v.keyboard && k) for (const x of KB) if (k.values[x] !== v.keyboard[x]) await put('keyboard', x, v.keyboard[x], `Lighting ${x}`, v.keyboard[x]);
        if (v.headset && h) await put('headset', 'led', v.headset, 'LED color', v.headset);
        if (v.pc?.length) await openrgb.putBackAll(v.pc);
      },
    },
    eq: {
      async wait() { try { const r = await api('/api/eq'); return r.unsaved ? 'an EQ change is not saved' : null; } catch { return null; } },
      async read() { try { const r = await api('/api/eq'); return r.engine === 'eqapo' && r.activeId ? r.activeId : undefined; } catch { return undefined; } },
      same: async (id, now) => now === id,
      async write(id) {
        const r = await api('/api/eq');
        if (!(r.presets || []).some((p) => p.id === id)) throw new Error('that EQ preset is gone');
        await api('/api/eq/activate', { id });
        if ((await api('/api/eq')).activeId !== id) throw new Error('Equalizer APO shows another preset');
      },
    },
    hdr: {
      async wait() { try { return (await api('/api/display/state')).pending ? 'a display change waits for Keep' : null; } catch { return null; } },
      async read(v) { const s = screenOf(await display(), v); return s?.hdr?.supported ? { id: s.id, screen: s.screen, name: s.name, on: !!s.hdr.on } : undefined; },
      same: async (v, now) => !!now && now.on === v.on,
      async write(v) {
        const s = screenOf(await display(), v);
        if (!s) throw new Error('that screen is not there now');
        await api('/api/display/set', { screen: s.screen, kind: 'hdr', value: v.on });
        const after = screenOf(await display(), v);
        if (!after?.hdr || after.hdr.on !== v.on) throw new Error(`Windows did not take HDR ${v.on ? 'on' : 'off'}`);
      },
    },
    quiet: {
      // { value: 1 | 0 | null (not set: Windows' default, on) }; paused = 0
      read: async () => ({ value: await notifications.read() }),
      same: async (v, now) => (v === true ? now.value === 0 : now.value === v.value),
      async write(v) {
        const want = v === true ? 0 : v.value;
        await notifications.set(want);
        if ((await notifications.read()) !== want) throw new Error('Windows shows another value');
      },
    },
  };
}

// "Use now's settings" on the Profiles page: what each switch is now, in the shape a game's setup keeps (null = not
// there now). hdr: every screen that offers HDR, so the page can pick the one the game's setup names.
export async function nowValues({ core, api, notifications = require('./notifications.js') }) {
  const m = core.devices.mouse?.status === 'connected' ? core.devices.mouse.values || {} : {};
  const h = core.devices.headset?.status === 'connected' && core.devices.headset.adapter.hasLighting?.() ? core.devices.headset.values?.led : null;
  let eq = null, screens = [], quiet = null;
  try { const r = await api('/api/eq'); if (r.engine === 'eqapo') eq = r.activeId || null; } catch {}
  try { screens = ((await api('/api/display')).screens || []).filter((s) => s.hdr?.supported).map((s) => ({ id: s.id, screen: s.screen, name: s.name, on: !!s.hdr.on })); } catch {}
  try { quiet = (await notifications.read()) === 0; } catch {}
  return {
    dpi: m.dpiStage != null ? m[`dpi${m.dpiStage - 1}`] ?? null : null,
    polling: m.pollingRate ?? null,
    lights: typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : null,
    eq, screens, quiet,
  };
}

// started by helpers/agent.mjs; returns the engine (status for the window, reload after a save, exes for auto-switch)
export function startGameMode({ core, api, root, log, every = (ms) => ms, onChange = () => {}, procs, profileBusy = () => false }) {
  const GAMES = path.join(root, 'game-mode.json'), STATE = path.join(root, 'game-mode-state.json'), BACKUPS = path.join(root, 'backups');
  let backupFile = null, backupAt = null;
  const gm = createGameMode({
    switches: realSwitches({ core, api }),
    store: {
      games: () => readJson(GAMES)?.games || [],
      state: () => readJson(STATE),
      save: (s) => { try { writeAtomic(STATE, JSON.stringify(s, null, 1)); } catch (e) { console.error('[game-mode] state', e.message); } },
      // one backup file per game start (the same file grows while that start saves more values)
      backup: (data) => {
        try {
          if (backupAt !== data.at) { backupAt = data.at; backupFile = path.join(BACKUPS, `game-mode-${data.at.replace(/[:.]/g, '-')}.json`); }
          fs.mkdirSync(BACKUPS, { recursive: true }); writeAtomic(backupFile, JSON.stringify(data, null, 1));
        } catch (e) { console.error('[game-mode] backup', e.message); }
      },
    },
    procs,
    log: (text, kind) => log(text, kind),
    // a device change in progress (a page, a profile, a restore): look again on the next check
    busy: () => (core.isBusy() || profileBusy() ? 'a device change is in progress' : null),
    onChange,
  });
  const loop = () => setTimeout(async () => { try { await gm.tick(); } catch (e) { console.error('[game-mode]', e.message); } loop(); }, every(5000));
  loop();
  return gm;
}
