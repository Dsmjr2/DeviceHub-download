// Why fan lights may be missing (22 Oct 2026, a friend: "the app couldnt find my friends fans to change colors";
// docs/handoff/friend-lights-c232.md). Read-only: it compares what the PC map found (helpers/pc-map.js: the board and
// every USB device) with OpenRGB's own list of USB lighting controllers (helpers/rgb-controllers.json, made from
// OpenRGB's detectors, each entry naming its source file and line), and adds what the last Find lights said
// (helpers/openrgb.js). It sends nothing to any device and never starts OpenRGB.
//
// Fan lights sit in one of three places:
// - on a USB lighting controller: the board's own (ASUS Aura USB, MSI Mystic Light, Gigabyte RGB Fusion 2, ASRock
//   Polychrome USB) or a fan hub (Corsair, Lian Li, NZXT, Thermaltake, Cooler Master). The OpenRGB inside DeviceHub
//   reaches these: they should show after Find lights.
// - on the board's SMBus (or its Super I/O chip): only an OpenRGB with the PawnIO driver, as administrator, reaches
//   them; Add board, fan and RAM lights sets that up on the person's click (helpers/board-lights.mjs, CLAUDE.md).
// - nowhere a PC can reach: 3-pin 12 V RGB fans, or a hub run by its own remote or button.
//
//   diagnose({ pc, orgb }) -> { board, openrgb, found, seen, verdict, problems, lines }
//   GET /api/lights/diagnose (server.js) answers it from the cached PC map and OpenRGB state.
const TABLE = require('./rgb-controllers.json');
const BY_ID = new Map(TABLE.controllers.map((c) => [c.id, c]));
const SOURCE = `${TABLE.source.repo}/src/commit/${TABLE.source.commit}`;
const KIND = {
  reached: 'reached: the board\'s lights, its fan (ARGB) headers included, are listed above',
  usb: 'reachable over USB: should show after Find lights',
  smbus: 'on the board\'s SMBus: needs OpenRGB with PawnIO as administrator (Add board, fan and RAM lights sets it up)',
  none: 'no lighting controller found: the fans may be on a non-addressable or remote-controlled hub',
};
// the maker's own lighting apps that hold these controllers while they run
const MAKER_APPS = 'Armoury Crate, MSI Center, Gigabyte Control Center or RGB Fusion, iCUE, L-Connect, NZXT CAM, SignalRGB';

// Why OpenRGB could not start or answer, in plain words, and the fix. reason: helpers/openrgb.js status().reason
function openrgbFix(reason) {
  const r = String(reason || '');
  if (!r || r === 'not running') return { why: 'Find lights has not run yet.', fix: 'Press Find lights.' };
  if (/Visual C\+\+ runtime/i.test(r)) return { why: 'OpenRGB needs Microsoft\'s Visual C++ runtime, and this PC does not have it.', fix: 'Install the "Visual C++ Redistributable" (X64) from Microsoft (learn.microsoft.com/cpp/windows/latest-supported-vc-redist), then press Find lights again.' };
  if (/already running here without its SDK server/i.test(r)) return { why: 'Another OpenRGB is already open on this PC, so DeviceHub does not start its own.', fix: 'Either quit that OpenRGB (also from the tray) and press Find lights, or in that OpenRGB open the SDK Server tab and press Start Server.' };
  if (/installed on this PC/i.test(r)) return { why: 'OpenRGB is installed on this PC, so DeviceHub uses that one instead of its own.', fix: 'Open OpenRGB, go to the SDK Server tab and press Start Server, then press Find lights.' };
  if (/cannot start without|is missing|not shipped/i.test(r)) return { why: 'The OpenRGB inside DeviceHub is missing some of its files.', fix: 'Install DeviceHub again from its download (your settings are kept). An antivirus may have removed the files: check its quarantine.' };
  if (/did not start its SDK server/i.test(r)) return { why: 'The OpenRGB inside DeviceHub started but did not answer.', fix: 'Press Find lights again. If it keeps failing, restart the PC (a stuck OpenRGB.exe may be left), and check that an antivirus did not block tools\\openrgb\\OpenRGB.exe.' };
  if (/did not answer in time/i.test(r)) return { why: 'OpenRGB took too long to answer (it may still be looking for lights).', fix: 'Wait a minute and press Find lights again.' };
  if (/protocol|0\.7 or newer|before 1\.1/i.test(r)) return { why: 'The OpenRGB on this PC is too old for DeviceHub.', fix: 'Update OpenRGB to 1.1 or newer (openrgb.org).' };
  return { why: `OpenRGB said: ${r}`, fix: 'Press Find lights again; if it repeats, use Get help below.' };
}

const cleanMaker = (s) => String(s || '').replace(/Technology|Co\.|Ltd\.?|Inc\.?|Corporation|International|Computer|,/gi, '').replace(/\s+/g, ' ').trim();
const idsIn = (loc) => { const m = /vid_([0-9a-f]{4})&pid_([0-9a-f]{4})/i.exec(String(loc || '')); return m ? `${m[1]}:${m[2]}`.toLowerCase() : null; };

function diagnose({ pc = null, orgb = null } = {}) {
  const board = pc?.board ? `${cleanMaker(pc.board.maker)} ${pc.board.model || ''}`.trim() || null : null;
  const boardMaker = String(pc?.board?.maker || '');
  // OpenRGB: which one, its state, what it found
  const b = orgb?.bundle || {};
  const last = orgb?.lastFind || null;
  const reason = orgb && !orgb.running ? (last && !last.ok ? last.reason : orgb.reason) || (b.canStart === false ? b.why : 'not running') : null;
  const tried = !!last || !!orgb?.running;
  const openrgb = {
    version: orgb?.running && !orgb.bundled ? (orgb.board?.setUp ? `${b.version || '1.1'} (inside DeviceHub, as administrator for board lights)` : 'your own OpenRGB') : b.version ? `${b.version} (inside DeviceHub)` : null,
    state: !orgb ? 'unknown' : orgb.running ? 'running' : b.canStart === false ? 'cannot start' : tried ? 'could not start' : 'not started yet',
    reason, ...(reason ? openrgbFix(reason) : {}),
    usbOnly: !!orgb?.running && !!orgb.bundled,
  };
  // each part's zones too (23 Oct 2026: a friend's fans were "not found" with the board reached; the report must say which
  // headers OpenRGB lists, how many lights each has and what color they are)
  const found = (orgb?.controllers || []).map((c) => ({ name: c.name, type: c.type, leds: c.leds, id: idsIn(c.location), zones: (c.zones || []).map((z) => ({ name: z.name, leds: z.leds, color: z.color || null, hidden: !!z.hidden })) }));
  const foundIds = new Set(found.map((c) => c.id).filter(Boolean));
  // known lighting controllers plugged in (by USB id; OpenRGB's own table)
  const seen = (pc?.usb || []).map((u) => ({ u, c: BY_ID.get(String(u.id || `${u.vid}:${u.pid}`).toLowerCase()) })).filter((x) => x.c)
    .map(({ u, c }) => ({ id: c.id, name: c.name, kind: c.kind, windowsName: u.name || null, source: `${SOURCE}/${c.source}`, found: orgb?.running ? foundIds.has(c.id) : null }));
  const smbus = TABLE.smbusBoards.find((m) => new RegExp(m.match, 'i').test(boardMaker)) || null;
  let kind = null;
  // OpenRGB already lists the board (its fan headers are zones of it): nothing left to set up
  const boardFound = found.some((c) => /motherboard|mainboard/i.test(String(c.type || '')));
  if (pc) kind = seen.length ? 'usb' : boardFound ? 'reached' : smbus && (pc.smbus?.length || 0) > 0 ? 'smbus' : 'none';
  const verdict = kind ? { kind, line: KIND[kind], source: kind === 'smbus' ? `${SOURCE}/${smbus.source.split(' and ')[0]}` : null } : null;

  // what to tell the person, most useful first
  const problems = [];
  if (reason && openrgb.state !== 'not started yet') problems.push({ problem: 'OpenRGB could not start', why: openrgb.why, fix: openrgb.fix });
  for (const s of seen) if (s.found === false) problems.push({ problem: `${s.name} was not found by OpenRGB`, why: `It is plugged in (USB ${s.id}), but OpenRGB did not list it. The maker's lighting app (${MAKER_APPS}) may be holding it, or it needs an OpenRGB newer than ${b.version || '1.1'}.`, fix: 'Quit the maker\'s lighting app (also from the tray), then press Find lights again.' });
  if (kind === 'smbus' && !(orgb?.running && !orgb.bundled) && !orgb?.board?.setUp) problems.push({ problem: 'The fan headers are likely on the board\'s SMBus', why: `No USB lighting controller is plugged in, and ${smbus.maker} boards without one keep their lights on the SMBus. The OpenRGB inside DeviceHub runs without administrator and without PawnIO, so it reaches USB lights only.`, fix: 'Press Add board, fan and RAM lights (Lighting > PC lights, or Setup): it installs the signed PawnIO driver if it is missing and runs the OpenRGB inside DeviceHub as administrator, behind Windows\' own prompt. Your choice; Remove board lights undoes it.' });
  if (kind === 'none') problems.push({ problem: 'No lighting controller found', why: 'Nothing on USB is a known lighting controller, and the board is not one whose lights sit on the SMBus.', fix: 'Check how the fans are wired: 3-pin (12 V) RGB fans cannot be addressed, and a hub with its own remote or button is not reachable from the PC. A 3-pin ARGB (5 V) cable on a board ARGB header would be.' });

  const lines = [
    `- OpenRGB: ${openrgb.version || 'none'}, ${openrgb.state}${openrgb.usbOnly ? ' (USB lights only)' : ''}${reason && openrgb.state !== 'not started yet' ? `; ${reason}` : ''}`,
    `- Last Find lights: ${last ? `${last.at.slice(0, 16).replace('T', ' ')}, ${last.ok ? `found ${last.found}` : 'failed'}` : 'not pressed since DeviceHub started'}`,
    `- Lights OpenRGB found: ${found.length ? found.map((c) => `${c.name} (${c.type}${c.id ? `, USB ${c.id}` : ''})`).join('; ') : 'none'}`,
    ...found.filter((c) => c.zones.length > 1).map((c) => `- ${c.name} zones: ${c.zones.map((z) => `${z.name} (${z.leds} lights${z.color ? `, ${z.color}` : ''}${z.hidden ? ', hidden' : ''})`).join('; ')}`),
    `- Board: ${board || 'not read'}${pc?.smbus?.length ? ` (SMBus: ${pc.smbus.join(', ')})` : ''}`,
    `- Lighting controllers on USB: ${seen.length ? seen.map((s) => `${s.name} (${s.id})${s.found === true ? ', found' : s.found === false ? ', NOT found by OpenRGB' : ''}`).join('; ') : 'none known'}`,
    // every USB device by id and Windows' name, so a fan controller DeviceHub does not know yet still shows (23 Oct 2026,
    // Shawn: "He has a controller for his fans"; the report said none known and listed nothing else)
    `- All USB devices: ${(pc?.usb || []).map((u) => `${String(u.id || `${u.vid}:${u.pid}`).toLowerCase()}${u.name ? ` ${u.name}` : ''}`).filter((x, i, all) => all.indexOf(x) === i).join('; ') || 'not read'}`,
    `- So: ${verdict ? verdict.line : 'the PC was not read yet'}`,
  ];
  return { board, openrgb, found, seen, verdict, problems, lines, table: { entries: TABLE.controllers.length, source: SOURCE } };
}

module.exports = { diagnose, openrgbFix, KIND, _test: { TABLE } };
