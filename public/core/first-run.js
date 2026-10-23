// Open Setup by itself on the first start (22 Oct 2026, Shawn: first setup "as simple as possible";
// docs/handoff/first-run.md). The first time DeviceHub's window opens on a PC it goes to Setup instead of the Overview;
// after that, the Overview as before. Kept in settings.json as setupSeen (the existing POST /api/settings, per PC: not
// carried to another PC by the OneDrive copy or settings sync).
//
// A PC that already has DeviceHub in use is never a first start, even without setupSeen (an older copy never wrote
// it): any device seen on this PC before (the agent's seen-devices.json), or any saved profile. That is Shawn's PC.
// No DOM here, so tests/setup-page.mjs runs it in Node.

// settings: GET /api/settings (null when it did not answer); profiles: GET /api/profiles (null when it did not answer);
// devices: the window's device list ({ id, seen } each); hash: location.hash when the window opened
export function isFirstStart({ settings, profiles, devices = [], hash = '' } = {}) {
  // the person asked for a page (a link, a reload, Search): leave them there
  if (hash && hash !== '#/' && hash !== '#/overview') return false;
  // not read: never guess
  if (!settings || typeof settings !== 'object' || !Array.isArray(profiles)) return false;
  if (settings.setupSeen === true) return false;
  if (profiles.length) return false;
  if (devices.some((d) => d?.seen)) return false;
  return true;
}

// the window, when it opens: where to go, and whether to save setupSeen. Reads two local files through the server
// (at most 2 s, then the Overview as usual). demo: never, unless ?demo&first (nothing is saved then).
// ready: false while DeviceHub's background part has not answered (its seen devices are not known yet): no decision
export async function firstStart({ demo = false, ready = true, search = '', hash = '', devices = [], fetch: get = fetch } = {}) {
  if (demo) return { setup: /[?&]first(&|=|$)/.test(search) && !hash, save: false };
  if (!ready) return { setup: false, save: false };
  const read = async (url) => { try { const r = await get(url, { signal: AbortSignal.timeout(2000) }); return r.ok ? await r.json() : null; } catch { return null; } };
  const [settings, profiles] = await Promise.all([read('/api/settings'), read('/api/profiles')]);
  const setup = isFirstStart({ settings, profiles, devices, hash });
  // saved once the window has opened here at its start (no page asked for), first start or not, so Setup opens by
  // itself at most once
  const save = !!settings && settings.setupSeen !== true && (!hash || hash === '#/' || hash === '#/overview');
  if (save) get('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupSeen: true }) }).catch(() => {});
  return { setup, save };
}
