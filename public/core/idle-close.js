// Close the window when it is not in use (26 Oct 2026, Shawn approved: DeviceHub's own window holds ~600 MB). After the
// window has been hidden (minimized, or covered) and without focus for 5 minutes in a row, it asks DeviceHub to close
// it (POST /api/window/idle-close, helpers/window-close.js). DeviceHub keeps running in the tray; the tray icon or the
// DeviceHub shortcut opens it again on the page it was on (GET /api/window/resume).
//   - never while something is running or half done: blockers() names what holds it open, and the server adds its own
//     (an update, a publish, a learning session, Find my lights, an install)
//   - Settings > Startup "Close window when minimized" (settings.json closeWhenMinimized, on unless false)
//   - in the low-memory window (an app window inside the person's own Chrome) the server never closes a process: the
//     page closes only its own app window (window.close()), and never a normal browser tab
// doc / win / now / setI / clearI / api / checks are for tests (tests/idle-close.mjs).
export const IDLE_MS = 5 * 60 * 1000;
export const CHECK_MS = 30 * 1000;

// What keeps the window open now: [] when nothing does. state: { busy, dropdown, learn, displayKeep, unsaved } from the
// app, doc for what is on the page (a dialog, a loading bar, the display's Keep this? line)
export function blockers(state = {}, doc = globalThis.document) {
  const why = [];
  if (state.busy) why.push('a device change is being written');
  if (state.dropdown) why.push('a dropdown list is open');
  if (state.learn) why.push('a learning session is running');
  if (state.displayKeep) why.push('a display change waits for Keep this?');
  if (state.unsaved) why.push('a form has unsaved text');
  const q = (sel) => { try { return !!doc?.querySelector?.(sel); } catch { return false; } };
  if (q('.modal-back, dialog[open]')) why.push('a question is open');
  if (q('.palette-back')) why.push('the search is open');
  if (q('.loadbar')) why.push('something is in progress');
  if (q('.disp-keep')) why.push('a display change waits for Keep this?');
  if (q('.toast.busy')) why.push('something is in progress');
  return [...new Set(why)];
}

// The one decision: close now?
//   hiddenSince  when the window last went hidden (null = shown now); now the clock; focused document.hasFocus()
//   enabled      the Settings switch; reasons blockers()
//   sleep        the PC is going to sleep (or just woke from it), or 'screens': DeviceHub's own Sleep button turned the
//                screens off (the PC keeps running, so Windows says nothing). No 5 minutes and no need to be hidden; a
//                window in use on waking (focused) stays
export function decide({ hiddenSince, now, focused, enabled = true, reasons = [], sleep = null }) {
  if (!enabled) return { close: false, why: 'switched off' };
  if (sleep === 'sleep' || sleep === 'screens' || (sleep === 'woke' && !focused)) return reasons.length ? { close: false, why: reasons.join(', ') } : { close: true, why: sleep === 'sleep' ? 'the PC is going to sleep' : sleep === 'screens' ? 'the screens were put to sleep' : 'woke from sleep, not in use' };
  if (hiddenSince == null) return { close: false, why: 'shown' };
  if (focused) return { close: false, why: 'focused' };
  if (now - hiddenSince < IDLE_MS) return { close: false, why: 'not long enough' };
  if (reasons.length) return { close: false, why: reasons.join(', ') };
  return { close: true, why: 'idle' };
}

// Text typed into a form and not saved yet: a text box or text area the person typed into that is still on the page
// and no longer holds what it held before they typed (a page redraw after Save replaces the box, so it no longer counts)
export function unsavedWatcher(doc = globalThis.document) {
  const typed = new Map();
  const texty = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'search', 'email', 'url', ''].includes(String(el.getAttribute?.('type') || '').toLowerCase())) || el.isContentEditable);
  const valueOf = (el) => (el.isContentEditable ? el.textContent : el.value) ?? '';
  doc?.addEventListener?.('focusin', (e) => { const el = e.target; if (texty(el) && !typed.has(el)) typed.set(el, { was: valueOf(el), typed: false }); }, true);
  doc?.addEventListener?.('input', (e) => { const el = e.target; if (!texty(el)) return; const t = typed.get(el) || { was: '', typed: false }; t.typed = true; typed.set(el, t); }, true);
  return () => {
    for (const [el, t] of typed) {
      if (!el.isConnected) { typed.delete(el); continue; }
      if (t.typed && valueOf(el).trim() !== '' && valueOf(el) !== t.was) return true;
    }
    return false;
  };
}

// Is this page its own app window (DeviceHub's window, or the low-memory app window), not a tab in a browser window?
export const isAppWindow = (win = globalThis.window) => {
  try { return !!win?.matchMedia?.('(display-mode: standalone)').matches || !!win?.matchMedia?.('(display-mode: minimal-ui)').matches; } catch { return false; }
};

// the running timer (startIdleClose), for closeAfterScreensOff
let running = null;
// Monitors > Sleep and the search's "Sleep monitors" (29 Oct 2026, Shawn: "app was not minimized when I just did it"):
// the screens go off about 2 s after the click (helpers/sleep-monitors.ps1), then the window closes, by the same rules
export const SCREENS_CLOSE_MS = 4000;
export function closeAfterScreensOff(set = setTimeout) { return set(() => { running?.tick('screens'); }, SCREENS_CLOSE_MS); }

// The timer: started once by the app. state() returns the app's part of blockers(); page() the page to come back to.
export function startIdleClose({ state = () => ({}), page = () => location.hash, enabled = () => true,
  doc = globalThis.document, win = globalThis.window, now = () => Date.now(), setI = setInterval, clearI = clearInterval,
  api = (body) => fetch('/api/window/idle-close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
  titled = (body) => fetch('/api/window/close-titled', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {} } = {}) {
  const hiddenNow = () => (doc?.visibilityState ? doc.visibilityState !== 'visible' : !!doc?.hidden);
  let hiddenSince = hiddenNow() ? now() : null;
  let asking = false, done = false;
  const onVis = () => { if (!hiddenNow()) { hiddenSince = null; done = false; } else if (hiddenSince == null) hiddenSince = now(); };
  const onFocus = () => { hiddenSince = hiddenNow() ? now() : null; };
  doc?.addEventListener?.('visibilitychange', onVis);
  win?.addEventListener?.('focus', onFocus);
  const tick = async (sleep = null) => {
    if (asking || done) return null;
    // focus: a hidden page normally has none; one that has it is in use
    const focused = (() => { try { return !!doc?.hasFocus?.(); } catch { return false; } })();
    const d = decide({ hiddenSince, now: now(), focused, enabled: enabled() !== false, reasons: blockers(state(), doc), sleep });
    if (!d.close) return d;
    asking = true;
    try {
      const r = await api({ page: page(), hiddenFor: hiddenSince == null ? 0 : now() - hiddenSince, appWindow: isAppWindow(win), ...(sleep ? { sleep } : {}) });
      log(r);
      // the server closed DeviceHub's own window (this page ends with it), or says this is the low-memory window:
      // then only this app window closes itself, never a browser tab
      if (r?.closing) done = true;
      else if (r?.self && isAppWindow(win)) {
        // the page's own close first; Chrome ignores it once the person has moved between pages (29 Oct 2026, measured:
        // history 4, the window stayed), so then DeviceHub closes the window with this one-time title, as its X does
        try { win.close(); } catch {}
        await wait(400);
        const was = doc.title;
        const nonce = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        doc.title = `DeviceHub closing ${nonce}`;
        await wait(400);
        const c = await titled({ nonce, ...(sleep ? { sleep } : {}) }).catch((e) => ({ closed: false, why: e.message }));
        if (c?.closed) done = true; else doc.title = was;
        log(c);
        return { ...d, server: r, titled: c };
      }
      else if (r?.retry === false || r?.isolated) done = true;   // switched off, no tray: not again until the window is shown again
      return { ...d, server: r };
    } catch (e) { return { ...d, error: e.message }; }
    finally { asking = false; }
  };
  const timer = setI(tick, CHECK_MS);
  return running = { tick, stop: () => { clearI(timer); doc?.removeEventListener?.('visibilitychange', onVis); win?.removeEventListener?.('focus', onFocus); }, get hiddenSince() { return hiddenSince; } };
}
