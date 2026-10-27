// Readable version numbers and a short what's-new list (27 Oct 2026, Shawn: friends saw commit ids like 003fa1d).
// helpers/published-version.json holds the version this code is: { version: "1.5", commit, notes }. Each publish
// (helpers/publish-release.ps1) adds 1 to the number after the dot ("1.4" -> "1.5"; the first number moves only when
// Shawn changes it by hand) and lists what changed since the last publish from the commit subjects in between, cut to
// at most 5 short lines. helpers/sign-release.mjs copies version and notes into version.json, signed; the update pop-up
// and Settings > DeviceHub updates show "DeviceHub 1.5" and the lines.
//   node helpers/release-notes.mjs --dry-run   what the next publish would write (changes nothing)
//   node helpers/release-notes.mjs --bump      writes helpers/published-version.json for the next publish, prints the version
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILE = path.join(ROOT, 'helpers', 'published-version.json');
export const MAX_NOTES = 5, MAX_CHARS = 70;

// "1.4" -> "1.5"; anything else starts at "1.0"
export function nextVersion(v) {
  const m = /^(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  return m ? `${Number(m[1])}.${Number(m[2]) + 1}` : '1.0';
}
export const validVersion = (v) => typeof v === 'string' && /^\d{1,4}\.\d{1,6}$/.test(v);

// subjects about the project itself, not something a friend sees, and the publish commits themselves
const INTERNAL = [/^DeviceHub \d+\.\d+$/, /^Merge\b/i, /\bgitignore\b|\bout of git\b/i, /\b(tests?|CI|journal|README|CLAUDE\.md|handoff|refactor|typo|lint|wip)\b/i];
// British spellings in Shawn's subjects, in US English for the list
const US = [[/colour/gi, 'color'], [/behaviour/gi, 'behavior'], [/favourite/gi, 'favorite'], [/organis/gi, 'organiz'], [/recognis/gi, 'recogniz'], [/licence/gi, 'license'], [/centre/gi, 'center'], [/cancelled/gi, 'canceled']];
const keepCase = (from, to) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

// one subject -> one plain line of at most MAX_CHARS
export function shortLine(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim().replace(/[.;:,\s]+$/, '');
  for (const [re, to] of US) t = t.replace(re, (m) => keepCase(m, to));
  if (t.length > MAX_CHARS) { const first = t.split(/;\s+/)[0]; if (first.length >= 15) t = first; }
  if (t.length > MAX_CHARS) { const cut = t.slice(0, MAX_CHARS - 1); t = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '')}…`; }
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

// commit subjects (newest first) -> at most MAX_NOTES lines; a longer list ends with "Plus N more fixes and improvements"
export function notesFrom(subjects) {
  const seen = new Set(), lines = [];
  for (const s of subjects || []) {
    if (!s || INTERNAL.some((re) => re.test(s.trim()))) continue;
    const l = shortLine(s), k = l.toLowerCase();
    if (l && !seen.has(k)) { seen.add(k); lines.push(l); }
  }
  if (!lines.length) return ['Small fixes and improvements'];
  if (lines.length <= MAX_NOTES) return lines;
  const more = lines.length - (MAX_NOTES - 1);
  return [...lines.slice(0, MAX_NOTES - 1), `Plus ${more} more fixes and improvements`];
}
// what a client shows: only plain strings, at most MAX_NOTES, each cut to a sane length (version.json is signed, but a
// copy never trusts a list to be short)
export const cleanNotes = (n) => (Array.isArray(n) ? n.filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX_NOTES).map((x) => x.trim().slice(0, 120)) : []);

export function readPublished(file = FILE) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); return validVersion(v?.version) ? v : null; } catch { return null; }
}

// the next publish: { version, commit, notes } from the last one and the commits since its commit
export function plan({ cwd = ROOT, file = FILE } = {}) {
  const last = readPublished(file);
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
  const head = git(['rev-parse', '--short=12', 'HEAD']);
  let subjects = [];
  try { subjects = git(['log', '--no-merges', '--format=%s', `${last.commit}..HEAD`]).split(/\r?\n/); }
  catch { subjects = git(['log', '--no-merges', '--format=%s', '-n', '10', 'HEAD']).split(/\r?\n/); }   // no last publish known
  return { version: nextVersion(last?.version), commit: head, notes: notesFrom(subjects.filter(Boolean)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const p = plan();
  if (process.argv.includes('--bump')) {
    fs.writeFileSync(FILE, `${JSON.stringify(p, null, 2)}\n`);
    console.log(p.version);
  } else if (process.argv.includes('--dry-run')) {
    console.log(`DeviceHub ${p.version} (after ${readPublished()?.version || 'none'}; changes since ${readPublished()?.commit || 'the last 10 commits'})`);
    for (const n of p.notes) console.log(`  - ${n}`);
  } else { console.error('usage: node helpers/release-notes.mjs --dry-run | --bump'); process.exit(2); }
}
