// A device plugged in while DeviceHub runs (23 Oct 2026, Shawn: "have them connect and wait"). Windows says a device
// was added (helpers/native/tray.cs DeviceWatch, the agent's 'dev' event); a moment later this looks at the USB list
// again and, for each id that was not there before:
//   - a shared library driver for it is installed and loaded at once (helpers/auto-setup.mjs, the same run as at
//     DeviceHub's start, read-only until Turn on settings as always), and the window says so;
//   - else, a mouse, keyboard or headset of a brand DeviceHub knows (docs/brands.json), not a refused vendor and with
//     no driver of the person's own: the window offers Learn it for me (helpers/learn-auto.mjs). Nothing starts by
//     itself: learning needs the person (the maker's app, Windows' prompt).
// Ids that were there when DeviceHub started are never announced; each new id once per run.
import fs from 'node:fs';
import path from 'node:path';
import { brandsByVid, startup } from './auto-setup.mjs';
import { vendorRefusal, deps as wizardDeps, settable } from './learn-wizard.mjs';

const idOf = (u) => `${String(u.vid).toUpperCase().padStart(4, '0')}:${String(u.pid).toUpperCase().padStart(4, '0')}`;

// the new ids in this USB list, and the list remembered for next time
export function newIds(prev, usb) {
  const now = new Set((usb || []).map(idOf));
  return { added: prev ? [...now].filter((k) => !prev.has(k)) : [], now };
}
// what to tell the window about each new id: [{ vid, pid, name, brand, installed?: { name, id }, learn?: true }]
// onlyIfFound(name, id): the driver lists that id as one its device is only maybe on (device.json onlyIfFound: the Logitech
// keyboard driver on a LIGHTSPEED receiver that most often holds only a mouse). It is never announced for that id; the
// device shows once its driver finds it (helpers/my-devices.mjs isAbsent).
export const metaOnlyIfFound = (root) => (name, id) => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'my-devices', String(name), 'device.json'), 'utf8'));
    return (m.onlyIfFound || []).some((p) => String(p).toUpperCase() === String(id).split(':')[1]);
  } catch { return false; }
};
// canSet(id): true / false from the device's own HID collections (learn-wizard settable: a settings channel), null when
// not read; a device with nothing to set is never offered Learn (24 Oct 2026: a plain keyboard or a G HUB virtual device)
export function describe(added, { usb = [], rec = null, brands = {}, own = { mine: [], copies: [] }, onlyIfFound = () => false, canSet = () => null } = {}) {
  const out = [];
  const mine = new Set([...(own.mine || []), ...(own.copies || []).flatMap((c) => c.ids || [])].map((x) => String(x).toUpperCase()));
  for (const k of added) {
    const u = usb.find((x) => idOf(x) === k);
    if (!u || u.runs) continue;
    const [vid, pid] = k.split(':');
    const all = (rec?.lastRun?.installed || []).filter((x) => (x.usb || []).map((y) => y.toUpperCase()).includes(k));
    const inst = all.find((x) => !onlyIfFound(x.name, k));
    if (all.length && !inst) continue;   // only a maybe driver went in for it: nothing to say until it finds its device
    const b = brands[vid.toLowerCase()];
    const name = u.name || (b ? `${b.name} device` : `USB device ${k}`);
    if (inst) { out.push({ vid, pid, name: inst.product || name, brand: b?.name || null, installed: { name: inst.name, id: inst.id || null, proven: !!inst.proven } }); continue; }
    if (mine.has(k) || !b || b.shared || vendorRefusal(vid)) continue;
    if (!b.kinds.some((x) => ['mouse', 'keyboard', 'headset'].includes(x))) continue;
    if (canSet(k) === false) continue;
    out.push({ vid, pid, name, brand: b.name, learn: true });
  }
  return out;
}

// the agent's side: start() once (the list as DeviceHub found it), then check() on each device change
// hid(): the HID collections (learn-wizard's listHid, read only), asked only when something new was plugged in
export function watcher({ root, pcMap, log = () => {}, send = () => {}, setup = startup, owned = (r) => wizardDeps.owned(r), brands = () => brandsByVid(root), hid = () => wizardDeps.listHid() }) {
  let prev = null, busy = false, again = false;
  const seen = new Set();
  const check = async () => {
    if (busy) { again = true; return []; }
    busy = true;
    try {
      const usb = (await pcMap.get(true)).usb || [];
      const { added, now } = newIds(prev, usb);
      prev = now;
      const fresh = added.filter((k) => !seen.has(k));
      if (!fresh.length) return [];
      fresh.forEach((k) => seen.add(k));
      let rec = null;
      try { rec = await setup({ root, pcMap, log }); } catch (e) { console.error('[plug] auto setup:', e.message); }
      let own = { mine: [], copies: [] };
      try { own = owned(root); } catch {}
      // every collection by id (not only the writable ones); an id not listed yet (Windows still adding it) is unknown
      let cols = null;
      try {
        cols = new Map();
        for (const c of [].concat((await hid())?.collections || [])) {
          if (!c?.vid || !c?.pid) continue;
          const id = `${String(c.vid).toUpperCase().padStart(4, '0')}:${String(c.pid).toUpperCase().padStart(4, '0')}`;
          if (!cols.has(id)) cols.set(id, []);
          cols.get(id).push({ page: String(c.page || '0').toUpperCase().padStart(4, '0'), outLen: c.outLen || 0, featLen: c.featLen || 0 });
        }
      } catch { cols = null; }
      const canSet = (k) => (cols?.has(k.toUpperCase()) ? settable(cols.get(k.toUpperCase())) : null);
      const said = describe(fresh, { usb, rec, brands: brands(), own, onlyIfFound: metaOnlyIfFound(root), canSet });
      for (const x of said) {
        console.log(`[plug] ${x.vid}:${x.pid} ${x.name}: ${x.installed ? `library driver ${x.installed.name} installed` : 'can be learned'}`);
        send('newdevice', x);
      }
      return said;
    } finally {
      busy = false;
      if (again) { again = false; setTimeout(() => check().catch(() => {}), 500); }
    }
  };
  return {
    start: async () => { try { prev = newIds(null, (await pcMap.get(true)).usb || []).now; } catch {} },
    check,
  };
}
