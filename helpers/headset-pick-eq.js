// Equalizer APO follows the headset picked on the Headset page (22 Oct 2026, public/core/headset-pick.js).
// server.js's eqDevices() names the HS80 (else the first USB headset) as "the headset". When another USB headset was
// picked (settings.json "headsetPick") and Windows has it, its sound devices take that place: the EQ, mic boost and
// mic filters play on it, and it is no longer listed as a speaker or a mic of its own. No pick, or "hs80": unchanged.
const fs = require('fs');
const path = require('path');

const guidOf = (id) => String(id).slice(String(id).indexOf('}.') + 2);
const SETTINGS = path.join(__dirname, '..', 'settings.json');
const readPick = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).headsetPick || null; } catch { return null; } };
// the native helper's USB headset list, through the Corsair helper server.js already loaded (loaded here only when used)
const listHeadsets = async () => (await require('./corsair').handle('usb-headsets', {})).headsets || [];

// devices: server.js's eqDevices; returns the same kind of function, with the pick applied
function withPick(devices, opts = {}) {
  const read = opts.readPick || readPick, list = opts.listHeadsets || listHeadsets, maxAge = opts.maxAge ?? 60000;
  let cache = null;   // { pick, at, h }: Windows' list is asked at most once a minute, and again when the pick changes
  return async () => {
    const ctx = await devices();
    const raw = read();
    const pick = typeof raw === 'string' ? raw.toUpperCase() : null;
    if (!pick || pick === 'HS80') return ctx;
    if (!cache || cache.pick !== pick || Date.now() - cache.at > maxAge) {
      let all = [];
      try { all = await list(); } catch {}
      cache = { pick, at: Date.now(), h: all.find((x) => String(x.usb || '').toUpperCase() === pick) || null };
    }
    const h = cache.h;
    if (!h) return ctx;  // not plugged in: as before
    const headset = (h.playback || []).map((e) => guidOf(e.id)), mic = (h.recording || []).map((e) => guidOf(e.id));
    if (!headset.length) return ctx;
    return { ...ctx, headset, mic, headsetModel: h.device || h.usb,
      speakers: (ctx.speakers || []).filter((s) => !headset.includes(s.guid)), mics: (ctx.mics || []).filter((m) => !mic.includes(m.guid)) };
  };
}
module.exports = { withPick, guidOf };
