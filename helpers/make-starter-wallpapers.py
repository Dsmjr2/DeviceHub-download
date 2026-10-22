# The starter wallpapers (22 Oct 2026, Shawn: "include some cool ones to start"): six original pictures drawn here from
# math alone (gradients, sine curves, noise), nothing copied from anywhere, in DeviceHub's calm dark style. Each is
# 2560x1440, saved as JPEG (quality 88) in wallpapers-starter/. helpers/wallpapers.js copies them once into the person's
# wallpaper folder. Rebuild: python3 helpers/make-starter-wallpapers.py   (needs Pillow and numpy; a fixed seed per
# picture, so the same files come out each time)
import os
import numpy as np
from PIL import Image, ImageDraw

W, H = 2560, 1440
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'wallpapers-starter')
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
u, v = xx / W, yy / H   # 0..1 across and down


def hexc(s):
    return np.array([int(s[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255


def vgrad(stops):
    """a vertical gradient through (position, color) stops"""
    out = np.zeros((H, W, 3), np.float32)
    ps = [p for p, _ in stops]
    for c in range(3):
        col = np.interp(v[:, 0], ps, [hexc(s)[c] for _, s in stops])
        out[:, :, c] = col[:, None]
    return out


def noise(rng, scale, octaves=5, persistence=0.5):
    """smooth fractal noise, 0..1, from small random grids enlarged with bicubic smoothing"""
    total = np.zeros((H, W), np.float32)
    amp, norm, cells = 1.0, 0.0, scale
    for _ in range(octaves):
        gw, gh = max(2, int(W / cells)), max(2, int(H / cells))
        grid = Image.fromarray(rng.random((gh, gw)).astype(np.float32), 'F')
        total += amp * np.asarray(grid.resize((W, H), Image.BICUBIC), np.float32)
        norm += amp
        amp *= persistence
        cells /= 2
    total /= norm
    return (total - total.min()) / (total.max() - total.min())


def blend(img, color, alpha):
    a = np.clip(alpha, 0, 1)[..., None]
    return img * (1 - a) + hexc(color) * a


def add(img, color, amount):
    return img + hexc(color) * np.clip(amount, 0, None)[..., None]


def blur(a, sigma):
    """a Gaussian blur of a 2-D float array (two passes of shifted sums)"""
    r = int(sigma * 3)
    k = np.exp(-(np.arange(-r, r + 1) ** 2) / (2 * sigma * sigma)).astype(np.float32)
    k /= k.sum()
    for axis in (0, 1):
        p = np.pad(a, [(r, r) if i == axis else (0, 0) for i in range(2)], mode='edge')
        n = a.shape[axis]
        a = sum(w * (p[i:i + n] if axis == 0 else p[:, i:i + n]) for i, w in enumerate(k))
    return a


def stars(rng, img, count, max_bright=1.0, region=None):
    """small soft stars, a few with a glow"""
    layer = np.zeros((H, W), np.float32)
    xs, ys = rng.integers(0, W, count), rng.integers(0, H, count)
    b = rng.random(count) ** 3 * max_bright
    for x, y, br in zip(xs, ys, b):
        if region is not None and not region(x, y):
            continue
        layer[y, x] += br
    glow = blur(layer, 1.2) * 5
    big = blur(layer * (layer > 0.55), 5) * 18
    return img + (layer * 0.9 + glow + big)[..., None] * np.array([0.92, 0.95, 1.0], np.float32)


def save(img, name, rng):
    # a little noise before rounding to 8 bits, so the smooth gradients show no bands
    img = np.clip(img, 0, 1) * 255 + rng.normal(0, 0.9, (H, W, 1)).astype(np.float32)
    Image.fromarray(np.clip(img + 0.5, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(OUT, name), 'JPEG', quality=88, optimize=True, progressive=True, subsampling=2)


def ridge(rng, base, amp, waves, phase=None):
    """a smooth ridge line across the width: base height plus a few sine waves, in 0..1 down the picture"""
    x = np.linspace(0, 1, W, dtype=np.float32)
    y = np.full(W, base, np.float32)
    for i, (f, a) in enumerate(waves):
        p = rng.random() * 6.283 if phase is None else phase[i]
        y += amp * a * np.sin(x * f * 6.283 + p)
    return y


# ---- 1. Aurora: curtains of green and violet light over dark hills ----
def aurora():
    rng = np.random.default_rng(11)
    img = vgrad([(0, '#03040b'), (0.55, '#06101c'), (0.85, '#0a1a24'), (1, '#05080d')])
    img = stars(rng, img, 1800, 0.8)
    # rays: thin vertical streaks whose strength drifts slowly with height, so no two look alike
    def rays(seed):
        g = np.random.default_rng(seed).random((5, W // 9)).astype(np.float32)
        r = np.asarray(Image.fromarray(g, 'F').resize((W, H), Image.BICUBIC), np.float32)
        return np.clip(r, 0, 1) ** 1.6
    for base, amp, color, color2, height, strength, seed in [
        (0.46, 0.10, '#32e6a4', '#8a5cff', 0.34, 0.50, 1),
        (0.56, 0.07, '#3fd8c8', '#c060ff', 0.24, 0.38, 2),
    ]:
        y = ridge(rng, base, amp, [(0.5, 1), (1.4, 0.45), (3.3, 0.15)])[None, :]
        d = v - y   # below 0: above the curtain's lower edge
        light = np.where(d < 0, np.exp(d / height), np.exp(-(d / 0.012) ** 2)) * (0.25 + 0.75 * rays(seed))
        light *= 0.6 + 0.4 * np.exp(-((u - 0.5 - (base - 0.5)) / 0.5) ** 2)
        mix = np.clip(-d / height, 0, 1) ** 0.8          # green at the lower edge, violet higher up
        col = hexc(color) * (1 - mix[..., None]) + hexc(color2) * mix[..., None]
        img = img + col * (light * strength)[..., None]
    img = add(img, '#1c6a5a', 0.10 * np.exp(-((v - 0.8) / 0.08) ** 2))
    for base, amp, color in [(0.80, 0.03, '#071018'), (0.88, 0.035, '#03070b')]:
        hy = ridge(rng, base, amp, [(1.1, 1), (2.9, 0.4), (7, 0.12)])[None, :]
        img = np.where((v > hy)[..., None], hexc(color) + (v - hy)[..., None] * -0.02, img)
    save(img, 'Aurora.jpg', rng)


# ---- 2. Deep ocean: layered waves from a pale horizon down into dark blue ----
def ocean():
    rng = np.random.default_rng(22)
    img = vgrad([(0, '#0a1626'), (0.30, '#17405a'), (0.40, '#2c6a7c'), (1, '#020a14')])
    img = add(img, '#7fc9d0', 0.22 * np.exp(-((v - 0.38) / 0.05) ** 2) * np.exp(-((u - 0.62) / 0.35) ** 2))
    layers = 9
    for i in range(layers):
        t = i / (layers - 1)
        base = 0.40 + 0.62 * t ** 1.25
        y = ridge(rng, base, 0.012 + 0.03 * t, [(1.3 + rng.random(), 1), (3.1 + rng.random() * 2, 0.45), (8, 0.12)])[None, :]
        top = hexc('#1d5a70') * (1 - t) + hexc('#04182a') * t
        deep = hexc('#08263a') * (1 - t) + hexc('#010812') * t
        depth = np.clip((v - y) / 0.16, 0, 1)
        col = top * (1 - depth[..., None]) + deep * depth[..., None]
        crest = np.exp(-((v - y) / 0.0035) ** 2) * (0.35 - 0.25 * t)   # a thin light line on each crest
        img = np.where((v > y)[..., None], col, img)
        img = add(img, '#9fe3e6', crest * (v > y - 0.01))
    save(img, 'Deep ocean.jpg', rng)


# ---- 3. Dunes at dusk: a warm sky, a low sun and soft sand ridges in light and shadow ----
def dunes():
    rng = np.random.default_rng(33)
    img = vgrad([(0, '#1b1530'), (0.30, '#4a2a48'), (0.50, '#b4605a'), (0.58, '#e6a070'), (0.62, '#f0c08a'), (1, '#2a1620')])
    sx, sy = 0.68, 0.55
    r = np.sqrt(((u - sx) * W / H) ** 2 + (v - sy) ** 2)
    img = add(img, '#ffd9a0', 0.55 * np.exp(-(r / 0.045) ** 2) + 0.22 * np.exp(-(r / 0.25) ** 2))
    for i, (base, amp, lit, shade) in enumerate([
        (0.585, 0.02, '#b8684c', '#6a3438'), (0.64, 0.035, '#a4553f', '#52262f'),
        (0.72, 0.045, '#8a4336', '#3c1b27'), (0.82, 0.055, '#6a302c', '#28111b'), (0.93, 0.05, '#45202a', '#150a10')]):
        y = ridge(rng, base, amp, [(0.6 + rng.random() * 0.8, 1), (1.9 + rng.random(), 0.35), (4.5, 0.06)])[None, :]
        # the sunny face is a band under the crest whose depth swells and narrows; below it the sand is in shadow
        face = 0.015 + 0.05 * (0.5 + 0.5 * np.sin(u[0:1] * (2.2 + i * 0.7) * 6.283 + rng.random() * 6.283)) * (1 + i * 0.4)
        t = np.clip((v - y - face) / 0.018 + 0.5, 0, 1)
        t = t * t * (3 - 2 * t)
        col = hexc(lit) * (1 - t[..., None]) + hexc(shade) * t[..., None]
        col = col * (1 - 0.25 * np.clip((v - y) / 0.2, 0, 1))[..., None]
        sunward = np.exp(-((u - sx) / 0.35) ** 2)
        rim = np.exp(-((v - y) / 0.0025) ** 2) * (0.18 + 0.3 * sunward) * (1 - i * 0.15)
        img = np.where((v > y)[..., None], col, img)
        img = add(img, '#ffc890', rim * (v > y - 0.006))
    save(img, 'Dunes at dusk.jpg', rng)


# ---- 4. Low-poly mountains: faceted ridges fading into a cool haze ----
def mountains():
    rng = np.random.default_rng(44)
    sky = vgrad([(0, '#0b1020'), (0.5, '#25304a'), (0.7, '#4a5670'), (1, '#1a2030')])
    r = np.sqrt(((u - 0.24) * W / H) ** 2 + (v - 0.2) ** 2)
    sky = add(sky, '#e8ecf8', 0.12 * np.exp(-(r / 0.16) ** 2))
    sky = np.where((r < 0.035)[..., None], hexc('#e4e9f6'), sky)
    sky = stars(rng, sky, 900, 0.5, lambda x, y: y < H * 0.45)
    pic = Image.fromarray((np.clip(sky, 0, 1) * 255).astype(np.uint8), 'RGB')
    d = ImageDraw.Draw(pic)
    ranges = [(0.46, 0.22, (92, 106, 138)), (0.58, 0.20, (64, 76, 104)), (0.71, 0.18, (40, 49, 72)), (0.84, 0.14, (22, 28, 43))]
    for k, (base, height, color) in enumerate(ranges):
        shade = lambda f: tuple(int(max(0, min(255, c * f))) for c in color)
        n = 6 + k * 2
        px = np.linspace(-W * 0.05, W * 1.05, n) + rng.uniform(-60, 60, n)
        py = H * base - H * height * (0.45 + 0.55 * rng.random(n))
        # a valley between each two peaks, and a point under each peak where its two faces meet
        qx = (px[:-1] + px[1:]) / 2 + rng.uniform(-50, 50, n - 1)
        qy = np.maximum(py[:-1], py[1:]) + H * height * rng.uniform(0.15, 0.4, n - 1)
        bx = px + rng.uniform(-30, 30, n)
        by = py + H * height * rng.uniform(0.55, 0.85, n)
        d.polygon([(px[0], py[0])] + [pt for i in range(n - 1) for pt in ((qx[i], qy[i]), (px[i + 1], py[i + 1]))] + [(W + 99, H + 9), (-99, H + 9)], fill=shade(0.78))
        for i in range(n):
            if i > 0:
                d.polygon([(qx[i - 1], qy[i - 1]), (px[i], py[i]), (bx[i], by[i])], fill=shade(1.18 + rng.uniform(-0.05, 0.05)))   # facing the moon
                d.polygon([(qx[i - 1], qy[i - 1]), (bx[i - 1], by[i - 1]), (bx[i], by[i])], fill=shade(0.9 + rng.uniform(-0.04, 0.04)))
            if i < n - 1:
                d.polygon([(px[i], py[i]), (qx[i], qy[i]), (bx[i], by[i])], fill=shade(0.92 + rng.uniform(-0.05, 0.05)))   # the far face
            if 0 < i:
                d.polygon([(bx[i - 1], by[i - 1]), (bx[i], by[i]), (bx[i], H + 9), (bx[i - 1], H + 9)], fill=shade(0.74))
    img = np.asarray(pic, np.float32) / 255
    # haze settles at the foot of each range
    for k, (base, _, _) in enumerate(ranges[:-1]):
        img = blend(img, '#7080a4', 0.16 * np.exp(-((v - base - 0.06) / 0.05) ** 2))
    save(img, 'Low-poly peaks.jpg', rng)


# ---- 5. Contours: a dark topographic map with fine height lines ----
def contours():
    rng = np.random.default_rng(55)
    f = noise(rng, 900, 5, 0.45)
    f = f * 0.85 + noise(rng, 2400, 2) * 0.15
    img = vgrad([(0, '#0d141a'), (1, '#080b10')])
    img = blend(img, '#1d4650', f ** 1.4 * 0.8)
    # a soft light from the upper right, so the map has depth
    img = add(img, '#2a6a70', 0.10 * np.exp(-(((u - 0.78) * 1.6) ** 2 + ((v - 0.22) * 1.2) ** 2) / 0.12))
    levels = f * 30
    frac = np.abs(levels - np.round(levels))
    grad = np.hypot(*np.gradient(levels))       # keep lines about the same width where the ground is steep
    major = (np.round(levels) % 5 == 0)
    line = np.clip(1 - frac / (grad * np.where(major, 2.2, 1.5) + 1e-4), 0, 1)
    tone = hexc('#4fb8a8') * (1 - u[..., None]) + hexc('#6aa8e0') * u[..., None]   # teal to blue across
    img = img + tone * (line * np.where(major, 0.7, 0.32) * (0.5 + 0.5 * f))[..., None]
    img = img * (1 - 0.45 * (((u - 0.5) ** 2 + (v - 0.5) ** 2) * 2)[..., None])   # darker toward the corners
    save(img, 'Contours.jpg', rng)


# ---- 6. Nebula: a starfield with a faint violet and teal cloud ----
def nebula():
    rng = np.random.default_rng(66)
    img = vgrad([(0, '#030308'), (1, '#05050c')])
    n1, n2 = noise(rng, 700, 6, 0.55), noise(rng, 500, 6, 0.55)
    band = np.exp(-((v - 0.5 - (u - 0.5) * 0.55) / 0.3) ** 2)   # a diagonal band across the middle
    cloud = np.clip((n1 - 0.30) * 1.8, 0, 1) ** 1.5 * band
    img = add(img, '#6a2ea0', cloud * 0.6)
    img = add(img, '#1f8a9a', np.clip((n2 - 0.45) * 2.4, 0, 1) ** 1.8 * band * 0.45)
    img = add(img, '#e0a0d0', np.clip((n1 - 0.62) * 3, 0, 1) ** 2 * band * 0.35)
    dust = np.clip((noise(rng, 220, 4) - 0.5) * 3, 0, 1)                       # dark lanes through the cloud
    img = img * (1 - 0.55 * dust * band)[..., None]
    img = stars(rng, img, 3000, 1.0)
    save(img, 'Nebula.jpg', rng)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for make in (aurora, ocean, dunes, mountains, contours, nebula):
        make()
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
