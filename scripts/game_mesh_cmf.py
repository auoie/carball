"""Build a RocketSim collision mesh (.cmf) of the game's own arena meshes, for local validation only
(`live_validate --meshes`, `replay_validate --meshes`): the reference our generated arena is checked against.

LOCAL ONLY: reads the meshes extracted with staticmesh.py from out/arena_local/ and writes into it (never shipped).
The +x/+y quadrant (arena_check.game_quadrant) is mirrored into all four, as the level does with negative actor scale.
Every triangle faces into the playable space: the ball's sphere-triangle test is one-sided, and the car's GJK takes
a triangle's face normal (engine patch 52), so the winding matters. In the extracted pieces the field pieces face
outward and the (mirrored) goal half inward; a mirror across one axis reverses the winding again.

Usage: game_mesh_cmf.py [ARENA_LOCAL_DIR] [OUT.cmf] [--pieces OUTDIR]
  --pieces: also write each of the level's 16 pieces as its own .cmf in OUTDIR (each its own static body, as in the
  game), instead of one merged file
"""
import struct
import sys

import numpy as np

import arena_check


def write_cmf(path, T):
    verts = (T.reshape(-1, 3) * 0.02).astype("<f4")              # uu -> Bullet units
    idx = np.arange(len(verts), dtype="<i4").reshape(-1, 3)
    with open(path, "wb") as f:
        f.write(struct.pack("<ii", len(idx), len(verts)))
        f.write(idx.tobytes())
        f.write(verts.tobytes())


def main():
    args = [a for a in sys.argv[1:] if a != "--pieces"]
    piece_dir = None
    if "--pieces" in sys.argv:
        piece_dir = sys.argv[sys.argv.index("--pieces") + 1]
        args.remove(piece_dir)
    d = args[0] if len(args) > 0 else "out/arena_local"
    out = args[1] if len(args) > 1 else f"{d}/collision_meshes_game/soccar/game_arena.cmf"
    parts = arena_check.game_quadrant(d)
    if piece_dir:
        import os
        os.makedirs(piece_dir, exist_ok=True)
        for name, T in parts.items():
            T = T if name == "goal_and_back" else T[:, ::-1]       # facing inward
            for sx, sy, q in ((1, 1, "px_py"), (-1, 1, "nx_py"), (1, -1, "px_ny"), (-1, -1, "nx_ny")):
                M = T * np.array([sx, sy, 1.0])
                write_cmf(f"{piece_dir}/game_{name}_{q}.cmf", M if sx * sy > 0 else M[:, ::-1])
        print(f"wrote {4 * len(parts)} pieces to {piece_dir}")
        return
    quadrant = []
    for name, T in parts.items():
        quadrant.append(T if name == "goal_and_back" else T[:, ::-1])   # all facing inward
    Q = np.concatenate(quadrant)
    tris = []
    for sx in (1, -1):
        for sy in (1, -1):
            M = Q * np.array([sx, sy, 1.0])
            tris.append(M if sx * sy > 0 else M[:, ::-1])
    T = np.concatenate(tris)
    verts = (T.reshape(-1, 3) * 0.02).astype("<f4")              # uu -> Bullet units
    idx = np.arange(len(verts), dtype="<i4").reshape(-1, 3)
    with open(out, "wb") as f:
        f.write(struct.pack("<ii", len(idx), len(verts)))
        f.write(idx.tobytes())
        f.write(verts.tobytes())
    print(f"wrote {out}: {len(idx)} triangles")


if __name__ == "__main__":
    main()
