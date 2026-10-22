// Builds helpers/via-sources.json (22 Oct 2026): where "Get the layout" (helpers/via-fetch.mjs) finds the official VIA
// file of a keyboard that VIA's own library does not have. A maintainer's tool, run by hand; DeviceHub never runs it.
//
// The source: Keychron's own QMK fork (github.com/Keychron/qmk_firmware), whose boards keep their VIA files in
// keyboards/<maker>/<board>/via_json/*.json. The file names do not carry the USB id, so each file is read once here and
// listed by its own vendorId + productId. Every path is pinned to a commit (not a branch), so the URL always serves the
// exact file that was read. Branches are read in the order below; the first file seen for an id wins.
//
// Run: node helpers/make-via-sources.mjs   (reads GitHub: one tree listing per branch, then every via_json file)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'helpers', 'via-sources.json');
const REPO = 'Keychron/qmk_firmware';
const BRANCHES = ['2025q3', 'wireless_playground', 'hall_effect_playground', 'wls_2025q1', 'playground', 'bluetooth_playground'];
const VIA_FILE = /^keyboards\/(keychron|lemokey)\/.+\/via_json\/[^/]+\.json$/i;
const HEX4 = /^0x[0-9a-f]{1,4}$/i;

const get = async (u, json = true) => {
  const r = await fetch(u, { headers: { 'User-Agent': 'DeviceHub' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return json ? r.json() : r.text();
};
const hex = (v) => (typeof v === 'string' && HEX4.test(v) ? v.slice(2).toUpperCase().padStart(4, '0') : null);

const files = {};
const branches = [];
for (const branch of BRANCHES) {
  const commit = (await get(`https://api.github.com/repos/${REPO}/commits/${branch}`)).sha;
  const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) console.log(`${branch}: the tree listing was cut short; some files are missing`);
  const paths = tree.tree.filter((t) => t.type === 'blob' && VIA_FILE.test(t.path)).map((t) => ({ path: t.path, size: t.size }));
  let added = 0;
  for (let i = 0; i < paths.length; i += 8) {
    await Promise.all(paths.slice(i, i + 8).map(async (p) => {
      try {
        const def = JSON.parse(await get(`https://raw.githubusercontent.com/${REPO}/${commit}/${p.path}`, false));
        const vid = hex(def.vendorId), pid = hex(def.productId);
        if (!vid || !pid || !def.matrix || !def.layouts) return;
        const id = vid + pid;
        if (files[id]) return;
        files[id] = { name: String(def.name || '').slice(0, 80), commit, path: p.path, size: p.size };
        added++;
      } catch (e) { console.log(`  skipped ${p.path}: ${e.message}`); }
    }));
  }
  branches.push({ branch, commit, files: paths.length, added });
  console.log(`${branch} @ ${commit.slice(0, 10)}: ${paths.length} files, ${added} new ids`);
}

const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
fs.writeFileSync(OUT, JSON.stringify({
  about: 'Official VIA files for keyboards VIA\'s own library does not have. Made by helpers/make-via-sources.mjs; read by helpers/via-fetch.mjs. Key: <VID><PID>.',
  made: new Date().toISOString().slice(0, 10),
  sources: { keychron: { repo: REPO, raw: `https://raw.githubusercontent.com/${REPO}/<commit>/<path>`, branches } },
  files: sorted,
}, null, 1) + '\n');
console.log(`${Object.keys(sorted).length} keyboards written to ${path.relative(ROOT, OUT)}`);
