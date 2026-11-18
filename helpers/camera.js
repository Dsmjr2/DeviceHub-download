// Webcam picture settings (20 Oct 2026): brightness, contrast, zoom, focus and the rest, through the helper's
// "camera" channel (helpers/camera.cs: Windows' own DirectShow camera controls; nothing installed). The same rules as
// the devices: the camera's values are backed up before each change (backups/camera-<name>-<time>.json), one control
// is set at a time and read back, and a value outside the camera's own range is refused.
const path = require('path');
const { writeAtomic } = require('./safe-write');

let native = null, backupDir = null, cache = { at: 0, list: null }, busy = Promise.resolve();
const backedUpAt = new Map();   // camera id -> when its last backup was written
const serial = (f) => { const p = busy.then(f, f); busy = p.catch(() => {}); return p; };
const call = async (q, ms = 15000) => {
  if (!native) throw new Error('the device helper is not running');
  const raw = await native.request('camera', JSON.stringify(q), ms);
  // the helper is not running (GONE) or did not answer in time (TIMEOUT): say so in words (20 Oct 2026)
  if (raw === 'GONE' || raw === 'TIMEOUT') throw new Error(raw === 'GONE' ? 'the device helper is not running' : 'no answer in time');
  let r;
  try { r = JSON.parse(raw); } catch { throw new Error('camera returned unreadable data'); }
  if (!r || typeof r !== 'object') throw new Error('camera returned unreadable data');
  if (!r.ok) throw new Error(r.error || 'camera error');
  return r;
};
// a camera's own name, and Windows' device path as its id
const shape = (c) => ({ id: c?.path || '', name: c?.name || '', controls: (c?.controls && typeof c.controls === 'object') ? c.controls : {} });
const isVirtual = (c) => (!c.id && !Object.keys(c.controls).length) || /virtual cam/i.test(c.name || '');

async function list(fresh) {
  if (!fresh && cache.list && Date.now() - cache.at < 10000) return cache.list;
  return serial(async () => {
    const r = await call({ op: 'cameras' }, 20000);
    // a software camera (OBS Virtual Camera, 3 Nov 2026: it showed as "Camera: No picture settings" once OBS was in) has
    // no device path and nothing to set: it is not a webcam, so it is left out
    cache = { at: Date.now(), list: (Array.isArray(r.cameras) ? r.cameras : []).filter(Boolean).map(shape).filter((c) => !isVirtual(c)) };
    return cache.list;
  });
}

// key: a control the camera listed; value: a number in its range (manual), or auto: true / false
async function set(id, key, value, auto) {
  // read just before the change: the backup and the value kept are the camera's values now (auto ones drift)
  const all = await list(true);
  const cam = all.find((c) => c.id === id);
  if (!cam) throw new Error('camera not found');
  const cur = cam.controls[key];
  if (!cur) throw new Error(`this camera does not offer ${key}`);
  if (auto && !cur.canAuto) throw new Error(`${key} has no auto`);
  // turning Auto on sends a value in range with it (a camera on Auto can read outside its own range, e.g. white balance 168)
  const rawAuto = Number.isFinite(cur.value) ? cur.value : cur.min;
  const v = auto ? Math.round(Math.min(cur.max, Math.max(cur.min, rawAuto))) : value;
  if (!Number.isInteger(v) || v < cur.min || v > cur.max) throw new Error(`${key} must be ${cur.min}-${cur.max}`);
  // changes seconds apart (a slider dragged) share the backup taken before the first (21 Oct 2026)
  // never written without a backup first (15 Nov 2026 review of PR #12: it skipped the backup when no folder was set)
  if (!backupDir) throw new Error('not changed: there is no backup folder to keep the camera settings in first');
  if (!(Date.now() - (backedUpAt.get(id) || 0) < 15000)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeAtomic(path.join(backupDir, `camera-${cam.name.replace(/[^\w-]/g, '') || 'unknown'}-${stamp}.json`),
      JSON.stringify({ at: new Date().toISOString(), camera: cam.name, id: cam.id, controls: cam.controls }, null, 1));
    backedUpAt.set(id, Date.now());
  }
  const r = await serial(() => call({ op: 'camera-set', path: id, key, value: v, auto: !!auto }));
  const controls = r.controls && typeof r.controls === 'object' ? r.controls : {};
  const after = controls[key];
  cam.controls = controls; cache.at = Date.now();
  if (!after) throw new Error('the camera did not answer the read-back');
  if (auto ? !after.auto : (after.auto || after.value !== v)) throw new Error(`the camera reads ${after.auto ? 'auto' : after.value} after setting ${auto ? 'auto' : v}`);
  return { name: cam.name, key, value: after.value, auto: after.auto };
}

module.exports = { start(nat, dir) { native = nat; backupDir = dir; cache = { at: 0, list: null }; backedUpAt.clear(); }, list, set, isVirtual };
