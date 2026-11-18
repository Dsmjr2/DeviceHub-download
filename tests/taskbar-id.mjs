// Offline test (16 Nov 2026, Shawn: "device hub is still duplicating", two taskbar buttons): helpers/taskbar-id.ps1
// copies the window's taskbar app ID onto DeviceHub's shortcuts. The device helper's winbrand (helpers/native/winbrand.cs,
// native-rs/src/winbrand.rs) gives the window its own ID, "DeviceHub.<icon hash>", a moment after it opens; the script
// read the window before that and wrote Chrome's passing ID (Chrome.localhost_/.UserData.Profile2), so the window,
// re-identified a moment later, no longer grouped under the pin. It now waits for winbrand's ID, and takes Chrome's
// only when winbrand never comes (no helper). Read from the scripts' source; nothing is run.
import fs from 'node:fs';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const ps = fs.readFileSync(new URL('../helpers/taskbar-id.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cs = fs.readFileSync(new URL('../helpers/native/winbrand.cs', import.meta.url), 'utf8');
const rs = fs.readFileSync(new URL('../helpers/native-rs/src/winbrand.rs', import.meta.url), 'utf8');

check(/"DeviceHub\." \+ m\.Groups\[1\]\.Value/.test(cs) && /format!\("DeviceHub\.\{h\}"\)/.test(rs), 'both helpers give the window "DeviceHub.<icon hash>"');
const loop = ps.slice(ps.indexOf("$id = ''"), ps.indexOf('$links = @('));
check(/-like 'DeviceHub\*'/.test(loop) || /-match '\^DeviceHub'/.test(loop), "the wait goes on until the window has winbrand's DeviceHub ID");
check(!/if \(\$id\) \{ break \}/.test(loop), 'it does not stop at the first ID it sees (Chrome\'s passing one)');
check(/\$seen/.test(loop), "Chrome's ID is used only when winbrand's never came");
check(/param\(\[int\]\$WaitSeconds = (\d+)/.test(ps) && Number(ps.match(/param\(\[int\]\$WaitSeconds = (\d+)/)[1]) >= 30, 'it waits long enough for the helper to start (30 s or more)');

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`taskbar-id (the shortcuts get the ID the window keeps, winbrand's): all ${n} passed`);
process.exit(0);
