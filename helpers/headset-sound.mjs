// Sound to the headset when it turns on (27 Oct 2026, Shawn: "only i want to be in place so it switches to the headset
// when its turned on nothing else"). When the headset goes from off (asleep or missing) to connected, Windows' default
// speaker and mic become the headset's, all three roles (the helper's set-default, helpers/audio-default.cs SetDefault).
// Nothing else: no switching back when it turns off (Windows picks the next device itself), no polling (it runs only on
// the agent's device changes), nothing on DeviceHub's start, on a blip under 10 s, or when the headset is the default
// already. Settings "Switch sound to the headset when it turns on" (settings.json "headsetSoundSwitch", on unless false).
const FLOWS = ['playback', 'recording'];

// call(action, body): the Corsair helper (helpers/corsair.js handle); log(text, kind); readSettings() -> settings.json
export function headsetSound({ call, log, readSettings, now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)), blipMs = 10000, startMs = 30000, tries = [0, 2000, 5000] }) {
  const started = now();
  let offSince = null, busy = false;

  // the headset's live sound devices, per flow: the cable's when it is live (as helpers/audio-follow.js), else the receiver's
  async function endpoints(usb) {
    const r = await call('hs80-endpoints', usb ? { usb } : {});
    const want = {};
    for (const flow of FLOWS) {
      const live = (r.endpoints || []).filter((e) => e.flow === flow && e.state === 1);
      want[flow] = live.find((e) => e.wired) || live.find((e) => e.wireless) || live[0] || null;
    }
    return { want, defaults: r.defaults || {} };
  }

  async function move(dev) {
    if (busy) return null;
    busy = true;
    try {
      // a USB headset other than the HS80 by its USB id; a jack headset has no "on" and is left alone
      const usb = dev?.adapter?.generic?.usb;
      if (usb && !/^VID_[0-9A-F]{4}&PID_[0-9A-F]{4}$/i.test(usb)) return null;
      // Windows may list the headset's sound devices a moment after the headset answers: a few looks, then give up
      let found = null;
      for (const ms of tries) {
        if (ms) await wait(ms);
        try { found = await endpoints(usb); } catch { found = null; }
        if (found && (found.want.playback || found.want.recording)) break;
      }
      if (!found || !(found.want.playback || found.want.recording)) return null;
      const moved = [], failed = [];
      for (const [i, flow] of FLOWS.entries()) {
        const w = found.want[flow];
        if (!w || found.defaults[flow] === w.id) continue;
        let ok = false;
        try { ok = (await call('set-default', { id: w.id, flow: i })).now === w.id; } catch {}
        (ok ? moved : failed).push(w);
      }
      const name = (found.want.playback || found.want.recording).name || dev?.adapter?.title || 'the headset';
      if (failed.length) log(`Could not move sound to ${name}`, 'bad');
      else if (moved.length) log(`Sound moved to ${name}`, 'good');
      return { moved: moved.map((e) => e.id), failed: failed.map((e) => e.id) };
    } finally { busy = false; }
  }

  // every headset change from the agent (core.onChange): only an off -> on that lasted 10 s or more switches
  function seen(dev) {
    const s = dev?.status;
    if (s === 'asleep' || s === 'missing') { if (offSince == null) offSince = now(); return null; }
    if (s !== 'connected') return null;   // connecting, error, idle: neither on nor off
    const was = offSince;
    offSince = null;
    if (was == null || now() - was < blipMs || now() - started < startMs) return null;
    let set = {};
    try { set = readSettings() || {}; } catch {}
    if (set.headsetSoundSwitch === false) return null;
    return move(dev);
  }

  return { seen, move };
}
