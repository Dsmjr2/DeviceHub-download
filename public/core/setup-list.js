// The Setup page's checklist, worked out from what DeviceHub already knows (22 Oct 2026; public/pages/setup.js,
// docs/handoff/setup-page.md). No DOM and no requests here, so tests/setup-page.mjs runs it in Node.
//
// Every row: { key, title, driver?, line, status, action? }
//   status: 'done' | 'needs' (needs you) | 'optional' | 'none' (not needed)
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
//     { kind: 'reports' }                    the "Send problem reports to Shawn" switch
//     { kind: 'help' }                       Get help
export const STATUS_TEXT = { done: 'Done', needs: 'Needs you', optional: 'Optional', none: 'Not needed' };
const BUILTIN = ['mouse', 'headset', 'keyboard'];
const splitUsb = (usb) => { const [vid, pid] = String(usb || '').split(':'); return { vid, pid }; };

// a library or learned driver's row, from the summary item (may be null) and the live device (may be null)
function driverRow(id, item, d) {
  const title = d?.title || item?.title || item?.name || id;
  const driver = d?.learned ? 'Learned on this PC' : d && !d.library ? 'Your own driver (my-devices folder)' : 'Ready-made driver from the device library';
  // the live device wins: the summary is kept a minute by the server
  const turnOn = d ? !!d.turnOn : item?.action?.kind === 'turn-on' || item?.state === 'one-click';
  const connected = d ? d.status === 'connected' : item?.action?.kind === 'turn-on' || item?.action?.kind === 'check-again';
  const row = { key: id, id, title, driver };
  if (turnOn) return connected
    ? { ...row, status: 'needs', line: "Turn on its settings. DeviceHub tests each one first. Close the maker's app before you do.", action: { kind: 'turn-on', id } }
    : { ...row, status: 'needs', line: 'Connect it, then turn on its settings here.' };
  if (item?.action?.kind === 'check-again' && connected) return { ...row, status: 'optional', line: item.short || 'Some settings are read-only for now.', action: { kind: 'check-again', id } };
  const line = item?.state === 'one-click' ? 'Settings on. Ready on its own page.' : item?.short || 'Ready on its own page.';
  return { ...row, status: 'done', line, action: d?.works ? { kind: 'works', id } : { kind: 'open', page: id } };
}

// the maker's app holding a device that is not connected (helpers/diagnose.mjs finding 'maker-app'): its close
// button replaces the row's own, and the row needs you
function withMakerApp(row, f) {
  const a = f?.action;
  if (!a || a.kind !== 'close-app') return row;
  return { ...row, status: 'needs', line: f.fix || `${f.problem}.`, action: { kind: 'close-app', id: row.id, app: a.app, label: a.label, confirm: a.confirm } };
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
    if (i.what === 'bluetooth' || i.what === 'lamparrays') continue;   // the Batteries and Lights parts
    if (BUILTIN.includes(i.what)) {
      seen.add(i.what);
      rows.push(withMakerApp({ key: i.what, id: i.what, title: live[i.what]?.title || i.name || i.what, driver: "DeviceHub's own driver", status: 'done', line: i.short || 'Ready on its own page.', action: { kind: 'open', page: i.page || i.what } }, diag[i.what]));
    } else if (i.what === 'library') {
      seen.add(i.page);
      rows.push(withMakerApp(driverRow(i.page, i, live[i.page]), diag[i.page]));
    } else if (i.what === 'via') rows.push({ key: `via:${i.name}`, title: i.name, driver: 'VIA, built into the keyboard', status: 'done', line: i.short, action: { kind: 'open', page: 'keyboard' } });
    else if (i.what === 'monitors') rows.push({ key: 'monitors', title: i.name, driver: 'Windows (DDC/CI)', status: 'done', line: i.short, action: { kind: 'open', page: 'monitors' } });
    else if (i.what === 'cameras') rows.push({ key: 'cameras', title: i.name, driver: "Windows' own camera controls", status: 'done', line: i.short, action: { kind: 'open', page: 'monitors' } });
    else if (i.what === 'generic-dongle') { const { vid, pid } = splitUsb(i.usb); rows.push({ key: i.usb, title: i.title, driver: "Windows' own driver", status: 'none', line: i.short, action: { kind: 'request', vid, pid, name: i.title } }); }
  }
  for (const i of s.learn || []) {
    if (i.what === 'library-install' || i.what === 'library-untested') {
      rows.push({ key: `install:${i.name}`, title: i.title, driver: 'Ready-made driver, not installed yet', status: 'needs', line: i.short, ...(i.action ? { action: { kind: 'install', name: i.action.name } } : {}) });
      continue;
    }
    const { vid, pid } = splitUsb(i.usb);
    if (i.what === 'packet-size') { rows.push({ key: i.usb, title: i.title, driver: 'No driver yet', status: 'optional', line: i.short, action: { kind: 'request', vid, pid, name: i.title } }); continue; }
    const L = layouts[String(i.usb || '').toLowerCase()];
    if (isVia(i.usb, i.title) && L?.have) rows.push({ key: i.usb, title: i.title, driver: 'VIA, with its layout file', status: 'needs', line: 'Its layout file is there. Restart DeviceHub to show its keys (tray icon > Quit, then open it again).' });
    else if (isVia(i.usb, i.title) && L?.source) rows.push({ key: i.usb, title: i.title, driver: 'VIA, needs its layout file', status: 'needs', line: "Get the layout saves its maker's official VIA file. It is checked before it is saved.", action: { kind: 'get-layout', vid, pid } });
    else rows.push({ key: i.usb, title: i.title, driver: 'No driver yet', status: 'needs', line: i.short, action: { kind: 'learn', vid, pid } });
  }
  for (const i of s.optional || []) {
    if (i.what === 'library-extra') rows.push({ key: `install:${i.name}`, title: i.title, driver: 'VIA now; a ready-made driver adds more', status: 'optional', line: i.short, ...(i.action ? { action: { kind: 'install', name: i.action.name } } : {}) });
    else if (i.what === 'unknown-vendor') rows.push({ key: 'unknown', title: i.title, driver: 'No driver yet', status: 'optional', line: i.short, action: { kind: 'learn' } });
  }
  // devices the summary did not list (it did not answer, or a driver written on this PC): from the window's own list
  for (const [id, d] of Object.entries(live)) {
    if (seen.has(id)) continue;
    if (BUILTIN.includes(id)) {
      if (summary || !(d.seen || ['connected', 'asleep'].includes(d.status))) continue;
      rows.unshift(withMakerApp({ key: id, id, title: d.title || id, driver: "DeviceHub's own driver", status: 'done', line: d.status === 'connected' ? `Ready on the ${String(d.kind || id).toLowerCase()} page.` : `Ready on the ${String(d.kind || id).toLowerCase()} page (${d.status} now).`, action: { kind: 'open', page: id } }, diag[id]));
    } else if (d.plugin) rows.push(withMakerApp(driverRow(id, null, d), diag[id]));
  }
  return rows;
}

// Do all: every safe next step, in order (installs, Turn on settings for all, Get the layout). Never closes a maker's
// app and never starts learning: those need their own click.
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

// Sound: Equalizer APO (installers' status) and the headset it is on for (GET /api/eq)
export function soundRows(tool, eq) {
  const rows = [];
  if (!tool) return rows;
  if (!tool.installed) rows.push({ key: 'eqapo', title: 'Equalizer APO', status: 'optional', line: 'The EQ, mic boost and mic filters for any headset. Windows asks once when it installs.', action: { kind: 'tool', id: 'eqapo' } });
  else rows.push({ key: 'eqapo', title: 'Equalizer APO', status: 'done', line: `Installed${tool.version ? ` (${tool.version})` : ''}.`, action: { kind: 'open', page: 'headset' } });
  if (tool.installed && eq && eq.engine === 'eqapo') {
    const off = [...new Set((eq.notOn || []).map((d) => d.name))];
    const who = eq.headsetModel || 'the headset';
    rows.push(off.length
      ? { key: 'eq-on', title: `EQ on ${who}`, status: 'needs', line: `Not on for ${off.join(' and ')} yet, so the EQ is not heard. Turn it on, tick ${off.length > 1 ? 'them' : 'it'}, click OK, then restart the PC.`, action: { kind: 'eq-on' } }
      : { key: 'eq-on', title: `EQ on ${who}`, status: 'done', line: `On for ${who}.`, action: { kind: 'open', page: 'headset' } });
  }
  return rows;
}

// Lights: the OpenRGB inside DeviceHub (GET /api/openrgb), and Windows Dynamic Lighting from the summary
export function lightRows(orgb, summary) {
  const rows = [];
  if (orgb) {
    const n = orgb.controllers?.length || 0;
    if (orgb.running) rows.push({ key: 'openrgb', title: 'PC lights', status: n ? 'done' : 'none', line: n ? `${n} light${n === 1 ? '' : 's'} found through OpenRGB${orgb.bundled ? ' (USB lights only)' : ''}.` : 'OpenRGB runs but found no lights.', action: { kind: 'open', page: 'lighting' } });
    else if (orgb.bundle?.canStart) rows.push({ key: 'openrgb', title: 'PC lights', status: 'optional', line: `Find lights starts the OpenRGB ${orgb.bundle.version || ''} inside DeviceHub, hidden, for USB lights. The board and RAM need your own OpenRGB.`.replace('  ', ' '), action: { kind: 'find-lights' } });
    else rows.push({ key: 'openrgb', title: 'PC lights', status: 'optional', line: 'Board, fan and RAM lights need the free OpenRGB app. The Lighting page shows how.', action: { kind: 'open', page: 'lighting' } });
  }
  const lamps = (summary?.works || []).find((i) => i.what === 'lamparrays');
  if (lamps) rows.push({ key: 'lamparrays', title: lamps.name, driver: 'Windows Dynamic Lighting', status: 'done', line: lamps.short, action: { kind: 'settings', page: 'lighting', label: 'Open Dynamic Lighting' } });
  return rows;
}

// Batteries Windows already knows (GET /api/bluetooth): connected ones with a level
export function batteryRows(bt) {
  const list = (bt || []).filter((d) => d.connected && d.battery != null);
  if (!list.length) return [{ key: 'bt-none', title: 'Bluetooth batteries', status: 'none', line: bt ? 'No Bluetooth device with a battery is connected now.' : 'Checking…' }];
  return list.map((d) => ({ key: `bt:${d.name}`, title: d.name, driver: 'Windows (Bluetooth)', status: 'done', line: `${d.battery}% battery. Shown on the Overview.` }));
}

// Learning tools: USBPcap, only when a device still needs learning
export function learnRows(tool, devRows) {
  if (!devRows.some((r) => r.action?.kind === 'learn')) return [];
  if (!tool) return [];
  return [tool.installed
    ? { key: 'usbpcap', title: 'USBPcap', status: 'done', line: `Installed${tool.version ? ` (${tool.version})` : ''}. Learn a device can listen.` }
    : { key: 'usbpcap', title: 'USBPcap', status: 'optional', line: "Only for learning a device: it records what the maker's app sends. Windows asks once when it installs.", action: { kind: 'tool', id: 'usbpcap' } }];
}

// Help: the problem reports switch (GET /api/auto-report) and Get help
export function helpRows(ar) {
  const reports = !ar ? { key: 'reports', title: 'Send problem reports to Shawn', status: 'none', line: 'Checking…' }
    : ar.owner ? { key: 'reports', title: 'Send problem reports to Shawn', status: 'none', line: 'Not sent from this PC: it is Shawn\'s own.' }
    : !ar.configured ? { key: 'reports', title: 'Send problem reports to Shawn', status: 'none', line: 'This copy has nowhere to send them.' }
    : { key: 'reports', title: 'Send problem reports to Shawn', status: ar.on !== false ? 'done' : 'optional', line: 'When something goes wrong, DeviceHub sends Shawn a short report with nothing personal in it, so he can fix it.', action: { kind: 'reports' } };
  return [reports, { key: 'help', title: 'Get help', status: 'optional', line: 'A short report about DeviceHub, shown to you first. GitHub opens only when you press it.', action: { kind: 'help' } }];
}

export const countNeeds = (rows) => rows.filter((r) => r.status === 'needs').length;
export const summaryLine = (n) => (n ? `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you` : 'Nothing needs you');
