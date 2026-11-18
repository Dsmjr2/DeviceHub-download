# Copy registry values whole

Read registry values with `reg export` and write them with `reg import` of that same text. `reg query` prints Unity's 8-byte floats (stored as the DWORD type) cut to 4 bytes.

**What happened:** Game settings wrote PEAK's and other Unity games' sensitivity, FOV and volume wrong, and Put back could not undo it.

**Source:**
- docs/handoff/game-settings.md, Rules (13 Nov 2026 bug hunt)
- helpers/game-settings.mjs
