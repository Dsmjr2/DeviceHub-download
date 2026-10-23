// Updates over files "changed on this PC" (23 Oct 2026, a friend's PC: public/style.css that nobody changed held the
// update back, and the only way on was "Ask Claude Code"): a file matching any version DeviceHub shipped
// (release-history.json, LF or CRLF) is not a change; a real change is named, and Update anyway keeps a copy first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { forms, short } from '../helpers/release-history.mjs';

const require = createRequire(import.meta.url);
const { _test: su } = require('../helpers/self-update.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-update-changed-'));
const put = (f, text) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };

const v1 = '.a { color: red; }\n', v2 = '.a { color: blue; }\n.b { }\n';
put('public/style.css', v2); put('server.js', 'x()\n'); put('helpers/bin/DeviceHubHelper.exe', 'built here');
fs.writeFileSync(path.join(root, 'release-files.json'), JSON.stringify({ 'public/style.css': sha(Buffer.from(v2)), 'server.js': sha(Buffer.from('x()\n')), 'helpers/bin/DeviceHubHelper.exe': 'aa' }));
check(su.changedFiles(root).length === 0, `as installed: nothing changed (${su.changedFiles(root)})`);

// an older version DeviceHub shipped (an update that stopped halfway), with Windows line endings
put('public/style.css', v1.replace(/\n/g, '\r\n'));
check(su.changedFiles(root).join() === 'public/style.css', 'without the history, an older version looks changed');
fs.writeFileSync(path.join(root, 'release-history.json'), JSON.stringify({ 'public/style.css': [...forms(Buffer.from(v1)), ...forms(Buffer.from(v2))].map(short) }));
check(su.changedFiles(root).length === 0, `with the history, a shipped version (CRLF) is not a change (${su.changedFiles(root)})`);

// a real change: named, with Update anyway in the words, never "Ask Claude"
put('public/style.css', '.a { color: hotpink; }\n');
const c = su.changedFiles(root);
check(c.join() === 'public/style.css', `a real change is named (${c})`);
const t = su.blockedText(c);
check(/Update anyway keeps a copy of it/.test(t) && !/Claude/.test(t) && /1 of DeviceHub's files was changed/.test(t), `the words offer Update anyway (${t})`);
const kept = su.keepChanged(c, root);
check(fs.readFileSync(path.join(kept, 'public/style.css'), 'utf8') === '.a { color: hotpink; }\n' && kept.startsWith(path.join(root, 'backups')), 'Update anyway keeps a copy in backups first');

fs.rmSync(root, { recursive: true, force: true });
if (fails.length) { console.log(`update-changed: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('update-changed (a shipped version is not a change; a real change is named, kept and updated over with Update anyway): all good');
