// Builds the brand guide from docs/brands.json (the researched list, 20 Oct 2026: the 10 most popular brands per
// device type, their USB vendor ids, apps, how they talk, which open projects know them, and the risk):
//   public/core/brands-data.js  what the app uses to name a device it does not run yet (public/core/brands.js)
//   docs/BRANDS.md              the same, to read (for a person, or their Claude Code, adding a device)
// Run after editing docs/brands.json: node helpers/make-brands.mjs
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const j = JSON.parse(fs.readFileSync(new URL('docs/brands.json', root), 'utf8'));
const LABEL = { headset: 'Headsets', mouse: 'Mice', keyboard: 'Keyboards', case: 'Cases, fans and hubs', gpu: 'Graphics cards', cpu: 'CPU coolers', ram: 'Memory (RAM)', motherboard: 'Motherboards' };
const ROUTE = { 'usb-hid': 'USB (vendor messages)', bluetooth: 'Bluetooth', 'windows-dynamic-lighting': 'Windows Dynamic Lighting', 'via-qmk': 'VIA / QMK', 'argb-header': 'board RGB header', 'gpu-i2c': "the graphics card's I2C bus", smbus: "the motherboard's SMBus" };
const brands = [];
for (const [category, list] of Object.entries(j.categories)) {
  for (const b of list) {
    brands.push({
      name: b.name, category, vids: (b.usbVendorIds || []).map((v) => v.toLowerCase()), vendorApp: b.vendorApp || null,
      transport: b.transport || [], openProjects: (b.openProjects || []).map((p) => ({ name: p.project, note: p.note || '' })),
      dynamicLighting: b.dynamicLighting, risk: b.risk, riskWhy: b.reason || '', notes: b.notes || '', measured: b.measured || null,
    });
  }
}
// chip makers whose vendor id many brands share (a match alone does not prove the brand)
const SHARED = { '0cf2': 'ENE', '04d9': 'Holtek', '258a': 'Sinowealth', '048d': 'ITE', '0c45': 'Sonix', '0483': 'STMicroelectronics', '1a86': 'QinHeng', '2433': 'Asetek' };

const data = `// Made by helpers/make-brands.mjs from docs/brands.json; do not edit here.
export const BRANDS = ${JSON.stringify(brands)};
export const SHARED = ${JSON.stringify(SHARED)};
export const LABEL = ${JSON.stringify(LABEL)};
export const ROUTE = ${JSON.stringify(ROUTE)};
export const RESEARCHED = ${JSON.stringify(j.meta?.researched || null)};
`;
fs.writeFileSync(new URL('public/core/brands-data.js', root), data);

const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : v || '?');
let md = `# Device brands: what DeviceHub can target

Made by \`helpers/make-brands.mjs\` from \`docs/brands.json\` (researched ${j.meta?.researched || ''}). For anyone adding a device:
find its maker here, then follow "Adding your own devices" in CLAUDE.md. DeviceHub's rules still apply: never flash
firmware, learn read-only, back up before writing, and never write to the SMBus (motherboard and RAM lights) or a
graphics card's I2C bus directly: those go through OpenRGB, which DeviceHub talks to (Lighting > PC lights).

**Risk** is how likely a wrong write is to hurt the device: low = documented protocol over USB; medium = undocumented
or shared chip ids; high = SMBus / I2C, firmware-only tools, or nothing known.

**Shared chip ids**: ${Object.entries(SHARED).map(([v, n]) => `\`${v}\` ${n}`).join(', ')}. These belong to the chip
maker, not the brand; check the product id and name too.

`;
for (const [category, label] of Object.entries(LABEL)) {
  md += `## ${label}\n\n| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |\n|---|---|---|---|---|---|---|\n`;
  for (const b of brands.filter((x) => x.category === category)) {
    md += `| ${b.name} | ${b.vids.map((v) => `\`${v}\``).join(' ') || (category === 'gpu' || category === 'ram' ? 'none (not USB)' : 'not confirmed')} | ${b.vendorApp || '?'} | ${b.transport.map((t) => ROUTE[t] || t).join(', ')} | ${b.openProjects.map((p) => p.name).join(', ') || 'nothing open'} | ${yesNo(b.dynamicLighting)} | ${b.risk}: ${b.riskWhy} |\n`;
  }
  const notes = brands.filter((x) => x.category === category && x.notes);
  if (notes.length) md += `\n${notes.map((b) => `- **${b.name}**: ${b.notes}`).join('\n')}\n`;
  md += '\n';
}
md += `## Windows Dynamic Lighting\n\n${(j.dynamicLightingFacts || []).map((f) => `- ${f}`).join('\n')}\n\n## OpenRGB\n\n${(j.openRgbFacts || []).map((f) => `- ${f}`).join('\n')}\n\n## Sources\n\n${(j.sources || []).map((s) => `- ${s}`).join('\n')}\n`;
fs.writeFileSync(new URL('docs/BRANDS.md', root), md);
console.log(`brands: ${brands.length} brands, ${new Set(brands.flatMap((b) => b.vids)).size} vendor ids -> public/core/brands-data.js, docs/BRANDS.md`);
