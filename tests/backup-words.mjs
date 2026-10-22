// The Backups page's plain words (public/core/backup-words.js, 22 Oct 2026, docs/handoff/backups-redesign.md):
//  1. Friendly dates: Today / Yesterday / "Oct 21, 10:41 PM", the same inside a sentence, and the weekly copies' dates.
//  2. What change a backup came before, from its "why" (a key, a setting's name, nothing useful).
//  3. Which card a backup file goes on (the longest device id its name starts with).
//  4. A backup's contents as "name: value" lines (a device backup, a monitor file, a Windows settings file).
//  5. Demo mode's pretend backups read back as copies (a page cannot change them).
// Run: node tests/backup-words.mjs (tests/profiles-added.mjs runs it too, so test:offline covers it)
import { pathToFileURL } from 'node:url';

export async function run() {
  const fails = [];
  const check = (ok, what) => { if (!ok) fails.push(what); };
  const W = await import('../public/core/backup-words.js');

  // ---- 1. dates (local time, as the page shows them)
  const now = new Date(2026, 9, 22, 15, 0);
  check(W.friendlyWhen(new Date(2026, 9, 22, 12, 42), now) === 'Today 12:42 PM', `today: ${W.friendlyWhen(new Date(2026, 9, 22, 12, 42), now)}`);
  check(W.friendlyWhen(new Date(2026, 9, 21, 23, 4), now) === 'Yesterday 11:04 PM', 'yesterday');
  check(W.friendlyWhen(new Date(2026, 9, 20, 22, 41), now) === 'Oct 20, 10:41 PM', `older: ${W.friendlyWhen(new Date(2026, 9, 20, 22, 41), now)}`);
  check(W.friendlyWhen(new Date(2025, 11, 30, 9, 5), now) === 'Dec 30, 2025, 9:05 AM', `last year: ${W.friendlyWhen(new Date(2025, 11, 30, 9, 5), now)}`);
  check(W.friendlyWhen('nonsense', now) === 'Unknown time', 'a bad date');
  check(W.whenInSentence(new Date(2026, 9, 22, 12, 42), now) === 'today at 12:42 PM', 'today in a sentence');
  check(W.whenInSentence(new Date(2026, 9, 21, 23, 4), now) === 'yesterday at 11:04 PM', 'yesterday in a sentence');
  check(W.whenInSentence(new Date(2026, 9, 20, 22, 41), now) === 'Oct 20 at 10:41 PM', 'older in a sentence');
  check(W.weeklyWhen(new Date(2026, 9, 19, 16, 14)) === 'Mon Oct 19, 4:14 PM', `weekly: ${W.weeklyWhen(new Date(2026, 9, 19, 16, 14))}`);
  check(W.sizeText(18766) === '18.3 KB' && W.sizeText(40) === '0.1 KB', 'sizes');

  // ---- 2. the change a backup came before
  const label = (k) => ({ pollingRate: 'Polling rate', 'vol:playback': 'Volume' })[k] || k;
  check(W.whyText('before pollingRate', label) === 'before Polling rate change', 'a key the device page names');
  check(W.whyText('before vol:playback', label) === 'before Volume change', 'a headset key');
  check(W.whyText('before scrollLines', label) === 'before Scroll lines change', 'a key nobody names');
  check(W.whyText('before Polling rate', label) === 'before Polling rate change', "a setting's own name");
  check(W.whyText('before Mic light (charging)') === 'before Mic light (charging) change', 'a name with a note');
  check(W.whyText('before a change') === null && W.whyText('before test') === null && W.whyText(undefined) === null, 'nothing useful says nothing');
  check(W.whyText('full keymap snapshot (corrected)') === null, 'not a "before" line');
  check(W.whyText('before restoring mouse-2026-10-21T22-41-00-000Z.json') === 'before going back to an earlier copy', 'a restore');
  check(W.whyText('before loading the setup file from 2026-10-19') === 'before loading a setup file', 'a setup file load');
  check(W.whyText('before the changes made while it was away') === 'before the changes made while it was away', 'a sentence stays as written');
  check(W.humanKey('dpi2') === 'DPI stage 3' && W.humanKey('btn5') === 'Button 6' && W.humanKey('doubleClick') === 'Double click', 'key names');

  // ---- 3. which card
  const ids = ['mouse', 'headset', 'keyboard', 'example-light'];
  check(W.groupOf('mouse-2026-10-22T16-42-43-942Z.json', ids) === 'mouse', 'a mouse backup');
  check(W.groupOf('example-light-2026-10-21T06-19-05-209Z.json', ids) === 'example-light', 'an added device with a dash in its id');
  check(W.groupOf('windows-pointer-2026-10-19T04-13-50-478Z.json', ids) === 'windows', 'not a device: the first part, as before');
  check(W.groupOf('monitor-ACERVG272UV-2026-10-19T23-37-34-645Z.json', ids) === 'monitor', 'a monitor');

  // ---- 4. contents
  const dev = { device: 'mouse', why: 'before pollingRate', data: { info: { Model: 'Pulsar X-Lite' }, settings: { pollingRate: 4000, motionSync: false, dpi1: 800 }, raw: { flash: [1, 2] } } };
  const c = W.contentLines(dev, (k) => (k === 'pollingRate' ? 'Polling rate' : k), (k, v) => (k === 'pollingRate' ? `${v} Hz` : String(v)));
  const txt = c.lines.map((l) => `${l.label}=${l.text}`).join('|');
  check(txt === 'Model=Pulsar X-Lite|Polling rate=4000 Hz|Motion sync=off|DPI stage 2=800', `device lines: ${txt}`);
  check(c.extra === 'the raw device memory', 'says what the lines leave out');
  const mon = W.contentLines({ at: 'x', monitor: 'AOC AGON OLED', brightness: { value: 45, max: 100 }, colorPreset: { value: 5, max: 11, options: [{ value: 5, label: 'Standard' }] } });
  const mt = mon.lines.map((l) => `${l.label}=${l.text}`).join('|');
  check(mt === 'Monitor=AOC AGON OLED|Brightness=45 of 100|Color preset=Standard', `monitor lines: ${mt}`);
  const win = W.contentLines({ device: 'windows-pointer', data: { ok: true, speed: 10, precision: false } });
  check(win.lines.map((l) => `${l.label}=${l.text}`).join('|') === 'Speed=10|Precision=off', 'Windows pointer lines');

  // ---- 5. demo backups
  const { demoBackups } = await import('../public/devices/demo-backups.js');
  const list = demoBackups.list();
  check(list.length >= 10 && list.every((f, i) => i === 0 || new Date(list[i - 1].at) >= new Date(f.at)), 'demo list, newest first');
  check(list.filter((f) => W.groupOf(f.name, ids) === 'mouse').length > W.SHOWN, 'the demo mouse has older backups to show');
  const one = demoBackups.read(list[0].name); one.why = 'changed';
  check(demoBackups.read(list[0].name).why !== 'changed', 'a demo read is a copy');
  const wk = demoBackups.weekly();
  check(wk.length === 2 && demoBackups.readWeekly(wk[0].name).kind === 'devicehub-setup', 'demo weekly setup copies');
  return fails;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const fails = await run();
  console.log(fails.length ? `backup-words: FAILED: ${fails.join('; ')}` : 'backup-words (the Backups page wording): all good');
  process.exit(fails.length ? 1 : 0);
}
