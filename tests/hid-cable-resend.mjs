// Offline test (15 Nov 2026): the mouse's cable pulled during a request. A read (spec.resend) is asked again over the
// dongle; a write is never sent twice: it fails with an error that is not "gone", so nothing queues it to resend.
// A stand-in replaces native.request: no helper, no device.
import { createRequire } from 'node:module';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

const native = createRequire(import.meta.url)('../helpers/native.js');
const calls = [];
let cableIn = true;
native.request = async (chan, cmd) => {
  calls.push(`${chan} ${cmd}`);
  if (chan.includes(':3506:') && cmd === 'OPEN') return cableIn ? 'OK' : 'NONE';
  if (cmd === 'OPEN' || cmd === 'CLOSE' || cmd.startsWith('WATCH')) return 'OK';
  if (chan.includes(':3506:') && cmd.startsWith('REQ ')) return 'GONE';
  return '08 00 00 00 02 01 54 00 00 00 00 00 00 00 00 00';
};
native.onEvent = () => {};

const host = await import('../helpers/hid-host.mjs');
const moved = [];
const gone = [];
host.setMovedHandler((id) => moved.push(id));
host.setGoneHandler((id) => gone.push(id));

const mouse = await host.provider([{ vendorId: 0x3710, usagePage: 0xff02 }]);
check(mouse && mouse.onCable, 'mouse opened on the cable');

const reqs = (from) => calls.slice(from).filter((c) => / REQ /.test(c));

// a write (writeFlash 07): sent once, then a "may have been applied" error, not gone
let start = calls.length;
let err = null;
try { await mouse.sendReport(8, [0x07, 0, 0, 0x49, 2, 1, 0x54]); } catch (e) { err = e; }
check(reqs(start).length === 1, `write sent once, not again over the dongle (sent ${reqs(start).length})`);
check(err && !err.gone && err.maybeSent === true, 'write fails with maybeSent, not gone');
check(err && /^the cable was unplugged during this change, so it may or may not have been applied/.test(err.message), 'the write error says the cable, not the dongle, and that it may have been applied');
check(err && !/asleep|out of range|no reply|did not answer|is it on|not connected/i.test(err.message), 'the error is not one devices.js would queue to resend');
check(!mouse.onCable && mouse.opened, 'moved to the dongle and still open');
check(moved.includes('mouse'), 'moved handler fired (it reads the mouse again)');
check(!gone.length, 'not marked unplugged');

// a read (readFlash 08) after the cable is plugged in again: asked again over the dongle and answered
cableIn = true;
mouse.cableCheckAt = 0;
start = calls.length;
let got = null;
const listen = (e) => { got = e; };
mouse.addEventListener('inputreport', listen);
err = null;
try { await mouse.sendReport(8, [0x08, 0, 0, 0x49, 2]); } catch (e) { err = e; }
await new Promise((r) => setTimeout(r, 10));
mouse.removeEventListener('inputreport', listen);
const r2 = reqs(start);
check(!err, `read did not throw (${err && err.message})`);
check(r2.length === 2 && r2[0].includes(':3506:') && !r2[1].includes(':3506:'), 'read went to the cable, then once more over the dongle');
check(got && got.data.getUint8(0) === 0x08, 'read answered from the dongle');

// the cable gone and no dongle either: gone, as before
cableIn = true;
mouse.cableCheckAt = 0;
const realReq = native.request;
native.request = async (chan, cmd) => (chan.includes(':3506:') ? realReq(chan, cmd) : cmd === 'OPEN' ? 'NONE' : realReq(chan, cmd));
err = null;
try { await mouse.sendReport(8, [0x08, 0, 0, 0x49, 2]); } catch (e) { err = e; }
check(err && err.gone === true, 'no dongle either: gone');
check(gone.includes('mouse'), 'gone handler fired');

if (mouse.watch) { clearTimeout(mouse.watch); mouse.watch = null; }
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`hid-cable-resend: all ${n} passed`);
process.exit(0);
