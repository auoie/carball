"""Compare our generated arena (scripts/arena_gen.py) with the game's collision meshes.

LOCAL ONLY: needs the meshes extracted with staticmesh.py into out/arena_local/ (never shipped).
Compares the +x/+y quadrant: samples both surfaces every ~SPACING uu inside the playable space and
reports distances to the other surface. Game samples hidden behind our surface (the game's pieces
overlap and run on behind each other) are left out.

Usage: arena_check.py [GENERATED_OBJ] [ARENA_LOCAL_DIR]
"""
import sys

import numpy as np

SPACING = 16.0
MAXD = 64.0


def load_obj(path):
    V, F = [], []
    for line in open(path):
        t = line.split()
        if t and t[0] == "v":
            V.append([float(x) for x in t[1:4]])
        elif t and t[0] == "f":
            F.append([int(x.split("/")[0]) - 1 for x in t[1:4]])
    V, F = np.array(V), np.array(F)
    return V[F]                       # (n, 3, 3) triangles


def game_quadrant(d):
    parts = {
        "corner": load_obj(f"{d}/Field_STD_Collision_Corner.obj"),
        "side_floor": load_obj(f"{d}/Field_STD_Collision_SideBot_Half.obj"),
        "side_ceiling": load_obj(f"{d}/Field_STD_Collision_SideTop_Half.obj"),
    }
    goal = load_obj(f"{d}/Goal_STD_Collision_Half_Goal_STD_Collision.obj").copy()
    goal[..., 0] *= -1                # the half is placed mirrored (scale3D -1,1,1) at y 5120
    goal[..., 1] += 5120
    parts["goal_and_back"] = goal
    return parts


def playable(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    return (z > 0.5) & (z < 2047.5) & (x < 4095.5) & (x > 0.5) & (y > 0.5) & (y < 6000.5)


def sample(T):
    out = []
    for a, b, c in T:
        n = int(max(np.linalg.norm(b - a), np.linalg.norm(c - a), np.linalg.norm(c - b)) / SPACING) + 1
        for i in range(n + 1):
            for j in range(n + 1 - i):
                u, v = i / n, j / n
                out.append(a + u * (b - a) + v * (c - a))
    p = np.array(out)
    return p[playable(p)]


def closest_dist(P, T):
    """Distance from each point in P (m,3) to the nearest triangle in T (n,3,3); capped at MAXD."""
    lo, hi = T.min(axis=1) - MAXD, T.max(axis=1) + MAXD
    best = np.full(len(P), MAXD)
    cell = 256.0
    keys = np.floor(P / cell).astype(int)
    order = np.lexsort(keys.T)
    P, keys = P[order], keys[order]
    res = np.empty(len(P))
    start = 0
    while start < len(P):
        end = start
        while end < len(P) and (keys[end] == keys[start]).all():
            end += 1
        Q = P[start:end]
        qlo, qhi = Q.min(axis=0), Q.max(axis=0)
        cand = T[((lo <= qhi) & (hi >= qlo)).all(axis=1)]
        d = np.full(len(Q), MAXD)
        for k in range(0, len(cand), 256):
            d = np.minimum(d, point_tri(Q, cand[k:k + 256]).min(axis=1))
        res[start:end] = d
        start = end
    best[order] = res
    return best


def point_tri(P, T):
    """(m, n) distances between points and triangles (Ericson, closest point on triangle)."""
    p = P[:, None, :]
    a, b, c = T[None, :, 0], T[None, :, 1], T[None, :, 2]
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(-1), (ac * ap).sum(-1)
    bp = p - b
    d3, d4 = (ab * bp).sum(-1), (ac * bp).sum(-1)
    cp = p - c
    d5, d6 = (ab * cp).sum(-1), (ac * cp).sum(-1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    with np.errstate(divide="ignore", invalid="ignore"):
        denom = 1.0 / (va + vb + vc)
        v = vb * denom
        w = vc * denom
        res = a + ab * v[..., None] + ac * w[..., None]                       # interior
        t_ab = d1 / (d1 - d3)
        t_ac = d2 / (d2 - d6)
        t_bc = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    cases = [
        ((d1 <= 0) & (d2 <= 0), a),
        ((d3 >= 0) & (d4 <= d3), b),
        ((d6 >= 0) & (d5 <= d6), c),
        ((vc <= 0) & (d1 >= 0) & (d3 <= 0), a + ab * t_ab[..., None]),
        ((vb <= 0) & (d2 >= 0) & (d6 <= 0), a + ac * t_ac[..., None]),
        ((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), b + (c - b) * t_bc[..., None]),
    ]
    for cond, val in reversed(cases):
        res = np.where(cond[..., None], np.broadcast_to(val, res.shape), res)
    return np.linalg.norm(p - res, axis=-1)


def hidden(P, T):
    """True where the segment from P to a point inside the playable space crosses T (P is behind that surface)."""
    target = np.where((P[:, 1] > 5130)[:, None], np.array([0.0, 5520.0, 320.0]), np.array([0.0, 0.0, 1024.0]))
    out = np.zeros(len(P), bool)
    a, e1, e2 = T[:, 0], T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    for k in range(0, len(P), 512):
        o, dirn = P[k:k + 512, None, :], (target[k:k + 512] - P[k:k + 512])[:, None, :]
        h = np.cross(dirn, e2[None])
        det = (e1[None] * h).sum(-1)
        with np.errstate(divide="ignore", invalid="ignore"):
            f = 1.0 / det
            s = o - a[None]
            u = f * (s * h).sum(-1)
            q = np.cross(s, e1[None])
            v = f * (dirn * q).sum(-1)
            t = f * (e2[None] * q).sum(-1)
        hit = (np.abs(det) > 1e-9) & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-4) & (t < 1)
        out[k:k + 512] = hit.any(axis=1)
    return out


def report(name, P, d):
    q = np.percentile(d, [50, 90, 99, 100])
    print(f"  {name:14s} n={len(d):6d}  median {q[0]:5.2f}  p90 {q[1]:5.2f}  p99 {q[2]:5.2f}  max {q[3]:5.2f}")
    worst = np.argsort(d)[-3:][::-1]
    for i in worst:
        if d[i] > 2:
            print(f"      {d[i]:5.1f} at ({P[i, 0]:.0f}, {P[i, 1]:.0f}, {P[i, 2]:.0f})")


def main():
    gen = load_obj(sys.argv[1] if len(sys.argv) > 1 else "out/arena/arena.obj")
    d = sys.argv[2] if len(sys.argv) > 2 else "out/arena_local"
    ours = gen[(gen[..., 0].min(axis=1) > -1) & (gen[..., 1].min(axis=1) > -1)]
    # the planes (floor, ceiling, side wall) are not in the mesh but are part of the arena surface
    planes = []
    for quad in ([(0, 0, 0), (4096, 0, 0), (4096, 6226, 0), (0, 6226, 0)],
                 [(0, 0, 2048), (4096, 0, 2048), (4096, 6226, 2048), (0, 6226, 2048)],
                 [(4096, 0, 0), (4096, 6226, 0), (4096, 6226, 2048), (4096, 0, 2048)]):
        q = np.array(quad, float)
        planes += [q[[0, 1, 2]], q[[0, 2, 3]]]
    ours_planes = np.concatenate([ours, np.array(planes)])
    parts = game_quadrant(d)
    game_all = np.concatenate(list(parts.values()))
    print("game surface -> nearest generated surface (uu):")
    for name, T in parts.items():
        P = sample(T)
        d = closest_dist(P, ours_planes)
        far = d > 2
        keep = np.ones(len(P), bool)
        keep[np.where(far)[0][hidden(P[far], ours)]] = False   # overlap the game hides behind another piece
        report(name, P[keep], d[keep])
    print("generated surface -> nearest game surface (uu):")
    P = sample(ours)
    report("generated", P, closest_dist(P, game_all))


if __name__ == "__main__":
    main()
