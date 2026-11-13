// Reproducible release build for helpers/native-rs/DeviceHubHelper.exe + source hash stamp.
import path from 'node:path';
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

const before = rustSources.sourcesHash(__dirname);   // taken before the build (a pull during it must not be stamped as built)
execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', manifest], {
  stdio: 'inherit',
  env,
});

const hash = rustSources.recordHash(__dirname, before);
console.log(`[build-rust-helper] built ${rustSources.rustExePath(__dirname)} (${hash.slice(0, 12)})`);
