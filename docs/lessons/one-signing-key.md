# One signing key, never a new one

Releases are signed with the one Ed25519 key in Bitwarden (DEVICEHUB_RELEASE_KEY). Never make a new key and never write it to a file: every installed copy checks updates against helpers/release-public-key.pem and would refuse them.

**What happened:** Signed updates since 21 Oct 2026; the key moved to Bitwarden on 4 Nov and the last file copy was deleted.

**Source:**
- CLAUDE.md, Publishing and the signing key
- helpers/signing-key.mjs
