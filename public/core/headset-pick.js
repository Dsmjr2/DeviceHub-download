// Which USB headset the Headset page controls (22 Oct 2026). With two or more USB headsets plugged in, the page shows
// a small picker; the choice is kept in settings.json as "headsetPick": 'hs80' or a USB id like "VID_1038&PID_12E0".
// No choice (or one that is not plugged in) = as before: the HS80 first, else the first USB headset Windows lists.
// Pure functions only: used by public/devices/headset-adapter.js, the Headset page, the demo and tests/regressions.mjs.

const HS80 = /^VID_1B1C&PID_0A6/i;   // the HS80's receiver and its USB cable (0A6B, 0A69 ...)
const USB_ID = /^VID_[0-9A-F]{4}&PID_[0-9A-F]{4}$/i;
// a wired headset on the PC's jack (helpers/wired-headsets.js, 22 Oct 2026): offered in the picker, used only when picked
const JACK = /^JACK_[0-9A-F]{8}$/i;
export const isJack = (k) => JACK.test(String(k || ''));

export const isHs80 = (usb) => HS80.test(String(usb || ''));

// a saved or sent choice, cleaned up; anything else is no choice
export function cleanPick(k) {
  if (k === 'hs80') return 'hs80';
  return typeof k === 'string' && (USB_ID.test(k) || JACK.test(k)) ? k.toUpperCase() : null;
}

// a short name for the picker: Windows' device name without "Gaming Headset" and the like, at most 24 characters
export function shortName(name) {
  const s = String(name || 'USB headset').replace(/\s+(wireless\s+)?(gaming\s+)?headset$/i, '').replace(/\s+/g, ' ').trim() || 'USB headset';
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

// list: the native helper's usb-headsets answer ({ usb, device, playback, recording }); hs80: the HS80 is connected
// even if Windows does not list it right now; asGeneric: DEVICEHUB_HEADSET_GENERIC=1 (the HS80 runs as any headset).
// One choice per headset: the HS80 first (both of its USB ids are one headset), then the others in Windows' order.
export function headsetChoices(list, { hs80 = false, asGeneric = false } = {}) {
  const out = [];
  let hasHs80 = hs80 && !asGeneric;
  for (const x of Array.isArray(list) ? list : []) {
    const usb = cleanPick(x?.usb);
    if (!usb || usb === 'hs80') continue;
    if (isHs80(usb) && !asGeneric) { hasHs80 = true; continue; }
    if (!out.some((c) => c.key === usb)) out.push({ key: usb, name: shortName(x.device || usb) });
  }
  return hasHs80 ? [{ key: 'hs80', name: 'HS80' }, ...out] : out;
}

export const showPicker = (choices) => Array.isArray(choices) && choices.length > 1;

// the other USB headset to run instead of the HS80, or null (= try the HS80 first, as before)
export function chosenOther(list, pick, { asGeneric = false } = {}) {
  const p = cleanPick(pick);
  if (!p || p === 'hs80') return null;
  return (Array.isArray(list) ? list : []).find((x) => cleanPick(x?.usb) === p && (asGeneric || !isHs80(x.usb))) || null;
}

// the USB headset to run when the HS80 is not used: the chosen one if it is plugged in, else the first one
// (a wired one only when it is the chosen one: PC speakers are never taken for a headset by themselves)
export function genericFor(list, pick, { asGeneric = false } = {}) {
  const all = (Array.isArray(list) ? list : []).filter((x) => x?.usb && (asGeneric || !isHs80(x.usb)));
  return chosenOther(all, pick, { asGeneric }) || all.find((x) => !isJack(x.usb)) || null;
}
