// The Setup page's checklist, worked out from what DeviceHub already knows (22 Oct 2026; public/pages/setup.js,
// docs/handoff/setup-page.md, docs/handoff/setup-simpler.md). No DOM and no requests here, so tests/setup-page.mjs runs
// it in Node.
//
// Every row: { key, title, line, status, action?, device?, kind? }
//   status: 'done' | 'needs' (needs you) | 'optional' | 'none' (not needed: the page hides it)
//   device: true for a device, shown as a small tile under Your devices; kind: its icon (mouse, keyboard, monitor ...)
//   line:   one short plain line (no driver words)
//   action: the ONE thing its button does (the page draws it):
//     { kind: 'open', page }                 open a DeviceHub page
//     { kind: 'install', name }              a library driver (POST /api/library/install)
//     { kind: 'turn-on', id }                Turn on settings (POST /api/diagnose/action)
//     { kind: 'check-again', id }            the library self-check again
//     { kind: 'close-app', id, app, label, confirm }   the maker's app (diagnose's own action, confirmed in place)
//     { kind: 'get-layout', vid, pid }       a VIA keyboard's official layout file (POST /api/via-fetch)
//     { kind: 'learn', vid?, pid? }          Learn a device, with that device picked
//     { kind: 'request', vid, pid, name }    Request support (ui/get-help.js)
//     { kind: 'works', id }                  Works on my device (ui/works-report.js)
//     { kind: 'settings', page, label }      a Windows Settings page from diagnose's fixed list
//     { kind: 'tool', id }                   an optional tool's installer (ui/installer-button.js installerInline)
//     { kind: 'eq-on' }                      Equalizer APO's device list, to tick the headset (POST /api/eq/turn-on)
//     { kind: 'find-lights' }                start the OpenRGB inside DeviceHub and look (GET /api/openrgb?fresh=1)
//     { kind: 'board-lights' }               Add board, fan and RAM lights, or Remove board lights (ui/board-lights.js)
// Since 22 Oct 2026 (Shawn: "is currently overwhelming for a new user") the page shows only what needs the person
// (planSetup), devices as small tiles, and folds the rest. Reset sound to normal is on the Headset page's EQ card
// only; the problem reports switch and Get help are in Settings.
export const STATUS_TEXT = { done: 'Done', needs: 'Needs you', optional: 'Optional', none: 'Not needed' };
const BUILTIN = ['mouse', 'headset', 'keyboard'];
const splitUsb = (usb) => { const [vid, pid] = String(usb || '').split(':'); return { vid, pid }; };

// a library or learned driver's row, from the summary item (may be null) and the live device (may be null)
function driverRow(id, item, d) {
  const title = d?.title || item?.title || item?.name || id;
  // where its driver came from (not shown; Set it all up's demo answers read it)
  const driver = d?.learned ? 'learned' : d && !d.library ? 'own' : 'library';
  // the live device wins: the summary is kept a minute by the server
  const turnOn = d ? !!d.turnOn : item?.action?.kind === 'turn-on' || item?.state === 'one-click';
  const connected = d ? d.status === 'connected' : item?.action?.kind === 'turn-on' || item?.action?.kind === 'check-again';
  const row = { key: id, id, title, driver, device: true, kind: String(d?.kind || '').toLowerCase() };
  if (turnOn) return connected
    ? { ...row, status: 'needs', line: 'Turn on settings to change it.', action: { kind: 'turn-on', id } }
    : { ...row, status: 'needs', line: 'Plug it in, then turn on its settings.' };
  if (item?.action?.kind === 'check-again' && connected) return { ...row, status: 'optional', line: 'Some settings are read-only for now.', action: { kind: 'check-again', id } };
  return { ...row, status: 'done', line: 'Ready.', action: d?.works ? { kind: 'works', id } : { kind: 'open', page: id } };
}

// the maker's app holding a device that is not connected (helpers/diagnose.mjs finding 'maker-app'): its close
// button replaces the row's own, and the row needs you ("Close SteelSeries GG first.")
function withMakerApp(row, f) {
  const a = f?.action;
  if (!a || a.kind !== 'close-app') return row;
  return { ...row, status: 'needs', line: a.label ? `${a.label} first.` : f.fix || `${f.problem}.`, action: { kind: 'close-app', id: row.id, app: a.app, label: a.label, confirm: a.confirm } };
}

// summary: GET /api/setup (helpers/auto-setup.mjs summary), or null when it did not answer
// live: { [id]: { title, kind, status, seen, plugin, library, learned, turnOn, works } } from the window's devices
// diag: { [id]: finding } the maker's-app finding for a device that is not connected
// layouts: { 'vid:pid': { source, have } } GET /api/via-fetch for a VIA keyboard nothing runs yet
// isVia(usb, title): is that USB device a VIA keyboard (brand guide)
export function deviceRows(summary, { live = {}, diag = {}, layouts = {}, isVia = () => false } = {}) {
  const rows = [], seen = new Set();
  const s = summary || {};
  for (const i of s.works || []) {
    if (i.what === 'bluetooth' || i.what === 'lamparrays') continue;   // batteries and Dynamic Lighting: lightRows, batteryRows
    if (BUILTIN.includes(i.what)) {
      seen.add(i.what);
      rows.push(withMakerApp({ key: i.what, id: i.what, title: live[i.what]?.title || i.name || i.what, driver: 'builtin', device: true, kind: i.what, status: 'done', line: 'Ready.', action: { kind: 'open', page: i.page || i.what } }, diag[i.what]));
    } else if (i.what === 'library') {
      seen.add(i.page);
      rows.push(withMakerApp(driverRow(i.page, i, live[i.page]), diag[i.page]));
    } else if (i.what === 'via') rows.push({ key: `via:${i.name}`, title: i.name, device: true, kind: 'keyboard', status: 'done', line: 'Ready.', action: { kind: 'open', page: 'keyboard' } });
    else if (i.what === 'monitors') rows.push({ key: 'monitors', title: i.name, device: true, kind: 'monitor', status: 'done', line: 'Ready.', action: { kind: 'open', page: 'monitors' } });
    else if (i.what === 'cameras') rows.push({ key: 'cameras', title: i.name, device: true, kind: 'camera', status: 'done', line: 'Ready.', action: { kind: 'open', page: 'monitors' } });
    // a generic 2.4G receiver works as a normal mouse or keyboard: not needed, so the page leaves it out
    else if (i.what === 'generic-dongle') { const { vid, pid } = splitUsb(i.usb); rows.push({ key: i.usb, title: i.title, status: 'none', line: 'Works as it is.', action: { kind: 'request', vid, pid, name: i.title } }); }
  }
  for (const i of s.learn || []) {
    if (i.what === 'library-install' || i.what === 'library-untested') {
      rows.push({ key: `install:${i.name}`, title: i.title, device: true, status: 'needs', line: 'Install its driver to change its settings.', ...(i.action ? { action: { kind: 'install', name: i.action.name } } : {}) });
      continue;
    }
    const { vid, pid } = splitUsb(i.usb);
    if (i.what === 'packet-size') { rows.push({ key: i.usb, title: i.title, status: 'optional', line: 'Not supported yet. You can ask for it.', action: { kind: 'request', vid, pid, name: i.title } }); continue; }
    const L = layouts[String(i.usb || '').toLowerCase()];
    if (isVia(i.usb, i.title) && L?.have) rows.push({ key: i.usb, title: i.title, device: true, kind: 'keyboard', status: 'needs', line: 'Restart DeviceHub to show its keys (tray icon > Quit, then open it).' });
    else if (isVia(i.usb, i.title) && L?.source) rows.push({ key: i.usb, title: i.title, device: true, kind: 'keyboard', status: 'needs', line: "Get its maker's layout file to change its keys.", action: { kind: 'get-layout', vid, pid } });
    else rows.push({ key: i.usb, title: i.title, device: true, status: 'needs', line: 'No driver yet. Learn it to change its settings.', action: { kind: 'learn', vid, pid } });
  }
  for (const i of s.optional || []) {
    if (i.what === 'library-extra') rows.push({ key: `install:${i.name}`, title: i.title, kind: 'keyboard', status: 'optional', line: 'Works now. A driver adds more settings.', ...(i.action ? { action: { kind: 'install', name: i.action.name } } : {}) });
    else if (i.what === 'unknown-vendor') rows.push({ key: 'unknown', title: i.title, status: 'optional', line: 'Learn a device can try them.', action: { kind: 'learn' } });
  }
  // devices the summary did not list (it did not answer, or a driver written on this PC): from the window's own list
  for (const [id, d] of Object.entries(live)) {
    if (seen.has(id)) continue;
    if (BUILTIN.includes(id)) {
      if (summary || !(d.seen || ['connected', 'asleep'].includes(d.status))) continue;
      rows.unshift(withMakerApp({ key: id, id, title: d.title || id, driver: 'builtin', device: true, kind: id, status: 'done', line: d.status === 'connected' ? 'Ready.' : `Ready (${d.status} now).`, action: { kind: 'open', page: id } }, diag[id]));
    } else if (d.plugin) rows.push(withMakerApp(driverRow(id, null, d), diag[id]));
  }
  return rows;
}

// Set it all up (it was Do all): every safe next step, in order (installs, Turn on settings for all, Get the layout).
// Never closes a maker's app (the page asks about those once first: makerApps) and never starts learning.
export function doAllSteps(rows) {
  const installs = rows.filter((r) => r.status === 'needs' && r.action?.kind === 'install');
  const turnOn = rows.some((r) => r.action?.kind === 'turn-on');
  const layouts = rows.filter((r) => r.action?.kind === 'get-layout');
  return [
    ...installs.map((r) => ({ kind: 'install', key: r.key, title: r.title, name: r.action.name })),
    // an install can add a driver that waits for Turn on settings, so it follows any install
    ...(installs.length || turnOn ? [{ kind: 'turn-on-all' }] : []),
    ...layouts.map((r) => ({ kind: 'get-layout', key: r.key, title: r.title, vid: r.action.vid, pid: r.action.pid })),
  ];
}

// Sound: Equalizer APO (installers' status) and the headset it is on for (GET /api/eq). Reset sound to normal is on
// the Headset page's EQ card only (22 Oct 2026).
export function soundRows(tool, eq) {
  const rows = [];
  if (!tool) return rows;
  if (!tool.installed) rows.push({ key: 'eqapo', title: 'Equalizer APO', status: 'optional', line: 'EQ and mic filters for any headset.', action: { kind: 'tool', id: 'eqapo' } });
  else rows.push({ key: 'eqapo', title: 'Equalizer APO', status: 'done', line: 'Installed.', action: { kind: 'open', page: 'headset' } });
  if (tool.installed && eq && eq.engine === 'eqapo') {
    const off = [...new Set((eq.notOn || []).map((d) => d.name))];
    const who = eq.headsetModel || 'the headset';
    rows.push(off.length
      ? { key: 'eq-on', title: `EQ on ${who}`, status: 'needs', line: `Turn the EQ on for ${off.join(' and ')}, then restart the PC.`, action: { kind: 'eq-on' } }
      : { key: 'eq-on', title: `EQ on ${who}`, status: 'done', line: 'On.', action: { kind: 'open', page: 'headset' } });
  }
  return rows;
}

// Lights: the OpenRGB inside DeviceHub (GET /api/openrgb), why nothing was found (GET /api/lights/diagnose,
// helpers/lights-diagnose.js), and Windows Dynamic Lighting from the summary
const NO_LIGHTS = {
  smbus: { status: 'needs', line: "Your board's lights (SMBus) need board lights added. Lighting shows how." },
  none: { status: 'none', line: 'No lights to change: the fans are plain 3-pin RGB or on a hub with a remote.' },
  usb: { status: 'needs', line: "A light is plugged in but not found. Close its maker's app, then look again." },
};
// board: GET /api/board-lights (helpers/board-lights.mjs), or null when not read: with it, an SMBus board gets its own
// row, "Board, fan and RAM lights", whose one control is Add board, fan and RAM lights (ui/board-lights.js)
export function boardRow(board, diag) {
  if (!board) return null;
  if (board.setUp) return { key: 'board-lights', title: 'Board, fan and RAM lights', status: 'done', line: 'On: OpenRGB runs as administrator.', action: { kind: 'board-lights' } };
  if (diag?.verdict?.kind !== 'smbus') return null;
  return { key: 'board-lights', title: 'Board, fan and RAM lights', status: board.canSetUp ? 'needs' : 'optional', line: "They sit on your board's lighting chip (SMBus).", action: { kind: 'board-lights' } };
}
export function lightRows(orgb, summary, diag = null, board = null) {
  const rows = [];
  const own = boardRow(board, diag);
  if (orgb) {
    const n = orgb.controllers?.length || 0;
    if (orgb.running) rows.push({ key: 'openrgb', title: 'PC lights', status: n ? 'done' : 'none', line: n ? `${n} light${n === 1 ? '' : 's'} found.` : (NO_LIGHTS[diag?.verdict?.kind]?.line || 'No lights found.'), action: { kind: 'open', page: 'lighting' } });
    // an SMBus board with its own row: that row needs you, not this one too
    if (orgb.running && !n && NO_LIGHTS[diag?.verdict?.kind]) rows[rows.length - 1].status = own && diag.verdict.kind === 'smbus' ? 'none' : NO_LIGHTS[diag.verdict.kind].status;
    else if (orgb.running) { /* found, or no reason known */ }
    else if (orgb.bundle?.canStart) rows.push({ key: 'openrgb', title: 'PC lights', status: 'optional', line: 'Find lights looks for USB lights.', action: { kind: 'find-lights' } });
    else rows.push({ key: 'openrgb', title: 'PC lights', status: 'optional', line: 'Board and fan lights need the free OpenRGB. Lighting shows how.', action: { kind: 'open', page: 'lighting' } });
  }
  if (own) rows.push(own);
  const lamps = (summary?.works || []).find((i) => i.what === 'lamparrays');
  if (lamps) rows.push({ key: 'lamparrays', title: lamps.name, status: 'done', line: 'Works in Windows Dynamic Lighting.', action: { kind: 'settings', page: 'lighting', label: 'Open Dynamic Lighting' } });
  return rows;
}

// Batteries Windows already knows (GET /api/bluetooth): connected ones with a level
export function batteryRows(bt) {
  const list = (bt || []).filter((d) => d.connected && d.battery != null);
  if (!list.length) return [{ key: 'bt-none', title: 'Bluetooth batteries', status: 'none', line: bt ? 'None connected now.' : 'Checking…' }];
  return list.map((d) => ({ key: `bt:${d.name}`, title: d.name, status: 'done', line: `${d.battery}% battery.` }));
}

// Learning tools: USBPcap, only when a device still needs learning
export function learnRows(tool, devRows) {
  if (!devRows.some((r) => r.action?.kind === 'learn')) return [];
  if (!tool) return [];
  return [tool.installed
    ? { key: 'usbpcap', title: 'USBPcap', status: 'done', line: 'Installed.' }
    : { key: 'usbpcap', title: 'USBPcap', status: 'optional', line: 'Only for learning a device.', action: { kind: 'tool', id: 'usbpcap' } }];
}

export const countNeeds = (rows) => rows.filter((r) => r.status === 'needs').length;
export const summaryLine = (n) => (n ? `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you` : 'All set');

// What the page shows (22 Oct 2026, docs/handoff/setup-simpler.md):
//   needs    every row that needs the person, in the order to do them: the safe steps first, as Set it all up takes
//            them, then the ones that need their own click
//   devices  one small tile per device that is done or needs you
//   extras   optional rows (folded: "Optional extras")
//   done     done rows (folded: "Everything that is done (N)")
// Rows that are not needed are left out.
const ORDER = ['install', 'turn-on', 'get-layout', 'close-app', 'eq-on', 'open', 'learn'];
const rank = (r) => { const i = ORDER.indexOf(r.action?.kind); return i < 0 ? ORDER.length : i; };
export function planSetup(rows) {
  const shown = rows.filter((r) => r.status !== 'none');
  const needs = shown.map((r, i) => [r, i]).filter(([r]) => r.status === 'needs')
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
  return {
    needs,
    devices: shown.filter((r) => r.device && (r.status === 'done' || r.status === 'needs')),
    extras: shown.filter((r) => r.status === 'optional'),
    done: shown.filter((r) => r.status === 'done'),
  };
}

// ---------- one question for the makers' apps (22 Oct 2026, docs/handoff/first-run.md) ----------
// Set it all up asks once, in place, before it closes any maker's app: "Close G HUB and Synapse so DeviceHub can set
// your devices up?" Yes closes each one through diagnose's own close-app action (helpers/diagnose.mjs: only a known
// maker's app, never a Windows service or an updater, the confirm flag); Not now leaves those devices as they are.
// The short names people know the apps by (helpers/diagnose.mjs MAKER_APPS keys)
const SHORT_APP = { ghub: 'G HUB', synapse: 'Synapse', icue: 'iCUE', gg: 'SteelSeries GG', ngenuity: 'NGENUITY', armoury: 'Armoury Crate', swarm: 'Swarm II', glorious: 'Glorious CORE', pulsar: 'the Pulsar app', epomaker: 'the Epomaker driver', wootility: 'Wootility' };
// every app that holds a device that needs you, once each: [{ app, name, ids, keys, titles }]
export function makerApps(rows) {
  const out = [];
  for (const r of rows) {
    if (r.status !== 'needs' || r.action?.kind !== 'close-app' || !r.action.app) continue;
    let a = out.find((x) => x.app === r.action.app);
    if (!a) out.push(a = { app: r.action.app, name: SHORT_APP[r.action.app] || String(r.action.label || r.action.app).replace(/^Close /, ''), ids: [], keys: [], titles: [] });
    if (r.id) a.ids.push(r.id);
    a.keys.push(r.key); a.titles.push(r.title);
  }
  return out;
}
const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
export function askLine(apps) {
  const n = apps.reduce((s, a) => s + a.keys.length, 0);
  return `Close ${joinAnd(apps.map((a) => a.name))} so DeviceHub can set your device${n === 1 ? '' : 's'} up?`;
}
// Not now: one line for each device left as it is
export const leftLine = (a) => a.titles.map((t) => `${t}: left as it is (${a.name} is open).`);

// ---------- what each device can do now (the "You're all set" view) ----------
// From its driver's own settings and readings, in plain words: "DPI, polling, battery". dev (may be null): { values
// (its readings by key), settings ([{ label }], an added or library driver's list), battery, lights, keys }
const BUILT_IN_CAN = {
  mouse: [[/^dpi\d$/, 'DPI'], [/^pollingRate$/, 'polling'], [/^btn\d$/, 'buttons'], [/^liftOff$/, 'lift-off'], [/^(color\d|dpiEffect)$/, 'lights']],
  headset: [[/^vol:playback$/, 'volume'], [/^prop:micEnabled$|^vol:recording$/, 'mic'], [/^prop:equalizerPreset$/, 'EQ'], [/^prop:sidetoneEnabled$/, 'sidetone'], [/^led$/, 'lights']],
  keyboard: [[/^key:/, 'keys'], [/^brightness$/, 'backlight'], [/^effect$/, 'effects'], [/^macro:/, 'macros']],
};
// a built-in device not read yet: what its page always has
const BUILT_IN_DEFAULT = { mouse: ['DPI', 'polling', 'buttons'], headset: ['volume', 'mic', 'EQ'], keyboard: ['keys', 'backlight'] };
const OTHER_CAN = { monitor: ['brightness', 'contrast'], camera: ['picture settings'], keyboard: ['keys', 'lights'] };
const MAX_CAN = 4;
export function canDo(row, dev) {
  const out = [];
  const add = (w) => { if (w && !out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w); };
  const id = row?.id || row?.key;
  const keys = [...Object.keys(dev?.values || {}), ...(dev?.keys || [])];
  if (BUILT_IN_CAN[id]) {
    for (const [re, word] of BUILT_IN_CAN[id]) if (keys.some((k) => re.test(k))) add(word);
    if (!out.length) BUILT_IN_DEFAULT[id].forEach(add);
  } else if (dev?.settings?.length) {
    for (const s of dev.settings) add(/^(DPI|EQ|RGB)$/.test(s.label) ? s.label : String(s.label || s.key || '').toLowerCase());
  } else if (dev?.values) for (const k of Object.keys(dev.values)) add(k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  if (!out.length) (OTHER_CAN[row?.kind] || []).forEach(add);
  if (dev?.lights) add('lights');
  // at most four words, battery last when it has one
  const room = dev?.battery ? MAX_CAN - 1 : MAX_CAN;
  const more = out.length > room;
  const list = out.slice(0, room);
  if (dev?.battery) list.push('battery');
  return list.length ? `${list.join(', ')}${more ? ' and more' : ''}` : 'Open it to see its settings';
}
