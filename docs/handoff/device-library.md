# Handoff: the device library (22 Oct 2026)

Goal: what one person's Claude learns about a device becomes a driver the next person with the same device gets.

## Layout (all new)

```
device-library/README.md                 what an entry is, status meanings, how to add one
device-library/_example-light/           the one entry: a PRETEND light (FFFF:FFE0), demo/test only
  device.mjs                             my-devices/_example with its own id "example-library-light"
  device.json                            vid, pids, models, kind, works, doesNotWork, status, tested[{by,date,devicehub,how}]
helpers/device-library.mjs               read-only matching + installFromLibrary
helpers/share-device.mjs                 my-devices folder -> library entry (CLI + shareDevice())
tests/device-library.mjs                 offline test, TEMP folder only
```

No real driver is in the library (none exist yet besides the built-ins).

## API (`helpers/device-library.mjs`, ES module)

- `list({ root, examples })` -> `[{ name, dir, meta, error? }]`. Entries starting with `_` only when
  `examples` (default: `DEVICEHUB_EXAMPLE_DEVICE === '1'`).
- `match(usb, { root, examples })` -> `[{ name, meta, matched: [{vid,pid,name}], installed, installable, why }]`.
  `usb` is `/api/pc`'s `usb` list (`pcMap.get().usb`); vid/pid compared as 4-digit lowercase hex, any of `pids`.
  `installable` only for `status: "tested"` and no `my-devices/<name>` yet.
- `installFromLibrary(name, { root, examples })` (async) -> `{ ok: true, name, to, id }` or `{ ok: false, error }`.
  Refuses: bad name (no path tricks), missing/broken entry, status not "tested", examples outside demo/test,
  a device.mjs that fails `my-devices.mjs`'s `problem()` or whose id differs from device.json, and an existing
  `my-devices/<name>` (checked, then `mkdirSync` without recursive + `COPYFILE_EXCL`, so it never overwrites).
  Copies device.mjs and device.json only, only into `my-devices/`.
- `validateMeta(meta)`, `devicehubVersion(root)` (release.json `commit`, else package.json `version`), `STATUSES`.

`helpers/share-device.mjs`:
`node helpers/share-device.mjs <folder> [--status tested|read-only|untested] [--by <public name>] [--vendor] [--product] [--name] [--vid] [--pid a,b] [--model a,b] [--works "a;b"] [--how]`.
A bare name means `my-devices/<name>`. Scans every file first and refuses the whole share (listing file and line) on:
backups/captures/logs/dumps folders; `*.pcap/.pcapng/.etl/.har`; `*.log/.jsonl/.csv/.bak/.dmp/.bin/...`; files named
like backup/dump/capture/settings/profile/serial/history; binary or >2 MB files; and inside text: `C:\Users\<name>`
or `/Users|/home/<name>` paths, `serial... = "..."`, Windows instance ids (`VID_x&PID_y\<serial>`), MAC addresses,
e-mail addresses (example.com allowed), and this PC's user name, USERNAME/USER, COMPUTERNAME and hostname (3+
characters, generic words skipped). Then it imports the driver, checks `problem()`, takes vid/pid from `hid`
(and `cablePid`) or an existing device.json or the flags, writes `device-library/<vendor-product>/` (never over an
existing one), copies only device.mjs, writes device.json, lists files it left out, and prints the pull-request
steps (fork github.com/Dsmjr2/DeviceHub-download, upload the folder to a branch off `app`, open the PR). Status
defaults to `untested`. It never pushes or sends anything. Exported: `shareDevice()`, `scanFolder()`, `personalNames()`.

## Test result

`node tests/device-library.mjs` -> `device-library (find, install, share): all good` (34 checks: shipped entries well
formed, example hidden/refused outside demo/test, matching by vid + any pid, read-only and broken entries not
installable, install lands and loads through `my-devices.mjs`'s `load()`, install refuses to overwrite a changed
folder, share makes a valid entry with only device.mjs + device.json, share refuses an existing entry, and a
personal folder is refused for each of 11 reasons with nothing written). Also run: `tests/my-devices.mjs` and
`tests/check.mjs` still all good (check.mjs lists git-tracked files, so it sees the new files once committed). The CLI
was tried on a TEMP folder with a backups folder, a .pcap and a user path: refused, all three listed, exit 1.

## What to wire (not done: those files are not mine)

1. **package.json**: add `node tests/device-library.mjs` after `node tests/my-devices.mjs` in both `test` and
   `test:offline`.
2. **helpers/my-devices.mjs** (so the installed example loads in demo/test; real entries need no change, they are
   ordinary folders): in `load()`, replace
   `if (/^[_.]/.test(name) && !(name === '_example' && process.env.DEVICEHUB_EXAMPLE_DEVICE === '1')) continue;`
   with
   `if (/^[_.]/.test(name) && !(/^_example(-[a-z0-9-]+)?$/.test(name) && process.env.DEVICEHUB_EXAMPLE_DEVICE === '1')) continue;`
   (ids differ, `example-light` vs `example-library-light`, so both load together).
   Loading straight from `device-library/` is deliberately NOT proposed: installing copies the driver into the
   person's own folder, which updates never touch.
3. **server.js** (CommonJS, so `await import('./helpers/device-library.mjs')`), next to `/api/pc`:
   - `GET /api/library` -> `lib.match((await pcMap.get(url.searchParams.has('fresh'))).usb)`.
   - `POST /api/library/install` `{ name }` -> `await lib.installFromLibrary(body.name)`; on `ok`, `serverLog` it and
     say "restart DeviceHub to load it" (or call the agent's my-devices load again if one exists). 400 with `error`.
4. **Overview (or Settings)**: a "From the library" note when `/api/library` returns entries: "<vendor> <product> has
   a shared driver (tested by N people, last <date>)" with an Install button for `installable`, and the `why` for the
   rest ("read-only: offered, not installed by itself").
5. **CLAUDE.md**, "Set this up" step 2, first bullet (before BRANDS.md and hid-caps):
   `- First, the library: GET /api/library (or helpers/device-library.mjs match() on /api/pc's usb). A matching
   "tested" entry is installed with installFromLibrary (POST /api/library/install) and needs no learning; a
   "read-only" or "untested" one is the starting point, proven per step 6 before its writes are used.`
   And in "Adding your own devices", a last step: `When it works, offer to share it: node helpers/share-device.mjs
   <folder> --status tested; the person opens the pull request themselves.`
   Add `device-library/` to the Map.
6. **.gitignore**: no change needed. `my-devices/*` (except `_example/`) stays private, including drivers installed
   from the library; nothing in `.gitignore` matches `device-library/`, so it is tracked and the installer (built from
   `git ls-files`) ships it. Do not add a `*.json` or `device-library` rule.

## Notes for whoever wires it

- A person's own share lands in their installed copy's `device-library/` as an untracked folder. If upstream later
  adds an entry with the same name, `git merge origin/app` stops ("untracked working tree files would be
  overwritten"); the update steps in CLAUDE.md should say to move that folder aside first (it is already sent as a PR).
- Matching says nothing about the protocol being safe on a different firmware; status "tested" covers the tester's
  firmware. Worth adding a `firmware` field to `tested[]` once real entries arrive.
- `installFromLibrary` does not check the id against drivers already in `my-devices/` (that needs importing them);
  `my-devices.mjs` refuses a duplicate id at load with "already used", so the effect is only a log line.
