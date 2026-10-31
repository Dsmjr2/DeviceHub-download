// A learning session's recordings go to Shawn by themselves (24 Oct 2026, docs/handoff/smoother-for-friends.md).
// Learning a device on a friend's PC kept ending in "nothing learned" (support #10, #11, #14): the person cannot judge a
// recording, Shawn can. So when the recordings of a session are done, they are sent through the same relay as Get help
// (helpers/auto-report.mjs sendNow, relay/worker.js), with the device's ids, its USB interfaces, the maker's app, and for
// each setting change the messages the maker's app sent the device. The person's part ends there with SENT_DONE.
//
// Size: the relay takes a body of at most 12,000 characters (relay/worker.js LIMITS.body) and 16 KB of JSON in all.
// The report is made to fit RELAY_BODY, trimming the least useful parts first:
//   level 0  every distinct message of every recording (with how often it was seen)
//   level 1  per setting, only the messages the app sent in one recording and not in another (the ones that carry
//            the change), plus a count of what was the same in every recording
//   level 2  as 1, each message cut to its first 24 bytes, at most 12 per recording
//   level 3  counts only
// and says what was left out. Nothing personal goes in: ids, byte values, setting names and values, the app's name.
//
//   captureReport(data)        { title, body, level, leftOut } within RELAY_BODY
//   sendCaptures(data, deps)   { sent, queued, already, fallback, line, why } (deps.sendNow for tests)
//   data: { device: { vid, pid, name, kind, seems, interfaces }, maker: { name, installed, running }, captures:
//          [{ label, kind, value, messages: [{ dir, type, reportId, data }] }], ready: { name } | null, why }
export const SENT_DONE = 'Sent. The driver usually arrives within a day.';
export const NOT_SENT = "It could not be sent from here. Press Learn it again later to send it, or Get help (top right) to say what happened: it sends how far learning came, not the recordings.";
export const RELAY_BODY = 11500;   // under relay/worker.js LIMITS.body (12,000), with room for the relay's own footer line
export const RELAY_JSON = 15500;   // under LIMITS.total (16,384) once title, ids and JSON escapes are added

const hexOf = (a) => Array.from(a || []).map((b) => Number(b).toString(16).padStart(2, '0').toUpperCase()).join(' ');
const showV = (v) => (v === true ? 'on' : v === false ? 'off' : String(v));
const msgKey = (m, cut = 0) => `${m.dir} ${m.type}${m.reportId ? ` id ${Number(m.reportId).toString(16).padStart(2, '0')}` : ''}: ${hexOf(cut ? (m.data || []).slice(0, cut) : m.data)}${cut && (m.data || []).length > cut ? ' …' : ''}`;
// distinct messages of one recording with how often each came: [[key, n]] in first-seen order
function distinct(msgs, cut = 0) {
  const by = new Map();
  for (const m of msgs || []) { const k = msgKey(m, cut); by.set(k, (by.get(k) || 0) + 1); }
  return [...by];
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function head(data) {
  const d = data.device || {}, m = data.maker || {};
  const L = ['**Learn a device: recordings for a new driver.** Sent by DeviceHub when the recordings were done.', '', '### The device',
    `- USB: ${d.vid}:${d.pid}`, `- Windows calls it: ${d.name || 'no name'}`];
  if (d.kind) L.push(`- Learned as: ${d.kind}`);
  if (d.seems) L.push(`- Its USB interfaces say: ${d.seems}`);
  for (const i of (d.interfaces || []).slice(0, 8)) L.push(`- Interface: ${i}`);
  L.push(`- Maker's app: ${m.name ? `${m.name}${m.installed ? ', installed' : ', not installed'}${m.running ? ', open' : ''}` : 'not known'}`);
  if (data.ready) L.push(`- Driver it has now: ${data.ready.name} (the recordings are for a setting it lacks)`);
  if (data.why) L.push(`- Why it was sent: ${data.why}`);
  return L;
}
function settingsOf(captures) {
  const by = new Map();
  for (const c of captures || []) { if (!by.has(c.label)) by.set(c.label, { label: c.label, kind: c.kind, takes: [] }); by.get(c.label).takes.push(c); }
  return [...by.values()];
}

export function compose(data, level) {
  const L = head(data);
  const sets = settingsOf(data.captures);
  let left = 0;
  L.push('', `### Recordings (${plural(sets.length, 'setting')}, ${plural((data.captures || []).length, 'recording')})`);
  for (const s of sets) {
    L.push('', `**${s.label}** (${s.kind || 'setting'})`);
    const cut = level >= 2 ? 24 : 0;
    const per = s.takes.map((t) => distinct(t.messages, cut));
    // the messages seen in every recording of this setting carry nothing about the change
    const inAll = new Set(per.length > 1 ? per[0].map(([k]) => k).filter((k) => per.every((p) => p.some(([x]) => x === k))) : []);
    s.takes.forEach((t, i) => {
      const all = per[i];
      L.push(`- ${showV(t.value)}: heard ${plural((t.messages || []).length, 'message')}${level >= 3 ? '' : ':'}`);
      if (level >= 3) { left += all.length; return; }
      let shown = level >= 1 ? all.filter(([k]) => !inAll.has(k) && k.startsWith('out')) : all;
      if (level >= 1) left += all.length - shown.length;
      if (level >= 2 && shown.length > 12) { left += shown.length - 12; shown = shown.slice(0, 12); }
      for (const [k, n] of shown) L.push(`  - ${k}${n > 1 ? ` (×${n})` : ''}`);
    });
  }
  L.push('');
  if (left) L.push(`Left out to fit: ${plural(left, 'message')} (${level >= 3 ? 'every message; the counts stay' : level >= 1 ? 'the ones that were the same in every recording of a setting, and the device\'s replies' : ''}${level >= 2 ? ', and bytes past the 24th of each message' : ''}). The recordings stay on the PC in learn\\wizard\\.`);
  return { body: L.join('\n'), left };
}

const fits = (title, body) => body.length <= RELAY_BODY && JSON.stringify({ title, body }).length <= RELAY_JSON;
export function captureReport(data) {
  const d = data.device || {};
  const title = `Learn: ${String(d.name || 'device').slice(0, 60)} (${d.vid}:${d.pid})`.slice(0, 120);
  for (let level = 0; level <= 3; level++) {
    const { body, left } = compose(data, level);
    if (fits(title, body)) return { title, body, level, leftOut: left };
  }
  // still too long (very many settings): cut, and say so
  let { body } = compose(data, 3);
  const tail = '\n\n(Cut to fit the relay.)';
  while (!fits(title, body + tail) && body.length > 200) body = body.slice(0, Math.floor(body.length * 0.9));
  return { title, body: body + tail, level: 4, leftOut: null, cut: true };
}

// through the relay, as Get help's Send to Shawn: once per device per day per session start (fingerprint)
export async function sendCaptures(data, deps = {}) {
  if (!(data.captures || []).some((c) => (c.messages || []).length)) return { sent: false, why: 'nothing was heard to send' };
  const ar = deps.ar || await import('./auto-report.mjs');
  const { findPersonal } = deps.findPersonal ? deps : await import('./get-help.mjs');
  const { personalNames } = await import('./share-device.mjs');
  const { devicehubVersion } = await import('./device-library.mjs');
  const r = captureReport(data);
  const fin = ar.finalCheck(findPersonal, r.title, r.body, personalNames(ar.options?.names || []));
  if (!fin.ok) return { sent: false, fallback: true, why: fin.why, line: NOT_SENT };
  const d = data.device || {};
  const fp = `support:learn:${String(d.vid).toLowerCase()}-${String(d.pid).toLowerCase()}:${String(data.at || Date.now()).replace(/[^0-9]/g, '').slice(-8)}`.slice(0, 80);
  const s = await (deps.sendNow || ar.sendNow)({ fingerprint: fp, title: r.title, body: fin.body, version: String(devicehubVersion()).slice(0, 40) });
  if (s.sent) return { sent: true, already: !!s.already, line: SENT_DONE, level: r.level, leftOut: r.leftOut };
  if (s.queued) return { sent: false, queued: true, line: 'Shawn could not be reached just now. DeviceHub sends it by itself in a few minutes; nothing more to do.', level: r.level };
  return { sent: false, fallback: true, why: s.why, line: NOT_SENT };
}
