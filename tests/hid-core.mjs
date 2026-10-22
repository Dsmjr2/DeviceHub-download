// The HID layer's library options (22 Oct 2026; helpers/hid-host.mjs, helpers/my-devices.mjs hidSpecs, helpers/native/
// helper.cs HandleHidEx; docs/handoff/hid-core.md), against a stand-in for the native helper (helpers/native.js
// request is replaced; no helper starts, nothing reaches a device): several product ids, choosing a collection by
// interface and report lengths, a report id per request, raw replies, refused vs gone, and the mouse's and keyboard's
// own channels exactly as before.
// Run: node tests/hid-core.mjs (no hardware)
import { createRequire } from 'node:module';
import { HidChannel } from '../public/devices/hid.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const native = createRequire(import.meta.url)('../helpers/native.js');
const lines = [];
let answer = () => 'NONE';
native.request = async (chan, cmd) => { lines.push(`${chan} ${cmd}`); return answer(chan, cmd); };
native.onEvent = () => {};
const host = await import('../helpers/hid-host.mjs');
const { hidSpecs } = await import('../helpers/my-devices.mjs');
const { validateMeta } = await import('../helpers/device-library.mjs');
const gone = [];
host.setGoneHandler((id) => gone.push(id));
const since = (n) => lines.slice(n);

// ---- 1. the default paths: the Pulsar mouse and the P75 keyboard name, open and ask exactly as before ----
{
  // today's addSpec, kept here word for word: a spec without the new options must come out the same
  const oldAdd = (spec) => {
    const up = (x) => String(x).toUpperCase().padStart(4, '0');
    const s = { usage: '0001', len: 64, reportId: 0, replyMs: 900, echo: () => 1, ...spec,
      vid: up(spec.vid), pid: up(spec.pid), page: up(spec.page || 'FF00'), productName: spec.productName || spec.id };
    Object.assign(s, { vendorId: parseInt(s.vid, 16), productId: parseInt(s.pid, 16), usagePage: parseInt(s.page, 16), usage: up(s.usage) });
    if (s.cablePid) s.cablePid = up(s.cablePid);
    return s;
  };
  check(host.SPECS.every((s) => !s.opts), 'the built-in specs carry no channel options');
  answer = (chan, cmd) => (cmd === 'OPEN' ? 'OK' : cmd.startsWith('WATCH') ? 'OK' : cmd.startsWith('REQ') ? '04 aa bb' : 'NONE');
  let n = lines.length;
  const mouse = await host.provider([{ vendorId: 0x3710, usagePage: 0xff02 }]);
  check(mouse && since(n)[0] === 'hid:3710:3506:FF02:0002:16:8 OPEN', `the mouse opens its cable channel first, named as before (${since(n)[0]})`);
  check(since(n).includes('hid:3710:3506:FF02:0002:16:8 WATCH 0a'), 'the mouse still listens for its DPI button (WATCH 0a)');
  n = lines.length;
  await mouse.sendReport(8, [0x04, 0, 0, 0x49]);
  check(since(n).at(-1) === 'hid:3710:3506:FF02:0002:16:8 REQ 1 900 04 00 00 49', `the mouse's request line is unchanged (${since(n).at(-1)})`);
  n = lines.length;
  await mouse.sendReport(3, [0x04]);
  check(since(n).at(-1) === 'hid:3710:3506:FF02:0002:16:8 REQ 1 900 04', `another report id is still ignored on a built-in channel (${since(n).at(-1)})`);
  mouse.close(); clearTimeout(mouse.watch); mouse.watch = null;
  n = lines.length;
  const kb = await host.provider([{ vendorId: 0x342d, productId: 0xe479, usagePage: 0xff60, usage: 0x61 }]);
  check(kb && since(n)[0] === 'hid:342D:E479:FF60:0061:32:0 OPEN', `the keyboard's channel is named as before (${since(n)[0]})`);
  n = lines.length;
  await kb.sendReport(0, [0x01]);
  check(/^hid:342D:E479:FF60:0061:32:0 REQ \d+ 750 01$/.test(since(n).at(-1)), `the keyboard's request line is unchanged (${since(n).at(-1)})`);
  kb.close();
  // a my-devices spec and a LampArray spec: the same fields as before, no options, the same channel name
  for (const spec of [{ id: 'test-mouse', vid: '046d', pid: 'C547', page: 'FF00', len: 20, reportId: 17 },
    { id: 'lights', vid: '045E', pid: '0B12', page: '0059', usage: '0001', len: 1, reportId: 0, featureLen: 50 },
    { id: 'plain', vid: '1234', pid: 'abcd' }]) {
    host.addSpec(spec);
    const now = host.SPECS.at(-1), was = oldAdd(spec);
    // never: the never-list mark addSpec adds (safety round 2); the channel name and options are as before
    const strip = (s) => JSON.stringify({ ...s, echo: undefined, opts: undefined, never: undefined });
    check(strip(now) === strip(was) && !now.opts && now.never === true, `${spec.id}: the spec is what it was, marked for the never list (${strip(now)} vs ${strip(was)})`);
  }
  check(hidSpecs({ id: 'one', hid: { vid: '1234', pid: 'ABCD', len: 8 } }).length === 1 && JSON.stringify(hidSpecs({ id: 'one', hid: { vid: '1234', pid: 'ABCD', len: 8 } })[0]) === JSON.stringify({ id: 'one', vid: '1234', pid: 'ABCD', len: 8 }),
    'a driver without pids gets the one channel it always got ({ id, ...hid })');
  check(hidSpecs({ id: 'none' }).length === 0, 'a driver without hid gets none');
}

// ---- 2. several product ids: one channel per pid, overrides per pid, and every filter tried in order ----
{
  const drv = { id: 'multi-mouse', hid: { vid: '1532', pid: '00B7', pids: ['00b7', '0x00C1', '00C2'], page: '0001', usage: '0002', len: 90, featureLen: 90, featureOnly: true, reportId: 0,
    byPid: { '00c1': { iface: 3 }, '00B7': { iface: 0 } } } };
  const specs = hidSpecs(drv);
  check(specs.map((s) => s.pid).join() === '00B7,00C1,00C2', `one spec per pid, pid first, each once (${specs.map((s) => s.pid)})`);
  check(specs[0].iface === 0 && specs[1].iface === 3 && specs[2].iface === undefined && specs.every((s) => !('pids' in s) && !('byPid' in s) && s.id === 'multi-mouse'), 'each pid takes its own overrides');
  for (const s of specs) host.addSpec(s);
  const chans = host.SPECS.slice(-3).map((s) => `hid:${s.vid}:${s.pid}:${s.page}:${s.usage}:${s.len}:${s.reportId}${s.opts}`);
  check(chans[0] === 'hid:1532:00B7:0001:0002:90:0:if=0:fl=90:fo=1', `interface + feature length + feature-only in the channel (${chans[0]})`);
  check(chans[1] === 'hid:1532:00C1:0001:0002:90:0:if=3:fl=90:fo=1', `the second pid's interface (${chans[1]})`);
  check(chans[2] === 'hid:1532:00C2:0001:0002:90:0:fl=90:fo=1', `featureLen chooses beside feature-only (${chans[2]})`);
  answer = (chan, cmd) => (cmd === 'OPEN' ? (chan.includes(':00C2:') ? 'OK' : 'NODEVICE') : cmd.startsWith('FGET') ? '02 1f' : cmd.startsWith('FSET') ? 'OK' : 'NONE');
  const n = lines.length;
  const dev = await host.provider([0xb7, 0xc1, 0xc2].map((productId) => ({ vendorId: 0x1532, productId, usagePage: 0x0001, usage: 0x0002 })));
  check(dev && dev.productId === 0xc2 && dev.pid === '00C2', `the third filter's device opens when the first two are not plugged in (${dev?.pid})`);
  check(since(n).filter((l) => l.endsWith(' OPEN')).length === 3, 'each filter was tried once, in order');
  check((await host.provider([{ vendorId: 0x1532, productId: 0xc1, iface: 0 }])) === null, 'a filter\'s iface must be the host\'s');
  await dev.sendFeatureReport(0, [1, 2]);
  const v = await dev.receiveFeatureReport(0);
  check(lines.at(-2).endsWith(':fo=1 FSET 00 01 02') && lines.at(-1).endsWith(':fo=1 FGET 00 90') && v.byteLength === 2, 'a feature-only channel serves FSET / FGET (FGET length = featureLen)');
  dev.close();
}

// ---- 3. choosing a collection: page '*', interface, collection, lengths; featureLen alone chooses nothing ----
{
  check(host.channelOpts({ page: '*', usage: '*', iface: 4 }) === ':if=4', 'page * with an interface');
  check(host.channelOpts({ page: '*', outputLen: 63 }) === ':ol=63', 'page * chosen by output length');
  check(host.channelOpts({ iface: 2, col: 3, inputLen: 63, outputLen: 63, featureLen: 0 }) === ':if=2:col=3:il=63:ol=63:fl=0', 'interface, collection and all three lengths');
  check(host.channelOpts({ page: '0059', featureLen: 50 }) === '', 'featureLen alone keeps its old meaning (no option, a LampArray opens as before)');
  check(host.channelOpts({ reply: 'raw', refusals: true }) === ':rw=1:rf=1', 'raw and refusals');
  host.addSpec({ id: 'any-page', vid: '03f0', pid: '098d', page: '*', usage: '*', outputLen: 63, len: 63, reportId: 0x21 });
  const s = host.SPECS.at(-1);
  check(s.page === '*' && s.usage === '*' && s.usagePage === null && s.opts === ':ol=63', `page '*' stays '*' (${s.page} ${s.usage} ${s.usagePage} ${s.opts})`);
  check((await host.provider([{ vendorId: 0x03f0, productId: 0x098d, usagePage: 0xff90 }])) === null, 'a filter naming a usage page does not take an any-page host');
}

// ---- 4. a report id per request: reportIds on the same collection, routes to another collection ----
{
  answer = (chan, cmd) => (cmd === 'OPEN' ? 'OK' : cmd.startsWith('REQ') ? `${cmd.split(' ').at(cmd.startsWith('REQR') ? 4 : 3)} 01` : 'NONE');
  host.addSpec({ id: 'arctis-9', vid: '1038', pid: '12C2', page: '*', usage: '*', iface: 0, len: 30, reportId: 0, reportIds: [6, 4] });
  const a9 = await host.provider([{ vendorId: 0x1038, productId: 0x12c2 }]);
  let n = lines.length;
  await a9.sendReport(6, [0x20, 1]);
  check(since(n)[0] === 'hid:1038:12C2:*:*:30:0:if=0 REQR 06 1 900 20 01', `a listed report id goes out with it (${since(n)[0]})`);
  n = lines.length;
  await a9.sendReport(0, [0x20]);
  check(since(n)[0] === 'hid:1038:12C2:*:*:30:0:if=0 REQ 1 900 20', `the channel's own id is a plain REQ (${since(n)[0]})`);
  n = lines.length;
  await a9.sendReport(9, [0x20]);
  check(since(n)[0].includes(' REQ 1 900 20'), 'an unlisted id is ignored, as before');
  a9.close();
  // the ROG Omni receiver: report 03 on col03 (its channel), report 01 on col01 (opened on first use)
  host.addSpec({ id: 'omni', vid: '0b05', pid: '1ace', page: '*', usage: '*', iface: 2, col: 3, len: 64, reportId: 3, replyMs: 300, routes: { 1: { col: 1 } } });
  const omni = await host.provider([{ vendorId: 0x0b05, productId: 0x1ace }]);
  const ch = new HidChannel(omni, { reportId: 0, length: 64, match: (s, r) => r[0] === s[0] });
  n = lines.length;
  const r1 = await ch.request(Uint8Array.from([0xa0, 0, 0]), { reportId: 1, timeoutMs: 500 });
  check(since(n)[0] === 'hid:0B05:1ACE:*:*:64:1:if=2:col=1 OPEN' && since(n)[1]?.startsWith('hid:0B05:1ACE:*:*:64:1:if=2:col=1 REQ 1 300 a0 00 00'), `report 01 goes on col01 (${since(n).join(' / ').slice(0, 160)})`);
  check(r1[0] === 0xa0, 'its reply reaches the driver as report 01');
  n = lines.length;
  const r3 = await ch.request(Uint8Array.from([0x12, 0x07]), { reportId: 3, timeoutMs: 500 });
  check(since(n)[0]?.startsWith('hid:0B05:1ACE:*:*:64:3:if=2:col=3 REQ 1 300 12 07') && r3[0] === 0x12, `report 03 stays on col03 (${since(n)[0]})`);
  n = lines.length;
  omni.close();
  check(since(n).some((l) => l.startsWith('hid:0B05:1ACE:*:*:64:1:if=2:col=1 CLOSE')) && since(n).some((l) => l.startsWith('hid:0B05:1ACE:*:*:64:3:if=2:col=3 CLOSE')), 'closing closes both collections');
}

// ---- 5. raw replies: SEND, then READ until the driver's listener has its reply; notices on request ----
{
  const queue = [];
  answer = (chan, cmd) => {
    if (cmd === 'OPEN') return 'OK';
    if (cmd.startsWith('SEND')) {
      const b = cmd.split(' ').slice(2);
      // a battery event first, then a HID++ error reply for the request (dev FF idx fn code)
      queue.push(`11 01 04 00 32 ${'00 '.repeat(15).trim()}`, `11 ${b[0]} ff ${b[1]} ${b[2]} 08 ${'00 '.repeat(14).trim()}`);
      return 'OK';
    }
    if (cmd.startsWith('READ')) return queue.length ? queue.splice(0).join('|') : 'NONE';
    return 'NONE';
  };
  host.addSpec({ id: 'hidpp', vid: '046d', pid: 'c539', page: 'FF00', usage: '0002', len: 19, reportId: 0x11, replyMs: 2000, reply: 'raw' });
  const lg = await host.provider([{ vendorId: 0x046d, productId: 0xc539, usagePage: 0xff00 }]);
  const isReplyTo = (sent, r) => r[0] === sent[0] && ((r[1] === sent[1] && r[2] === sent[2]) || (r[1] === 0xff && r[2] === sent[1] && r[3] === sent[2]));
  const ch = new HidChannel(lg, { reportId: 0x11, length: 19, match: isReplyTo });
  let n = lines.length;
  const r = await ch.request([0x01, 0x07, 0x2b, 0x00], { timeoutMs: 2600 });
  check(since(n)[0] === `hid:046D:C539:FF00:0002:19:17:rw=1 SEND 11 01 07 2b ${'00 '.repeat(16).trim()}`, `a raw request is a SEND with its report id (${since(n)[0]})`);
  check(since(n)[1]?.includes(' READ '), 'then READ');
  check(r[1] === 0xff && r[2] === 0x07 && r[4] === 0x08, `the error reply reaches the driver past the event before it (${Array.from(r.slice(0, 5))})`);
  n = lines.length;
  await lg.sendReport(0x10, [0x01, 0x00]);
  check(since(n).length === 1 && since(n)[0].endsWith(' SEND 10 01 00'), 'a write nobody waits a reply for: SEND only, no READ; the driver\'s report id kept');
  queue.length = 0; queue.push('11 01 04 00 50');
  const got = await lg.receiveReports(100);
  check(got.length === 1 && got[0].reportId === 0x11 && got[0].data.getUint8(3) === 0x50 && lines.at(-1).endsWith(' READ 100'), 'receiveReports hands notices back as { reportId, data }');
  host.addSpec({ id: 'not-raw', vid: '046d', pid: 'c53a', page: 'FF00', usage: '0002', len: 19, reportId: 0x11 });
  const plain = await host.provider([{ vendorId: 0x046d, productId: 0xc53a }]);
  check(/raw/.test((await throws(() => plain.receiveReports(0)))?.message || ''), 'receiveReports only on a raw channel');
  plain.close(); lg.close();
}

// ---- 6. refused vs gone ----
{
  let reply = 'REFUSED 31';
  answer = (chan, cmd) => (cmd === 'OPEN' ? 'OK' : cmd.startsWith('REQ') || cmd.startsWith('SEND') ? reply : 'NONE');
  host.addSpec({ id: 'hyperx', vid: '03f0', pid: '0696', page: 'FF90', usage: '0303', len: 19, reportId: 6, refusals: true });
  const hx = await host.provider([{ vendorId: 0x03f0, productId: 0x0696 }]);
  check(lines.at(-1) === 'hid:03F0:0696:FF90:0303:19:6:rf=1 OPEN', `refusals ride on the channel (${lines.at(-1)})`);
  let e = await throws(() => hx.sendReport(6, [0xff, 0xbb, 0x02]));
  check(e && e.refused === true && e.code === 31 && !e.gone && hx.opened, `a refused write is refused, not gone, and the device stays open (${e?.message})`);
  check(!gone.includes('hyperx'), 'no gone event for a refusal');
  reply = 'GONE';
  e = await throws(() => hx.sendReport(6, [0xff, 0xbb, 0x02]));
  check(e && e.gone === true && !e.refused && !hx.opened && gone.includes('hyperx'), 'GONE is still an unplug');
  host.addSpec({ id: 'raw-ref', vid: '03f0', pid: '05b7', page: '*', usage: '*', outputLen: 61, len: 61, reportId: 0x66, reply: 'raw' });
  const r = await host.provider([{ vendorId: 0x03f0, productId: 0x05b7 }]);
  reply = 'REFUSED 1';
  e = await throws(() => r.sendReport(0x66, [0x89]));
  check(e && e.refused && e.code === 1 && !e.gone && r.opened, 'a raw SEND refused is refused, not gone');
  r.close();
}

// ---- 7. the library check and the Logitech mode setting ----
{
  const meta = { id: 'x-mouse', vendor: 'X', product: 'P', kind: 'Mouse', vid: '1234', pids: ['abcd'], models: ['X P'], works: [], tested: [] };
  check(validateMeta({ ...meta, status: 'read-only' }) === null && validateMeta({ ...meta, status: 'untested' }) === null, 'tested: [] is accepted for read-only and untested');
  check(/tested must list/.test(validateMeta({ ...meta, status: 'tested' }) || ''), 'a tested entry still needs its record');
  check(/tested must list/.test(validateMeta({ ...meta, status: 'read-only', tested: [{ by: 'x' }] }) || ''), 'a record without date and version is still refused');
  const lg = (await import('../device-library/logitech-hidpp-mouse/device.mjs')).default;
  check(lg.settings.find((s) => s.key === 'mode') && lg.settings.find((s) => s.key === 'mode').selfCheck !== false, 'Logitech "Settings source" gets the normal self-check (the same mode written back)');
  const specs = hidSpecs(lg);
  check(specs.length === 16 && specs.every((s) => s.reply === 'raw' && s.reportId === 0x11), `Logitech: one raw channel per receiver and wired mouse (${specs.length})`);
}

// ---- 8. input reports on request (inputReports, IGET) and extra collections (extra, extraChannel): both opt-in ----
{
  // the defaults: no built-in spec asks for either, so their channel names and lines are the ones section 1 checked
  check(host.SPECS.slice(0, 2).every((s) => !s.inputReports && !s.extra && host.channelOpts(s) === ''), 'the mouse and keyboard specs ask for neither');
  answer = (chan, cmd) => (cmd === 'OPEN' || cmd.startsWith('WATCH') ? 'OK' : 'NONE');
  const mouse = await host.provider([{ vendorId: 0x3710, usagePage: 0xff02 }]);
  let n = lines.length;
  check(/inputReports/.test((await throws(() => mouse.getInputReport(8, 16)))?.message || '') && since(n).length === 0, 'getInputReport is refused on the mouse, and sends nothing');
  check(/no extra collection/.test((await throws(() => mouse.extraChannel('x')))?.message || '') && since(n).length === 0, 'the mouse has no extra collection, and nothing is opened');
  check(mouse.chan === 'hid:3710:3506:FF02:0002:16:8', `the mouse's channel name is still ${mouse.chan}`);
  mouse.close(); clearTimeout(mouse.watch); mouse.watch = null;
  check(host.channelOpts({ reply: 'raw', inputReports: true }) === ':rw=1:gi=1' && host.channelOpts({ inputReports: false }) === '', 'inputReports adds gi=1, and only when true');
  // helper.cs: IGET is only in HandleHidEx (a channel with options), never in the old HandleHid or the HS80 path
  const fs = await import('node:fs');
  const cs = fs.readFileSync(new URL('../helpers/native/helper.cs', import.meta.url), 'utf8');
  const part = (a, b) => cs.slice(cs.indexOf(a), cs.indexOf(b, cs.indexOf(a) + a.length));
  check(!part('static string HandleHid(Channel', '// A channel with options (see Opts above)').includes('IGET') && !part('static string HandleHs80(', 'case "CLOSE"').includes('IGET'), 'IGET is not on the plain HID or the HS80 path');
  check(/case "IGET": \{\r?\n\s+if \(Opt\(o, "gi"\) != 1\) return "ERR/.test(part('static string HandleHidEx(', 'static string HandleHs80(')), 'IGET answers ERR on a channel without gi=1');
  check(cs.includes('\r\n') && !/[^\r]\n/.test(cs), 'helper.cs keeps its CRLF line endings');

  // a Turtle Beach style channel: raw, with input reports
  let iget = '00 3a 00 05 5b';
  answer = (chan, cmd) => (cmd === 'OPEN' ? 'OK' : cmd.startsWith('IGET') ? iget : 'NONE');
  host.addSpec({ id: 'tb', vid: '10f5', pid: '2251', page: 'FF13', usage: '0001', len: 61, reportId: 6, reply: 'raw', replyMs: 300, inputReports: true });
  const tb = await host.provider([{ vendorId: 0x10f5, productId: 0x2251, usagePage: 0xff13 }]);
  check(lines.at(-1) === 'hid:10F5:2251:FF13:0001:61:6:rw=1:gi=1 OPEN', `the channel says gi=1 (${lines.at(-1)})`);
  n = lines.length;
  const r = await tb.getInputReport(7);
  check(since(n)[0] === 'hid:10F5:2251:FF13:0001:61:6:rw=1:gi=1 IGET 07 61', `IGET with the id and the data length (${since(n)[0]})`);
  check(r && r.reportId === 7 && r.data.byteLength === 5 && r.data.getUint8(1) === 0x3a, 'the reply comes back as { reportId, data }');
  iget = 'NONE';
  check((await tb.getInputReport(7, 61)) === null, 'NONE (no answer) is null');
  iget = 'GONE';
  const e = await throws(() => tb.getInputReport(7, 61));
  check(e && e.gone && !tb.opened && gone.includes('tb'), 'GONE is an unplug');

  // a Wooting style board: its config channel plus two listened-to collections, opened only on request
  const reads = [];
  answer = (chan, cmd) => {
    if (cmd === 'OPEN') return chan.includes(':FF54:') ? 'NODEVICE' : 'OK';
    if (cmd.startsWith('READ')) return reads.length ? reads.shift() : 'NONE';
    return 'NONE';
  };
  const extra = [{ name: 'analog-v1', page: 'FF54', usage: '*', len: 256 }, { name: 'analog-v2', page: 'FF53', usage: '*', len: 256 }];
  host.addSpec({ id: 'woot', vid: '31e3', pid: '1310', page: '1337', usage: '*', len: 256, reportId: 0, reply: 'raw', replyMs: 1000, extra });
  check(host.SPECS.at(-1).opts === ':rw=1', `extra changes nothing about the main channel (${host.SPECS.at(-1).opts})`);
  n = lines.length;
  const wo = await host.provider([{ vendorId: 0x31e3, productId: 0x1310, usagePage: 0x1337 }]);
  check(since(n).length === 1 && since(n)[0] === 'hid:31E3:1310:1337:*:256:0:rw=1 OPEN', `opening the board opens only its config channel (${since(n).join(' / ')})`);
  const v1 = wo.extraChannel('analog-v1'), v2 = wo.extraChannel('analog-v2');
  check(since(n).length === 1, 'asking for an extra channel opens nothing yet');
  check(typeof v2.sendReport === 'undefined' && typeof v2.sendFeatureReport === 'undefined' && Object.keys(v2).sort().join() === 'close,name,open,opened,receiveReports,spec', 'an extra channel can only be read');
  n = lines.length;
  check((await v1.open()) === false && since(n)[0] === 'hid:31E3:1310:FF54:*:256:0:rw=1 OPEN', `a page the board lacks does not open (${since(n)[0]})`);
  n = lines.length;
  reads.push('00 04 00 80|00 05 00 40');
  const got = await v2.receiveReports(60);
  check(since(n)[0] === 'hid:31E3:1310:FF53:*:256:0:rw=1 OPEN' && since(n)[1] === 'hid:31E3:1310:FF53:*:256:0:rw=1 READ 60', `the extra opens on its first read, same pid, its own page (${since(n).join(' / ')})`);
  check(got.length === 2 && got[1].reportId === 0 && got[1].data.getUint8(2) === 0x40, 'its reports come back as { reportId, data }');
  check(!lines.some((l) => /:FF5[34]:.* (SEND|REQ|REQR|FSET|IGET|WATCH) /.test(l)), 'nothing but OPEN / READ / CLOSE ever reaches an extra collection');
  // the extra going away closes only it
  answer = (chan, cmd) => (chan.includes(':FF53:') && cmd.startsWith('READ') ? 'GONE' : cmd === 'OPEN' ? 'OK' : 'NONE');
  const ge = await throws(() => v2.receiveReports(10));
  check(ge && ge.gone && !v2.opened && wo.opened && !gone.includes('woot'), 'GONE on the extra closes the extra only; the board stays open, no gone event');
  await v2.open();
  n = lines.length;
  wo.close();
  check(since(n).some((l) => l === 'hid:31E3:1310:FF53:*:256:0:rw=1 CLOSE') && since(n).some((l) => l === 'hid:31E3:1310:1337:*:256:0:rw=1 CLOSE'), 'closing the board closes its extra too');
  n = lines.length;
  check((await v2.open()) === false && since(n).length === 0, 'an extra does not open while the board is closed');
}

// ---- 8. the never list in the send path (22 Oct 2026, safety round 2; helpers/never-guard.mjs): a library or my-devices
// channel refuses a listed command before any byte goes out; the built-in mouse and keyboard are never checked ----
{
  const { neverHit } = await import('../helpers/never-guard.mjs');
  answer = (chan, cmd) => (cmd === 'OPEN' ? 'OK' : cmd.startsWith('WATCH') ? 'OK' : cmd.startsWith('FSET') ? 'OK' : cmd.startsWith('SEND') ? 'OK' : cmd.startsWith('REQ') ? '00 00' : 'NONE');
  check(!host.SPECS.slice(0, 2).some((s) => s.never), 'the Pulsar mouse and P75 keyboard channels carry no never mark');
  // Glorious DFU (report 5, 75), on a featureOnly library channel: refused, nothing sent
  host.addSpec({ id: 'never-glorious', vid: '258A', pid: '0036', page: 'FF00', usage: '*', featureOnly: true, len: 64, reportId: 0 });
  const gl = await host.provider([{ vendorId: 0x258a, productId: 0x0036 }]);
  let n = lines.length;
  const e1 = await throws(() => gl.sendFeatureReport(5, [0x75, 0, 0]));
  check(e1?.never && /never list/.test(e1.message) && /firmware update/i.test(e1.message) && !since(n).some((l) => /FSET/.test(l)), `a Glorious DFU feature report is refused before any byte goes out (${e1?.message})`);
  n = lines.length;
  await gl.sendFeatureReport(5, [0x04, 0, 0]);
  check(since(n).some((l) => / FSET 05 04 00 00$/.test(l)), 'another feature report on the same channel goes out unchanged');
  // Wooting ResetToBootloader on a raw channel, Razer factory mode on an output report: refused
  host.addSpec({ id: 'never-wooting', vid: '31E3', pid: '1310', page: '1337', usage: '*', len: 256, reportId: 0, reply: 'raw', replyMs: 0 });
  const wt = await host.provider([{ vendorId: 0x31e3, productId: 0x1310, usagePage: 0x1337 }]);
  n = lines.length;
  const e2 = await throws(() => wt.sendReport(0, [0xd0, 0xda, 0x02, 0x00]));
  check(e2?.never && !since(n).some((l) => /SEND|REQ/.test(l)), `a Wooting bootloader command on a raw channel is refused (${e2?.message})`);
  host.addSpec({ id: 'never-razer', vid: '1532', pid: '00B7', page: 'FF00', len: 90, reportId: 0 });
  const rz = await host.provider([{ vendorId: 0x1532, productId: 0x00b7 }]);
  n = lines.length;
  const e3 = await throws(() => rz.sendReport(0, [0x00, 0x1f, 0, 0, 0, 0x02, 0x00, 0x04, 0x02]));
  check(e3?.never && !since(n).some((l) => /REQ/.test(l)), `a Razer factory-mode request is refused (${e3?.message})`);
  n = lines.length;
  await rz.sendReport(0, [0x00, 0x1f, 0, 0, 0, 0x02, 0x00, 0x04, 0x03]);
  check(since(n).some((l) => / REQ .* 00 1f 00 00 00 02 00 04 03$/.test(l)), 'Razer device mode 03 (the normal one) goes out unchanged');
  // the same bytes on DeviceHub's own channels: never checked, sent exactly as before
  n = lines.length;
  const kb2 = await host.provider([{ vendorId: 0x342d, productId: 0xe479, usagePage: 0xff60, usage: 0x61 }]);
  n = lines.length;
  await kb2.sendReport(0, [0x0b, 0x00]);   // would match the VIA bootloader entry on a library FF60 channel
  check(/^hid:342D:E479:FF60:0061:32:0 REQ \d+ 750 0b 00$/.test(since(n).at(-1) || ''), `the P75's own channel is never checked: its bytes go out unchanged (${since(n).at(-1)})`);
  kb2.close();
  const mouse2 = await host.provider([{ vendorId: 0x3710, usagePage: 0xff02 }]);
  n = lines.length;
  await mouse2.sendReport(8, [0x04, 0, 0, 0x49]);
  check(/REQ 1 900 04 00 00 49$/.test(since(n).at(-1) || ''), `the Pulsar mouse's request is unchanged (${since(n).at(-1)})`);
  mouse2.close(); clearTimeout(mouse2.watch); mouse2.watch = null;
  // the HS80 never goes through hid-host (helpers/hs80-direct.js, its own hs80: channel), so nothing here can block it
  check(!host.SPECS.some((s) => s.vid === '1B1C' && ['0A6B', '0A69', '0A71'].includes(s.pid)), 'no hid-host channel is the HS80 (it has its own path)');
  // the matcher itself
  check(neverHit({ vid: '03F0', pid: '0696', page: 'FF90', reportId: 102, bytes: [0x1e] })?.brand === 'HyperX' && !neverHit({ vid: '03F0', pid: '0696', page: 'FF90', reportId: 6, bytes: [0x1e] }), 'a report-id entry matches only on its report id');
  check(neverHit({ vid: '1234', pid: '0001', page: 'FF60', bytes: [0x0b] })?.brand.startsWith('VIA') && !neverHit({ vid: '1234', pid: '0001', page: 'FF00', bytes: [0x0b] }) && !neverHit({ vid: '1234', pid: '0001', page: '*', bytes: [0x0b] }), 'a page entry (VIA FF60) applies only on that page');
  check(neverHit({ vid: '1038', pid: '183A', bytes: [0x11] }) && !neverHit({ vid: '1038', pid: '1234', bytes: [0x11] }), 'a pids entry applies only to its product ids; missing bytes count as the zeros the helper pads with');
  check(neverHit({ vid: '2516', pid: '0173', bytes: [0x00, 0x00, 0xb0] }) && !neverHit({ vid: '2516', pid: '0173', bytes: [0x00, 0x00, 0x00, 0x00, 0xb0] }), '"within" lets a pattern start a few bytes later, no further');
}

console.log(fails.length ? `hid-core: FAILED: ${fails.join('; ')}` : 'hid-core (never list in the send path, several pids, interface/length matching, report ids, raw replies, refused vs gone, input reports on request, extra collections, defaults unchanged): all good');
process.exit(fails.length ? 1 : 0);
