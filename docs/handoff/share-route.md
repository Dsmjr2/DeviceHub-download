# Handoff: "Share this driver" with one click (22 Oct 2026)

Goal (owner: break away from needing Claude): someone whose added device works shares its driver from DeviceHub's own
page. They don't need a command line or Claude for it.

## What

```
helpers/share-route.mjs      POST /api/share/check, /api/share/prepare, /api/share/open-folder
public/pages/my-device.js    the "Share this driver" button and its dialogs (top of the file + the Device card)
tests/share-route.mjs        offline test in TEMP: clean -> package + link; long -> attach fallback; personal -> refused
```

- `POST /api/share/check {name}` (name = the `my-devices` folder) runs `share-device.mjs`'s `shareDevice()` into a throwaway
  work folder and deletes it. The scan, the driver check and the vid/pid rules are the CLI's own.
  It returns `{ ok, entry, title, kind, usb, works, status, statusWhy, shared, stays, checked, next }`. On a refusal it
  returns `{ ok: false, error, refused: [{ file, line, why, text, fix }] }` (HTTP 200; a bad request is 400).
- `POST /api/share/prepare {name, by}` builds the same entry and moves it to `share-staging/<entry>/`, replacing any
  earlier package of that entry. That folder holds `device.mjs`, `device.json` and `<entry>.device.mjs.txt`, a copy to
  attach, because GitHub does not take `.mjs` attachments. The response adds `{ folder, files: {'device.json',
  'device.mjs'}, method: 'issue'|'attach', url, attach, steps }`. `by` is cleaned (control characters removed, 40
  characters at most), and an e-mail address, link or path is refused.
- `POST /api/share/open-folder {entry}` opens `share-staging/<entry>` in Explorer. It accepts only a prepared entry name.
- Status: it is "tested" only when every setting in the driver has `ok: true` in `my-devices/<name>/verified.json`
  (and its `driver` field matches, when present). Otherwise it is "read-only", and `statusWhy` says why in plain words.
- Nothing is ever sent. The page calls `window.open(url)`, the person reads the filled-in issue on GitHub and presses
  Submit. If the browser blocks the new window, the follow-up dialog also shows the link.

### The page

The button appears in the Device card when the device is connected and at least one of its settings has been read.
A read-only driver whose reads work counts. The flow:

1. Run the check.
2. If it passes, a modal lists what is shared, what stays on this PC, "nothing personal" (the list of things checked),
   the status and why, and what happens next. It also has a field for an optional public name.
3. "Open GitHub" runs prepare and opens the link. On the attach fallback it also opens the folder.
4. A last modal gives the steps, the link and the saved folder.

A refusal modal lists each file and line, why it was refused, and how to fix it. Demo mode only shows a toast. The page
calls `fetch` directly, not `env.api`, because `env.api` throws on any body that has an `error` field, and a refusal is
a normal answer.

## The GitHub link and its limits

- `https://github.com/Dsmjr2/DeviceHub-download/issues/new?title=…&labels=device-library&body=…`. GitHub fills in the
  title and body from the query string. `labels` (like `assignees` and `milestone`) only applies when the person has
  triage rights on the repository, and GitHub drops it without a word otherwise, so it is only a hint.
- Length: GitHub (and browsers) fail on very long URLs, usually with HTTP 414 or a cut-off body. The practical limit is
  about 8 KB, so `MAX_URL = 8000` characters, measured on the encoded link.
- If the whole link fits (the body holds device.json and the driver, each in a code block whose fence is longer than any
  backtick run inside), `method: 'issue'`.
- If it does not fit, `method: 'attach'`. The body holds device.json and asks the person to drag
  `<entry>.device.mjs.txt` into the issue, and the page opens that folder. If even that is too long (a huge device.json),
  the body shrinks to a short note asking for both files to be attached. Every link is at most `MAX_URL` (tested).
- Not used: the "new file" page (`/new/app?filename=…&value=…`). It does fork the repository automatically and offer a
  pull request, but it takes one file per pull request (device.json and device.mjs are two), it hits the same URL limit,
  and `value` is undocumented.

## Lines to add (not done; owner's files)

- server.js, beside the `/api/library` routes (before the static-file handler):
  ```js
  if (url.pathname.startsWith('/api/share/') && await (await import('./helpers/share-route.mjs')).handle(url, req, res, send, readBody)) return;
  ```
- package.json: add `&& node tests/share-route.mjs` to both `test` and `test:offline`, after `node tests/device-library.mjs`.
- .gitignore:
  ```
  # drivers prepared for sharing (helpers/share-route.mjs): the person's, sent only by them
  share-staging/
  ```
  The installer and release lists should leave out `share-staging/` as well. I haven't checked how
  `make-installer.ps1` picks its files.
- CLAUDE.md, step 7 of "Adding your own devices", and the Map:
  `Or press "Share this driver" on the device's page (helpers/share-route.mjs): the same check, then GitHub opens with the submission filled in and the person presses Submit.`

## Notes for share-device.mjs / my-devices.mjs (not changed: not mine)

- Only library-installed drivers have a `verified.json`, because `guard()` runs the self-check only for folders with
  `library.json`. A person's own driver is therefore always shared as "read-only", even after `soak-test.mjs` has
  proven every setting. To fix this, either `soak-test.mjs` writes `verified.json` in the same shape, or the self-check
  also runs, read-only-gated, for the person's own drivers on request.
- `shareDevice(folder)` first tries `path.resolve(folder)`, which is relative to the current directory, and only then
  `my-devices/<folder>`. A same-named folder in the current directory would win. The route always passes the absolute
  path.
- `--by` is not scanned for an e-mail address in the CLI. The route refuses one.
- The scan refuses the whole folder over a file that would never be shipped (for example `backups/` inside it). That is
  intended and kept, and the refusal tells the person to move it out.

## Untested

- The live route through server.js (the line above is not added). DeviceHub was not restarted.
- The button and dialogs in a real window. `tests/pages.mjs` opens the pages, but no added device is loaded there.
- GitHub itself: no network was used, so these are unconfirmed:
  - that `DeviceHub-download` has Issues turned on;
  - that it has no issue-form-only setup that ignores `body`;
  - the exact 414 threshold;
  - that the `device-library` label exists.
- Whether `window.open` from a modal button is allowed after the prepare request in DeviceHub's app window. The
  follow-up dialog's link covers a blocked window.
- Not caused by this job: `tests/device-library.mjs` currently fails. The shipped entries asus-rog-mouse, razer-mouse and
  steelseries-arctis have `tested` lists without date or devicehub fields. That is another job's files.
