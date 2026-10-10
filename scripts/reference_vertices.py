#!/usr/bin/env python3
"""The game-derived reference the client's shipped-data guard compares against (client/src/render/shippedData.test.ts,
RV-114, RV-131), from the local exports: every surroundings mesh's vertices (out/bsim/agents/SUR1/meshcache: as stored,
and placed where an instance has no rotation) and UVs, and the surroundings' (r, z) statistics (outline_az.json's
per-azimuth percentiles, every pair of them; the visible profiles' points). Written as little-endian float32 to
out/arena_local/reference/ (git-ignored, like the game's meshes: it is their data); the test skips without it. Reads
local data and contains none.

Usage: .venv/bin/python scripts/reference_vertices.py
"""
import glob
import json
import os

import numpy as np

SUR = "out/bsim/agents/SUR1"
OUT = "out/arena_local/reference"


def main():
    os.makedirs(OUT, exist_ok=True)
    geometry = json.load(open(f"{SUR}/surroundings_geometry.json"))
    instances = geometry["instances"]
    positions, uvs = [], []
    for path in sorted(glob.glob(f"{SUR}/meshcache/*.npz")):
        name = os.path.basename(path)[:-4].removeprefix("startup_")
        # (the static session's own cache: its section table is a pickled object array)
        mesh = np.load(path, allow_pickle=True)
        pos = mesh["pos"]
        positions.append(pos)
        uv = mesh["uv"]
        uvs.append(uv.reshape(-1, 2))
        for key, inst in instances.items():
            if key.split("#")[0] != name or inst.get("rotation"):
                continue
            scale = np.array(inst.get("scale") or [1, 1, 1], dtype=float)
            translation = np.array(inst.get("translation") or [0, 0, 0], dtype=float)
            positions.append(pos * scale + translation)
    np.abs(np.concatenate(positions)).astype("<f4").tofile(f"{OUT}/vertices.f32")
    np.concatenate(uvs).astype("<f4").tofile(f"{OUT}/uvs.f32")
    pairs = []
    for rows in json.load(open(f"{SUR}/outline_az.json")).values():
        for row in rows:
            values = list(row["r"]) + list(row["z"])
            pairs += [(a, b) for a in values for b in values if a != b]
    for sections in geometry["visible_profile_from_capture"].values():
        for section in sections:
            pairs += [tuple(p) for p in section["rz"]]
    np.abs(np.array(pairs, dtype=float)).astype("<f4").tofile(f"{OUT}/rz.f32")
    print(f"{OUT}: {sum(len(p) for p in positions)} vertices, {sum(len(u) for u in uvs)} uvs, {len(pairs)} (r, z) pairs")


if __name__ == "__main__":
    main()
