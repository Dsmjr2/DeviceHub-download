// Search finds single settings (21 Oct 2026, Shawn: easier to navigate): typing "sleep" offers Mouse > Auto sleep and
// Headset > Sleep when silent, and picking one opens that page, scrolls to the setting and marks it for a moment.
// The list is read from the pages' own code (every row('Name', 'description') and every card heading), so a setting
// added later is found with no list to keep; it is read once, the first time Search is opened.

const FILES = { mouse: 'mouse', headset: 'headset', 'eq-panel': 'headset', 'mic-meter': 'headset', speakers: 'headset', keyboard: 'keyboard',
  lighting: 'lighting', 'pc-lights': 'lighting', monitors: 'monitors', 'camera-card': 'monitors', fans: 'fans', profiles: 'profiles',
  backups: 'backups', settings: 'settings', supported: 'supported' };
let index = null, loading = null;

// moves the page itself (#main scrolls, not the window), set outright: scrollIntoView did nothing in a test window
function scrollTo(el, center) {
  const main = document.querySelector('#main'); if (!main || !el) return;
  const r = el.getBoundingClientRect(), m = main.getBoundingClientRect();
  main.scrollTop += center ? r.top - m.top - (m.height - r.height) / 2 : r.top - m.top - 16;
}

export function loadIndex() {
  if (index || loading) return loading;
  loading = Promise.all(Object.entries(FILES).map(([f, page]) => fetch(`/pages/${f}.js`).then((r) => (r.ok ? r.text() : '')).then((src) => {
    const out = [];
    for (const m of src.matchAll(/row\('([^']+)', (?:'([^']*)'|null)/g)) out.push({ page, name: m[1], desc: m[2] || '', kind: 'row' });
    for (const m of src.matchAll(/h\('h2', \{\}, '([^']+)'\)/g)) out.push({ page, name: m[1], desc: '', kind: 'section' });
    return out;
  }).catch(() => []))).then((all) => {
    const seen = new Set();
    index = all.flat().filter((s) => { const k = `${s.page}|${s.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
  });
  return loading;
}

// the settings whose name (or description) holds every word typed
export function findSettings(q) {
  if (!index || q.length < 2) return [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = index.filter((s) => words.every((w) => `${s.name} ${s.desc}`.toLowerCase().includes(w)));
  // names first, then descriptions
  return hits.sort((a, b) => Number(!words.every((w) => b.name.toLowerCase().includes(w))) - Number(!words.every((w) => a.name.toLowerCase().includes(w)))).slice(0, 8);
}

// opens the page and scrolls to the setting; the page may redraw meanwhile, so it looks again until it is there
export function showSetting(s, go) {
  go(s.page);
  let tries = 0;
  const look = () => {
    const sel = s.kind === 'section' ? '#main .panel-head h2' : '#main .srow-title';
    const el = [...document.querySelectorAll(sel)].find((x) => x.firstChild?.textContent?.trim() === s.name || x.textContent.trim() === s.name);
    if (!el) { if (++tries < 20) setTimeout(look, 100); return; }
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    const box = el.closest(s.kind === 'section' ? '.panel' : '.srow') || el;
    scrollTo(box, true);
    box.classList.add('found');
    setTimeout(() => document.querySelectorAll('#main .found').forEach((x) => x.classList.remove('found')), 1600);
  };
  setTimeout(look, 50);
}
