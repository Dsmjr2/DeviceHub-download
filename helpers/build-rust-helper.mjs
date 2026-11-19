// Reproducible release build for helpers/native-rs/DeviceHubHelper.exe + source hash stamp.
// node helpers/build-rust-helper.mjs              builds into helpers/native-rs/target/release and stamps it there
// node helpers/build-rust-helper.mjs --out <dir>  (18 Nov 2026, the zip carries it now that Rust is the default;
//   helpers/make-installer.ps1) builds in a target folder of its own, so the helper this PC is running is never
//   replaced, and puts DeviceHubHelper.exe and its stamp (rust-helper-sources.sha256) in <dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rustSources = require('./rust-helper-sources');

const manifest = path.join(__dirname, 'native-rs', 'Cargo.toml');
const env = { ...process.env };
const cargoBin = path.join(process.env.USERPROFILE || '', '.cargo', 'bin');
if (cargoBin && !(env.PATH || '').includes(cargoBin)) {
  env.PATH = `${cargoBin};${env.PATH || ''}`;
}
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? path.resolve(process.argv[outAt + 1] || '') : null;
if (outAt > 0 && !process.argv[outAt + 1]) throw new Error('--out needs a folder');

const before = rustSources.sourcesHash(__dirname);   // taken before the build (a pull during it must not be stamped as built)
let target = null;
if (out) {
  target = path.join(os.tmpdir(), `DeviceHub-rust-target`);   // kept between publishes: a rebuild takes seconds, not minutes
  env.CARGO_TARGET_DIR = target;
}
execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', manifest], {
  stdio: 'inherit',
  env,
});

if (out) {
  const exe = path.join(target, 'release', rustSources.EXE_NAME);
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(exe, path.join(out, rustSources.EXE_NAME));
  const exeHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, rustSources.EXE_NAME))).digest('hex');
  fs.writeFileSync(path.join(out, rustSources.HASH_NAME), `${before}\n${exeHash}\n`);
  console.log(`[build-rust-helper] built ${path.join(out, rustSources.EXE_NAME)} (${before.slice(0, 12)})`);
} else {
  const hash = rustSources.recordHash(__dirname, before);
  console.log(`[build-rust-helper] built ${rustSources.rustExePath(__dirname)} (${hash.slice(0, 12)})`);
}
