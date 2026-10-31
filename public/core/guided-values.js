// The rules of Test it with me (29 Oct 2026; helpers/guided-test.mjs): which settings it tries and the value it tries
// for a moment. Shared by the page (public/ui/guided-test.js) and the server (the works record), so both agree.
// the kinds a person can notice and DeviceHub can pick a safe second value for 
export const TESTABLE_TYPES = ['slider', 'toggle', 'choice', 'color'];

const HEX = /^#[0-9a-f]{6}$/i;
// may this setting be part of the test? A setting the person can change on the page (not a reading, not read-only),
// of a kind with one plain value. Zone colors and button remaps are left out: their change is a whole map.
// A setting that switches which other settings apply (a mouse's onboard profile, onboard vs host mode) is left out too:
// putting it back alone may not bring back what it changed (31 Oct 2026).
export const SWITCHES = /^(mode|profile|onboardprofile|activeprofile|settingssource)$/i;
export function testable(s, value) {
  if (!s || s.readOnly || !TESTABLE_TYPES.includes(s.type) || SWITCHES.test(String(s.key || ''))) return false;
  if (s.type === 'color') return !s.zones && typeof value === 'string' && HEX.test(value);
  if (s.type === 'choice') return Array.isArray(s.options) && s.options.length > 1;
  if (s.type === 'slider') return value != null && value !== '' && Number.isFinite(Number(value)) && Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min;
  return true;
}

// the second value for a moment: inside the setting's own range or options, and for a slider LOWER when it can be
// (quieter, dimmer, slower), so a test never turns a headset up loud
export function testValue(s, value) {
  if (!testable(s, value)) return undefined;
  if (s.type === 'toggle') return !value;
  if (s.type === 'choice') {
    const at = s.options.findIndex((o) => o.value === value);
    return s.options[(at + 1) % s.options.length].value;
  }
  if (s.type === 'color') {
    const [r, , b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
    return b > r ? '#ff3000' : '#0050ff';
  }
  const step = Number(s.step) > 0 ? Number(s.step) : 1;
  const v = Number(value);
  const snap = (x) => Math.min(s.max, Math.max(s.min, s.min + Math.round((x - s.min) / step) * step));
  let to = v > s.min ? snap(s.min + (v - s.min) * 0.25) : snap(s.min + (s.max - s.min) * 0.3);
  if (to === v) to = v > s.min ? snap(v - step) : snap(v + step);
  return to === v ? undefined : to;
}

