// Sound to the headset when it turns on (27 Oct 2026; helpers/headset-sound.mjs), with stand-ins: no Windows sound
// touched. A real off -> on moves the default speaker and mic once; a blip under 10 s, DeviceHub's start, a headset that
// is the default already, and the setting switched off move nothing.
// Run: node tests/headset-sound.mjs
import { headsetSound } from '../helpers/headset-sound.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

const OUT = '{0.0.0.00000000}.{hs80-out}', MIC = '{0.0.1.00000000}.{hs80-mic}', CABLE = '{0.0.0.00000000}.{hs80-cable}';
function rig({ defaults = { playback: 'speakers', recording: 'webcam' }, settings = {}, cable = false, generic = null } = {}) {
  let t = 1000;
  const calls = [], logs = [];
  const win = { defaults: { ...defaults } };
  const call = async (action, body) => {
    calls.push([action, body]);
    if (action === 'hs80-endpoints') return { ok: true, defaults: { ...win.defaults }, endpoints: [
      { flow: 'playback', id: OUT, state: 1, name: 'HS80 Wireless', wireless: true },
      { flow: 'playback', id: CABLE, state: cable ? 1 : 4, name: 'Headset Earphone', wired: true },
      { flow: 'recording', id: MIC, state: 1, name: 'HS80 Wireless', wireless: true }] };
    if (action === 'set-default') { win.defaults[body.flow ? 'recording' : 'playback'] = body.id; return { ok: true, now: body.id }; }
    throw new Error(`unexpected ${action}`);
  };
  const hs = headsetSound({ call, log: (text, kind) => logs.push([text, kind]), readSettings: () => settings, now: () => t, wait: async () => {} });
  const dev = (status) => ({ status, adapter: { title: 'Corsair HS80', generic } });
  return { hs, calls, logs, win, sets: () => calls.filter(([a]) => a === 'set-default'), at: (s) => { t += s * 1000; }, dev };
}

// DeviceHub starts with the headset on: connecting -> connected, nothing moved
{
  const r = rig();
  await r.hs.seen(r.dev('connecting'));
  await r.hs.seen(r.dev('connected'));
  check(!r.calls.length, `nothing on start: ${JSON.stringify(r.calls)}`);
  // a quick drop at start (missing 3 s) is not a turn-on either
  r.at(1); await r.hs.seen(r.dev('missing')); r.at(15); await r.hs.seen(r.dev('connected'));
  check(!r.calls.length, 'an off seen in the first 30 s after start moves nothing');
}

// a real turn-on: off for a minute, then on -> speaker and mic moved once, one activity line
{
  const r = rig();
  await r.hs.seen(r.dev('connected'));
  r.at(60); await r.hs.seen(r.dev('asleep'));
  r.at(60); await r.hs.seen(r.dev('connected'));
  const s = r.sets();
  check(s.length === 2, `two set-default calls: ${JSON.stringify(s)}`);
  check(s.some(([, b]) => b.id === OUT && b.flow === 0) && s.some(([, b]) => b.id === MIC && b.flow === 1), 'the speaker (render) and the mic (capture) both moved');
  check(r.logs.length === 1 && r.logs[0][0] === 'Sound moved to HS80 Wireless' && r.logs[0][1] === 'good', `one line: ${JSON.stringify(r.logs)}`);
  // more changes while it stays on (battery reads) move nothing again
  r.at(5); await r.hs.seen(r.dev('connected')); await r.hs.seen(r.dev('connected'));
  check(r.sets().length === 2 && r.logs.length === 1, 'switches once per turn-on');
  // turned off: nothing switched back
  r.at(5); await r.hs.seen(r.dev('asleep'));
  check(r.sets().length === 2, 'nothing on turn-off');
}

// a blip under 10 s: no switch
{
  const r = rig();
  await r.hs.seen(r.dev('connected'));
  r.at(60); await r.hs.seen(r.dev('asleep'));
  r.at(4); await r.hs.seen(r.dev('connecting'));
  r.at(2); await r.hs.seen(r.dev('connected'));
  check(!r.calls.length, `a 6 s blip moves nothing: ${JSON.stringify(r.calls)}`);
  // missing counts as off the same way, and the off time runs from when it first went off
  r.at(30); await r.hs.seen(r.dev('missing')); r.at(5); await r.hs.seen(r.dev('asleep')); r.at(6); await r.hs.seen(r.dev('connected'));
  check(r.sets().length === 2, 'off 11 s (missing then asleep) is a turn-on');
}

// already the default: nothing set, nothing logged
{
  const r = rig({ defaults: { playback: OUT, recording: MIC } });
  r.at(60); await r.hs.seen(r.dev('asleep')); r.at(60); await r.hs.seen(r.dev('connected'));
  check(r.calls.some(([a]) => a === 'hs80-endpoints') && !r.sets().length && !r.logs.length, `already default: ${JSON.stringify(r.calls)} ${JSON.stringify(r.logs)}`);
}
// only the mic was elsewhere: only the mic moves
{
  const r = rig({ defaults: { playback: OUT, recording: 'webcam' } });
  r.at(60); await r.hs.seen(r.dev('asleep')); r.at(60); await r.hs.seen(r.dev('connected'));
  check(r.sets().length === 1 && r.sets()[0][1].id === MIC && r.sets()[0][1].flow === 1, `only the mic: ${JSON.stringify(r.sets())}`);
}

// the setting off: nothing at all; on again (or never set): it switches
{
  const settings = { headsetSoundSwitch: false };
  const r = rig({ settings });
  r.at(60); await r.hs.seen(r.dev('asleep')); r.at(60); await r.hs.seen(r.dev('connected'));
  check(!r.calls.length, 'the setting off: nothing asked or set');
  settings.headsetSoundSwitch = true;
  r.at(60); await r.hs.seen(r.dev('asleep')); r.at(60); await r.hs.seen(r.dev('connected'));
  check(r.sets().length === 2, 'the setting on: it switches');
}

// on its cable: the cable's speaker is the one picked (as audio-follow does)
{
  const r = rig({ cable: true });
  r.at(60); await r.hs.seen(r.dev('missing')); r.at(60); await r.hs.seen(r.dev('connected'));
  check(r.sets().some(([, b]) => b.id === CABLE && b.flow === 0), `cable speaker: ${JSON.stringify(r.sets())}`);
}

// another USB headset: asked by its USB id; a headphone-jack headset is never touched
{
  const r = rig({ generic: { usb: 'VID_1234&PID_ABCD' } });
  r.at(60); await r.hs.seen(r.dev('missing')); r.at(60); await r.hs.seen(r.dev('connected'));
  check(r.calls[0]?.[1]?.usb === 'VID_1234&PID_ABCD', `generic by usb: ${JSON.stringify(r.calls[0])}`);
  const j = rig({ generic: { usb: 'JACK:Speakers' } });
  j.at(60); await j.hs.seen(j.dev('missing')); j.at(60); await j.hs.seen(j.dev('connected'));
  check(!j.calls.length, 'a jack headset is left alone');
}

// a set-default Windows does not take: one "could not" line
{
  const r = rig();
  const hs = headsetSound({ call: async (a) => (a === 'hs80-endpoints' ? { defaults: {}, endpoints: [{ flow: 'playback', id: OUT, state: 1, name: 'HS80 Wireless', wireless: true }] } : { now: 'speakers' }),
    log: (text, kind) => r.logs.push([text, kind]), readSettings: () => ({}), now: (() => { let t = 0; return () => (t += 40000); })(), wait: async () => {} });
  await hs.seen({ status: 'asleep' }); await hs.seen({ status: 'connected', adapter: {} });
  check(r.logs.length === 1 && /^Could not move sound to HS80 Wireless$/.test(r.logs[0][0]) && r.logs[0][1] === 'bad', `failure line: ${JSON.stringify(r.logs)}`);
}

// the source: no polling, no timers of its own beyond the short wait for Windows' list
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../helpers/headset-sound.mjs', import.meta.url), 'utf8');
check(!/setInterval/.test(src), 'no polling in headset-sound.mjs');
const agent = fs.readFileSync(new URL('../helpers/agent.mjs', import.meta.url), 'utf8');
check(/headsetSound\(/.test(agent) && /id === 'headset'/.test(agent), 'the agent feeds the headset changes in');

if (fails.length) { console.error(`headset-sound: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('headset-sound: all checks passed');
