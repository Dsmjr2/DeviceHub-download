// The Rust helper on trial (13 Nov 2026 bug hunt, helpers/rust-helper-sources.js): C# takes over after the Rust helper
// stopped 3 times in 10 minutes, a Rust exe that is not the one stamped is refused, and an older one-line stamp is
// still read. Temp folders only; no helper is started.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const R = createRequire(import.meta.url)('../helpers/rust-helper-sources.js');

let bad = 0;
const check = (ok, what) => { if (!ok) { bad++; console.log(`FAIL ${what}`); } };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-rust-fallback-'));
const dir = path.join(base, 'helpers'), root = base;
fs.mkdirSync(path.join(dir, 'native-rs', 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, 'native-rs', 'Cargo.toml'), '[package]\nname = "x"\n');
fs.writeFileSync(path.join(dir, 'native-rs', 'src', 'main.rs'), 'fn main() {}\n');
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'settings.json'), JSON.stringify({ rustHelper: true }));
fs.mkdirSync(path.dirname(R.rustExePath(dir)), { recursive: true });
fs.writeFileSync(R.rustExePath(dir), 'built exe');
const env = {};
const pick = (o = {}) => R.selectHelper({ dir, root, env, ...o });

// an older one-line stamp (the live trial's): still Rust
fs.writeFileSync(R.rustHashPath(dir), R.sourcesHash(dir) + '\n');
check(pick().kind === 'rust', 'one-line stamp: Rust');

// the new stamp holds the exe's hash too
R.recordHash(dir);
check(R.readStamp(dir).exe && pick().kind === 'rust', 'stamp with the exe hash: Rust');
fs.writeFileSync(R.rustExePath(dir), 'another build');
const swapped = pick();
check(swapped.kind === 'csharp' && /not the one built/.test(swapped.reason), `an exe that is not the stamped one: C# (${swapped.reason})`);
fs.writeFileSync(R.rustExePath(dir), 'built exe');

// crashes: two in 10 minutes keep Rust, three switch to C#, old ones do not count
const now = Date.now();
check(pick({ crashes: [now - 1000, now - 2000], now }).kind === 'rust', 'two stops: still Rust');
const c = pick({ crashes: [now - 1000, now - 2000, now - 3000], now });
check(c.kind === 'csharp' && c.crashed, `three stops in 10 minutes: C# (${c.reason})`);
check(pick({ crashes: [now - 11 * 60000, now - 12 * 60000, now - 1000], now }).kind === 'rust', 'stops older than 10 minutes do not count');

// the build stamps the hash taken before it ran (a pull during the build)
const before = R.sourcesHash(dir);
fs.writeFileSync(path.join(dir, 'native-rs', 'src', 'main.rs'), 'fn main() { /* pulled during the build */ }\n');
R.recordHash(dir, before);
check(pick().kind === 'csharp', 'sources changed during the build: the stamp is the older hash, so C#');

fs.rmSync(base, { recursive: true, force: true });
console.log(bad ? `rust-helper-fallback: ${bad} failed` : 'rust-helper-fallback: all checks passed');
process.exit(bad ? 1 : 0);
