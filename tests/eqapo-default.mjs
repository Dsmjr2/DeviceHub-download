// Equalizer APO's own starting settings (its installer's "Preamp: -6 dB" + "Include: example.txt") are taken out, with a
// backup, so a fresh install does not make the headset quieter; DeviceHub's own or the person's own file is never
// touched (22 Oct 2026). Uses a stand-in Program Files folder; touches no real file. Run: node tests/eqapo-default.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-eqapo-'));
const cfgDir = path.join(root, 'EqualizerAPO', 'config'), cfg = path.join(cfgDir, 'config.txt'), backups = path.join(root, 'backups');
fs.mkdirSync(cfgDir, { recursive: true }); fs.mkdirSync(backups);
process.env.ProgramFiles = root;
const require = createRequire(import.meta.url);
const noDevices = async () => ({ headset: [], mic: [], speakers: [] });

fs.writeFileSync(cfg, 'Preamp: -6 dB\r\nInclude: example.txt\r\n');
require('../helpers/eqapo.js')(null, noDevices, backups);
check(!/Preamp: -6 dB/.test(fs.readFileSync(cfg, 'utf8')) && /Written by DeviceHub/.test(fs.readFileSync(cfg, 'utf8')), 'the installer default is taken out');
check(fs.readdirSync(backups).some((f) => f.startsWith('eqapo-config-default-')), 'the old default is backed up first');

const own = '# my own\r\nPreamp: -6 dB\r\nFilter 1: ON PK Fc 100 Hz Gain 3 dB Q 1\r\n';
fs.writeFileSync(cfg, own);
delete require.cache[require.resolve('../helpers/eqapo.js')];
require('../helpers/eqapo.js')(null, noDevices, backups);
check(fs.readFileSync(cfg, 'utf8') === own, "the person's own settings are left alone");

const dh = '# Written by DeviceHub (Headset page)\r\nPreamp: -4.13 dB\r\n';
fs.writeFileSync(cfg, dh);
delete require.cache[require.resolve('../helpers/eqapo.js')];
require('../helpers/eqapo.js')(null, noDevices, backups);
check(fs.readFileSync(cfg, 'utf8') === dh, "DeviceHub's own settings are left alone");

fs.rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `eqapo-default: FAILED: ${fails.join('; ')}` : "eqapo-default (Equalizer APO's quieter starting settings): all good");
process.exit(fails.length ? 1 : 0);
