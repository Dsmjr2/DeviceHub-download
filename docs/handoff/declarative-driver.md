# Drivers as data (driver.json), 22 Oct 2026

Goal: a missing device needs a filled-in description, not code. DeviceHub checks the description for safety before
using it, and the learning wizard (next job) can write one.

Files (new, nothing else touched):
- `docs/DRIVER-FORMAT.md`: the format, the safety rules, what it cannot express.
- `helpers/declarative-driver.mjs`: `fromJson(obj | path)` -> a driver with the device.mjs contract; `validate(obj)` ->
  `{ ok, problems }`; also `parseTemplate`, `builtInNever`, `FORMAT`.
- `helpers/never-commands.json`: DeviceHub's built-in never list, every entry with its sheet and source.
- `device-library/asus-rog-mouse/driver.json`: the ASUS ROG mouse driver as data (device.mjs stays beside it).
- `tests/declarative-driver.mjs`: `node tests/declarative-driver.mjs` -> `declarative-driver (...): all good`.

## The format in brief

One JSON file: identity (`id`, `title`, `kind`, `vid`, `pids`, `models` with their `vars`), `transport` (output or
feature reports, length, report id, usage page, timeout, tries, an optional checksum: none, xor, sum8, sum16le),
`links` (cable, receiver ...; a receiver link identifies the model from a list in a reply, and can probe a flag),
`replies` (echoed positions, the error bytes, an optional status byte), `messages` (every request, as byte templates
with `{value}` / `{field}` placeholders), `reads` and `fields` (where each value sits: offset, size, endian, mask,
shift, map, bool, scale and add), `settings` (slider / toggle / choice with ranges and options, conditions per model and
link, the write message, the save after it, fields that must not move), `battery`, `info`, `stepBack` (the maker's app
names), `unsupported`, and its own `never` list.

## The safety rules (validate)

Refused, with a sentence for each problem: a malformed file or a part the format does not know; any message reference
or placeholder that is not a template or a field (nothing outside the templates can be sent); a template that could
produce a pattern on its own never list or on `helpers/never-commands.json` (scoped by vendor, product ids, usage page,
report id; values computed from the page's ranges and options; device-read bytes and checksums count as "anything");
the Logitech vendor id (HID++ indexes cannot be proven safe as bytes); a setting written without a field from a regular
read; a slider without a range, or a page value that does not fit its placeholder; a setting whose name looks like
firmware, reset, flash or pairing. At run time the driver additionally checks every value against its setting before
sending, reads before and after each write, writes the old value back on a mismatch, and sends the save only after a
matching read-back.

Never list sources: the "Read-only first" / "Never" sections of `docs/brands/*.md` (ASUS reset 50 40; Cooler Master
flash saves and the ARGB Gen 2 reset; Glorious DFU 75; HyperX Dart save and Cloud III SIRK; VIA bootloader, EEPROM and
keymap resets on page FF60 for any vendor; Keychron DFU, factory reset and factory test; Turtle Beach RACE nvkey writes;
Wooting bootloader, resets and saves). Brands whose firmware commands are not documented (Razer, SteelSeries, Corsair,
ROCCAT) have note-only entries. Wooting command ids were read as decimal, as the sheet's table gives them.

## The proof

`tests/declarative-driver.mjs` copies the simulated mouse from `tests/sim-asus.mjs` (it exports nothing) and runs one
99-step script on device.mjs and on driver.json, each against its own identical simulator: Harpe Ace on its cable
(every setting written, read back and put back; nine invalid writes; a write that does not stick; Armoury Crate
running; raw backup), Harpe Ace behind the Omni receiver (pair list on report 1, booster probe and every request on
report 3; asleep and awake), Keris AimPoint with the booster on, an Omni with an unknown mouse, Chakram X on cable and
receiver, Gladius III (no battery; a cable that refuses everything), a DPI stage above the model's maximum, a wireless
mouse at 0% not charging. Result: the same 189 requests, byte for byte and on the same report ids; every step's value
(info model and link, settings, read, battery, write results) or refusal the same; every simulated mouse ends in the
same state. Then 25 bad files, each refused for the right reason, and a pretend feature-report device (FFFF:FFE1) with
an XOR checksum: frame bytes, read-back, a bad reply checksum and a failure status both rejected.

Also checked: `tests/check.mjs`, `tests/sim-asus.mjs`, `tests/my-devices.mjs`, `tests/device-library.mjs` still pass;
`problem()` from `helpers/my-devices.mjs` accepts the driver fromJson builds.

Differences from device.mjs (kept small on purpose): info() lines other than Model and Connection are worded
differently (the format has one value per info line); a slider read outside its range locks its group on any read, not
only in info(); before connect the page shows the first model's settings.

## Lines to wire (other files; not edited here)

`helpers/my-devices.mjs`, in `loadOne()`, replace
```js
  const file = path.join(folder, 'device.mjs');
  if (!fs.existsSync(file)) return { name, error: 'no device.mjs in it' };
  try {
    const a = (await import(pathToFileURL(file).href)).default;
```
with
```js
  const file = path.join(folder, 'device.mjs');
  const data = path.join(folder, 'driver.json');
  const coded = fs.existsSync(file);
  if (!coded && !fs.existsSync(data)) return { name, error: 'no device.mjs or driver.json in it' };
  try {
    // device.mjs wins when both are there; a driver.json alone is checked (validate) and refused with its reasons
    const a = coded ? (await import(pathToFileURL(file).href)).default : (await import('./declarative-driver.mjs')).fromJson(data);
```
(the rest of loadOne is unchanged: `problem(a)`, the library guard and self-check, `addSpec` and `register` work on it
as they are). Its top comment: "each one in its own folder, my-devices\<name>\device.mjs or driver.json".

`package.json`: add `node tests/declarative-driver.mjs` to both `test` and `test:offline`, after
`node tests/sim-asus.mjs`.

`CLAUDE.md`, "Adding your own devices", step 4, first sentence: "**Prefer a `driver.json` for a new device**
(docs/DRIVER-FORMAT.md): a description DeviceHub checks for safety before using it, no code. Write a
`my-devices\<name>\device.mjs` only when the format says it cannot express the device." And in the Map:
`helpers/declarative-driver.mjs   driver.json drivers (docs/DRIVER-FORMAT.md): checked, then run with the device.mjs contract`.

Also needed later (not wired here): `helpers/device-library.mjs` (`no device.mjs in it`, and it copies only
device.mjs + device.json on install) and `helpers/share-device.mjs` (`SHIPPED = ['device.mjs']`) both assume a
device.mjs; a driver.json-only library entry needs them to accept and copy `driver.json` too.

## Untested

- Nothing has run on a real device. The ASUS driver.json depends on the same missing HID pieces as its device.mjs
  (several pids, interface paths, report ids per collection: NEEDS 1-3 at the top of device.mjs).
- The feature-report path ran only against the pretend device in the test; hid-host's `sendFeatureReport` /
  `receiveFeatureReport` are themselves untried on hardware.
- The vendor-app check (tasklist) runs only on Windows and was replaced in the test.
- Only the ASUS driver was rewritten. The other five library drivers were read for what the format must cover; see
  DRIVER-FORMAT.md "What it cannot express" for which of them stay code (Logitech, Razer's tid probe, Corsair,
  SteelSeries write-only settings, HyperX multi-family framing).
