// Which mic the Headset page's Mic check uses (22 Oct 2026, docs/handoff/mic-check-pick.md): the headset picked on the
// Headset page (public/core/headset-pick.js). With the HS80 picked, or the HS80 the only headset, nothing changes: the
// live meter opens the browser's "HS80" mic and the test recording goes through server.js's /api/mictest/start, which
// records the HS80 mic (the cable's first). Another USB headset picked: the meter opens that headset's mic, and the
// test recording asks the helper for that headset's mic by its USB id and records it. Nothing here changes Windows'
// default devices. Pure apart from startMicTest, which takes the api function so tests can drive it.
import { cleanPick, isHs80 } from './headset-pick.js';

// the picked headset's USB id when it is not the HS80; null = the HS80 path, exactly as before
export function micTestUsb(generic) {
  const usb = cleanPick(generic?.usb);
  return usb && usb !== 'hs80' && !isHs80(usb) ? usb : null;
}

// the mic to record among a headset's sound devices: a working one (state 1), the USB cable's first (HS80 0A69)
export function micTestId(endpoints) {
  const eps = (Array.isArray(endpoints) ? endpoints : []).filter((e) => e?.flow === 'recording' && e.state === 1 && typeof e.id === 'string');
  return (eps.find((e) => e.wired) || eps[0])?.id || null;
}

// the live meter: is this browser mic (its label) the picked headset's? The HS80: /HS80/ as before. Another headset:
// its Windows mic name ("Microphone (Arctis Nova 7)"), its name, or the "(1038:12e0)" Chrome adds to USB mics.
export function micMatcher(generic, endpoints) {
  const usb = micTestUsb(generic);
  if (!usb) return (label) => /HS80/i.test(String(label || ''));
  const [, vid, pid] = /^VID_([0-9A-F]{4})&PID_([0-9A-F]{4})$/.exec(usb);
  const names = [
    ...(Array.isArray(endpoints) ? endpoints : []).filter((e) => e?.flow === 'recording' && e.name).map((e) => e.name),
    generic.device,
    `${vid}:${pid}`,
  ].filter(Boolean).map((s) => String(s).toLowerCase());
  return (label) => { const l = String(label || '').toLowerCase(); return !!l && names.some((n) => l.includes(n)); };
}

const NOT_ON = 'The headset mic is not connected. Turn the headset on.';

// Start the test recording. api(path, body): env.api. mic: 'headset' or 'anker' (the camera mic, server.js as before).
export async function startMicTest(api, { mic = 'headset', generic = null } = {}) {
  const usb = mic === 'headset' ? micTestUsb(generic) : null;
  if (!usb) return api('/api/mictest/start', { mic });
  let id = null;
  try { id = micTestId((await api('/api/corsair/hs80-endpoints', { usb })).endpoints); } catch {}
  // the headset off: no silent switch to another mic (the test would record the wrong one)
  if (!id) throw new Error(NOT_ON);
  return { ...(await api('/api/corsair/mic-rec-start', { id })).rec, headsetMic: true };
}
