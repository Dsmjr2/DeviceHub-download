// Keeps backups\ from growing forever (20 Oct 2026). DeviceHub backs a device up before every change; nothing ever
// removed them (1,055 files after two days of testing). Nothing is deleted outright: per kind of backup (the name
// before its timestamp: mouse, keyboard, monitor-ACERVG272UV, ...) DeviceHub keeps
//   - the newest 20,
//   - the newest of each day for the last 90 days,
//   - the first one ever (the device as it was before DeviceHub changed it),
// and moves every other one into backups\older-backups.zip, removing a file only after the zip holds it with the same
// size. Only files whose name ends in a timestamp are touched; folders and anything else stay as they are.
// Runs 2 minutes after start and then once a day.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const NAME = /^(.+?)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z\.[a-z0-9]+$/i;
const KEEP_NEWEST = 20, KEEP_DAYS = 90;

// which files to move: [{ file, kind, at }]
function plan(dir, now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name); } catch { return []; }
  const byKind = new Map();
  for (const n of names) {
    const m = NAME.exec(n); if (!m) continue;
    const at = Date.parse(`${m[2]}T${m[3]}:${m[4]}:${m[5]}.${(m[6] || '0').padEnd(3, '0')}Z`);
    if (!Number.isFinite(at)) continue;
    if (!byKind.has(m[1])) byKind.set(m[1], []);
    byKind.get(m[1]).push({ file: n, kind: m[1], at, day: m[2] });
  }
  const move = [];
  for (const list of byKind.values()) {
    list.sort((a, b) => b.at - a.at);                       // newest first
    const keep = new Set(list.slice(0, KEEP_NEWEST).map((x) => x.file));
    keep.add(list[list.length - 1].file);                   // the first ever
    const seenDay = new Set();
    for (const x of list) if (now - x.at <= KEEP_DAYS * 86400e3 && !seenDay.has(x.day)) { seenDay.add(x.day); keep.add(x.file); }
    for (const x of list) if (!keep.has(x.file)) move.push(x);
  }
  return move;
}

// adds the files to older-backups.zip (Windows' own .NET zip), then removes each one the zip holds with the same size
function archive(dir, files) {
  if (!files.length) return Promise.resolve({ moved: 0 });
  const list = path.join(dir, `.tidy-${process.pid}.txt`);
  fs.writeFileSync(list, files.map((f) => f.file).join('\n'));
  const zip = path.join(dir, 'older-backups.zip');
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$dir = '${dir.replace(/'/g, "''")}'; $zipPath = '${zip.replace(/'/g, "''")}'
$names = Get-Content -LiteralPath '${list.replace(/'/g, "''")}'
$z = [System.IO.Compression.ZipFile]::Open($zipPath, 'Update')
$ok = @()
try {
  $have = @{}; foreach ($e in $z.Entries) { $have[$e.FullName] = $e.Length }
  foreach ($n in $names) {
    $f = Join-Path $dir $n; if (-not (Test-Path -LiteralPath $f)) { continue }
    if (-not $have.ContainsKey($n)) { [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f, $n, 'Optimal') }
  }
} finally { $z.Dispose() }
# read the zip back: only a file it holds whole is removed
$z = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try { $have = @{}; foreach ($e in $z.Entries) { $have[$e.FullName] = $e.Length } } finally { $z.Dispose() }
$moved = 0
foreach ($n in $names) { $f = Join-Path $dir $n; if ((Test-Path -LiteralPath $f) -and $have.ContainsKey($n) -and $have[$n] -eq (Get-Item -LiteralPath $f).Length) { Remove-Item -LiteralPath $f -Force; $moved++ } }
$moved
`;
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 300000 }, (err, out) => {
    try { fs.unlinkSync(list); } catch {}
    resolve(err ? { moved: 0, error: err.message.split('\n')[0] } : { moved: Number(String(out).trim()) || 0 });
  }));
}

let timer = null;
function start(dir, log = () => {}) {
  const run = async () => {
    const files = plan(dir);
    if (!files.length) return;
    const r = await archive(dir, files);
    if (r.error) log({ kind: 'bad', text: `Backups not tidied: ${r.error}` });
    else if (r.moved) console.log(`[backups] ${r.moved} older backups moved into older-backups.zip`);
  };
  setTimeout(() => { run().catch(() => {}); timer = setInterval(() => run().catch(() => {}), 86400e3); timer.unref?.(); }, 120000).unref?.();
}

module.exports = { start, plan, archive };
