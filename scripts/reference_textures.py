#!/usr/bin/env python3
"""The local game textures, downsampled, for the client's shipped-data guard (client/src/render/shippedData.test.ts,
RV-157: no module may carry a downsampled texture). Every texture under out/bsim/assets_local (the arena's, its
surroundings', the cage's, the cars') is box-downsampled to 8, 16, 32 and 64 px a side; each level's rows and columns,
per channel, are written as streams (NaN between them) of their raw 8-bit values / 255 and of their sRGB-decoded
values. Little-endian float32 to out/arena_local/reference/textures.f32 (git-ignored: it is the textures' data); the
test fails without it where the game's meshes are. Reads local data and contains none.

Usage: .venv/bin/python scripts/reference_textures.py
"""
import glob
import os

import numpy as np
from PIL import Image

SOURCES = ["out/bsim/assets_local/arena/textures", "out/bsim/assets_local/arena/sur1_textures", "out/bsim/assets_local/cage",
           "out/bsim/assets_local/cars"]
OUT = "out/arena_local/reference"
SIZES = (8, 16, 32, 64)


def decode(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def box(img, size):
    """The image box-averaged to size x size (a whole number of source pixels a cell, or resampled area-wise)"""
    h, w = img.shape[:2]
    if h % size == 0 and w % size == 0:
        return img.reshape(size, h // size, size, w // size, -1).mean(axis=(1, 3))
    return np.asarray(Image.fromarray((img * 255).round().astype(np.uint8)).resize((size, size), Image.BOX), dtype=np.float64) / 255


def main():
    os.makedirs(OUT, exist_ok=True)
    streams = []
    count = 0
    for root in SOURCES:
        for path in sorted(glob.glob(f"{root}/**/*.png", recursive=True)):
            img = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float64) / 255
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


if __name__ == "__main__":
    main()
