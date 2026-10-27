// The window's one live stream (27 Oct 2026, Shawn: the open window asked DeviceHub ~126 times in 10 minutes doing
// nothing): GET /api/events stays open and DeviceHub sends a small named event when something changes (server.js,
// helpers/window-events.js): hello on every open (version, saving, backupAt, notice), then version, power, backup,
// notice, and the agent's device, auto, activity and newdevice. Nothing here asks for anything in between.
//   startEvents()              open it (once; demo mode never does)
//   onEvent(type, fn)          fn(data) for each event; a late 'hello' listener gets the last hello at once
//   onOpen(fn)                 fn() each time the stream (re)opens: read the full state again, nothing was missed
//   streamUp()                 the stream is open now
// The browser retries a dropped stream by itself, but gives up for good if a retry meets an error answer (a DeviceHub
// restart caught mid-start; 19 Oct 2026: the window then showed a frozen picture). Every 5 s, a stream the browser
// gave up on is replaced. ES / setI are for tests (tests/events.mjs).
const handlers = [];
const openers = new Set();
let es = null, lastHello = null, ESource = null;

const wrap = (type, fn) => (e) => {
  let data = null;
  try { data = JSON.parse(e.data); } catch { return; }
  try { fn(data); } catch {}
};

function make(url) {
  const src = new ESource(url);
  for (const [type, f] of handlers) src.addEventListener(type, f);
  src.addEventListener('hello', (e) => { try { lastHello = JSON.parse(e.data); } catch {} });
  src.onopen = () => { for (const f of openers) { try { f(); } catch {} } };
  return src;
}

export function startEvents({ url = '/api/events', ES = globalThis.EventSource, setI = setInterval, every = 5000 } = {}) {
  if (es || !ES) return false;
  ESource = ES;
  es = make(url);
  setI(() => {
    if (es.readyState !== ESource.CLOSED) return;
    es = make(url);
  }, every);
  return true;
}

export function onEvent(type, fn) {
  const f = wrap(type, fn);
  handlers.push([type, f]);
  es?.addEventListener(type, f);
  if (type === 'hello' && lastHello) { try { fn(lastHello); } catch {} }
  return f;
}

export function onOpen(fn) { openers.add(fn); return () => openers.delete(fn); }

export const streamUp = () => !!es && !!ESource && es.readyState === ESource.OPEN;
