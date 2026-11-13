// Step 1 verification: Rust helper is opt-in only (C# default), refuses stale/missing hashes,
// honors DEVICEHUB_CSHARP_HELPER=1 override, and keeps all helper-reads callers working on C#.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rustSources = require('../helpers/rust-helper-sources.js');
const helperReads = require('../helpers/helper-reads.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-rust-optin-'));
try {
  const dir = path.join(tmp, 'helpers');
  const root = tmp;
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'native-rs', 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'native-rs', 'target', 'release'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'bin', rustSources.EXE_NAME), 'csharp');
  fs.writeFileSync(path.join(dir, 'native-rs', 'Cargo.toml'), '[package]\nname="x"\n');
  fs.writeFileSync(path.join(dir, 'native-rs', 'Cargo.lock'), '# lock\n');
  fs.writeFileSync(path.join(dir, 'native-rs', 'src', 'main.rs'), 'fn main() {}\n');

  // 1. Default: C#
  let c = rustSources.selectHelper({ dir, root, env: {} });
  assert.equal(c.kind, 'csharp');
  assert.equal(c.reason, 'default');

  // 2. Opted in via env, but exe missing -> C# fallback
  c = rustSources.selectHelper({ dir, root, env: { DEVICEHUB_RUST_HELPER: '1' } });
  assert.equal(c.kind, 'csharp');
  assert.equal(c.stale, true);

  // 3. Exe present, hash missing -> C# fallback
  fs.writeFileSync(rustSources.rustExePath(dir), 'rust');
  c = rustSources.selectHelper({ dir, root, env: { DEVICEHUB_RUST_HELPER: '1' } });
  assert.equal(c.kind, 'csharp');
  assert.equal(c.stale, true);

  // 4. Stale hash -> C# fallback
  fs.writeFileSync(rustSources.rustHashPath(dir), '0'.repeat(64) + '\n');
  c = rustSources.selectHelper({ dir, root, env: { DEVICEHUB_RUST_HELPER: '1' } });
  assert.equal(c.kind, 'csharp');
  assert.equal(c.stale, true);

  // 5. Matching hash + DEVICEHUB_RUST_HELPER=1 -> Rust
  rustSources.recordHash(dir);
  c = rustSources.selectHelper({ dir, root, env: { DEVICEHUB_RUST_HELPER: '1' } });
  assert.equal(c.kind, 'rust');
  assert.equal(c.stale, false);

  // 6. Edit a Rust source without rebuilding -> immediately stale -> C# fallback
  fs.writeFileSync(path.join(dir, 'native-rs', 'src', 'main.rs'), 'fn main() { /* edited */ }\n');
  c = rustSources.selectHelper({ dir, root, env: { DEVICEHUB_RUST_HELPER: '1' } });
  assert.equal(c.kind, 'csharp');
  assert.equal(c.stale, true);

  // Re-record hash -> Rust again
  rustSources.recordHash(dir);

  // 7. Opted in via data/settings.json ("rustHelper": true)
  fs.writeFileSync(path.join(root, 'data', 'settings.json'), JSON.stringify({ rustHelper: true }));
  c = rustSources.selectHelper({ dir, root, env: {} });
  assert.equal(c.kind, 'rust');
  assert.equal(c.reason, 'settings.json rustHelper=true');

  // 8. DEVICEHUB_CSHARP_HELPER=1 overrides both env and settings.json
  c = rustSources.selectHelper({ dir, root, env: { DEVICEHUB_RUST_HELPER: '1', DEVICEHUB_CSHARP_HELPER: '1' } });
  assert.equal(c.kind, 'csharp');
  assert.equal(c.reason, 'DEVICEHUB_CSHARP_HELPER=1 override');

  // 9. Rust-only ops go straight to ps() when C# runs (no helper call, no log), and ask Rust first when Rust runs
  const rustOnlyOps = ['sleep-timer', 'close-app-window', 'corsair-apo-read', 'laptop', 'learn-hid-list', 'startup-apps-read', 'startup-impact-read', 'sleep-monitors'];
  for (const op of rustOnlyOps) {
    let helperCalled = 0;
    let psCalled = 0;
    const logs = [];
    const csharpNat = { helperKind: () => 'csharp', running: () => true, request: async () => { helperCalled++; return '{}'; } };
    const valCsharp = await helperReads.read(op, {
      nat: csharpNat,
      helper: async () => { helperCalled++; return { fail: 'should not be called' }; },
      ps: async () => { psCalled++; return { ok: true, op, from: 'ps' }; },
      log: (m) => logs.push(m),
    });
    assert.equal(helperCalled, 0, `${op}: C# running must never ask the helper`);
    assert.equal(logs.length, 0, `${op}: C# running must never log a fallback line`);
    assert.equal(psCalled, 1, `${op}: C# running must go straight to ps()`);
    assert.equal(valCsharp.from, 'ps');

    let rustAsked = 0;
    let rustFallbackPs = 0;
    const rustLogs = [];
    const rustNat = { helperKind: () => 'rust', running: () => true, request: async () => { rustAsked++; return JSON.stringify({ ok: false, error: 'boom' }); } };
    const valRustFail = await helperReads.read(op, {
      nat: rustNat,
      ps: async () => { rustFallbackPs++; return { ok: true, op, from: 'ps-fallback' }; },
      log: (m) => rustLogs.push(m),
    });
    assert.equal(rustAsked, 1, `${op}: Rust running must ask the helper first`);
    assert.equal(rustFallbackPs, 1, `${op}: Rust running must fall back to ps() on failure`);
    assert.equal(rustLogs.length, 1, `${op}: Rust failure logs once`);
    assert.equal(valRustFail.from, 'ps-fallback');
  }

  // 10. Prebuilt release install into a temp folder: C# stays default, Rust picked only when opted in
  const repoHelpers = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'helpers');
  const realExe = rustSources.rustExePath(repoHelpers);
  const realStamp = path.join(repoHelpers, 'native-rs', 'rust-helper-sources.sha256');
  if (fs.existsSync(realExe) && fs.existsSync(realStamp)) {
    const inst = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-rust-prebuilt-'));
    try {
      const instH = path.join(inst, 'helpers');
      const instRs = path.join(instH, 'native-rs');
      fs.mkdirSync(path.join(instRs, 'target', 'release'), { recursive: true });
      fs.mkdirSync(path.join(inst, 'data'), { recursive: true });
      fs.cpSync(path.join(repoHelpers, 'native-rs', 'src'), path.join(instRs, 'src'), { recursive: true });
      fs.copyFileSync(path.join(repoHelpers, 'native-rs', 'Cargo.toml'), path.join(instRs, 'Cargo.toml'));
      fs.copyFileSync(path.join(repoHelpers, 'native-rs', 'Cargo.lock'), path.join(instRs, 'Cargo.lock'));
      fs.copyFileSync(realStamp, path.join(instRs, 'rust-helper-sources.sha256'));
      fs.copyFileSync(realExe, rustSources.rustExePath(instH));
      assert.equal(rustSources.selectHelper({ dir: instH, root: inst, env: {} }).kind, 'csharp');
      assert.equal(rustSources.selectHelper({ dir: instH, root: inst, env: { DEVICEHUB_RUST_HELPER: '1' } }).kind, 'rust');
    } finally {
      fs.rmSync(inst, { recursive: true, force: true });
    }
  }

  console.log('rust-helper-optin (opt-in, stale hash refusal, C# override, helperReads C# fallback): all good');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
