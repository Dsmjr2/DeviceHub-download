# The helper failing never takes the server down

Everything that talks to the native helper answers GONE (or an error) when the helper is missing, stopped or cannot be built; nothing throws up through a request. Its stdin gets an error handler.

**What happened:** A write to a helper that had stopped (EPIPE, the PC sleeping) crashed the server; a helper that could not be built took it down five times and the launcher gave up.

**Source:**
- JOURNAL.md, 20 Oct 2026 ("Stability for other PCs")
- helpers/native.js (start, build, request)
