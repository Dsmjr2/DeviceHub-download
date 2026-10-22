# Optional tools: the Install buttons (22 Oct 2026)

Goal (the owner): the person installs DeviceHub's optional tools from DeviceHub itself, with one click and one
confirmation, without Claude. Files: `helpers/installers.mjs` (table, status, plan, verify, install, route),
`public/ui/installer-button.js` (the button, its dialog and loading bar), the Equalizer-APO-missing part of
`public/pages/eq-panel.js`, the "Optional tools" row in `public/pages/settings.js`, `tests/installers.mjs`.

## The tools and their official sources (read 22 Oct 2026)

| Tool | Adds | Official page | File (size) | Checked by | Offered as |
|---|---|---|---|---|---|
| Equalizer APO 1.4.2 | EQ, Natural sound, mic boost and filters, monitor EQ | sourceforge.net/projects/equalizerapo | `EqualizerAPO-x64-1.4.2.exe` from `sourceforge.net/projects/equalizerapo/files/1.4.2/.../download` (11.4 MB) | nothing possible: not signed, no published hash | **official page only** |
| ReaPlugs 2.36 | the mic's Even volume (ReaComp), the camera mic's gate (ReaGate) | reaper.fm/reaplugs | `reaplugs236_x64-install.exe` from `www.reaper.fm/reaplugs/` (1.1 MB) | nothing possible: not signed, no published hash | **official page only** |
| USBPcap 1.5.4.0 | recording USB traffic for a learning session | desowin.org/usbpcap | `USBPcapSetup-1.5.4.0.exe` from `github.com/desowin/usbpcap/releases` (190 KB) | Authenticode: Valid, signer matching `Tomasz Mo` or `Wireshark Foundation` | **Install** |

Sizes come from a live HEAD request when the dialog opens (remembered for the session; the table's size is the fallback,
shown as "about"). None of the three makers publishes a SHA-256. Equalizer APO's and ReaPlugs' installed files on this
PC (their exes, DLLs and uninstallers) all read `NotSigned`, so their installers are taken to be unsigned too; that is
why those two show "Get" and open the official page instead of installing. A newer version: change `version`, `url`,
`file` and `approxBytes` in `TOOLS`.

## How a download is checked

1. Downloaded over HTTPS only, following redirects only to that tool's own hosts (`hosts` in the table: SourceForge and
   its `*.dl.sourceforge.net` mirrors; `www.reaper.fm`; github.com and its release-asset hosts). Anything else stops it.
   Saved as `<file>.part` in `%TEMP%\DeviceHub-downloads\`, renamed when complete (a short download is an error), 200 MB cap.
2. `Get-AuthenticodeSignature` (Windows reads the signature; nothing runs): status must be `Valid` AND the signer's
   subject must match the tool's `signer` pattern. A valid signature from anyone else fails.
3. Failing that, the file's SHA-256 must equal `sha256` in the table (a hash the maker publishes).
4. Neither: the file is deleted, never run, and the person is offered the official page. A tool with neither `signer`
   nor `sha256` is never downloaded at all (`offer: 'page'`).

Turning Equalizer APO or ReaPlugs into one-click installs needs a maker-published SHA-256 (or a signed installer) in the
table. Pinning a hash Claude or the owner computed from the official file once would also work technically, but it is a
weaker check (it trusts that one download); that is the owner's call, not done here.

## What the person still clicks

The installer runs the normal way (Start-Process, i.e. ShellExecute: Windows shows its own admin prompt, the installer
its own windows; no silent switches, no RunAs from DeviceHub). DeviceHub waits for it to close, then re-reads whether
the tool is installed (its file where DeviceHub looks, or Windows' Apps list) and deletes the download.
- **USBPcap**: Yes on the Windows prompt, I Agree, Next, Install (Yes if Windows asks to trust the driver), then
  restart the PC before a learning session.
- **Equalizer APO** (from the official page): Yes, Next, I Agree, Next, Install; its Configurator opens: tick the
  headset (playback and mic) and any speakers, OK, restart. Anything left unticked shows on the Equalizer card as "Not on
  for ..." with Turn on (`helpers/eqapo-devices.js`, already in DeviceHub).
- **ReaPlugs** (from the official page): Yes, keep `C:\Program Files\VSTPlugins`, Install, then turn on Even volume. If
  another folder is picked, Settings marks it "Check folder" (Windows lists it, but `helpers/eqapo.js` will not find it).

## Where the buttons are

- Headset > Equalizer, when Equalizer APO is missing: "Get Equalizer APO" (or "Install Equalizer APO" once the table can
  check it) in place of the old link, and Check again.
- Settings > DeviceHub card: one row, "Optional tools", saying what is installed, with **Show**: a dialog listing the
  three (what each adds, Installed + version, or its button; the loading bar runs in that dialog). One row because
  Settings must fit 1650 x 910 with no scrolling: measured with the row, the page ends at 907 px (three tools on their
  own lines needed about 120 px more than the 63 px free).

## Wiring (not done: server.js is not mine to edit)

server.js, inside `async function api(req, res, url)`, after the Origin check (it relies on it), e.g. beside the
`/api/library` routes:

```js
  if (url.pathname.startsWith('/api/installers')) { if (await (await import('./helpers/installers.mjs')).handle(url, req, res, send, readBody)) return; }
```

Until it is added, `/api/installers` answers 404, the Settings row stays hidden and the Equalizer card's button falls
back to "Install Equalizer APO" opening a dialog that says the download could not be read (so add the line).

package.json: add `&& node tests/installers.mjs` to both `test` and `test:offline` (before `tests/pages.mjs` in `test`).

CLAUDE.md, suggested lines:
- In "Set this up" step 3 / the up-front question list: "Equalizer APO, ReaPlugs and USBPcap: point the person to
  Settings > Optional tools > Show (or the Equalizer card's button). DeviceHub shows the file, source, size and check,
  and runs the maker's installer itself after their click; Claude does not need to download or install them. Still name
  each one, its official link and size in the question list."
- Under the rule "Never install drivers, tools or anything else without asking first": "The person's click on an
  Install button in DeviceHub is their yes for that one tool."
- ADD-YOUR-DEVICES.md "Not in the zip" list: "Settings > Optional tools installs or links them."

## Tests and what is untested

`node tests/installers.mjs` (prints one "all good" line): status, plan (HEAD and its fallback), verify (signer,
wrong signer, unsigned, tampered, SHA-256 match and mismatch), install (happy path with progress, bad signature never
run and deleted, declined prompt, installer closed but nothing installed, page-only tool never downloaded, failed
download), the redirect host check, and the route (including 409 while busy). Everything outside is a stand-in.

Not tested for real (never run, by instruction):
- an actual download (only HEAD requests were made: all three URLs answered 200 with the sizes above);
- the real `Get-AuthenticodeSignature` result on `USBPcapSetup-1.5.4.0.exe`: the expected signer (`Tomasz Moń`,
  Certum-issued, as on his other signed files; older setups were signed by the Wireshark Foundation) is not confirmed on
  this exact file. If it differs, the install refuses safely and offers the page; read the subject then and fix `signer`;
- Start-Process with an installer that asks for admin, the declined-prompt message text (matched on "cancel"), and
  waiting on an elevated process;
- the Windows Apps list names (`uninstallName`) for ReaPlugs and USBPcap.
The UI was checked in the browser at 1650 x 910 with stand-in API answers: the Settings row fits (page ends at 907 px),
the dialog, the plan dialog, the loading bar and the result toast all work; `tests/pages.mjs` passes.
