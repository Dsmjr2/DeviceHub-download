// Request support (22 Oct 2026; helpers/get-help.mjs requestSupport): a short GitHub request for a device with no driver,
// personal data taken out, only an opened link DeviceHub made. Run: node tests/request-support.mjs (opens nothing)
import { requestSupport, open, options, ISSUES, MAX_URL } from '../helpers/get-help.mjs';
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const opened = [];
const deps = { windows: 'Windows 11 24H2 (build 26100)', open: async (u) => { opened.push(u); } };
let r = await requestSupport({ vid: '1532', pid: '00c5', name: 'Razer Viper V3 Pro' }, deps);
check(r.ok && r.title === 'Support request: Razer Viper V3 Pro (USB 1532:00C5)', `title (${r.title})`);
check(/- USB: 1532:00C5/.test(r.body) && /- Maker: Razer/.test(r.body) && /Windows 11 24H2/.test(r.body), 'the body names the USB id, the maker and Windows');
check(r.url.startsWith(`${ISSUES}?`) && r.url.length <= MAX_URL, 'a new-issue link within the limit');
r = await requestSupport({ vid: '1234', pid: 'abcd', name: 'C:\\Users\\someone\\Desktop\\dev.exe' }, deps);
check(r.ok && !/someone/.test(r.body) && r.removed.some((x) => /user folder/.test(x.why)), `a user folder in the name is taken out (${JSON.stringify(r.removed)})`);
check(/not in DeviceHub's brand guide/.test(r.body), 'an unknown maker is said so');
r = await requestSupport({ vid: '1234', pid: 'abcd', name: 'Pad SERIAL: AB12CD34EF' }, deps);
check(r.ok && !/AB12CD34EF/.test(r.body), 'a serial number in the name is taken out');
let threw = 0;
for (const q of [{ vid: 'zz12', pid: '0001' }, { vid: '1532' }, { vid: '1532', pid: '1' }]) { try { await requestSupport(q, deps); } catch { threw++; } }
check(threw === 3, 'a malformed USB id is refused');
const ok = await requestSupport({ vid: '046d', pid: 'c547', name: 'USB Receiver' }, deps);
const o = await open(ok.token, deps);
check(o.ok && opened.length === 1 && opened[0] === ok.url, 'open() opens exactly the link that was made, once asked');
check(!(await open('not-a-token', deps)).ok, 'an unknown token opens nothing');
void options;
if (fails.length) { console.log(`request-support: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('request-support (a request for a device with no driver): all good');
