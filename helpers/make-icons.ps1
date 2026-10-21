# Draws DeviceHub's logo (19 Oct 2026, Shawn picked "Port" from the second round of options): a silver rounded port, like
# a USB-C socket, on a graphite rounded tile, with one contact per device in its color (mouse blue, headset red,
# keyboard green). Replaced the D monogram ("it looks like Discovery Channel"). Writes
# public\icon.svg, public\icon-<size>.png and DeviceHub.ico (16-256, for the tray, the shortcuts and the taskbar).
# Plain Windows drawing (GDI+).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$C = @{ tileTop = '#2a2c33'; tileBottom = '#15161b'; silverTop = '#f4f5f8'; silverBottom = '#b9bdc6'; mouse = '#4f7cc0'; headset = '#cf5348'; keyboard = '#57a869'; port = '#202228' }

# SVG (any size); the same drawing on a 128 grid
$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="$($C.tileTop)"/><stop offset="1" stop-color="$($C.tileBottom)"/></linearGradient>
    <linearGradient id="s" gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="88"><stop offset="0" stop-color="$($C.silverTop)"/><stop offset="1" stop-color="$($C.silverBottom)"/></linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#t)"/>
  <rect x=".75" y=".75" width="126.5" height="126.5" rx="27.3" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>
  <rect x="20" y="44" width="88" height="40" rx="20" fill="$($C.port)" stroke="url(#s)" stroke-width="7"/>
  <rect x="38" y="57" width="14" height="14" rx="7" fill="$($C.mouse)"/>
  <rect x="57" y="57" width="14" height="14" rx="7" fill="$($C.headset)"/>
  <rect x="76" y="57" width="14" height="14" rx="7" fill="$($C.keyboard)"/>
</svg>
"@
Set-Content (Join-Path $root 'public\icon.svg') $svg -Encoding ascii

function Col($hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }
function Pt($x, $y, $k) { [System.Drawing.PointF]::new($x * $k, $y * $k) }

function Draw($size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)
  $k = $size / 128.0
  # rounded tile with a top-to-bottom graphite gradient and a faint rim
  $r = 28 * $k; $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $p.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
  $p.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90); $p.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90); $p.CloseFigure()
  $tb = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.PointF]::new(0, 0)), ([System.Drawing.PointF]::new(0, $size)), (Col $C.tileTop), (Col $C.tileBottom)
  $g.FillPath($tb, $p)
  if ($size -ge 32) { $rim = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(36, 255, 255, 255)), ([Math]::Max(1, 1.5 * $k)); $g.DrawPath($rim, $p) }
  # small sizes draw the port a little bolder so it still reads at 16 px
  $bold = $(if ($size -le 16) { 1.35 } elseif ($size -le 32) { 1.15 } else { 1 })
  function Pill($x, $y, $w, $h) {
    $q = New-Object System.Drawing.Drawing2D.GraphicsPath; $rr = [Math]::Min($w, $h) * $k
    $q.AddArc($x * $k, $y * $k, $rr, $rr, 90, 180); $q.AddArc(($x + $w) * $k - $rr, $y * $k, $rr, $rr, 270, 180); $q.CloseFigure(); $q
  }
  # the port: a dark rounded slot with a silver rim
  $port = Pill 20 44 88 40
  $g.FillPath((New-Object System.Drawing.SolidBrush (Col $C.port)), $port)
  $sb = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.PointF]::new(0, 40 * $k)), ([System.Drawing.PointF]::new(0, 88 * $k)), (Col $C.silverTop), (Col $C.silverBottom)
  $pen = New-Object System.Drawing.Pen $sb, (7 * $k * $bold)
  $g.DrawPath($pen, $port)
  # one contact per device, in its color (a touch larger at the small sizes)
  $cs = 14 * $(if ($size -le 16) { 1.15 } else { 1 }); $off = (14 - $cs) / 2
  foreach ($c in @(@($C.mouse, 38), @($C.headset, 57), @($C.keyboard, 76))) {
    $g.FillEllipse((New-Object System.Drawing.SolidBrush (Col $c[0])), ($c[1] + $off) * $k, (57 + $off) * $k, $cs * $k, $cs * $k)
  }
  $g.Dispose()
  return $bmp
}

foreach ($n in 16, 32, 48, 64, 128, 192, 256, 512) { $b = Draw $n; $b.Save((Join-Path $root "public\icon-$n.png"), [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose() }

# .ico with PNG entries 16-256
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($n in $sizes) { $b = Draw $n; $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); , $ms.ToArray() }
$out = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $n = $sizes[$i]; $w.Write([byte]($n % 256)); $w.Write([byte]($n % 256)); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset); $offset += $pngs[$i].Length
}
foreach ($d in $pngs) { $w.Write($d) }
[System.IO.File]::WriteAllBytes((Join-Path $root 'DeviceHub.ico'), $out.ToArray())
'icons written'
