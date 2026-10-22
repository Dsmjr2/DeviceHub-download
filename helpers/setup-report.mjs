// The setup summary for Claude Code (22 Oct 2026; docs/handoff/auto-setup.md): what DeviceHub found and installed, what
// works now, what is optional and what still needs a learning session. "Set this up" = run this, then do only what it
// lists under "Still to do" (and offer what is under "Optional").
//   node helpers/setup-report.mjs          the summary in words (asks the running DeviceHub: GET /api/setup?fresh=1)
//   node helpers/setup-report.mjs --json   the same as JSON
// With DeviceHub not running it reports what its files say (setup.json, my-devices) and says so. Read-only.
import { summary, asText } from './auto-setup.mjs';

const json = process.argv.includes('--json');
const PORT = Number(process.env.DEVICEHUB_PORT || 5577);
let s = null, offline = null;
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/setup?fresh=1`, { signal: AbortSignal.timeout(120000) });
  if (r.status === 404) throw new Error('the running DeviceHub is older than /api/setup: restart it to load the new code');
  if (!r.ok) throw new Error(`/api/setup answered ${r.status}`);
  s = await r.json();
  if (s.error) throw new Error(s.error);
} catch (e) {
  offline = `DeviceHub is not answering on 127.0.0.1:${PORT} (${e.message}): this is only what its files say. Start it (DeviceHub.vbs), then run this again.`;
  s = summary({});
}
if (json) console.log(JSON.stringify(offline ? { offline, ...s } : s, null, 2));
else console.log((offline ? `${offline}\n` : '') + asText(s));
