// One HS80 in Windows at a time, and it is the default (Shawn, 19 Oct 2026: "I plug it in and it recognizes both and
// I have to change Discord AND my in-game headset").
//   - While the headset runs on its USB cable (HS80 Wired is live), HS80 Wireless is disabled, exactly like
//     "Disable" in Windows' sound settings, and HS80 Wired is made the default speaker and mic. An app that was
//     using HS80 Wireless falls back to the default, which is now the cable.
//   - When the cable connection ends, HS80 Wireless is enabled again and made the default.
// A dead headset plugged in to charge starts on the cable, which is the case this is for.
// Defaults are only moved when the connection changes, so picking another output by hand in between is left alone.
let call, log, timer, last = null, busy = false, ticks = 0, lastOut = null;
// Each connection has its own volume and mute in Windows (19 Oct 2026: the cable mic sat muted at 43% while the
// receiver mic was live at 50%, so Discord heard nothing after a switch). The last levels seen on the live
// connection are carried over to the other one when the headset switches.
const levels = { playback: null, recording: null };
let sidetone = null;  // { db, on } on the live connection, carried over the same way

const FLOWS = ['playback', 'recording'];

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const { endpoints, defaults } = await call('hs80-endpoints', {});
    const wired = Object.fromEntries(FLOWS.map((f) => [f, endpoints.find((e) => e.flow === f && e.wired && e.state === 1) || null]));
    // the receiver's endpoints: active (1), or disabled (2) by us while the cable was live
    const wireless = Object.fromEntries(FLOWS.map((f) => [f, endpoints.find((e) => e.flow === f && e.wireless && (e.state === 1 || e.state === 2)) || null]));
    const cable = !!(wired.playback || wired.recording);
    const changed = last !== null && last !== cable;
    for (const [i, flow] of FLOWS.entries()) {
      const w = wireless[flow];
      if (w && cable && w.state === 1) {
        const r = await call('set-enabled', { id: w.id, on: false });
        if (r.state === 2) log({ kind: 'info', device: 'headset', text: `HS80 Wireless ${flow === 'playback' ? 'sound' : 'mic'} hidden while the headset is on its cable` });
      } else if (w && !cable && w.state === 2) {
        const r = await call('set-enabled', { id: w.id, on: true });
        if (r.state === 1) log({ kind: 'info', device: 'headset', text: `HS80 Wireless ${flow === 'playback' ? 'sound' : 'mic'} back` });
      }
      // the default follows the live connection when it changes (and on DeviceHub's first look, if Windows has
      // fallen back to something else because one of the two just appeared or went away)
      const want = cable ? wired[flow] : wireless[flow];
      if (!want) continue;
      const hs80 = endpoints.some((e) => e.id === defaults[flow]);
      if (defaults[flow] === want.id || !(changed || (last === null && !hs80) || (hs80 && defaults[flow] !== want.id))) continue;
      const r = await call('set-default', { id: want.id, flow: i });
      log(r.now === want.id
        ? { kind: 'good', device: 'headset', text: `Windows ${flow === 'playback' ? 'sound' : 'mic'} now on ${want.name}` }
        : { kind: 'bad', device: 'headset', text: `Could not move Windows ${flow === 'playback' ? 'sound' : 'mic'} to ${want.name}` });
    }
    // Windows' speaker changed (its sound menu, or the HS80 switch above): apps that keep playing on the old one
    // (iTunes picks its speaker once at start) are moved to the new one and released at once, so nothing is pinned
    // (Shawn, 19 Oct 2026: "nothing should be pinned. I might use a different device on any app")
    const out = (await call('hs80-endpoints', {})).defaults.playback;
    if (lastOut && out && out !== lastOut) {
      try {
        const r = await call('follow', { id: out });
        if (r.moved?.length) log({ kind: 'info', text: `Moved ${[...new Set(r.moved)].join(', ')} to the new speaker` });
      } catch {}
    }
    lastOut = out;
    // levels and sidetone are remembered every 10 s (every 5th tick), and always right when the connection changes
    ticks++;
    const remember = changed || ticks % 5 === 1;
    let audio = [];
    if (remember) { try { audio = (await call('audio-list', { match: 'HS80' })).endpoints || []; } catch {} }
    if (changed && sidetone) {
      try {
        const r = await call('sidetone-set', { db: sidetone.db, on: sidetone.on });
        log({ kind: 'info', device: 'headset', text: `Sidetone set to match on ${cable ? 'HS80 Wired' : 'HS80 Wireless'}` });
        sidetone = { db: r.db, on: r.on };
      } catch {}
    } else if (!changed && remember) {
      try { const st = await call('sidetone', {}); if (st && st.db != null) sidetone = { db: st.db, on: st.on }; } catch {}
    }
    if (changed) {
      // carry the old connection's levels over to the new one
      for (const flow of FLOWS) {
        const to = (cable ? wired : wireless)[flow], lv = levels[flow];
        if (!to || !lv) continue;
        try {
          // the mic's mute is never carried over (19 Oct 2026: a muted cable mic left the wireless mic muted in Windows
          // for hours, so Discord heard nothing); its level is
          const r = await call('audio-set', flow === 'recording' ? { id: to.id, volume: lv.volume } : { id: to.id, volume: lv.volume, muted: lv.muted });
          log({ kind: 'info', device: 'headset', text: `${to.name} ${flow === 'playback' ? 'volume' : 'mic level'} set to match: ${r.volume}%${r.muted ? ', muted' : ''}` });
        } catch {}
      }
    } else {
      // remember the live connection's levels
      for (const flow of FLOWS) {
        const live = (cable ? wired : wireless)[flow];
        const a = live && audio.find((e) => e.id === live.id);
        if (a) levels[flow] = { volume: a.volume, muted: a.muted };
      }
    }

    // the headset changed connection: DeviceHub's own link to it (battery, mic light) follows
    if (changed) { try { await call('direct-reopen', {}); } catch {} }
    last = cable;
  } catch { /* the audio bridge is restarting; next tick */ } finally { busy = false; }
}

function start(corsairCall, logFn) { call = corsairCall; log = logFn; tick(); timer = setInterval(tick, 2000); }
function stop() { clearInterval(timer); }

module.exports = { start, stop };
