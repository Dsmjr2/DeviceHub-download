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
$o.usb = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(USB|HID)\\\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}' } | ForEach-Object { if ($_.InstanceId -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})') { [ordered]@{ vid = $matches[1].ToLower(); pid = $matches[2].ToLower(); name = $_.FriendlyName; kb = [bool](@($_.HardwareID) -match 'UP:0001_U:0006'); mouse = [bool](@($_.HardwareID) -match 'UP:0001_U:0002'); onUsb = [bool]($_.InstanceId -match '^USB\\\\'); pages = @(@($_.HardwareID) | ForEach-Object { if ($_ -match 'UP:(FF[0-9A-F]{2})_U:([0-9A-F]{4})') { $matches[1] + ':' + $matches[2] } }) } } })
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
// what DeviceHub already runs (its own drivers), by USB vendor:product. Every id its own drivers open belongs here
// (22 Oct 2026, safety round 2): the Pulsar's dongle 5406 and its cable 3506 (hid-host.mjs SPECS cablePid), the HS80's
// receiver 0a6b, its USB cable 0a69 (hs80-direct.js CONNS) and 0a71, the id the HS80 has behind its receiver
// (docs/brands/corsair.md, OpenLinkHub). Only labels and guards read this list (This PC's "runs" column, OpenRGB's
// own-device filter, the learning wizard, the library guards in my-devices.mjs, device-library.mjs, auto-setup.mjs);
// which page runs a device is decided by its own driver, so the Headset page is unchanged. The HS80 RGB USB (0a88) is
// another model DeviceHub's HS80 code does not open, so it is not listed.
const VIRTUAL = new Set(['046d:c231', '046d:c232']);
const RUNS = { '3710:5406': 'Mouse page', '3710:3506': 'Mouse page (its USB cable)', '1b1c:0a6b': 'Headset page', '1b1c:0a69': 'Headset page (its USB cable)', '1b1c:0a6a': 'Headset page (its USB cable, charging)', '1b1c:0a71': 'Headset page (behind its receiver)', '342d:e479': 'Keyboard page', '291a:3369': 'camera mic (Sound)' };

let cache = { at: 0, value: null }, pending = null;
// through the native helper first (helpers/pc-reads.cs op pc-map, the same JSON), PowerShell when it cannot answer
const read = () => require('./helper-reads').read('pc-map', { ps: readPs, ms: 30000 });
function readPs() {
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
  // G HUB's own pretend devices (24 Oct 2026, Dsmjr2/DeviceHub-support#17: "a Logitech keyboard when there isnt"):
  // 046D:C232 is the "Logitech G HUB Virtual Keyboard" and C231 its virtual mouse, made by G HUB's LGHUBDEVICE bus,
  // so Windows lists only their HID part, never a USB\ entry. A real G813 (also C232) is on USB and stays.
  const onUsb = new Set(arr(raw.usb).filter((u) => u.onUsb).map((u) => `${u.vid}:${u.pid}`));
  for (const u of arr(raw.usb)) {
    if (VIRTUAL.has(`${u.vid}:${u.pid}`) && !onUsb.has(`${u.vid}:${u.pid}`)) continue;
    const k = `${u.vid}:${u.pid}`, cur = byId.get(k);
    // usages (23 Oct 2026): what the device's HID collections say it is, from Windows' own hardware ids
    // (HID_DEVICE_UP:0001_U:0006 keyboard, _U:0002 mouse), across all its collections; nothing is opened
    // pages (24 Oct 2026): its vendor-defined HID collections as "FF00:0002" (page:usage), from the same hardware ids;
    // the device library knows a brand's protocol by them (device.json family; helpers/device-library.mjs match)
    const pg = arr(u.pages).map(String).filter((x) => /^FF[0-9A-F]{2}:[0-9A-F]{4}$/i.test(x)).map((x) => x.toUpperCase());
    if (!cur) byId.set(k, { id: k, vid: u.vid, pid: u.pid, name: u.name, runs: RUNS[k] || null, usages: { keyboard: !!u.kb, mouse: !!u.mouse }, pages: [...new Set(pg)] });
    else {
      cur.pages = [...new Set([...(cur.pages || []), ...pg])];
      if (GENERIC.test(cur.name || '') && u.name && !GENERIC.test(u.name)) cur.name = u.name;
      cur.usages.keyboard ||= !!u.kb; cur.usages.mouse ||= !!u.mouse;
    }
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
$hid = @($all | Where-Object { $_.Status -eq 'OK' -and $_.InstanceId -match '^HID\\\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}' })
# one batched read of every Bluetooth and active USB HID node's battery and every device's connection (one call each, not one per node)
$nodes = @($all | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE|BTHLEDEVICE)\\\\' -or ($_.Status -eq 'OK' -and $_.InstanceId -match '^HID\\\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}') } | ForEach-Object { $_.InstanceId })
$bats = @{}; if ($nodes.Count) { foreach ($p in @(Get-PnpDeviceProperty -InstanceId $nodes -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2')) { if ($null -ne $p.Data) { $bats[$p.InstanceId] = [int]$p.Data } } }
$conns = @{}; if ($top) { foreach ($p in @(Get-PnpDeviceProperty -InstanceId @($top | ForEach-Object { $_.InstanceId }) -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15')) { $conns[$p.InstanceId] = [bool]$p.Data } }
$seenUsb = @{}
$out = @(foreach ($d in $top) {
  $mac = ([regex]::Match($d.InstanceId, 'DEV_([0-9A-F]{12})')).Groups[1].Value
  $bat = $null
  foreach ($k in $bats.Keys) { if ($k -match $mac) { $bat = $bats[$k]; break } }
  [ordered]@{ name = $d.FriendlyName; le = [bool]($d.InstanceId -match '^BTHLE'); connected = [bool]$conns[$d.InstanceId]; battery = $bat }
}) + @(foreach ($h in $hid) {
  if ($null -ne $bats[$h.InstanceId] -and $h.FriendlyName) {
    $vp = ([regex]::Match($h.InstanceId, 'VID_[0-9A-F]{4}&PID_[0-9A-F]{4}')).Value
    if ($vp -and -not $seenUsb[$vp]) {
      $seenUsb[$vp] = $true
      [ordered]@{ name = $h.FriendlyName; le = $false; connected = $true; battery = $bats[$h.InstanceId] }
    }
  }
})
ConvertTo-Json -InputObject $out -Depth 3 -Compress
`;
// ~4 s of PowerShell (measured 26 Oct 2026; the helper reads it in ~0.3 s since 27 Oct): the last answer is kept (helpers/last-answer.js), read again in the
// background once it is a minute old, and kept on disk without the owner's name ("Shawn's AirPods" -> "AirPods");
// Look again asks with fresh and waits for a new read
// the list as the BT script prints it (or helpers/pc-reads.cs op bluetooth, the same JSON), parsed the same way for both:
// "Shawn's AirPods Pro #2 - Find My" without the Find My suffix, connected ones first, then by name
function shapeBluetooth(list) {
  return (Array.isArray(list) ? list : list ? [list] : []).map((d) => ({ ...d, name: String(d.name || '').replace(/\s+-\s+Find My$/i, '') }))
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
}
function readBluetoothPs() {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' + BT], { windowsHide: true, timeout: 60000 }, (err, out) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(out || '[]')); } catch (e) { reject(e); }
    }));
}
// through the native helper first (~0.3 s, no new process), PowerShell when it cannot answer
const readBluetooth = async () => shapeBluetooth(await require('./helper-reads').read('bluetooth', { ps: readBluetoothPs }));
// a device name without its owner's name in front ("Shawn's AirPods Pro" -> "AirPods Pro"), for the disk copy
const withoutOwner = (name) => String(name || '').replace(/^\S+['’]s\s+(?=\S)/, '');
const btAnswer = require('./last-answer').lastAnswer({ name: 'bluetooth', staleMs: 60000, read: readBluetooth,
  toDisk: (list) => list.map((d) => ({ name: withoutOwner(d.name), le: !!d.le, connected: !!d.connected, battery: d.battery ?? null })) });
function bluetooth(fresh = false) { return btAnswer.get(fresh); }

module.exports = { get, bluetooth, RUNS, VIRTUAL, _test: { shape, shapeBluetooth, withoutOwner, btAnswer, readPs, readBluetoothPs } };
