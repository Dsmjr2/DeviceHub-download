// Settings > Device firmware: one row per built-in device this PC has (22 Oct 2026, Shawn: "I also dont want my
// devices like icue etc if there is no device that uses that"). shown: core/devices.js shownDevices() (the devices this
// PC has had or has connected now; all of them in demo mode). No DOM here, so tests/seen-only.mjs runs it in Node.
//   mouse     the Pulsar mouse and dongle, the Pulsar app
//   headset   the Corsair headset, iCUE
//   keyboard  the Epomaker keyboard, Epomaker's firmware page
const PARTS = ['mouse', 'headset', 'keyboard'];
export const firmwareParts = (shown) => PARTS.filter((id) => (shown || []).some((d) => d?.id === id));
