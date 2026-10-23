// A device plugged in while DeviceHub runs (23 Oct 2026, Shawn: "have them connect and wait"). Windows says a device
// was added (helpers/native/tray.cs DeviceWatch, the agent's 'dev' event); a moment later this looks at the USB list
// again and, for each id that was not there before:
//   - a shared library driver for it is installed and loaded at once (helpers/auto-setup.mjs, the same run as at
//     DeviceHub's start, read-only until Turn on settings as always), and the window says so;
//   - else, a mouse, keyboard or headset of a brand DeviceHub knows (docs/brands.json), not a refused vendor and with
//     no driver of the person's own: the window offers Learn it for me (helpers/learn-auto.mjs). Nothing starts by
//     itself: learning needs the person (the maker's app, Windows' prompt).
// Ids that were there when DeviceHub started are never announced; each new id once per run.
import { brandsByVid, startup } from './auto-setup.mjs';
import { vendorRefusal, deps as wizardDeps } from './learn-wizard.mjs';

const idOf = (u) => `${String(u.vid).toUpperCase().padStart(4, '0')}:${String(u.pid).toUpperCase().padStart(4, '0')}`;

// the new ids in this USB list, and the list remembered for next time
export function newIds(prev, usb) {
  const now = new Set((usb || []).map(idOf));
  return { added: prev ? [...now].filter((k) => !prev.has(k)) : [], now };
}
// what to tell the window about each new id: [{ vid, pid, name, brand, installed?: { name, id }, learn?: true }]
export function describe(added, { usb = [], rec = null, brands = {}, own = { mine: [], copies: [] } } = {}) {
  const out = [];
  const mine = new Set([...(own.mine || []), ...(own.copies || []).flatMap((c) => c.ids || [])].map((x) => String(x).toUpperCase()));
  for (const k of added) {
    const u = usb.find((x) => idOf(x) === k);
    if (!u || u.runs) continue;
    const [vid, pid] = k.split(':');
    const inst = (rec?.lastRun?.installed || []).find((x) => (x.usb || []).map((y) => y.toUpperCase()).includes(k));
    const b = brands[vid.toLowerCase()];
    const name = u.name || (b ? `${b.name} device` : `USB device ${k}`);
    if (inst) { out.push({ vid, pid, name: inst.product || name, brand: b?.name || null, installed: { name: inst.name, id: inst.id || null } }); continue; }
    if (mine.has(k) || !b || b.shared || vendorRefusal(vid)) continue;
    if (!b.kinds.some((x) => ['mouse', 'keyboard', 'headset'].includes(x))) continue;
    out.push({ vid, pid, name, brand: b.name, learn: true });
  }
  return out;
}

// the agent's side: start() once (the list as DeviceHub found it), then check() on each device change
export function watcher({ root, pcMap, log = () => {}, send = () => {}, setup = startup, owned = (r) => wizardDeps.owned(r), brands = () => brandsByVid(root) }) {
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
      const said = describe(fresh, { usb, rec, brands: brands(), own });
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
