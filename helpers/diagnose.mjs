// Why a device does not work, in plain words, with the usual fix (22 Oct 2026; the owner: "break away from needing
// Claude"). diagnose(deviceId) looks at what DeviceHub and Windows already know, read-only, and returns
// [{ problem, why, fix, action? }], the likeliest cause first. Nothing here writes to a device, changes a setting or
// closes a program by itself; the only things that change anything are the actions, run from POST
// /api/diagnose/action after the person's click (closing a maker's app also needs their second, confirming click).
//
// What it checks (each is skipped when it cannot apply):
//  - DeviceHub itself: is the background agent answering, and how fast (GET /api/agent/state over loopback)
//  - server.log: the device helper could not be built or start, the helper restarted by its watchdog in the last hour,
//    crash restarts by the launcher in the last 24 h, an update that did not start and was rolled back
//  - the maker's app running (tasklist): G HUB, Synapse, iCUE, SteelSeries GG, NGENUITY, Armoury Crate, Swarm II,
//    Glorious CORE, the Pulsar app, the Epomaker driver, Wootility; matched to the device by its USB vendor id
//  - the receiver, dongle or cable in Windows' USB list (helpers/pc-map.js), against the device's state: not plugged in,
//    or plugged in with the device asleep or off
//  - another program holding the device's HID channel: the device's own error text, or, only while the device is
//    plugged in and DeviceHub has no channel open to it, one open-and-close of that channel (no report is sent; this is
//    the same open DeviceHub itself retries every 20 s) that tells a sharing violation or access denied
//  - Bluetooth: paired but not connected (helpers/pc-map.js bluetooth, matched by name)
//  - Windows Dynamic Lighting in charge of a LampArray device (helpers/lamparray.mjs, HKCU\Software\Microsoft\Lighting)
//  - a library driver kept read-only and why (my-devices/<name>/library.json, verified.json); the mouse's settings that
//    failed their read-back check
//  - the battery when last read: low, or charging
// Actions: { kind: 'settings', page } (a Windows Settings page from a fixed list), { kind: 'retry' } (connect again),
// { kind: 'close-app', app } (the maker's app, after a confirm), { kind: 'open-folder' } (DeviceHub's folder),
// { kind: 'check-again', id } (a library driver's self-check again now, for the settings that failed or wait).
//
// GET /api/diagnose?id=<device> answers { id, title, status, at, ms, findings, checked }; POST /api/diagnose/action
// { kind, id?, page?, app?, confirm? }. server.js passes both to handle() (docs/handoff/diagnose.md).
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEVICEHUB_PORT) || 5577;

// ---------- the makers' apps ----------
// detect: process image names (tasklist); vids: the USB vendor ids of the devices each one drives. Closing (after the
// person confirms) ends only the matched images that are not a Windows service or an updater (those run as SYSTEM, and
// a maker's service is not what holds the device channel open).
export const MAKER_APPS = {
  ghub: { name: 'Logitech G HUB', detect: [/^lghub/i], vids: ['046d'] },
  synapse: { name: 'Razer Synapse', detect: [/^razer synapse/i, /^razerappengine\.exe$/i], vids: ['1532'] },
  icue: { name: 'iCUE', detect: [/^icue\.exe$/i], vids: ['1b1c'] },
  gg: { name: 'SteelSeries GG', detect: [/^steelseries(gg|engine)/i], vids: ['1038'] },
  ngenuity: { name: 'HyperX NGENUITY', detect: [/^ngenuity/i], vids: ['0951', '03f0'] },
  armoury: { name: 'Armoury Crate', detect: [/^armourycrate/i, /^lightingservice\.exe$/i], vids: ['0b05'] },
  swarm: { name: 'Swarm II', detect: [/swarm\s*ii/i, /^roccat swarm/i], vids: ['1e7d', '10f5'] },
  glorious: { name: 'Glorious CORE', detect: [/^glorious/i], vids: ['258a', '320f'] },
  pulsar: { name: 'the Pulsar app', detect: [/^pulsar\.exe$/i], vids: ['3710'] },
  epomaker: { name: 'the Epomaker driver', detect: [/epomaker/i], vids: ['342d'] },
  wootility: { name: 'Wootility', detect: [/^wootility/i], vids: ['31e3', '03eb'] },
};
export const BACKGROUND = /updater|update\.exe$|crashpad|crash_?handler|crashreport/i;
const NEVER_CLOSE = /service|updater|crashpad|^lightingservice\.exe$/i;

// tasklist /fo csv /nh -> image names
export function parseTasklist(text) {
  return [...new Set(String(text || '').split(/\r?\n/).map((l) => (/^"([^"]+)"/.exec(l.trim()) || [])[1]).filter(Boolean))];
}
// which makers' apps are running: [{ key, name, images, closable }]
export function runningMakers(images) {
  const out = [];
  for (const [key, app] of Object.entries(MAKER_APPS)) {
    // an updater or crash reporter is not the app (23 Oct 2026, a friend's PC: lghub_updater.exe, a service that runs
    // with G HUB closed, held a Logitech mouse's settings read-only for good)
    const hit = images.filter((i) => app.detect.some((re) => re.test(i)) && !BACKGROUND.test(i));
    if (hit.length) out.push({ key, name: app.name, images: hit, closable: hit.filter((i) => !NEVER_CLOSE.test(i)) });
  }
  return out;
}

// ---------- server.log ----------
// { runStart, helperBuild, helperStart, watchdog: [{ at, why }], crashes: [{ at, code }], rollback }
// runStart: the line index where the current run began (the last "DeviceHub on http"); helper problems count only
// from there (an older run's are history), crashes over the last 24 h, watchdog restarts over the last hour.
export function parseLog(text, now = Date.now()) {
  const lines = String(text || '').split(/\r?\n/);
  let runStart = 0;
  lines.forEach((l, i) => { if (/^DeviceHub on http/.test(l)) runStart = i; });
  const out = { runStart, helperBuild: null, helperStart: null, watchdog: [], crashes: [], rollback: null };
  lines.forEach((l, i) => {
    let m;
    if ((m = /^\[launcher\] (.+?) server exited with code (-?\d+)/.exec(l))) {
      const at = new Date(m[1]).getTime(), code = Number(m[2]);
      // -1 is a stop from outside (a restart), not a crash (the same rule as Settings > Health)
      if (code !== -1 && Number.isFinite(at) && now - at < 24 * 3600e3) out.crashes.push({ at, code });
    }
    if ((m = /^\[launcher\] (.+?) the new version stopped with code (-?\d+)/.exec(l))) {
      const at = new Date(m[1]).getTime();
      if (Number.isFinite(at) && now - at < 7 * 24 * 3600e3) out.rollback = { at, code: Number(m[2]) };
    }
    if (i < runStart) return;
    if ((m = /^\[helper\] could not be built: (.*)$/.exec(l))) out.helperBuild = m[1].trim();
    if ((m = /^\[helper\] could not start: (.*)$/.exec(l))) out.helperStart = m[1].trim();
    if ((m = /^\[watchdog\] (\S+) helper (?:restarted: (.*?) \(\d+ in the last hour\)|looks frozen \((.*?)\))/.exec(l))) {
      const at = Date.parse(m[1]);
      if (Number.isFinite(at) && now - at < 3600e3) out.watchdog.push({ at, why: (m[2] || m[3] || '').trim() });
    }
  });
  return out;
}

// ---------- what each device is on USB ----------
// The built-in three, by the USB ids DeviceHub drives them on (helpers/hid-host.mjs SPECS, helpers/hs80-direct.js);
// in the server the live SPECS are used (another VIA keyboard, my-devices drivers).
const BUILT_IN = {
  mouse: { usb: [['3710:5406', 'the Pulsar 8K dongle'], ['3710:3506', "the mouse's USB cable"]], wireless: true, receiver: 'The Pulsar 8K dongle' },
  headset: { usb: [['1b1c:0a6b', 'the HS80 receiver'], ['1b1c:0a69', "the headset's USB cable"]], wireless: true, receiver: 'The HS80 receiver' },
  keyboard: { usb: [['342d:e479', 'the P75 on its USB cable']], wireless: false },
};
const lc = (x) => String(x || '').toLowerCase().padStart(4, '0');
// { usb: [{ id, label }], vids, wireless, receiver, hid: { vid, pid, page, usage } | null }
// A driver with several product ids (hid.pids: one channel per id, as the Logitech drivers' receivers and cables) has
// every one listed (22 Oct 2026, Dsmjr2/DeviceHub-support#2: only the first, C539, was, so a mouse driver connected
// through another receiver read as "not plugged in"); the id it is connected through (snap.adapter.usbId) comes first.
export function deviceProfile(snap, specs = []) {
  const id = snap.id, kind = String(snap.adapter?.kind || 'device').toLowerCase();
  const mine = specs.filter((s) => s.id === id);
  const spec = mine[0];
  const base = BUILT_IN[id];
  let usb = base ? base.usb.map(([u, label]) => ({ id: u, label })) : [];
  if (spec) {
    const main = `${lc(spec.vid)}:${lc(spec.pid)}`;
    if (!usb.some((u) => u.id === main)) usb = [{ id: main, label: id === 'keyboard' ? `the ${spec.productName || 'keyboard'}` : `the ${kind}'s receiver or cable` }, ...(id === 'keyboard' ? [] : usb)];
    if (spec.cablePid && !usb.some((u) => u.id === `${lc(spec.vid)}:${lc(spec.cablePid)}`)) usb.push({ id: `${lc(spec.vid)}:${lc(spec.cablePid)}`, label: `the ${kind}'s USB cable` });
    if (!base) {
      for (const p of mine.flatMap((x) => [x.pid, ...(Array.isArray(x.pids) ? x.pids : [])])) {
        if (p == null || p === '') continue;
        const u = `${lc(spec.vid)}:${lc(p)}`;
        if (!usb.some((x) => x.id === u)) usb.push({ id: u, label: `the ${kind}'s receiver or cable` });
      }
    }
  }
  const via = !base && /^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(String(snap.adapter?.usbId || '')) ? snap.adapter.usbId.toLowerCase() : null;
  if (via) usb = [{ id: via, label: `the receiver or cable the ${kind} is connected through` }, ...usb.filter((u) => u.id !== via)];
  // the headset in its sound-only mode (any USB headset): its ids are not known here
  if (id === 'headset' && snap.adapter?.mode === 'generic') usb = [];
  const vids = [...new Set(usb.map((u) => u.id.split(':')[0]))];
  const hid = spec ? { vid: String(spec.vid).toUpperCase(), pid: (via && via.startsWith(`${lc(spec.vid)}:`) ? via.split(':')[1] : String(spec.pid)).toUpperCase(), page: String(spec.page || 'FF00').toUpperCase(), usage: String(spec.usage || '0001').toUpperCase() } : null;
  return { usb, vids, wireless: base ? base.wireless : !!snap.adapter?.wireless, receiver: base?.receiver || null, hid };
}

// a Bluetooth device that is this device: the model's or title's first two words in its name
export function bluetoothMatch(snap, list) {
  const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  // two words at least ("Mouse" alone would match any Bluetooth mouse)
  const keys = [snap.info?.Model, snap.adapter?.title].map((s) => words(s).slice(0, 2)).filter((w) => w.length === 2).map((w) => w.join(' '));
  return (list || []).find((b) => { const n = words(b.name).join(' '); return keys.some((k) => n.includes(k)); }) || null;
}

// ---------- the reasoning: facts in, findings out (pure; tests/diagnose.mjs feeds it) ----------
// facts: { id, snap, profile, serverDown, agentDown, serverMs, usb (['vid:pid'] or null), makers, log, bluetooth,
//          lamp: { isLampArray, dynamicLighting }, library: { status, readOnly: [{ label, why }] }, probe: { err } }
const SLOW_MS = 2000;
// the mouse's setting keys in words (public/devices/mouse-adapter.js keys): btn0 -> button 1, liftOff -> lift-off distance
const NAMES = { pollingRate: 'polling rate', dpiStage: 'DPI stage', liftOff: 'lift-off distance', debounce: 'debounce time', motionSync: 'motion sync', angleSnap: 'angle snapping', ripple: 'ripple control' };
export const settingName = (k) => NAMES[k] || (/^btn(\d+)$/.test(k) ? `button ${Number(k.slice(3)) + 1}` : String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
export function analyze(f) {
  const out = [], checked = [];
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);   // "the Pulsar app is running" starts a sentence
  const add = (rank, code, problem, why, fix, action) => out.push({ rank, code, problem: cap(problem), why: cap(why), fix: cap(fix), ...(action ? { action } : {}) });
  const retry = { kind: 'retry', label: 'Connect again' };
  const folder = { kind: 'open-folder', label: "Open DeviceHub's folder" };
  if (f.serverDown) {
    add(0, 'server-down', 'DeviceHub is not running', 'Its server did not answer, so nothing is looking after the devices.', 'Start DeviceHub from its shortcut or the Start menu.');
    return { findings: out, checked: ['DeviceHub server'] };
  }
  checked.push('DeviceHub itself');
  if (f.agentDown) add(1, 'agent-down', "DeviceHub's background part is not running", 'The part that connects the devices did not answer, so none of them can connect.', 'Quit DeviceHub from its tray icon and start it again.');
  const s = f.snap || { status: 'idle', adapter: {} };
  const kind = String(s.adapter?.kind || 'device').toLowerCase();
  const title = s.adapter?.title || kind;
  const notConnected = !['connected', 'connecting'].includes(s.status);
  const p = f.profile || { usb: [], vids: [] };

  // server.log
  const L = f.log;
  if (L) {
    checked.push('the log');
    if (L.helperBuild) add(2, 'helper-build', "DeviceHub's device helper could not be built", `Windows stopped it being made (${L.helperBuild.slice(0, 120)}), so DeviceHub cannot open any device.`, 'Restart the PC; if it stays, save a report in Settings > Health and send it.', folder);
    else if (L.helperStart) add(2, 'helper-start', "DeviceHub's device helper could not start", `Windows refused to run it (${L.helperStart.slice(0, 120)}); antivirus software sometimes does this.`, 'Allow DeviceHub in your antivirus, then restart the PC.', folder);
    if (L.watchdog.length) add(30, 'helper-restart', "DeviceHub's device helper was restarted", `It stopped answering (${L.watchdog[L.watchdog.length - 1].why || 'no reply'}) and was restarted ${L.watchdog.length} time${L.watchdog.length === 1 ? '' : 's'} in the last hour; devices drop for a moment each time.`, 'Press Connect. If it keeps happening, restart the PC.', retry);
    if (L.crashes.length) add(40, 'crashes', `DeviceHub restarted itself ${L.crashes.length} time${L.crashes.length === 1 ? '' : 's'} today`, 'It stopped unexpectedly and started again by itself; devices are dropped while that happens.', 'Usually nothing to do. If it keeps happening, save a report in Settings > Health and send it.', folder);
    if (L.rollback) add(45, 'rollback', 'The last update did not start, so DeviceHub went back', 'The new version stopped while starting, and DeviceHub returned to the version before it.', 'Nothing to do now; a fixed version shows in Settings > Update.');
  }
  if (Number.isFinite(f.serverMs)) {
    checked.push('how fast DeviceHub answers');
    if (f.serverMs > SLOW_MS) add(50, 'slow', 'DeviceHub is answering slowly', `It took ${(f.serverMs / 1000).toFixed(1)} s to answer; something inside it is busy.`, 'Give it a minute. If it stays slow, quit it from the tray icon and start it again.');
  }

  // the maker's app
  const makers = (f.makers || []).filter((m) => MAKER_APPS[m.key]?.vids.some((v) => p.vids.includes(v)));
  if (f.makers) checked.push("the maker's app");
  if (notConnected) for (const m of makers) {
    const why = m.key === 'icue' && s.id === 'headset'
      ? 'DeviceHub reaches the headset through iCUE, which is not handing it over.'
      : `${m.name} talks to the same ${kind}; two programs on one device clash.`;
    add(10, 'maker-app', `${m.name} is running`, why, `Close ${m.name}. It stays installed for firmware updates.`,
      m.closable?.length ? { kind: 'close-app', app: m.key, label: `Close ${m.name}`, confirm: `Close ${m.name} now?` } : null);
  }

  // another program holding the channel
  const errText = String(s.error || '');
  const heldErr = /sharing violation|open failed 32\b|being used by another/i.test(errText) || f.probe?.err === 32 ? 'sharing'
    : /access (is )?denied|open failed 5\b/i.test(errText) || f.probe?.err === 5 ? 'denied' : null;
  if (f.probe) checked.push("whether another program holds its channel");
  if (notConnected && heldErr && !makers.length) {
    add(12, 'held', `Another program holds the ${kind}'s channel`, heldErr === 'sharing'
      ? `Windows refused it (sharing violation): another program has it open.`
      : `Windows refused it (access denied): another program has it.`,
      'Close lighting, macro or overlay apps and VIA, then press Connect.', retry);
  }

  // on USB: the receiver or cable, and the device behind it
  const present = Array.isArray(f.usb) && p.usb.length ? p.usb.filter((u) => f.usb.includes(u.id)) : null;
  if (present) checked.push(p.wireless ? 'the receiver and cable on USB' : 'the cable on USB');
  // a library driver that found something else on its channel (helpers/my-devices.mjs stepAside): an ordinary state,
  // not a fault, and the receiver is plugged in (the driver had it open), so none of the plug findings below apply
  const notMine = notConnected && s.adapter?.notMine ? String(s.adapter.notMine) : null;
  if (notMine) {
    checked.push('what its driver found on the receiver or cable');
    add(5, 'not-mine', `What is on its receiver is not a ${kind} this driver runs`, `${notMine.charAt(0).toUpperCase()}${notMine.slice(1)}.`,
      `Nothing is wrong. If a ${kind} is paired to this receiver, switch it on.`, retry);
  }
  const labels = [...new Set(p.usb.map((u) => u.label))];
  if (notConnected && present && !present.length && !notMine) {
    add(20, 'unplugged', p.receiver ? `${p.receiver} is not plugged in` : `The ${kind} is not plugged in`,
      p.usb.length > 3 ? `Windows lists none of the ${p.usb.length} USB ids its driver knows (${labels.join(' or ')}).`
        : `Windows does not list ${labels.join(' or ')}.`,
      'Plug it into the PC directly, not a hub.', retry);
  } else if (notMine) {
    // nothing more about plugs: the driver had the receiver open
  } else if (s.status === 'asleep') {
    const via = present?.[0]?.label || (p.receiver ? p.receiver.toLowerCase() : null);
    add(25, 'asleep', `The ${kind} is asleep or switched off`, via ? `${via.replace(/^the/, 'The')} is plugged in, but the ${kind} is not answering.` : `DeviceHub has it, but the ${kind} itself is not answering.`,
      s.id === 'headset' ? 'Switch the headset on.' : 'Move it or switch it on.', retry);
  } else if (present && present.length && notConnected && !heldErr && !makers.length) {
    if (p.wireless && present.some((u) => !/cable/i.test(u.label))) add(26, 'off', `The ${kind} is not answering`, `${present[0].label.replace(/^the/, 'The')} is plugged in, but the ${kind} is switched off, asleep or out of range.`, s.id === 'headset' ? 'Switch the headset on and keep it near the receiver.' : 'Switch it on, move it, and keep it near the receiver.', retry);
    else add(27, 'not-opened', `The ${kind} is plugged in but not connected yet`, 'Windows lists it, but DeviceHub has not opened it yet.', 'Press Connect, or unplug it and plug it back in.', retry);
  }

  // Bluetooth
  if (f.bluetooth) {
    checked.push('Bluetooth');
    const b = bluetoothMatch(s, f.bluetooth);
    if (b && !b.connected && notConnected) add(22, 'bt', `${b.name} is paired but not connected`, 'Paired, but not linked right now.', 'Switch it on or bring it closer, or connect it in Bluetooth settings.', { kind: 'settings', page: 'bluetooth', label: 'Bluetooth settings' });
  }

  // Windows Dynamic Lighting
  if (f.lamp) {
    checked.push('Windows Dynamic Lighting');
    if (f.lamp.isLampArray && f.lamp.dynamicLighting) add(15, 'dynamic-lighting', 'Windows Dynamic Lighting controls its lights', 'Windows overwrites lighting changes made here.', 'In Settings > Personalization > Dynamic Lighting, turn it off for this device.', { kind: 'settings', page: 'lighting', label: 'Dynamic Lighting settings' });
  }

  // read-only settings: a library driver's, and the mouse's that failed their read-back
  if (f.library) {
    checked.push('its driver from the device library');
    const ro = f.library.readOnly || [];
    const again = { kind: 'check-again', label: 'Check again' };
    if (f.library.turnOn) {
      // safety round 2: a driver with no real-device record writes nothing, its check included, until the person's click
      add(60, 'read-only', 'Its settings are not turned on yet',
        `This library driver ("${f.library.status}") is untested, so it only reads until you turn settings on.`,
        'Press Turn on settings. It writes each current value back once to check it.',
        notConnected ? retry : { kind: 'turn-on', label: 'Turn on settings' });
    } else if (ro.length) {
      const failed = ro.filter((r) => r.failed), waiting = ro.filter((r) => r.waiting);
      // waiting on the maker's app (G HUB, Synapse ...): the fix is closing it, one click
      const named = (why, m) => String(why).includes(m.name) || String(why).split(/[\s(),:;]+/).some((w) => m.detect.some((re) => re.test(w)));
      const appOpen = waiting.length ? Object.entries(MAKER_APPS).map(([key, m]) => ({ key, ...m })).find((m) => waiting.some((r) => named(r.why, m))) || null : null;
      add(60, 'read-only', `${ro.length === 1 ? 'One setting is' : `${ro.length} settings are`} read-only`,
        failed.length ? `${failed.map((r) => r.label).join(', ')} did not pass the read-back check: ${failed[0].why}.`
          : waiting.length ? `${waiting.map((r) => r.label).join(', ')} could not be checked yet: ${waiting[0].why}.`
          : `Library driver "${f.library.status}": ${ro.map((r) => r.label).join(', ')} stay read-only until checked on connect.`,
        failed.length ? 'Retried daily. Press Check again to try now.' : waiting.length ? (appOpen ? `Close ${appOpen.name}, then press Check again.` : 'Fix that, then press Check again.') : notConnected ? 'Connect the device; the check runs by itself.' : 'Press Check again to run the check now.',
        notConnected ? retry : !failed.length && appOpen ? { kind: 'close-app', app: appOpen.key, label: `Close ${appOpen.name}`, confirm: `Close ${appOpen.name} now?` } : again);
    }
  }
  // btn0 (left click) is never written (mouse-adapter.js), so its lock changes nothing
  const locked = Object.entries(s.adapter?.trusted || {}).filter(([k, ok]) => !ok && k !== 'btn0').map(([k]) => settingName(k));
  if (s.id === 'mouse' && s.adapter?.trusted) {
    checked.push("the mouse's setting checks");
    if (locked.length) add(61, 'locked', `${locked.length === 1 ? 'One mouse setting is' : `${locked.length} mouse settings are`} locked`, `${locked.join(', ')} did not read back cleanly, so ${locked.length === 1 ? 'it stays' : 'they stay'} locked.`, 'Press Re-read when the mouse is awake.', retry);
  }

  // the battery when last read
  const bat = s.battery;
  if (bat && Number.isFinite(bat.percent)) {
    checked.push('the battery');
    if (bat.percent <= 15 && !bat.charging) add(notConnected ? 18 : 55, 'battery-low', `The battery was low (${bat.percent}%)`, 'It was nearly empty.', 'Charge it with its cable.');
    else if (bat.charging && notConnected) add(70, 'charging', 'It is charging', 'On its cable it briefly shows as another device.', 'Wait a few seconds.');
  }

  // an error the device gave that nothing above explains
  if (notConnected && errText && !out.some((x) => x.rank < 30) && s.status !== 'asleep' && !notMine) add(35, 'error', `DeviceHub could not read the ${kind}`, `It answered: "${errText.slice(0, 160)}".`, 'Press Connect, or unplug it and plug it back in.', retry);

  out.sort((a, b) => a.rank - b.rank);
  if (!out.length) out.push({ rank: 99, code: 'none', problem: notConnected ? 'Nothing wrong found' : `The ${kind} looks fine`, why: `Checked: ${checked.join(', ')}.`, fix: notConnected ? `Press Connect. If ${title} still does not show, unplug it and plug it back in.` : 'Nothing to do.', ...(notConnected ? { action: retry } : {}) });
  return { findings: out, checked };
}

// ---------- reading the facts (read-only) ----------
const run = (file, args, ms = 10000) => new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: ms, maxBuffer: 4 << 20 }, (e, out) => resolve(e && !out ? null : String(out || ''))));
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function agentState(port) {
  const t = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/agent/state`, { signal: AbortSignal.timeout(10000) });
    const ms = Date.now() - t;
    if (r.status === 503) return { agentDown: true, ms };
    return { state: await r.json(), ms };
  } catch { return { serverDown: true }; }
}
function logText() {
  try {
    const f = path.join(ROOT, 'server.log'), size = fs.statSync(f).size, n = Math.min(size, 512 * 1024);
    const fd = fs.openSync(f, 'r'), b = Buffer.alloc(n);
    try { fs.readSync(fd, b, 0, n, size - n); } finally { fs.closeSync(fd); }
    return b.toString('utf8');
  } catch { return ''; }
}
// the live channel list when this runs inside DeviceHub's server (hid-host is already loaded there); a separate
// process (a test, Claude running this file) uses the built-in table only, so it never loads the device helper
async function liveSpecs() {
  if (!/server\.js$/i.test(process.argv[1] || '')) return [];
  try { return (await import('./hid-host.mjs')).SPECS; } catch { return []; }
}
async function pluginHid(name) {
  try { const a = (await import(pathToFileURL(path.join(ROOT, 'my-devices', name, 'device.mjs')).href)).default; return a?.hid ? { id: a.id, ...a.hid } : null; } catch { return null; }
}
function libraryFacts(snap) {
  const name = snap.adapter?.plugin;
  if (!name) return null;
  const folder = path.join(ROOT, 'my-devices', name);
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')); } catch { return null; } };
  const mark = read('library.json');
  if (!mark) return null;
  const v = read('verified.json') || { keys: {} };
  const readOnly = (snap.adapter.settings || []).filter((st) => st.type !== 'display').flatMap((st) => {
    const k = v.keys?.[st.key];
    if (k && k.ok === false) return [{ label: st.label, why: k.why || 'it read back differently', failed: true }];
    if (k && k.waiting) return [{ label: st.label, why: k.why || 'waiting', waiting: true }];
    if (mark.status !== 'tested' && !(k && k.ok)) return [{ label: st.label, why: 'not checked yet' }];
    return [];
  });
  // the last check that did not run says why (the maker's app open, no backup ...): every "not checked yet" waits on it
  const notRun = snap.adapter.library?.notRun;
  const why = notRun?.why;
  return { status: mark.status || 'unknown', readOnly: why ? readOnly.map((r) => (r.failed || r.waiting ? r : { ...r, why, waiting: true })) : readOnly, turnOn: !!snap.adapter.library?.turnOn };
}
async function dynamicLightingOn() {
  const out = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Lighting', '/v', 'AmbientLightingEnabled'], 5000);
  const m = /AmbientLightingEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out || '');
  return m ? parseInt(m[1], 16) !== 0 : null;
}
// One open-and-close of the device's HID channel, the way DeviceHub's helper opens it (read and write access, shared);
// nothing is sent. Returns { err }: 0 = it opens, 32 = sharing violation, 5 = access denied; null when not found.
const PROBE = String.raw`$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class DhOpenProbe {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  public static int Try(string p) { using (var h = CreateFile(p, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) { return h.IsInvalid ? Marshal.GetLastWin32Error() : 0; } }
}
'@
$found = @(Get-PnpDevice -PresentOnly -Class HIDClass | Where-Object { $_.InstanceId -match '^HID\\VID_@VID@&PID_@PID@' -and (($_.HardwareID -join ' ') -match 'UP:@PAGE@_U:@USAGE@') })
$out = @(foreach ($d in $found) { $p = '\\?\' + ($d.InstanceId -replace '\\', '#') + '#{4d1e55b2-f16f-11cf-88cb-001111000030}'; [DhOpenProbe]::Try($p) })
ConvertTo-Json -InputObject $out -Compress`;
async function openProbe(hid) {
  if (!hid || ![hid.vid, hid.pid, hid.page, hid.usage].every((x) => /^[0-9A-F]{4}$/.test(x))) return null;
  const ps = PROBE.replace('@VID@', hid.vid).replace('@PID@', hid.pid).replace('@PAGE@', hid.page).replace('@USAGE@', hid.usage);
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], 30000);
  try { const list = [].concat(JSON.parse(out.trim().slice(out.indexOf('[')))); return list.length ? { err: list.includes(0) ? 0 : list.find((e) => e === 32 || e === 5) ?? list[0] } : null; } catch { return null; }
}

// deps (tests and the real run): port, state, tasklist, usb, bluetooth, lampArrays, log, specs, probe
export async function diagnose(deviceId, deps = {}) {
  const t0 = Date.now();
  const id = String(deviceId || '');
  const port = deps.port || PORT;
  const st = deps.state ? await deps.state() : await agentState(port);
  if (st.serverDown || st.agentDown) {
    const r = analyze({ id, serverDown: st.serverDown, agentDown: st.agentDown, serverMs: st.ms, log: parseLog(deps.log ? await deps.log() : logText()) });
    return { id, status: 'unknown', at: new Date().toISOString(), ms: Date.now() - t0, ...r };
  }
  const snap = (st.state.devices || []).find((d) => d.id === id);
  if (!snap) throw Object.assign(new Error(`no device called "${id}"`), { code: 404 });
  const notConnected = !['connected', 'connecting'].includes(snap.status);
  let specs = deps.specs || await liveSpecs();
  if (snap.adapter?.plugin && !specs.some((x) => x.id === id)) { const h = await pluginHid(snap.adapter.plugin); if (h) specs = [...specs, h]; }
  const profile = deviceProfile(snap, specs);
  const pcMap = deps.usb ? null : require('./pc-map.js');

  // read in parallel, each with its own limit; a check that does not answer is left out (and not listed as checked)
  const [tasks, pc, logT] = await Promise.all([
    within(deps.tasklist ? deps.tasklist() : run('tasklist', ['/fo', 'csv', '/nh'], 8000), 9000),
    within(deps.usb ? deps.usb() : pcMap.get(notConnected).then((x) => x).catch(() => null), 45000),
    deps.log ? deps.log() : logText(),
  ]);
  const usbList = pc ? (Array.isArray(pc) ? pc : pc.usb || []).map((u) => u.id || `${u.vid}:${u.pid}`) : null;
  const present = usbList && profile.usb.some((u) => usbList.includes(u.id));
  const facts = { id, snap, profile, serverMs: st.ms, log: parseLog(logT, deps.now ? deps.now() : Date.now()), usb: usbList, makers: tasks == null ? null : runningMakers(parseTasklist(tasks)) };
  // Bluetooth: for a device DeviceHub has no USB ids for, or that is not on USB
  if (notConnected && (!profile.usb.length || present === false)) {
    facts.bluetooth = await within(deps.bluetooth ? deps.bluetooth() : (pcMap || require('./pc-map.js')).bluetooth().catch(() => null), 30000);
  }
  // LampArray: only when Windows lists one, and only for a device added on this PC (the built-in three are not)
  if (snap.adapter?.plugin && (pc?.lampArrays > 0 || deps.lampArrays)) {
    const lamps = await within(deps.lampArrays ? deps.lampArrays() : import('./lamparray.mjs').then((m) => m.findLampArrays()).catch(() => null), 60000);
    if (lamps) {
      const isLampArray = lamps.some((l) => profile.usb.some((u) => u.id === `${lc(l.vid)}:${lc(l.pid)}`));
      facts.lamp = { isLampArray, dynamicLighting: isLampArray ? (deps.dynamicLighting ? await deps.dynamicLighting() : await dynamicLightingOn()) : null };
    }
  }
  facts.library = libraryFacts(snap);
  // the open-and-close check: only while it is plugged in, DeviceHub holds no channel to it, and no maker's app explains it
  const makerHit = (facts.makers || []).some((m) => MAKER_APPS[m.key].vids.some((v) => profile.vids.includes(v)));
  if (['missing', 'error', 'idle'].includes(snap.status) && present && profile.hid && !makerHit && !snap.adapter?.notMine) {
    facts.probe = await within(deps.probe ? deps.probe(profile.hid) : openProbe(profile.hid), 35000);
  }
  return { id, title: snap.adapter?.title || id, status: snap.status, at: new Date().toISOString(), ms: Date.now() - t0, ...analyze(facts) };
}

// ---------- the actions (each only after the person's click) ----------
const SETTINGS_PAGES = { bluetooth: 'ms-settings:bluetooth', lighting: 'ms-settings:personalization-lighting', sound: 'ms-settings:sound', usb: 'ms-settings:usb' };
export async function action(b, { port = PORT } = {}) {
  const kind = String(b?.kind || '');
  if (kind === 'settings') {
    const uri = SETTINGS_PAGES[b.page];
    if (!uri) throw new Error('unknown settings page');
    spawn('explorer.exe', [uri], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }
  if (kind === 'open-folder') { spawn('explorer.exe', [ROOT], { detached: true, stdio: 'ignore' }).unref(); return { ok: true }; }
  if (kind === 'retry') {
    const r = await fetch(`http://127.0.0.1:${port}/api/agent/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(b.id || '') }), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return { ok: true, status: j.status };
  }
  if (kind === 'check-again' || kind === 'turn-on') {
    // the person pressed Check again (the library self-check again, helpers/my-devices.mjs recheck) or Turn on settings
    // (safety round 2: a driver with no real-device record writes nothing, its check included, until this click)
    const r = await fetch(`http://127.0.0.1:${port}/api/agent/${kind === 'turn-on' ? 'turn-on' : 'recheck'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(b.id || '') }), signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return { ok: true, ran: !!j.ran, why: j.why || null, waiting: !!j.waiting, counts: j.counts || null, ...(kind === 'turn-on' ? { on: !!j.on } : {}) };
  }
  // the Set up card's Turn on settings for all: each waiting, connected device in turn, the same path as its own button
  if (kind === 'turn-on-all') return (await import('./turn-on-all.mjs')).turnOnAll({ port });
  if (kind === 'close-app') {
    // the person pressed Close, then confirmed: only then, and only a known maker's app
    if (b.confirm !== true) throw new Error('closing an app needs the confirm click');
    const app = MAKER_APPS[b.app];
    if (!app) throw new Error('unknown app');
    const hit = runningMakers(parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh'], 8000))).find((m) => m.key === b.app);
    if (!hit) return { ok: true, closed: [], note: `${app.name} is not running` };
    for (const image of hit.closable) await run('taskkill', ['/IM', image, '/F'], 10000);
    const still = runningMakers(parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh'], 8000))).find((m) => m.key === b.app)?.closable || [];
    return { ok: !still.length, closed: hit.closable.filter((i) => !still.includes(i)), still, ...(still.length ? { error: `${app.name} is still running (it may run as administrator)` } : {}) };
  }
  throw new Error('unknown action');
}

// server.js: if (url.pathname.startsWith('/api/diagnose')) return (await import('./helpers/diagnose.mjs')).handle(url, req, res, send);
export async function handle(url, req, res, send) {
  const port = req.socket?.localPort || PORT;
  try {
    if (url.pathname === '/api/diagnose' && req.method === 'GET') return send(res, 200, await diagnose(url.searchParams.get('id'), { port }));
    if (url.pathname === '/api/diagnose/action' && req.method === 'POST') {
      const body = await new Promise((resolve, reject) => {
        let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e4) reject(new Error('too large')); });
        req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
      });
      return send(res, 200, await action(body, { port }));
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, e.code === 404 ? 404 : 400, { error: e.message }); }
}

// node helpers/diagnose.mjs <device>: the same answer as GET /api/diagnose, read-only, printed
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = process.argv[2];
  if (!id) { console.log('usage: node helpers/diagnose.mjs <mouse|headset|keyboard|my-device id>'); process.exit(2); }
  diagnose(id).then((r) => { console.log(JSON.stringify(r, null, 1)); process.exit(0); }, (e) => { console.error(e.message); process.exit(1); });
}
