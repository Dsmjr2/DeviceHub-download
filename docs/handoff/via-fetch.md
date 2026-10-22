# Get the layout (22 Oct 2026)

A VIA keyboard that VIA's own library does not have (Keychron Pro, Max, HE and 8K boards, Lemokey) now gets a
**Get the layout** button next to the via-definitions note (Keyboard page while no keyboard runs, and Lighting > This
PC). The person's click is their yes for that one file. DeviceHub gets the maker's official VIA file, checks it, and
saves it as `via-definitions\<VID><PID>.json`, the name `helpers/via-defs.js` already looks for.

## Where the file comes from, and why

- **VIA's compiled v3 definitions** are published at `https://usevia.app/definitions/v3/<vendorProductId>.json`.
  `helpers/via-defs.js` already asks there by itself when DeviceHub starts. For a board VIA does not carry it answers its
  web page, not JSON. They are not on GitHub in compiled form.
- **the-via/keyboards** (GitHub, the source of the above) has 31 Keychron folders under `v3/keychron/`, all wired Q, V,
  C Pro, Q0 and S1 boards. No Pro, Max, HE or 8K board is there, so it adds nothing to what usevia.app already gives.
- **Keychron's own QMK fork** (`github.com/Keychron/qmk_firmware`) keeps each board's VIA file in
  `keyboards/<keychron|lemokey>/<board>/via_json/*.json`, as plain JSON on `raw.githubusercontent.com`. This is the
  source. (Keychron's website hands out the same files as `.zip` files on `cdn.shopify.com`, with names that change.
  That is not used.)

The file names do not carry the USB id, so `helpers/make-via-sources.mjs` (a maintainer's tool, run by hand) read
every via_json file once and wrote `helpers/via-sources.json`: 402 keyboards, keyed `<VID><PID>`, each with its name,
size and path **pinned to a commit**. The URL layout is
`https://raw.githubusercontent.com/Keychron/qmk_firmware/<commit>/<path>`. Branches read, first file seen for an id
wins: `2025q3` (Keychron's default; 277 ids), `wireless_playground` (85, the Pro boards such as the Q1 Pro and K2
Pro), `wls_2025q1` (18), `playground` (22); `hall_effect_playground` and `bluetooth_playground` added nothing new.
Re-run `node helpers/make-via-sources.mjs` to pick up new boards. All 402 files were fetched once and passed the same
check the button uses.

## What happens on the click (`helpers/via-fetch.mjs`)

1. Only a keyboard listed in `via-sources.json` gets the button. A file already in via-definitions is never replaced
   (the line then says it is there and to restart if the keys still do not show).
2. HTTPS only. A redirect is followed only to `raw.githubusercontent.com` (at most 5). The download is held in memory,
   at most 512 KB (refused when Content-Length says more, or when more arrives). An HTML type or a body that starts
   with `<` is refused.
3. The text must parse as JSON with a `name`, a `vendorId` and `productId` (or a compiled `vendorProductId`) equal to
   THIS keyboard's vid and pid, a `layouts` object, and a matrix and keys that `fromDefinition` in
   `public/devices/via-layout.js` can draw (at least 10 keys). Nothing in it is run.
4. Only then is it written (`helpers/safe-write.js`). Any failure saves nothing and returns one sentence, such as "The
   file is for USB 3434:0999, not this keyboard (3434:0811), so it was not saved."
5. The line before the click names the file, the keyboard, its size, the host and the source. The line after names the
   file, its real size and the host, and says to restart DeviceHub. The agent reads the layout only when it starts
   (`helpers/agent.mjs`), so a restart is needed. A live reload would mean swapping the keyboard slot's adapter while
   it runs, which is not simple.

No popups, notifications or hover text. The page shows the lines in place.

## Maker files can now be drawn (`public/devices/via-kle.js`)

Before this, `fromDefinition` read only VIA's compiled format (`layouts.keys`). A maker's file (and any file a person
placed by hand) draws its keys as a keyboard-layout-editor drawing (`layouts.keymap`) and was refused with "the
definition has no key positions". `via-kle.js` turns the drawing into the same key list. It was written from the KLE
and VIA format descriptions; VIA's own reader is GPL-3 and was not copied. It gives exactly what usevia.app's compiled
files give for the Q1 v2 ANSI knob, ISO and JIS knob boards: the same keys, positions, sizes and layout options.

## Files

- New: `helpers/via-fetch.mjs`, `helpers/via-sources.json`, `helpers/make-via-sources.mjs`,
  `public/devices/via-kle.js`, `tests/via-fetch.mjs`.
- Changed: `public/devices/via-layout.js` (reads `layouts.keymap` through via-kle.js), `public/pages/keyboard.js`
  (`viaFileNote`: the button and its lines; used by pc-lights.js too).

## Routes

- `GET /api/via-fetch?vid=3434&pid=0810` returns `{ vid, pid, file, have, source: { name, size, url, host, from } | null }`.
- `POST /api/via-fetch {vid, pid}` returns `{ ok: true, file, size, sizeText, host, url, name, keys, rows, cols, restart }`,
  or `{ ok: false, file, error }`.

**server.js: one line in `api()`, beside the installers line (about line 540):**

```js
  if (url.pathname.startsWith('/api/via-fetch')) { try { if (await (await import('./helpers/via-fetch.mjs')).handle(url, req, res, send, readBody)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
```

Until that line is in and DeviceHub restarts, the page's GET fails quietly and the note shows as before.

## Tests

`node tests/via-fetch.mjs` runs offline. A local stand-in server plays raw.githubusercontent.com: the request
stand-in sends each `https://raw.githubusercontent.com/...` address to it, so the real host and HTTPS checks run
unchanged. It covers a good file saved exactly as served, a same-host redirect, wrong vid/pid, too big (with and
without Content-Length), off-host and plain-HTTP redirects (nothing asked there), HTML by type and by body, bad JSON,
too few keys, an existing file kept, no known source, a bad id, the route, the KLE positions and layout options, and
the shipped index's shape. `npm run test:offline` passes.

**package.json (not edited):** add ` && node tests/via-fetch.mjs` to both `test` (before `&& node tests/pages.mjs`)
and `test:offline` (at the end).

## CLAUDE.md lines (for whoever owns it)

- In "Adding your own devices" step 2, the VIA bullet, after "...placed in `via-definitions\<VID><PID>.json`":
  `A board VIA's library lacks (Keychron Pro, Max, HE, 8K; Lemokey) has a **Get the layout** button by that note: it
  gets Keychron's official file from raw.githubusercontent.com (helpers/via-sources.json, pinned commits; rebuilt with
  node helpers/make-via-sources.mjs), checks it is for that vid/pid and drawable, saves it, then DeviceHub needs a
  restart (docs/handoff/via-fetch.md). Maker files in the KLE format (layouts.keymap) are read by public/devices/via-kle.js.`
- Map: `helpers/via-fetch.mjs      Get the layout: a VIA keyboard's official file on the person's click, checked, then saved`

## Not done

- `docs/brands/keychron.md` and `helpers/auto-setup.mjs`'s "a VIA keyboard ... works with no setup" line still say
  Keychron Pro/Max boards need the maker's file by hand.
- The page still shows the note from the brand guide, not from the agent's real "no layout" failure (see
  wording-docs.md, "Not done").
- Not tried on a real Keychron board (none here). A real fetch of five files (Q1 Pro, Q1 Max, K2 Pro, Q1 HE, Lemokey
  P1 HE) into a scratch folder worked and drew 82 to 84 keys each.
