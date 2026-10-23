// Every refusal in Learn a device names what to do next (23 Oct 2026, "learn someone's device with 0 issues"): a
// person without Claude must never be left with only "this cannot be learned". Reads helpers/learn-wizard.mjs and
// checks each refuse(...), throw new Error(...) and why: ... the page can show has a next step in it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'helpers/learn-wizard.mjs'), 'utf8');

// the call's text up to its closing bracket, strings and ${...} skipped over
function callAt(i) {
  let depth = 0, j = src.indexOf('(', i);
  const stack = [];
  for (; j < src.length; j++) {
    const c = src[j], top = stack[stack.length - 1];
    if (top === '`') { if (c === '\\') j++; else if (c === '`') stack.pop(); else if (c === '$' && src[j + 1] === '{') { stack.push('{'); j++; } continue; }
    if (top === "'" || top === '"') { if (c === '\\') j++; else if (c === top) stack.pop(); continue; }
    if (c === "'" || c === '"' || c === '`') { stack.push(c); continue; }
    if (top === '{' && c === '}') { stack.pop(); continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { depth--; if (!depth) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}
const line = (i) => src.slice(0, i).split('\n').length;
// a next step: something the person does, or that nothing is needed
const NEXT = /\b(Record|Learn|Skip|SKIP|Remove|Keep|Check|Make sure|Wake|Unplug|Start|Wait|Nothing to do|Get help|Change|Close|Open|set it to|Enter|Pick|Try|Press|Restart|Install)\b/i;
// thrown inside a helper and caught before the page sees it, or a programming error, not something the person met
const INSIDE = [
  /bytes after its checksum/,             // template(): caught by buildDriver's caller and shown with SKIP
];
const found = [];
for (const re of [/\brefuse\(/g, /throw new Error\(/g, /\bwhy: [[`'"]/g]) {
  for (const m of src.matchAll(re)) {
    if (/^\s*\/\//.test(src.slice(src.lastIndexOf('\n', m.index) + 1, m.index)) || src.slice(m.index - 6, m.index) === 'const ') continue;
    const text = re.source.startsWith('\\bwhy') ? src.slice(m.index, src.indexOf('\n', m.index)) : callAt(m.index);
    found.push({ at: line(m.index), text });
  }
}
let bad = 0;
for (const f of found) {
  if (NEXT.test(f.text) || INSIDE.some((r) => r.test(f.text))) continue;
  // a why passed on from somewhere else (r.why, e.message, v.problems) is checked where it is made
  if (/why: \[\]\.concat\(why\)/.test(f.text)) continue;  // refuse() itself
  if (/why: (r\.why|\[r\.why\]|\[e\.message\]|v\.problems|mv\.problems|\[cc\.why\]|\[inst)/.test(f.text) || /^why: (r|e|v)\./.test(f.text)) continue;
  bad++;
  console.log(`FAIL learn-wizard.mjs:${f.at}: no next step in ${f.text.replace(/\s+/g, ' ').slice(0, 200)}`);
}
if (found.length < 40) { console.log(`FAIL only ${found.length} refusals found: the scan is broken`); bad++; }
if (bad) { console.log(`learn-next-steps: ${bad} refusal(s) without a next step`); process.exit(1); }
console.log(`learn-next-steps: all ${found.length} refusals in Learn a device say what to do next`);
