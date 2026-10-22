# Learn a device: readings and a second USB id, 22 Oct 2026

Two additions to the learning wizard (docs/handoff/learn-wizard.md). Both stay read-only toward the device: nothing
here opens it or sends it a byte, and a learned driver can only send bytes seen in a recording. `npm run test:offline`
passes. Nothing was committed; DeviceHub was not restarted.

## 1. Readings

A reading is a value the device reports that the person cannot set: battery, charging, ChatMix, a sensor. On the Get
ready step it is the fourth kind ("Reading"), with "What it is": Battery level, Charging, or Something else.

- **Battery level**: one recording. The person gives the percent the maker's app shows; DeviceHub looks for a byte
  that equals it (raw, no scale). If two bytes match, it asks for another recording once the app shows another percent.
- **Charging**: two recordings, cable plugged in, then unplugged.
- **Something else**: two values the app shows (numbers or words like game / chat). The person makes the device report
  each one (move the wheel), then presses Done.

`analyzeReading(takes, setting)` in `helpers/learn-wizard.mjs` looks in two places:
1. a request sent byte for byte the same in every recording, and its reply (the last one of each take). The value
   is not looked for in the bytes the reply repeats from the request;
2. a notice: an input report that answers no request, the same report and first byte in every take (the last one of
   each take). Byte 0 is how it is told apart, so the value is not looked for there.

A reply beats a notice when both carry the value (DeviceHub can ask for a reply; it has to wait for a notice).
Refusals, as for settings: nothing matches; more than one place matches (asks for one more value, then refuses after
three); a battery level outside 0-100; fewer than two values (one for the battery); the same value twice.

The driver (`buildDriver`):
- a battery level becomes `battery: { from, percent }`, and charging becomes `battery.charging`. Charging without a
  battery level becomes a display. One of each per driver;
- anything else becomes a `display` setting (no `write`);
- an asked reading adds only its read message; a notice adds a `notice` read and `hid.reply: "raw"`;
- a setting's `keep` lists only the other settings (readings move by themselves);
- a driver of notices only has no `messages` and no `replies`.

`verifySeen` now also decodes every recorded reply or notice with the driver's own `fieldsOf()`; it must read back as the
value recorded. `collectionOf` refuses a notice on another part of the device than the settings ("one driver listens
to one part"), or one whose part cannot be found. `mergeDriver` (adding to a library driver's copy) carries notices and
the battery. It refuses a second battery, and a notice when the driver's channel is not raw.

The tile: the format already had `battery` and my-devices already passes `battery()` on, so a learned battery shows on
the device's tile and page.

## 2. The same device on its other USB id

After a save, the Saved step offers "Also learn it on its cable or receiver" → **Learn it the other way**. The person
plugs it in the other way, says whether it is now on its cable or receiver, and picks it (same vendor id, another
product id). Every setting and reading of the saved driver is then learned again there, one at a time, in the same
order, with the same keys and ranges. Numbers and a battery percent may be new values; choices, on/off and words are
the first id's own (they are part of the driver).

`act('second', { vid, pid, link })` starts that session. `save` then runs `secondCheck()`:
- every setting must be learned on the new id first ("Learn X on this id too");
- the new id's driver is built and proven against its own recordings;
- `addPid(base, other, { pid, link })` then joins the two:
  - **same bytes**: the pid goes into `pids`, a link (`cable` or `receiver`, wireless for a receiver, its own
    `usagePage` if it differs), the model's pids, and `hid.pids`, with `hid.byPid[pid]` for a collection that differs;
  - **different bytes**: the same, plus `byPid[pid]` in the file: that id's own transport, replies, messages, fields,
    notices and codes;
  - refused in plain words when the ids read the device another way (other message, read or field names), or the
    settings came out different (kind, range, choices);
- the joined file is validated and proven against the recordings of BOTH ids;
- it is saved into the same folder with `saveInto` (old files backed up to `backups\`).
The note says to restart DeviceHub. Another id can then be added the same way (`receiver2`, ...).

This is offered only for a driver the wizard made, right after it is saved, in the same DeviceHub run (`lastSaved` is
held in memory). It is not offered for settings added to a library driver's copy.

## Format changes (docs/DRIVER-FORMAT.md, helpers/declarative-driver.mjs)

- **Notices**: a read may have `notice: { starts, reportId?, len? }` instead of `message`. The driver keeps the last
  matching report: from `receiveReports(0)` once per snapshot on the agent's raw channel, from every input report in a
  browser, and from any report that answers no request. Until one arrives its fields are unknown (no error).
  validate() refuses:
  - a written setting from a notice, and `write.needs` or `battery.awake` naming one;
  - a notice that starts like any message (a placeholder there counts as a match);
  - placeholders in `starts`;
  - `onDemand`, `onError` or `asleepIf` on a notice;
  - a read with both a message and a notice, or with neither;
  - an explicit `hid` without `reply: "raw"`.
  `messages` and `replies` are needed only when something is sent.
- **byPid**: `byPid: { "<pid>": { transport, replies, messages, fields, notices, encode } }`. It changes only names the
  file has. The file as it is on that id (`forPid(def, pid)`, exported) is validated in full, never lists included,
  with "on product id XXXX:" before each problem.
  - `makeDriver` lays the entry over the file at `connect()`, once the product id is known (`use(pid)`). The channel
    is now made after that, with that id's length and report id;
  - `drv.usePid(pid)` does the same for tests and `verifySeen`;
  - a file without `byPid` or notices behaves exactly as before (the ASUS byte-for-byte proof still passes).

## Files

Changed: `helpers/declarative-driver.mjs`, `helpers/learn-wizard.mjs`, `public/pages/learn.js`, `docs/DRIVER-FORMAT.md`,
`tests/declarative-driver.mjs` (part 5), `tests/learn-wizard.mjs` (the Arc headset section; the Acme recording now takes
a pid and read command), `docs/handoff/learn-wizard.md` (one pointer line at the end). New: this file. Not touched: `server.js`, `package.json`, `CLAUDE.md`,
`public/devices/headset-adapter.js`, `public/pages/headset.js`.

## Tests (synthetic recordings, no device)

- `tests/learn-wizard.mjs`, a pretend Arc headset (5555:0101), polled battery + charging, ChatMix sent by itself:
  - battery from one recording, ambiguous then settled by a second percent, over 100 refused;
  - ChatMix found in the notice; two moving bytes ambiguous, then refused after three; a value nothing carries refused;
  - through the route: battery, charging and ChatMix learned and saved, the only message the read heard;
  - driven on a pretend headset: ChatMix heard on the raw channel and in a browser, the battery read for the tile,
    the reading refused as a write;
  - loaded by my-devices with `battery()` and ChatMix read only;
  - its receiver 5555:0102 (same bytes): the id added, one driver, backed up first; refused before every setting is
    learned on it;
  - 5555:0103 (battery read 06 02): `byPid`, each id sending only its own read;
  - `addPid` on the Acme mouse's written DPI: same and different bytes, a recording from the wrong id caught, the id
    it has refused, another range refused.
- `tests/declarative-driver.mjs` part 5:
  - a notices-only file: no messages, never sends a byte, heard in a browser and on the raw channel;
  - ten notice refusals and five byPid refusals;
  - `usePid` building each id's bytes, and `connect()` on the second id reading with that id's message and field.

## Lines for you

`CLAUDE.md`, "Adding your own devices", step 3, after "...saves a read-only `my-devices\<name>\driver.json`
(docs/handoff/learn-wizard.md).":
"It also learns readings (battery, charging, ChatMix, a sensor: what the device reports and the person cannot set),
from a read and its reply or from a report the device sends by itself, and, after a save, the same device on its other
USB id (cable and receiver), added to the same driver (docs/handoff/learn-readings.md)."

`CLAUDE.md`, the Map line for the wizard:
`helpers/learn-wizard.mjs   Learn a device: USB recordings -> driver.json (settings, readings, a second USB id), read-only toward the device (public/pages/learn.js)`

`CLAUDE.md`, under "Learning a protocol", after the vendor refusals line:
"A driver.json may hear reports the device sends by itself (`notice` reads, display and battery only, never a written
setting) and hold one product id's own bytes (`byPid`): docs/DRIVER-FORMAT.md."

`package.json`: nothing (no new test file).

## Untested on hardware

- Whether hid-host's `READ 0` returns reports that arrived between requests (Windows' HID buffer). The raw channel
  and `receiveReports` are from docs/handoff/hid-core.md and were never run on a real notice.
- A notice that comes in while a request waits for its reply reaches the driver only through its match function
  (raw channel). A report the helper drops before that is lost until the next one.
- No reading or second-id driver has run on a real device. USBPcap recordings are still untested here (see
  learn-wizard.md).

## Known limits

- A value in a notice's first byte is not learned (that byte tells the reports apart).
- Words with only two values: every byte that differs between the two takes matches. A noisy device (mouse movement
  on the same report) is then ambiguous; a third value usually settles it.
- A battery level is a raw byte equal to the percent. Scaled levels, voltages and the Arctis 9's 0x64-0x9A range are not
  learned (the format cannot express them either).
- The second id is offered only right after a save in the same run, and only when every setting is learned on it.
  Choices must be recorded with the same values.
- The cable or receiver label and its wireless flag come from the person's pick.
- A changed driver loads on the next DeviceHub start.
