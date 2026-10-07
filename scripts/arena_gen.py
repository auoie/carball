"""Generate a soccar arena collision mesh from our own measurements (notes/arena.md).

Nothing here comes from Psyonix's meshes: every surface is built from a handful of dimensions
(plane positions, fillet radii, corner and goal layout).

Coordinates: uu, field centre at the origin, +z up, goals at ±y (the game's own axes).
The floor (z 0), ceiling (z 2048) and side walls (x ±4096) are planes in the game and in RocketSim,
so they are not in the mesh. The mesh holds every other surface: edge curves, corners, back walls
and goals. Triangle normals point into the playable space.

Usage: arena_gen.py [OUTDIR]   (default out/arena)
  OUTDIR/soccar_arena.obj                                 for viewing (uu)
  OUTDIR/collision_meshes/soccar/soccar_arena.cmf         RocketSim collision mesh (Bullet units = uu * 0.02)
"""
import math
import os
import struct
import sys

# --- arena ---
H = 2048.0                 # ceiling
SIDE_X = 4096.0            # side walls
BACK_Y = 5120.0            # back walls (goal line face)
R_SIDE_FLOOR = 256.0       # side wall -> floor
R_CEIL = 512.0             # every wall -> ceiling
R_BACK_FLOOR = 160.0       # back wall -> floor (tapers to R_GOAL near the posts)
DIAG = 8064.0              # corner diagonal |x| + |y|
# Corner arcs (plan view): cubic Béziers sampled at t = i/8, both control arms CORNER_ARM long, tangent to the
# walls and the diagonal at these ends (not circles: the wall ends are 384 from the line intersections, the
# diagonal ends ~362)
CORNER_SIDE = ((SIDE_X, 3584.0), (3840.471, 4223.529))  # side wall -> diagonal
CORNER_BACK = ((3200.0, 4864.0), (2560.0, BACK_Y))       # diagonal -> back wall
CORNER_ARM = 245.85
# floor fillet radius across the back arc, from the diagonal (256) to the back wall (160), at t = i/8
CORNER_BACK_FLOOR_R = [256.0, 251.668, 240.628, 225.399, 208.130, 190.816, 175.483, 164.355, 160.0]
BACK_TAPER = (960.0, 1344.0)                           # |x| range of the 96 -> 160 back fillet taper
# --- goal (local: y = depth behind the goal line, x >= 0 half) ---
GOAL_X = 896.0             # inner side wall
CHAMFER = 8.0              # 45° chamfer around the mouth (posts and crossbar)
GOAL_TOP = 640.0           # crossbar underside / flat roof
R_GOAL = 96.0              # every edge inside the goal
RAMP = ((234.67, 0.0), (640.0, 16.0))
BACK_C, BACK_R = (640.0, 256.0), 240.0
BACK_TOP_DEG = 67.5        # upper back arc ends here, then the roof slopes to ROOF_FLAT_END
ROOF_FLAT_END = 224.0
# --- tessellation ---
SEG90 = 8                  # segments per quarter circle (as in the game)
BEZIER_K = 0.5518          # the game's quarter circles are cubic Béziers (controls at k·r) sampled at t = i/8
EXT = 128.0                # end segments extended under/behind planes so no mesh edge is exposed
WALL_LEVELS = [256.0 * k for k in range(1, 6)]


def qc(k):
    """Point k of SEG90 on a unit quarter circle from angle 0 to 90°, as the game tessellates every 90° arc: a cubic
    Bézier with control points at BEZIER_K, sampled at equal parameter steps. Vertex angles 11.617°, 22.892°,
    33.984°, 45°, … (not 11.25° steps); radius within +0.015% / −0.027% of the circle's. Returns (cos-like, sin-like)."""
    t = k / SEG90
    u = 1 - t
    return (u ** 3 + 3 * u * u * t + 3 * u * t * t * BEZIER_K, 3 * u * u * t * BEZIER_K + 3 * u * t * t + t ** 3)


def bezier(p0, d0, p3, d3, arm, t):
    """Point and unit inward normal (tangent turned left) of the cubic Bézier from p0 (leaving along d0) to p3
    (arriving along d3), control arms `arm` long."""
    p1 = tuple(a + arm * d for a, d in zip(p0, d0))
    p2 = tuple(a - arm * d for a, d in zip(p3, d3))
    u = 1 - t
    p = tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3))
    tan = norm(tuple(3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c) for a, b, c, d in zip(p0, p1, p2, p3)))
    return p, (-tan[1], tan[0])


def smoothstep(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def norm(v):
    l = math.sqrt(sum(c * c for c in v))
    return tuple(c / l for c in v)


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def mul(a, s):
    return tuple(x * s for x in a)


def extend(p0, p1):
    """Point EXT beyond p0, continuing the segment p1 -> p0."""
    return add(p0, mul(norm(sub(p0, p1)), EXT))


class Mesh:
    def __init__(self):
        self.verts, self.index, self.tris, self.pieces = [], {}, [], {}

    def v(self, p):
        key = tuple(round(c, 3) for c in p)
        if key not in self.index:
            self.index[key] = len(self.verts)
            self.verts.append(key)
        return self.index[key]

    def tri(self, piece, a, b, c):
        ia, ib, ic = self.v(a), self.v(b), self.v(c)
        if len({ia, ib, ic}) < 3:
            return
        n = cross(sub(self.verts[ib], self.verts[ia]), sub(self.verts[ic], self.verts[ia]))
        if math.sqrt(sum(x * x for x in n)) < 1e-6:
            return
        self.pieces.setdefault(piece, []).append(len(self.tris))
        self.tris.append([ia, ib, ic])

    def quad(self, piece, a, b, c, d):
        self.tri(piece, a, b, c)
        self.tri(piece, a, c, d)

    def strip(self, piece, A, B):
        """Triangulate between polylines A and B (same direction), any point counts."""
        la, lb = cum(A), cum(B)
        i = j = 0
        while i < len(A) - 1 or j < len(B) - 1:
            if j == len(B) - 1 or (i < len(A) - 1 and la[i + 1] <= lb[j + 1]):
                self.tri(piece, A[i], B[j], A[i + 1])
                i += 1
            else:
                self.tri(piece, A[i], B[j], B[j + 1])
                j += 1

    def orient(self, piece, inward):
        """Make every triangle of `piece` face along inward(centroid) (a direction into the playable space)."""
        bad = 0
        for t in self.pieces.get(piece, []):
            p = [self.verts[i] for i in self.tris[t]]
            n = cross(sub(p[1], p[0]), sub(p[2], p[0]))
            c = mul(add(add(p[0], p[1]), p[2]), 1 / 3)
            if sum(x * y for x, y in zip(n, inward(c))) < 0:
                self.tris[t] = [self.tris[t][0], self.tris[t][2], self.tris[t][1]]
                bad += 1
        return bad


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def cum(P):
    out, s = [0.0], 0.0
    for a, b in zip(P, P[1:]):
        s += math.dist(a, b)
        out.append(s)
    return [x / s for x in out] if s else out


# ---------------------------------------------------------------- profiles (o = distance from the wall, z)
def floor_profile(r):
    """Floor fillet from the floor tangent to the wall tangent, with extensions under the floor and behind the wall."""
    pts = [(r - r * qc(k)[1], r - r * qc(k)[0]) for k in range(SEG90 + 1)]
    return [extend(pts[0], pts[1])] + pts + [extend(pts[-1], pts[-2])]


def ceil_profile(r=R_CEIL):
    """Ceiling fillet from the wall tangent to the ceiling tangent, with extensions behind the wall and above the ceiling."""
    pts = [(r - r * qc(k)[0], H - r + r * qc(k)[1]) for k in range(SEG90 + 1)]
    return [extend(pts[0], pts[1])] + pts + [extend(pts[-1], pts[-2])]


# ---------------------------------------------------------------- arena walls (quadrant x >= 0, y >= 0)
def back_floor_radius(x):
    lo, hi = BACK_TAPER
    return R_GOAL + (R_BACK_FLOOR - R_GOAL) * smoothstep((x - lo) / (hi - lo))


def stations():
    """Plan contour from the side wall midline to the goal centre line: (point, inward normal, floor radius, kind)."""
    S = []
    # side wall (plane) -> only fillets, with extensions behind the wall plane
    tangent_side = CORNER_SIDE[0][1]
    for y in [0, 512, 1024, 1536, 2048, 2560, 3072, tangent_side]:
        S.append(dict(p=(SIDE_X, y), n=(-1.0, 0.0), rf=R_SIDE_FLOOR, kind="side" if y < tangent_side else "side_end"))
    # corner: arc tangent to the side wall, diagonal, arc tangent to the back wall
    d_side, d_diag, d_back = (0.0, 1.0), (-1 / math.sqrt(2), 1 / math.sqrt(2)), (-1.0, 0.0)
    for k in range(1, SEG90 + 1):
        p, n = bezier(CORNER_SIDE[0], d_side, CORNER_SIDE[1], d_diag, CORNER_ARM, k / SEG90)
        S.append(dict(p=p, n=n, rf=R_SIDE_FLOOR, kind="wall"))
    d0, d1 = CORNER_SIDE[1], CORNER_BACK[0]
    n_diag = (-1 / math.sqrt(2), -1 / math.sqrt(2))
    for k in range(1, 4):
        S.append(dict(p=tuple(a + (b - a) * k / 4 for a, b in zip(d0, d1)), n=n_diag, rf=R_SIDE_FLOOR, kind="wall"))
    for k in range(SEG90 + 1):              # k = 0 at the diagonal, 8 at the back wall
        p, n = bezier(CORNER_BACK[0], d_diag, CORNER_BACK[1], d_back, CORNER_ARM, k / SEG90)
        S.append(dict(p=p, n=n, rf=CORNER_BACK_FLOOR_R[k], kind="wall"))
    # back wall to the post
    for x in [2304, 2048, 1792, 1536, 1344, 1280, 1216, 1152, 1088, 1024, 960, GOAL_X + CHAMFER]:
        S.append(dict(p=(float(x), BACK_Y), n=(0.0, -1.0), rf=back_floor_radius(x), kind="wall"))
    S[-1]["kind"] = "post"
    return S


def mouth_outline(r_extra):
    """Mouth outline (x, z) from the post top to the centre line; r_extra 8 = face (y 0), 0 = inside (y 8)."""
    r, c = R_GOAL + r_extra, (GOAL_X - R_GOAL, GOAL_TOP - R_GOAL)
    pts = [(c[0] + r * qc(k)[0], c[1] + r * qc(k)[1]) for k in range(SEG90 + 1)]
    return pts + [(x, GOAL_TOP + r_extra) for x in (600.0, 400.0, 200.0, 0.0)]


POST_LEVELS = [R_GOAL, 256.0, 512.0, GOAL_TOP - R_GOAL]   # post edge vertices (z), shared by wall, chamfer and goal side


def build_walls(m):
    S = stations()
    at = lambda s, o, z: (s["p"][0] + s["n"][0] * o, s["p"][1] + s["n"][1] * o, z)
    # floor fillets
    for a, b in zip(S, S[1:]):
        pa, pb = floor_profile(a["rf"]), floor_profile(b["rf"])
        for k in range(len(pa) - 1):
            if k == len(pa) - 2 and not (a["kind"].startswith("side") and b["kind"].startswith("side")):
                continue        # extension behind the wall only where the wall is a plane
            m.quad("floor_fillet", at(a, *pa[k]), at(b, *pb[k]), at(b, *pb[k + 1]), at(a, *pa[k + 1]))
    # vertical walls (corner and back wall; the side wall is a plane)
    def column(s, bottom, extra=()):
        zs = sorted({bottom, H - R_CEIL, *[z for z in WALL_LEVELS if bottom + 1 < z < H - R_CEIL], *extra})
        return [at(s, 0, z) for z in zs]
    for a, b in zip(S, S[1:]):
        if a["kind"] == "side" or b["kind"] == "side":
            continue
        ea = POST_LEVELS if a["kind"] == "post" else ()
        eb = POST_LEVELS if b["kind"] == "post" else ()
        m.strip("wall", column(a, a["rf"], ea), column(b, b["rf"], eb))
    # wall above and around the mouth
    outline = mouth_outline(CHAMFER)
    M = [dict(p=(x, BACK_Y), n=(0.0, -1.0), bottom=z) for x, z in outline]
    for a, b in zip(M, M[1:]):
        m.strip("wall", column(a, a["bottom"]), column(b, b["bottom"]))
    # ceiling fillets (all the way to the centre line)
    C = S + [dict(p=s["p"], n=s["n"], kind="wall") for s in M[1:]]
    pc = ceil_profile()
    for a, b in zip(C, C[1:]):
        for k in range(len(pc) - 1):
            if k == 0 and not (a["kind"].startswith("side") and b["kind"].startswith("side")):
                continue
            m.quad("ceiling_fillet", at(a, *pc[k]), at(b, *pc[k]), at(b, *pc[k + 1]), at(a, *pc[k + 1]))


# ---------------------------------------------------------------- goal (local coordinates, x >= 0 half)
def goal_path():
    """Centre-line profile (y, z) of the goal interior, from the mouth floor round the back to the mouth roof."""
    P = [(CHAMFER, 0.0), RAMP[0], RAMP[1]]
    for k in range(1, SEG90 + 1):                                   # lower back arc, -90° -> 0°
        c, s_ = qc(k)
        P.append((BACK_C[0] + BACK_R * s_, BACK_C[1] - BACK_R * c))
    for k in range(1, round(BACK_TOP_DEG / (90 / SEG90)) + 1):      # upper back arc, 0° -> ~67.5° (6 of 8 steps)
        c, s_ = qc(k)
        P.append((BACK_C[0] + BACK_R * c, BACK_C[1] + BACK_R * s_))
    P += [(ROOF_FLAT_END, GOAL_TOP), (CHAMFER, GOAL_TOP)]
    return P


def miter_offsets(P, d):
    """Offset vectors (length d along each segment normal) at every path vertex, pointing into the goal."""
    segn = [norm((-(b[1] - a[1]), b[0] - a[0])) for a, b in zip(P, P[1:])]   # left normals
    out = []
    for i in range(len(P)):
        if i == 0:
            n = segn[0]
        elif i == len(P) - 1:
            n = segn[-1]
        else:
            avg = norm(add(segn[i - 1], segn[i]))
            n = mul(avg, 1 / sum(x * y for x, y in zip(avg, segn[i])))
        out.append(mul(n, d))
    return out


def build_goal(m):
    P = goal_path()
    off = miter_offsets(P, R_GOAL)
    floor_vertices = 2                       # P[0], P[1] lie on the floor plane
    xs = [0.0, 200.0, 400.0, 600.0, GOAL_X - R_GOAL]
    g = lambda x, yz: (x, yz[0], yz[1])
    # centre surface: ramp (extended under the floor), back, roof
    ramp_ext = extend(P[1], P[2])
    path = [ramp_ext] + P[1:]
    for xa, xb in zip(xs, xs[1:]):
        for a, b in zip(path, path[1:]):
            m.quad("goal_surface", g(xa, a), g(xa, b), g(xb, b), g(xb, a))
    # fillet between the centre surface and the side wall, swept along the path
    def ring(i):
        pts = []
        for k in range(SEG90 + 1):
            c, s_ = qc(k)
            yz = add(P[i], mul(off[i], 1 - c))
            pts.append((GOAL_X - R_GOAL + R_GOAL * s_, yz[0], yz[1]))
        if i < floor_vertices:
            pts = [extend(pts[0], pts[1])] + pts
        return pts
    rings = [ring(i) for i in range(len(P))]
    for i in range(len(P) - 1):
        a, b = rings[i], rings[i + 1]
        if len(a) != len(b):
            a = a[1:]
        m.strip("goal_fillet", a, b)
    # side wall (convex polygon): offset path + front edge down the post
    loop = [g(GOAL_X, add(P[i], off[i])) for i in range(len(P))]
    loop += [(GOAL_X, CHAMFER, z) for z in reversed(POST_LEVELS[1:-1])]
    cy = sum(p[1] for p in loop) / len(loop)
    cz = sum(p[2] for p in loop) / len(loop)
    for a, b in zip(loop, loop[1:] + loop[:1]):
        m.tri("goal_side", (GOAL_X, cy, cz), a, b)
    # mouth chamfer: face outline (y 0) to inner outline (y 8), post edge first
    outer = [(GOAL_X + CHAMFER, 0.0, z) for z in POST_LEVELS[:-1]] + [(x, 0.0, z) for x, z in mouth_outline(CHAMFER)]
    inner = [(GOAL_X, CHAMFER, z) for z in POST_LEVELS[:-1]] + [(x, CHAMFER, z) for x, z in mouth_outline(0.0)]
    for k in range(len(outer) - 1):
        m.quad("mouth_chamfer", outer[k], outer[k + 1], inner[k + 1], inner[k])
    # post base: floor fillet revolved round the post's vertical axis, from the back wall into the goal
    axis = (GOAL_X + CHAMFER, CHAMFER)
    prof = floor_profile(R_GOAL)[:-1]        # extension under the floor + fillet, no wall extension
    def wrap_ring(o, z):
        rho = CHAMFER + o
        return [(axis[0] - rho * qc(j)[1], axis[1] - rho * qc(j)[0], z) for j in range(SEG90 + 1)]   # 270° -> 180°
    W = [wrap_ring(o, z) for o, z in prof[:-1]] + [[(GOAL_X + CHAMFER, 0.0, R_GOAL), (GOAL_X, CHAMFER, R_GOAL)]]
    for a, b in zip(W, W[1:]):
        m.strip("post_base", a, b)


# ---------------------------------------------------------------- assembly
def mirrored(m, transform_list):
    out = Mesh()
    for fx, fy, place in transform_list:
        flip = (fx * fy) < 0
        for piece, idx in m.pieces.items():
            for t in idx:
                p = [place((m.verts[i][0] * fx, m.verts[i][1] * fy, m.verts[i][2])) for i in m.tris[t]]
                if flip:
                    p = [p[0], p[2], p[1]]
                out.tri(piece, *p)
    return out


def build():
    walls = Mesh()
    build_walls(walls)
    goal = Mesh()
    build_goal(goal)
    # face directions: walls toward the field centre; goal pieces toward the goal (local coordinates)
    centre = (0.0, 0.0, H / 2)
    for piece in list(walls.pieces):
        walls.orient(piece, lambda c: sub(centre, c))
    goal.orient("goal_surface", lambda c: sub((0.0, 450.0, 320.0), c))
    goal.orient("goal_fillet", lambda c: sub((0.0, 450.0, 320.0), c))
    goal.orient("goal_side", lambda c: (-1.0, 0.0, 0.0))
    goal.orient("mouth_chamfer", lambda c: (-1.0, -1.0, -1.0) if c[2] > GOAL_TOP - R_GOAL else (-1.0, -1.0, 0.0))
    goal.orient("post_base", lambda c: (c[0] - (GOAL_X + CHAMFER), c[1] - CHAMFER, 0.0) if c[2] > 0 else (0, 0, 1))
    arena = Mesh()
    quads = [(1, 1, lambda p: p), (-1, 1, lambda p: p), (1, -1, lambda p: p), (-1, -1, lambda p: p)]
    goals = [(1, 1, lambda p: (p[0], BACK_Y + p[1], p[2])), (-1, 1, lambda p: (p[0], BACK_Y + p[1], p[2])),
             (1, -1, lambda p: (p[0], -BACK_Y + p[1], p[2])), (-1, -1, lambda p: (p[0], -BACK_Y + p[1], p[2]))]
    for part in (mirrored(walls, quads), mirrored(goal, goals)):
        for piece, idx in part.pieces.items():
            for t in idx:
                arena.tri(piece, *[part.verts[i] for i in part.tris[t]])
    return arena


def write(m, outdir):
    os.makedirs(os.path.join(outdir, "collision_meshes", "soccar"), exist_ok=True)
    with open(os.path.join(outdir, "soccar_arena.obj"), "w") as f:
        f.write("# generated by scripts/arena_gen.py (uu, +z up)\n")
        for v in m.verts:
            f.write("v %.3f %.3f %.3f\n" % v)
        for piece, idx in m.pieces.items():
            f.write(f"g {piece}\n")
            for t in idx:
                f.write("f %d %d %d\n" % tuple(i + 1 for i in m.tris[t]))
    with open(os.path.join(outdir, "collision_meshes", "soccar", "soccar_arena.cmf"), "wb") as f:
        f.write(struct.pack("<ii", len(m.tris), len(m.verts)))
        for t in m.tris:
            f.write(struct.pack("<3i", *t))
        for v in m.verts:
            f.write(struct.pack("<3f", *(c * 0.02 for c in v)))


if __name__ == "__main__":
    outdir = sys.argv[1] if len(sys.argv) > 1 else "out/arena"
    arena = build()
    write(arena, outdir)
    print(f"{len(arena.verts)} vertices, {len(arena.tris)} triangles")
    for piece, idx in arena.pieces.items():
        print(f"  {piece:15s} {len(idx):6d}")
