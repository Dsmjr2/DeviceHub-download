// Bug hunt on Overview, Setup, the device pages, added devices, Supported and Learn (9 Nov 2026): each check below failed
// before its fix. Run: node tests/page-polish.mjs (no hardware, no network, DeviceHub need not run)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.DEVICEHUB_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const css = src('public/style.css');
// one exported arrow function from a page file that cannot be imported in node (it touches window at load)
const fnFrom = (file, name, scope = {}) => {
  const m = new RegExp(`export const ${name} = (\\([^)]*\\) => .+);$`, 'm').exec(src(file));
  if (!m) return null;
  return new Function(...Object.keys(scope), `return ${m[1]}`)(...Object.values(scope));
};

// 1. Setup's list is one column: the PC page's start-up apps grid used the same class (.su-list) and laid Setup's
//    to-do rows out in 3 columns (2 in the app window), with a stray line over the second one
const suListGrid = [...css.matchAll(/(^|\n)([^{}\n]*\.su-list\b[^{}]*)\{([^}]*)\}/g)].filter((m) => /grid-template-columns/.test(m[3]) && !/\.su-app-list/.test(m[2]));
check(!suListGrid.length, `Setup's .su-list is not given columns by another page's rule (${suListGrid.map((m) => m[2].trim()).join(' | ')})`);
check(/class: 'su-app-list'/.test(src('public/ui/startup-apps.js')) && /\.su-app-list \{[^}]*grid-template-columns/.test(css), 'the start-up apps keep their three columns under their own class');

// 2. Share drivers that work: a refused or failed save never says "Thanks" or hides the question
const { shareAnswer } = await import(pathToFileURL(path.join(ROOT, 'public/ui/driver-share.js')).href).catch(() => ({}));
check(typeof shareAnswer === 'function', 'driver-share.js exports shareAnswer (what the page says after an answer)');
if (typeof shareAnswer === 'function') {
  const bad = shareAnswer(true, false, { error: 'disk full' });
  check(bad.choice === undefined && /Not saved: disk full/.test(bad.said) && !/Thanks/.test(bad.said), `a 500 answer: not saved, the question stays (${JSON.stringify(bad)})`);
  const odd = shareAnswer(true, true, {});
  check(odd.choice === undefined && /Not saved/.test(odd.said), 'an answer without a choice is not taken as saved');
  const good = shareAnswer(true, true, { choice: true, shared: [{ sent: true }] });
  check(good.choice === true && /one driver was shared/.test(good.said), 'a saved yes thanks the person');
  check(shareAnswer(false, true, { choice: false }).said === null, 'a saved no says nothing');
}

// 3. Keyboard: Copy layer on a board with only Base and Fn while Fn shows had an empty list, and Next threw (keymap[NaN])
const LAYER_NAMES = ['Base', 'Fn', 'Layer 2', 'Layer 3', 'Layer 4'];
const copyTargets = fnFrom('public/pages/keyboard.js', 'copyTargets', { LAYER_NAMES });
check(typeof copyTargets === 'function', 'keyboard.js has copyTargets');
if (copyTargets) {
  check(copyTargets(2, 1).length === 0 && copyTargets(5, 1).map(([i]) => i).join() === '2,3,4' && copyTargets(5, 0).map(([i]) => i).join() === '1,2,3,4', 'copy targets: never the base or the layer itself');
  check(/copyTargets\(s\.info\.layers, ui\.layer\)\.length \? button\('Copy layer'/.test(src('public/pages/keyboard.js')) && /if \(!choices\.length\) \{ toast/.test(src('public/pages/keyboard.js')), 'no Copy layer button (and no empty dialog) with nothing to copy to');
}

// 4. Overview: a USB or Bluetooth headset run in sound-only mode showed "Mic —" on its tile while its page said On or Muted
const micOn = fnFrom('public/pages/overview.js', 'micOn');
check(typeof micOn === 'function', 'overview.js has micOn');
if (micOn) {
  const generic = (muted) => ({ adapter: { mode: 'generic' }, values: { 'mute:recording': muted } });
  check(micOn(generic(false)) === true && micOn(generic(true)) === false, 'a generic headset: the mic is Windows\' mute, as on its page');
  check(micOn({ adapter: { mode: 'direct' }, values: { 'prop:micEnabled': false, 'mute:recording': false } }) === false, 'the HS80: its own mic state first');
  check(micOn({ adapter: { mode: 'direct' }, values: { 'mute:recording': false } }) === undefined, 'the HS80 without its own reading: unknown, not Windows\' mute');
  check(/\['Mic', micState\(\{ on: micOn\(d\) \}\)\]/.test(src('public/pages/overview.js')) && /const muted = d\.id === 'headset' && micOn\(d\) === false/.test(src('public/pages/overview.js')), 'the tile and its muted look use it');
}

// 5. Headset: no level known (the HS80 while iCUE runs) drew an empty sidetone bar and "—" above a Sidetone row saying On
check(/\n\s*v\.sidetone == null \? null : meter\(\{ ic: 'ear'/.test(src('public/pages/headset.js')), 'the sidetone gauge shows only with a level to show');

// 6. An added device waiting for Turn on settings showed two Turn on settings buttons (the banner and the Settings card)
const my = src('public/pages/my-device.js');
const ca = /function checkAgain\([\s\S]*?\n\}/.exec(my)?.[0] || '';
check(/lib\.turnOn/.test(ca) && /if \(!lib \|\| d\.status !== 'connected' \|\| lib\.turnOn \|\| !ro\.length\) return null;/.test(ca) && !/Turn on settings'/.test(ca), 'Check again stays out while the banner offers Turn on settings');
check(/checkNote\[d\.id\] = 'Checking…';\s*\n\s*redraw\(\);/.test(ca), 'Check again says Checking… while it runs');
// 7. window.open(..., 'noopener') always returns null: the Finish on GitHub link always read "Open GitHub"
check(!/const opened = window\.open\([^)]*'noopener'\)/.test(my) && /const opened = !!win;/.test(my), 'Share this driver knows whether GitHub opened');

// 8. Battery card with no readings: no charging key and no empty Readings fold under "Not enough readings yet"
const bc = src('public/ui/battery-chart.js');
check(/if \(rows\.length < 2\) \{ key\.hidden = true;/.test(bc) && /else table\.hidden = true;/.test(bc) && /\.bc-key\[hidden\], \.bc-table\[hidden\] \{ display: none; \}/.test(css), 'the key and the Readings fold hide when there is nothing to show');

// 9. Learn: "Fix these first:" showed over "Checking…" before the pre-flight had answered
check(/pf\?\.lines \? h\('div', \{ class: 'learn-pf-head' \}/.test(src('public/pages/learn.js')), 'the pre-flight heading waits for its answer');

// 10. DPI stages: the active stage's stepper sat lower than the others'; an added device's stage sliders did not line up
check(/\.stage \{ align-content: start; \}/.test(css), 'stage cards pack their rows at the top');
check(/\.stage-line \.slider output \{ min-width: 72px; \}/.test(css) && /\.stage-line > :last-child:not\(:first-child\) \{[^}]*min-width: 64px/.test(css), 'stage rows: fixed widths for the DPI text and Use / In use');

if (fails.length) { console.log(`page-polish: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('page-polish: all good');
