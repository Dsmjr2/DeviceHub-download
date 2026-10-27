// The window's one live stream (27 Oct 2026; public/core/events.js, helpers/window-events.js, server.js /api/events):
// an open, idle window asks DeviceHub for nothing it can be told. Offline: a pretend EventSource and clock, a pretend
// response, and a real folder watch in a temp folder. Then, when DeviceHub runs on this PC, its own stream: hello first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const we = require('../helpers/window-events.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the server's hub ----------
{
  const hub = we.createHub();
  const a = { out: '', write(s) { this.out += s; } }, b = { out: '', write(s) { this.out += s; } };
  const dead = { write() { throw new Error('gone'); } };
  const offA = hub.add(a); hub.add(b); hub.add(dead);
  hub.push('power', { saving: true });
  check(a.out === 'event: power\ndata: {"saving":true}\n\n' && b.out === a.out, 'a pushed event reaches every open stream as one SSE frame');
  check(hub.count() === 2, 'a stream whose write fails is dropped');
  offA(); hub.push('backup', { at: null });
  check(!a.out.includes('backup') && b.out.includes('event: backup'), 'a closed stream gets nothing more');
}

// ---------- the folder watch and the newest backup ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-events-'));
  try {
    check(we.lastBackupAt(dir) === null, 'no backups: no time');
    let n = 0;
    const stop = we.watchFolder(dir, () => { n++; }, { waitMs: 100 });
    fs.writeFileSync(path.join(dir, 'mouse-1.json'), '{}'); fs.writeFileSync(path.join(dir, 'mouse-2.json'), '{}');
    for (let i = 0; i < 40 && !n; i++) await sleep(50);
    await sleep(250);
    check(n === 1, `files landing together are told once, after they settle (told ${n} times)`);
    check(typeof we.lastBackupAt(dir) === 'string', 'the newest backup has a time');
    stop();
    fs.writeFileSync(path.join(dir, 'mouse-3.json'), '{}'); await sleep(300);
    check(n === 1, 'a stopped watch tells nothing');
    check(typeof we.watchFolder(path.join(dir, 'missing'), () => {}) === 'function', 'a folder that cannot be watched does not throw');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------- the window's side ----------
{
  class FakeES {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2; static all = [];
    constructor(url) { this.url = url; this.readyState = 0; this.ls = {}; FakeES.all.push(this); }
    addEventListener(t, f) { (this.ls[t] ||= []).push(f); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(t, d) { for (const f of this.ls[t] || []) f({ data: JSON.stringify(d) }); }
  }
  const ticks = [];
  const ev = await import(new URL('../public/core/events.js', import.meta.url));
  const got = [];
  let opens = 0;
  ev.onEvent('device', (d) => got.push(d.id));
  ev.onOpen(() => { opens++; });
  check(ev.streamUp() === false, 'not open before it starts');
  check(ev.startEvents({ ES: FakeES, setI: (f, ms) => ticks.push({ f, ms }) }) === true, 'it starts');
  check(ev.startEvents({ ES: FakeES, setI: (f) => ticks.push({ f }) }) === false && FakeES.all.length === 1, 'started twice: still one stream');
  const one = FakeES.all[0];
  check(one.url === '/api/events', 'the stream is GET /api/events');
  one.open();
  check(opens === 1 && ev.streamUp(), 'opened: the window reads its full state once');
  one.send('device', { id: 'mouse' });
  one.send('hello', { version: 'v1', saving: false });
  const late = [];
  ev.onEvent('hello', (x) => late.push(x.version));
  check(late[0] === 'v1', 'a hello listener added after the hello gets it at once');
  ev.onEvent('power', () => { throw new Error('x'); });
  let ok = true; try { one.send('power', { saving: true }); one.ls.device[0]({ data: 'not json' }); } catch { ok = false; }
  check(ok, 'a listener that throws, or a broken event, breaks nothing');
  // the browser gave up (an error answer during a restart): replaced on the next 5 s look, listeners and all
  check(ticks.length === 1 && ticks[0].ms === 5000, 'one 5 s look for a stream the browser gave up on');
  ticks[0].f();
  check(FakeES.all.length === 1, 'an open stream is left alone');
  one.readyState = 0; ticks[0].f();
  check(FakeES.all.length === 1 && !ev.streamUp(), 'a stream the browser is retrying is left to it (and is not up)');
  one.readyState = 2; ticks[0].f();
  const two = FakeES.all[1];
  check(!!two, 'a closed stream is replaced');
  two.open(); two.send('device', { id: 'headset' }); two.send('hello', { version: 'v2' });
  check(opens === 2 && got.join() === 'mouse,headset' && late.join() === 'v1,v2', 'the new stream has every listener, and reads the full state again');
}

// ---------- what the window no longer asks for ----------
{
  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^\s*\/\/[^\n]*/gm, '');
  const app = src('public/app.js');
  for (const r of ['/api/power', '/api/backups', '/api/update-notice']) check(!app.includes(`'${r}'`), `app.js does not ask for ${r} (it comes on the stream)`);
  check(/if \(streamUp\(\)\) return reloadIfNew\(\);\s*\/\/[^\n]*\n\s*try \{ sawVersion\(\(await \(await fetch\('\/api\/version'\)\)/.test(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8')), 'the version is asked for only while the stream is not open');
  check(/onEvent\('hello'/.test(app) && /onEvent\('version'/.test(app) && /onEvent\('power'/.test(app) && /onEvent\('backup'/.test(app) && /onEvent\('notice'/.test(app), 'app.js listens for hello, version, power, backup and notice');
  check(/if \(!DEMO\) startEvents\(\);/.test(app), 'demo mode opens no stream');
  const dev = src('public/core/devices.js');
  check(!/new EventSource/.test(dev) && /startEvents\(\)/.test(dev) && /onOpen\(/.test(dev), 'the devices use the same one stream, and read the full state on each open');
  const server = src('server.js');
  check(/url\.pathname === '\/api\/events'/.test(server) && /frame\('hello', helloNow\(\)\)/.test(server), 'server.js has /api/events, hello first');
  check(/hub\.push\('version'/.test(server) && /hub\.push\('backup'/.test(server) && /hub\.push\('power'/.test(server) && /hub\.push\('notice'/.test(server), 'server.js pushes version, backup, power and notice');
}

// ---------- the running DeviceHub's own stream (skipped when it is not running, or older) ----------
{
  const PORT = Number(process.env.DEVICEHUB_PORT || 5577);
  let version = null;
  try { version = (await (await fetch(`http://127.0.0.1:${PORT}/api/version`)).json()).version; } catch {}
  if (!version) console.log(`events: live part skipped (DeviceHub is not running on port ${PORT})`);
  else {
    const r = await new Promise((resolve) => {
      let buf = '';
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/events', timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); req.destroy(); return resolve({ status: res.statusCode }); }
        res.setEncoding('utf8');
        res.on('data', (c) => { buf += c; const m = /event: hello\ndata: ([^\n]*)\n\n/.exec(buf); if (m) { req.destroy(); resolve({ status: 200, type: res.headers['content-type'], hello: JSON.parse(m[1]) }); } });
      });
      req.on('timeout', () => { req.destroy(); resolve({ status: 'timeout' }); });
      req.on('error', () => resolve({ status: 'error' }));
    });
    if (r.status === 404) console.log('events: live part skipped (the running DeviceHub has no /api/events yet: restart it)');
    else {
      check(r.status === 200 && /text\/event-stream/.test(r.type || ''), `the running DeviceHub answers /api/events with a stream (got ${r.status})`);
      check(r.hello?.version === version, 'its first event is hello, with the same version /api/version says');
      check(r.hello && 'saving' in r.hello && 'backupAt' in r.hello && 'notice' in r.hello, 'hello carries saving, backupAt and notice');
    }
  }
}

if (fails.length) { console.log(`events: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('events: one stream, hello first, changes pushed, nothing polled for them');
