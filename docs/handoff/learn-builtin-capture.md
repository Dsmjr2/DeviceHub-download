# Learn a device without USBPcap: not possible with Windows' own tools (22 Oct 2026)

The ask: let Learn a device record USB traffic with something built into Windows 11 (ETW through logman/tracerpt,
pktmon or netsh trace) when USBPcap is not installed. Result: **no built-in Windows tool records USB payload bytes on
this PC (Windows 11 23H2, build 22631.6199, xHCI controllers only)**. Nothing user-facing was changed; USBPcap stays
the only way to listen. Nothing was committed.

## What was checked (all read-only; no device was opened, nothing was sent to one)

1. **The providers exist** (`logman query providers`): Microsoft-Windows-USB-UCX, -USBXHCI, -USBHUB3, -USBPORT,
   -USBHUB. UCX, USBHUB3 and USBXHCI list the keywords HeadersBusTrace (0x40), PartialDataBusTrace (0x80) and
   FullDataBusTrace (0x100).
2. **The manifests promise payloads** (event templates read with TDH, `TdhGetManifestEventInformation`): UCX events 22
   and 25 ("Complete URB_FUNCTION_CONTROL_TRANSFER[_EX] with data") and 28 / 29 ("Complete
   URB_FUNCTION_BULK_OR_INTERRUPT_TRANSFER with partial / full data") carry `fid_URB_TransferData`, with the setup
   packet in 22 and 25. USBHUB3 events 6 and 43 carry each device's descriptor (vid, pid) and port path, so a device
   could have been found. USBXHCI has no data field at all.
3. **The live trace has no payloads.** A short session started with logman (this account is in Performance Log Users,
   so no admin prompt appeared), 3 seconds each, nothing changed on any device, with UCX keywords 0x8101, 0x81C1,
   0x8081 and 0x8041 (plus USBHUB3 and USBXHCI 0x81C1 in one run). Every run: the rundowns (UCX device 5, endpoint 6;
   USBHUB3 device information 6 v2) and the transfers as UCX 26 (dispatch) and **27 version 1, "complete" without
   data** (hundreds of interrupt completions from the plugged-in devices), isochronous 30 / 31 without data. **Not one
   event 22, 25, 28, 29 or 33** in any run, whatever data keyword was on. The layouts matched TDH byte for byte (27 v1 =
   172 bytes, device rundown 56, endpoint rundown 31), so this was not a decoding mistake.
4. **The driver cannot write them.** In `ucx01000.sys` 10.0.22621.5415, the EVENT_DESCRIPTOR of every event the trace
   showed (26, 27 v1, 21 v1, 31) is in `.rdata` and is loaded by the code (`lea rdx, [rip+...]`). The descriptors of
   the data events (22, 25, 28, 29, 33) are **only in `.rsrc`** (the manifest resource) and nothing in the code
   refers to them. They are left over in the manifest; this driver build never emits them.
5. **USBPORT** (USB 2.0 controllers) still has data events (68, 69, 71, 76: "Complete with Data"), but it only runs
   for EHCI/OHCI/UHCI controllers. This PC has none (`usbehci` stopped; both controllers are AMD xHCI), like nearly
   every Windows 11 PC.
6. **pktmon** captures network packets only. **netsh trace** has 24 scenarios on this PC and none for USB; it would use
   the same providers anyway.

So the wizard cannot learn anything from a built-in trace: it would see that a transfer happened and its length, never
its bytes (no SET_REPORT data, no GET_REPORT reply, no interrupt OUT or IN data).

## What was left as it was

- `helpers/learn-capture.ps1`, `helpers/learn-wizard.mjs`, `helpers/pcap-read.mjs`, `public/pages/learn.js`,
  `tests/learn-wizard.mjs`: unchanged. The wizard still offers the USBPcap install.
- A trial ETL reader (`helpers/etw-dump.ps1`, OpenTrace / ProcessTrace, no admin) was written to measure point 3, read
  a Windows log .etl and the USB traces correctly, and was removed again: with no payloads it has nothing to feed the
  wizard. No ETW session was left running (`logman query -ets`), and the trace files were deleted.

## If someone wants to check again on a later Windows build

Read-only, no admin, a minute:
- Search `C:\Windows\System32\drivers\ucx01000.sys` for the 16 bytes of event 29's descriptor
  `1D 00 00 10 04 02 15 00 00 01 00 00 00 00 00 80` (id 29, version 0, channel 16, level 4, opcode 2, task 21, keyword
  0x8000000000000100). Found only once (in the manifest resource) = still not emitted. Found in `.rdata` as well = it
  may be written again; then run a 3-second logman session with UCX `0x8101` and look for events 22 / 29.
- Note: an account in Performance Log Users can start that session without a prompt, so if payloads ever come back,
  any such account could record every keystroke of a USB keyboard. A built-in backend would then need to keep only the
  learned device's transfers on disk.

## Lines for you

None (no change to `CLAUDE.md`, `server.js` or `package.json`). Optional, under "Learning a protocol" in `CLAUDE.md`:
"Windows' own USB tracing (ETW, logman, pktmon, netsh trace) records no payload bytes on Windows 11 xHCI PCs, so
USBPcap stays the only way to listen (docs/handoff/learn-builtin-capture.md)."
