// The Overview's GPU temperature on the live stream (27 Oct 2026, Shawn: the open window still asked DeviceHub ~47 times
// in 10 minutes, 40 of them the GPU chip every 15 s). A window showing the chip says so once (POST /api/events/want);
// while at least one does, the card is read every 15 s (helpers/gpu.js, nvidia-smi) and only a changed temperature is
// sent. No window showing it: no reading at all. A closed stream stops wanting.
//   const w = createGpuWatch({ read })    w.want(id, on, send)   w.drop(id)   w.watching()
function createGpuWatch({ read, every = 15000, setI = setInterval, clearI = clearInterval }) {
  const wants = new Map();   // stream id -> send(data)
  let timer = null, last;    // last: { tempC } once read
  const tick = async () => {
    let tempC = null;
    try { tempC = (await read()).gpus?.[0]?.tempC ?? null; } catch {}
    if (last && last.tempC === tempC) return;
    last = { tempC };
    for (const send of wants.values()) { try { send(last); } catch {} }
  };
  const sync = () => {
    if (wants.size && !timer) { timer = setI(() => { tick(); }, every); timer.unref?.(); tick(); }
    else if (!wants.size && timer) { clearI(timer); timer = null; last = undefined; }
  };
  return {
    want(id, on, send) {
      if (on) { const had = wants.has(id); wants.set(id, send); if (had || timer) { if (last) send(last); } }
      else wants.delete(id);
      sync();
    },
    drop(id) { wants.delete(id); sync(); },
    watching: () => wants.size,
  };
}
module.exports = { createGpuWatch };
