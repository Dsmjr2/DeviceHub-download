# The device library

Drivers for devices DeviceHub does not run by itself, written by someone who has the device (usually with their
Claude) and shared so the next person with the same device simply gets it. It ships with DeviceHub.

Each entry is one folder, `device-library\<vendor-product>\` (a-z, 0-9 and `-`, for example `logitech-g-pro-x`):

- `device.mjs`: the driver, exactly as it runs in `my-devices\` (see "Adding your own devices" in CLAUDE.md and
  `helpers\my-devices.mjs`).
- `device.json`: what it is and how far it was tested:

```text
{
  "id": "logi-gpro-x",               "the driver's id (device.mjs id)"
  "vendor": "Logitech", "product": "G Pro X Superlight", "kind": "Mouse",
  "vid": "046d", "pids": ["c547", "c094"],          "every product id it answers on (receiver, cable)"
  "models": ["G Pro X Superlight"],
  "works": ["DPI", "polling rate", "battery"],      "what was checked to work"
  "doesNotWork": ["firmware updates"],
  "status": "tested",                               "tested | read-only | untested"
  "tested": [{ "by": "a public name", "date": "2026-10-22", "devicehub": "0.1.0", "how": "each setting written once and read back" }]
}
```

`status` means:
- **tested**: every setting was written once and read back on the real device. Auto setup installs these by itself.
- **read-only**: the driver reads the device correctly; its writes were not tried. Auto setup installs these by itself
  too, and each setting stays read-only until it passes DeviceHub's self-check (write its current value back once,
  read it the same). A plain `installFromLibrary(name)` without `readOnly: true` still takes tested entries only.
- **untested**: written from a protocol description, not yet run on the device. Not installed by itself: the Set up
  card offers an Install button.

What happens after install also depends on `tested` (safety round 2, 22 Oct 2026; `helpers/my-devices.mjs`):
- **with a real-device record** (an entry that is not a simulation: not `"simulation": true`, and its `by` / `how`
  do not say simulated, a `tests/` file, or "not tested yet"): the self-check runs by itself when the device connects,
  and a "tested" entry's settings change normally until one fails its check.
- **with no real-device record** (whatever the status; every entry shipped today): it installs and READS by itself,
  but writes nothing, its self-check included, until the person presses **Turn on settings** for that device (its
  page, or the Set up card). DeviceHub writes each setting's current value back once to make sure it works; each one
  that passes can then be changed. A "tested" entry without a real-device record is treated like a read-only one.

No entry is installed, by itself or on a click, when any of its product ids is one DeviceHub's own drivers run
(`helpers/pc-map.js` RUNS: the HS80, the Pulsar mouse, the P75).

## How it is used

`helpers\device-library.mjs` compares the PC's USB devices (vendor and product ids, as `/api/pc` lists them) with the
entries. `installFromLibrary(name)` copies a tested entry (with `readOnly: true`, a read-only one too) into
`my-devices\<name>\` (never over a folder that is already there). Auto setup (`helpers\auto-setup.mjs`) does this when
DeviceHub starts and loads the driver at once, or says to restart. Nothing in the library is ever changed by that.

## How to add one

From a driver that works in `my-devices\`:

```
node helpers\share-device.mjs <my-devices folder> --status tested --by <a public name>
```

It copies `device.mjs`, writes `device.json`, and refuses the whole folder if anything in it is personal: backups,
logs, USB captures (`*.pcap`, `*.pcapng`), settings dumps, memory dumps, serial numbers, device instance ids,
Bluetooth addresses, e-mail addresses, the PC's user or computer name, or paths with a user's name. It lists every
file and line it refused. Then it prints the steps to send the entry in: a pull request to
[Dsmjr2/DeviceHub-download](https://github.com/Dsmjr2/DeviceHub-download), made by the person. DeviceHub never sends
anything for them.

Every rule in CLAUDE.md applies to a library driver as to any other: no firmware, resets or bootloader commands, only
bytes seen in a capture or documented, one setting at a time with a read-back.

Folders starting with `_` are examples. `_example-light` is a pretend light (FFFF:FFE0 is not a real product) that is
offered and installs only in demo and tests (`DEVICEHUB_EXAMPLE_DEVICE=1`).
