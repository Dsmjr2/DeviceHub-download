// "Get the layout" (22 Oct 2026): a VIA keyboard that VIA's own library does not have (Keychron Pro, Max, HE and 8K
// boards, Lemokey) gets its maker's official VIA file on the person's click. The click is their yes for that one file.
//
// Where from: only the files listed in helpers/via-sources.json (made by helpers/make-via-sources.mjs): Keychron's own
// QMK fork on GitHub, each file pinned to a commit, served by raw.githubusercontent.com. Nothing else is ever asked.
// The rules: HTTPS only; a redirect is followed only to that same host; at most 512 KB; a web page is refused; the
// text must parse as JSON and be a VIA definition for THIS keyboard (its vendorId and productId), with a matrix and
// key positions DeviceHub can draw (public/devices/via-layout.js fromDefinition). Only then is it saved, as
// via-definitions\<VID><PID>.json (the name helpers/via-defs.js looks for). Nothing in it is ever run. A file that
// fails any check is dropped (it was only ever held in memory) and the answer says why in one sentence. A file the
// person put there already is never replaced. DeviceHub reads the layout when it starts, so the answer says to restart.
//
// GET /api/via-fetch?vid=3434&pid=0810: what a click would get ({ file, have, source }). POST /api/via-fetch {vid, pid}:
// gets it. server.js: one line in api() (docs/handoff/via-fetch.md).
import fs from 'fs';
import path from 'path';
import https from 'https';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { fromDefinition } from '../public/devices/via-layout.js';

const require = createRequire(import.meta.url);
const { writeAtomic } = require('./safe-write');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOSTS = ['raw.githubusercontent.com'];
export const MAX_BYTES = 512 * 1024;
const HEX4 = /^[0-9A-F]{4}$/;

const loadSources = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'via-sources.json'), 'utf8')); } catch { return { files: {} }; } };

// the parts that touch the outside world, swappable for tests (tests/via-fetch.mjs)
export const deps = {
  dir: path.join(ROOT, 'via-definitions'),
  sources: loadSources(),
  // one GET, no redirect following here (open() does that): { status, headers, body (a readable stream) }
  request(u) {
    return new Promise((resolve, reject) => {
      const r = https.get(u, { headers: { 'User-Agent': 'DeviceHub' }, timeout: 20000 }, (res) => resolve({ status: res.statusCode, headers: res.headers, body: res }));
      r.on('timeout', () => r.destroy(new Error('the site did not answer')));
      r.on('error', reject);
    });
  },
};

const kb = (n) => (n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB`);
const fileOf = (vid, pid) => `${vid}${pid}.json`;
const ids = (vid, pid) => {
  vid = String(vid || '').toUpperCase(); pid = String(pid || '').toUpperCase();
  if (!HEX4.test(vid) || !HEX4.test(pid)) throw new Error('That is not a USB id.');
  return { vid, pid };
};
export function hostOk(u) {
  let x; try { x = new URL(u); } catch { return 'The download address is not valid, so it was stopped.'; }
  if (x.protocol !== 'https:') return 'The download address was not HTTPS, so it was stopped.';
  if (!HOSTS.includes(x.hostname)) return `The download went to ${x.hostname}, which is not ${HOSTS[0]}, so it was stopped.`;
  return null;
}
const sourceOf = (vid, pid) => {
  const e = deps.sources.files?.[vid + pid];
  if (!e || typeof e.path !== 'string' || !/^[0-9a-f]{40}$/.test(e.commit || '')) return null;
  const repo = deps.sources.sources?.keychron?.repo || 'Keychron/qmk_firmware';
  return { name: e.name || null, size: e.size || null, url: `https://${HOSTS[0]}/${repo}/${e.commit}/${e.path.split('/').map(encodeURIComponent).join('/')}`, host: HOSTS[0], from: 'Keychron\'s own VIA files on GitHub' };
};

// what a click would get
export function plan(vid, pid) {
  ({ vid, pid } = ids(vid, pid));
  const file = fileOf(vid, pid);
  return { vid, pid, file, have: fs.existsSync(path.join(deps.dir, file)), source: sourceOf(vid, pid) };
}

// follows redirects (same host only) and reads at most MAX_BYTES of text
async function download(u) {
  for (let hop = 0; hop < 5; hop++) {
    const bad = hostOk(u);
    if (bad) throw new Error(bad);
    const r = await deps.request(u);
    if (r.status >= 300 && r.status < 400 && r.headers.location) { r.body.resume?.(); u = new URL(r.headers.location, u).href; continue; }
    if (r.status !== 200) { r.body.resume?.(); throw new Error(`The site answered ${r.status}, so nothing was saved.`); }
    const type = String(r.headers['content-type'] || '');
    if (/html/i.test(type)) { r.body.resume?.(); throw new Error('The site sent a web page, not a VIA file, so it was not saved.'); }
    const said = Number(r.headers['content-length']);
    if (said > MAX_BYTES) { r.body.destroy?.(); throw new Error(`The file is larger than ${kb(MAX_BYTES)}, so it was not saved.`); }
    const parts = [];
    let got = 0;
    await new Promise((resolve, reject) => {
      r.body.on('data', (c) => { got += c.length; if (got > MAX_BYTES) { r.body.destroy?.(); reject(new Error(`The file is larger than ${kb(MAX_BYTES)}, so it was not saved.`)); return; } parts.push(c); });
      r.body.on('end', resolve);
      r.body.on('error', () => reject(new Error('The download stopped part way, so nothing was saved.')));
    });
    return { text: Buffer.concat(parts).toString('utf8'), size: got, finalUrl: u };
  }
  throw new Error('The site redirected too many times, so it was stopped.');
}

const hexId = (v) => (typeof v === 'string' && /^0x[0-9a-f]{1,4}$/i.test(v.trim()) ? v.trim().slice(2).toUpperCase().padStart(4, '0') : Number.isInteger(v) && v >= 0 && v <= 0xffff ? v.toString(16).toUpperCase().padStart(4, '0') : null);

// is this text a VIA definition DeviceHub can use for THIS keyboard? -> its layout, or throws one sentence
export function check(text, vid, pid) {
  if (/^\s*</.test(text)) throw new Error('The site sent a web page, not a VIA file, so it was not saved.');
  let def;
  try { def = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error('The file is not valid JSON, so it was not saved.'); }
  if (!def || typeof def !== 'object' || Array.isArray(def)) throw new Error('The file is not a VIA definition, so it was not saved.');
  if (typeof def.name !== 'string' || !def.name.trim()) throw new Error('The file has no keyboard name, so it was not saved.');
  let fv = hexId(def.vendorId), fp = hexId(def.productId);
  if ((!fv || !fp) && Number.isInteger(def.vendorProductId)) { fv = hexId(Math.floor(def.vendorProductId / 65536)); fp = hexId(def.vendorProductId % 65536); }
  if (!fv || !fp) throw new Error('The file does not say which keyboard it is for, so it was not saved.');
  if (fv !== vid || fp !== pid) throw new Error(`The file is for USB ${fv}:${fp}, not this keyboard (${vid}:${pid}), so it was not saved.`);
  if (!def.layouts || typeof def.layouts !== 'object') throw new Error('The file has no key layout, so it was not saved.');
  let layout;
  try { layout = fromDefinition(def); } catch (e) { throw new Error(`The file is not a layout DeviceHub can draw (${e.message}), so it was not saved.`); }
  return layout;
}

let busy = false;
export async function get(vid, pid) {
  ({ vid, pid } = ids(vid, pid));
  const p = plan(vid, pid);
  if (!p.source) return { ok: false, file: p.file, error: 'DeviceHub does not know an official VIA file for this keyboard.' };
  if (p.have) return { ok: false, file: p.file, error: `via-definitions\\${p.file} is already there, so DeviceHub uses that file.` };
  if (busy) return { ok: false, file: p.file, error: 'Another layout is being fetched; try again in a moment.' };
  busy = true;
  try {
    const { text, size, finalUrl } = await download(p.source.url);
    const layout = check(text, vid, pid);
    fs.mkdirSync(deps.dir, { recursive: true });
    const dest = path.join(deps.dir, p.file);
    if (fs.existsSync(dest)) return { ok: false, file: p.file, error: `via-definitions\\${p.file} appeared meanwhile, so it was left as it is.` };
    writeAtomic(dest, text);
    console.log(`[keyboard] ${layout.name}: saved via-definitions\\${p.file} (${kb(size)}) from ${new URL(finalUrl).hostname}`);
    return { ok: true, file: p.file, size, sizeText: kb(size), host: new URL(finalUrl).hostname, url: finalUrl, name: layout.name,
      keys: layout.keys.length, rows: layout.rows, cols: layout.cols, restart: true };
  } catch (e) {
    return { ok: false, file: p.file, error: /^[A-Z]/.test(e.message) ? e.message : `The download failed (${e.message}), so nothing was saved.` };
  } finally { busy = false; }
}

export async function handle(url, req, res, send, readBody) {
  if (url.pathname !== '/api/via-fetch') return false;
  try {
    if (req.method === 'GET') return send(res, 200, plan(url.searchParams.get('vid'), url.searchParams.get('pid'))), true;
    if (req.method === 'POST') { const b = await readBody(req); return send(res, 200, await get(b?.vid, b?.pid)), true; }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
