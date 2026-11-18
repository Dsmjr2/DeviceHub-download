// Offline test (15 Nov 2026 bug hunt): a slider (and a stepper) whose change was refused shows the old value again at
// once. It kept showing the refused one (the thumb and its number) until the page next redrew, which on an open
// Overview tile, hovered or focused, could be much later (public/ui/controls.js). A tiny stand-in DOM, no browser.
class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag; this.kids = []; this.attrs = {}; this.listeners = {}; this.dataset = {}; this._text = ''; this.value = '';
    this.style = { setProperty: (k, v) => { this.style[k] = v; } };
    const cls = new Set(); this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ?? !cls.has(c) ? cls.add(c) : cls.delete(c)) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(t, e = {}) { return Promise.all((this.listeners[t] || []).map((fn) => fn({ target: this, preventDefault() {}, stopPropagation() {}, ...e }))); }
  append(...k) { for (const x of k.flat()) if (x != null && x !== false) this.kids.push(typeof x === 'object' ? x : { text: String(x) }); }
  appendChild(x) { this.kids.push(x); return x; }
  set textContent(v) { this._text = String(v); this.kids = []; }
  get textContent() { return this._text || this.kids.map((k) => k.textContent ?? k.text ?? '').join(''); }
  set innerHTML(v) { this._text = String(v); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
globalThis.document = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: (t) => ({ text: String(t), textContent: String(t) }), addEventListener() {}, removeEventListener() {} };
globalThis.window = globalThis;
const { slider, stepper } = await import('../public/ui/controls.js');

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (el, tag) => (el.tagName === tag ? el : el.kids.map((k) => (k instanceof El ? find(k, tag) : null)).find(Boolean));

try {
  // a slider: refused, then accepted
  let refuse = true;
  const s = slider({ value: 40, min: 0, max: 100, unit: '%', onCommit: async (v) => { if (refuse) throw new Error('Windows reports 54 after setting 55'); return v; } });
  const input = find(s, 'input'), out = find(s, 'output');
  input.value = '55';
  await input.dispatch('input');
  check(out.textContent === '55%', 'while dragging it shows the new value');
  await input.dispatch('change');
  await wait(10);
  check(Number(input.value) === 40, `refused: the thumb goes back to 40 (${input.value})`);
  check(out.textContent === '40%', `refused: its number goes back to 40% (${out.textContent})`);
  refuse = false;
  input.value = '60';
  await input.dispatch('input');
  await input.dispatch('change');
  await wait(10);
  check(Number(input.value) === 60 && out.textContent === '60%', 'accepted: it stays where it was put');

  // a stepper: refused
  const st = stepper({ value: 5, min: 0, max: 10, onCommit: async () => { throw new Error('refused'); } });
  const box = find(st, 'input');
  box.value = '7';
  await box.dispatch('blur');
  await wait(10);
  check(Number(box.value) === 5, `a stepper refused goes back to 5 (${box.value})`);
} catch (e) {
  fails.push(`threw: ${e.stack}`);
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`slider-revert (a refused slider or stepper shows the old value at once): all ${n} passed`);
process.exit(0);
