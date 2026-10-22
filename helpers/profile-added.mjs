// Profiles for devices added in my-devices (22 Oct 2026; docs/handoff/profiles-added-devices.md). The agent applies one
// added device's part of a profile here, the same way a change on its page is made:
//   - only a device that is connected now (one not plugged in is left out quietly: no line, not counted);
//   - only settings its driver allows now: for a library driver the guard's own answer (mayWrite: passed its check,
//     Turn on settings pressed, not DeviceHub's own device), for the person's own driver its readOnly mark; never a
//     display (a reading), never a value outside the setting (my-devices fits());
//   - nothing while the maker's app is open, or when that could not be checked;
//   - a backup first (it must succeed), then one setting at a time through core.write (the driver writes and reads
//     back), and the value it confirms must be the one asked for;
//   - everything left out is named in ONE plain Activity line for the device.
// No timers and no polling: it runs only when a profile is applied (by hand or by auto-switch's existing loop).
import { planAdded, showAdded, skippedLine } from '../public/core/profiles.js';
import { fits as fitsStrict, makerAppNow as makerAppDefault } from './my-devices.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// body: { id, values, name, quiet }. deps: { core: { devices, write, backupNow, log }, makerApp(adapter), fits }.
// Returns { done, failed, skipped, absent? }.
export async function applyAdded(body, { core, makerApp = makerAppDefault, fits = fitsStrict } = {}) {
  const id = String(body?.id || '');
  const name = String(body?.name || 'profile').slice(0, 100);
  const d = core.devices[id];
  if (!d?.adapter?.plugin || d.status !== 'connected') return { done: 0, failed: 0, skipped: 0, absent: true };
  const a = d.adapter;
  const say = (text, kind = 'info') => { if (!body?.quiet) core.log(text, kind, id); };
  const { todo, skipped } = planAdded(a, body?.values, d.values, { fits, mayWrite: typeof a.mayWrite === 'function' ? a.mayWrite : undefined });
  const leaveAll = (why) => { for (const x of todo) skipped.push({ key: x.key, label: x.label, why }); todo.length = 0; };
  if (todo.length) {
    let m = {};
    try { m = (await makerApp(a)) || {}; } catch (e) { m = { unknown: e.message }; }
    if (m.app) leaveAll(`${m.app} is open: close it first`);
    else if (m.unknown) leaveAll("could not check whether the maker's app is open");
  }
  if (todo.length) {
    try { await core.backupNow(id, `before profile "${name}"`); } catch { leaveAll('no backup could be taken'); }
  }
  let done = 0, failed = 0;
  for (const x of todo) {
    const s = a.settings.find((z) => z.key === x.key);
    try {
      const got = await core.write(id, x.key, x.value, { label: x.label, display: showAdded(s, x.value), silent: true, quietFail: !!body?.quiet });
      if (same(got, x.value)) done++;
      else { failed++; say(`Profile "${name}": ${a.title}: ${x.label} read back ${showAdded(s, got)}, not ${showAdded(s, x.value)}`, 'bad'); }
    } catch { failed++; }   // core.write already said why in Activity
  }
  if (skipped.length) say(skippedLine(name, a.title, skipped));
  return { done, failed, skipped: skipped.length };
}
