// Wired headsets and headphones (22 Oct 2026, Shawn: "add audio technica to the connection for the headset", "its just
// wired"). A headset on the PC's 3.5 mm jack (or the front panel) is not a USB device, so Windows' USB headset list
// (helpers/audio-default.cs Headsets) never names it. Here every active sound output that is NOT on USB and NOT a
// monitor's or graphics card's audio becomes a choice for the Headset page, keyed "JACK_<8 hex>" (a hash of Windows'
// endpoint id, stable while it stays plugged into the same jack), with the mics of the same sound card as its mic.
// It is only ever used when picked on the Headset page: PC speakers are never taken for a headset by themselves.
// Pure functions: helpers/corsair.js feeds them Windows' lists; tests/wired-headsets.mjs checks them.

// not a headset: the audio a graphics card sends to a monitor over HDMI or DisplayPort, digital outputs, virtual devices
const NOT_HEADPHONES = /nvidia|amd high definition|intel\(r\) display|hdmi|displayport|digital|s\/pdif|spdif|optical|virtual|cable input|voicemeeter|steam streaming|oculus|nahimic mirror/i;
const NOT_A_MIC = /stereo mix|what u hear|wave out|line in|cable output|voicemeeter|virtual/i;

const keyOf = (endpointId) => {
  let h = 2166136261;
  for (const c of String(endpointId)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `JACK_${(h >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
};
const isJack = (k) => /^JACK_[0-9A-F]{8}$/.test(String(k || ''));
// "Headphones (Realtek(R) Audio)" -> "Realtek(R) Audio": the sound card, to pair outputs with mics
const cardOf = (name) => { const m = /\((.*)\)\s*$/.exec(String(name || '')); return m ? m[1].trim().toLowerCase() : ''; };

// One headset over Bluetooth (29 Oct 2026, Shawn: one device, every connection). Windows lists a Bluetooth headset as two
// sound devices, "Headphones (Arctis Nova 3P)" for music and "Headset (Arctis Nova 3P Hands-Free AG Audio)" for calls.
// Those become ONE choice, named by the headset's own name, with the stereo output first and the hands-free mic. When
// the same headset is also on USB (its dongle or cable; matched by name), it is not a second headset: usbHeadsets()
// adds its Bluetooth side to the USB one instead.
// "Arctis Nova 3P Hands-Free AG Audio" -> "arctis nova 3p"
const baseName = (name) => cardOf(name).replace(/\b(hands-?free|ag audio|stereo|bluetooth|bt|le audio|headset|headphones|wireless)\b/gi, ' ').replace(/[^a-z0-9+]+/gi, ' ').trim().toLowerCase();
const sameHeadset = (a, b) => !!a && !!b && (a === b || (a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b)));
function bluetoothHeadsets(endpoints, btIds, names) {
  const bt = (endpoints || []).filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string' && btIds.has(e.id));
  const groups = new Map();
  for (const e of bt) { const b = baseName(e.name); if (!b) continue; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(e); }
  return [...groups].map(([base, list]) => {
    const outs = list.filter((e) => e.flow === 'playback').sort((x, y) => Number(/hands-?free/i.test(x.name)) - Number(/hands-?free/i.test(y.name)));
    const key = keyOf(`bluetooth:${base}`);
    const own = typeof names?.[key] === 'string' && names[key].trim() ? names[key].trim().slice(0, 40) : null;
    const inner = (n) => { const m = /\((.*)\)\s*$/.exec(String(n || '')); return m ? m[1].trim() : String(n || '').trim(); };
    const shown = inner((outs[0] || list[0]).name).replace(/\s*(hands-?free( ag audio)?|stereo)\s*$/i, '').trim();
    return { usb: key, device: own || shown, base, wired: false, bluetooth: true, headphones: true,
      playback: outs.map((o) => ({ id: o.id, name: o.name })),
      recording: list.filter((e) => e.flow === 'recording').map((m) => ({ id: m.id, name: m.name })) };
  }).filter((x) => x.playback.length);
}
// the USB headsets with the same headset's Bluetooth side folded in: { headsets, bluetooth: [the ones on Bluetooth only] }
function foldBluetooth(usbList, btList) {
  const left = [];
  const out = (usbList || []).map((x) => ({ ...x }));
  for (const b of btList || []) {
    const u = out.find((x) => sameHeadset(baseName(`(${x.device || ''})`), b.base));
    if (u) u.bluetooth = { playback: b.playback, recording: b.recording };
    else left.push(b);
  }
  return { headsets: out, bluetooth: left };
}

// endpoints: Windows' active sound devices [{ flow: 'playback'|'recording', id, name }]; usbIds: the ids of every endpoint
// on a USB device; names: settings.json "headsetNames" { key: a name the person gave it }; btIds: the ids of every
// endpoint on a Bluetooth device (left out of the jack list: bluetoothHeadsets() has them)
function wiredHeadsets(endpoints, usbIds = [], names = {}, btIds = []) {
  const usb = new Set([...usbIds, ...btIds]);
  const ok = (e) => e && typeof e.id === 'string' && typeof e.name === 'string' && !usb.has(e.id);
  const outs = (endpoints || []).filter((e) => ok(e) && e.flow === 'playback' && !NOT_HEADPHONES.test(e.name));
  const mics = (endpoints || []).filter((e) => ok(e) && e.flow === 'recording' && !NOT_A_MIC.test(e.name));
  return outs.map((o) => {
    const key = keyOf(o.id), card = cardOf(o.name);
    const own = typeof names?.[key] === 'string' && names[key].trim() ? names[key].trim().slice(0, 40) : null;
    // an output Windows calls "Speakers (...)" is the PC's or laptop's own speakers, or headphones on a jack Windows does
    // not tell apart (29 Oct 2026: a laptop's "Speakers (Realtek(R) Audio)" beside an Arctis read as a second headset)
    const plainName = /^speakers\b/i.test(o.name) ? 'PC speakers or jack' : o.name;
    return { usb: key, device: own || plainName, wired: true, headphones: true,
      playback: [{ id: o.id, name: o.name }],
      recording: card ? mics.filter((m) => cardOf(m.name) === card).map((m) => ({ id: m.id, name: m.name })) : [] };
  });
}
module.exports = { wiredHeadsets, bluetoothHeadsets, foldBluetooth, baseName, keyOf, isJack };
