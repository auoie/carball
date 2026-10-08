"""Derive arena_topology.json: for each of the game's 16 arena meshes, its triangles in the game's own (PhysX-cooked)
order, as indices into our vertex pool for that piece (arena_layout.py). Only indices are written: no coordinates.

LOCAL ONLY: reads the game's cooked meshes, extracted from the decrypted level (out/arena_local/cooked, written by the
static session's cooked.py --local: triangles in cooked order, vertices in Bullet units, goal halves in actor space).
Every game vertex must match exactly one pool vertex within TOL uu; a piece whose pool doesn't cover its mesh is
reported and left out.

Usage: arena_topology_derive.py [COOKED_DIR] [OUT.json]
"""
import json
import os
import struct
import sys

import numpy as np

import arena_layout as al

TOL = 0.5            # a vertex in the playable space (or on its boundary) must match exactly one pool vertex this
                     # closely (most match to 0.05; the post-base ring and the mouth arc's ends are up to 0.4 off: the
                     # game's own small departures from its circles there)
HIDDEN_TOL = 50.0    # one out of play (under the floor, above the ceiling, behind a wall plane) is matched to the
                     # nearest pool vertex left: the pools approximate the game's skirts there (no rule reproduces them,
                     # and their coordinates aren't ours to copy)


def hidden(p, piece):
    if p[2] < -0.5 or p[2] > 2048.5:
        return True
    if piece == "goal_and_back":
        return False
    return abs(p[0]) > 4096.5 or abs(p[1]) > 5120.5
# Instances in the level's order (MeshCollector1), as the cooked store and the static session's INST table
QUADS = ["px_py", "nx_py", "px_ny", "nx_ny"]


def read_cmf(path):
    data = open(path, "rb").read()
    nt, nv = struct.unpack_from("<ii", data)
    tris = np.frombuffer(data, "<i4", nt * 3, 8).reshape(nt, 3)
    verts = np.frombuffer(data, "<f4", nv * 3, 8 + nt * 12).reshape(nv, 3).astype(np.float64) * 50.0
    return tris, verts


def derive(piece, q, cooked_dir):
    tris, verts = read_cmf(os.path.join(cooked_dir, f"cooked_{piece}_{q}.cmf"))
    pool = np.array(al.quadrant(piece, q))
    index = [None] * len(verts)
    taken = set()
    worst = worst_hidden = 0.0
    for gi, g in enumerate(verts):
        if hidden(g, piece):
            continue
        d = np.linalg.norm(pool - g, axis=1)
        near = np.flatnonzero(d < TOL)
        if len(near) != 1:
            return None, f"vertex {np.round(g, 3)}: {len(near)} pool vertices within {TOL} (nearest {d.min():.3f})"
        index[gi] = int(near[0])
        taken.add(int(near[0]))
        worst = max(worst, float(d[near[0]]))
    # Hidden vertices: closest pairs first, one pool vertex each
    pairs = sorted((float(np.linalg.norm(pool[pi] - verts[gi])), gi, pi) for gi in range(len(verts)) if index[gi] is None
                   for pi in range(len(pool)) if pi not in taken)
    for dist, gi, pi in pairs:
        if index[gi] is None and pi not in taken and dist < HIDDEN_TOL:
            index[gi] = pi
            taken.add(pi)
            worst_hidden = max(worst_hidden, dist)
    missing = [np.round(verts[gi], 2).tolist() for gi in range(len(verts)) if index[gi] is None]
    if missing:
        return None, f"no pool vertex for {missing[:3]}"
    if len(taken) != len(verts):
        return None, "two game vertices on one pool vertex"
    out = [index[i] for t in tris for i in t]
    if len(set(tuple(sorted(out[i:i + 3])) for i in range(0, len(out), 3))) != len(tris):
        return None, "two triangles map to the same pool triangle"
    return out, f"{len(tris)} triangles, {len(verts)} vertices, worst match {worst:.4f} uu (out of play {worst_hidden:.2f})"


def main():
    cooked_dir = sys.argv[1] if len(sys.argv) > 1 else "out/arena_local/cooked"
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "arena_topology.json")
    table = {}
    for piece in al.PIECES:
        try:
            al.pool(piece)
        except NotImplementedError:
            print(f"{piece}: no pool yet")
            continue
        entry = {}
        for q in QUADS:
            tri, info = derive(piece, q, cooked_dir)
            print(f"{piece} {q}: {info}")
            if tri is None:
                entry = None
                break
            entry[q] = tri
        if entry:
            table[piece] = entry
    doc = {
        "about": "The game's arena meshes as triangles of our own vertices (scripts/arena_layout.py pools; indices, in "
                 "the game's cooked triangle order and winding). Derived by scripts/arena_topology_derive.py.",
        "pieces": table,
    }
    with open(out_path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {out_path}: {', '.join(table) or 'nothing'}")


if __name__ == "__main__":
    main()
