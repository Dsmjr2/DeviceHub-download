// The brand guide (20 Oct 2026): names the maker of a device DeviceHub does not run yet, and says how it talks, which
// open projects already know it and how risky writing to it is. The data is made from docs/brands.json by
// helpers/make-brands.mjs (the 10 most popular brands per device type); docs/BRANDS.md is the readable copy.
import { BRANDS, SHARED, LABEL, ROUTE } from './brands-data.js';

export { BRANDS, LABEL, ROUTE };
export const RISK_TEXT = { low: 'low', medium: 'medium', high: 'high (a wrong write can damage it)' };
const RANK = { low: 0, medium: 1, high: 2 };

// One brand across the device types it makes (Corsair: headsets, mice, keyboards, cases, coolers...), merged.
function merged(list) {
  if (!list.length) return null;
  const first = list[0];
  const projects = new Map();
  for (const b of list) for (const p of b.openProjects) if (!projects.has(p.name)) projects.set(p.name, p);
  return {
    name: first.name.replace(/\s*\(.*\)$/, ''), categories: [...new Set(list.map((b) => b.category))],
    category: list.map((b) => b.category).map((c) => LABEL[c] || c).filter((x, i, a) => a.indexOf(x) === i).join(', '),
    vendorApp: first.vendorApp, transport: [...new Set(list.flatMap((b) => b.transport))], openProjects: [...projects.values()],
    risk: list.map((b) => b.risk).sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0], riskWhy: first.riskWhy, notes: first.notes,
    dynamicLighting: list.some((b) => b.dynamicLighting === true) ? true : list.some((b) => b.dynamicLighting === 'some models') ? 'some models' : first.dynamicLighting,
  };
}

// By USB vendor id ("046d"). A chip maker's shared id names the chip and the brands known to use it.
export function brandForUsb(vid) {
  const v = String(vid || '').toLowerCase();
  if (!v) return null;
  const hits = BRANDS.filter((b) => b.vids.includes(v));
  if (SHARED[v]) {
    const users = [...new Set(hits.map((b) => b.name.replace(/\s*\(.*\)$/, '')))];
    const m = merged(hits) || { categories: [], category: 'USB device', openProjects: [], transport: ['usb-hid'] };
    return { ...m, name: `${SHARED[v]} chip`, shared: true, notes: `A chip many makers use${users.length ? ` (${users.join(', ')} among them)` : ''}: the product id and name say which.` };
  }
  // several brands under one id are one company's lines (Logitech, Corsair...): keep the first brand's own entries
  const name = hits[0]?.name.replace(/\s*\(.*\)$/, '');
  return merged(hits.filter((b) => b.name.replace(/\s*\(.*\)$/, '') === name));
}

// By a maker's name as Windows reports it ("Gigabyte Technology Co., Ltd.", "MSI"), within one device type.
const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9!.]+/).filter((w) => w.length >= 3 && !['the', 'and', 'incl', 'legacy', 'series', 'technology', 'computer'].includes(w));
// the company names Windows reports for the brands' own names
const ALIAS = [[/asustek/i, 'asus'], [/micro-star|\bmsi\b/i, 'msi'], [/giga-?byte/i, 'gigabyte'], [/evga/i, 'evga'], [/asrock/i, 'asrock'], [/g\.?skill/i, 'g.skill']];
export function brandNamed(text, category) {
  const t = [...words(text), ...ALIAS.filter(([re]) => re.test(text || '')).map(([, w]) => w)];
  if (!t.length) return null;
  const fits = (b) => words(b.name).some((w) => t.includes(w));
  const inType = BRANDS.filter((b) => b.category === category && fits(b));
  return merged(inType.length ? inType.slice(0, 1) : BRANDS.filter(fits).slice(0, 1));
}
