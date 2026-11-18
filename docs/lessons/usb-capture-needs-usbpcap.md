# Listening to USB needs USBPcap

Windows' own tracing (ETW through logman, pktmon, netsh trace) records no USB payload bytes on Windows 11 xHCI PCs. Learning a protocol needs USBPcap, installed only with the person's yes.

**What happened:** Checked in full on 22 Oct 2026 before building Learn a device without USBPcap; it cannot be done.

**Source:**
- docs/handoff/learn-builtin-capture.md
- CLAUDE.md, Adding your own devices, step 3
