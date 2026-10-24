// The routes for display settings, temperatures and the PC check (24 Oct 2026, docs/handoff/display-health.md), kept in
// one file so server.js carries a single line for them. Reads are GET; anything that changes a screen is a POST.
//   GET  /api/display               every screen's mode, modes, HDR, main; Night light (read only); a change waiting
//   GET  /api/display/state         a change waiting to be kept (seconds left), and the last result
//   POST /api/display/set           { screen, kind: 'mode' | 'hdr' | 'primary', value }: backed up, tested, read back
//   POST /api/display/keep | undo   keep the waiting change, or put it back now
//   POST /api/display/open-settings { page: 'display' | 'nightlight' | 'hdr' }: Windows Settings at that page
//   GET  /api/temps                 temperatures and fans, read only (helpers/pc-sensors.js)
//   GET  /api/pc-check[?fresh=1]    the PC check (helpers/pc-check.js)
const { spawn } = require('child_process');

const SETTINGS = { display: 'ms-settings:display', nightlight: 'ms-settings:nightlight', hdr: 'ms-settings:display-advancedcolor' };
let display = null;
const ctl = (backups, log) => (display ||= require('./display').create({ backupDir: backups, log }));

async function handle(req, res, url, { send, readBody, backups, log = () => {} }) {
  const p = url.pathname;
  try {
    if (p === '/api/display' && req.method === 'GET') {
      const d = ctl(backups, log);
      return send(res, 200, { ...(await d.read()), ...d.state() });
    }
    if (p === '/api/display/state' && req.method === 'GET') return send(res, 200, ctl(backups, log).state());
    if (p === '/api/display/set' && req.method === 'POST') {
      const { screen, kind, value } = await readBody(req);
      return send(res, 200, await ctl(backups, log).change(String(screen), String(kind), value));
    }
    if (p === '/api/display/keep' && req.method === 'POST') return send(res, 200, await ctl(backups, log).keep());
    if (p === '/api/display/undo' && req.method === 'POST') return send(res, 200, await ctl(backups, log).revert());
    if (p === '/api/display/open-settings' && req.method === 'POST') {
      const { page } = await readBody(req);
      const uri = SETTINGS[page];
      if (!uri) return send(res, 400, { error: 'unknown settings page' });
      spawn('explorer.exe', [uri], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/temps' && req.method === 'GET') return send(res, 200, await require('./pc-sensors').read());
    if (p === '/api/pc-check' && req.method === 'GET') return send(res, 200, await require('./pc-check').check(url.searchParams.has('fresh')));
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, 400, { error: e.message }); }
}

const handles = (p) => p === '/api/display' || p.startsWith('/api/display/') || p === '/api/temps' || p === '/api/pc-check';

module.exports = { handle, handles };
