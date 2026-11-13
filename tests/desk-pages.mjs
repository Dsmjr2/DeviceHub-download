// Bugs found on the PC, Lighting, Monitors, Wallpapers, Profiles, Backups, Settings and Laptop pages (9 Nov 2026 bug
// hunt), each checked so a later change cannot bring it back quietly. Pure functions and the pages' source; nothing is
// opened or sent. Run: node tests/desk-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f) => src(f).replace(/^\s*\/\/.*$/gm, '');   // without whole-line comments
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const page = async (f) => import(pathToFileURL(path.join(ROOT, 'public/pages', f)).href);

// 1. Lighting > Apply to all: a write that failed is named, never "No lit devices. Connect a device first."
{
  const { applyResult } = await page('lighting.js');
  const J = (x) => JSON.stringify(x);
  check(J(applyResult(['Epomaker P75', 'Corsair HS80'], [])) === J(['Lighting set on Epomaker P75 + Corsair HS80', 'good', undefined]), 'all set: good');
  check(J(applyResult(['Epomaker P75'], [], true)) === J(['Lights off on Epomaker P75', 'good', undefined]), 'all off: good');
  const allFailed = applyResult([], ['Epomaker P75', 'PC lights']);
  check(allFailed[1] === 'bad' && /^Not set on Epomaker P75 \+ PC lights$/.test(allFailed[0]) && !/Connect a device/.test(allFailed.join(' ')), `every write failed: named, not "connect a device": ${J(allFailed)}`);
  const some = applyResult(['Corsair HS80'], ['Epomaker P75']);
  check(some[1] === 'bad' && /set on Corsair HS80; not on Epomaker P75/.test(some[0]), `some failed: says which: ${J(some)}`);
  check(J(applyResult([], [])) === J(['No lit devices', 'bad', 'Connect a device first.']), 'nothing to light: says connect a device');
  check(!/pill\('n\/a'\)/.test(src('public/pages/lighting.js')), 'the mouse row has no "N/a" chip beside "No settable lights"');
}

// 2. Settings > Start with Windows: only a read-back answer that matches the switch counts as done
{
  const { startupAnswer } = await page('settings.js');
  check(startupAnswer(true, 200, { enabled: true }).ok && startupAnswer(false, 200, { enabled: false }).ok, 'a matching answer is done');
  const notMade = startupAnswer(true, 200, { enabled: false });
  check(!notMade.ok && notMade.enabled === false && /not made/.test(notMade.detail), 'on, but no shortcut: not changed, and the switch shows off');
  const failed = startupAnswer(false, 500, { error: 'access denied' });
  check(!failed.ok && failed.enabled === null && failed.detail === 'access denied', 'a server error is not "Won\'t start with Windows"');
  check(!startupAnswer(true, 503, { enabled: false, isolated: true }).ok && /Test copy/.test(startupAnswer(true, 503, { isolated: true }).detail), 'a test copy refuses, and says so');
  check(!startupAnswer(false, 0, null).ok, 'no answer: not changed');
  const s = code('public/pages/settings.js');
  check(/onCommit: setStartup/.test(s) && !/startup = r\.enabled; toast/.test(s), 'the switch goes through setStartup');
  // 3. Publish: one waiting redraw at a time while a publish runs (each redraw used to start another 3 s chain)
  check(/if \(running && !pubTimer\) pubTimer = setTimeout\(\(\) => \{ pubTimer = null;/.test(s) && !/if \(running\) setTimeout\(/.test(s), 'publishing redraws on one timer');
  // 4. Send problem reports: a refused change says so
  check(/autoReport: on \}\); \} catch \(e\) \{ toast\('Not changed'/.test(s), 'the problem reports switch says when it was not changed');
  check(/x\.lastProblem \? [\s\S]*?: 'None',/.test(s), 'Health: Last problem reads None, not 0');
}

// 5. Profiles: a save, delete or game change the server refused is said on the card (the buttons keep it quiet)
{
  const s = code('public/pages/profiles.js');
  const at = [...s.matchAll(/await saveProfiles\(/g)].map((m) => m.index);
  check(at.length >= 6, `profiles.js saves in ${at.length} places`);
  for (const i of at) {
    const before = s.slice(Math.max(0, i - 200), i);
    const line = s.slice(s.lastIndexOf('\n', i) + 1, s.indexOf('\n', i));
    check(/try \{\s*$/.test(before) || /try \{[^}]*$/.test(before.slice(before.lastIndexOf('try {'))), `a save not inside try: ${line.trim().slice(0, 100)}`);
  }
  check(/const notSaved = async \(name, e\) => \{ say\(name, `Not saved: /.test(s), 'Not saved: says why on the card');
  check(/e\.error = `Not saved: / .test(s) && /a\.error = `Not saved: /.test(s), 'Edit and New profile keep their boxes and say why');
}

// 6. Monitors: a read that failed is tried again when the page shows again; a failed fresh read keeps the last one
{
  const s = code('public/pages/monitors.js');
  check(/else if \(!list && error && !loading && Date\.now\(\) - failedAt > 10000\) queueMicrotask\(\(\) => load\(false\)\)/.test(s) && /error = e\.message; failedAt = Date\.now\(\);/.test(s), 'Monitors not read: tried again, at most every 10 s');
  check(/\.\.\.\(error && !list \? \[card/.test(s), 'a failed refresh keeps the monitor cards');
}

// 7. Layout: cards under each other have the grid's gap (Laptop and PC pages); no line under a page title
{
  check(/h\('div', \{ class: 'stack laptop-cards' \}, h\('div', \{ class: 'grid two top' \}/.test(code('public/pages/laptop.js')), 'Laptop: its cards in a stack with a gap');
  check(/h\('div', \{ class: 'grid two top', style: \{ marginTop: '16px' \} \}, gamingCard/.test(code('public/pages/fans.js')), 'PC: a gap above Gaming mode and Instant replay');
  check(!/topbar\('Wallpapers'[^\n]*\n\s*where,/.test(src('public/pages/wallpapers.js')) && /\n\s*where\);/.test(src('public/pages/wallpapers.js')), 'Wallpapers: where they are kept is at the bottom, not under the title');
  check(!/bk-intro/.test(src('public/pages/backups.js')), 'Backups: no line under the title');
}

if (fails.length) { console.log(`desk-pages: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('desk-pages (Lighting failures named, Start with Windows read back, Profiles say a refused save, Monitors retry, gaps, titles alone): all good');
