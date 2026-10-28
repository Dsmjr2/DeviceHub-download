// Where this PC's own files live (27 Oct 2026, Shawn: tidy the DeviceHub folder): data\ beside the app, never in the
// zip, the download repository or git. dataFile(name) is the one place a helper builds such a path; the server's own
// log is in logs\ (logFile). helpers/data-migrate.js moves the files an older version kept beside the app into them.
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const LOGS = path.join(ROOT, 'logs');
const dataFile = (name, root = ROOT) => path.join(root || ROOT, 'data', name);
const logFile = (name, root = ROOT) => path.join(root || ROOT, 'logs', name);

// the per-PC files that used to sit beside the app (before 27 Oct 2026); helpers/install.ps1 $keep and
// helpers/make-installer.ps1 $private name each of them too (tests/data-migrate.mjs checks)
const DATA_FILES = [
  'activity.jsonl', 'auto-report-state.json', 'battery-care.json', 'battery-history.jsonl', 'daily-check.json',
  'eq-presets.json', 'game-mode.json', 'game-mode-state.json', 'headset-firmware.json', 'headset-lights.json',
  'health-watch.csv', 'last-device-values.json', 'last-monitor-values.json', 'lights-names.json',
  'mouse-battery-study.jsonl', 'mouse-level.json', 'pc-check-cache.json', 'profiles.json',
  'seen-devices.json', 'settings-sync-state.json', 'settings.json', 'setup.json', 'update-failed.txt',
  'update-rollback.txt', 'updates-cache.json', 'waiting-changes.json', 'waiting-monitors.json',
];
// the background picture (Settings > Appearance): background-picture.<jpg|png|webp|...>
const isPicture = (name) => /^background-picture\.[a-z0-9]{1,5}$/i.test(name);
const LOG_FILES = ['server.log', 'server.old.log'];

module.exports = { ROOT, DATA, LOGS, dataFile, logFile, DATA_FILES, LOG_FILES, isPicture };
