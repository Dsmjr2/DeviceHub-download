// ASUS ROG mice (Harpe Ace Aim Lab Edition, Keris Wireless AimPoint, Gladius III family, Chakram X), on their cable,
// their own 2.4 GHz receiver or the ROG Omni receiver (0B05:1ACE). Written 22 Oct 2026 from docs/brands/asus-rog.md
// only (facts from G-Helper, libratbag and OpenRGB; no code copied). NOT yet run on a real mouse: tests/sim-asus.mjs
// runs it against a simulated mouse that answers as the sheet documents. Every "sheet:" note below names the row used.
//
// HID LAYER (22 Oct 2026: what this driver needed from DeviceHub's HID layer now exists; docs/handoff/hid-core.md):
//   1. Several product ids: `hid.pids` + `hid.byPid` register one channel per pid (helpers/my-devices.mjs hidSpecs),
//      and the agent's provider tries every filter in order; device.productId is the id actually opened.
//   2. Collections by interface path: the cable / own receiver open `mi_00` on usage page FF01 (usage '*': not
//      documented); the Omni receiver's mouse channel opens `mi_02&col03` (iface 2, col 3, page / usage '*').
//   3. Two report ids on one device: the Omni channel's `routes: { 1: { col: 1 } }` sends report 01 (the pair list) on
//      `mi_02&col01`, opened on first use; report 03 goes on col03. Each reply arrives as an inputreport with its id.
//   4. (minor, still so) helpers/hidio.cs Req with echo 2 skips an `FF AA` error reply, so this driver asks with echo 1
//      and matches verb + subcommand itself. `hid.reply: 'raw'` would hand it every report instead; not switched,
//      since the echo-1 path is what the simulation proves.
//   Untested on hardware: the collections' usage pages and report lengths (64 assumed), and that col01 / col03 hold
//   reports 01 / 03. Nothing is sent before a channel opens.
//
// What it never sends (sheet section 4 "Never"): firmware, Omni pairing or unpairing, button remaps (51 21 / 51 22 /
// 51 23), lights (51 28 / 51 29), any subcommand not listed in CMD below. Added 22 Oct 2026 (docs/handoff/
// driver-coverage.md): onboard profile SELECT (read 12 00 byte 11, select 50 02 <p>; no profile block is ever written)
// and the DPI stage count (read 12 00 byte 19, write 51 31 0A 00 <2-4>). The 12 00 read is optional: a mouse that
// answers FF AA to it simply has neither setting. The two things the sources
// disagree on stay read-only: button response (debounce: G-Helper's table and libratbag's differ) and the 8K "booster"
// (how it is switched and how its polling nibble maps to Hz is not documented). Chakram X DPI is read-only too
// (libratbag doubles its DPI, G-Helper's formula does not: measure before writing).
//
// DPI maxima are NOT in the sheet: they are the maker's published sensor maxima, and a stage reading above its model's
// maximum makes DPI read-only for that connection (the table is then wrong for this mouse).
import { HidChannel, getDevice, hex } from '../../public/devices/hid.js';

const VID = 0x0b05, OMNI = 0x1ace;
const HZ = [125, 250, 500, 1000, 2000, 4000, 8000];          // sheet: Polling rate, codes 00..06
const UP_TO_1K = HZ.slice(0, 4);

// sheet section 1 "Mice"; dpiMax: maker's spec (see top); pollingCable: sheet section 4 "Polling above 1000 Hz: only
// on models GH lists for it (Chakram X wired, Harpe II Ace)"
export const MODELS = [
  { key: 'harpe-ace-aim-lab', name: 'ROG Harpe Ace Aim Lab Edition', cable: 0x1a92, dongle: 0x1a94, omni: [0x1a94], battery: true, dpiMax: 36000 },
  { key: 'keris-wireless-aimpoint', name: 'ROG Keris Wireless AimPoint', cable: 0x1a66, dongle: 0x1a68, omni: [0x1a68, 0x1a6a], battery: true, dpiMax: 36000 },
  { key: 'gladius-iii', name: 'ROG Gladius III', cable: 0x197b, battery: false, dpiMax: 19000 },
  { key: 'gladius-iii-wireless', name: 'ROG Gladius III Wireless', cable: 0x197d, dongle: 0x197f, battery: true, dpiMax: 19000 },
  { key: 'gladius-iii-wireless-aimpoint', name: 'ROG Gladius III Wireless AimPoint', cable: 0x1a70, dongle: 0x1a72, omni: [0x1a72], battery: true, dpiMax: 36000 },
  { key: 'chakram-x', name: 'ROG Chakram X', cable: 0x1a18, dongle: 0x1a1a, battery: true, dpiMax: 36000, doubleDpi: true, pollingCable: HZ },
];
export const PIDS = [...new Set(MODELS.flatMap((m) => [m.cable, m.dongle].filter(Boolean)).concat(OMNI))];

// sheet section 2 "Report ids and interfaces"
const LINKS = {
  cable: { label: 'USB cable', reportId: 0x00, path: 'mi_00', wireless: false },
  dongle: { label: 'its own 2.4 GHz receiver', reportId: 0x00, path: 'mi_00', wireless: true },
  omni: { label: 'ROG Omni receiver', reportId: 0x03, path: 'mi_02&col03', wireless: true },
};
const OMNI_PAIRING = { reportId: 0x01, path: 'mi_02&col01' };

// every request this driver can send: [verb, subcommand, ...] (byte 1 on, the report id goes separately)
const CMD = {
  status: [0x12, 0x07],                 // sheet: Battery level / Charging / Sleep / Low-battery warning
  profile: [0x12, 0x04, 0x00],          // sheet: DPI stages, Polling rate, Button response, Angle snapping
  colors: [0x12, 0x04, 0x03],           // sheet: DPI stage colors (read, to be sent back unchanged with a DPI write)
  liftOff: [0x12, 0x06],                // sheet: Lift-off distance
  profileInfo: [0x12, 0x00],            // sheet: Profile `00 12 00` -> byte 11 (G-Helper, libratbag); the same "profile reply"
                                        // carries the DPI stage count at byte 19 (G-Helper). Read 12 00 is in the sheet's safe-read list.
  save: [0x50, 0x03],                   // sheet: Save, "sent after each change"
  pairList: [0xa0, 0x00, 0x00],         // sheet section 2: Omni pair list (report 01)
  booster: [0x7d, 0x20, 0x02],          // sheet section 2: booster probe (report 03), read only
};
const SET = {
  dpi: (stage, raw, rgb = []) => [0x51, 0x31, stage, 0x00, raw & 0xff, raw >> 8, ...rgb],  // `00 51 31 <stage-1> 00 <lo> <hi>` [+ R G B]
  polling: (v) => [0x51, 0x31, 0x04, 0x00, v],                                          // `00 51 31 04 00 <v>`
  snap: (v) => [0x51, 0x31, 0x06, 0x00, v],                                             // `00 51 31 06 00 <0/1>`
  sleep: (off, low) => [0x51, 0x37, 0x00, 0x00, off, 0x00, low],                         // `00 51 37 00 00 <off> 00 <lowbatt>`
  liftOff: (v) => [0x51, 0x35, 0xff, 0x00, 0xff, v],                                    // `00 51 35 FF 00 FF <v>`
  stageCount: (n) => [0x51, 0x31, 0x0a, 0x00, n],                                       // sheet: DPI stage count `00 51 31 0A 00 <2-4>` (G-Helper)
  profile: (p) => [0x50, 0x02, p],                                                      // sheet: Profile `00 50 02 <p>`, 0-based (G-Helper, libratbag); select only
};

// sheet: Sleep codes 00 1 min, 01 2, 02 3, 03 5, 04 10, FF never (value here: minutes, 0 = never)
const SLEEP = { 0x00: 1, 0x01: 2, 0x02: 3, 0x03: 5, 0x04: 10, 0xff: 0 };
const SLEEP_CODE = Object.fromEntries(Object.entries(SLEEP).map(([c, m]) => [m, Number(c)]));
const LIFT = { 0x00: 'low', 0x01: 'high' };   // sheet: Lift-off `00` low, `01` high
// sheet: Button response, the two tables that disagree (shown, never written)
const debounceText = (c) => `code ${c}: G-Helper reads ${c === 0 ? 'off' : c <= 7 ? `${8 + 4 * (c - 1)} ms` : '?'}, libratbag ${c <= 7 ? `${4 + 4 * c} ms` : '?'} (read only: the sources disagree)`;

const isError = (r) => r[0] === 0xff && r[1] === 0xaa;   // sheet: error reply `FF AA` at bytes 1-2
const B = (r, n) => r[n - 1];                            // the sheet counts the report id as byte 0; replies come without it
// sheet section 4: "nothing stops two writers. Step back when ArmouryCrate*.exe or GHelper.exe runs": every write is
// refused while they run; reads (12 xx) go on (driver safety, 22 Oct 2026: as the other library drivers do)
const VENDOR_APPS = /^(armourycrate.*|ghelper)\.exe$/i;

class Refused extends Error {}

function dpiFromRaw(raw, m) { const d = raw * 50 + 50; return m.doubleDpi ? d * 2 : d; }   // sheet: raw = (DPI - 50) / 50; LR doubles on DOUBLE_DPI models

const adapter = {
  id: 'asus-rog-mouse',
  title: 'ASUS ROG mouse',
  kind: 'Mouse',
  // one channel per pid (HID LAYER 1-3): mi_00 on the cable and own receiver; mi_02&col03 (+ col01 for report 01) on the Omni
  hid: { vid: '0B05', pid: '1A92', pids: PIDS.map((p) => p.toString(16).toUpperCase().padStart(4, '0')), page: 'FF01', usage: '*', iface: 0, len: 64, reportId: 0, replyMs: 300,
    byPid: { [OMNI.toString(16).toUpperCase().padStart(4, '0')]: { page: '*', usage: '*', iface: 2, col: 3, reportId: LINKS.omni.reportId, routes: { [OMNI_PAIRING.reportId]: { col: 1 } } } } },
  unsupported: ['firmware updates', 'Omni receiver pairing', 'button remaps', 'lights (OpenRGB has them)', 'button response and the 8K booster (read only: the sources disagree)', 'active DPI stage, angle tuning, low-battery warning, DPI stage colors (not yet: see docs/handoff/driver-coverage.md)'],

  get settings() { return settingsFor(this.model, this.link, this.dpiLocked, this.booster); },

  // the vendor-app check (replaceable in tests); resolves with the running app's name, or null
  async vendorApp() {
    if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
    for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name)) return name; }
    return null;
  },
  async stepBackCheck() {
    if (this.appAt && Date.now() - this.appAt < 15000) { if (this.app) throw new Refused(`${this.app} is running: close it first (two programs writing the mouse fight)`); return; }
    this.app = await this.vendorApp(); this.appAt = Date.now();
    if (this.app) throw new Refused(`${this.app} is running: close it first (two programs writing the mouse fight)`);
  },

  async connect(prompt = false) {
    Object.assign(this, { dev: null, ch: null, model: null, link: null, booster: null, dpiLocked: false, snap: null, snapAt: 0, appAt: 0, app: null });
    const dev = await getDevice(PIDS.map((productId) => (productId === OMNI ? { vendorId: VID, productId } : { vendorId: VID, productId, usagePage: 0xff01 })), { prompt });
    if (!dev) return false;
    if (!dev.opened) await dev.open();
    this.dev = dev;
    this.ch = new HidChannel(dev, { reportId: 0, length: 64, match: (s, r) => isError(r) || (r[0] === s[0] && r[1] === s[1]) });
    if (dev.productId === OMNI) {
      // sheet section 2 "Finding the mouse behind an Omni receiver" (G-Helper's way): ids little-endian at bytes 5, 9, 13 ...
      const r = await this.ask(CMD.pairList, OMNI_PAIRING.reportId);
      if (isError(r)) throw new Error('the Omni receiver refused its pair-list read (FF AA)');
      const ids = [];
      for (let at = 5; at + 1 <= 64; at += 4) { const id = B(r, at) | (B(r, at + 1) << 8); if (!id) break; ids.push(id); }
      this.model = MODELS.find((m) => m.omni && ids.some((id) => m.omni.includes(id)));
      if (!this.model) throw new Error(`no mouse this driver knows is paired to the Omni receiver (paired ids: ${ids.map((i) => i.toString(16).padStart(4, '0')).join(', ') || 'none'})`);
      this.pairedId = ids.find((id) => this.model.omni.includes(id));
      this.link = 'omni';
      const b = await this.ask(CMD.booster, LINKS.omni.reportId);
      this.booster = isError(b) ? null : B(b, 5) === 0x01;   // sheet: byte 5 = 01 means booster is on
    } else {
      this.model = MODELS.find((m) => m.cable === dev.productId || m.dongle === dev.productId);
      if (!this.model) return false;
      this.link = this.model.cable === dev.productId ? 'cable' : 'dongle';
    }
    return true;
  },

  // one request; 3 tries on silence, 600 ms each (sheet section 5: G-Helper's 300 ms and 3 tries, plus the helper's wait)
  async ask(bytes, reportId = LINKS[this.link]?.reportId ?? 0) {
    if (!this.ch) throw Object.assign(new Error('the mouse is not connected'), { gone: true });
    let last;
    for (let i = 0; i < 3; i++) {
      try { return await this.ch.request(Uint8Array.from(bytes), { reportId, timeoutMs: 600 }); } catch (e) { last = e; if (e.gone) throw e; }
    }
    throw last;
  },
  // a request whose FF AA means "asleep" on a wireless link and "refused" on the cable
  async must(bytes, what) {
    const r = await this.ask(bytes);
    if (isError(r)) throw new Error(LINKS[this.link].wireless ? `the mouse is asleep or out of range (FF AA to ${what}): move it and try again` : `the mouse refused ${what} (FF AA)`);
    return r;
  },
  async optional(bytes) { const r = await this.ask(bytes); return isError(r) ? null : r; },

  // every read in one place: status (12 07), profile (12 04 00), lift-off (12 06)
  async snapshot(fresh) {
    if (!fresh && this.snap && Date.now() - this.snapAt < 1000) return this.snap;
    const wireless = LINKS[this.link].wireless;
    let status = null;
    if (this.model.battery) {
      status = await this.ask(CMD.status);
      if (isError(status)) { if (wireless) throw new Error('the mouse is asleep or out of range (FF AA): move it to wake it'); status = null; }
      // sheet section 2 "Sleep and disconnect": G-Helper marks it not ready at 0% and not charging
      else if (wireless && B(status, 5) === 0 && !(B(status, 10) > 0)) throw new Error('the mouse is asleep or out of range (0%, not charging)');
    }
    const profile = await this.must(CMD.profile, 'the settings read');
    const lift = await this.optional(CMD.liftOff);
    const prof = await this.optional(CMD.profileInfo);
    this.snap = { status, profile, lift, prof }; this.snapAt = Date.now();
    return this.snap;
  },

  decode({ status, profile, lift, prof }) {
    const m = this.model, v = {};
    for (let i = 0; i < 4; i++) {
      const raw = B(profile, 5 + 2 * i) | (B(profile, 6 + 2 * i) << 8);   // sheet: stage i at byte 5+2i
      if (raw) v[`dpi${i + 1}`] = dpiFromRaw(raw, m);
    }
    const poll = B(profile, 13);                                           // sheet: byte 13 & 07; high nibble = booster
    v.pollingCode = poll & 0x07; v.pollingHigh = poll >> 4;
    if (!this.booster && !v.pollingHigh && HZ[v.pollingCode]) v.pollingRate = HZ[v.pollingCode];
    v.debounce = B(profile, 15);                                           // sheet: Button response byte 15 (read only)
    const snapRaw = B(profile, 17);                                        // sheet: Angle snapping byte 17
    if (snapRaw === 0 || snapRaw === 1) v.angleSnap = snapRaw === 1;       // another byte is not reported, so never written back as 0 / 1 (driver safety)
    if (status) { v.sleep = SLEEP[B(status, 6)]; v.lowBattery = B(status, 7); }
    if (lift && LIFT[B(lift, 8)]) v.liftOff = LIFT[B(lift, 8)];            // sheet: Lift-off byte 8
    if (prof) {
      const p = B(prof, 11), n = B(prof, 19);
      if (p <= 4) v.onboardProfile = p + 1;                                // sheet: Profile (1-5) byte 11, 0-based
      if (n >= 2 && n <= 4) v.stageCount = n;                               // sheet: DPI stage count byte 19, 2-4 (anything else: not reported)
    }
    return v;
  },

  // a fresh read (DeviceHub asks info() first, then read() and battery(), which reuse it for 1 s)
  async info() {
    const v = this.decode(await this.snapshot(true));
    const dpis = [1, 2, 3, 4].map((i) => v[`dpi${i}`]).filter(Boolean);
    if (dpis.some((d) => d > this.model.dpiMax)) this.dpiLocked = true;
    const out = {
      Model: this.model.name,
      Connection: LINKS[this.link].label,
      'Product id': `0B05:${this.dev.productId.toString(16).toUpperCase().padStart(4, '0')}${this.link === 'omni' ? ` (paired mouse ${this.pairedId.toString(16).toUpperCase().padStart(4, '0')})` : ''}`,
      'Button response': debounceText(v.debounce),
    };
    if (this.link === 'omni') out['8K booster'] = this.booster == null ? 'unknown (the probe was refused)' : this.booster ? 'on (polling shown read-only: its codes are not documented)' : 'off';
    if (v.pollingRate == null) out['Polling code'] = `${v.pollingCode} (high nibble ${v.pollingHigh}; read only)`;
    if (this.model.doubleDpi || this.dpiLocked) out['DPI stages'] = `${dpis.join(' / ')} (read only: ${this.model.doubleDpi ? 'libratbag doubles this model\'s DPI and G-Helper does not, so it is shown doubled and not written until measured' : 'a stage is above this model\'s published maximum'})`;
    return out;
  },

  async read() {
    const v = this.decode(await this.snapshot());
    const out = {};
    for (const s of this.settings) if (v[s.key] !== undefined) out[s.key] = v[s.key];
    return out;
  },

  async battery() {
    if (!this.model?.battery) return null;
    const s = (await this.snapshot()).status;
    return s ? { percent: B(s, 5), charging: B(s, 10) > 0 } : null;   // sheet: Battery byte 5, Charging byte 10 > 0
  },

  // one quick question for an asleep mouse
  async awake() {
    if (!this.model?.battery || !LINKS[this.link]?.wireless) return true;
    try { const r = await this.ask(CMD.status); return !isError(r) && (B(r, 5) > 0 || B(r, 10) > 0); } catch { return false; }
  },

  async rawBackup() {
    const s = await this.snapshot(true);
    const colors = await this.optional(CMD.colors);
    return { model: this.model.key, link: this.link, productId: this.dev.productId, pairedId: this.pairedId ?? null, booster: this.booster,
      status: s.status && hex(s.status), profile: hex(s.profile), liftOff: s.lift && hex(s.lift), profileInfo: s.prof && hex(s.prof), colors: colors && hex(colors) };
  },

  // ONE setting: checked before anything is sent, the old value read, written, read back; on a mismatch the old value
  // is written again and nothing is saved; on a match `50 03` saves it (sheet: Save, "sent after each change").
  async write(key, value) {
    const s = this.settings.find((x) => x.key === key);
    if (!s) throw new Refused(`${key} is not a setting this mouse can change`);
    check(s, value);
    await this.stepBackCheck();
    const before = this.decode(await this.snapshot(true));
    if (before[key] === undefined) throw new Refused(`this mouse does not report ${s.label}`);
    const cmd = await this.command(key, value, before);
    await this.sendSet(cmd, s.label);
    const back = this.decode(await this.snapshot(true));
    const kept = key !== 'sleep' || back.lowBattery === before.lowBattery;
    if (back[key] !== value || !kept) {
      try { await this.sendSet(await this.command(key, before[key], before), s.label); this.snap = null; } catch {}
      throw new Error(`the mouse reads ${s.label} = ${back[key]} after writing ${value}; ${before[key]} was written back, nothing saved`);
    }
    if (key === 'onboardProfile') return back[key];   // 50 02 is itself the action: no save after a profile select
    const r = await this.ask(CMD.save);
    if (isError(r) || r[0] !== CMD.save[0] || r[1] !== CMD.save[1]) throw new Error(`${s.label} is set but the mouse refused the save (50 03): it may not survive a power cycle`);
    return back[key];
  },
  async sendSet(cmd, label) {
    const r = await this.ask(cmd);
    if (isError(r)) throw new Error(LINKS[this.link].wireless ? `the mouse is asleep or out of range: ${label} waits for it` : `the mouse refused ${label} (FF AA)`);
  },
  async command(key, value, cur) {
    if (/^dpi[1-4]$/.test(key)) {
      // the stage's color goes back unchanged with it (sheet: DPI stage colors "appended to the DPI write")
      const stage = Number(key[3]) - 1, c = await this.optional(CMD.colors);
      return SET.dpi(stage, (value - 50) / 50, c ? [B(c, 5 + 3 * stage), B(c, 6 + 3 * stage), B(c, 7 + 3 * stage)] : []);
    }
    if (key === 'pollingRate') return SET.polling(HZ.indexOf(value));
    if (key === 'angleSnap') return SET.snap(value ? 1 : 0);
    if (key === 'sleep') return SET.sleep(SLEEP_CODE[value], cur.lowBattery);   // the low-battery warning is sent back as read
    if (key === 'liftOff') return SET.liftOff(value === 'high' ? 0x01 : 0x00);
    if (key === 'stageCount') return SET.stageCount(value);
    if (key === 'onboardProfile') return SET.profile(value - 1);
    throw new Refused(`${key} is not a setting this mouse can change`);
  },
};

function check(s, v) {
  if (s.type === 'toggle' && typeof v !== 'boolean') throw new Refused(`${s.label} must be on or off`);
  if (s.type === 'choice' && !s.options.some((o) => o.value === v)) throw new Refused(`"${v}" is not a choice for ${s.label}`);
  if (s.type === 'slider' && !(Number.isInteger(v) && v >= s.min && v <= s.max && (v - s.min) % s.step === 0)) throw new Refused(`${s.label} must be ${s.min}-${s.max} in steps of ${s.step}`);
}

// the page: what this model on this link can change
function settingsFor(m, link, dpiLocked, booster) {
  const out = [];
  if (!m) m = { dpiMax: 36000, battery: true };
  if (!m.doubleDpi && !dpiLocked) {
    for (let i = 1; i <= 4; i++) out.push({ key: `dpi${i}`, label: `DPI stage ${i}`, type: 'slider', min: 100, max: m.dpiMax, step: 50, unit: ' DPI' });
  }
  const hz = link === 'cable' && m.pollingCable ? m.pollingCable : UP_TO_1K;
  if (!(link === 'omni' && booster)) out.push({ key: 'pollingRate', label: 'Polling rate', type: 'choice', options: hz.map((x) => ({ value: x, label: x >= 1000 ? `${x / 1000}K Hz` : `${x} Hz` })) });
  out.push({ key: 'angleSnap', label: 'Angle snapping', type: 'toggle' });
  out.push({ key: 'liftOff', label: 'Lift-off distance', type: 'choice', options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
    hint: 'Changing it also resets the sensor\'s surface calibration.' });
  if (m.battery) out.push({ key: 'sleep', label: 'Sleep after', type: 'choice', options: [1, 2, 3, 5, 10, 0].map((x) => ({ value: x, label: x ? `${x} min` : 'Never' })) });
  out.push({ key: 'stageCount', label: 'DPI stages in use', type: 'choice', options: [2, 3, 4].map((x) => ({ value: x, label: String(x) })) });
  out.push({ key: 'onboardProfile', label: 'Onboard profile', type: 'choice', options: [1, 2, 3, 4, 5].map((x) => ({ value: x, label: `Profile ${x}` })),
    hint: 'Switches to a profile saved on the mouse; DPI and the other settings then read from that profile.' });
  return out;
}

export default adapter;
