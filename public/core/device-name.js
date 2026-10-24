// Names that only say what the device's own ids and descriptors support (23 Oct 2026, Shawn: "I really do need each
// receiver or wired device to be recognized properly"; Dsmjr2/DeviceHub-support#10 and #11, docs/handoff/friend-reports-10-11.md).
// A USB device whose vendor id no brand in the brand guide owns (docs/brands.json, public/core/brands.js) and that is
// not a known generic chip (public/core/generic-dongle.js) is named plainly as unknown, with its USB id:
//   "Unknown 2.4G receiver (25A7:FA70)", "Unknown USB device (1A2C:4094)", or its own product string with its id.
// What it seems to be comes from its HID usages only (page 0001 usage 0006 keyboard, 0002 mouse): a keyboard, a mouse
// or both. No brand, model or driver name is ever taken from another device on the PC, a public list of what an id was
// once used for, or a driver that has not found the device answering. Used by Learn a device (helpers/learn-wizard.mjs
// listDevices), the Setup page (helpers/auto-setup.mjs summary) and Get help.
import { genericDongle, RECEIVER_NAME } from './generic-dongle.js';
import { brandForUsb } from './brands.js';

const up = (x) => String(x ?? '').trim().toUpperCase().replace(/^0X/, '').padStart(4, '0');
// Windows' own names that say nothing about the device
const WINDOWS_GENERIC = /^(USB (Composite|Input) Device|HID[- ]compliant\b.*|HID Keyboard Device|USB Receiver|Generic\b.*)$/i;

// usages: { keyboard, mouse } (helpers/pc-map.js usb[].usages, or learn-apps usageKinds) -> words, or null
export function seemsFrom(usages) {
  const k = !!usages?.keyboard, m = !!usages?.mouse;
  return k && m ? 'a keyboard and a mouse' : k ? 'a keyboard' : m ? 'a mouse' : null;
}

// u: { vid, pid, name, usages? } -> { title, seems, unknown: true } for a device no brand owns, else null (the caller
// keeps its own name: a brand the vendor id belongs to, a generic chip's receiver line)
export function plainName(u) {
  if (!u?.vid || !u?.pid) return null;
  const id = `${up(u.vid)}:${up(u.pid)}`;
  if (genericDongle(u)) return null;
  const b = brandForUsb(String(u.vid).toLowerCase().replace(/^0x/, ''));
  if (b && !b.shared) return null;
  const name = String(u.name || '').trim();
  const generic = !name || WINDOWS_GENERIC.test(name) || /^USB device [0-9A-F]{4}:[0-9A-F]{4}$/i.test(name);
  const receiver = RECEIVER_NAME.test(name);
  const title = receiver
    ? `Unknown ${/2\.4\s*g/i.test(name) ? '2.4G' : 'USB'} receiver (${id})`
    : generic ? `Unknown USB device (${id})` : `${name} (${id}, maker not known)`;
  return { title, seems: seemsFrom(u.usages), unknown: true };
}
// the name to show: plainName's title, else the device's own name, else its id
export const shownName = (u) => plainName(u)?.title || String(u?.name || '').trim() || `USB device ${up(u?.vid)}:${up(u?.pid)}`;
