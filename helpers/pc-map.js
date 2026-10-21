// This PC (20 Oct 2026): what is inside and what is plugged in, read-only (Windows' own CIM and Plug and Play lists;
// nothing is sent to any device). Read once on first ask, then kept for an hour (the parts do not change while it runs).
// Used by the Lighting page's "This PC" card and to name devices DeviceHub does not run yet (public/core/brands.js).
const { execFile } = require('child_process');

const PS = `
$ErrorActionPreference = 'SilentlyContinue'
$o = [ordered]@{}
$o.cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
$o.gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.PNPDeviceID -match '^PCI' } | ForEach-Object { [ordered]@{ name = $_.Name; pnp = $_.PNPDeviceID } })
$b = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$o.board = [ordered]@{ maker = $b.Manufacturer; model = $b.Product }
$o.ram = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [ordered]@{ part = ($_.PartNumber + '').Trim(); gb = [math]::Round($_.Capacity / 1GB); slot = $_.DeviceLocator; bank = $_.BankLabel } })
$o.usb = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(USB|HID)\\\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}' } | ForEach-Object { if ($_.InstanceId -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})') { [ordered]@{ vid = $matches[1].ToLower(); pid = $matches[2].ToLower(); name = $_.FriendlyName } } })
$o.lampArrays = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^HID\\\\' -and ($_.HardwareID -match 'UP:0059') }).Count
$o.smbus = @(Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -match 'SMBus' } | ForEach-Object { $_.FriendlyName })
$o | ConvertTo-Json -Depth 4 -Compress
`;

// GPU board makers by PCI subsystem vendor (the card's maker, not the chip's)
const GPU_MAKERS = { '1462': 'MSI', '1043': 'ASUS', '1458': 'Gigabyte', '19da': 'Zotac', '3842': 'EVGA', '1569': 'Palit', '10de': 'NVIDIA', '1da2': 'Sapphire',
  '148c': 'PowerColor', '1682': 'XFX', '196e': 'PNY', '1849': 'ASRock', '7377': 'Colorful', '1b4c': 'Galax / KFA2', '1002': 'AMD', '8086': 'Intel', '1787': 'HIS', '174b': 'Sapphire' };
// RAM makers by part number, and the families known to have lights (part number shapes from the makers' own lists)
const RAM = [
  [/^F[345]-/i, 'G.Skill', (p) => /TZR|TZRS|TZ5RK|TZ5RS|TZ5NR|GTZR|GTZRX|GTZN?R|TR5|TZ5RW/i.test(p) ? 'yes' : /GVK|GVKB|GVR|GIS|GISB|GNT|GRS|GFX|GTZ$|GTZB$|GTZ\b|GVGB|GVS|GSXW|GVSB/i.test(p) ? 'no' : 'unknown'],
  [/^CM[A-Z]/i, 'Corsair', (p) => /^CMW|^CMH|^CMT|^CMG|^CMN/i.test(p) ? 'yes' : /^CMK|^CMSX|^CMV|^CMSO/i.test(p) ? 'no' : 'unknown'],
  [/^KF/i, 'Kingston Fury', (p) => /A[ABH]?$|SA$|AK2|BAK|[0-9]A$/i.test(p) ? 'likely' : 'unknown'],
  [/^(TF|TD|FF|TLZ|TED|TTD|TPD)/i, 'TeamGroup', () => 'unknown'],
  [/^BL/i, 'Crucial Ballistix', (p) => /BLM|BLS?8G4D30AE/i.test(p) ? 'unknown' : 'unknown'],
  [/^(CT|CP)/i, 'Crucial', () => 'no'],
  [/^AX[45]/i, 'ADATA XPG', () => 'unknown'],
  [/^PV/i, 'Patriot Viper', () => 'unknown'],
];
// what DeviceHub already runs (its own drivers), by USB vendor:product
const RUNS = { '3710:5406': 'Mouse page', '1b1c:0a6b': 'Headset page', '342d:e479': 'Keyboard page', '291a:3369': 'camera mic (Sound)' };

let cache = { at: 0, value: null }, pending = null;
function read() {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' + PS], { windowsHide: true, timeout: 60000, maxBuffer: 4 << 20 }, (err, out) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('could not read this PC: ' + e.message)); }
    });
  });
}
function shape(raw) {
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  const gpus = arr(raw.gpus).map((g) => {
    const m = /SUBSYS_([0-9A-F]{4})([0-9A-F]{4})/i.exec(g.pnp || '') || [];
    return { name: g.name, maker: GPU_MAKERS[(m[2] || '').toLowerCase()] || null, subsystem: m[0] ? `${m[2]}:${m[1]}`.toLowerCase() : null };
  });
  // Windows lists each stick once per bank on some boards: keep one per part and slot
  const seen = new Set();
  const ram = arr(raw.ram).filter((r) => { const k = `${r.part}|${r.slot}|${r.bank}`; if (seen.has(k)) return false; seen.add(k); return true; }).map((r) => {
    const hit = RAM.find(([re]) => re.test(r.part));
    return { part: r.part, gb: r.gb, maker: hit ? hit[1] : null, lights: hit ? hit[2](r.part) : 'unknown' };
  });
  // one entry per vendor:product, named by its most telling part (not "USB Composite Device" or "HID Keyboard Device")
  const GENERIC = /^(USB (Composite|Input) Device|HID[- ]|HID Keyboard|USB Audio Device|Generic )/i;
  const byId = new Map();
  for (const u of arr(raw.usb)) {
    const k = `${u.vid}:${u.pid}`, cur = byId.get(k);
    if (!cur) byId.set(k, { id: k, vid: u.vid, pid: u.pid, name: u.name, runs: RUNS[k] || null });
    else if (GENERIC.test(cur.name || '') && u.name && !GENERIC.test(u.name)) cur.name = u.name;
  }
  const usb = [...byId.values()].map((u) => (GENERIC.test(u.name || '') ? { ...u, name: null } : u));
  return { cpu: raw.cpu, gpus, board: raw.board, ram, usb, lampArrays: raw.lampArrays || 0, smbus: arr(raw.smbus), readAt: new Date().toISOString() };
}
async function get(fresh = false) {
  if (!fresh && cache.value && Date.now() - cache.at < 3600e3) return cache.value;
  if (!pending) pending = read().then((raw) => { cache = { at: Date.now(), value: shape(raw) }; return cache.value; }).finally(() => { pending = null; });
  return pending;
}
// Paired Bluetooth devices (read-only): connected or not, and the battery Windows last read (Bluetooth LE devices
// such as an Xbox controller report it; most earbuds do not). Kept 30 s: connections change.
const BT = `
$ErrorActionPreference = 'SilentlyContinue'
$all = Get-PnpDevice
$top = $all | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\\\DEV_[0-9A-F]{12}' }
# one batched read of every Bluetooth node's battery and every device's connection (one call each, not one per node)
$nodes = @($all | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE|BTHLEDEVICE)\\\\' } | ForEach-Object { $_.InstanceId })
$bats = @{}; if ($nodes.Count) { foreach ($p in @(Get-PnpDeviceProperty -InstanceId $nodes -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2')) { if ($null -ne $p.Data) { $bats[$p.InstanceId] = [int]$p.Data } } }
$conns = @{}; if ($top) { foreach ($p in @(Get-PnpDeviceProperty -InstanceId @($top | ForEach-Object { $_.InstanceId }) -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15')) { $conns[$p.InstanceId] = [bool]$p.Data } }
$out = @(foreach ($d in $top) {
  $mac = ([regex]::Match($d.InstanceId, 'DEV_([0-9A-F]{12})')).Groups[1].Value
  $bat = $null
  foreach ($k in $bats.Keys) { if ($k -match $mac) { $bat = $bats[$k]; break } }
  [ordered]@{ name = $d.FriendlyName; le = [bool]($d.InstanceId -match '^BTHLE'); connected = [bool]$conns[$d.InstanceId]; battery = $bat }
})
ConvertTo-Json -InputObject $out -Depth 3 -Compress
`;
let btCache = { at: 0, value: null }, btPending = null;
function bluetooth(fresh = false) {
  if (!fresh && btCache.value && Date.now() - btCache.at < 30000) return Promise.resolve(btCache.value);
  if (!btPending) {
    btPending = new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' + BT], { windowsHide: true, timeout: 60000 }, (err, out) => {
      if (err) return reject(err);
      try {
        const list = JSON.parse(out || '[]');
        // "Shawn's AirPods Pro #2 - Find My": the name without the Find My suffix
        const value = (Array.isArray(list) ? list : [list]).map((d) => ({ ...d, name: String(d.name || '').replace(/\s+-\s+Find My$/i, '') }))
          .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
        btCache = { at: Date.now(), value }; resolve(value);
      } catch (e) { reject(e); }
    })).finally(() => { btPending = null; });
  }
  return btPending;
}

module.exports = { get, bluetooth, RUNS, _test: { shape } };
