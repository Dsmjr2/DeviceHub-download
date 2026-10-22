# Logitech receiver slots: problem report DeviceHub-support#2, 22 Oct 2026

A friend's PC (DeviceHub b621f5a4456d, Windows 11 25H2) sent a report by itself: the library driver
`logitech-hidpp-mouse` was "in an error for over 10 minutes" with "this Logitech device has no DPI feature (0x2201): it
is not a mouse this driver runs", status "connecting", and "USB: 046d:c539 the mouse's receiver or cable, not plugged in".
Nothing was sent to a device, DeviceHub was not restarted, nothing was committed. `npm run test:offline` passes.

## What went wrong

1. **The mouse driver took the first receiver slot that answered.** `connect()` pinged slots 1-6 and stopped at the
   first answer. If that device had no 0x2201 (a keyboard paired to the same receiver), it threw an error. It never
   looked at slots 2-6, so a mouse in slot 2 was never found. With only a keyboard on the receiver, the driver stayed in
   an error for good, and the 30 s retry repeated it.
2. **The error read as a fault.** `helpers/auto-report.mjs` NOT_A_FAULT had no wording for "not a mouse". After 10
   minutes in `error` the report went out. Being the wrong driver for a device is not a fault.
3. **"Not plugged in" was wrong.** `deviceProfile()` (helpers/diagnose.mjs, also used by Get help) took only the
   driver's first spec, `hid.pid` = C539, out of 39 product ids. The driver opens whichever receiver or cable it finds
   first (C539, C53A, C53D, C53F, C54D, C548, then the cables). So C539 "not plugged in" only means **the friend's
   receiver is another one of those ids**. The device that answered was reached through it.
4. **"Connecting"** is the 30 s retry (helpers/agent.mjs) caught mid-way. Get help built the report during a reconnect.

Which receiver and which keyboard the friend has is **not known**. The report never names the opened id. A Bolt
receiver (C548) with an MX keyboard in slot 1 fits best, but that is a guess. From now on the report names it
(`usbId`, below).

## Sources

| Fact | Source |
|---|---|
| C539, C53A, C53D, C53F, C541, C545, C547, C54D = Lightspeed (interface 2); C548 = Bolt; Lightspeed `max_devices` defaults to 1 when the receiver cannot say | Solaar `lib/logitech_receiver/base_usb.py`, `receiver.py` initialize @ e7304c4c451cc9bb4f206a914844525e67856a28 |
| C539 = "Logitech lightspeed receiver" (gaming HID++), C53A = POWERPLAY. No receiver id is tied to one kind of device | Linux `drivers/hid/hid-logitech-dj.c` @ a1c2b1da93f5f612aa7a33190c4900c98e51f6da |
| Receiver index 0xFF, paired devices 1-7 | same file, `HIDPP_RECEIVER_INDEX`, `DJ_DEVICE_INDEX_MIN/MAX` |
| Pairing table = get long register (0x83) 0xB5, param 0x20 + slot - 1, sent as a SHORT report (0x10) to 0xFF; reply LONG `FF 83 B5 ...`, wpid bytes 3-4, kind byte 7 & 0x0F (1 keyboard, 2 mouse, 0x0D headset) | Solaar `receiver.py` device_pairing_information, `hidpp10.py` read_register, `hidpp10_constants.py`; libratbag `src/hidpp10.c` hidpp10_get_pairing_information @ 8235b5bb6032dea15901ab58a8218956f4494d08; Linux `unifying_pairing_query` |
| An empty slot / unreachable device: the receiver's HID++ 1.0 error on a short report (0x08 unknown device, 0x09 resource error) | Solaar `base.py` ping |
| HID++ 2.0 device kind = DEVICE_NAME 0x0005 fn 0x20, byte 0: 0 keyboard ... 3 mouse ... 7 receiver | Solaar `hidpp20.py` get_kind, `hidpp20_constants.py` DEVICE_KIND @ e7304c4c |
| On Windows, OpenRGB sends its receiver register traffic on the short collection (usage 1). It also WRITES registers (notification flags, fake reconnect 0x02), which DeviceHub must not do | OpenRGB `LogitechProtocolCommon.cpp` getWirelessDevice (local copy of the source read for the sheet) |

## What changed

- **`device-library/logitech-hidpp-mouse/device.mjs`**: on a receiver, every slot 1-6 is asked, read-only: a ping, then
  getFeature 0x2201, then for a device without 0x2201 its kind (DEVICE_NAME fn 0x20, newly in ALLOWED: a read). Only a
  slot whose device has 0x2201 is run.
  - Nothing but other devices answer: the driver closes the receiver and throws `notMine` ("the Logitech device on
    receiver C539 (slot 1) is a keyboard, not a mouse this driver runs: the mouse driver leaves it alone").
  - Nothing answers: `connect()` returns true with `asleep = true`. read() says "asleep or switched off", so the status
    is asleep. awake() asks the slots again at most every 30 s, 1 s per ping. A wake into a keyboard steps aside.
  - A mouse with only 0x2202 steps aside too, and says so plainly.
  - `usbId` names the id it opened.
  - Wired and Bluetooth mice are unchanged, except that a missing 0x2201 is a step-aside, not an error.
- **`device-library/logitech-hidpp-keyboard/device.mjs`**: the mirror image. A mouse in a slot is left to the mouse
  driver, the first keyboard (or a device of unknown kind without 0x2201) is run, nothing answering = asleep. Its old
  "it is a mouse" error was the same bug the other way round.
- **One owner per slot**: `SLOT_OWNERS`, one Map on `globalThis` shared by both drivers (each library folder must work on
  its own once installed). Each handle on a receiver gets every input report, and replies are matched by device index.
  So two drivers on one receiver only fight over the SAME slot, and a slot another driver holds is never asked. Today the
  mouse and keyboard drivers share no receiver id (C541/C545/C547 are the keyboard's, the rest the mouse's), so this only
  matters once one is added to both.
- **Headset**: unchanged. It never opens a C5xx receiver (its dongles are 0Axx, addressed at 0xFF). A test now checks that.
- **`helpers/my-devices.mjs` `stepAside(a)`** (applied to every my-devices driver in loadOne):
  - a `notMine` error from connect() becomes `false` (status missing, no error) with `a.notMine = { why, at }`;
  - the next automatic connect rests 10 minutes (NOT_MINE_REST_MS); the person's Connect and a Windows device change look
    at once (`notMineRetry`, helpers/agent.mjs);
  - the library self-check does not run on an asleep connect.
  - The header documents the `notMine` and `asleep` contract.
- **`helpers/agent.mjs`**: the snapshot carries `adapter.notMine` and `adapter.usbId` for my-devices drivers.
- **`helpers/diagnose.mjs` `deviceProfile()`**: lists every id of every spec of the driver, with `usbId` first ("the
  receiver or cable the mouse is connected through"), and the open-and-close probe uses that id. New finding
  `not-mine` (rank 5): "Nothing is wrong and nothing needs doing". With it, no plug, off or error finding is added, and
  the probe is skipped. "Not plugged in" for a many-id driver is one sentence ("none of the 39 USB ids its driver knows").
- **`helpers/get-help.mjs`**: a driver with many ids lists the ids that are plugged in, else the first one and a count. A
  stepped-aside driver adds "Its driver stepped aside: ...".
- **`helpers/auto-report.mjs`**: these are never a fault: "not a mouse / keyboard / headset", "leaves it alone", "step
  aside" (NOT_A_FAULT), an adapter with `notMine` (checkDevices), and diagnose's `not-mine` finding (ORDINARY). The
  report's own wording is in the test.
- device.json (mouse, keyboard) works / doesNotWork and the brand sheet's new "Receiver slots" section say the same.

No new write anywhere. The only new request is DEVICE_NAME fn 0x20, a read. Nothing on helpers/never-commands.json is
sent. 0xB5 is not sent either: see below.

## Tests

- `tests/sim-logitech.mjs` section 9 uses a simulated C539 or C548 whose slots hold separate devices:
  - keyboard in slot 1 + mouse in slot 2: the mouse is run, and the keyboard got only reads;
  - keyboard alone: steps aside and the receiver closes; through stepAside() that is "not connected", it rests, a device
    change looks again, and a mouse paired later is found;
  - slot 1 asleep: the asleep state (6 pings, nothing else), a write waits, and it wakes in slot 1;
  - an empty receiver: asleep;
  - a sleeping keyboard that wakes: steps aside;
  - a slot held by the keyboard driver: never asked;
  - a 0x2202-only mouse: steps aside;
  - Bolt with the keyboard in 1 and the mouse in 3.
- `tests/sim-logitech-keyboard.mjs` section 6 runs the mirror image: a mouse in 1 and the keyboard in 2, a mouse alone,
  asleep, a shared owner table, a held slot.
- `tests/sim-logitech-headset.mjs`: no headset id is a receiver id.
- `tests/diagnose.mjs`: every id is listed and `usbId` comes first; the report's case (plugged in through C548) gives no
  "unplugged"; a stepped-aside driver gives `not-mine` first and nothing about plugs; asleep through a receiver; and
  "none of the 5 USB ids" in one sentence.
- `tests/auto-report.mjs`: the report's wording, the new wordings, asleep, an adapter with `notMine` and the `not-mine`
  finding are never sent.

## Untested on hardware (and open)

- Whether the friend's device was really a keyboard. It might be something else that answers without 0x2201, such as a
  POWERPLAY mat's own device. Their next report (or Request support) names `usbId` and the kind.
- Whether real Logitech devices answer DEVICE_NAME fn 0x20 as Solaar reads it. With no 0x0005 the kind is "a device
  without 0x2201", and the behaviour is the same.
- **The pairing table (0xB5) was not added.** It would tell empty from asleep and name the wpid without waking a slot.
  It needs a short report (0x10) on the receiver's short-report collection (usage 0x0001), which this driver does not
  open. `hid.routes` can send there, but the answer comes back on the LONG collection, and no test shows the helper
  delivering a reply across collections. helpers/never-commands.json also lists "receiver pairing registers". 0xB5 is
  the pairing INFORMATION read (Solaar names the pairing register 0xB2), but whether it is allowed is Shawn's call, not
  this change's.
- Timing on a receiver with nothing answering: each silent slot costs the ping timeout plus HidChannel's 400 ms quiet
  time, so about 18 s for the first connect and about 8 s per asleep look (every 30 s at most). The old code paid the
  same 18 s on every 30 s retry.
- An asleep-at-connect mouse logs "Logitech mouse connected" once (public/core/devices.js logs after any connect that
  returned true). Its self-check runs on the next connect where it answers, not the moment it wakes.
- dist/device-library.json (the signed bundle) is built at release. Friends get the fixed drivers from the next
  published library or DeviceHub update.

## For Shawn

- Reply to Dsmjr2/DeviceHub-support#2 and close it once this is published (CLAUDE.md "Problem reports").
- Decide whether reading 0xB5 (read-only) on the short collection is allowed. If yes, the next step is a helper test of
  a routed request whose reply lands on the main collection.
