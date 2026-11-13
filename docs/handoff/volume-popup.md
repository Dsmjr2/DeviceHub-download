# Windows' volume pop-up showing by itself (13 Nov 2026)

Shawn: "why is my volume slider randomly popping up?" and "it would glitch going quickly up and down. this seems like a
headset bug". Not new; seen again around 12:45-12:56 AM on 13 Nov while Antigravity's soak test wrote the HS80.

## Checked (13 Nov, on the PC, HS80 on its receiver)

- **Idle, 30 s:** no volume change on the HS80's sound devices.
- **Every HS80 setting written with its own value** (volume, mute, sidetone, sidetone on, logo, mic light, colour, mic
  level), 4 s apart, as the soak test does: no volume change at all.
- **Volume 80 -> 79 -> 80 through DeviceHub:** exactly one change each, and the headset sent no volume key back. So
  there is no loop between DeviceHub and the headset.
- The Rust helper sets the volume the same way as the C# one (SetMasterVolumeLevelScalar, once), so it is not the
  cause either.
- DeviceHub only changes the Windows volume when asked (a slider, a profile) or when the HS80 moves between cable and
  receiver (helpers/audio-follow.js; its "set to match" line has never appeared in Activity).

What does send it: the HS80 has two volume-key inputs (HID usage page 0x0C on the receiver, mi_03 col03/col04), and
the P75 and the mouse receiver have one each. Windows shows its pop-up for every volume key it gets. Quick up-and-down
with the pop-up is what a jittering volume wheel (or knob) looks like.

## Tools (read-only)

- `helpers\volume-watch.ps1 -Seconds 600`: every volume/mute change Windows reports on the HS80, with the time and who
  made it. DeviceHub's own changes show `by=DeviceHub` (helpers/audio.cs tags them since 13 Nov).
- `helpers\volume-keys.ps1 -Seconds 600`: every volume-key report from every device (headset wheel, keyboard knob,
  media keys), with the time.

Run both while it happens: a burst of keys from `vid_1b1c` is the headset's wheel, from `vid_342d` the P75's knob; a
volume change with no key and no `by=DeviceHub` is another program.
