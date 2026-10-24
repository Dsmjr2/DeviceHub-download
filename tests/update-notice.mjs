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

console.log(fails.length ? `update-notice: FAILED: ${fails.join('; ')}` : 'update-notice (signed newer version only, never the owner\'s PC, not when current or offline, changed files said): all good');
process.exit(fails.length ? 1 : 0);
