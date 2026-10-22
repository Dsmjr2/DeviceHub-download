# driver.json: a device driver as data (format 1, 22 Oct 2026)

Most devices DeviceHub learns talk the same way: send a short request, get a reply that echoes it, find each value at
a byte offset. Such a driver needs no code. It is a `driver.json` in the device's folder (`my-devices\<name>\` or
`device-library\<name>\`), and `helpers\declarative-driver.mjs` turns it into a driver with exactly the `device.mjs`
contract (`connect`, `info`, `read`, `write` with read-back, `battery`, `rawBackup`, `settings`, `unsupported`, `hid`).

DeviceHub checks every file before using it (`validate()`, below) and refuses it, saying why in plain words, if it could
send anything unsafe. A file that passes can only ever send its own templates, filled in with values the page allows.

The worked example is `device-library\asus-rog-mouse\driver.json`: the ASUS ROG mouse driver written as data, proven
byte-for-byte equal to its `device.mjs` by `tests\declarative-driver.mjs`.

## Conventions

- Hex is written as two-digit bytes separated by spaces: `"12 04 00"`. Ids are 4 hex digits: `"0B05"`.
- **Byte offsets count from 0 at the first data byte after the report id**, in requests and in replies. (Brand sheets
  often count the report id as byte 0: their byte n is offset n-1 here.)
- Any object may carry a `"note"` (and the file `"about"`, `"source"`): text for people, ignored by DeviceHub. Any
  other key the format does not know is refused, so nothing can hide in a part DeviceHub would not read.
- **Conditions** (`when`, `asleepIf`): an object whose every key must match. A key is a path: `model.<var>` (the
  model's `vars`, plus `model.key`, `model.name`), `link.name`, `link.wireless`, `probe.<name>`, or a field name.
  A value matches when equal; a list matches any of its values; `{ "not": x }` matches anything but x (a missing
  value counts as `null`).
- **References**: a string `"$model.dpiMax"` in a number's place takes the value from the current model.

## The parts

```text
{
  "format": 1,
  "id": "asus-rog-mouse", "title": "ASUS ROG mouse", "kind": "Mouse", "vendor": "ASUS",   identity (id as in device.mjs)
  "vid": "0B05", "pids": ["1A92", "1A94", "1ACE"],          every product id it answers on
  "hid": { ... },                                            optional: the channel the agent opens (my-devices passes it
                                                             to hid-host addSpec, as device.mjs's hid); default:
                                                             vid, first pid, usagePage, len, reportId from transport
  "transport": {
    "report": "output" | "feature",     output reports (the reply arrives as an input report) or feature reports
                                         (set feature, wait waitMs, get feature on the same report id)
    "len": 64,                           data bytes per report (without the report id); requests are zero-padded to it
    "reportId": 0,                       default report id
    "usagePage": "FF01",                 the collection to open (a link may override it, or set null for none)
    "timeoutMs": 600, "tries": 3,        per request: wait for a reply, then try again (silence only)
    "waitMs": 0,                         feature reports: pause between set and get
    "checksum": { "type": "xor", "from": 2, "to": 87, "at": 88 }   optional, see below
  },
  "links": {                             how the device is reached; each model maps its pids to links
    "cable":  { "label": "USB cable", "reportId": 0, "wireless": false },
    "omni":   { "label": "ROG Omni receiver", "reportId": 3, "wireless": true, "usagePage": null,
                "pids": ["1ACE"],        a RECEIVER: these pids belong to the link, not a model
                "identify": { "message": "pairList",
                              "list": { "offset": 4, "stride": 4, "size": 2, "endian": "little", "stopAt": 0 },
                              "refused": "the Omni receiver refused its pair-list read" },
                "probes": [ { "name": "booster", "message": "booster",
                              "field": { "offset": 4, "map": { "1": true }, "default": false } } ] }
  },
  "models": [
    { "key": "harpe-ace", "name": "ROG Harpe Ace Aim Lab Edition",
      "pids": { "cable": ["1A92"], "dongle": ["1A94"] },     link -> product ids
      "paired": { "omni": ["1A94"] },                        ids a receiver link's identify list may report
      "vars": { "battery": true, "dpiMax": 36000 } }         anything conditions and $references need
  ],
  "replies": {
    "echo": [0, 1],                      positions a reply repeats from its request (how it is matched)
    "error": { "bytes": "FF AA" },       a reply starting with these is an error (refused, or asleep on a wireless link)
    "ok": { "offset": 0, "equals": "02" },   optional: a reply without this status byte is an error
    "checksum": true                     optional: a reply whose checksum (transport's) is wrong is an error
  },
  "messages": {                          EVERY request the driver can send. Nothing else ever leaves it.
    "status":  { "bytes": "12 07" },
    "pairList": { "bytes": "A0 00 00", "reportId": 1 },     a message may name its own report id; else its link's
    "setDpi1": { "bytes": "51 31 00 00 {value:u16le} {dpi1Color?}" },
    "setSleep": { "bytes": "51 37 00 00 {value} 00 {lowBattery}" }
  },
  "reads": [                             the regular reads, in order; together they are one "snapshot" (reused 1 s)
    { "name": "status", "message": "status", "when": { "model.battery": true },
      "onError": { "wireless": "fail", "wired": "skip" },   "fail" (default) | "skip" | per link kind
      "asleepIf": { "link.wireless": true, "battery": 0, "charging": false } },
    { "name": "colors", "message": "colors", "onDemand": true, "onError": "skip" }   only when a write needs it
  ],
  "fields": {                            where each value sits in which read's reply
    "battery":  { "from": "status", "offset": 4 },
    "charging": { "from": "status", "offset": 9, "type": "bool" },          bool: not 0
    "dpi1":     { "from": "profile", "offset": 4, "size": 2, "endian": "little", "absentIf": 0, "scale": 50, "add": 50 },
    "pollingRate": { "from": "profile", "offset": 12, "mask": 7, "map": { "0": 125, "3": 1000 },
                     "when": { "pollingHigh": 0 } },                          when: decoded only if it holds
    "sleep":    { "from": "status", "offset": 5, "map": { "0": 1, "255": 0 } },  code -> value; unknown code = absent
    "angleSnap": { "from": "profile", "offset": 16, "map": { "1": true }, "default": false },
    "dpi1Color": { "from": "colors", "offset": 4, "size": 3, "type": "bytes" }
  },
  "settings": [                          the page, and how each setting is written
    { "key": "dpi1", "label": "DPI stage 1", "type": "slider", "min": 100, "max": "$model.dpiMax", "step": 50,
      "unit": " DPI", "when": { "model.doubleDpi": { "not": true } }, "lockGroup": "dpi",
      "field": "dpi1",                   which field reads it (default: the key)
      "write": { "message": "setDpi1", "needs": ["colors"], "then": "save",
                 "keep": [],              fields that must read the same after the write
                 "encode": { "map": { "true": 1, "false": 0 } } } }   optional; default: the field read backwards
  ],
  "battery": { "from": "status", "percent": "battery", "charging": "charging", "when": { "model.battery": true },
               "awake": true },          awake: offer awake() (one quick status read) on wireless links
  "info": [ { "label": "Button response", "field": "debounce", "text": "code {value}" },
            { "label": "8K booster", "field": "probe.booster", "map": { "true": "on", "false": "off" } } ],
  "stepBack": { "processes": ["^armourycrate.*\\.exe$"] },   refuse to read or write while the maker's app runs
  "unsupported": ["firmware updates"],
  "never": [ { "bytes": "51 21", "why": "button remap" } ]  this file's own never list (see Safety)
}
```

### Templates

A message's `bytes` is a list of tokens: a byte (`51`), or a placeholder:
- `{value}` / `{value:u16le}`: the setting's new value, encoded (`u8` default, `u16le`, `u16be`, `u32le`, `u32be`).
  A value that does not fit is refused before anything is sent.
- `{field}` / `{field:u16le}`: a field's raw value **as just read**, sent back unchanged (`{lowBattery}` above).
- `{field?}`: an optional field (a `bytes` field such as a color read on demand): left out when its read failed. An
  optional placeholder may only be the last token.
The rest of the report is zeros, then the checksum (if any) is written at `at`.

### Fields

`offset`, `size` (1, 2 or 4; any length for `type: "bytes"`), `endian` (`little` default, `big`), then in order:
`mask`, `shift` (right), `absentIf` (raw value meaning "not reported"), and the value: `map` (code -> value, with
`default`), `type: "bool"` (not 0), or the number `raw * scale + add`. Fields decode in file order, so a field's `when`
may use fields above it.

### Settings

`type` is `slider` (`min`, `max`, `step`), `toggle` or `choice` (`options: [{ value, label }]`), plus `unit`, `hint`,
`live`, `selfCheck` as in `helpers/my-devices.mjs`. The same key may appear more than once with different `when`s: the
first one that holds is shown (polling rates per link, above). A setting without `write` is shown read only.
`lockGroup`: if a slider in the group ever reads outside its own range, the whole group becomes read only (the range is
then wrong for this device).

A write does exactly what device.mjs drivers do: check the value against the setting (range, step, options), read
everything fresh, refuse if the setting was not read, do the `needs` reads, send the message, read everything again,
and compare. If the value or a `keep` field differs, the value read before is written back and the write fails; nothing
more is sent. Only on a match is `then` (a save) sent. Wireless links say "asleep or out of range" for an error reply.

### Checksums

`none`, `xor` (XOR of bytes `from`..`to`, one byte at `at`; this is Razer's "crc"), `sum8` (low byte of the sum),
`sum16le` (the sum's low 16 bits, little-endian at `at`, `at+1`; ROCCAT's Sum16). No other checksum or CRC is
supported: a device that needs one stays a device.mjs.

## Safety: what validate() refuses

Every refusal says what is wrong in a sentence. A file is refused when:

1. **It is malformed**: not an object, `format` is not 1, a bad id (or a built-in one: mouse, headset, keyboard),
   no title or kind, a vid or pid that is not 4 hex digits, a product id no model or receiver has, a token that is not a
   byte or placeholder, a message longer than the report or over the checksum byte, a field outside the reply, a part
   the format does not know.
2. **It could send something outside its templates**: a read, write, `then`, identify or probe naming a message that
   is not in `messages`; a placeholder that is neither `value` nor a field; a write message without `{value}` or a read
   message with one.
3. **A template matches a never list**: the file's own `never`, or DeviceHub's built-in one,
   `helpers/never-commands.json` (firmware, bootloader, DFU, flash saves, resets, factory, pairing, collected from the
   brand sheets in `docs/brands/` with their sources). The check is conservative: a `{value}` byte can be any value the
   page allows (computed from the setting's range or options), a field placeholder or a checksum byte can be anything,
   and padding is zero. Patterns are scoped by vendor id, product ids, usage page and report id; `??` and `D?` are
   wildcards. Whole vendors whose protocol cannot be made safe as fixed bytes are refused (Logitech HID++: features
   are reached by an index handed out at run time).
4. **A setting is written without a read**: every setting needs a field from a regular (not on-demand) read, so it can
   be read before and after each write.
5. **A numeric write has no range**: a slider without `min` and `max` (for every model it shows on), or a value the
   page allows that does not encode into its placeholder.
6. **A setting looks like a firmware, reset, flash or pairing control** by its key or label.

## What it cannot express (then a device.mjs is still the way)

- Run-time lookups that change the bytes: Logitech HID++ feature indexes, Razer's transaction id probe (try 1F, 3F,
  FF), Corsair Bragi handles. (One fixed transaction id can be a template byte.)
- Writes the device never answers, or settings it cannot read back (SteelSeries headsets: "writes get no reply").
  These are refused on purpose: DeviceHub writes only what it can read back.
- Whole-block read-modify-write (Glorious/Sinowealth config blocks, ROCCAT profiles) and multi-packet messages
  (Wooting v3, Airoha RACE fragments, HyperX "prepare" reads).
- Values computed from several fields, or unit conversions other than `raw * scale + add`, a map, or a bool
  (for example a battery voltage curve, the Arctis 9's 0x64-0x9A battery range, a doubled DPI).
- Transports other than one HID collection with output or feature reports: the helper's own channels (the HS80's),
  Bluetooth GATT, serial, two collections at once (only per-message report ids), unsolicited notices.
- More than one request in flight, timing rules beyond one wait and one timeout, and info lines built from several
  values.
