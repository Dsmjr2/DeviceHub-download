# Handoff: library updates between releases (22 Oct 2026)

Goal (owner): new and changed device-library entries reach every copy by themselves, between app releases, safely.

## What

```
helpers/make-library-bundle.mjs   builds dist\device-library.json, signed (publisher's PC only)
helpers/library-updates.mjs       fetches it once a day / on demand, verifies, writes library-cache\<name>\; the routes
helpers/make-installer.ps1        one marked step "LIBRARY BUNDLE" after the release is signed
tests/library-updates.mjs         offline test against a local http server and a throwaway key pair
```

**The bundle** (`dist\device-library.json`): `{ kind: "devicehub-library-bundle", format: 1, builtAt, list: [{ name,
version, sha256, metaSha256 }], entries: [{ name, version, sha256, meta, mjs }], signature }`. `meta` is the entry's
device.json, `mjs` its device.mjs text, `sha256` that text's SHA-256, `metaSha256` the SHA-256 of `JSON.stringify(meta)`.
`version` is device.json `"updated"` (a date the sharer sets when changing an entry) or else its newest `tested[].date`.
Examples (`_` names) and broken entries are left out. The signature is Ed25519 with the same key file as app releases
(`%APPDATA%\DeviceHub-signing\release-key.pem`), over
`"devicehub-library-bundle/1\n" + JSON.stringify([builtAt, list as [name, version, sha256, metaSha256]])`. An app
release signs `JSON.stringify([commit, builtAt, appCommit, size, sha256])` (starts with `[`), so neither signature can
ever pass as the other. The builder never makes a key; it checks its signature against `helpers/release-public-key.pem`
before writing.

**Publishing:** `make-installer.ps1` now builds it next to version.json. **Upload `dist\device-library.json` beside
`version.json` on the v1.0 release of Dsmjr2/DeviceHub-download** (you do the upload). Between app releases, after
adding or changing an entry: `node helpers/make-library-bundle.mjs`, then upload just that file (replace the old asset).
A real bundle was built to `dist\device-library.json` while checking this (6 entries, verified with the shipped public
key); it was not uploaded. Note from that build: asus-rog-mouse, razer-mouse and steelseries-arctis have no `updated`
or tested date, so a cached copy of them never replaces the shipped one: give an entry `"updated": "YYYY-MM-DD"` when
you change it.

**Fetching** (`helpers/library-updates.mjs`): URL = `DEVICEHUB_RELEASE_URL` (as self-update) or
`https://github.com/Dsmjr2/DeviceHub-download/releases/latest/download/` + `device-library.json`. `schedule()` runs
`checkIfDue()` 3 min after start, then hourly; it only goes out when the last check is 24 h old. `POST
/api/library/update` checks now. State in `library-cache\state.json` (last check, last success, bundle date, errors,
refused entries, last change). Off: `DEVICEHUB_LIBRARY_UPDATES=0` or settings.json `"libraryUpdates": false`.

## How it stays safe

- **Nothing fetched is run** while fetching: no import, eval or child process; the bundle is parsed as JSON and hashed.
  The test's drivers would leave a file if run, and the test checks it never appears. A cached driver runs only the
  way a shipped one does: installed through `installFromLibrary` (which imports it to check its shape) and loaded
  guarded by my-devices.mjs.
- Refused whole, cache untouched: no public key in the copy, unsigned, any change after signing (list, date), another
  key, a bundle signed with the app-release payload, an app release's version.json, not JSON, over 8 MB, and a bundle
  **older** than the newest one already cached (no replaying an old bundle to bring back a withdrawn driver).
- Refused alone (its last good cached copy stays): an entry whose device.mjs or device.json does not match its signed
  SHA-256, whose version differs from the signed list, a driver over 1 MB, or a name that is not one plain folder
  name (`a-z 0-9 -`, no `_`, no dots or slashes, no Windows device names like `nul`).
- Written only under `library-cache\` (never `my-devices\` or `device-library\`): staged in `.incoming-*`, read back,
  then swapped in one folder at a time. An entry a newer signed bundle no longer lists is removed from the cache (only
  folders carrying the cache's own `bundle.json` marker are ever removed).
- Offline, 404, a hung server (20 s timeout) or a write error: the cache stays as it was, the error is in the state.
  Everything is async; one check at a time (a second request joins the running one).

## What to wire (not done: those files belong to others)

**server.js**, the route (beside `/api/library`):
```js
  if (url.pathname.startsWith('/api/library/update')) { try { if (await (await import('./helpers/library-updates.mjs')).handle(url, req, res, send)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
```
and, for the daily check, one more line beside the AUTO SETUP line (~line 701):
```js
      if (process.env.DEVICEHUB_TEST !== '1') import('./helpers/library-updates.mjs').then((m) => m.schedule({ root: ROOT, log: serverLog })).catch((e) => console.error('[library] updates:', e.message));  // LIBRARY UPDATES (helpers/library-updates.mjs)
```
`GET /api/library/updates` -> `{ enabled, checking, cache, lastCheckAt, lastSuccessAt, nextCheckAt, bundleBuiltAt,
entries: [{ name, version, sha256, bundleBuiltAt, vendor, product, kind, status }], lastChange, errors, refused }`.
`POST /api/library/update` -> the same plus `ok`, `changed`, `removed` (200) or `ok: false, error` (502); 409 when off.

**helpers/device-library.mjs** (entries from both folders; the cached one wins only when strictly newer):
```js
import { cacheRoot, entryVersion } from './library-updates.mjs';   // no import cycle: library-updates imports nothing from here

export function list({ root = ROOT, examples = showsExamples() } = {}) {
  const byName = new Map(scan(path.join(root, 'device-library'), examples, 'device-library').map((e) => [e.name, e]));
  for (const c of scan(cacheRoot(root), false, 'library-cache')) {   // the cache never holds examples
    const s = byName.get(c.name);
    if (!s || (s.error && !c.error) || (!c.error && entryVersion(c.meta) > entryVersion(s.meta))) byName.set(c.name, c);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// the current list() body, unchanged, with dir as given and origin on each pushed entry ({ name, dir: d, origin, ... })
function scan(dir, examples, origin) { /* readdirSync(dir) ... return out; */ }
```
`match()` needs nothing (it calls `list()`). `installFromLibrary()`: one change, the marker's
`source: \`device-library/${name}\`` becomes `source: \`${entry.origin}/${name}\``; it already copies from `entry.dir`.
The cache's extra `bundle.json` and `state.json` are ignored by `list()` (it reads directories, device.mjs, device.json).
Newly cached "tested"/"read-only" entries are then installed by auto setup on the next start (or `POST
/api/library/install`).

**.gitignore**: `library-cache/` (it is then out of the zip too; optionally add `'library-cache'` to make-installer's
`$private` list as a second guard).

**package.json**: add ` && node tests/library-updates.mjs` after `node tests/release-signing.mjs` in `test`, and at the
end of `test:offline`.

**CLAUDE.md** Map, after the device-library line:
```
helpers/library-updates.mjs   new/changed library entries between releases: a signed device-library.json (made by
                           helpers/make-library-bundle.mjs, uploaded beside version.json) fetched daily into library-cache\
```

## Untested

- Fetching from the real GitHub release (the redirect to GitHub's file host; `fetch` follows it), and the upload.
- The device-library.mjs merge above (not wired; written against today's list()).
- `schedule()` inside a running DeviceHub (timers are unref'd; tested only through `checkIfDue` with a fake clock).
- A folder swap while antivirus or an open file holds a cached device.mjs (a failed rename is reported as an error
  and the old copy is kept or the stage cleaned, but not exercised).
- `tests/library-updates.mjs`: all good (local server, throwaway keys; checked: good accepted; missing/404, unsigned,
  altered, re-dated, wrong key, app-release-signed, version.json, HTML and older refused with the cache unchanged; a
  tampered entry refused alone; withdrawal; offline and hung server keep the cache; once a day; off switch; routes).
