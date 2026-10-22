// Generic 2.4G receivers (22 Oct 2026; docs/handoff/support-request.md). Many cheap wireless mice and keyboards come
// with a receiver built on a chip maker's own USB vendor id, not the brand's. Such a receiver usually has no settings
// at all: it works as a normal mouse or keyboard, so DeviceHub says that in one plain line instead of offering a
// learning session (Learn a device refuses 258A and 22D4 anyway: helpers/learn-wizard.mjs SHARED_CHIPS).
// Used by the Set up card (helpers/auto-setup.mjs summary), the Lighting page's "Other devices plugged in" rows and the
// first-run screen (public/pages/pc-lights.js, overview.js), and the support request (helpers/support-request.mjs).
//
// Only chip makers the brand guide lists as shared ids, each with its source:
// - 258A Sinowealth: docs/brands/glorious.md (Glorious' wireless mice ship on Sinowealth receivers, cable 2011-2014,
//   dongle 2022-2025; OpenRGB SinowealthControllerDetect.cpp says the same ids are reused by Redragon and others) and
//   docs/BRANDS.md "Shared chip ids". The product ids the sheet names for a real Glorious model are never generic.
// - 22D4 Laview: docs/brands/glorious.md (the other chip Glorious ships on; Linux hid-ids.h) and docs/BRANDS.md.
// - 04D9 Holtek, 0C45 Sonix: docs/BRANDS.md "Shared chip ids" (Holtek: Ducky and many others; Sonix: Patriot
//   peripherals). These two also make keyboards and webcams sold under a brand, so only a device Windows itself names a
//   receiver or dongle counts.
// A vendor id the brand guide does not list (for example 25A7) is not named here until a sheet gives it a source.
export const GENERIC_DONGLE_CHIPS = {
  '258a': { chip: 'Sinowealth', noName: true, brandPids: ['0033', '0036', '2011', '2012', '2013', '2014', '2022', '2023', '2024', '2025'], source: 'docs/brands/glorious.md; docs/BRANDS.md' },
  '22d4': { chip: 'Laview', noName: false, brandPids: ['1503'], source: 'docs/brands/glorious.md; docs/BRANDS.md' },
  '04d9': { chip: 'Holtek', noName: false, brandPids: [], source: 'docs/BRANDS.md' },
  '0c45': { chip: 'Sonix', noName: false, brandPids: [], source: 'docs/BRANDS.md' },
};
// what Windows calls a plain receiver ("2.4G Wireless Receiver", "USB Receiver", "Wireless Dongle")
export const RECEIVER_NAME = /\b(?:receiver|dongle|2\.4\s*g(?:hz)?\b|wireless (?:mouse|keyboard|device))/i;

const hex = (x) => String(x || '').toLowerCase().replace(/^0x/, '');
// { chip, line } for a generic receiver, or null. u: { vid, pid, name } (pc-map's USB list, Windows' name or null)
export function genericDongle(u) {
  if (!u) return null;
  const vid = hex(u.vid), pid = hex(u.pid);
  const c = GENERIC_DONGLE_CHIPS[vid];
  if (!c || !/^[0-9a-f]{4}$/.test(pid) || c.brandPids.includes(pid)) return null;
  const name = String(u.name || '').trim();
  if (name ? !RECEIVER_NAME.test(name) : !c.noName) return null;
  return { chip: c.chip, line: dongleLine(c.chip) };
}
export const dongleLine = (chip) => `A generic 2.4G receiver (${chip} chip). These usually have no settings to learn; it works as a normal mouse or keyboard.`;
