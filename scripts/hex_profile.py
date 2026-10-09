"""Channel profiles of a hex-pattern texture by hex radius, for client/src/render/gameSurfaces.ts.

The game's hex textures (TiledPatterns.Hexagons_Pack, CS_FX Hexagons_Pack_01_T, FutureTech ForcefieldHex) share one
layout: flat-top cells, 2 columns per tile (column pitch 1/2 tile, edge 1/3 tile, rows 1/2 tile apart across the flats,
odd columns half a row down, the grid offset (0, 0.25) tiles). This fits each texel to its nearest cell and prints the
mean of each channel over 32 steps of hex radius (0 at the centre, 1 at the edge): 16 over r 0-0.8, 16 over 0.8-1.
Values only: the textures are local (out/bsim/...) and never committed.

Usage: .venv/bin/python scripts/hex_profile.py TEXTURE.png TILES_ACROSS CHANNELS [--srgb]
  TILES_ACROSS: tiles of the layout above in the texture's width (1 for the Hexagons packs, 8 for ForcefieldHex)
  CHANNELS: e.g. RG
  --srgb: the texture is sRGB (the GPU decodes it before the shader reads it: arena/textures/stats.json): decode first
"""

import sys

import numpy as np
from PIL import Image


def hex_radius(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    edge = 1 / 3
    sv = (np.sqrt(3) * edge) / 0.5
    vv = (v - 0.25) * sv
    col = np.round(u / 0.5)
    best = None
    for dc in (-1, 0, 1):
        c = col + dc
        ro = np.where(c % 2 == 0, 0.0, 0.25 * sv)
        row = np.round((vv - ro) / (0.5 * sv))
        dx = np.abs(u - c * 0.5)
        dy = np.abs(vv - (row * 0.5 * sv + ro))
        r = np.maximum(dy / (np.sqrt(3) / 2 * edge), (dx + dy / np.sqrt(3)) / edge)
        best = r if best is None else np.minimum(best, r)
    return best


def main() -> None:
    path, tiles, channels = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    image = np.asarray(Image.open(path).convert("RGBA")).astype(float) / 255
    if "--srgb" in sys.argv[4:]:
        rgb = image[..., :3]
        image[..., :3] = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    h, w, _ = image.shape
    v, u = np.mgrid[0:h, 0:w]
    r = hex_radius((u + 0.5) / w * tiles, (v + 0.5) / h * tiles)
    steps = list(np.linspace(0, 0.8, 17)[:-1]) + list(np.linspace(0.8, 1.0, 17))
    for name in channels:
        k = "RGBA".index(name)
        means = []
        for a, b in zip(steps[:-1], steps[1:]):
            inside = (r >= a) & (r < b)
            means.append(round(float(image[..., k][inside].mean()), 3) if inside.sum() > 20 else None)
        print(name, means)


if __name__ == "__main__":
    main()
