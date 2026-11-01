// The update pop-up's decision (helpers/update-notice.mjs): only a signed newer version, never on the owner's PC.
import { notice } from '../helpers/update-notice.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const zip = { zip: true, behind: 3, version: 'abc123', versionAt: '2026-10-24T15:00:00Z' };

check(notice({ owner: false, status: zip })?.version === 'abc123', 'a zip copy behind a signed release gets the notice');
check(/new version of DeviceHub is ready/.test(notice({ owner: false, status: zip }).text), 'the notice says a new version is ready');
check(notice({ owner: true, status: zip }) === null, 'never on the owner\'s PC');
check(notice({ owner: false, status: { ...zip, behind: 0 } }) === null, 'nothing when up to date');
check(notice({ owner: false, status: { ...zip, error: 'offline' } }) === null, 'nothing when the check failed');
check(notice({ owner: false, status: { git: true, shared: false, behind: 2, version: 'x' } }) === null, 'a git copy following a branch (not the signed release) gets none');
check(notice({ owner: false, status: { git: true, shared: true, behind: 2, version: 'x' } })?.version === 'x', 'a download copy behind the signed release gets it');
check(notice({ owner: false, status: { ...zip, version: null } }) === null, 'no version id, no notice');
check(/1 file was changed/.test(notice({ owner: false, status: { ...zip, blocked: true, blockedFiles: ['a.js'] } }).text), 'files changed on this PC are named in the notice');
check(notice({ owner: false, status: null }) === null, 'no status, no notice');

// readable versions and what's new (27 Oct 2026, helpers/release-notes.mjs)
const named = notice({ owner: false, status: { ...zip, versionName: '1.5', notes: ['Any VIA keyboard connects by itself', 'Mic EQ no longer asked for'] } });
check(/^DeviceHub 1\.5 is ready/.test(named.text) && named.name === '1.5', `the notice names the version (${named.text})`);
check(named.notes.length === 2 && named.notes[0] === 'Any VIA keyboard connects by itself', 'the notice carries what\'s new');
check(named.version === 'abc123', 'the notice is still keyed on the signed commit (asked once per version)');
const old = notice({ owner: false, status: zip });
check(old.name === null && old.notes.length === 0 && /^A new version of DeviceHub is ready/.test(old.text), 'a release from before 27 Oct (no number, no notes) reads as before');
check(notice({ owner: false, status: { ...zip, versionName: '1.5"><b>', notes: ['x'] } }).name === null, 'a version that is not a plain number is not shown');
check(notice({ owner: false, status: { ...zip, versionName: '1.5', notes: [1, '', 'a', 'b', 'c', 'd', 'e', 'f'] } }).notes.join() === 'a,b,c,d,e', 'notes: plain lines only, at most 5');

// at every start, only when behind (1 Nov 2026, Shawn): checked 5 s after start, retried while offline, the window
// opened when none is, and asked at once
{
  const fsm = await import('node:fs');
  const server = fsm.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const app = fsm.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  check(/setTimeout\(check, 5000\)/.test(server), 'the update check runs 5 s after start');
  check(/status\?\.error\)[\s\S]{0,120}setTimeout\(check, 120000\)/.test(server), 'a failed check tries again every 2 minutes');
  check(/if \(!updateNotice\) return;/.test(server) && /openWindows > 0[\s\S]{0,300}spawn\('wscript\.exe', \[path\.join\(ROOT, 'DeviceHub\.vbs'\)\]/.test(server), 'with no window open, the window is opened only when a version is ready');
  check(!/130000 - performance\.now\(\)/.test(app), 'the window asks at once, not after 130 s');
}

const { nextVersion, notesFrom, shortLine, plan, readPublished } = await import('../helpers/release-notes.mjs');
check(nextVersion('1.4') === '1.5' && nextVersion('1.9') === '1.10' && nextVersion('2.0') === '2.1', 'each publish adds 1 after the dot');
check(nextVersion(undefined) === '1.0' && nextVersion('v7') === '1.0', 'no known version starts at 1.0');
const subjects = ['DeviceHub 1.4', 'Keep the local logs folder out of git', 'Window gets changes pushed instead of asking; small memory savings; mic EQ no longer asked for', 'Fix the colour picker', 'Fix the colour picker', 'Update tests for the relay'];
const notes = notesFrom(subjects);
check(notes.length === 2 && notes[0] === 'Window gets changes pushed instead of asking' && notes[1] === 'Fix the color picker', `notes skip the publish commits, git and test chores and repeats, use US spelling (${JSON.stringify(notes)})`);
check(notesFrom([]).join() === 'Small fixes and improvements' && notesFrom(['DeviceHub 1.2']).join() === 'Small fixes and improvements', 'no visible change: one plain line');
const many = notesFrom(Array.from({ length: 9 }, (_, i) => `Change number ${i + 1}`));
check(many.length === 5 && many[4] === 'Plus 5 more fixes and improvements', `at most 5 lines (${many.at(-1)})`);
const long = shortLine('Add family protocol matching to SteelSeries, Keychron VIA, and ASUS ROG and a lot of other words after that');
check(long.length <= 70 && long.endsWith('…'), `a long subject is cut to one short line (${long})`);
const p = plan();
check(/^\d+\.\d+$/.test(p.version) && p.version === nextVersion(readPublished()?.version) && p.notes.length >= 1 && p.notes.length <= 5, `a dry run plans the next version (${p.version}: ${p.notes.join(' | ')})`);
check(/^\d+\.\d+$/.test(readPublished()?.version || ''), 'helpers/published-version.json holds this copy\'s version number');

console.log(fails.length ? `update-notice: FAILED: ${fails.join('; ')}` : 'update-notice (signed newer version only, never the owner\'s PC, not when current or offline, changed files said, version number and what\'s new): all good');
process.exit(fails.length ? 1 : 0);
