// Plain words for the Backups page (22 Oct 2026, docs/handoff/backups-redesign.md): friendly dates, what change a
// backup was taken before, which card a backup file belongs on, and a backup's contents as short "name: value" lines.
// No DOM and no fetches here, so tests/backup-words.mjs can check it in Node.

export const SHOWN = 3;   // backups shown per device before "Show older"

const time = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (d, now) => Math.round((dayStart(now) - dayStart(d)) / 86400000);
const monthDay = (d, now) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });

// "Today 12:42 PM", "Yesterday 11:04 PM", then "Oct 21, 10:41 PM" (with the year when it is not this year)
export function friendlyWhen(at, now = new Date()) {
  const d = new Date(at);
  if (Number.isNaN(+d)) return 'Unknown time';
  const ago = daysAgo(d, now);
  if (ago === 0) return `Today ${time(d)}`;
  if (ago === 1) return `Yesterday ${time(d)}`;
  return `${monthDay(d, now)}, ${time(d)}`;
}

// the same inside a sentence: "today at 12:42 PM", "yesterday at 11:04 PM", "Oct 21 at 10:41 PM"
export function whenInSentence(at, now = new Date()) {
  const d = new Date(at);
  if (Number.isNaN(+d)) return 'an unknown time';
  const ago = daysAgo(d, now);
  return `${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : monthDay(d, now)} at ${time(d)}`;
}

// a weekly setup copy: "Mon Oct 19, 4:14 PM"
export function weeklyWhen(at) {
  const d = new Date(at);
  if (Number.isNaN(+d)) return 'Unknown time';
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time(d)}`;
}

export const sizeText = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`);

// a setting's key in words when no page names it: "scrollLines" -> "Scroll lines", "dpi2" -> "DPI stage 3"
export function humanKey(key) {
  const k = String(key);
  let m;
  if ((m = /^dpi(\d)$/.exec(k))) return `DPI stage ${+m[1] + 1}`;
  if ((m = /^btn(\d)$/.exec(k))) return `Button ${+m[1] + 1}`;
  if ((m = /^color(\d)$/.exec(k))) return `DPI stage ${+m[1] + 1} color`;
  const words = k.replace(/^(vol|mute|prop):/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_:-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : k;
}

// The change a backup was taken before, from its "why" ("before pollingRate", "before Polling rate"), or null when it
// says nothing useful ("before a change", a test). label(key) names a setting's key the way the device page does.
export function whyText(why, label = humanKey) {
  if (typeof why !== 'string') return null;
  const m = /^before\s+(.+)$/i.exec(why.trim());
  if (!m) return null;
  const rest = m[1].trim();
  if (/^(a change|changes|test|the first change)$/i.test(rest)) return null;
  if (/^restoring\b/i.test(rest)) return 'before going back to an earlier copy';
  if (/^loading the setup file\b/i.test(rest)) return 'before loading a setup file';
  if (/^[A-Za-z][\w:]*$/.test(rest)) {
    const named = label(rest);
    return `before ${named && named !== rest ? named : humanKey(rest)} change`;
  }
  // a setting's own name ("Polling rate", "Mic light (charging)")
  if (/^[A-Z]/.test(rest) && rest.split(/\s+/).length <= 4) return `before ${rest} change`;
  return `before ${rest}`;
}

// Which card a backup file goes on: the longest device id its name starts with ("example-light-2026-..." belongs to
// "example-light"), else the part before the first dash, as before.
export function groupOf(name, ids = []) {
  const hit = [...ids].sort((a, b) => b.length - a.length).find((id) => name.startsWith(`${id}-`));
  return hit || String(name).split('-')[0];
}

// The cards' names for backup files of things that are not one of the devices
export const OTHER_NAMES = {
  windows: 'Windows mouse pointer', monitor: 'Monitors', camera: 'Camera', eq: 'Sound EQ', settings: 'DeviceHub settings',
  audio: 'Windows sound', hs80: 'Corsair HS80 (test files)', example: 'Example light',
};

const plainValue = (v) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
const SKIP = new Set(['at', 'device', 'takenAt', 'why', 'id', 'ok', 'kind', 'version']);

// A backup's contents as [{ label, text }] lines. name(key) and show(key, value) are the device pages' own words
// (core/profiles.js keyLabel and showValue); a key they do not know falls back to humanKey and a plain value.
// extra: what the lines leave out ("the whole keymap and macros"), or null.
export function contentLines(b, name = (k) => k, show = (k, v) => plainValue(v)) {
  const lines = [];
  const label = (k) => { const n = name(k); return n && n !== k ? n : humanKey(k); };
  const value = (k, v) => { const s = show(k, v); return s == null || String(s) === String(v) ? plainValue(v) : String(s); };
  const data = b?.data && typeof b.data === 'object' ? b.data : null;
  let extra = null;
  if (data && (data.settings || data.info)) {
    for (const [k, v] of Object.entries(data.info || {})) if (v != null && typeof v !== 'object') lines.push({ label: k, text: String(v) });
    for (const [k, v] of Object.entries(data.settings || {})) if (v != null && typeof v !== 'object') lines.push({ label: label(k), text: value(k, v) });
    if (data.raw?.keymap) extra = 'the whole keymap and macros';
    else if (data.raw && Object.keys(data.raw).length) extra = 'the raw device memory';
    return { lines, extra };
  }
  // other files (a monitor, a camera, Windows settings, the EQ): their top-level values, one level of { value, max }
  const src = data || b || {};
  const add = (k, v) => {
    if (SKIP.has(k) || v == null) return;
    if (typeof v !== 'object') { lines.push({ label: humanKey(k), text: plainValue(v) }); return; }
    if (Array.isArray(v)) { lines.push({ label: humanKey(k), text: `${v.length} saved` }); return; }
    if ('value' in v && typeof v.value !== 'object') {
      const opt = Array.isArray(v.options) ? v.options.find((o) => o?.value === v.value) : null;
      lines.push({ label: humanKey(k), text: opt?.label || (v.max != null ? `${plainValue(v.value)} of ${plainValue(v.max)}` : plainValue(v.value)) });
      return;
    }
    if (k === 'controls') { for (const [ck, cv] of Object.entries(v)) add(ck, cv); return; }
    extra = 'more details';
  };
  for (const [k, v] of Object.entries(src)) add(k, v);
  return { lines, extra };
}
