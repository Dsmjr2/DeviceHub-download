# Shared learned drivers (24 Oct 2026)

Goal (Shawn: "make connecting unknown devices absolutely seamless"): a device learned once on any PC works on the next
PC with nothing to learn or click.

## Friend's PC
- `helpers/driver-share.mjs`: when a driver made with Learn a device (`my-devices/<name>/driver.json`, library.json
  `learned: true`) passes DeviceHub's self-check on the device (every checked setting ok, none failed), it is sent to
  Shawn through the problem-report relay (`auto-report.mjs sendNow`, channel `driver`), once per driver text
  (library.json `sharedSha`). Hook: `my-devices.mjs` agentDeps `selfChecked`.
- Only with the person's yes: settings.json `shareDrivers: true`. Asked once on Learn's done screen
  (`public/ui/driver-share.js shareAsk`); the switch "Share drivers I learn" in Settings > Get help. A yes also shares
  every learned driver on the PC that already passed. Never from the owner's PC.
- Never sent: a device.mjs (code), a driver that fails declarative-driver `validate()`, a refused vendor (Logitech,
  Sinowealth, Laview), anything personal (`share-device.mjs personalText`), a driver with a failed setting.
- The issue: a readable summary, `### Record` (JSON: driverSha, ids, model, firmware, version, date, settings that
  passed) and `### Driver` (driver.json deflated and base64'd; must fit the relay's 12,000-character body).

## Shawn's copy
- `node helpers/accept-driver-shares.mjs` (check only), `--apply` writes `device-library/<brand>-<title>/` with the
  driver.json as sent and a device.json with status `tested` and a works-shaped record (`realRecord` counts it for
  exactly that driver text). It refuses a share whose driver does not match its record's SHA-256, fails validate(), is
  for a refused vendor, holds anything personal, names settings the driver does not write, or whose USB id or id the
  library already has. It never commits, pushes or closes; it prints the close commands. Then commit and Publish.
- The relay labels these `driver` (relay/worker.js `labelOf`) once redeployed (`npx --yes wrangler@4 deploy` in
  relay/); before that they arrive labeled `problem`, and the accept command reads both (it goes by the mark in the body).
- Look over each driver before --apply: the relay takes anonymous posts, so a share is checked (validate, the never
  list on every send) but not trusted blindly.

Tests: `tests/driver-share.mjs`, `tests/relay.mjs` (labels).
