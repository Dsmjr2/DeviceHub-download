# Learned settings beside a code driver (1 Nov 2026)

Goal: "A setting is missing?" in Learn a device works for a device whose library driver is code (device.mjs: Razer,
SteelSeries, Corsair, HyperX, Wooting ...). Before, the wizard refused it ("Learned settings can only be added to a
driver.json driver") and A setting is missing? only recorded for Shawn.

## As built

- **Saved beside, never into the code.** The learned settings go to `my-devices\<name>\learned.json`: the driver.json
  format (docs/DRIVER-FORMAT.md) holding only the learned messages, reads, fields and settings. Checked with
  declarative-driver `validate` (never lists, template bytes only) and the wizard's `verifySeen` (every byte as
  recorded) like any learned driver. A library entry that is not installed yet is installed first; the library's own
  folder is never written. More settings learned later are merged into the same learned.json (`mergeDriver`).
- **Refused at save, in a plain sentence** (`sideProblem`, `saveLearned` in `helpers/learned-extras.mjs`): a learned key
  equal to a code key ("Not added: its driver already has a setting called "dpi". Skip that setting: the driver has
  it."), a learned battery when the code driver has `battery()`, a file for another vendor id, a folder outside
  my-devices or without device.mjs and library.json. library.json gets `learnedKeys` and `learnedAt`.
- **Loaded as one device** (`withLearned`, called by `helpers/my-devices.mjs loadOne` BEFORE the guard): settings = the
  code driver's, then the learned ones whose key it does not have (a key it gains later wins; the learned one is dropped
  and logged); `read()` merges both; `write(key)` goes to the learned driver for learned keys; `connect()` connects both;
  `info`, `battery`, `rawBackup` (learned replies under `learned`), `wakeRead`, `awake`, `pollRead`, `freshRead` and
  `close` are wrapped too. **One queue for every call of both drivers**, so the device never has requests from both in
  flight; a call from inside a queued call runs at once (AsyncLocalStorage), so a driver calling itself cannot
  deadlock. The learned driver opens the device through the same `getDevice` / hid-host provider; it gets its own
  channel only when no channel of the code driver has its vid / pid / usage page, and it never closes the handle.
- **Guarded like any library setting**: learned keys are in library.json `learnedKeys`, so `needsTurnOn` keeps them
  read-only until Turn on settings (again, if the driver's own settings were turned on before they were learned), and
  the self-check (read, write the same value, read back) covers them.
- **A broken learned.json** (not JSON, refused by validate, another vendor, nothing left to use) is logged once and the
  device runs with its code driver alone; a learned connect or read that fails later leaves the code driver's values
  as they are (logged once per problem).
- **A setting is missing?** (capture session) now has `addsTo` when the device has a driver (code or driver.json, not a
  refused vendor such as Logitech): the page analyses each recording and adds it when nothing more needs asking (a
  number needs the app's range), saves at the end, and still sends the recordings to Shawn.
- **Backups / share / updates**: each save copies learned.json and library.json to `backups\learn-<name>-<time>\` first.
  Share to the library ships only device.mjs and device.json; the learned-driver share refuses a device.mjs folder.
  A library update skips a copy with `learnedKeys` (unchanged behaviour).

## The "refuses every write on purpose" refusal: removed

It counted a driver's writable settings before the device connected, so every driver that lists settings per model
(Wooting, Corsair Bragi peripherals, SteelSeries Apex and mouse, ROCCAT, HyperX peripherals, Keychron VIA) counted 0
and was refused for the wrong reason. The drivers that must never be written are refused by vendor first: the
Sinowealth / Laview chip ids (Glorious; bricking) and Logitech (ASTRO A50, HID++). The rest are read-only because no
source documented a write with a read-back, which is exactly what a recording supplies; a learned setting never goes
through the code driver's write, sends only recorded bytes and waits for Turn on settings and the self-check.

## Tests

`tests/learned-extras.mjs` (npm test and test:offline): a pretend code driver plus a Lights toggle learned through the
wizard's route in A setting is missing?: one device with both settings, Lights read-only until Turn on settings, then
self-checked; its write sends only recorded messages; eight calls at once never overlap on the device (and without
the queue they do); a broken, refused or key-shadowing learned.json leaves the code driver alone, logged once; the
clash refused at save; backups; share. `tests/learn-wizard.mjs`: a code driver's device is listed and begun, not
refused; A setting is missing? adds to its driver. `tests/learn-bench.mjs`: every learned style is accepted beside a
code driver and refused on a key clash or another vendor.

## Not done / untested

- Nothing ran on hardware or against a real code driver's device. A code driver with background traffic outside its
  calls (a timer of its own) is not queued.
- A learned setting on a collection the code driver opens differently (featureOnly vs output on the same page) shares
  that handle and may fail to send; it then stays unread, the code driver unaffected.
- The order of calls through the queue is the order they reach it: a guarded write first asks about the maker's app.
- A learned battery beside any code driver with `battery()` is refused, even when that driver reads none for the model.

## 2 Nov 2026 fixes

- Save is the person's press: "Record a missing setting" adds what it learned to the draft only; the Sent step shows a
  Save button naming what is added and to which device (and that a library driver is set up too). The recordings still
  go to Shawn by themselves.
- One USB id: learned.json keeps the vid and the one pid it was learned on (`learnedOn`). The combined driver uses the
  learned settings only while the code driver is connected to that id (`connectedPid`: the driver's own pid fields, its
  info "USB id", or its one declared id); on another id they are absent, logged once.
- The clash check uses the device as it connected in this run (`my-devices connectedSettings`): before it connects a
  per-model driver (Corsair, Wooting, SteelSeries) lists no settings. Not connected yet: "Connect the device first, then
  learn." A learned key equal to one of its keys is refused (no "dpi2").
- Turn on settings keeps the keys on the page when pressed (`settingsOn.keys`); a learned setting loaded at a later
  restart waits for another press.
