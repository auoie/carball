#!/usr/bin/env python3
"""The game-derived reference the client's shipped-data guard compares against (client/src/render/shippedData.test.ts,
RV-114, RV-131), from the local exports: every surroundings mesh's vertices (out/bsim/agents/SUR1/meshcache: as stored,
and placed where an instance has no rotation) and UVs, each mesh's place among them (index.json, for the guard's
controls), and the surroundings' statistics: (r, z) pairs (outline_az.json's per-azimuth percentiles, every pair of them;
the visible profiles' points; the crowd tiers' sections' first and last rows, as (r, z) each: a tier's two are a named
measure, its sections' a table), (az, value) pairs
(each per-azimuth row's azimuth with each of its values) and the per-azimuth columns (each piece's percentile down its
rows, NaN between columns: RV-138). Written as little-endian float32 to out/arena_local/reference/ (git-ignored, like the
game's meshes: it is their data); the test fails without it where the game's meshes are. Reads local data and contains
none.

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
    positions, uvs, index = [], [], {}
    vertex_count = uv_count = 0
    for path in sorted(glob.glob(f"{SUR}/meshcache/*.npz")):
        name = os.path.basename(path)[:-4].removeprefix("startup_")
        # (the static session's own cache: its section table is a pickled object array)
        mesh = np.load(path, allow_pickle=True)
        pos = mesh["pos"]
        positions.append(pos)
        # (each UV channel's whole, then the next: its rows consecutive as the mesh stores them)
        uv = mesh["uv"]
        uv = (uv.transpose(1, 0, 2) if uv.ndim == 3 else uv).reshape(-1, 2)
        uvs.append(uv)
        index[name] = {"vertices": [vertex_count, len(pos)], "uvs": [uv_count, len(uv)]}
        uv_count += len(uv)
        vertex_count += len(pos)
        for key, inst in instances.items():
            if key.split("#")[0] != name or inst.get("rotation"):
                continue
            scale = np.array(inst.get("scale") or [1, 1, 1], dtype=float)
            translation = np.array(inst.get("translation") or [0, 0, 0], dtype=float)
            positions.append(pos * scale + translation)
            vertex_count += len(pos)
    np.abs(np.concatenate(positions)).astype("<f4").tofile(f"{OUT}/vertices.f32")
    np.concatenate(uvs).astype("<f4").tofile(f"{OUT}/uvs.f32")
    json.dump(index, open(f"{OUT}/index.json", "w"), indent=1)
    pairs, az_values, columns = [], [], []
    outline = json.load(open(f"{SUR}/outline_az.json"))
    for rows in outline.values():
        rows = sorted(rows, key=lambda row: row["az"])
        for row in rows:
            values = list(row["r"]) + list(row["z"])
            pairs += [(a, b) for a in values for b in values if a != b]
            az_values += [(row["az"], v) for v in values]
        for k in range(len(rows[0]["r"]) + len(rows[0]["z"])):
            columns += [(list(row["r"]) + list(row["z"]))[k] for row in rows] + [float("nan")]
    profiles = list(geometry["visible_profile_from_capture"].values())
    if os.path.exists(f"{SUR}/visprofile.json"):
        profiles += list(json.load(open(f"{SUR}/visprofile.json")).values())
    for sections in profiles:
        for section in sections:
            pairs += [tuple(p) for p in section["rz"]]
    keys = ["r_first_row", "z_first_row", "r_last_row", "z_last_row"]
    for tier in geometry["crowd_tiers"].values():
        for section in tier["sections"]:
            pairs += [(section["r_first_row"], section["z_first_row"]), (section["r_last_row"], section["z_last_row"])]
        for k in keys:
            columns += [section[k] for section in tier["sections"]] + [float("nan")]
    np.abs(np.array(pairs, dtype=float)).astype("<f4").tofile(f"{OUT}/rz.f32")
    np.abs(np.array(az_values, dtype=float)).astype("<f4").tofile(f"{OUT}/az.f32")
    np.abs(np.array(columns, dtype=float)).astype("<f4").tofile(f"{OUT}/columns.f32")
    print(f"{OUT}: {sum(len(p) for p in positions)} vertices, {sum(len(u) for u in uvs)} uvs, {len(pairs)} (r, z) pairs, "
          f"{len(az_values)} (az, value) pairs, {len(columns)} column values")


if __name__ == "__main__":
    main()
