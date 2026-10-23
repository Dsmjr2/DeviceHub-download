# Learn a device: a 5-minute check on a real PC (23 Oct 2026)

Everything below was proven on pretend devices and on 58 published USB captures from other people's PCs. This is the
short check that it works on a real Windows PC with a real device. Nothing writes to a device until step 5, and step 5
only writes what was recorded from the maker's app, reading it back each time.

1. **Update and restart.** Settings > Update, then quit DeviceHub from the tray and start it again.
2. **Plug a device in while DeviceHub runs** (a spare mouse or keyboard DeviceHub does not run yet; Logitech and
   Sinowealth/258A devices are refused on purpose). Within a few seconds a message should say either "<name> is
   ready" (a shared driver was installed: Open its page) or "New: <name>" with **Learn it for me**. If nothing shows
   within 10 s, say so.
3. **Learn it for me.** Press it (or Learn a device > Learn it for me). Expected, with no other clicks:
   - the maker's app opens by itself if it is installed and closed;
   - Windows asks once: press Yes;
   - each setting is changed in the app by DeviceHub, or a line says "Set <setting> to <value> in <app> now". Do it, and
     DeviceHub should notice by itself within 2 s. If it does not, press "I changed it" and tell me which app (this is
     the one part never tried on a real PC: reading the recording while it is being written).
   - "Your <device> is learned", listing what it learned.
4. **If it stops**, the box says what to do next. Press Test my learning setup if it mentions listening, and Get help
   (top right) to send me what it found.
5. **Close <app> and turn on settings** (one button). Then on the device's page change one setting and check the maker's
   app shows the same value (open it again after), then change it back.

Tell Claude what each step showed (a screenshot of any cross or refusal is enough).
