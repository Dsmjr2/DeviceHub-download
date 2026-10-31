// The link to send people (20 Oct 2026): the public download page (one Setup.exe, three steps) (github.com/Dsmjr2/DeviceHub-download,
// updated with every change). Kept here, in the app's own code, so it is the same on every PC and every copy.
import { toast } from '../ui/overlay.js';

export const DOWNLOAD_URL = 'https://github.com/Dsmjr2/DeviceHub-download';

export async function copyDownloadLink() {
  try { await navigator.clipboard.writeText(DOWNLOAD_URL); toast('Download link copied', 'good', { detail: 'Always the newest version.' }); }
  catch { toast('Could not copy', 'bad', { detail: DOWNLOAD_URL }); }
}

// the short report for whoever helps (server.js /api/report/short): versions, devices, PC, recent problems
export async function copyShortReport() {
  // demo mode copies nothing of the real PC (31 Oct 2026), as Health's Save does
  if (window.DEVICEHUB_DEMO || new URLSearchParams(location.search).has('demo')) { toast('Not in demo mode', 'info', { detail: 'The report is about the real PC.' }); return; }
  try {
    const r = await fetch('/api/report/short'); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await navigator.clipboard.writeText(await r.text());
    toast('Report copied', 'good', { detail: 'Paste it to whoever helps.' });
  } catch (e) { toast('Report not copied', 'bad', { detail: e.message }); }
}
