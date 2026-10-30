// "Check your devices" on the Setup page (29 Oct 2026, Shawn: setup should end with knowing it all works). The same
// two checks the device pages have, in one place: the polling rate test for every mouse (public/ui/polling-test.js) and
// Test it with me for every library driver whose settings are on (public/ui/guided-test.js, then Works on my device).
// Nothing runs by itself: each check starts on its own button, as on the device pages.
import { h } from './dom.js';
import { card } from './controls.js';
import { devices } from '../core/devices.js';
import { pollingTest, pollHzOf } from './polling-test.js';
import { guidedTest } from './guided-test.js';
import { worksReport, offersWorks } from './works-report.js';

const isMouse = (d) => /mouse/i.test(d?.adapter?.kind || '');

// the checks there are for the connected devices: [{ id, title, kind: 'polling'|'guided' }]. A mouse asleep counts for
// the polling test: moving it for the test wakes it.
export function checksFor(list = Object.values(devices)) {
  const out = [];
  for (const d of list) {
    if (!d?.adapter) continue;
    const title = d.adapter.title || d.id;
    if (d.status === 'connected' && offersWorks(d)) out.push({ id: d.id, title, kind: 'guided' });
    if (isMouse(d) && ['connected', 'asleep'].includes(d.status)) out.push({ id: d.id, title, kind: 'polling' });
  }
  return out;
}

// the section, or null when no connected device has a check; redraw: the Setup page's
export function deviceChecks({ redraw = () => {} } = {}) {
  const list = checksFor();
  if (!list.length) return null;
  const cards = list.map((c) => {
    const d = devices[c.id];
    if (c.kind === 'polling') return pollingTest(pollHzOf(d), card, c.id, `${c.title}: polling rate`);
    return card([h('h2', {}, `${c.title}: Test it with me`)], guidedTest(d, { after: () => worksReport(d, { invite: true }), redraw }));
  });
  return h('section', { class: 'panel su-section su-checks' },
    h('header', { class: 'panel-head' }, h('h2', {}, 'Check your devices')),
    h('p', { class: 'faint', style: { margin: '0 0 12px' } }, 'Quick checks so you know everything works. Each one starts only when you press its button.'),
    h('div', { class: 'stack' }, ...cards));
}
