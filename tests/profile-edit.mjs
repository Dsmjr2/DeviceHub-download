// Editing a profile in its card (28 Oct 2026): each setting gets a control with the values its device page allows, what
// was typed is checked and turned back into the stored value, settings are added, changed and taken out in the three
// places a profile keeps them, and the page saves only the profile. Run: node tests/profile-edit.mjs
import fs from 'node:fs';
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const E = await import('../public/core/profile-edit.js');

// ---- controls and values
let f = E.fieldOf('mouse', 'pollingRate');
check(f.kind === 'choice' && f.options.some((o) => o.value === 8000) && f.options.every((o) => typeof o.value === 'number'), 'polling rate: the mouse\'s rates');
check(E.fromEdit(f, '1000').ok && E.fromEdit(f, '1000').value === 1000 && !E.fromEdit(f, '999').ok, 'polling rate: only its rates');
f = E.fieldOf('mouse', 'dpi0');
check(E.fromEdit(f, '1234').value === 1230 && E.fromEdit(f, '12345').value === 12350, 'DPI snaps to what the mouse stores');
check(!E.fromEdit(f, '20').ok && !E.fromEdit(f, '30000').ok && !E.fromEdit(f, 'abc').ok && !E.fromEdit(f, '').ok, 'DPI out of range or not a number is refused');
f = E.fieldOf('mouse', 'debounce');
check(E.fromEdit(f, '15').ok && !E.fromEdit(f, '16').ok, 'debounce 0-15 ms');
f = E.fieldOf('keyboard', 'brightness');
check(E.toEdit(f, 255) === 100 && E.fromEdit(f, '50').value === 128 && E.fromEdit(f, '100').value === 255, 'keyboard brightness edited as a percent, kept 0-255');
f = E.fieldOf('keyboard', 'effect');
check(f.kind === 'choice' && f.options[0].label === 'None' && E.fromEdit(f, 1).value === 1, 'keyboard effect: the named effects');
check(E.fieldOf('headset', 'led').kind === 'color' && E.fromEdit(E.fieldOf('headset', 'led'), '#FF8800').value === '#ff8800' && !E.fromEdit(E.fieldOf('headset', 'led'), 'red').ok, 'headset color');
check(E.fieldOf('headset', 'mute:recording').kind === 'toggle' && E.fromEdit(E.fieldOf('headset', 'mute:recording'), true).value === true, 'mic muted: on or off');
check(E.fieldOf('monitor', 'contrast').max === 100, 'monitor 0-100');
f = E.fieldOf('mouse', 'btn3', { current: 'keys:04,05' });
check(f.options.some((o) => o.value === 'keys:04,05') && f.options.some((o) => o.value === 'back'), 'a saved key combination stays a choice');
check(E.fieldOf('mouse', 'nonsense') === null, 'an unknown setting is not editable');

// added devices: the plain kinds only
check(E.fieldOf('x', 'dpi', { setting: { key: 'dpi', type: 'slider', min: 100, max: 3200, step: 100 } }).max === 3200, 'added slider');
check(E.fieldOf('x', 'm', { setting: { type: 'choice', options: [{ value: { a: 1 }, label: 'A' }] }, current: { a: 1 } }).options.length === 1, 'added choice keeps object values');
check(E.fieldOf('x', 'z', { setting: { type: 'color', zones: [{ value: 'logo' }] } }) === null && E.fieldOf('x', 'r', { setting: { type: 'remap' } }) === null, 'zones and button maps stay as saved');
check(E.fieldOf('x', 'k', { setting: { type: 'toggle', readOnly: true } }) === null && E.fieldOf('x', 'k', { setting: null }) === null, 'read-only or unknown added settings are not editable');

// starting values
check(E.startValue(E.fieldOf('mouse', 'dpi1'), 1600) === 1600 && E.startValue(E.fieldOf('mouse', 'dpi1'), undefined) === 50, 'a new setting starts at what the device has, else the bottom');
check(E.startValue(E.fieldOf('mouse', 'pollingRate'), 3) === 125, 'an invalid live value is not copied');
check(E.startValue(E.fieldOf('keyboard', 'speed'), 128) === 128, 'a 0-255 live value survives the percent round trip');

// ---- the three places
const p = { name: 'Valorant', color: '#c47b55', games: ['valorant.exe'], devices: { mouse: { dpi0: 800, pollingRate: 1000 } }, monitors: { 'AOC#1': { name: 'AOC', brightness: 40 } }, added: { pad: { title: 'Pad', values: { glow: true } } } };
let d = E.setAt(p, 'd|mouse|debounce', 4);
check(d.devices.mouse.debounce === 4 && p.devices.mouse.debounce === undefined, 'setAt copies');
d = E.setAt(d, 'd|keyboard|effect', 1);
check(d.devices.keyboard.effect === 1, 'a device the profile did not set is added');
d = E.setAt(d, 'm|ACR#5&3&0&UID2|contrast', 50, { monitorName: 'Acer' });
check(d.monitors['ACR#5&3&0&UID2'].name === 'Acer' && d.monitors['ACR#5&3&0&UID2'].contrast === 50 && E.getAt(d, 'm|ACR#5&3&0&UID2|contrast') === 50, 'a monitor id with # and & round-trips');
check(E.countSettings(d) === 7, `count (${E.countSettings(d)})`);
d = E.removeAt(E.removeAt(d, 'd|keyboard|effect'), 'a|pad|glow');
check(!d.devices.keyboard && !d.added, 'a device left with nothing is taken out');
d = E.removeAt(E.removeAt(d, 'm|AOC#1|brightness'), 'm|ACR#5&3&0&UID2|contrast');
check(!d.monitors, 'no monitors left: no monitors key');
const more = E.addable({ devices: { mouse: { dpi0: 800 } }, monitors: { 'AOC#1': { name: 'AOC', brightness: 40 } } }, { monitors: [{ id: 'AOC#2', name: 'AOC' }, { id: 'ACR#9', name: 'Acer' }] });
check(!more.some((m) => m.ref === 'd|mouse|dpi0') && more.some((m) => m.ref === 'd|mouse|pollingRate') && more.some((m) => m.ref === 'd|headset|led'), 'addable: what the profile does not set');
check(more.some((m) => m.ref === 'm|AOC#1|contrast') && !more.some((m) => m.ref === 'm|AOC#1|brightness') && !more.some((m) => m.ref.startsWith('m|AOC#2')) && more.some((m) => m.ref === 'm|ACR#9|volume'), 'addable: a monitor of a saved model is not offered twice');

// ---- the page: saves the profile only, reads it back, never writes a device
const page = fs.readFileSync(new URL('../public/pages/profiles.js', import.meta.url), 'utf8');
const editPart = page.slice(page.indexOf('// ---------- Edit:'), page.indexOf('// ---------- New profile'));
check(editPart.length > 1000, 'the edit part is there');
check(!/\bwrite\(|apply\(|env\.api/.test(editPart), 'editing never writes a device');
check(/await loadProfiles\(\)\)\.find/.test(editPart) && /did not read back/.test(editPart), 'a save is read back');
check(/button\('Edit', \(\) => startEdit\(p\)/.test(page), 'every card has Edit');

if (fails.length) { console.log(`profile-edit: ${fails.length} FAILED\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('profile-edit: all good');
