// ROCCAT mice and keyboards (USB vendor 0x1E7D), written 22 Oct 2026. Status "untested": nothing here has run on a real
// device; tests/sim-roccat-peripherals.mjs drives simulated ones only. No code was copied; every report id, length and
// byte offset below is cited beside it to one of these files, read at the commit named:
//   libratbag = github.com/libratbag/libratbag @ 8235b5bb6032dea15901ab58a8218956f4494d08
//     src/driver-roccat-kone-pure.c (Kone Pure), src/driver-roccat.c (Kone XTD), src/driver-roccat-kone-emp.c (Kone EMP),
//     data/devices/roccat-kone-pure.device, roccat-kone-xtd.device, roccat-kone-emp.device (product ids)
//   kernel = github.com/torvalds/linux @ 7be4bc52fd9e0e55dc9a2e0232b89427d2c4b614, drivers/hid/
//     hid-roccat-konepure.c, hid-roccat-koneplus.h (the Kone XTD's driver), hid-roccat-common.c / .h (the control
//     report and its status codes), hid-ids.h (product ids). Same author as roccat-tools (Stefan Achatz); roccat-tools
//     itself drives the mice through these kernel files. roccat-tools' own source was not reachable (see the handoff).
//   OpenRGB = gitlab.com/CalcProgrammer1/OpenRGB @ bbc77470a7cba56af60989e54ba910d5ac66a3ac, Controllers/RoccatController/
//     RoccatKoneXPController/RoccatKoneXPController.cpp + .h + RGBController_RoccatKoneXP.cpp, RoccatBurstController/
//     RoccatBurstController.cpp + .h, RoccatKovaController/RoccatKovaController.cpp + .h, RoccatVulcanKeyboardController/
//     RoccatVulcanKeyboardController.cpp + .h + RoccatVulcanKeyboardLayouts.h, RoccatControllerDetect.cpp (interfaces)
//   sheet = docs/brands/turtle-beach.md (sections 1-4), which cites the same projects.
//
// What it does, per family (only what a source both reads and writes is a setting; a read alone is shown as a reading):
//   Kone Pure / Pure Optical / XTD / EMP (libratbag): the active profile (read 05, set 05 03 <n>), the DPI stage in use
//     and each enabled DPI stage (the settings block, report 06), and the polling rate (writable on the EMP only, where
//     libratbag writes it; a reading on the Pure and XTD, where libratbag only reads it).
//   Kone XP (OpenRGB): lighting brightness (profile block 06, byte 0x20); active profile and firmware as readings.
//   Burst Pro / Burst Core (OpenRGB): lighting brightness (block 06, byte 32).
//   Kova (OpenRGB): firmware only.  Vulcan family keyboards (OpenRGB): firmware and layout only.
// Every block write is a read-modify-write of the whole block exactly as just read, with only the one setting's bytes
// changed and the Sum16 checksum recomputed (sheet s4: "Always read-modify-write the whole block, recompute Sum16, then
// wait for ready"); it is always sent, even when nothing changed, then read back in full: any other byte that moved, or
// the setting itself not reading back, sends the block read before back once, byte for byte, and the write fails.
//
// Not done, on purpose: battery (no source reads one on any ROCCAT mouse: the Kone Pro Air and Burst Pro Air
// controllers only write lights); the Kone Pro (OpenRGB reads its block with report id 0 and overwrites bytes 3-5
// before writing, so no read-back of report 06 is documented); the Kone Pro Air, Burst Pro Air, Kone Aimo, Horde Aimo
// (write-only lights); DPI and polling on the Kone XP and Burst (units and codes not spelled out: sheet s6); lights
// other than brightness, buttons, macros (report 07 / 08), the sensor (0F) and TCU (0C) reports, "talk" (10), direct
// mode (0E / 0D), and every Vulcan lighting report. Never: firmware write 1B / 1C (kernel hid-roccat-koneplus.h) and the
// Ryos reset 11 (kernel hid-roccat-ryos.c), on helpers/never-commands.json; nothing outside the reports named here can
// be built by this file.
//
// HID LAYER (docs/handoff/hid-core.md): one channel per product id (hid.pids / hid.byPid), opened feature-only
// (FSET / FGET only). Report ids are the first byte of each ROCCAT report (sheet s2 "Byte 0 is the report id").
// UNCONFIRMED (check with helpers/hid-caps.ps1 -Vid 1e7d and one read before any write):
//  - The libratbag mice's collection: the kernel binds the interface whose protocol is "mouse" (USB interface 0 is
//    assumed) and every feature report sits on it; on Windows the collection is chosen by its feature length, taken
//    from the longest report (the macro, kernel 0x0822 bytes for the Pure and XTD; libratbag's 1026-byte macro bank for
//    the EMP).
//  - The Kone Pure Optical (2DB4): the kernel's konepure driver serves it with the same report sizes; libratbag's
//    Kone Pure layout is assumed for it.
//  - Whether report 06 on the Burst returns the active profile's block (OpenRGB reads it without selecting one; the
//    driver shows the block's own profile number and writes that block back).
import { getDevice } from '../../public/devices/hid.js';

export const VID = 0x1e7d;
// report ids (sheet s2 family pattern; kernel hid-roccat-koneplus.h koneplus_commands; libratbag ROCCAT_REPORT_ID_*)
export const RID = { control: 0x04, profile: 0x05, settings: 0x06, info: 0x09, vulcanInfoOld: 0x0f };
// libratbag ROCCAT_CONFIG_SETTINGS / kernel KONEPLUS_CONTROL_REQUEST_PROFILE_SETTINGS: "read the settings of profile n"
export const CONFIG_SETTINGS = 0x80;
// kernel hid-roccat-common.c roccat_common2_control_states: 0 critical, 1 ok, 2 invalid, 3 busy, 4 critical (new)
export const CONTROL_STATUS = { 0: 'critical', 1: 'ok', 2: 'invalid', 3: 'busy', 4: 'critical' };
// libratbag report_rates[] = { 125, 250, 500, 1000 }: the settings block's report_rate byte is an index into it
export const RATES = [125, 250, 500, 1000];

// ---- the families: block size (with the report id), byte offsets, ranges (each cited) ----
const LIBRATBAG_OFF = { profile: 2, mask: 6, xres: 7, cur: 12, yres: 13, rate: 19 };  // struct roccat_settings_report (kone-pure.c, roccat.c)
export const FAMILIES = {
  // driver-roccat-kone-pure.c: ROCCAT_REPORT_SIZE_SETTINGS 31 (kernel hid-roccat-konepure.c profile_settings 0x06, 0x1f);
  // "No checksum for settings report on Kone Pure" (roccat_write_resolution); dpi = xres * 50; write limits
  // dpi_x 200-8200, dpi_y 100-5000, step 50; ROCCAT_PROFILE_MAX 4 (profiles 0-4); report 05 is 3 bytes
  pure: { kind: 'mouse', size: 31, sum: false, select: 'libratbag', ready: 3, profiles: 5, off: LIBRATBAG_OFF,
    dpi: { scale: 50, add: 0, min: 200, max: 8200, step: 50, yMin: 100, yMax: 5000 }, rateWritable: false, infoLen: 6, src: 'libratbag driver-roccat-kone-pure.c' },
  // driver-roccat.c: ROCCAT_REPORT_SIZE_SETTINGS 43, checksum (u16) last (roccat_compute_crc over len - 2), dpi_x and dpi_y
  // 200-8200 step 50 (kernel hid-roccat-koneplus.h KONEPLUS_SIZE_PROFILE_SETTINGS 0x2b)
  xtd: { kind: 'mouse', size: 43, sum: true, select: 'libratbag', ready: 3, profiles: 5, off: LIBRATBAG_OFF,
    dpi: { scale: 50, add: 0, min: 200, max: 8200, step: 50, yMin: 200, yMax: 8200 }, rateWritable: false, infoLen: 6, src: 'libratbag driver-roccat.c' },
  // driver-roccat-kone-emp.c struct roccat_settings_report: magic 0x29 (41 bytes), xres[5] at 7, yres[5] at 12, current_dpi
  // 17, report_rate 18 ("From 0x00 to 0x03", written by roccat_write_profile), checksum last; dpi = raw * 100 + 100,
  // ROCCAT_MIN_DPI 100, ROCCAT_MAX_DPI 12000 (raw 0x00-0x77); 5 profiles (ratbag_device_init_profiles ROCCAT_PROFILE_MAX)
  emp: { kind: 'mouse', size: 41, sum: true, select: 'libratbag', ready: 3, profiles: 5, off: { profile: 2, mask: 6, xres: 7, yres: 12, cur: 17, rate: 18 },
    dpi: { scale: 100, add: 100, min: 100, max: 12000, step: 100, yMin: 100, yMax: 12000, rawMax: 0x77 }, rateWritable: true, infoLen: null, src: 'libratbag driver-roccat-kone-emp.c' },
  // RoccatKoneXPController.cpp GetMode / SetMode: report 06, 0xAE bytes, profile at 2, brightness at 0x20, sum16 at 0xAC;
  // SetReadProfile 04 <profile> 80 FF; WaitUntilReady: get 04 (4 bytes) until byte 1 = 1; GetActiveProfile: 05, 4 bytes,
  // byte 2; GetVersion: 09, 9 bytes, byte 2 (".h" BRIGHTNESS_MIN 0x00, BRIGHTNESS_MAX 0xFF)
  xp: { kind: 'mouse', size: 0xae, sum: true, select: 'xp', ready: 4, profileLen: 4, brightness: 0x20, bright: { min: 0, max: 255 }, infoLen: 9, src: 'OpenRGB RoccatKoneXPController.cpp' },
  // RoccatBurstController.cpp SetMode: get 06 (63 bytes, ROCCAT_BURST_FLASH_PACKET_LENGTH) with no profile select,
  // brightness at 32, sum16 at 61-62, then a 10 ms wait (".h" BRIGHTNESS 0x00-0xFF)
  burst: { kind: 'mouse', size: 63, sum: true, select: null, ready: null, waitAfterWrite: 10, brightness: 32, bright: { min: 0, max: 255 }, infoLen: null, src: 'OpenRGB RoccatBurstController.cpp' },
  // RoccatKovaController.cpp FetchFirmwareVersion: 09, ROCCAT_KOVA_VERSION_READ_PACKET_SIZE 8, byte 2 / 100
  kova: { kind: 'mouse', size: null, infoLen: 8, src: 'OpenRGB RoccatKovaController.cpp' },
  // RoccatVulcanKeyboardController.cpp InitDeviceInfo: 09 (9 bytes) on the newer boards, 0F (8 bytes) otherwise; read
  // twice, the second counts; byte 2 = version (103 = 1.03), byte 6 = layout (not on the Magma / Magma Mini)
  vulcan: { kind: 'keyboard', size: null, src: 'OpenRGB RoccatVulcanKeyboardController.cpp' },
};

// ---- the models: product id -> family, name and collection ----
// iface / page / usage: OpenRGB RoccatControllerDetect.cpp REGISTER_HID_DETECTOR_IPU / _IP lines (Kone XP 3 / FF01 / 1,
// Burst 3 / FF01 / 1, Kova 0 / 0x0B / 0; the Vulcan control interface 1 with page FF01, or 0x0B for the Vulcan 100 / 120
// Aimo and TKL: DetectRoccatVulcanKeyboardControllers dev_ctrl_iface / dev_ctrl_page). libratbag mice: interface 0 and
// the feature length (UNCONFIRMED, see the top).
const m = (name, family, chan, o = {}) => ({ name, family, chan, ...o });
const PURE_CH = { iface: 0, page: '*', usage: '*', featureLen: 0x0822 - 1 };   // kernel KONEPLUS_SIZE_MACRO / konepure macro 0x0822
const EMP_CH = { iface: 0, page: '*', usage: '*', featureLen: 1026 - 1 };      // libratbag ROCCAT_REPORT_SIZE_MACRO_BANK 1026
const V_FF01 = { iface: 1, page: 'FF01', usage: '*' }, V_0B = { iface: 1, page: '000B', usage: '*' };
export const MODELS = {
  '2DBE': m('Kone Pure', 'pure', PURE_CH),                 // libratbag roccat-kone-pure.device; kernel USB_DEVICE_ID_ROCCAT_KONEPURE
  '2DC2': m('Kone Pure', 'pure', PURE_CH),                 // libratbag roccat-kone-pure.device DeviceMatch
  '2DCB': m('Kone Pure', 'pure', PURE_CH),                 // libratbag roccat-kone-pure.device DeviceMatch
  '2DB4': m('Kone Pure Optical', 'pure', PURE_CH),         // kernel USB_DEVICE_ID_ROCCAT_KONEPURE_OPTICAL, konepure_devices[]
  '2E22': m('Kone XTD', 'xtd', PURE_CH),                   // libratbag roccat-kone-xtd.device; kernel USB_DEVICE_ID_ROCCAT_KONEXTD
  '2E24': m('Kone EMP', 'emp', EMP_CH),                    // libratbag roccat-kone-emp.device
  '2C8B': m('Kone XP', 'xp', { iface: 3, page: 'FF01', usage: '0001' }),       // OpenRGB ROCCAT_KONE_XP_PID
  '2DE1': m('Burst Pro', 'burst', { iface: 3, page: 'FF01', usage: '0001' }),  // OpenRGB ROCCAT_BURST_PRO_PID
  '2DE6': m('Burst Core', 'burst', { iface: 3, page: 'FF01', usage: '0001' }), // OpenRGB ROCCAT_BURST_CORE_PID
  '2CEE': m('Kova', 'kova', { iface: 0, page: '000B', usage: '0000' }),        // OpenRGB ROCCAT_KOVA_PID
  // RoccatVulcanKeyboardController.h PIDs; info 09 on the cases listed in InitDeviceInfo, else 0F
  '2F4E': m('Vulcan II', 'vulcan', V_FF01, { info: 0x09 }),
  '2F09': m('Vulcan II Mini', 'vulcan', V_FF01, { info: 0x09 }),
  '2EE2': m('Vulcan II Max', 'vulcan', V_FF01, { info: 0x09 }),
  '30F7': m('Vulcan Pro', 'vulcan', V_FF01, { info: 0x09 }),
  '311A': m('Vulcan TKL Pro', 'vulcan', V_FF01, { info: 0x09 }),
  '314C': m('Pyro', 'vulcan', V_FF01, { info: 0x09 }),
  '3124': m('Magma', 'vulcan', V_FF01, { info: 0x09, noLayout: true }),
  '69A0': m('Magma Mini', 'vulcan', V_FF01, { info: 0x09, noLayout: true }),
  '307A': m('Vulcan 100 Aimo', 'vulcan', V_0B, { info: 0x0f }),
  '3098': m('Vulcan 120 Aimo', 'vulcan', V_0B, { info: 0x0f }),
  '2FEE': m('Vulcan TKL', 'vulcan', V_0B, { info: 0x0f }),
};
export const PIDS = Object.keys(MODELS);
// RoccatVulcanKeyboardLayouts.h ROCCAT_VULCAN_LAYOUT_*
export const LAYOUTS = { 0: 'US', 1: 'DE', 2: 'UK', 3: 'FR', 6: 'JP' };

// the maker's app (helpers/diagnose.mjs 'swarm': Swarm II); the sheet s4 says it holds the channel (process names unconfirmed)
export const VENDOR_APPS = [/swarm\s*ii/i, /^roccat swarm/i, /^swarm/i];
async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res, rej) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => (e ? rej(new Error(`tasklist failed: ${e.message}`)) : res(so))));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
  return null;
}
async function defaultOpen(pid, model) {
  const dev = await getDevice([{ vendorId: VID, productId: parseInt(pid, 16), iface: model.chan.iface }], { prompt: false });
  if (dev && dev.opened === false && typeof dev.open === 'function') await dev.open();
  return dev;
}
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
// sheet s3 "Sum16 = 16-bit sum of every byte except the last two, stored low byte then high" (libratbag
// roccat_compute_crc; OpenRGB CalculateCRC / SetMode's total)
export function sum16(block) { let s = 0; for (let i = 0; i < block.length - 2; i++) s = (s + block[i]) & 0xffff; return s; }
export function sumOk(block) { const s = sum16(block); return block[block.length - 2] === (s & 0xff) && block[block.length - 1] === s >> 8; }
export function withSum(block) { const b = Uint8Array.from(block); const s = sum16(b); b[b.length - 2] = s & 0xff; b[b.length - 1] = s >> 8; return b; }
const APP_CHECK_MS = 15000;
const fwText = (b) => `${Math.floor(b / 100)}.${String(b % 100).padStart(2, '0')}`;   // OpenRGB "%d.%02d", b / 100, b % 100

export function createRoccat({ sleep = sleepReal, open = defaultOpen, vendorApp = defaultVendorApp, now = () => Date.now() } = {}) {
  return {
    id: 'roccat-peripherals',
    title: 'ROCCAT mouse or keyboard',
    kind: 'Mouse or keyboard',
    vendor: 'ROCCAT',
    // each product id's own collection (byPid replaces iface / page / usage / featureLen per id; the base names none of them
    // except the first id's, so no id inherits another's feature length)
    hid: { vid: '1E7D', pid: '2DBE', pids: PIDS, len: 64, reportId: 0, featureOnly: true, ...PURE_CH,
      byPid: Object.fromEntries(PIDS.map((p) => [p, { iface: null, page: '*', usage: '*', featureLen: null, ...MODELS[p].chan, productName: `ROCCAT ${MODELS[p].name}` }])) },
    MODELS, FAMILIES, VENDOR_APPS,
    dev: null, pid: null, model: null, fam: null, last: null, raw: {}, app: null, appAt: 0,

    get unsupported() {
      return ['firmware updates (never: reports 1B / 1C are on DeviceHub\'s never list)', 'battery (no source reads a ROCCAT battery)',
        'lights other than brightness, buttons and macros', 'DPI and polling on the Kone XP and Burst (units not documented)',
        'Kone Pro, Kone Pro Air, Burst Pro Air, Kone Aimo: no setting with a documented read-back', 'Vulcan lighting (write-only in OpenRGB)'];
    },

    // what the page shows, from the family (and, once read, the DPI stages the mouse has switched on)
    get settings() {
      const f = this.fam;
      if (!f) return [];
      const out = [];
      if (f.select === 'libratbag') {
        out.push({ key: 'profile', label: 'Profile', type: 'choice', options: Array.from({ length: f.profiles }, (_, i) => ({ value: i + 1, label: `Profile ${i + 1}` })),
          hint: 'The mouse\'s active profile; every setting below belongs to it' });
        const stages = this.last ? this.last.enabled : [1, 2, 3, 4, 5];
        out.push({ key: 'dpiStage', label: 'DPI stage in use', type: 'choice', options: stages.map((n) => ({ value: n, label: `Stage ${n}` })) });
        for (const n of stages) out.push({ key: `dpi${n}`, label: `DPI stage ${n}`, type: 'slider', min: f.dpi.min, max: f.dpi.max, step: f.dpi.step, unit: ' DPI',
          hint: 'Saved in the mouse\'s profile. Y follows X when the two were equal; otherwise Y is kept' });
        if (f.rateWritable) out.push({ key: 'pollingRate', label: 'Polling rate', type: 'choice', options: RATES.map((hz) => ({ value: hz, label: `${hz} Hz` })) });
        else out.push({ key: 'pollingRate', label: 'Polling rate', type: 'display', unit: ' Hz', hint: 'Read only: libratbag reads it on this mouse but never writes it' });
      }
      if (f.brightness != null) out.push({ key: 'brightness', label: 'Lighting brightness', type: 'slider', min: f.bright.min, max: f.bright.max, step: 1, unit: '/255',
        hint: 'Saved in the mouse\'s profile; colours and effect stay as they are' });
      if (f.select === 'xp') out.push({ key: 'profile', label: 'Active profile', type: 'display', hint: 'Read only: no source selects a Kone XP profile' });
      return out;
    },

    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        let dev = null;
        try { dev = await open(pid, MODELS[pid]); } catch { dev = null; }
        if (dev) { Object.assign(this, { dev, pid, model: MODELS[pid], fam: FAMILIES[MODELS[pid].family], last: null, raw: {}, app: null, appAt: 0 }); return true; }
      }
      return false;
    },
    need() { if (!this.dev) throw Object.assign(new Error('no ROCCAT device is connected'), { gone: true }); },

    // ---- the feature reports (the only ones this file sends or asks for) ----
    async getReport(id, size) {   // size = the report's whole length with its id (the sources' buffer sizes)
      const dv = await this.dev.receiveFeatureReport(id, size - 1);
      const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      const r = u8[0] === id && u8.length >= size ? u8.slice(0, size) : Uint8Array.from([id, ...u8.slice(0, size - 1)]);
      this.raw[`get ${id.toString(16).padStart(2, '0')}`] = hex(r.slice(0, Math.min(size, 24)));
      return r;
    },
    async setReport(id, data) {
      this.raw[`set ${id.toString(16).padStart(2, '0')}`] = hex(Uint8Array.from([id, ...data]).slice(0, 24));
      await this.dev.sendFeatureReport(id, Uint8Array.from(data));
    },
    // kernel roccat_common2_send_with_status: 100 ms, then the control report (04, 3 bytes) every 50 ms; busy waits 500 ms;
    // invalid or critical is an error. Kone XP (OpenRGB WaitUntilReady): 04 with 4 bytes until byte 1 = 1, 200 ms apart.
    async waitReady() {
      const f = this.fam;
      if (!f.ready) { if (f.waitAfterWrite) await sleep(f.waitAfterWrite); return; }
      await sleep(f.ready === 4 ? 0 : 100);
      for (let i = 0; i < 25; i++) {
        const r = await this.getReport(RID.control, f.ready);
        if (r[1] === 1) return;
        if (f.ready === 3 && r[1] !== 3) throw new Error(`the mouse answered ${CONTROL_STATUS[r[1]] || `status ${r[1]}`} (control report 04)`);
        await sleep(f.ready === 4 ? 200 : r[1] === 3 ? 500 : 50);
      }
      throw new Error('the mouse stayed busy (control report 04 never said ready)');
    },
    async activeProfile() { return (await this.getReport(RID.profile, this.fam.profileLen || 3))[2]; },   // libratbag roccat_current_profile buf[2]; OpenRGB GetActiveProfile buf[2]
    // the settings block of the active profile, exactly as the mouse sent it
    async readBlock() {
      const f = this.fam;
      let profile = null;
      if (f.select) {
        profile = await this.activeProfile();
        if (profile >= (f.profiles || 5)) throw new Error(`the mouse reports profile index ${profile}, outside 0-${(f.profiles || 5) - 1}`);
        // libratbag roccat_set_config_profile: 04 <profile> 80; OpenRGB SetReadProfile: 04 <profile> 80 FF
        await this.setReport(RID.control, f.select === 'xp' ? [profile, CONFIG_SETTINGS, 0xff] : [profile, CONFIG_SETTINGS]);
        await this.waitReady();
      }
      const b = await this.getReport(RID.settings, f.size);
      if (b[0] !== RID.settings) throw new Error(`the settings block came back as report ${b[0]}`);
      if (f.sum && !sumOk(b)) throw new Error('the settings block\'s checksum does not add up, so it is not used (nothing is written from it)');
      if (profile != null && b[2] !== profile) throw new Error(`asked for profile ${profile + 1}'s settings, got profile ${b[2] + 1}'s`);
      return { profile: profile ?? b[2], block: b };
    },
    decode(r) {
      const f = this.fam, b = r.block, v = {}, enabled = [];
      if (f.select === 'libratbag') {
        const o = f.off;
        v.profile = r.profile + 1;
        for (let i = 0; i < 5; i++) {
          if (!(b[o.mask] & (1 << i))) continue;   // libratbag: "the profile is disabled" when its dpi_mask bit is clear
          enabled.push(i + 1);
          v[`dpi${i + 1}`] = b[o.xres + i] * f.dpi.scale + f.dpi.add;
        }
        const cur = b[o.cur];
        v.dpiStage = enabled.includes(cur + 1) ? cur + 1 : null;
        v.pollingRate = b[o.rate] < RATES.length ? RATES[b[o.rate]] : null;   // libratbag: an index outside the list is an error
      }
      if (f.brightness != null) v.brightness = b[f.brightness];
      if (f.select === 'xp') v.profile = r.profile + 1;
      return { v, enabled };
    },

    async read() {
      this.need();
      if (!this.fam.size) return {};
      const r = await this.readBlock();
      const { v, enabled } = this.decode(r);
      this.last = { ...r, enabled };
      return v;
    },

    async info() {
      this.need();
      const f = this.fam, out = { Model: `ROCCAT ${this.model.name}`, 'Product id': `1E7D:${this.pid}`, Connection: 'USB cable' };
      if (this.model.family === 'vulcan') {
        const id = this.model.info, size = id === 0x09 ? 9 : 8;
        await this.getReport(id, size);              // OpenRGB InitDeviceInfo reads it twice and keeps the second
        const r = await this.getReport(id, size);
        out.Firmware = fwText(r[2]);
        if (!this.model.noLayout) out.Layout = LAYOUTS[r[6]] ? `${LAYOUTS[r[6]]} (code ${r[6]})` : `code ${r[6]}`;
      } else if (f.infoLen) {
        // kernel koneplus_info: 09, size 6, firmware_version at 2 (Kone Pure, XTD); OpenRGB Kone XP 09 / 9 bytes, Kova 09 / 8
        const r = await this.getReport(RID.info, f.infoLen).catch(() => null);
        out.Firmware = r ? fwText(r[2]) : 'no reply';
      }
      if (f.size) {
        const r = await this.readBlock().catch(() => null);
        if (r) out['Profile in use'] = String(r.profile + 1);
      }
      out.Driver = 'untested library driver: reads first; each setting is written only after DeviceHub\'s own check';
      return out;
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) {
        try { this.app = await vendorApp(); } catch (e) { this.appAt = 0; throw Object.assign(new Error(`could not check whether Swarm II is open (${e.message}), so nothing was written`), { refused: true, waiting: true }); }
        this.appAt = now();
      }
      if (this.app) throw Object.assign(new Error(`${this.app} is running: close it first (two programs writing the mouse fight)`), { refused: true, waiting: true });
    },
    async vendorApp() { return vendorApp(); },

    // one setting: checked, the block read fresh, changed, sent (always), read back in full
    async write(key, value) {
      this.need();
      const s = this.settings.find((x) => x.key === key);
      if (!s || s.type === 'display') throw new Error(`${key} is not a setting DeviceHub can change on the ${this.model.name}`);
      if (s.type === 'slider' && !(Number.isInteger(value) && value >= s.min && value <= s.max && (value - s.min) % (s.step || 1) === 0)) throw new Error(`${s.label} must be ${s.min}-${s.max} in steps of ${s.step || 1}`);
      if (s.type === 'choice' && !s.options.some((o) => o.value === value)) throw new Error(`${s.label} must be one of ${s.options.map((o) => o.value).join(', ')}`);
      await this.appCheck();
      const f = this.fam;
      if (key === 'profile') {
        // libratbag roccat_set_current_profile: 05 03 <index>, then wait for ready; read back with report 05
        await this.setReport(RID.profile, [0x03, value - 1]);
        await this.waitReady();
        const back = (await this.activeProfile()) + 1;
        if (back !== value) throw new Error(`profile: chose ${value}, the mouse reports ${back}`);
        this.last = null;
        return back;
      }
      const before = await this.readBlock();
      const next = Uint8Array.from(before.block);
      const o = f.off;
      if (/^dpi[1-5]$/.test(key)) {
        const i = Number(key[3]) - 1, d = f.dpi;
        if (!(before.block[o.mask] & (1 << i))) throw new Error(`DPI stage ${i + 1} is switched off in this profile`);
        const raw = (value - d.add) / d.scale;
        if (!Number.isInteger(raw) || raw < 0 || raw > (d.rawMax ?? 255)) throw new Error(`${value} DPI does not fit the mouse's DPI byte`);
        next[o.xres + i] = raw;
        // Y follows X only when the two were equal (the Razer driver's rule; libratbag writes x and y separately)
        if (before.block[o.xres + i] === before.block[o.yres + i]) {
          if (value < d.yMin || value > d.yMax) throw new Error(`Y can be ${d.yMin}-${d.yMax} DPI on the ${this.model.name} (${f.src}), so ${value} was not written`);
          next[o.yres + i] = raw;
        }
      } else if (key === 'dpiStage') {
        if (!(before.block[o.mask] & (1 << (value - 1)))) throw new Error(`DPI stage ${value} is switched off in this profile`);
        next[o.cur] = value - 1;                                   // libratbag: current_dpi = resolution->index
      } else if (key === 'pollingRate') {
        next[o.rate] = RATES.indexOf(value);                       // libratbag kone-emp roccat_report_rate_to_index
      } else if (key === 'brightness') {
        next[f.brightness] = value;                                // OpenRGB SetMode: brightness byte
      }
      const sent = f.sum ? withSum(next) : next;                   // Kone Pure: no checksum (libratbag), bytes kept as read
      await this.setReport(RID.settings, sent.slice(1));          // the whole block, always (even when nothing changed)
      await this.waitReady();
      let after;
      try { after = await this.readBlock(); } catch (e) { throw new Error(`${s.label}: written, but reading it back failed (${e.message})`); }
      const moved = [];
      for (let i = 0; i < f.size - (f.sum ? 2 : 0); i++) if (after.block[i] !== sent[i]) moved.push(i);
      if (moved.length) {
        // the block read before goes back once, byte for byte, and nothing else is sent
        await this.setReport(RID.settings, before.block.slice(1));
        await this.waitReady().catch(() => {});
        throw new Error(`${s.label}: the mouse read back other bytes (offsets ${moved.join(', ')}); the settings read before were written back`);
      }
      const { v, enabled } = this.decode(after);
      this.last = { ...after, enabled };
      if (v[key] !== value) throw new Error(`${s.label}: wrote ${value}, read back ${v[key]}`);
      return v[key];
    },

    async rawBackup() {
      this.need();
      const values = await this.read();
      return { pid: this.pid, model: this.model.name, values, block: this.last ? hex(this.last.block) : null, replies: { ...this.raw } };
    },
  };
}

export default createRoccat();
