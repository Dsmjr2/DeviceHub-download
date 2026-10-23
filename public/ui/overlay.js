// Toasts, modal dialogs and the Ctrl+K command palette.
import { h, icon, $ } from './dom.js';

// ---------- toasts ----------
const tray = () => $('#toasts');
// the last red message and the page it was shown on: Get help puts it in the report (ui/get-help.js), nothing else
export const lastBad = { hash: '', text: '', at: 0 };
const noteBad = (msg, detail) => { if (typeof msg === 'string') Object.assign(lastBad, { hash: location.hash, text: detail ? `${msg}: ${detail}` : msg, at: Date.now() }); };
export function toast(msg, kind = 'info', { detail, ms = 3800 } = {}) {
  if (kind === 'bad') noteBad(msg, detail);
  const el = h('div', { class: `toast ${kind}`, role: 'status' },
    icon(kind === 'good' ? 'check' : kind === 'bad' ? 'alert' : kind === 'busy' ? 'refresh' : 'shield', `ic ${kind === 'busy' ? 'spin' : ''}`),
    h('div', {}, h('div', { class: 'toast-msg' }, msg), detail ? h('div', { class: 'toast-detail' }, detail) : null));
  tray().append(el);
  setTimeout(() => el.classList.add('in'), 10);
  const close = () => { el.classList.remove('in'); el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  if (ms) setTimeout(close, ms);
  return {
    close,
    update(m, k, d) {
      if (k === 'bad') noteBad(m, d);
      el.className = `toast ${k} in`;
      el.querySelector('.toast-msg').textContent = m;
      el.querySelector('.ic').replaceWith(icon(k === 'good' ? 'check' : k === 'bad' ? 'alert' : 'shield'));
      if (d) { const dd = el.querySelector('.toast-detail') || el.lastChild.appendChild(h('div', { class: 'toast-detail' })); dd.textContent = d; }
      else el.querySelector('.toast-detail')?.remove();  // no leftover "backing up…" line under a finished change
      setTimeout(close, k === 'bad' ? 7000 : 3200);
    },
  };
}

// ---------- modal ----------
export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const done = (v) => { back.classList.remove('in'); setTimeout(() => back.remove(), 220); resolve(v); };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'close', onclick: () => done(null) }, icon('x'))),
      h('div', { class: 'modal-body' }, body),
      h('footer', {}, ...actions.map((a) => h('button', { class: `btn ${a.kind || ''}`, onclick: () => done(a.value) }, a.label))));
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) done(null); } }, box);
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.append(back);
    setTimeout(() => { back.classList.add('in'); (box.querySelector('input, .btn.primary') || box.querySelector('button'))?.focus(); }, 10);
  });
}

export async function promptText(title, label, value = '') {
  const input = h('input', { class: 'text', value, placeholder: label, 'aria-label': label });
  const body = h('div', {}, input);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.closest('.modal').querySelector('.btn.primary').click(); });
  const ok = await modal(title, body, [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Save', value: true, kind: 'primary' }]);
  return ok ? input.value.trim() : null;
}

// ---------- command palette ----------
let commandsFn = () => [];
export function setCommands(fn) { commandsFn = fn; }

export function openPalette() {
  if ($('.palette-back')) return;
  const input = h('input', { class: 'palette-input', placeholder: 'Find a setting or type a command: "sleep", "dpi 800"…', 'aria-label': 'command' });
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  const back = h('div', { class: 'palette-back' }, h('div', { class: 'palette' }, h('div', { class: 'palette-top' }, icon('search'), input, h('kbd', {}, 'Esc')), list));
  let items = [], sel = 0;
  const close = () => { back.classList.remove('in'); setTimeout(() => back.remove(), 180); };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const all = commandsFn(q);
    items = all.filter((c) => !q || c.dynamic || `${c.group} ${c.label} ${c.keywords || ''}`.toLowerCase().includes(q)).slice(0, 40);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(...(items.length ? items.map((c, i) => h('button', { class: `palette-item${i === sel ? ' sel' : ''}`, role: 'option', onmouseenter: () => { sel = i; paint(); }, onclick: () => runItem(c) },
      c.icon ? icon(c.icon) : h('span'), h('span', { class: 'pi-label' }, c.label), h('span', { class: 'pi-group' }, c.group))) : [h('div', { class: 'palette-empty' }, 'No matching command')]));
  };
  const paint = () => [...list.children].forEach((el, i) => el.classList.toggle('sel', i === sel));
  const runItem = async (c) => { close(); await c.run(); };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) runItem(items[sel]);
    if (e.key === 'Escape') close();
  });
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  render();
  setTimeout(() => { back.classList.add('in'); input.focus(); }, 10);
}
