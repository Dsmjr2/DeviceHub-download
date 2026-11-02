// Vial keyboards (1 Nov 2026): a keyboard running vial-qmk carries its own layout (its vial.json), so the Keyboard page
// can draw it with no definition file to fetch. Vial talks on the same raw HID collection as VIA (usage page 0xFF60,
// usage 0x61, 32-byte reports); its commands start with the prefix 0xFE.
//
// What is sent, and nothing else (READS ONLY; send() below refuses any other byte pattern):
//   FE 00                get keyboard id: reply bytes 0-3 Vial protocol version (uint32 LE), 4-11 keyboard uid
//   FE 01                get definition size: reply bytes 0-3 its compressed size (uint32 LE)
//   FE 02 <page u32 LE>  one 32-byte block of the compressed definition; the firmware reads the page from bytes 2-3
//                        (uint16 LE), the Vial GUI sends it as a uint32 LE ("<BBI"), so the two upper bytes are 0
// Never sent: unlock (FE 06/07), lock (FE 08), the encoder write (FE 04), QMK settings (FE 09-0C), dynamic entries
// (FE 0D), or anything else.
// Sources: vial-qmk quantum/vial.c vial_handle_cmd and quantum/vial.h (VIAL_PROTOCOL_VERSION 6, VIAL_RAW_EPSIZE 32,
// the command ids) @ dd43959ae5c08d8a28d38a1acf7b04e86b14a344; vial-gui src/main/python/protocol/keyboard_comm.py
// reload_layout and constants.py @ aef8222a2d0429a183b2ed692d5f9efcfd383f08. The replies do NOT echo the request
// (vial.c writes the answer from byte 0), so any reply is taken and then judged on what it says. A keyboard without
// Vial answers FE as QMK via.c answers any unknown command (0xFF then the request) or not at all: that, a version
// Vial never had, a size of 0 or over the limit, or a first block that is not an .xz header stops the read at once.
// The definition is the vial.json, minified and compressed by Python's lzma.compress (vial-qmk
// util/vial_generate_definition.py: xz container, LZMA2, CRC64), decoded by public/core/xz.js.
import { HidChannel } from './hid.js';
import { xzDecompress } from '../core/xz.js';
import { fromDefinition } from './via-layout.js';

export const PREFIX = 0xfe;
export const CMD = { keyboardId: 0x00, size: 0x01, definition: 0x02 };
const READS = new Set([CMD.keyboardId, CMD.size, CMD.definition]);
export const MAX_COMPRESSED = 64 * 1024;   // real vial.json files compress to a few KB
export const MAX_JSON = 1024 * 1024;
const MAX_VERSION = 0x40;                  // Vial is at protocol 6; a reply far above that is not Vial
const P75 = { vendorId: 0x342d, productId: 0xe479 };   // DeviceHub's own keyboard: never asked anything Vial
const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export class NotVial extends Error { constructor(msg) { super(msg); this.name = 'NotVial'; } }

// the only bytes this module may send
export function allowed(bytes) {
  if (bytes[0] !== PREFIX || !READS.has(bytes[1])) return false;
  const tail = bytes[1] === CMD.definition ? 6 : 2;
  for (let i = tail; i < bytes.length; i++) if (bytes[i]) return false;
  return true;
}

// device: a WebHID-like device on the FF60 collection (the agent: a raw channel, helpers/hid-host.mjs vialChannel).
// -> { def, protocol, uid, size, blocks }. Throws NotVial when the keyboard is not Vial (nothing more is sent), or an
// Error naming what was wrong with a Vial answer.
export async function readVialDefinition(device, { timeoutMs = 300, blockMs = 500 } = {}) {
  if (device?.vendorId === P75.vendorId && device?.productId === P75.productId) throw new NotVial('the Epomaker P75 has its own built-in layout and is never asked Vial questions');
  if (!device.opened) await device.open();
  const ch = new HidChannel(device, { reportId: 0, length: 32, match: () => true });
  const ask = async (bytes, ms) => {
    if (!allowed(bytes)) throw new Error(`refusing Vial command ${bytes.slice(0, 2).map((b) => b.toString(16)).join(' ')}`);
    return ch.request(bytes, { timeoutMs: ms });
  };
  let r;
  try { r = await ask([PREFIX, CMD.keyboardId], timeoutMs); } catch (e) { throw new NotVial(`it did not answer Vial's keyboard id question (${e.message})`); }
  const protocol = u32le(r, 0);
  if (r[0] === 0xff || protocol > MAX_VERSION) throw new NotVial(`it answered Vial's keyboard id question with ${hexOf(r.slice(0, 4))}, which is not Vial`);
  const uid = hexOf(Array.from(r.slice(4, 12)).reverse(), '');
  try { r = await ask([PREFIX, CMD.size], timeoutMs); } catch (e) { throw new NotVial(`it did not answer Vial's size question (${e.message})`); }
  const size = u32le(r, 0);
  if (!size || size > MAX_COMPRESSED) throw new NotVial(`it gave a definition size of ${size} bytes, which is not a Vial definition`);
  const blocks = Math.ceil(size / 32);
  const data = new Uint8Array(blocks * 32);
  for (let page = 0; page < blocks; page++) {
    r = await ask([PREFIX, CMD.definition, page & 0xff, (page >>> 8) & 0xff, 0, 0], blockMs);
    if (r.length < 32) throw new Error(`block ${page} of its definition came back short`);
    data.set(r.slice(0, 32), page * 32);
    if (page === 0 && !XZ_MAGIC.every((b, i) => data[i] === b)) throw new NotVial('the first block of its definition is not an xz file, so it is not Vial');
  }
  const json = xzDecompress(data.slice(0, size), { maxOutput: MAX_JSON });
  let def;
  try { def = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); } catch (e) { throw new Error(`its definition is not valid JSON (${e.message})`); }
  if (!def || typeof def !== 'object' || Array.isArray(def)) throw new Error('its definition is not a keyboard definition');
  fromDefinition(def);   // throws when it is not a layout DeviceHub can draw
  return { def, protocol, uid, size, blocks };
}

const hexOf = (a, sep = ' ') => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(sep);
