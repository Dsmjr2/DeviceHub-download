# Never send a device write twice

A write that timed out or lost its channel may already have reached the device. Do not send it again on the strength of "no answer": drop it, read the device, and decide from what it says. Reads may be asked again.

**What happened:** A timed-out headset SET was queued in the helper and carried out late, then sent again on reconnect; a mouse write was resent over the dongle after the cable was pulled.

**Source:**
- Commit dd924ac (request deadlines, 15 Nov 2026) and JOURNAL.md, 15 Nov 2026 (the cable pulled mid-request)
- helpers/native.js (request deadlines)
- helpers/hid-host.mjs sendNow (spec.resend)
