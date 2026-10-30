// "Bring over from G HUB" on the Profiles page (29 Oct 2026; helpers/maker-profiles.mjs, GET /api/maker-profiles). Each
// mouse setup saved in Logitech G HUB (DPI stages, report rate) can become a DeviceHub profile on the person's click.
// Making the profile writes nothing to the mouse: it is applied later from its card like any profile, and each value is
// checked against the mouse's own ranges then. Shown only when G HUB has setups. In place: no pop-ups.
import { h } from './dom.js';
import { button, card } from './controls.js';
import { isDemo } from '../core/devices.js';
import { loadProfiles, saveProfiles, PROFILE_COLORS } from '../core/profiles.js';

export const LOGITECH_ID = 'logitech-hidpp-mouse';   // the device library's Logitech mouse driver (its profile key)
const st = { asked: false, ghub: null, note: {} };

// the profile one G HUB setup becomes: its DPI (the setup's default stage) and report rate for the Logitech driver
export function profileFrom(setup, taken = [], index = 0) {
  const values = {};
  if (Number.isInteger(setup?.dpi)) values.dpi = setup.dpi;
  if (Number.isInteger(setup?.reportRate)) values.reportRate = setup.reportRate;
  if (!Object.keys(values).length) return null;
  const base = `G HUB ${setup.name || 'setup'}`.slice(0, 40);
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base} ${n}`;
  return { name, color: PROFILE_COLORS[index % PROFILE_COLORS.length], devices: {}, added: { [LOGITECH_ID]: { title: setup.model ? `Logitech ${setup.model}` : 'Logitech mouse', values } } };
}

const line = (s) => [s.model, s.dpi ? `${s.dpi} DPI${s.dpis.length > 1 ? ` (stages ${s.dpis.join(', ')})` : ''}` : null, s.reportRate ? `${s.reportRate} Hz` : null].filter(Boolean).join(' · ');

export function makerImportCard(rerender = () => {}) {
  if (isDemo()) return null;
  if (!st.asked) {
    st.asked = true;
    fetch('/api/maker-profiles').then((r) => (r.ok ? r.json() : null)).then((j) => { st.ghub = j?.ghub || null; if (st.ghub?.setups?.length) rerender(); }).catch(() => {});
  }
  const setups = st.ghub?.setups || [];
  if (!setups.length) return null;
  const make = async (s, i) => {
    st.note[i] = 'Making it…'; rerender();
    try {
      const list = await loadProfiles();
      const p = profileFrom(s, (list || []).map((x) => x.name), (list || []).length);
      if (!p) throw new Error('it has no DPI or report rate');
      await saveProfiles([...(list || []), p]);
      const back = await loadProfiles();
      if (!(back || []).some((x) => x.name === p.name)) throw new Error('it was not saved');
      st.note[i] = `Made "${p.name}". Apply it from its card below; DeviceHub checks each value against the mouse first.`;
    } catch (e) { st.note[i] = `Not made: ${e.message}`; }
    rerender();
  };
  return card([h('h2', {}, 'Bring over from G HUB')],
    h('p', { class: 'faint', style: { margin: '0 0 10px' } }, 'Your mouse setups saved in Logitech G HUB. Each can become a DeviceHub profile; nothing changes on the mouse until you apply it.'),
    ...setups.map((s, i) => h('div', { class: 'row', style: { alignItems: 'center', gap: '10px', padding: '6px 0' } },
      h('div', { class: 'grow' }, h('b', {}, s.name), h('small', { class: 'faint', style: { display: 'block' } }, st.note[i] || line(s))),
      /^Made /.test(st.note[i] || '') ? null : button('Make a profile', () => make(s, i), { kind: 'ghost small', ic: 'plus' }))));
}
