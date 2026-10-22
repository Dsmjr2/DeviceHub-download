# Pre-built native helper (22 Oct 2026)

Before this, a new PC had to compile `helpers/bin/DeviceHubHelper.exe` with Windows' C# compiler. If that build failed
there were no devices at all, and someone had to call Claude. Now the installer ships the helper already built, and a
new PC compiles only if DeviceHub's own C# sources are changed on it.

## How it works

- **`helpers/helper-sources.js`** (new) holds the one decision. It only reads files and decides; it never builds or
  starts anything.
  - `SOURCE_FILES` is the list `build.ps1` compiles. `tests/prebuilt-helper.mjs` checks the two lists agree.
  - `sourcesHash(dir)` takes the SHA-256 of each source's content, joins them in sorted name order (hex plus a
    newline each), and hashes that. It uses exact bytes, so a changed line ending counts as a change. File times are
    not used.
  - `decide(dir)` returns one of three modes:
    - `shipped`: `helpers/bin/helper-sources.sha256` matches the current sources and the exe exists. The exe is used
      and never rebuilt, even when unzipping has made the sources look newer than the exe.
    - `changed`: there is a recorded hash, but it no longer matches (a self-update or an edit on that PC changed the
      sources), or the exe is missing. The helper is rebuilt.
    - `mtime`: there is no recorded hash. This is a development copy, such as Shawn's own repo, and the rule is the
      same as before: rebuild when the exe is missing or older than any source.
  - CLI: `node helpers/helper-sources.js --hash [helpersDir]` prints the hash, and `--record [helpersDir]` writes it to
    `bin/helper-sources.sha256`.
- **`helpers/native.js` `build()`** follows `decide()`.
  - After a successful rebuild in `changed` mode, it records the new hash, so the next start does not compile again.
  - If a rebuild in `changed` mode fails while an exe exists, the exe built from the earlier sources keeps running.
    `start()` logs one line: `[helper] the sources changed but the helper could not be rebuilt (<reason>); running the
    shipped helper built from the earlier sources`. The 10-minute retry rule applies as before.
  - Everything else is unchanged. A failure with no exe at all logs `[helper] could not be built: ...` and every
    request answers GONE.
  - `build(dir, run)` takes a different helpers folder and a stand-in compiler for tests. It is exported as
    `buildHelper`.
- **`helpers/native/build.ps1`** accepts `-Out <file>`. Without it, it builds to `helpers\bin\DeviceHubHelper.exe` as
  before, and `native.js` still calls it without the option.
- **`helpers/make-installer.ps1`** builds the helper from the working-tree sources into
  `%TEMP%\DeviceHub-helper-<pid>\`, so this PC's own running `helpers\bin` exe is never replaced. It hashes the sources
  with `helper-sources.js --hash`, puts `helpers/bin/DeviceHubHelper.exe` and `helpers/bin/helper-sources.sha256` in the
  zip, and adds both to `release-files.json`. That file list sits inside the zip whose size and SHA-256 `version.json`
  signs. If the build fails, the installer build stops. After building, it checks that `helpers/bin` in the zip holds
  exactly those two files.
  - New `-NoSign` option for test builds: `version.json` is left unsigned (copies refuse it as an update), and the
    signed library bundle is not made. The publisher's key is not used for these builds.
- **`helpers/install.ps1`** checks the shipped helper first, using the bundled node to run
  `helper-sources.js --hash`.
  - If the hash matches, it prints "included, ready-built for this version" and compiles nothing.
  - Otherwise it builds as before. After a successful build it records the new hash. If the build fails, it says the
    ready-built helper will be used.
  - If the C# compiler is missing but the helper ships with the zip, the PC check no longer warns that devices will
    not work.
  - The "changed on this PC" check skips `helpers/bin/*`, because those files are build output.
- **`helpers/self-update.js` `changedFiles()`** skips `helpers/bin/*` for the same reason. Without that, a helper
  rebuilt on the PC would differ from `release-files.json` and block every zip update.
- **How an update replaces the helper:** a zip update runs the new release's `install.ps1`. It quits the running copy
  (the helper included, since its exe is inside the target folder), robocopies `helpers\bin` from the release over the
  old one (both files together), and then finds the hash matches. A git-connected copy (a `DeviceHub-download` merge)
  gets new sources but no new exe, because `helpers/bin` is ignored by git. On its next start the hash differs, the
  helper is rebuilt, and if that rebuild fails the shipped exe keeps running.
- `helpers/bin/` stays in `.gitignore`. The exe is not committed; it is built when the installer is made.

## Shawn's repo

This repo has no `helpers/bin/helper-sources.sha256` (only the installer writes one), so it stays in `mtime` mode and
rebuilds when a source is edited, as before. `native.js` never writes a hash file in `mtime` mode.
`tests/prebuilt-helper.mjs` proves both points: section 5 tests a development copy, and section 6 checks this repo
itself. The running copy on 5577 was not restarted, and its `helpers\bin\DeviceHubHelper.exe` (07:56:19) was not
touched.

## Verified on 22 Oct 2026

- `node tests/prebuilt-helper.mjs`: 35 checks, all good. It covers the source list against `build.ps1`, the hash, the
  shipped, changed, failed-rebuild, no-exe and dev-copy cases, this repo, and the installer, `install.ps1` and
  self-update text. `npm run test:offline` passes.
- A test installer was built from a temporary clone, `%TEMP%\dh-prebuilt-test\src`, with these changes copied in and
  the three bundled libraries copied (not linked). It was built with
  `make-installer.ps1 -NoPublish -NoTools -NoSign`. Nothing was published or uploaded, `gh` was not run, and the
  signing key was not used. The zip held 392 files (42.7 MB), and the clone's own `helpers\bin` was never created.
- In the unzipped copy, checked with its bundled `runtime\node.exe`:
  - `helpers/bin` held `DeviceHubHelper.exe` (a PE file, 93,696 bytes) and `helper-sources.sha256`. Both were listed in
    `release-files.json` with matching SHA-256s.
  - The recorded hash matched `--hash`, and `decide` returned `shipped`.
  - `buildHelper()` with the real `build.ps1` runner returned `shipped` without compiling, and still did so after every
    source was touched to look newer than the exe.
  - With the real compiler: a source that does not compile gave the fallback line, and the exe was left unchanged. A
    valid edit was rebuilt (the exe changed), the new hash was recorded, and the next decision was `shipped`.
- Isolated mode on the unzipped copy (`DEVICEHUB_ISOLATED=1`, `DEVICEHUB_PORT=5591`, bundled node): `/api/version`
  answered. No `csc.exe` or `DeviceHubHelper.exe` process started from that copy, and its exe was unchanged. The test
  server was stopped by its own PID. Isolated mode skips the helper entirely, which is why the selection logic is also
  covered by the unit test. The real DeviceHub on 5577 was still answering.
- Not tested: running `install.ps1` itself, because it writes a Windows Apps registry entry. It parses without errors,
  and its new lines are checked as text by the test.

## Still to do (owner)

- Add the test to package.json: append ` && node tests/prebuilt-helper.mjs` to both `"test"` and `"test:offline"`.
- CLAUDE.md, suggested line for where the helper build is described: "The installer ships helpers/bin/DeviceHubHelper.exe
  ready-built with helpers/bin/helper-sources.sha256 (the hash of its sources). An installed copy compiles only when
  its sources no longer match that hash; a development copy (no hash file) rebuilds when a source is newer, as before
  (helpers/helper-sources.js, docs/handoff/prebuilt-helper.md)."
