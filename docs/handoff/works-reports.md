# Works on my device, and Turn on settings for all (22 Oct 2026)

Both are built and tested. `npm run test:offline` passes, and so does the new `node tests/works-report.mjs`. Nothing was
committed. DeviceHub was not restarted, so the running copy does not have the new routes yet. No node was killed and
nothing was sent to a device. `settings.js`, `helpers/native/*`, `helpers/hid-host.mjs`, `helpers/learn-wizard.mjs`,
`public/pages/learn.js` and `helpers/make-installer.ps1` were not touched.

## 1. Works on my device

The goal: the library promotes a driver to tested because real people ran it, with no AI and no code review.

**On the device's page** (`public/ui/works-report.js`, used by `public/pages/my-device.js`): the button shows under
Settings when all of these are true. The device is connected. Its driver is from the library, not one made with Learn a
device. Turn on settings is done. At least one setting passed its check. One click asks `GET /api/help/works?id=<device>`
(`helpers/works-report.mjs`, served from `get-help.mjs`'s own `/api/help/` handler) and shows the record in full on the
page. **Open on GitHub** opens a filled-in new issue with the label `works`. It goes through Get help's own
`POST /api/help/open`: the same token, link check and default-browser open. Nothing pops up and DeviceHub sends nothing.

The server checks everything again and refuses with one plain line when:
- the driver is not from the library, or was made with Learn a device;
- the wizard added settings to this copy (`learnedKeys`);
- this copy's driver text is not the library's (different SHA-256);
- Turn on settings is still waiting;
- nothing was checked, or nothing passed.

**The record** (in a ```json block under `### Record` in the issue):
`{ kind: "devicehub-works-report", format: 1, driver, driverSha, date, devicehub, model, firmware, settings, checked }`.
- `driverSha`: the SHA-256 of `device.mjs` (or `driver.json`), with CRLF changed to LF so git line endings do not matter.
- `date`, `firmware` and `devicehub`: taken from the passed check in `verified.json`.
- `settings`: only the keys that passed. Readings and failed settings are left out.
- `model`: `info.Model`, else the driver's title.

Nothing else from `info` is used. The personal check is Share's own (`personalText`) plus Get help's IP check. The one
exception is the firmware, which gets Share's rules only, so a version like `1.0.2.15` is not taken for an IP address.
If anything personal is found, no link is made. `rememberLink(url, check)` in `get-help.mjs` keeps that check with the
token, so `open()` runs it again.

**Accepting reports**: run `node helpers/accept-works-reports.mjs` (add `--apply` to write, or `--from <file>` to read
saved issues).
- It reads open issues with `gh issue list` only. It reads both the ones labeled `works` and the ones titled
  "Works on my device:", because GitHub drops `labels=` from a new-issue link for anyone without triage rights.
- For each issue it checks:
  - the record has exactly the issue fields;
  - `device-library/<driver>` exists and has a valid `device.json`;
  - `driverSha` matches the library's **current** driver;
  - every named setting is one of that driver's written settings (not a reading);
  - `checked` is not more than the driver has;
  - nothing in it is personal;
  - the issue is not already in `tested`;
  - `realRecord` accepts the record it would add.
- Without `--apply` it prints the summary and writes nothing.
- With `--apply` it adds `{ status: "tested", real: true, by: "works report", how, date, devicehub, driver, driverSha,
  model, firmware, settings, checked, issue }` to that entry's `tested`. It also sets `status: "tested"` and
  `updated: <today>` so the next library bundle carries it, and prints the `gh issue close ...` commands.
- It never commits, pushes, closes or comments.

**realRecord** (`helpers/my-devices.mjs`): a record that claims to be a works record (it has `real` or `driverSha`, or
`by: "works report"`) counts **only** in the full shape (`worksRecordProblem`):
- exactly the fields above;
- `real: true` and its own `status: "tested"`;
- `date` as YYYY-MM-DD;
- a 64-hex `driverSha`;
- a model, a firmware (text or null), at least one distinct setting, `checked` of at least that many, and an issue
  number;
- no simulation or "read-only" wording.

`provenCopy` passes the copy's own driver SHA-256, so the record counts only for that exact driver text. Edit the
driver and it waits for Turn on settings again. `installNote` and the Set up card's wording follow the same SHA
(`match()` now returns `driverSha`). Records from `share-device.mjs` (no works fields) keep the old rule unchanged.

Tested in `tests/works-report.mjs` section 5: once a works record has been added, a fresh install is proven, the guarded
driver has `turnOn: false`, and `connect()` runs the self-check with no click.

`a.library` now also carries `learned` (from `guard`), so the page can leave the button off for wizard drivers.

## 2. Turn on settings for all

- The Set up card (`public/pages/overview.js`) shows **Turn on settings for all** when any item is waiting for Turn on
  settings. Beside it is "N devices waiting. Close each maker's app first."
- The button sends `POST /api/diagnose/action { kind: "turn-on-all" }` (`helpers/diagnose.mjs`, which calls
  `helpers/turn-on-all.mjs`).
- It reads `/api/agent/state` fresh. It takes every device whose `adapter.library.turnOn` is true, so library and learned
  drivers both count and built-in slots never do.
- For each connected one it calls `POST /api/agent/turn-on`, **one after another**. That is the same call each device's
  own button makes: the device lock, the maker's app checked first (open or "could not check" means nothing is written),
  a backup first, one setting at a time, read back.
- A device that is not connected is left with the line "not connected, so it was left for later."
- The card shows one line per device ("Acme Glide: settings turned on, 3 of 4 settings passed, 1 stays read-only."), and
  the same line on that device's own item.
- Nothing runs in the background and nothing polls.

## Lines for you to add (I did not edit these files)

**package.json**: add ` && node tests/works-report.mjs` to the end of both `test` and `test:offline`.

**server.js**: nothing. The routes ride on `/api/help/` (`get-help.mjs handle`) and `/api/diagnose/action`.

**CLAUDE.md**, in "Set this up" step 2 after the Turn on settings paragraph:
- "**Works on my device** (docs/handoff/works-reports.md): once a library driver's settings passed their check on a PC,
  its page has a Works on my device button. It shows a small record (driver SHA-256, version, model, firmware, the
  settings that passed; nothing personal) and opens a GitHub issue labeled `works` on the person's click.
  `node helpers/accept-works-reports.mjs [--apply]` (Shawn's copy) checks each report against the library's current
  driver. With --apply it adds a `{ status: "tested", real: true, ... }` record to its device.json and prints the gh
  commands to close the issues. It never commits, pushes or closes anything. Only a works record in that exact shape,
  for that exact driver text, counts as a real-device record (`realRecord`, `worksRecordProblem`)."
- "The Set up card's **Turn on settings for all** presses Turn on settings for every waiting, connected device, one
  after another, the same way as each device's own button."

Under Checks:
- "`node tests/works-report.mjs`: the works record, the accept script and Turn on settings for all."

## For Shawn (one-time, on GitHub; I did not do these)

- Create the label: `gh label create works -R Dsmjr2/DeviceHub-download --description "Works on my device reports"`.
  The repo has no `works` label (or `device-library` label) today. Until it exists, the accept script still finds
  reports by their title.
- Optional: an issue template `.github/ISSUE_TEMPLATE/works.md` with `labels: works` in its front matter. A template
  applies its label for anyone, which a link's `labels=` does not.
- After `--apply`: look over `git diff`, commit, then `node helpers/make-library-bundle.mjs` and upload the bundle. Only
  new installs get the record. An existing copy keeps the `device.json` it was installed with, and has already pressed
  Turn on settings or still can.
