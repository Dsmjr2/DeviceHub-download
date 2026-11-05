// A small obs-websocket 5 client (2 Nov 2026, instant replay: helpers/replay.mjs). OBS Studio 28 and newer carry the
// server (port 4455, a password OBS made itself in plugin_config\obs-websocket\config.json). Only 127.0.0.1, never
// another PC. Protocol: github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md (Hello op 0,
// Identify op 1, Identified op 2, Event op 5, Request op 6, RequestResponse op 7); written from that document.
import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');
export const OUTPUTS = 1 << 6;   // EventSubscription.Outputs: ReplayBufferStateChanged, ReplayBufferSaved

// connect({ port, password }) -> { call(type, data), on(type, fn), close() }; rejects within timeoutMs
export function connect({ port = 4455, password = '', timeoutMs = 5000, WS = globalThis.WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WS(`ws://127.0.0.1:${port}`); } catch (e) { reject(e); return; }
    let seq = 0, done = false;
    const pending = new Map(), listeners = new Map();
    const fail = (e) => { if (!done) { done = true; clearTimeout(timer); try { ws.close(); } catch {} reject(e); } };
    const timer = setTimeout(() => fail(new Error('OBS did not answer')), timeoutMs);
    const send = (op, d) => ws.send(JSON.stringify({ op, d }));
    const api = {
      call(requestType, requestData = {}, { waitMs = 10000 } = {}) {
        const requestId = `dh${++seq}`;
        return new Promise((res, rej) => {
          const t = setTimeout(() => { pending.delete(requestId); rej(new Error(`OBS did not answer ${requestType}`)); }, waitMs);
          pending.set(requestId, { res, rej, t, requestType });
          send(6, { requestType, requestId, requestData });
        });
      },
      on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
      close() { try { ws.close(); } catch {} },
    };
    ws.onerror = () => fail(new Error('OBS is not answering on its remote-control port'));
    ws.onclose = () => { fail(new Error('OBS closed the connection')); for (const p of pending.values()) { clearTimeout(p.t); p.rej(new Error('OBS closed the connection')); } pending.clear(); };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data)); } catch { return; }
      const { op, d } = msg || {};
      if (op === 0) {
        const id = { rpcVersion: 1, eventSubscriptions: OUTPUTS };
        if (d?.authentication) id.authentication = sha(sha(password + d.authentication.salt) + d.authentication.challenge);
        send(1, id);
      } else if (op === 2) { if (!done) { done = true; clearTimeout(timer); resolve(api); } }
      else if (op === 5) { for (const fn of listeners.get(d?.eventType) || []) { try { fn(d.eventData || {}); } catch {} } }
      else if (op === 7) {
        const p = pending.get(d?.requestId);
        if (!p) return;
        pending.delete(d.requestId); clearTimeout(p.t);
        const st = d.requestStatus || {};
        if (st.result) p.res(d.responseData || {});
        else p.rej(Object.assign(new Error(`OBS refused ${p.requestType}${st.comment ? `: ${st.comment}` : ''} (${st.code})`), { code: st.code }));
      }
    };
  });
}
