// DeviceHub as an installed Chrome (or Edge) app (18 Nov 2026), offline: helpers/chrome-app.js with stand-in files, and
// the launcher, both helpers, taskbar-id.ps1 and the page checked for their part. Nothing is installed or opened.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ca = require('../helpers/chrome-app.js');
const ROOT = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

// the app id is Chrome's for the manifest id at http://localhost:5577/
const h = crypto.createHash('sha256').update('http://localhost:5577/').digest('hex').slice(0, 32);
check(ca.APP_ID === [...h].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(''), 'APP_ID is Chrome\'s id for http://localhost:5577/');
check(JSON.parse(read('public/manifest.webmanifest')).id === '/', 'the manifest id stays "/" (the app id depends on it)');
check(read('DeviceHub.vbs').includes(`appId = "${ca.APP_ID}"`), 'the launcher uses the same app id');

// status() and openInstall() on a stand-in PC
const LA = 'C:\\Users\\ann\\AppData\\Local', UD = path.join(LA, 'Google\\Chrome\\User Data');
const files = new Set();
let localState = JSON.stringify({ profile: { last_used: 'Profile 1' } });
const spawned = [];
Object.assign(ca.deps, {
  env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: LA },
  exists: (p) => files.has(p),
  read: (p) => { if (p === path.join(UD, 'Local State')) return localState; throw new Error('no file'); },
  dirs: () => ['Default', 'Profile 1', 'Profile 3', 'System Profile'],
  spawn: (exe, args, opts) => { spawned.push({ exe, args, opts }); return { unref() {} }; },
});
const app = (profile) => path.join(UD, profile, 'Web Applications', 'Manifest Resources', ca.APP_ID);
check(ca.status().browser === null, 'no browser: nothing to install into');
files.add('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
let s = ca.status();
check(s.browser === 'Chrome' && !s.installed && s.profile === null, `Chrome, not installed (${JSON.stringify(s)})`);
files.add(app('Profile 3'));
s = ca.status();
check(s.installed && s.profile === 'Profile 3', `installed in another profile is found (${JSON.stringify(s)})`);
files.add(app('Profile 1'));
check(ca.status().profile === 'Profile 1', 'the browser\'s last-used profile wins');
localState = JSON.stringify({ profile: { last_used: '..\\..\\Evil' } });
check(ca.status().profile === 'Profile 1', 'a strange last-used name is ignored (any profile with the app is used)');
localState = JSON.stringify({ profile: { last_used: 'Profile 1' } });
let r = ca.openInstall(5577);
check(r.ok && spawned.length === 1 && spawned[0].exe.endsWith('chrome.exe') && spawned[0].args.join(' ') === '--profile-directory=Profile 1 --new-window http://localhost:5577/?install#/overview' && spawned[0].opts.detached, `Install opens a normal tab at ?install in the last profile (${JSON.stringify(spawned[0]?.args)})`);
files.clear(); files.add('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
check(ca.status().browser === 'Edge', 'Edge when there is no Chrome (as the launcher)');
files.clear();
r = ca.openInstall();
check(!r.ok && /Chrome or Microsoft Edge/.test(r.error), 'no browser: a plain error');

// the launcher
const vbs = read('DeviceHub.vbs');
check(/If appProf <> "" Then\r?\n\s*Launch """" & chrome & """" & " --profile-directory=""" & appProf & """ --app-id=" & appId, 1\r?\n\s*Else\r?\n\s*Launch """" & chrome & """" & " --app=http:\/\/localhost:" & port & "\/ --start-maximized", 1/.test(vbs), 'the low-memory window opens the installed app, else the plain app window');
check(/If port <> "5577" Then Exit Function/.test(vbs), 'a test copy on another port never opens the installed app');
check((vbs.match(/^appId = /gm) || []).length === 1, 'the app id is set once');
check(/\r\n/.test(vbs) && !/[^\r]\n/.test(vbs), 'DeviceHub.vbs keeps Windows line endings');

// both helpers leave an installed app's window as it is; taskbar-id.ps1 takes its ID
check(/if \(Get\(ps, 5\)\.Contains\("\._crx_"\)\) \{ Marshal\.ReleaseComObject\(ps\); done\.Add\(h\); continue; \}/.test(read('helpers/native/winbrand.cs')), 'the C# helper leaves an installed app\'s window alone');
check(/if installed_app_id\(&get_prop\(ps, 5\)\)/.test(read('helpers/native-rs/src/winbrand.rs')), 'the Rust helper leaves an installed app\'s window alone');
check(/if \(\$now -like 'DeviceHub\*' -or \$now -like '\*\._crx_\*'\) \{ \$id = \$now; break \}/.test(read('helpers/taskbar-id.ps1')), 'taskbar-id.ps1 copies an installed app\'s ID onto the shortcuts');

// the page: the Install row, the routes, the ?install visit
const set = read('public/pages/settings.js');
check(set.includes("opts?.lightWindow !== false && chromeApp?.browser && !chromeApp.installed && !chromeApp.isolated ? row(`Install as ${chromeApp.browser} app`"), 'Settings shows Install only with the low-memory window on and the app not installed');
const srv = read('server.js');
check(srv.includes("if (url.pathname === '/api/chrome-app/install' && req.method === 'POST') return send(res, 200, require('./helpers/chrome-app').openInstall(PORT));"), 'POST /api/chrome-app/install opens the install page');
check(srv.includes("'/api/chrome-app/install': { ok: false, isolated: true }"), 'an isolated test copy never opens a browser');
const ia = read('public/ui/install-app.js');
check(/window\.addEventListener\('beforeinstallprompt', \(e\) => \{ e\.preventDefault\(\); deferred = e; \}\);/.test(ia), 'the browser\'s install offer is kept from the start');
check(/history\.replaceState\(null, '', location\.pathname \+ location\.hash\);\s*if \(standalone\(\)\) return;/.test(ia), '?install is used once and never inside the app window');
check(/try \{ await e\.prompt\(\); await e\.userChoice; \} catch \{\}/.test(ia), 'the browser\'s own prompt does the install, after the person\'s click');
check(/if \(!DEMO\) offerInstall\(\);/.test(read('public/app.js')), 'the page offers it on the ?install visit (not in demo)');

if (problems.length) { console.log(`chrome-app: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('chrome-app (installed app: found per profile, launcher opens it, helpers leave its window, Install row and prompt): all good');
