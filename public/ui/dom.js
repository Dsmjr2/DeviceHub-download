// Tiny DOM helpers used by every page.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// h('div', {class, onclick, style:{...}, dataset:{...}}, ...children)
export function h(tag, attrs = {}, ...kids) {
  const svg = tag.startsWith('svg:');
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (val == null) continue;
        if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

export const svgEl = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());

// Icons, 24px. Small utility icons are 2 px strokes.
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
// Navigation icons (19 Oct 2026): one family in the iOS manner, rounded 1.7 px outlines on a 24 px grid, every one
// fitted to the same 17 px box (3.5-20.5) so they read as one size.
const N = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
// gear: 8 rounded teeth around a hub
const gear = (() => {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    for (const [r, da] of [[6.4, -0.36], [8.5, -0.2], [8.5, 0.2], [6.4, 0.36]]) pts.push(`${(12 + r * Math.cos(a + da)).toFixed(2)} ${(12 + r * Math.sin(a + da)).toFixed(2)}`);
  }
  return `<path d="M${pts.join('L')}Z"/><circle cx="12" cy="12" r="2.75"/>`;
})();
export const icons = {
  overview: N('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  mouse: N('<rect x="6.5" y="3.5" width="11" height="17" rx="5.5"/><path d="M12 3.5V9"/><path d="M6.6 9h10.8" opacity=".55"/>'),
  headset: N('<path d="M4.75 15V11.75a7.25 7.25 0 0 1 14.5 0V15"/><rect x="3.5" y="13.5" width="4.5" height="7" rx="2.1"/><rect x="16" y="13.5" width="4.5" height="7" rx="2.1"/>'),
  keyboard: N('<rect x="3.5" y="6.5" width="17" height="11" rx="2.5"/><path d="M6.75 10.25h.01M9.4 10.25h.01M12 10.25h.01M14.6 10.25h.01M17.25 10.25h.01M6.75 13.75h.01M17.25 13.75h.01" stroke-width="2.1"/><path d="M9.4 13.75h5.2"/>'),
  lighting: N('<circle cx="12" cy="12" r="3.75"/><path d="M12 3.5V5M12 19v1.5M3.5 12H5M19 12h1.5M5.99 5.99l1.06 1.06M16.95 16.95l1.06 1.06M5.99 18.01l1.06-1.06M16.95 7.05l1.06-1.06"/>'),
  monitor: N('<rect x="3" y="4.5" width="18" height="12" rx="2.25"/><path d="M9 20h6M12 16.5V20"/>'),
  thermo: N('<path d="M10 13.6V5a2 2 0 0 1 4 0v8.6a4 4 0 1 1-4 0Z"/><path d="M12 9.5v6"/>'),
  gauge: N('<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 13.5l3.5-4"/><circle cx="12" cy="14" r="1.2"/>'),
  camera: N('<rect x="3" y="6.5" width="13" height="11" rx="2.2"/><path d="M16 10.5l5-3v9l-5-3"/>'),
  fan: N('<circle cx="12" cy="12" r="1.9"/><path d="M12 10.1c-.3-3 .4-5.6 2.6-6.1 2.3-.5 3.4 1.9 2 3.6-1.1 1.4-2.8 2-4.6 2.5M13.9 12c3-.3 5.6.4 6.1 2.6.5 2.3-1.9 3.4-3.6 2-1.4-1.1-2-2.8-2.5-4.6M12 13.9c.3 3-.4 5.6-2.6 6.1-2.3.5-3.4-1.9-2-3.6 1.1-1.4 2.8-2 4.6-2.5M10.1 12c-3 .3-5.6-.4-6.1-2.6-.5-2.3 1.9-3.4 3.6-2 1.4 1.1 2 2.8 2.5 4.6"/>'),
  profiles: N('<rect x="3.5" y="9.25" width="17" height="11.25" rx="2.5"/><path d="M5.75 6.4h12.5M8.25 3.5h7.5"/>'),
  backups: N('<rect x="3.5" y="3.5" width="17" height="5" rx="1.6"/><path d="M5.25 8.5v9.75a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25V8.5M10 12.5h4"/>'),
  speakers: N('<rect x="6" y="3.5" width="12" height="17" rx="2.5"/><circle cx="12" cy="14.25" r="3"/><path d="M12 7.6h.01" stroke-width="2.1"/>'),
  settings: N(gear),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  check: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  alert: I('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>'),
  plug: I('<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5"/>'),
  refresh: I('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>'),
  external: I('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  bolt: I('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'),
  micOff: I('<path d="M15 9.5V5.5a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.6 2.5"/><path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3.5M3.5 3.5l17 17"/>'),
  ear: I('<path d="M7 9a5 5 0 0 1 10 0c0 3-2.5 4-3.5 6-.6 1.2-1.4 3-3.5 3a2.5 2.5 0 0 1-2.5-2.5"/><path d="M10 9.5a2 2 0 0 1 4 0"/>'),
  layers: I('<path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>'),
  mic: I('<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>'),
  volume: I('<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4v-5Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>'),
  arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  play: I('<path d="M7 4.5v15l12-7.5-12-7.5Z"/>'),
  knob: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 6.5V10"/><path d="M5 4.5A10.5 10.5 0 0 0 3 9" opacity=".5"/>'),
  command: I('<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z"/>'),
  sleep: I('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>'),
  shield: I('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
};
export const icon = (name, cls = 'ic') => { const s = svgEl(icons[name] || icons.x); s.classList.add(...cls.split(/\s+/).filter(Boolean)); return s; };
