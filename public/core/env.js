// Where the core code is running. In the browser it talks to the local server over HTTP; inside the server's
// background agent the same calls go straight to the server's handlers (agent.mjs replaces api and toast).
export const env = {
  agent: false,
  // api(path) -> GET, api(path, body) -> POST; resolves with parsed JSON, throws on an error status.
  async api(path, body) {
    const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok || j?.error) throw new Error(j?.error || r.statusText || 'request failed');
    return j;
  },
  // toast(msg, kind, opts) -> { update(msg, kind, detail) }; the browser sets the real one.
  toast() { return { update() {}, close() {} }; },
};
