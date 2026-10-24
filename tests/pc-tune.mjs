// The PC check's game and network checks (24 Oct 2026, Shawn: "ONLY if they can be done. For example if resizable bar
// is already on or high performance is already on for power plan then dont show it"): each says nothing when the PC is
// already right, does not have the part, or Windows did not say; the one fix (the power plan) uses only this PC's list;
// Settings pages come from a fixed list. And the CPU card's numbers (helpers/pc-sensors.js).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pcc = require('../helpers/pc-check.js');
const pc = pcc._test;
const { _test: sensors } = require('../helpers/pc-sensors.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const { PLAN } = pc;
const plans = [{ guid: PLAN.balanced, name: 'Balanced' }, { guid: PLAN.high, name: 'High performance' }, { guid: PLAN.saver, name: 'Power saver' }];
const desk = (power, more = {}) => ({ tune: { battery: false, power: { plans, overlay: '', ...power }, ...more } });

// power plan
check(pc.powerPlan(desk({ active: PLAN.high })) === null, 'High performance already: nothing shown');
check(pc.powerPlan(desk({ active: PLAN.balanced, overlay: 'ded574b5-45a0-4f42-8737-46345c09c238' })) === null, 'Balanced with Best performance mode: nothing shown');
const bal = pc.powerPlan(desk({ active: PLAN.balanced }));
check(bal?.level === 'warn' && bal.link?.fix === 'power-plan' && /High performance/.test(bal.link.text), 'Balanced on a desktop: Switch to High performance');
check(pc.powerPlan({ tune: { battery: true, power: { plans, active: PLAN.balanced } } }) === null, 'a laptop: not shown');
check(pc.powerPlan({ tune: { power: { plans, active: PLAN.balanced } } }) === null, 'battery not known: not shown');
const noHigh = pc.powerPlan({ tune: { battery: false, power: { plans: [plans[0]], active: PLAN.balanced } } });
check(noHigh?.link?.settings === 'power' && !noHigh.link.fix, 'no High performance plan on this PC: Power mode in Settings instead');
check(pc.powerPlan(desk({ active: 'aaaaaaaa-1111-2222-3333-444444444444' }, {})) !== null && pc.powerPlan({ tune: { battery: false, power: { active: 'aaaaaaaa-1111-2222-3333-444444444444', plans: [{ guid: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'AMD Ryzen High Performance' }] } } }) === null, "a maker's own performance plan: not shown");

// the fix: only to a plan from the list, with the switch command and nothing else
let ran = null;
const r = await pcc.fix('power-plan', { facts: desk({ active: PLAN.balanced }), run: async (args) => { ran = args; } });
check(r.ok && r.now === 'High performance' && r.was === 'Balanced' && ran?.[0] === '/setactive' && ran[1] === PLAN.high && ran.length === 2, 'fix: powercfg /setactive <High performance>');
let refused = false; try { await pcc.fix('power-plan', { facts: { tune: { power: { plans: [plans[0]], active: PLAN.balanced } } }, run: async () => {} }); } catch { refused = true; }
check(refused, 'fix refused without a High performance plan');
refused = false; try { await pcc.fix('anything', { facts: desk({ active: PLAN.balanced }), run: async () => { throw new Error('ran'); } }); } catch (e) { refused = e.message === 'unknown fix'; }
check(refused, 'fix: only power-plan');
const evil = desk({ active: PLAN.balanced }); evil.tune.power.plans = [{ guid: '8c5e7fda & calc', name: 'High performance' }];
refused = false; try { await pcc.fix('power-plan', { facts: evil, run: async () => { throw new Error('ran'); } }); } catch (e) { refused = !/ran/.test(e.message); }
check(refused, 'fix: a plan id that is not a GUID is never run');

// Settings pages: a fixed list
let started = null;
pcc.openSettings('game-mode', { start: (c, a) => { started = [c, a]; } });
check(started?.[0] === 'explorer.exe' && started[1][0] === 'ms-settings:gaming-gamemode', 'Game Mode opens its Settings page');
for (const bad of ['', 'constructor', '__proto__', 'ms-settings:x', '../x']) { let t = false; try { pcc.openSettings(bad, { start: () => {} }); } catch { t = true; } check(t, `open-settings refuses ${JSON.stringify(bad)}`); }

// Windows settings
check(pc.gameMode({ tune: { gameMode: null } }) === null && pc.gameMode({ tune: { gameMode: 1 } }) === null && pc.gameMode({ tune: { gameMode: 0 } })?.link?.settings === 'game-mode', 'Game Mode: shown only when off');
check(pc.backgroundRecording({ tune: { bgRecord: 0 } }) === null && pc.backgroundRecording({ tune: { bgRecord: 1 } })?.level === 'warn', 'background recording: shown only when on');
check(pc.gpuScheduling({ tune: { hags: 2 } }) === null && pc.gpuScheduling({ tune: {} }) === null && pc.gpuScheduling({ tune: { hags: 1 } }) !== null, 'GPU scheduling: shown only when offered and off');
check(pc.windowedGames({ tune: { windowsBuild: 26100, dxGlobal: 'SwapEffectUpgradeEnable=1;' } }) === null && pc.windowedGames({ tune: { windowsBuild: 26100, dxGlobal: '' } }) === null
  && pc.windowedGames({ tune: { windowsBuild: 19045, dxGlobal: 'SwapEffectUpgradeEnable=0;' } }) === null && pc.windowedGames({ tune: { windowsBuild: 26100, dxGlobal: 'VRROptimizeEnable=0;SwapEffectUpgradeEnable=0;' } }) !== null, 'windowed games: only when turned off on Windows 11');
check(pc.mouseAcceleration({ tune: { mouseAccel: '0' } }) === null && pc.mouseAcceleration({ tune: { mouseAccel: '1' } }) !== null, 'mouse acceleration: only when on');

// Resizable BAR
const rtx = { video: [{ name: 'NVIDIA GeForce RTX 3060' }], board: { maker: 'Gigabyte Technology Co., Ltd.' } };
check(pc.resizableBar({ ...rtx, tune: { bar1MiB: 16384 } }) === null, 'ReBAR on (BAR1 = the memory): nothing');
const rb = pc.resizableBar({ ...rtx, tune: { bar1MiB: 256, firmware: 2 } });
check(rb?.level === 'warn' && /RTX 3060/.test(rb.line) && /Above 4G/.test(rb.line) && rb.link?.url && !/legacy/.test(rb.line), 'ReBAR off on an RTX 3060: the BIOS steps and the board maker');
check(/legacy/.test(pc.resizableBar({ ...rtx, tune: { bar1MiB: 256, firmware: 1 } }).line), 'legacy boot named');
check(pc.resizableBar({ video: [{ name: 'NVIDIA GeForce GTX 1080' }], tune: { bar1MiB: 256 } }) === null, 'a card without it: nothing');
check(pc.resizableBar({ ...rtx, tune: {} }) === null, 'not read: nothing');

// RAM channels
const stick = (bank, slot) => ({ gb: 8, bank, slot });
check(pc.ramChannels({ ram: [stick('P0 CHANNEL A', 'DIMM 1'), stick('P0 CHANNEL A', 'DIMM 0')] })?.level === 'warn', 'two sticks on channel A: warn');
check(pc.ramChannels({ ram: [stick('P0 CHANNEL A', 'DIMM 1'), stick('P0 CHANNEL B', 'DIMM 1')] }) === null, 'one per channel: nothing');
check(pc.ramChannels({ ram: [stick('BANK 0', 'ChannelA-DIMM0'), stick('BANK 2', 'ChannelB-DIMM0')] }) === null && pc.ramChannels({ ram: [stick('BANK 0', 'ChannelA-DIMM0'), stick('BANK 1', 'ChannelA-DIMM1')] }) !== null, 'Intel slot names');
check(pc.ramChannels({ ram: [stick('', 'A2'), stick('', 'B2')] }) === null && pc.ramChannels({ ram: [stick('BANK 0', 'DIMM 0'), stick('BANK 1', 'DIMM 1')] }) === null, 'unknown names: nothing guessed');
check(pc.ramChannels({ ram: [stick('P0 CHANNEL A', 'DIMM 1')] }) === null, 'one stick: nothing');

// Wi-Fi and Ethernet
const w = (x, power = {}) => ({ tune: { battery: false, power, wifi: { ssid: 'Home', band: '2.4 GHz', channel: '6', signal: '90%', radios: '802.11b 802.11g 802.11n 802.11a 802.11ac 802.11ax', fiveNearby: true, ...x } } });
check(pc.wifi(w({}))?.some((r) => r.id === 'wifi-band'), '2.4 GHz with 5 GHz here and an adapter for it: shown');
check(pc.wifi(w({ fiveNearby: false })) === null && pc.wifi(w({ radios: '802.11b 802.11g 802.11n' })) === null && pc.wifi(w({ band: '5 GHz', channel: '36' })) === null, 'no 5 GHz nearby, a 2.4-only adapter, or already on 5 GHz: nothing');
check(pc.wifi(w({ band: '5 GHz', signal: '40%' }))?.[0]?.id === 'wifi-signal', 'weak signal shown');
check(pc.wifi(w({ band: '5 GHz' }, { wifiSaveAc: 3 }))?.[0]?.id === 'wifi-power' && pc.wifi(w({ band: '5 GHz' }, { wifiSaveAc: 0 })) === null, 'Wi-Fi power saving only when on');
check(pc.wifi({ tune: {} }) === null, 'no Wi-Fi: nothing');
check(pc.ethernet({ tune: { wired: [{ name: 'Realtek', bps: 1e9 }] } }) === null && pc.ethernet({ tune: { wired: [{ name: 'Realtek', bps: 1e8 }] } })?.[0]?.line.includes('100 Mbps'), 'Ethernet below gigabit');

// refresh rate from the display read
check(pc.refreshRate({ screens: [{ name: 'LG', flag: { text: 'Running at 60 Hz; this screen does 144 Hz.' } }, { name: 'B', flag: null }] })?.length === 1, 'a screen below its rate: one line with the Monitors page');
check(pc.refreshRate({}) === null, 'screens not read: nothing');

// the whole list: a PC already tuned shows none of these
const tuned = pc.runChecks({ tune: { battery: false, power: { plans, active: PLAN.high }, gameMode: 1, bgRecord: 0, hags: 2, mouseAccel: '0', wired: [{ name: 'x', bps: 1e9 }] }, restart: { wu: false, cbs: false } });
const TUNE = ['power-plan', 'game-mode', 'bg-record', 'gpu-scheduling', 'windowed-games', 'rebar', 'ram-channels', 'wifi-band', 'wifi-signal', 'wifi-power', 'ethernet', 'mouse-accel', 'refresh'];
check(!tuned.some((x) => TUNE.includes(x.id)), 'a tuned PC: no tuning lines at all');

// the CPU card
const cpu = sensors.cpuCard({ name: 'AMD Ryzen 7 5800X3D 8-Core Processor', loadPct: 12, clockMHz: 4450 }, { setUp: true, state: 'ok', cpu: [{ packageC: 51, coresMaxC: 55 }], fans: [{ name: 'Fan #1', rpm: 900 }, { name: 'CPU Fan', rpm: 1200 }] });
check(cpu.tempC === 51 && cpu.coresMaxC === 55 && cpu.loadPct === 12 && cpu.clockMHz === 4450 && cpu.fanRpm === 1200 && cpu.sensors, 'CPU card with the add-on: temperature, CPU fan, load, clock');
const bare = sensors.cpuCard({ name: 'Intel(R) Core(TM) i7', loadPct: 3, clockMHz: 3600 }, { setUp: false });
check(bare.tempC === null && bare.fanRpm === null && bare.loadPct === 3 && !bare.sensors, 'without the add-on: load and clock only');
check(sensors.cpuCard(null, null) === null, 'nothing read: no card data');

if (fails.length) { console.log('pc-tune: FAILED:\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('pc-tune (game and network checks only when they can be done; the power plan fix; the CPU card): all good');
