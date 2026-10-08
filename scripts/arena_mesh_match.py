"""How exactly our generated arena reproduces the game's collision meshes, piece by piece: the share of the game's
vertices we have (within TOL uu) and of its triangles (all three vertices matched and the same triangle in ours).
Contacts depend on the triangulation, not only on the surface (notes/validation.md finding 39).

LOCAL ONLY: needs the meshes extracted with staticmesh.py into out/arena_local/ (never shipped).
Compares the +x/+y quadrant (arena_check.game_quadrant). Vertices below the floor (z < -1) are reported apart:
nothing can touch them.

Usage: arena_mesh_match.py [GENERATED_OBJ] [ARENA_LOCAL_DIR] [--list PIECE]   (--list: print unmatched triangles)
"""
import sys
from collections import defaultdict

import numpy as np

import arena_check

TOL = 0.05


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    listing = sys.argv[sys.argv.index("--list") + 1] if "--list" in sys.argv else None
    if listing in args:
        args.remove(listing)
    ours_path = args[0] if args else "out/arena/soccar_arena.obj"
    d = args[1] if len(args) > 1 else "out/arena_local"
    ours = arena_check.load_obj(ours_path)
    grid = lambda p: tuple(np.floor(np.asarray(p) / TOL).astype(int))
    index = defaultdict(list)                       # coarse grid cell -> our vertex ids
    verts = np.unique(np.round(ours.reshape(-1, 3), 4), axis=0)
    for i, v in enumerate(verts):
        index[grid(v)].append(i)

    def find(p):
        g = grid(p)
        best, bd = None, TOL
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for i in index.get((g[0] + dx, g[1] + dy, g[2] + dz), ()):
                        dist = np.linalg.norm(verts[i] - p)
                        if dist <= bd:
                            best, bd = i, dist
        return best

    ours_tris = set()
    vid = {tuple(v): i for i, v in enumerate(verts)}
    for t in np.round(ours, 4):
        ours_tris.add(frozenset(vid[tuple(v)] for v in t))
    for name, T in arena_check.game_quadrant(d).items():
        above = T[:, :, 2].min(axis=1) > -1
        gv = np.unique(np.round(T.reshape(-1, 3), 3), axis=0)
        gv_above = gv[gv[:, 2] > -1]
        vmatch = sum(find(v) is not None for v in gv_above)
        tmatch, unmatched = 0, []
        for t in T[above]:
            ids = [find(v) for v in t]
            if None not in ids and frozenset(ids) in ours_tris:
                tmatch += 1
            else:
                unmatched.append(t)
        print(f"{name:14s} vertices {vmatch:5d} / {len(gv_above):5d}   triangles {tmatch:5d} / {int(above.sum()):5d}"
              f"   (below the floor: {int((~above).sum())} triangles)")
        if listing == name:
            for t in unmatched:
                print("   ", [tuple(np.round(v, 2).tolist()) for v in t])


if __name__ == "__main__":
    main()
