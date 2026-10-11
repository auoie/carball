#!/usr/bin/env python3
"""The local game textures, downsampled, for the client's shipped-data guard (client/src/render/shippedData.test.ts,
RV-157: no module may carry a downsampled texture). Every texture under out/bsim/assets_local (the arena's, its
surroundings', the cage's, the cars'), as PNG or as a cached 8-bit array (.npy, there and in the static session's
texture caches: the logos, the city's, the lightmaps, LMP's lm_* and LMP3's TireMarks: RV-182, RV-212), is box-downsampled to 8, 12, 16, 24, 32, 48 and 64 px a
side (RV-183); each level's rows and columns,
per channel, are written as streams (NaN between them) of their raw 8-bit values / 255 and of their sRGB-decoded
values. Little-endian float32 to out/arena_local/reference/textures.f32 (git-ignored: it is the textures' data); the
test fails without it where the game's meshes are. Reads local data and contains none.

Usage: .venv/bin/python scripts/reference_textures.py
"""
import glob
import json
import os

import numpy as np
from PIL import Image

SOURCES = ["out/bsim/assets_local/arena/textures", "out/bsim/assets_local/arena/sur1_textures", "out/bsim/assets_local/cage",
           "out/bsim/assets_local/cars"]
# (the static session's cached textures, 8-bit RGBA arrays)
CACHES = ["out/bsim/agents/SUR1/mat_lights/texcache", "out/bsim/agents/CAL1/texcache", "out/bsim/agents/LMP",
          "out/bsim/agents/LMP3"]
OUT = "out/arena_local/reference"
SIZES = (8, 12, 16, 24, 32, 48, 64)


def decode(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def box(img, size):
    """The image box-averaged to size x size (a whole number of source pixels a cell, or resampled area-wise)"""
    h, w = img.shape[:2]
    if h % size == 0 and w % size == 0:
        return img.reshape(size, h // size, size, w // size, -1).mean(axis=(1, 3))
    return np.asarray(Image.fromarray((img * 255).round().astype(np.uint8)).resize((size, size), Image.BOX), dtype=np.float64) / 255


def images():
    """Every texture: the PNGs, and the cached arrays (2D, 3 or 4 channels of bytes; a cache of the same name as a PNG
    is the same texture, read once)"""
    seen = set()
    for root in SOURCES:
        for path in sorted(glob.glob(f"{root}/**/*.png", recursive=True)):
            seen.add(os.path.splitext(os.path.basename(path))[0])
            yield np.asarray(Image.open(path).convert("RGBA"), dtype=np.float64) / 255
    for root in SOURCES + CACHES:
        for path in sorted(glob.glob(f"{root}/**/*.npy", recursive=True)):
            name = os.path.splitext(os.path.basename(path))[0]
            if name in seen:
                continue
            a = np.load(path)
            if a.dtype != np.uint8 or a.ndim != 3 or a.shape[2] not in (3, 4):
                continue  # (not a texture: the cage's nodes)
            seen.add(name)
            if a.shape[2] == 3:
                a = np.concatenate([a, np.full(a.shape[:2] + (1,), 255, np.uint8)], axis=2)
            yield a.astype(np.float64) / 255


def bends(w, by):
    return any(abs(w[j - 2] - 2 * w[j - 1] + w[j]) >= by for j in range(2, len(w)))


def spread(w):
    """No value more than 40 % of the window"""
    _, counts = np.unique(np.asarray(w), return_counts=True)
    return counts.max() <= int(0.4 * len(w))


def turns(w):
    steps = [d for d in np.diff(w) if d != 0]
    return any(np.sign(a) != np.sign(b) for a, b in zip(steps, steps[1:]))


def lines(img, size):
    """A texture's rows and columns at a size, per channel, stored (not decoded)"""
    small = box(img, size).astype(np.float32).astype(np.float64)
    for c in range(small.shape[2]):
        plane = small[..., c]
        if plane.max() - plane.min() < 1e-3:
            continue
        yield from list(plane) + list(plane.T)


def logo_row(img):
    """A row of the logo at 16 px to write in every form (RV-182), and where in it a window of 12 starts: the window off
    black and white; its first 8 bending, as levels and as percent spread and turning; all 12 as 4-bit levels too"""
    for row in lines(img, 16):
        for start in range(len(row) - 11):
            w = row[start:start + 12]
            lv, pc, nb = np.round(w * 255), np.round(w * 100), np.round(w * 15)
            if not (np.all(lv >= 3) and np.all(lv <= 252)):
                continue
            a = w[:8]
            ok = bends(a, 0.03) and np.ptp(a) >= 0.3 and spread(lv[:8]) and spread(pc[:8]) and turns(a)
            ok = ok and np.ptp(w) >= 0.25 and spread(nb) and turns(nb) and np.sum((nb >= 1) & (nb <= 14)) >= 3
            ok = ok and np.abs(nb / 15 - w).max() < 0.03
            if ok:
                return list(row) + [start]
    return None


def mask_row(img):
    """A row of the logo's alpha at 16 px touching black or white with four levels or more between (RV-183)"""
    for w in lines(img[..., 3:4].repeat(4, axis=2) * [1, 1, 1, 1], 16):
        lv = np.round(w[:8] * 255)
        edge = np.sum((lv < 2) | (lv > 253))
        if edge >= 1 and np.sum((lv >= 2) & (lv <= 253)) >= 4 and spread(lv) and turns(w[:8]) and bends(w[:8], 0.03) and np.ptp(w[:8]) >= 0.2:
            return w
    return None


def row_at(img, size, low=False):
    """A row at a size off black and white: bending (or, low, a low-contrast one: under 0.1 across, bending gently, its
    4-decimal rounding clear of the tolerance)"""
    if min(img.shape[:2]) < size:
        return None
    for w in lines(img, size):
        a = w[:8]
        if not (np.all(a > 0.01) and np.all(a < 0.99)):
            continue
        if low:
            if np.ptp(a) < 0.1 and bends(a, 0.004) and not bends(a, 0.02) and turns(a) and spread(np.round(a, 4)) \
                    and np.abs(np.round(a, 4) - a).max() < 4e-5:
                return w
        elif bends(a, 0.03) and np.ptp(a) >= 0.15 and spread(np.round(a * 255)) and turns(a):
            return w
    return None


def tie_row(img):
    """A row of exact box means with .5 levels (an even cell's means) off black and white, bending as row_at's: written
    rounded half up, each such level is 0.5/255 off, past it by a float's step where the stored value lies below the tie
    (the tie factor's control: RV-228)"""
    for size in (64, 32, 16):
        h, w = img.shape[:2]
        if h % size or w % size or min(h, w) < size:
            continue
        for row in lines(img, size):
            a = row[:8]
            if not (np.all(a > 0.01) and np.all(a < 0.99)):
                continue
            m = a * 255
            tie = np.abs(m - np.floor(m) - 0.5) < 1e-4
            below = tie & (m < np.floor(m) + 0.5)
            if tie.sum() >= 3 and below.any() and bends(a, 0.03) and np.ptp(a) >= 0.15 \
                    and spread(np.floor(m + 0.5 + 1e-4)) and turns(a):
                return row
    return None


def controls():
    """The guard's named controls (local, as the reference): rows of the logo, its alpha, a lightmap, a 12 px row, a
    low-contrast one, one of .5 box means"""
    logo = np.load(f"{CACHES[0]}/GFX_Shared_Logos.Logo_RocketLeague.npy").astype(np.float64) / 255
    picks = {"logo": logo_row(logo), "mask": mask_row(logo)}
    # (a lightmap's (LMP: RV-212))
    lightmap = np.load(f"{CACHES[2]}/lm_DirectionalMaxComponent0_6.npy").astype(np.float64) / 255
    picks["lightmap"] = row_at(lightmap, 16)
    for img in images():
        if picks.get("twelve") is None:
            picks["twelve"] = row_at(img, 12)
        if picks.get("low") is None:
            picks["low"] = row_at(img, 32, low=True)
        if picks.get("ties") is None:
            picks["ties"] = tie_row(img)
    # (the logo's: its row of 16, then the window's start)
    out = {k: None if v is None else [float(x) for x in v] for k, v in picks.items()}
    with open(f"{OUT}/texture_controls.json", "w") as f:
        json.dump(out, f)
    print(f"{OUT}/texture_controls.json: " + ", ".join(f"{k} {'ok' if v else 'none'}" for k, v in out.items()))


def main():
    os.makedirs(OUT, exist_ok=True)
    streams = []
    count = 0
    for img in images():
        count += 1
        for size in SIZES:
            if min(img.shape[:2]) < size:
                continue
            small = box(img, size)
            for form in (small, decode(small)):
                for c in range(form.shape[2]):
                    plane = form[..., c]
                    if plane.max() - plane.min() < 1e-3:
                        continue  # (a constant channel carries no picture)
                    for line in list(plane) + list(plane.T):
                        streams.append(np.append(line, np.nan))
    data = np.concatenate(streams).astype("<f4") if streams else np.zeros(0, "<f4")
    data.tofile(f"{OUT}/textures.f32")
    print(f"{OUT}/textures.f32: {count} textures, {len(streams)} rows and columns, {data.size} values")
    controls()


if __name__ == "__main__":
    main()
