// Wallpapers (22 Oct 2026, Shawn: "I want it display the wallpapers easily since most people have to have folders to
// keep them. Can we store them in this wallpaper area so people can easily get them and preview them and back them up?"
// and "include some cool ones to start and make them easily deletable"). One folder, Pictures\DeviceHub Wallpapers
// (helpers/wallpapers.js), shown as a grid: add pictures or a whole folder (or drop them here), set it as the Windows wallpaper (with Undo), use it behind DeviceHub, show it in its folder,
// delete it (each tile has its own delete, asked on the tile), and back the whole folder up to Documents.
// Demo mode shows the six starter wallpapers read-only and never sends a change.
import { h, icon } from '../ui/dom.js';
import { card, button, loadingCard } from '../ui/controls.js';
import { dropdown } from '../ui/dropdown.js';
import { isDemo } from '../core/devices.js';
import { loadPicture, hasPicture, removePicture } from '../core/theme.js';
import { topbar } from './common.js';
import { helpHere } from '../ui/get-help.js';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
let data = null, error = null, query = '', rerender = () => {};
let adding = null;          // { i, n, added, dup, failed: [] } while pictures are added
let addLine = null;         // what the last add did
let backupLine = null;      // where the last backup went
let windowsLine = null;     // after Set as Windows wallpaper: { text, putBack }
let asking = null;          // the tile asking "Delete?"
let tileLine = null;        // what a tile's own button did (shown above the grid)
let demoHidden = new Set(); // demo: tiles deleted here only

const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const src = (it) => (isDemo() ? `/api/wallpapers/starter?name=${encodeURIComponent(it.name)}` : `/api/wallpapers/file?name=${encodeURIComponent(it.name)}&v=${encodeURIComponent(it.addedAt)}`);

// ---------- quick (22 Oct 2026, Shawn: "make the wallpaper area faster with every button press", "make the size of the
// photo smaller and not as in your face") ----------
// The grid shows small previews (the server keeps them in the folder's hidden .thumbs; the page draws one from a
// picture the first time it shows it), and each tile's picture element is kept and reused, so pressing a button never
// loads or decodes the pictures again. Tile size: Small (the default), Medium or Large, remembered on this PC.
const SIZES = [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']];
let tileSize = (() => { try { return localStorage.getItem('wallpapers.size') || 's'; } catch { return 's'; } })();
const thumbSrc = (it) => (it.thumb && !isDemo() ? `/api/wallpapers/thumb?name=${encodeURIComponent(it.name)}&v=${encodeURIComponent(it.addedAt)}` : src(it));
const imgs = new Map();   // name|addedAt -> the <img> shown for it
function imgFor(it) {
  const key = `${it.name}|${it.addedAt}`;
  let img = imgs.get(key);
  if (!img) {
    img = h('img', { src: thumbSrc(it), alt: '', loading: 'lazy', decoding: 'async' });
    if (!it.thumb && !isDemo()) img.addEventListener('load', () => makeThumb(it, img), { once: true });
    imgs.set(key, img);
  }
  return img;
}
// one preview at a time: 480 px wide, JPEG; made from the picture already on screen, so nothing extra is downloaded
let thumbQueue = Promise.resolve();
function makeThumb(it, img) {
  thumbQueue = thumbQueue.then(async () => {
    try {
      const w = 480, hgt = Math.max(1, Math.round((480 * img.naturalHeight) / Math.max(1, img.naturalWidth)));
      const c = Object.assign(document.createElement('canvas'), { width: w, height: hgt });
      c.getContext('2d').drawImage(img, 0, 0, w, hgt);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
      if (!blob) return;
      const r = await fetch(`/api/wallpapers/thumb?name=${encodeURIComponent(it.name)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      if (r.ok) it.thumb = true;
    } catch {}
  });
}
const title = (name) => name.replace(/\.[a-z0-9]+$/i, '');
const shown = () => (data?.items || []).filter((x) => !demoHidden.has(x.name));
// Sort (22 Oct 2026, Shawn: "Sort: newest, name, size, or resolution"), remembered on this PC; ties by name
const SORTS = [['new', 'Newest'], ['name', 'Name'], ['size', 'Size'], ['res', 'Resolution']];
let sortBy = (() => { try { const v = localStorage.getItem('wallpapers.sort'); return SORTS.some(([k]) => k === v) ? v : 'new'; } catch { return 'new'; } })();
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const pixels = (x) => (x.width && x.height ? x.width * x.height : 0);
const SORT_FN = { new: (a, b) => b.addedAt.localeCompare(a.addedAt) || byName(a, b), name: byName, size: (a, b) => b.bytes - a.bytes || byName(a, b), res: (a, b) => pixels(b) - pixels(a) || byName(a, b) };
const matching = () => { const q = query.trim().toLowerCase(); return shown().filter((x) => !q || x.name.toLowerCase().includes(q)).sort(SORT_FN[sortBy]); };

// Fits your screen (Shawn: "a small badge when a picture is lower resolution than your monitor, so you know it'll look
// blurry"): the screen this window is on, in real pixels (Windows' scaling counted in); a picture more than 10% smaller
// across or down than that is marked Low res (stretched to fill, it looks softer)
const screenPx = () => { const r = window.devicePixelRatio || 1; const w = Math.round(screen.width * r), hh = Math.round(screen.height * r); return { w: Math.max(w, hh), h: Math.min(w, hh) }; };
function lowRes(it) {
  if (!it.width || !it.height) return null;
  const s = screenPx(), long = Math.max(it.width, it.height), short = Math.min(it.width, it.height);
  return long < s.w * 0.9 || short < s.h * 0.9 ? s : null;
}

async function getJson(url) { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || r.statusText); return j; }
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}

async function load() {
  try {
    if (isDemo()) { const s = await getJson('/api/wallpapers/starters'); data = { dir: 'Pictures\\DeviceHub Wallpapers', items: s.items, windows: true, demo: true }; }
    else data = await getJson('/api/wallpapers');
    error = null;
    if (data.previousKept && !windowsLine) windowsLine = { text: 'DeviceHub set your wallpaper.', putBack: true };
  } catch (e) { error = e.message; }
  rerender();
}

// ---------- adding: picked files, a picked folder, or dropped files and folders; one at a time ----------
async function addFiles(files) {
  const pics = [...files].filter((f) => IMAGE_EXT.test(f.name) || /^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type));
  const skipped = files.length - pics.length;
  if (!pics.length) { addLine = { text: files.length ? 'Not pictures (PNG, JPEG, WebP, GIF, BMP).' : 'Nothing to add.', bad: true }; rerender(); return; }
  if (isDemo()) { addLine = { text: `Demo: nothing added (${plural(pics.length, 'picture')} picked).` }; rerender(); return; }
  adding = { i: 0, n: pics.length, added: 0, dup: 0, failed: [] };
  addLine = null;
  for (const f of pics) {
    adding.i++; paintProgress();
    try {
      const r = await fetch(`/api/wallpapers/add?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) adding.failed.push(`${f.name}: ${j.error || r.statusText}`);
      else if (j.duplicate) adding.dup++;
      else adding.added++;
    } catch (e) { adding.failed.push(`${f.name}: ${e.message}`); }
  }
  const a = adding; adding = null;
  const parts = [a.added ? `Added ${plural(a.added, 'picture')}.` : 'Nothing new added.'];
  if (a.dup) parts.push(a.dup === 1 ? '1 already here.' : `${a.dup} already here.`);
  if (skipped) parts.push(`${plural(skipped, 'file')} skipped.`);
  if (a.failed.length) parts.push(`${plural(a.failed.length, 'picture')} not added: ${a.failed.slice(0, 2).join('; ')}${a.failed.length > 2 ? '…' : ''}`);
  addLine = { text: parts.join(' '), bad: a.failed.length > 0 && !a.added };
  await load();
}
// the progress line is updated in place (the grid is not rebuilt for each picture)
function paintProgress() {
  const el = document.querySelector('.wp-progress');
  if (el && adding) el.textContent = `Adding ${adding.i} of ${adding.n}…`;
  else rerender();
}
// a dropped folder: every picture inside it, folders within folders too
async function droppedFiles(dt) {
  const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (e) => {
    if (e.isFile) out.push(await new Promise((res) => e.file(res, () => res(null))));
    else if (e.isDirectory) {
      const reader = e.createReader();
      for (;;) { const batch = await new Promise((res) => reader.readEntries(res, () => res([]))); if (!batch.length) break; for (const x of batch) await walk(x); }
    }
  };
  for (const e of entries) await walk(e);
  return out.filter(Boolean);
}

function pickers() {
  const one = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', multiple: true, hidden: true, class: 'wp-input-files', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); } });
  const dir = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true, class: 'wp-input-folder', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); } });
  return [one, dir,
    button('Add pictures…', () => one.click(), { kind: 'primary', ic: 'plus' }),
    button('Add a folder…', () => dir.click(), { ic: 'folder' })];
}

// ---------- the actions ----------
const DEMO_SAID = 'Demo: nothing changed.';
async function remove(name) {
  if (isDemo()) { demoHidden.add(name); return DEMO_SAID; }
  // gone from the page at once; the folder follows (and the list is read again only if that failed)
  const before = data.items;
  data.items = data.items.filter((x) => x.name !== name);
  rerender();
  try { await post('/api/wallpapers/remove', { name }); }
  catch (e) { data.items = before; rerender(); throw e; }
  return null;
}
// a new name typed under a tile (Shawn: "make the names easily editable through the app")
let editing = null;   // the picture whose name is being typed
async function renameTo(it, to) {
  to = String(to || '').trim();
  editing = null;
  if (!to || to === title(it.name)) { rerender(); return; }
  if (isDemo()) { tileLine = { text: DEMO_SAID }; rerender(); return; }
  const old = it.name, key = `${old}|${it.addedAt}`;
  try {
    const r = await post('/api/wallpapers/rename', { name: old, to });
    const img = imgs.get(key); imgs.delete(key);
    it.name = r.name;
    if (img) imgs.set(`${it.name}|${it.addedAt}`, img);
  } catch (e) { tileLine = { text: `${title(old)}: ${e.message}`, bad: true }; }
  rerender();
}
function nameBox(it, cls) {
  const box = h('input', { class: `text ${cls}`, value: title(it.name), maxlength: 100, 'aria-label': `New name for ${title(it.name)}`,
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); renameTo(it, e.target.value); } if (e.key === 'Escape') { e.stopPropagation(); editing = null; rerender(); } },
    onblur: (e) => { if (editing === it.name) renameTo(it, e.target.value); } });
  setTimeout(() => { box.focus(); box.select(); }, 0);
  return box;
}
async function setWindows(name) {
  if (isDemo()) return DEMO_SAID;
  windowsLine = { text: `Setting ${title(name)} as your Windows wallpaper…` }; rerender();
  let r;
  try { r = await post('/api/wallpapers/set-windows', { name }); } catch (e) { windowsLine = null; rerender(); throw e; }
  // Undo only when the earlier wallpaper can still be put back (helpers/wallpapers.js canUndo)
  windowsLine = { text: `Your Windows wallpaper is now ${title(name)}.`, putBack: r?.canUndo !== false };
  rerender();
  return 'Set as your Windows wallpaper.';
}
async function putBack() {
  if (isDemo()) { windowsLine = { text: DEMO_SAID }; rerender(); return; }
  try { await post('/api/wallpapers/put-back-windows'); windowsLine = { text: 'Your earlier Windows wallpaper is back.' }; }
  catch (e) { windowsLine = { text: e.message, bad: true, putBack: !/no longer there/.test(e.message) }; }
  rerender();
}
async function useAsBackground(name) {
  if (isDemo()) return DEMO_SAID;
  await post('/api/wallpapers/use-as-background', { name });
  await loadPicture();
  rerender();
  return 'Now behind DeviceHub.';
}
async function reveal(name) {
  if (isDemo()) return DEMO_SAID;
  await post('/api/wallpapers/reveal', name ? { name } : {});
  return null;
}
async function backupAll() {
  if (isDemo()) { backupLine = { text: DEMO_SAID }; rerender(); return; }
  try {
    const r = await post('/api/wallpapers/backup');
    // one copy of each picture (helpers/wallpapers.js backup): say what was new, and that the rest were already there
    backupLine = !r.count ? { text: 'Nothing to back up yet.' }
      : { text: `${r.added ? `Backed up ${plural(r.added, 'new picture')} (${mb(r.addedBytes)})` : 'Already backed up: nothing new'}${r.added && r.count > r.added ? `; the other ${r.count - r.added} were already there` : ''}. ${plural(r.inBackup, 'picture')}, one of each, in ${r.dir}${r.folded ? `. ${plural(r.folded, 'older backup folder')} merged into it` : ''}.` };
  } catch (e) { backupLine = { text: `Not backed up: ${e.message}`, bad: true }; }
  rerender();
}

// ---------- the grid ----------
function tile(it) {
  const askingHere = asking === it.name;
  return h('div', { class: `wp-tile ${askingHere ? 'asking' : ''}`, dataset: { name: it.name } },
    // no larger preview (22 Oct 2026, Shawn: "remove the option to click on a wallpaper. people can already see what it
    // looks like"): the picture is only shown; its actions are on the tile
    h('div', { class: 'wp-thumb' }, imgFor(it)),
    h('button', { class: 'wp-del', 'aria-label': `Delete ${title(it.name)}`, onclick: () => { asking = it.name; rerender(); } }, icon('trash')),
    lowRes(it) && !askingHere ? h('span', { class: 'wp-low', 'aria-label': `Low resolution: ${it.width} × ${it.height}, smaller than your screen` }, 'Low res') : null,
    askingHere ? h('div', { class: 'wp-tile-ask', role: 'group', 'aria-label': `Delete ${title(it.name)}?` },
      h('span', {}, 'Delete?'),
      button('Yes', async () => { try { await remove(it.name); } catch (e) { addLine = { text: e.message, bad: true }; } asking = null; rerender(); }, { kind: 'danger small' }),
      button('No', () => { asking = null; rerender(); }, { kind: 'ghost small' })) : null,
    h('div', { class: 'wp-meta' },
      editing === it.name ? nameBox(it, 'wp-name-box')
        : h('button', { class: 'wp-name', 'aria-label': `Rename ${title(it.name)}`, onclick: () => { editing = it.name; asking = null; rerender(); } }, title(it.name), icon('edit', 'ic wp-pen')),
      h('span', { class: 'faint' }, mb(it.bytes))),
    // the picture's own actions in a row at the bottom of the tile, always shown (22 Oct 2026, Shawn: "make it so they
    // can click these ... on the page", then "move the set wallpaper and rename background to devicehub and move it to
    // the bottom"); the answer shows above the grid
    askingHere ? null : h('div', { class: 'wp-quick' },
      quick('Set wallpaper', 'monitor', setWindows, it, 'Set as Windows wallpaper', 'Wallpaper'), quick('DeviceHub', 'image', useAsBackground, it, 'Use as DeviceHub background'),
      h('button', { class: 'wp-quick-btn icon', 'aria-label': `Show ${title(it.name)} in its folder`, title: 'Show in folder', onclick: () => runQuick(reveal, it) }, icon('folder'))));
}
async function runQuick(fn, it) {
  try { const said = await fn(it.name); tileLine = said ? { text: said.startsWith('Demo') ? said : `${title(it.name)}: ${said}` } : null; }
  catch (e) { tileLine = { text: `${title(it.name)}: ${e.message}`, bad: true }; }
  rerender();
}
// short: the word the Small tiles show (their row fits one line)
const quick = (label, ic, fn, it, long = label, short = label) => h('button', { class: 'wp-quick-btn', 'aria-label': `${long}: ${title(it.name)}`, title: long, onclick: () => runQuick(fn, it) },
  icon(ic), h('span', { class: 'wp-q-long' }, label), h('span', { class: 'wp-q-short' }, short));
function grid() {
  const list = matching();
  if (!list.length) return h('p', { class: 'faint wp-none' }, `No wallpaper named like “${query.trim()}”.`);
  return h('div', { class: `wp-grid size-${tileSize}` }, list.map(tile));
}

export default {
  id: 'wallpapers', title: 'Wallpapers', icon: 'wallpapers', accent: 'var(--signal)',
  watches: [],  // nothing a device does changes this page
  render() {
    rerender = () => {
      const el = document.querySelector('#main .page');
      if (!el || location.hash !== '#/wallpapers') return;
      const search = document.activeElement?.classList.contains('wp-search') ? document.activeElement.selectionStart : null;
      el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' }));
      if (search != null) { const s = document.querySelector('.wp-search'); s?.focus(); s?.setSelectionRange(search, search); }
      document.querySelector('.wp-tile.asking .btn.danger')?.focus({ preventScroll: true });
    };
    if (!data && !error) queueMicrotask(load);
    const items = shown();
    const total = items.reduce((s, x) => s + x.bytes, 0);
    const line = (x, cls = '') => x ? h('div', { class: `wp-line ${cls} ${x.bad ? 'bad' : ''}`, role: 'status' }, x.text) : null;
    const where = data ? h('p', { class: 'wp-where faint' },
      `Kept in ${data.dir}`, ' · ', items.length ? `${plural(items.length, 'picture')} · ${mb(total)}` : 'none yet',
      data.demo ? ' · demo' : '') : null;
    const page = h('div', { class: 'wp-page' },
      topbar('Setup', 'Wallpapers', null, null, helpHere('wallpapers')),
      where,
      error ? card([h('h2', {}, 'Wallpapers')], h('p', { class: 'faint' }, `Folder not read: ${error}`))
        : !data ? loadingCard('Wallpapers', 3)
          : card(null,
            h('div', { class: 'wp-tools' },
              items.length ? h('input', { class: 'text wp-search', type: 'search', placeholder: 'Search by name…', 'aria-label': 'Search wallpapers by name', value: query, oninput: (e) => { query = e.target.value; document.querySelector('.wp-grid, .wp-none')?.replaceWith(grid()); } }) : null,
              ...pickers(),
              items.length ? button('Back up all', backupAll, { kind: 'small', ic: 'shield' }) : null,
              items.length && !data.demo ? button('Open folder', () => reveal().catch((e) => { addLine = { text: e.message, bad: true }; rerender(); }), { kind: 'ghost small', ic: 'external' }) : null,
              // back to the plain backdrop behind DeviceHub (shown only while a picture is behind it)
              hasPicture() ? button('Remove background', async () => { await removePicture(); tileLine = { text: 'Background removed.' }; rerender(); }, { kind: 'ghost small', ic: 'x' }) : null,
              h('span', { class: 'spacer' }),
              items.length > 1 ? h('label', { class: 'wp-sort' }, h('span', { class: 'faint' }, 'Sort'),
                dropdown({ label: 'Sort wallpapers', value: sortBy, options: SORTS.map(([k, label]) => ({ value: k, label })),
                  onChange: (v) => { sortBy = v; try { localStorage.setItem('wallpapers.sort', sortBy); } catch {} document.querySelector('.wp-grid, .wp-none')?.replaceWith(grid()); } })) : null,
              items.length ? h('div', { class: 'seg compact wp-size', style: { '--n': 3, '--i': SIZES.findIndex(([k]) => k === tileSize) }, role: 'group', 'aria-label': 'Picture size' },
                h('span', { class: 'seg-thumb' }),
                ...SIZES.map(([k, label]) => h('button', { class: k === tileSize ? 'sel' : '', 'aria-pressed': String(k === tileSize), onclick: () => { tileSize = k; try { localStorage.setItem('wallpapers.size', k); } catch {} rerender(); } }, label))) : null),
            adding ? h('div', { class: 'wp-line wp-progress', role: 'status' }, `Adding ${adding.i} of ${adding.n}…`) : line(addLine),
            line(backupLine),
            line(tileLine),
            windowsLine ? h('div', { class: `wp-line ${windowsLine.bad ? 'bad' : ''}`, role: 'status' }, windowsLine.text, windowsLine.putBack ? button('Undo', putBack, { kind: 'small', ic: 'undo' }) : null) : null,
            items.length ? grid()
              : h('div', { class: 'wp-empty' },
                icon('wallpapers', 'ic wp-empty-ic'),
                h('p', {}, 'Add or drop pictures here.'),
                null)));
    // drop pictures or folders anywhere on the page
    page.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); page.classList.add('wp-drop'); } });
    page.addEventListener('dragleave', (e) => { if (!page.contains(e.relatedTarget)) page.classList.remove('wp-drop'); });
    page.addEventListener('drop', async (e) => { e.preventDefault(); page.classList.remove('wp-drop'); if (!adding) addFiles(await droppedFiles(e.dataTransfer)); });
    return page;
  },
};
