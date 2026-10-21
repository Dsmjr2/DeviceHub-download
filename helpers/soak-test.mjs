// Soak test (19 Oct 2026): every setting DeviceHub can write, on every connected device, written with the value it
// already has, for several rounds. Nothing on the devices changes, but each write takes the full path: backup, write,
// read back. Reports failures, slow writes and any value that reads back different.
// Run with DeviceHub running:  node helpers/soak-test.mjs [rounds]
// Left out on purpose: mic boost (any write restarts iCUE) and keyboard macros. Test writes stay out of Activity.
const BASE = 'http://127.0.0.1:5577';
const rounds = Number(process.argv[2] || 5);

const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};
const state = async () => (await (await fetch(`${BASE}/api/agent/state`)).json()).devices;

const KEYS = {
  mouse: (v) => ['pollingRate', 'liftOff', 'debounce', 'motionSync', 'angleSnap', 'ripple', 'turbo', 'stageCount', 'dpiStage', 'sleep', 'dpiEffect',
    ...Array.from({ length: v.stageCount || 1 }, (_, i) => `dpi${i}`), ...Array.from({ length: v.stageCount || 1 }, (_, i) => `color${i}`),
    'btn1', 'btn2', 'btn3', 'btn4', 'btn5'],
  keyboard: () => ['brightness', 'effect', 'speed', 'hue', 'saturation'],
  headset: (v) => ['vol:playback', 'vol:recording', 'mute:playback', 'mute:recording', 'sidetone', 'sidetoneOn', 'logoBrightness', 'micLight', 'led',
    ...(v.headsetOn ? ['autoOff'] : [])],
};

const results = [];
for (let round = 1; round <= rounds; round++) {
  const devs = await state();
  for (const d of devs) {
    if (d.status !== 'connected' || !KEYS[d.id]) { if (round === 1) console.log(`${d.id}: ${d.status}, skipped`); continue; }
    for (const key of KEYS[d.id](d.values)) {
      const value = d.values[key];
      if (value == null) continue;
      const t0 = performance.now();
      let ok = true, err = null, back;
      try { back = (await post('/api/agent/write', { id: d.id, key, value, label: key, display: String(value), test: true })).value; } catch (e) { ok = false; err = e.message; }
      const ms = Math.round(performance.now() - t0);
      const same = ok && JSON.stringify(back) === JSON.stringify(value);
      results.push({ round, id: d.id, key, ms, ok, same, err, value, back });
      if (!ok || !same) console.log(`  round ${round} ${d.id} ${key}: ${ok ? `read back ${JSON.stringify(back)} for ${JSON.stringify(value)}` : `FAILED ${err}`}`);
    }
  }
  console.log(`round ${round} done`);
}

const by = {};
for (const r of results) (by[r.id] ||= []).push(r);
for (const [id, list] of Object.entries(by)) {
  const ms = list.map((r) => r.ms).sort((a, b) => a - b);
  const bad = list.filter((r) => !r.ok || !r.same);
  console.log(`${id}: ${list.length} writes, ${bad.length} problems, median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms[ms.length - 1]} ms (${list.find((r) => r.ms === ms[ms.length - 1]).key})`);
}
const keyMs = {};
for (const r of results) (keyMs[`${r.id} ${r.key}`] ||= []).push(r.ms);
const slow = Object.entries(keyMs).map(([k, v]) => [k, Math.max(...v)]).filter(([, v]) => v > 500).sort((a, b) => b[1] - a[1]);
if (slow.length) console.log('over 0.5 s:', slow.map(([k, v]) => `${k} ${v} ms`).join(', '));
