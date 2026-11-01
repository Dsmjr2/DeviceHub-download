// Restart DeviceHub from the window (1 Nov 2026, a new-setup audit: several notes said "Restart DeviceHub" and nothing
// did it). POST /api/restart stops it cleanly and the keep-running loop starts it again (server.js); this waits until it
// has gone and come back, then reloads the window so added devices and layouts show.
import { button } from '../ui/controls.js';
import { toast } from '../ui/overlay.js';

const answers = async () => { try { return (await fetch('/api/version', { cache: 'no-store' })).ok; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function restartHub() {
  try { const r = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!r.ok) throw new Error(r.statusText); }
  catch (e) { toast('DeviceHub did not restart', 'bad', { detail: `${e.message}. Quit from the tray icon, then open DeviceHub again.` }); return false; }
  toast('Restarting DeviceHub', 'info', { detail: 'The window reloads in a few seconds.' });
  // gone first (up to 10 s), then back twice in a row (up to 60 s)
  for (let i = 0; i < 20 && (await answers()); i++) await sleep(500);
  let ok = 0;
  for (let i = 0; i < 60 && ok < 2; i++) { await sleep(1000); ok = (await answers()) ? ok + 1 : 0; }
  location.reload();
  return true;
}

// the button the notes that ask for a restart carry
export const restartButton = (opts = {}) => button('Restart DeviceHub', (e) => { if (e?.currentTarget) e.currentTarget.disabled = true; restartHub(); }, { kind: 'ghost small', ic: 'refresh', ...opts });
