# A failed read never writes

Wherever a file is read and then written, read it strictly (helpers/safe-write.js readJsonForWrite). A file that cannot be read is an error, never an empty default to save over it.

**What happened:** Settings sync, EQ presets and other stores could replace an unreadable file with a fresh empty one.

**Source:**
- JOURNAL.md, 5 Nov 2026 ("A failed read never writes")
- helpers/safe-write.js
