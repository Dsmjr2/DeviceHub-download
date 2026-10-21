// Unplug and sleep while DeviceHub writes (20 Oct 2026). Needs the person: it waits for each step and prints what to
// do. Writes only values it puts back: one unused key on the keyboard's Layer 4 (row 0, col 1) and the headset volume
// (60 <-> 58); the whole keymap is compared with a snapshot at the end. Run: node tests/unplug-test.mjs
const B = 'http://127.0.0.1:5577';
const H = { 'Content-Type': 'application/json', Origin: B };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(); const ts = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s`;
const say = (s) => console.log(`${ts()}  ${s}`);
const state = async () => (await (await fetch(`${B}/api/agent/state`)).json()).devices;
const dev = async (id) => (await state()).find((d) => d.id === id);
const write = async (id, key, value) => { try { return await (await fetch(`${B}/api/agent/write`, { method: 'POST', headers: H, body: JSON.stringify({ id, key, value, label: 'Unplug test', display: String(value), silent: true }) })).json(); } catch (e) { return { error: e.message }; } };
const results = [];
const report = (name, ok, detail) => { results.push({ name, ok }); say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`); };
const waitFor = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await f()) return true; } catch {} await sleep(300); } return false; };

// ---- keyboard: a key on Layer 4 written back and forth while the cable is pulled
{
  const k0 = await dev('keyboard');
  if (k0.status !== 'connected') { say('keyboard not connected: skipped'); }
  else {
    const snap = JSON.stringify(k0.adapter.session.keymap), key0 = k0.adapter.session.keymap[4][0][1];
    say(`KEYBOARD: unplug the keyboard's USB cable now (any time in the next 3 minutes), then plug it back in.`);
    let n = 0, errs = 0, lastErr = '', flip = false;
    const pulled = await waitFor(async () => {
      // one write a second: each goes into the keyboard's memory chip, so a slow unplug costs little wear
      await sleep(700);
      flip = !flip; const r = await write('keyboard', 'key:4:0:1', flip ? 0x04 : key0); n++;
      if (r.error) { errs++; lastErr = r.error; }
      return (await dev('keyboard')).status !== 'connected';
    }, 180000);
    if (!pulled) report('keyboard unplugged during writes', false, 'no unplug seen within 3 minutes');
    else {
      say(`keyboard gone after ${n} writes (${errs} refused${lastErr ? `: "${lastErr}"` : ''}). Plug it back in.`);
      const back = await waitFor(async () => (await dev('keyboard')).status === 'connected', 180000);
      report('keyboard reconnects by itself', back, back ? 'connected again' : 'not back within 3 minutes');
      if (back) {
        await sleep(2500);
        const mid = (await dev('keyboard')).adapter.session.keymap[4][0][1];
        report('keyboard key after the unplug is a whole value', mid === key0 || mid === 0x04, `Layer 4 key reads ${mid} (either ${key0} or 4 is whole)`);
        const r = await write('keyboard', 'key:4:0:1', key0);
        const end = (await dev('keyboard')).adapter.session.keymap;
        report('keyboard keymap exactly as before', !r.error && JSON.stringify(end) === snap, r.error ? r.error : 'every key on every layer matches the snapshot');
      }
    }
  }
}

// ---- headset: volume written back and forth while the receiver is pulled
{
  const h0 = await dev('headset');
  if (h0.status !== 'connected') { say('headset not connected: skipped'); }
  else {
    const vol0 = h0.values['vol:playback'];
    say(`HEADSET: unplug the headset's USB receiver now, then plug it back in.`);
    let n = 0, errs = 0, flip = false;
    const pulled = await waitFor(async () => {
      flip = !flip; const r = await write('headset', 'vol:playback', flip ? vol0 - 2 : vol0); n++; if (r.error) errs++;
      return (await dev('headset')).status !== 'connected';
    }, 180000);
    if (!pulled) report('receiver unplugged during writes', false, 'no unplug seen within 3 minutes');
    else {
      say(`receiver gone after ${n} writes (${errs} refused). Plug it back in.`);
      const back = await waitFor(async () => (await dev('headset')).status === 'connected', 180000);
      report('headset reconnects by itself', back, back ? 'connected again' : 'not back within 3 minutes');
      if (back) {
        await sleep(4000);
        const r = await write('headset', 'vol:playback', vol0);
        const v = (await dev('headset')).values['vol:playback'];
        report('headset volume put back', !r.error && Math.abs(v - vol0) <= 1, `${v}% (was ${vol0}%)`);
        const eq = await (await fetch(`${B}/api/eq`)).json();
        report('Equalizer APO still on for the headset', !(eq.notOn || []).length, (eq.notOn || []).length ? `not on: ${eq.notOn.map((d) => d.name).join(', ')}` : 'on for its sound devices');
      }
    }
  }
}

// ---- sleep: the gap in time while the PC sleeps, then everything back
{
  say('SLEEP: put the PC to sleep now (Start > Power > Sleep), wait about 10 seconds, then wake it.');
  let last = Date.now(), gap = 0;
  const slept = await waitFor(async () => { const now = Date.now(); gap = now - last; last = now; return gap > 8000; }, 300000);
  if (!slept) report('PC slept', false, 'no sleep seen within 5 minutes');
  else {
    say(`woke after about ${Math.round(gap / 1000)} s asleep; waiting for the devices`);
    const up = await waitFor(async () => (await fetch(`${B}/api/version`)).ok, 30000);
    report('DeviceHub answers after waking', up);
    for (const id of ['keyboard', 'headset']) {
      const ok = await waitFor(async () => (await dev(id)).status === 'connected', 30000);
      report(`${id} back after waking`, ok, ok ? 'connected' : 'not connected within 30 s');
    }
    const m = await dev('mouse'); say(`(mouse: ${m.status}; it sleeps on its own after 20 s, so "asleep" is normal)`);
    const hp = await (await fetch(`${B}/api/health`)).json();
    report('device helper alive after waking', hp.helperMB > 0, `${hp.helperMB} MB`);
  }
}

const failed = results.filter((r) => !r.ok);
say(`${results.length - failed.length} of ${results.length} passed${failed.length ? '; failed: ' + failed.map((f) => f.name).join(', ') : ''}`);
process.exit(0);
