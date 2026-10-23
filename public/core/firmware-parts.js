// Settings > Device firmware: one row per built-in device this PC has (22 Oct 2026, Shawn: "I also dont want my
// devices like icue etc if there is no device that uses that"). shown: core/devices.js shownDevices() (the devices this
// PC has had or has connected now; all of them in demo mode). No DOM here, so tests/seen-only.mjs runs it in Node.
//   mouse     the Pulsar mouse and dongle, the Pulsar app
//   headset   the Corsair headset, iCUE
//   keyboard  the Epomaker keyboard, Epomaker's firmware page
const PARTS = ['mouse', 'headset', 'keyboard'];
// the headset slot also runs other USB headsets (sound only) and the keyboard slot any VIA keyboard: their rows are the
// HS80's and the P75's own, so only for those models (23 Oct 2026, a friend's HyperX was offered iCUE's steps)
const OWN = { headset: /HS80/i, keyboard: /P75/i };
export const firmwareParts = (shown) => PARTS.filter((id) => (shown || []).some((d) => d?.id === id && (!OWN[id] || OWN[id].test(String(d.adapter?.title || '')))));
