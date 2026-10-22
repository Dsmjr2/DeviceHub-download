// The ROCCAT library driver (device-library/roccat-peripherals/device.mjs) against simulated mice and keyboards only:
// nothing is opened, nothing reaches hardware. Each simulated device answers the feature reports exactly as the cited
// sources describe them (typed out here by hand): the control report 04 (select / ready), 05 (active profile, set
// 05 03 <n>), the settings block 06 per profile (libratbag's layouts for the Kone Pure / XTD / EMP with their sizes and
// Sum16, OpenRGB's Kone XP and Burst blocks), and 09 / 0F info. A block with a bad checksum or the wrong profile is
// refused by the simulated device, as the firmware's "invalid" status would.
// Covers: write, read back, exact raw restore, an unchanged write still sent (byte for byte the block read), out of
// range refused, reads while Swarm II runs and writes refused, the never list, device.json and id overlaps.
// Run: node tests/sim-roccat-peripherals.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createRoccat, MODELS, PIDS, FAMILIES, sum16 } from '../device-library/roccat-peripherals/device.mjs';
import { problem, fits, selfCheck, hidSpecs } from '../helpers/my-devices.mjs';
import { validateMeta } from '../helpers/device-library.mjs';
import { neverHit } from '../helpers/never-guard.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) fails.push(what); };
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
process.on('uncaughtException', (e) => { console.log(`sim-roccat-peripherals: FAILED: ${e.stack || e.message}`); process.exit(1); });

// ---- the simulated device ----
const sumIn = (b) => { const s = sum16(b); b[b.length - 2] = s & 0xff; b[b.length - 1] = s >> 8; return b; };
function blockFor(family, p) {
  const f = FAMILIES[family];
  const b = new Uint8Array(f.size);
  b[0] = 0x06; b[1] = f.size; b[2] = p;
  if (f.select === 'libratbag') {
    const o = f.off;
    b[3] = 0; b[4] = 6; b[5] = 6;
    if (family === 'emp') {
      b[o.mask] = 0x0f;                                      // stage 5 switched off
      [3, 7, 15, 31, 40].forEach((r, i) => { b[o.xres + i] = r; b[o.yres + i] = r; });   // 400, 800, 1600, 3200 DPI
      b[o.yres + 3] = 29;                                    // stage 4: Y 3000, X 3200
      b[o.cur] = 1; b[o.rate] = 3; b[19] = 0xff; b[23] = 0x1e; b[24] = 0x10; b[25] = 0x20; b[26] = 0x30;
    } else {
      b[o.mask] = 0x1f;
      [8, 16, 32, 64, 80].forEach((r, i) => { b[o.xres + i] = r; b[o.yres + i] = r; });  // 400, 800, 1600, 3200, 4000
      b[o.yres + 4] = 60;                                    // stage 5: Y 3000, X 4000
      b[o.cur] = 2 + (p % 2); b[o.rate] = 3; b[20] = 0x44;
    }
    b[2] = p; b[6] = b[o.mask];
    if (p === 1) b[o.xres] = 10;                              // profile 2 differs: stage 1 at 500
  } else if (family === 'xp') {
    b[0x07] = 0x08; b[0x1d] = 0x03; b[0x1e] = 0x01; b[0x20] = 200; b[0x21] = 0x0f; b[0xa3] = 0x80;
  } else if (family === 'burst') {
    b[1] = 0x3f; b[30] = 0x01; b[31] = 0x06; b[32] = 128; b[36] = 0x14; b[38] = 0xff;
  }
  if (f.sum) sumIn(b); else { b[f.size - 2] = 0xab; b[f.size - 1] = 0xcd; }   // the Pure's last two bytes are kept as read
  return b;
}
function simDevice(pid, o = {}) {
  const model = MODELS[pid], fam = FAMILIES[model.family];
  const sim = { pid, sent: [], asked: [], bad: [], active: 0, selected: null, busy: 0, moveOther: false, status: 1, fw: 123, layout: 2, ...o };
  sim.blocks = fam.size ? Array.from({ length: 5 }, (_, p) => blockFor(model.family, fam.select ? p : 1)) : [];
  const cur = () => sim.blocks[fam.select ? sim.selected : 0];
  sim.dev = {
    async sendFeatureReport(id, data) {
      const full = Uint8Array.from([id, ...data]);
      sim.sent.push({ id, bytes: full });
      if (id === 0x04) {
        const want = fam.select === 'xp' ? 4 : 3;
        if (full.length !== want || full[2] !== 0x80 || (want === 4 && full[3] !== 0xff) || full[1] > 4) { sim.bad.push(`select ${hex(full)}`); sim.status = 2; return; }
        sim.selected = full[1]; sim.status = 1; sim.busyLeft = sim.busy;
      } else if (id === 0x05) {
        if (full.length !== 3 || full[1] !== 0x03 || full[2] > 4) { sim.bad.push(`profile ${hex(full)}`); sim.status = 2; return; }
        sim.active = full[2]; sim.status = 1; sim.busyLeft = sim.busy;
      } else if (id === 0x06) {
        if (full.length !== fam.size) { sim.bad.push(`block of ${full.length} bytes`); sim.status = 2; return; }
        if (fam.sum && sum16(full) !== (full[fam.size - 2] | (full[fam.size - 1] << 8))) { sim.bad.push('block with a bad checksum'); sim.status = 2; return; }
        if (fam.select && full[2] !== sim.selected) { sim.bad.push(`block for profile ${full[2]} while ${sim.selected} is selected`); sim.status = 2; return; }
        const b = Uint8Array.from(full);
        if (sim.moveOther) { b[fam.select === 'libratbag' ? 3 : 0x21 % fam.size] ^= 1; if (fam.sum) sumIn(b); }   // a firmware that changes another byte
        sim.blocks[fam.select ? sim.selected : 0] = b; sim.status = 1; sim.busyLeft = sim.busy;
      } else sim.bad.push(`report ${id.toString(16)} sent`);
    },
    async receiveFeatureReport(id, len) {
      sim.asked.push(id);
      let r;
      if (id === 0x04) { if (sim.busyLeft > 0) { sim.busyLeft--; r = [4, 3, 0, 0]; } else r = [4, sim.status, 0, 0]; }
      else if (id === 0x05) r = [5, fam.profileLen || 3, sim.active, 0];
      else if (id === 0x06) { if (fam.select && sim.selected == null) throw new Error('no profile selected'); r = Array.from(cur()); }
      else if (id === 0x09 || id === 0x0f) { r = new Array(9).fill(0); r[0] = id; r[1] = 9; r[2] = sim.fw; r[6] = sim.layout; }
      else throw new Error(`report ${id} is not one this device answers`);
      const out = Uint8Array.from([id, ...r.slice(1, len + 1)]);
      while (out.length < len + 1) throw new Error(`asked for ${len} bytes of report ${id}, it has ${r.length - 1}`);
      return new DataView(out.buffer);
    },
  };
  return sim;
}
const sleeps = [];
function driverOn(pid, o) {
  const sim = simDevice(pid, o);
  sim.app = null; sim.clock = 1;
  const d = createRoccat({ sleep: async (ms) => { sleeps.push(ms); }, open: async (p) => (p === pid ? sim.dev : null), vendorApp: async () => sim.app, now: () => sim.clock });
  return { d, sim };
}
const all = [];
const writes = (sim) => sim.sent.filter((r) => r.id === 0x05 || r.id === 0x06);
const lastBlock = (sim) => [...sim.sent].reverse().find((r) => r.id === 0x06)?.bytes;

async function selfChecked(d, sim, label) {
  const before = JSON.stringify(sim.blocks.map((b) => hex(b))) + sim.active;
  const n = writes(sim).length;
  const r = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
  const writable = d.settings.filter((s) => s.type !== 'display');
  check(writable.length > 0 && writable.every((s) => r.keys?.[s.key]?.ok === true || (r.keys?.[s.key]?.why || '').includes('not a value')), `${label}: the self-check passes every setting it can (${JSON.stringify(r.keys)})`);
  check(writes(sim).length - n >= writable.filter((s) => r.keys?.[s.key]?.ok).length, `${label}: every checked setting was really sent`);
  check(JSON.stringify(sim.blocks.map((b) => hex(b))) + sim.active === before, `${label}: the self-check left the device as it was`);
  return r;
}

// ---- 1. Kone Pure: profile, DPI stage, DPI with Y following X, polling as a reading, no checksum ----
{
  const { d, sim } = driverOn('2DBE');
  all.push(sim);
  check(problem(d) === null, `the driver has the my-devices shape (${problem(d)})`);
  check(await d.connect(), 'Kone Pure connects');
  const v = await d.read();
  check(problem(d) === null && d.settings.map((s) => s.key).join() === 'profile,dpiStage,dpi1,dpi2,dpi3,dpi4,dpi5,pollingRate', `settings: ${d.settings.map((s) => s.key)}`);
  check(v.profile === 1 && v.dpiStage === 3 && v.dpi1 === 400 && v.dpi5 === 4000 && v.pollingRate === 1000, `read: ${JSON.stringify(v)}`);
  check(sim.sent.some((r) => r.id === 4 && hex(r.bytes) === '04 00 80'), 'the settings of the active profile are asked with 04 <profile> 80 (libratbag roccat_set_config_profile)');
  check(d.settings.find((s) => s.key === 'pollingRate').type === 'display', 'polling rate is a reading on the Kone Pure');
  check(d.settings.every((s) => fits(s, v[s.key]) || s.type === 'display'), 'every value read fits its setting');
  // an unchanged write is still sent, byte for byte the block read (its last two bytes kept: no checksum on the Pure)
  const read0 = Uint8Array.from(sim.blocks[0]);
  let n = writes(sim).length;
  check((await d.write('dpi2', 800)) === 800 && writes(sim).length === n + 1 && hex(lastBlock(sim)) === hex(read0), 'an unchanged DPI write is sent, exactly the raw block read');
  // a change: X and Y move together when they were equal
  check((await d.write('dpi3', 1650)) === 1650 && sim.blocks[0][7 + 2] === 33 && sim.blocks[0][13 + 2] === 33, 'DPI stage 3 1650 = raw 33 on X and Y');
  check(sim.blocks[0][29] === 0xab && sim.blocks[0][30] === 0xcd, 'the Pure\'s last two bytes stay as read (libratbag: no checksum)');
  // Y kept when it differed
  check((await d.write('dpi5', 4500)) === 4500 && sim.blocks[0][11] === 90 && sim.blocks[0][17] === 60, 'stage 5: X 4500, Y kept at 3000 (they differed)');
  // Y following X is limited to 5000 on the Pure (libratbag roccat_write_resolution)
  let e = await refusal(() => d.write('dpi1', 6000));
  check(/100-5000/.test(e?.message || '') && sim.blocks[0][7] === 8, `Y over 5000 refused on the Pure (${e?.message})`);
  for (const bad of [8250, 150, 1625, 400.5]) { e = await refusal(() => d.write('dpi1', bad)); check(/200-8200/.test(e?.message || ''), `DPI ${bad} refused (${e?.message})`); }
  // exact raw restore
  check((await d.write('dpi3', 1600)) === 1600 && (await d.write('dpi5', 4000)) === 4000 && hex(sim.blocks[0]) === hex(read0), 'put back: the block is byte for byte as it was');
  // DPI stage in use
  check((await d.write('dpiStage', 1)) === 1 && sim.blocks[0][12] === 0 && (await d.write('dpiStage', 3)) === 3, 'DPI stage in use: written, read back, put back');
  e = await refusal(() => d.write('dpiStage', 6));
  check(/one of/.test(e?.message || ''), 'stage 6 refused');
  e = await refusal(() => d.write('pollingRate', 500));
  check(/not a setting/.test(e?.message || '') && hex(sim.blocks[0]) === hex(read0), 'polling rate is never written on the Pure');
  // profile: 05 03 <n>, read back through 05; the settings then come from that profile
  n = sim.sent.length;
  check((await d.write('profile', 2)) === 2 && sim.active === 1 && sim.sent.slice(n).some((r) => hex(r.bytes) === '05 03 01'), 'profile 2 = 05 03 01, read back');
  check((await d.read()).dpi1 === 500 && sim.sent.some((r) => hex(r.bytes) === '04 01 80'), 'profile 2\'s own block is read after the switch');
  check((await d.write('profile', 1)) === 1 && sim.active === 0, 'profile put back');
  e = await refusal(() => d.write('profile', 0));
  check(/one of/.test(e?.message || ''), 'profile 0 refused');
  // a busy mouse is waited for (kernel: status 3 busy)
  sim.busy = 2;
  check((await d.write('dpi2', 800)) === 800, 'a busy control report is waited for');
  sim.busy = 0;
  // a switched-off stage is not offered
  sim.blocks[0][6] = 0x1b; sim.blocks[0][12] = 0;   // stage 3 off
  await d.read();
  check(!d.settings.some((s) => s.key === 'dpi3') && d.settings.find((s) => s.key === 'dpiStage').options.map((o) => o.value).join() === '1,2,4,5', 'a switched-off stage is not offered');
  e = await refusal(() => d.write('dpi3', 1600));
  check(/not a setting/.test(e?.message || ''), 'a switched-off stage is refused');
  sim.blocks[0] = Uint8Array.from(read0);
  await d.read();
  const info = await d.info();
  check(info.Firmware === '1.23' && info.Model === 'ROCCAT Kone Pure' && info['Profile in use'] === '1', `info: ${JSON.stringify(info)}`);
  check(sim.asked.includes(0x09), 'firmware from report 09 (kernel koneplus_info)');
  await selfChecked(d, sim, 'Kone Pure');
}

// ---- 2. Kone XTD: Sum16 recomputed; a block whose checksum does not add up is never used ----
{
  const { d, sim } = driverOn('2E22');
  all.push(sim);
  await d.connect();
  const v = await d.read();
  check(v.dpi4 === 3200 && v.pollingRate === 1000, `XTD read: ${JSON.stringify(v)}`);
  const before = Uint8Array.from(sim.blocks[0]);
  check((await d.write('dpi4', 8200)) === 8200 && sim.blocks[0][10] === 164 && sim.bad.length === 0, 'XTD DPI 8200 written (raw 164, X and Y), checksum accepted');
  check((await d.write('dpi4', 3200)) === 3200 && hex(sim.blocks[0]) === hex(before), 'XTD put back byte for byte, checksum included');
  const n = writes(sim).length;
  check((await d.write('dpi1', 400)) === 400 && hex(lastBlock(sim)) === hex(before) && writes(sim).length === n + 1, 'an unchanged write sends exactly the block read, checksum included');
  sim.blocks[0][41] ^= 0xff;   // the mouse sends a block whose checksum is wrong
  const e = await refusal(() => d.write('dpi1', 450));
  check(/checksum/.test(e?.message || '') && writes(sim).length === n + 1, `a block with a bad checksum is not used and nothing is written (${e?.message})`);
  sim.blocks[0] = Uint8Array.from(before);
  await selfChecked(d, sim, 'Kone XTD');
}

// ---- 3. Kone EMP: polling writable, DPI = raw * 100 + 100, stage 5 off ----
{
  const { d, sim } = driverOn('2E24');
  all.push(sim);
  await d.connect();
  const v = await d.read();
  check(v.dpi1 === 400 && v.dpi4 === 3200 && v.dpi5 === undefined && v.dpiStage === 2 && v.pollingRate === 1000, `EMP read: ${JSON.stringify(v)}`);
  check(d.settings.find((s) => s.key === 'pollingRate').type === 'choice', 'polling rate is a setting on the EMP (libratbag writes it)');
  const before = Uint8Array.from(sim.blocks[0]);
  check((await d.write('pollingRate', 500)) === 500 && sim.blocks[0][18] === 2, 'EMP polling 500 Hz = index 2');
  check((await d.write('dpi1', 12000)) === 12000 && sim.blocks[0][7] === 0x77 && sim.blocks[0][12] === 0x77, 'EMP 12000 DPI = raw 0x77 (X and Y)');
  check((await d.write('dpi4', 5000)) === 5000 && sim.blocks[0][10] === 49 && sim.blocks[0][15] === 29, 'EMP stage 4: Y kept (it differed)');
  let e = await refusal(() => d.write('dpi1', 12100));
  check(/100-12000/.test(e?.message || ''), 'EMP 12100 refused');
  e = await refusal(() => d.write('dpi1', 150));
  check(/steps of 100/.test(e?.message || ''), 'EMP 150 refused (steps of 100)');
  await d.write('pollingRate', 1000); await d.write('dpi1', 400); await d.write('dpi4', 3200);
  check(hex(sim.blocks[0]) === hex(before), 'EMP put back byte for byte');
  await selfChecked(d, sim, 'Kone EMP');
}

// ---- 4. Kone XP: brightness in the 174-byte block; select 04 <p> 80 FF; ready on 4 bytes; profile a reading ----
{
  const { d, sim } = driverOn('2C8B', { active: 2 });
  all.push(sim);
  await d.connect();
  const v = await d.read();
  check(v.brightness === 200 && v.profile === 3, `XP read: ${JSON.stringify(v)}`);
  check(sim.sent.some((r) => hex(r.bytes) === '04 02 80 ff'), 'XP: SetReadProfile 04 02 80 FF for the active profile');
  check(d.settings.map((s) => `${s.key}:${s.type}`).join() === 'brightness:slider,profile:display', `XP settings ${d.settings.map((s) => s.key)}`);
  const before = Uint8Array.from(sim.blocks[2]);
  check((await d.write('brightness', 17)) === 17 && sim.blocks[2][0x20] === 17 && sim.bad.length === 0, 'XP brightness 17 written into profile 3\'s block, read back');
  check((await d.write('brightness', 200)) === 200 && hex(sim.blocks[2]) === hex(before), 'XP brightness put back, block byte for byte');
  let e = await refusal(() => d.write('brightness', 256));
  check(/0-255/.test(e?.message || ''), 'XP brightness 256 refused');
  e = await refusal(() => d.write('profile', 1));
  check(/not a setting/.test(e?.message || '') && !sim.sent.some((r) => r.id === 5), 'XP profile is never written (no source selects one)');
  const info = await d.info();
  check(info.Firmware === '1.23', `XP firmware 09 / 9 bytes (${info.Firmware})`);
  await selfChecked(d, sim, 'Kone XP');
}

// ---- 5. Burst Pro: brightness at 32, no select, 10 ms wait ----
{
  sleeps.length = 0;
  const { d, sim } = driverOn('2DE1');
  all.push(sim);
  await d.connect();
  const v = await d.read();
  check(v.brightness === 128 && !sim.sent.some((r) => r.id === 4), `Burst: brightness 128 read with no profile select (${JSON.stringify(v)})`);
  check((await d.write('brightness', 0)) === 0 && sim.blocks[0][32] === 0 && sleeps.includes(10), 'Burst brightness 0 written, 10 ms wait (OpenRGB)');
  check((await d.write('brightness', 128)) === 128 && hex(sim.blocks[0]) === hex(blockFor('burst', 1)), 'Burst put back byte for byte');
  await selfChecked(d, sim, 'Burst Pro');
  // a firmware that changes another byte: the block read before goes back, byte for byte, and the write fails
  const before = Uint8Array.from(sim.blocks[0]);
  sim.moveOther = true;
  const n = writes(sim).length;
  const e = await refusal(() => d.write('brightness', 90));
  sim.moveOther = false;
  check(/written back/.test(e?.message || '') && writes(sim).length === n + 2 && hex(lastBlock(sim)) === hex(before), `another byte moved: the block read before was sent back exactly (${e?.message})`);
}

// ---- 6. Kova and the Vulcan family: info only, nothing written ----
{
  const { d, sim } = driverOn('2CEE', { fw: 107 });
  all.push(sim);
  await d.connect();
  check(d.settings.length === 0 && JSON.stringify(await d.read()) === '{}', 'Kova: no settings');
  check((await d.info()).Firmware === '1.07', 'Kova firmware from 09 / 8 bytes');
  const e = await refusal(() => d.write('brightness', 10));
  check(/not a setting/.test(e?.message || '') && sim.sent.length === 0, 'Kova: nothing is ever sent');
  for (const [pid, id, layout] of [['2F4E', 0x09, 'UK (code 2)'], ['307A', 0x0f, 'UK (code 2)'], ['3124', 0x09, undefined]]) {
    const k = driverOn(pid, { fw: 116 });
    all.push(k.sim);
    await k.d.connect();
    const info = await k.d.info();
    check(info.Firmware === '1.16' && info.Layout === layout && k.sim.asked.filter((x) => x === id).length === 2 && k.sim.sent.length === 0, `${MODELS[pid].name}: firmware and layout from report ${id.toString(16)}, read twice, nothing sent (${JSON.stringify(info)})`);
    check(k.d.settings.length === 0 && k.d.kind === 'Mouse or keyboard', `${MODELS[pid].name}: no settings`);
  }
}

// ---- 7. Swarm II running: reads go on, every write (the same value too) refused, nothing written ----
{
  const { d, sim } = driverOn('2DBE');
  all.push(sim);
  await d.connect();
  sim.app = 'ROCCAT_Swarm_II.exe';
  const v = await d.read();
  check(v.dpi1 === 400, 'reads go on while Swarm II runs');
  const n = writes(sim).length;
  for (const [k, val] of [['dpi1', 400], ['profile', 1], ['dpiStage', 3]]) {
    const e = await refusal(() => d.write(k, val));
    check(/Swarm_II\.exe is running/.test(e?.message || '') && e.waiting === true, `${k} refused while Swarm II runs (${e?.message})`);
  }
  check(writes(sim).length === n, 'nothing written while Swarm II runs');
  const r = await selfCheck(d, d.write, { backup: async () => true });
  check(r.ran === false && r.waiting === true && writes(sim).length === n, 'the self-check waits while Swarm II runs');
  sim.app = null; sim.clock += 20000;
  check((await d.write('dpi1', 400)) === 400, 'after Swarm II closed: written');
  const x = driverOn('2C8B');
  all.push(x.sim);
  await x.d.connect();
  x.sim.app = 'ROCCAT Swarm.exe';
  check((await x.d.read()).brightness === 200, 'XP read while Swarm runs');
  const e = await refusal(() => x.d.write('brightness', 200));
  check(e?.waiting === true && writes(x.sim).length === 0, 'XP same-value write refused while Swarm runs, nothing written');
  const t = createRoccat({ open: async (p) => (p === '2DBE' ? simDevice('2DBE').dev : null), vendorApp: async () => { throw new Error('tasklist failed'); } });
  await t.connect();
  const e2 = await refusal(() => t.write('dpi1', 400));
  check(e2?.waiting === true && /could not check/.test(e2.message), '"could not check" refuses the write too');
}

// ---- 8. the never list, the ids, device.json ----
{
  for (const sim of all) {
    check(sim.bad.length === 0, `every report well formed (${sim.pid}: ${sim.bad.join('; ')})`);
    check(sim.sent.every((r) => [4, 5, 6].includes(r.id)), `only reports 04, 05, 06 are ever sent (${sim.pid})`);
    check(!sim.sent.some((r) => neverHit({ vid: '1E7D', pid: sim.pid, reportId: r.id, bytes: r.bytes.slice(1) })), `nothing on the never list was sent (${sim.pid})`);
  }
  check(neverHit({ vid: '1E7D', pid: '2DBE', reportId: 0x1b, bytes: [0] }) && neverHit({ vid: '1E7D', pid: '2E22', reportId: 0x1c, bytes: [1, 2] }), 'firmware write 1B and its control 1C are refused on every ROCCAT id');
  check(neverHit({ vid: '1E7D', pid: '3138', reportId: 0x11, bytes: [0, 0] }) && !neverHit({ vid: '1E7D', pid: '2F4E', reportId: 0x11, bytes: [0, 0] }), 'the Ryos reset 11 is refused on the Ryos, not on a Vulcan (where 11 is the lighting mode)');
  check(!neverHit({ vid: '1E7D', pid: '2DBE', reportId: 6, bytes: blockFor('pure', 0).slice(1) }), 'a settings block is not on the never list');
  // the channels: each id its own collection, none inheriting another's feature length
  const specs = Object.fromEntries(hidSpecs(createRoccat()).map((s) => [s.pid, s]));
  check(PIDS.every((p) => specs[p]) && specs['2DBE'].featureLen === 0x0821 && specs['2DBE'].iface === 0 && specs['2E24'].featureLen === 1025, 'libratbag mice: interface 0, feature length from the macro report');
  check(specs['2C8B'].featureLen == null && specs['2C8B'].iface === 3 && specs['2C8B'].page === 'FF01' && specs['2DE1'].usage === '0001' && specs['2CEE'].page === '000B' && specs['2CEE'].usage === '0000', 'OpenRGB mice: their interface, page and usage, no feature length');
  check(specs['2F4E'].iface === 1 && specs['2F4E'].page === 'FF01' && specs['307A'].page === '000B' && PIDS.every((p) => specs[p].featureOnly), 'Vulcan control interface 1; every channel feature-only');
  const d = createRoccat({ open: async () => null, vendorApp: async () => null });
  check((await d.connect()) === false, 'nothing plugged in: connect() is false');
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'roccat-peripherals', 'device.json'), 'utf8'));
  check(validateMeta(meta) === null && meta.status === 'untested' && Array.isArray(meta.tested) && meta.tested.length === 0, `device.json well formed and untested (${validateMeta(meta)})`);
  check(meta.id === d.id && meta.vid.toUpperCase() === d.hid.vid && meta.pids.map((p) => p.toUpperCase()).sort().join() === [...PIDS].sort().join(), 'device.json lists exactly the driver\'s ids');
  // no other library entry claims one of these ids, and none is one DeviceHub's own drivers run
  const claims = [];
  for (const name of fs.readdirSync(path.join(ROOT, 'device-library'))) {
    if (name === 'roccat-peripherals' || name.startsWith('_')) continue;
    for (const file of ['device.json', 'driver.json']) {
      const p = path.join(ROOT, 'device-library', name, file);
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const pid of j.pids || []) claims.push(`${String(j.vid).toLowerCase()}:${String(pid).toLowerCase()} ${name}`);
    }
  }
  const mine = meta.pids.map((p) => `1e7d:${p}`);
  const clash = claims.filter((c) => mine.includes(c.split(' ')[0]));
  check(claims.length > 50 && clash.length === 0, `no other library entry claims these ids (${clash.join(', ')})`);
  const { RUNS } = createRequire(import.meta.url)('../helpers/pc-map.js');
  check(!mine.some((id) => RUNS[id]), 'none of these ids is one DeviceHub\'s own drivers run');
  check(!['2c88', '2c8e', '2c92', '2ca6', '2e27', '2e2c'].some((p) => meta.pids.includes(p)), 'the write-only models (Kone Pro, Pro Air, Burst Pro Air, Kone Aimo) are not claimed');
}

console.log(fails.length ? `sim-roccat-peripherals: FAILED: ${fails.join('; ')}` : `sim-roccat-peripherals (ROCCAT mice and keyboards, simulated, ${checks} checks): all good`);
process.exit(fails.length ? 1 : 0);
