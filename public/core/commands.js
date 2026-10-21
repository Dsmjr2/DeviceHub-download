// Command palette entries. Static ones are filtered by text; "dynamic" ones are built from what was typed.
import { devices, write, backupNow, connect, isDemo } from './devices.js';
import { loadProfiles } from './profiles.js';
import { applyWithPreview } from '../pages/profiles.js';
import { applyColor } from '../pages/lighting.js';
import { POLLING, snapDpi } from '../devices/mouse-adapter.js';
import { toast } from '../ui/overlay.js';
import { env } from './env.js';
import { copyDownloadLink, copyShortReport } from './share.js';
import { loadIndex, findSettings, showSetting } from '../ui/find-settings.js';

let profiles = [];
let loadedAt = 0;
const reloadProfiles = () => loadProfiles().then((p) => { profiles = p; });
// typed commands also reach the EQ presets and the monitors (20 Oct 2026); both lists are read while Search is used,
// at most every 30 s, never in the background
let eq = null, monitors = [], cameras = [], orgb = null, extrasAt = 0;
const reloadExtras = () => {
  if (isDemo()) return;
  env.api('/api/eq').then((e) => { eq = e; }).catch(() => {});
  env.api('/api/monitors').then((m) => { monitors = (m || []).filter((x) => x.ddc); }).catch(() => {});
  env.api('/api/cameras').then((c) => { cameras = c || []; }).catch(() => {});
  env.api('/api/openrgb').then((o) => { orgb = o; }).catch(() => {});
};
const headsetSet = (key, value, label, display) => write('headset', key, value, { label, display }).catch(() => {});
const pct = (n) => n != null && n >= 0 && n <= 100;

const COLORS = { orange: '#ff6a1a', red: '#ff2d55', pink: '#ff5d8f', purple: '#b48cff', blue: '#5b6cff', cyan: '#3fe0ff', teal: '#2fd4c0', green: '#3ddc97', lime: '#c6ff3d', yellow: '#ffd23f', white: '#ffffff' };
const ok = (id) => devices[id]?.status === 'connected';
const mouseSet = (key, value, label, display) => write('mouse', key, value, { label, display }).catch(() => {});

export function commands(q, { go, pages }) {
  if (Date.now() - loadedAt > 5000) { loadedAt = Date.now(); reloadProfiles(); }
  if (Date.now() - extrasAt > 30000) { extrasAt = Date.now(); reloadExtras(); }
  const out = [];
  // single settings by name (ui/find-settings.js)
  loadIndex();
  const names = Object.fromEntries(pages.map((p) => [p.id, p.title]));
  for (const s of findSettings(q)) out.push({ dynamic: true, group: names[s.page] || s.page, icon: 'search', label: s.kind === 'section' ? `${s.name} (section)` : s.name, run: () => showSetting(s, go) });
  // dynamic: numbers typed after a word
  const num = (re) => { const m = q.match(re); return m ? Number(m[1]) : null; };
  const dpi = num(/^(?:dpi|sens)\s*(\d{2,5})$/);
  if (dpi != null && ok('mouse')) {
    const v = devices.mouse.values, target = snapDpi(dpi);
    const inCycle = v.stageCount >= 1 && v.stageCount <= 8 ? v.stageCount : 8;
    const stage = [0, 1, 2, 3, 4, 5, 6, 7].slice(0, inCycle).find((i) => v[`dpi${i}`] === target);
    out.push(stage != null
      ? { dynamic: true, group: 'Mouse', icon: 'mouse', label: `Switch to stage ${stage + 1} (${target} DPI)`, run: () => mouseSet('dpiStage', stage + 1, 'Active DPI stage', `stage ${stage + 1}`) }
      : { dynamic: true, group: 'Mouse', icon: 'mouse', label: `Set the active stage (${v.dpiStage}) to ${target} DPI`, run: () => mouseSet(`dpi${v.dpiStage - 1}`, target, `DPI stage ${v.dpiStage}`, `${target} DPI`) });
  }
  const hz = num(/^(?:polling|hz|rate)\s*(\d{3,4})$/);
  if (hz != null && POLLING[hz] && ok('mouse')) out.push({ dynamic: true, group: 'Mouse', icon: 'mouse', label: `Polling rate ${hz} Hz`, run: () => mouseSet('pollingRate', hz, 'Polling rate', `${hz} Hz`) });
  const vol = num(/^(?:vol|volume)\s*(\d{1,3})$/);
  if (vol != null && vol <= 100 && ok('headset')) out.push({ dynamic: true, group: 'Headset', icon: 'headset', label: `Headset volume ${vol}%`, run: () => write('headset', 'vol:playback', vol, { label: 'Volume', display: `${vol}%` }).catch(() => {}) });
  // headset: mic boost (0-10 dB), mic level, sidetone, logo brightness
  const boost = num(/^(?:mic\s*boost|boost)\s*(\d{1,2})(?:\s*db)?$/);
  if (boost != null && boost <= 10 && ok('headset') && devices.headset.values.micBoost != null) out.push({ dynamic: true, group: 'Headset', icon: 'mic', label: `Mic boost ${boost} dB`, run: () => headsetSet('micBoost', boost, 'Mic boost', `${boost} dB`) });
  const micLvl = num(/^(?:mic(?:\s*level)?)\s*(\d{1,3})%?$/);
  if (pct(micLvl) && ok('headset')) out.push({ dynamic: true, group: 'Headset', icon: 'mic', label: `Mic level ${micLvl}%`, run: () => headsetSet('vol:recording', micLvl, 'Mic level', `${micLvl}%`) });
  const side = num(/^(?:sidetone|side)\s*(\d{1,3})%?$/);
  if (pct(side) && ok('headset') && devices.headset.values.sidetone != null) out.push({ dynamic: true, group: 'Headset', icon: 'headset', label: `Sidetone ${side}%`, run: () => headsetSet('sidetone', side, 'Sidetone level', `${side}%`) });
  const logo = num(/^(?:logo|logos)\s*(\d{1,3})%?$/);
  if (pct(logo) && ok('headset') && devices.headset.values.logoBrightness != null) out.push({ dynamic: true, group: 'Headset', icon: 'lighting', label: `Ear cup logos ${logo ? `${logo}%` : 'off'}`, run: () => headsetSet('logoBrightness', logo, 'Ear Cup Logo', logo ? `${logo}%` : 'off') });
  // keyboard backlight brightness, as a percentage
  const back = num(/^(?:backlight|keyboard|kb)\s*(\d{1,3})%?$/);
  if (pct(back) && ok('keyboard') && devices.keyboard.adapter.hasLighting?.() && devices.keyboard.values.effect !== 0) out.push({ dynamic: true, group: 'Keyboard', icon: 'keyboard', label: `Keyboard backlight ${back}%`, run: () => write('keyboard', 'brightness', Math.round(back * 2.55), { label: 'Backlight', display: `${back}%` }).catch(() => {}) });
  // keyboard lights on / off (the Lights switch: effect None is off; on brings Solid)
  const kl = q.match(/^(?:keyboard|kb)\s+lights?\s+(on|off)$/);
  if (kl && ok('keyboard') && devices.keyboard.adapter.hasLighting?.()) {
    const on = kl[1] === 'on', isOn = devices.keyboard.values.effect !== 0;
    if (on !== isOn) out.push({ dynamic: true, group: 'Keyboard', icon: 'keyboard', label: `Keyboard lights ${kl[1]}`, run: () => write('keyboard', 'effect', on ? 1 : 0, { label: 'Lights', display: kl[1] }).catch(() => {}) });
  }
  // camera: "zoom 2x", "camera brightness 60" / contrast / color / sharpness (the first camera)
  const cam = cameras[0];
  const camSet = (key, value, label) => async () => { try { await env.api('/api/cameras/set', { id: cam.id, key, value }); toast(`Camera ${label}`, 'good'); } catch (e) { toast('Camera not changed', 'bad', { detail: e.message }); } extrasAt = 0; };
  const zm = q.match(/^(?:camera\s+)?zoom\s*([1-9](?:\.\d)?)\s*x?$/);
  if (zm && cam?.controls.zoom?.min > 0) {
    const z = cam.controls.zoom, value = Math.round(Number(zm[1]) * z.min);
    if (value >= z.min && value <= z.max) out.push({ dynamic: true, group: 'Camera', icon: 'monitor', label: `Camera zoom ${Number(zm[1]).toFixed(1)}×`, run: camSet('zoom', value, `zoom ${Number(zm[1]).toFixed(1)}×`) });
  }
  const cp = q.match(/^camera\s+(brightness|contrast|color|saturation|sharpness)\s*(\d{1,3})$/);
  if (cp && cam) {
    const key = cp[1] === 'color' ? 'saturation' : cp[1], c = cam.controls[key], v = Number(cp[2]);
    if (c && v >= c.min && v <= c.max) out.push({ dynamic: true, group: 'Camera', icon: 'monitor', label: `Camera ${cp[1]} ${v}`, run: camSet(key, v, `${cp[1]} ${v}`) });
  }
  // PC lights through OpenRGB: "pc lights red" / "pc lights #3366ff" / "pc lights off"
  const pl = q.match(/^pc\s+lights?\s+(#[0-9a-f]{6}|[a-z]+)$/);
  if (pl && orgb?.running && orgb.controllers?.length) {
    const hex = pl[1] === 'off' ? '#000000' : pl[1].startsWith('#') ? pl[1] : COLORS[pl[1]];
    if (hex) out.push({ dynamic: true, group: 'PC lights', icon: 'lighting', label: `PC lights ${pl[1]}`, run: async () => { try { await env.api('/api/openrgb/color', { target: 'all', hex }); toast(`PC lights ${pl[1]}`, 'good'); } catch (e) { toast('PC lights not changed', 'bad', { detail: e.message }); } } });
  }
  // monitors: "brightness 40" (every monitor) or "brightness 40 oled" / "ips" / part of a name; contrast the same
  const mon = q.match(/^(brightness|bright|contrast)\s*(\d{1,3})%?\s*(.*)$/);
  if (mon && pct(Number(mon[2])) && monitors.length) {
    const feature = mon[1] === 'contrast' ? 'contrast' : 'brightness', value = Number(mon[2]), which = mon[3].trim();
    const pick = monitors.filter((m) => m[feature] && (!which || `${m.name} ${m.model}`.toLowerCase().includes(which)));
    if (pick.length) out.push({ dynamic: true, group: 'Monitors', icon: 'monitor', label: `${feature === 'contrast' ? 'Contrast' : 'Brightness'} ${value}% on ${pick.length === monitors.length && !which ? 'every monitor' : pick.map((m) => m.name).join(' and ')}`,
      run: async () => {
        let failed = 0;
        for (const m of pick) { try { await env.api('/api/monitors/set', { id: m.id, feature, value: Math.round((value / 100) * m[feature].max) }); } catch { failed++; } }
        toast(failed ? `${failed} monitor${failed === 1 ? '' : 's'} not changed` : `${feature === 'contrast' ? 'Contrast' : 'Brightness'} ${value}%`, failed ? 'bad' : 'good');
        extrasAt = 0;
      } });
  }
  // EQ presets: "eq competitive" (any part of the name)
  const eqq = q.match(/^(?:eq|preset)\s+(.+)$/);
  if (eqq && eq?.presets?.length) {
    const want = eqq[1].trim();
    for (const p of eq.presets.filter((x) => x.name.toLowerCase().includes(want)).slice(0, 4)) {
      out.push({ dynamic: true, group: 'Equalizer', icon: 'headset', label: p.id === eq.activeId ? `${p.name} (in use)` : `Use the ${p.name} EQ`,
        run: async () => { if (p.id === eq.activeId) return; try { eq = await env.api('/api/eq/activate', { id: p.id }); toast(`${p.name} EQ on`, 'good'); } catch (e) { toast('EQ not changed', 'bad', { detail: e.message }); } } });
    }
  }

  out.push({ group: 'DeviceHub', icon: 'external', label: 'Copy a report for help', keywords: 'report help problem support bug issue', run: copyShortReport });
  out.push({ group: 'DeviceHub', icon: 'external', label: 'Copy the download link to share', keywords: 'share link download send friend installer zip', run: copyDownloadLink });
  for (const p of pages) out.push({ group: 'Go to', icon: p.icon, label: p.title, keywords: `page open ${p.id}`, run: () => go(p.id) });
  for (const p of profiles) out.push({ group: 'Profile', icon: 'profiles', label: `Apply "${p.name}"`, keywords: 'profile switch', run: () => applyWithPreview(p) });
  for (const [name, hex] of Object.entries(COLORS)) out.push({ group: 'Lighting', icon: 'lighting', label: `All lighting ${name}`, keywords: `color color rgb ${hex}`, run: () => applyColor(hex) });
  if (ok('mouse')) {
    const v = devices.mouse.values;
    for (const [key, label] of [['motionSync', 'Motion sync'], ['angleSnap', 'Angle snapping'], ['ripple', 'Ripple control']]) {
      out.push({ group: 'Mouse', icon: 'mouse', label: `${label} ${v[key] ? 'off' : 'on'}`, keywords: 'toggle', run: () => mouseSet(key, !v[key], label, v[key] ? 'off' : 'on') });
    }
    for (let i = 0; i < (v.stageCount >= 1 && v.stageCount <= 8 ? v.stageCount : 8); i++) if (v[`dpi${i}`] != null && v.dpiStage !== i + 1) out.push({ group: 'Mouse', icon: 'mouse', label: `DPI stage ${i + 1} (${v[`dpi${i}`]})`, keywords: 'dpi stage switch', run: () => mouseSet('dpiStage', i + 1, 'Active DPI stage', `stage ${i + 1}`) });
  }
  if (ok('headset')) {
    const v = devices.headset.values;
    if (v['mute:recording'] != null) out.push({ group: 'Headset', icon: 'mic', label: v['mute:recording'] ? 'Unmute mic (Windows)' : 'Mute mic (Windows)', keywords: 'microphone', run: () => write('headset', 'mute:recording', !v['mute:recording'], { label: 'Mic (Windows)', display: v['mute:recording'] ? 'on' : 'muted' }).catch(() => {}) });
  }
  for (const d of Object.values(devices)) {
    if (d.status === 'connected') out.push({ group: 'Safety', icon: 'backups', label: `Back up ${d.adapter.title} now`, keywords: 'backup save', run: async () => toast('Backup saved', 'good', { detail: await backupNow(d.id) }) });
    else out.push({ group: 'Device', icon: 'plug', label: `Connect ${d.adapter.title}`, keywords: 'connect pair', run: () => connect(d.id, d.id !== 'headset') });
  }
  if (!q) out.unshift({ group: 'Tip', icon: 'command', label: 'Try "dpi 800", "volume 40", "mic boost 4", "eq competitive", "brightness 40 oled" or a profile name', run: () => {} });
  return out;
}
