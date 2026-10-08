"""Build a RocketSim collision mesh (.cmf) of the game's own arena meshes, for local validation only
(`live_validate --meshes`, `replay_validate --meshes`): the reference our generated arena is checked against.

LOCAL ONLY: reads the meshes extracted with staticmesh.py from out/arena_local/ and writes into it (never shipped).
The +x/+y quadrant (arena_check.game_quadrant) is mirrored into all four, as the level does with negative actor scale.
Every triangle faces into the playable space: the ball's sphere-triangle test is one-sided, and the car's GJK takes
a triangle's face normal (engine patch 52), so the winding matters. In the extracted pieces the field pieces face
outward and the (mirrored) goal half inward; a mirror across one axis reverses the winding again.

Usage: game_mesh_cmf.py [ARENA_LOCAL_DIR] [OUT.cmf]
"""
import struct
import sys

import numpy as np

import arena_check


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "out/arena_local"
    out = sys.argv[2] if len(sys.argv) > 2 else f"{d}/collision_meshes_game/soccar/game_arena.cmf"
    parts = arena_check.game_quadrant(d)
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
