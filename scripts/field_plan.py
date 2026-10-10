#!/usr/bin/env python3
"""DFH Stadium's field plan traced from the local mesh exports (notes/arena-visuals.md AV-5, AV-7, AV-13): the floor
regions' simplified outlines, the painted markings' and the frame's stripes' centrelines and widths, the goals' glow
ribbons, the glass beside each goal. Shapes traced from the game's meshes are a local asset (the user's decision): this
writes them to out/bsim/assets_local/arena/field_plan.json (git-ignored), which the dev server serves at /local-assets/
and the client draws when present (client/src/render/stadiumFieldRules.ts); builds draw the plan built from
measurements there. The meshes and this output never go in the repo.

Usage: .venv/bin/python scripts/field_plan.py [MESH_DIR] [OUT.json]
       .venv/bin/python scripts/field_plan.py --light   (the baked-light statistics as FIELD_LIGHT's TypeScript: those
                                                          are numbers, not shapes, and live in stadiumFieldRules.ts)
"""
import glob
import json
import os
import sys
from collections import defaultdict

import numpy as np

LIGHT_ONLY = sys.argv[1:] == ["--light"]
MESHES = sys.argv[1] if len(sys.argv) > 1 and not LIGHT_ONLY else "out/bsim/assets_local/arena"
OUT = sys.argv[2] if len(sys.argv) > 2 else "out/bsim/assets_local/arena/field_plan.json"
# The static session's statistics of Stadium_P's baked lightmaps (per mesh, and in bins along an axis; linear RGB, a
# flat face facing up: values only)
LIGHTMAPS = sys.argv[3] if len(sys.argv) > 3 else "out/bsim/agents/LMP/lm_stats.json"
OUTLINE_TOL = 2.0  # uu (Douglas-Peucker)
LINE_TOL = 0.75


def load(name, zmax=None, zmin=None, group=None):
    """A mesh's plan: its vertices (x, y, welded at 0.05 uu) and triangles, those above `zmax` or below `zmin` or not in
    a material group naming `group` dropped"""
    (path,) = glob.glob(f"{MESHES}/*/{name}.obj")
    v, tris, g = [], [], ""
    for line in open(path):
        if line.startswith("v "):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("g "):
            g = line.split()[1]
        elif line.startswith("f ") and (group is None or group in g):
            p = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
            tris += [(p[0], p[k], p[k + 1]) for k in range(1, len(p) - 1)]
    v = np.array(v)
    if zmax is not None:
        tris = [t for t in tris if all(v[i, 2] <= zmax for i in t)]
    if zmin is not None:
        tris = [t for t in tris if all(v[i, 2] >= zmin for i in t)]
    key, ids = {}, []
    for x, y in v[:, :2]:
        ids.append(key.setdefault((round(x * 20), round(y * 20)), len(key)))
    pts = np.zeros((len(key), 2))
    for i, k in enumerate(ids):
        pts[k] = v[i, :2]
    tris = [tuple(ids[i] for i in t) for t in tris]
    return pts, [t for t in tris if len(set(t)) == 3 and abs(cross(pts[t[1]] - pts[t[0]], pts[t[2]] - pts[t[0]])) > 1e-6]


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def area(p):
    return 0.5 * float(np.sum(p[:-1, 0] * p[1:, 1] - p[1:, 0] * p[:-1, 1]))


def simplify(p, tol):
    if len(p) < 3:
        return p
    a, b = p[0], p[-1]
    d = b - a
    length = np.hypot(*d)
    q = p - a
    dist = np.abs(d[0] * q[:, 1] - d[1] * q[:, 0]) / length if length > 1e-9 else np.hypot(q[:, 0], q[:, 1])
    i = int(np.argmax(dist))
    if dist[i] > tol:
        return np.vstack([simplify(p[: i + 1], tol)[:-1], simplify(p[i:], tol)])
    return np.array([a, b])


def loops(pts, tris):
    """The boundary loops (closed: first point repeated), simplified"""
    count, direction = defaultdict(int), {}
    for t in tris:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            e = (min(a, b), max(a, b))
            count[e] += 1
            direction[e] = (a, b)
    nxt = defaultdict(list)
    for e, c in count.items():
        if c == 1:
            a, b = direction[e]
            nxt[a].append(b)
    used, out = set(), []
    for s in list(nxt):
        for b0 in nxt[s]:
            if (s, b0) in used:
                continue
            loop, a, b = [s], s, b0
            while (a, b) not in used:
                used.add((a, b))
                loop.append(b)
                a = b
                cand = [c for c in nxt[a] if (a, c) not in used]
                if not cand:
                    break
                b = cand[0]
            out.append(simplify(pts[loop], OUTLINE_TOL))
    return out


def inside(p, poly):
    x, y = p
    hit = False
    for (x0, y0), (x1, y1) in zip(poly[:-1], poly[1:]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


def kept(p):
    """Which mirror images make the whole set from this piece: x >= 0, y >= 0 pieces 'xy' (four ways), pieces across
    x = 0 'y', across y = 0 'x', across both 'none' (itself only); pieces elsewhere are another's images (None)"""
    x0, y0 = p.min(0)
    x1, y1 = p.max(0)
    if x0 < -1 < 1 < x1 and y0 < -1 < 1 < y1:
        return "none"
    if x0 >= -1 and y0 >= -1:
        return "xy"
    if x0 < -1 < 1 < x1 and y0 >= -1:
        return "y"
    if y0 < -1 < 1 < y1 and x0 >= -1:
        return "x"
    return None


def regions(name, **select):
    """A mesh's regions: each outer loop with its holes (each hole the smallest outer's round it), the kept ones
    (anticlockwise outers, clockwise holes)"""
    ls = loops(*load(name, **select))
    outer = [l for l in ls if area(l) < 0]  # (the exports' faces wind clockwise seen from above)
    holes = [l for l in ls if area(l) > 0]
    owner = {}
    for k, h in enumerate(holes):
        round_it = [i for i, o in enumerate(outer) if inside(h[0], o)]
        if round_it:
            owner[k] = min(round_it, key=lambda i: -area(outer[i]))
    out = []
    for i, o in enumerate(outer):
        mirror = kept(o)
        if mirror is None:
            continue
        out.append((mirror, o[::-1], [holes[k] for k, j in owner.items() if j == i]))
    return out


def centrelines(name):
    """The painted strips' centrelines: each strip's triangles form a path (or a cycle) in the dual graph; the midpoints
    of the interior edges it crosses lie on the centreline and the end caps' midpoints end it. Width: twice the
    boundary vertices' median distance to it"""
    pts, tris = load(name)
    edge_tris = defaultdict(list)
    for ti, t in enumerate(tris):
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            edge_tris[(min(a, b), max(a, b))].append(ti)
    adj = defaultdict(list)
    for e, ts in edge_tris.items():
        if len(ts) == 2:
            adj[ts[0]].append((ts[1], e))
            adj[ts[1]].append((ts[0], e))
    mid = lambda e: (pts[e[0]] + pts[e[1]]) / 2  # noqa: E731
    seen, out = set(), []
    for start in range(len(tris)):
        if start in seen:
            continue
        comp, queue = [start], [start]
        seen.add(start)
        while queue:
            a = queue.pop()
            for b, _ in adj[a]:
                if b not in seen:
                    seen.add(b)
                    comp.append(b)
                    queue.append(b)
        assert max(len(adj[t]) for t in comp) <= 2, f"{name}: a branching strip"
        ends = [t for t in comp if len(adj[t]) <= 1]
        s = ends[0] if ends else comp[0]
        path, prev, cur, crossed = [s], None, s, []
        while len(path) <= len(comp):
            nxt = [(b, e) for b, e in adj[cur] if b != prev]
            if not nxt:
                break
            b, e = nxt[0]
            crossed.append(e)
            if b == s:
                break
            prev, cur = cur, b
            path.append(cur)
        line = [mid(e) for e in crossed]
        if ends:

            def cap(ti):
                t = tris[ti]
                edges = [(min(a, b), max(a, b)) for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0]))]
                edges = [e for e in edges if len(edge_tris[e]) == 1]
                return min(edges, key=lambda e: np.hypot(*(pts[e[0]] - pts[e[1]])))

            line = [mid(cap(path[0]))] + line + [mid(cap(path[-1]))]
        p = np.array(line)
        vs = pts[sorted({i for t in comp for i in tris[t]})]
        a, d = p[:-1], p[1:] - p[:-1]
        l2 = np.maximum((d**2).sum(1), 1e-9)

        def dist(q):
            t = np.clip(((q - a) * d).sum(1) / l2, 0, 1)
            return np.min(np.hypot(*(a + d * t[:, None] - q).T))

        width = 2 * float(np.median([dist(q) for q in vs]))
        p = simplify(p, LINE_TOL)
        if kept(p) == "xy":
            out.append((width, p))
    return out


def frame_stripes(path=None):
    """FrameTexture_PACK's stripes (H-4: E = sat(8 (B_lin - 0.125)) emissive, D = sat(8 (R_lin - 0.49)) the team colour
    lit), measured on the local texture when run (the texture's data stays out of the repo: RV-99): each connected
    region where its mask passes 0.5, of 500 texels or more, as (kind, u from, u to, v from, v to) in its UV space,
    repeating each tile; E's then D's, each by u then v"""
    from PIL import Image
    from scipy import ndimage

    path = path or f"{MESHES}/textures/FutureTech_Textures_FrameTexture_PACK.png"
    srgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    h, w = linear.shape[:2]
    out = []
    for kind, channel, threshold in (("E", 2, 0.125), ("D", 0, 0.49)):
        labels, _ = ndimage.label(linear[:, :, channel] > threshold + 1 / 16)
        found = [
            (kind, cols.start / w, cols.stop / w, rows.start / h, rows.stop / h)
            for k, (rows, cols) in enumerate(ndimage.find_objects(labels))
            if (labels[rows, cols] == k + 1).sum() >= 500
        ]
        out += sorted(found, key=lambda s: (s[1], s[3]))
    return out


def frame_lines(name, zmin=-1e9, zmax=1e9, group=None):
    """Where a Frame_01_V2 mesh's faces facing up carry the texture's stripes: each stripe's centre line (the iso-line of
    its middle u on the mesh, clipped to its v range) chained into polylines, with the stripe's width in uu (its u span
    over the mesh's u gradient). Returns (kind, width, points, mirror) for the kept pieces"""
    (path,) = glob.glob(f"{MESHES}/*/{name}.obj")
    v, vt, faces, g = [], [], [], ""
    for line in open(path):
        if line.startswith("v "):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            vt.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("g "):
            g = line.split()[1]
        elif line.startswith("f ") and (group is None or group in g):
            t = [q.split("/") for q in line.split()[1:]]
            faces.append(([int(a[0]) - 1 for a in t], [int(a[1]) - 1 for a in t]))
    v, vt = np.array(v), np.array(vt)
    out = []
    for kind, u0, u1, v0, v1 in frame_stripes():
        level, span = (u0 + u1) / 2, u1 - u0
        segments = []
        for fi, ti in faces:
            for k in range(1, len(fi) - 1):
                P = v[[fi[0], fi[k], fi[k + 1]]]
                T = vt[[ti[0], ti[k], ti[k + 1]]]
                if P[:, 2].min() < zmin or P[:, 2].max() > zmax:
                    continue
                n = np.cross(P[1] - P[0], P[2] - P[0])
                if np.linalg.norm(n) < 1e-9 or abs(n[2]) / np.linalg.norm(n) < 0.7:  # (facing up: the exports wind clockwise)
                    continue
                # (the texture's v is flipped against the image rows: UV v up)
                us, vs = T[:, 0], T[:, 1]
                e1, e2 = P[1] - P[0], P[2] - P[0]
                gram = np.array([[e1 @ e1, e1 @ e2], [e1 @ e2, e2 @ e2]])
                if abs(np.linalg.det(gram)) < 1e-12:
                    continue
                a, b = np.linalg.solve(gram, [us[1] - us[0], us[2] - us[0]])
                grad = np.linalg.norm(a * e1 + b * e2)
                if grad < 1e-9:
                    continue
                for tile in range(int(np.floor(us.min() - level)), int(np.ceil(us.max() - level)) + 1):
                    at = tile + level
                    cross_pts = []
                    for i, j in ((0, 1), (1, 2), (2, 0)):
                        di, dj = us[i] - at, us[j] - at
                        if (di < 0) != (dj < 0) and di != dj:
                            t = di / (di - dj)
                            cross_pts.append((P[i] + t * (P[j] - P[i]), vs[i] + t * (vs[j] - vs[i])))
                    if len(cross_pts) != 2:
                        continue
                    (pa, va), (pb, vb) = cross_pts
                    # clipped to the stripe's v range (in each tile of v)
                    lo, hi = min(va, vb), max(va, vb)
                    for vtile in range(int(np.floor(lo)) - 1, int(np.ceil(hi)) + 1):
                        c0, c1 = max(lo, vtile + v0), min(hi, vtile + v1)
                        if c1 <= c0 and not (hi == lo and vtile + v0 <= lo <= vtile + v1):
                            continue
                        f0 = 0.0 if hi == lo else (c0 - va) / (vb - va)
                        f1 = 1.0 if hi == lo else (c1 - va) / (vb - va)
                        f0, f1 = sorted((min(max(f0, 0), 1), min(max(f1, 0), 1)))
                        if f1 - f0 < 1e-6:
                            continue
                        segments.append((pa + f0 * (pb - pa), pa + f1 * (pb - pa), span / grad))
        # chain the segments by their ends (0.05 uu)
        key = lambda p: (round(p[0] * 20), round(p[1] * 20))  # noqa: E731
        ends = defaultdict(list)
        for s, (a, b, w) in enumerate(segments):
            ends[key(a)].append(s)
            ends[key(b)].append(s)
        used = set()
        for s0 in range(len(segments)):
            if s0 in used:
                continue
            used.add(s0)
            a, b, w = segments[s0]
            chain, widths = [a[:2], b[:2]], [w]
            for direction in (1, -1):
                tip = chain[-1] if direction == 1 else chain[0]
                while True:
                    nxt = [s for s in ends[key(tip)] if s not in used]
                    if not nxt:
                        break
                    s = nxt[0]
                    used.add(s)
                    sa, sb, sw = segments[s]
                    tip = sb[:2] if key(sa) == key(tip) else sa[:2]
                    widths.append(sw)
                    if direction == 1:
                        chain.append(tip)
                    else:
                        chain.insert(0, tip)
            pts = simplify(np.array(chain), 0.5)
            length = float(np.sum(np.hypot(*np.diff(pts, axis=0).T)))
            mirror = kept(pts)
            if mirror is None or length < 8:
                continue
            out.append((kind, float(np.median(widths)), pts, mirror))
    return out


def simplify3(p, tol):
    """Douglas-Peucker in 3D"""
    if len(p) < 3:
        return p
    a, b = p[0], p[-1]
    d = b - a
    length = np.linalg.norm(d)
    q = p - a
    dist = np.linalg.norm(np.cross(q, d), axis=1) / length if length > 1e-9 else np.linalg.norm(q, axis=1)
    i = int(np.argmax(dist))
    if dist[i] > tol:
        return np.vstack([simplify3(p[: i + 1], tol)[:-1], simplify3(p[i:], tol)])
    return np.array([a, b])


def glow_ribbons(name, group_has):
    """A glow mesh's ribbons (TrimLight_Glow: alpha 0.5 u^4, u = 1 at the edge it's attached to, 0 at its free edge):
    each piece's boundary edges where u is 1 chained into its attached edges, where u is 0 into its free edges, each
    attached edge paired with the nearest free edge of the same connected piece (the same way round: across pieces the
    stepped top's paired with the field-side ring, RV-108), both simplified in 3D"""
    (path,) = glob.glob(f"{MESHES}/*/{name}.obj")
    v, vt, faces, g = [], [], [], ""
    for line in open(path):
        if line.startswith("v "):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            vt.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("g "):
            g = line.split()[1]
        elif line.startswith("f ") and group_has in g:
            t = [q.split("/") for q in line.split()[1:]]
            faces.append(([int(a[0]) - 1 for a in t], [int(a[1]) - 1 for a in t]))
    v, vt = np.array(v), np.array(vt)
    key = lambda i: tuple(np.round(v[i] * 10).astype(int))  # noqa: E731
    count, uv_at, owner = defaultdict(int), {}, {}
    for fi, ti in faces:
        for (a, ta), (b, tb) in zip(zip(fi, ti), list(zip(fi, ti))[1:] + [(fi[0], ti[0])]):
            e = tuple(sorted((key(a), key(b))))
            count[e] += 1
            uv_at[(e, key(a))] = vt[ta][0]
            uv_at[(e, key(b))] = vt[tb][0]
            owner[e] = (a, b)
    pos = {}
    for fi, _ in faces:
        for i in fi:
            pos[key(i)] = v[i]
    # The connected pieces: faces joined by their shared vertices (union-find)
    parent = {}

    def find(k):
        while parent.setdefault(k, k) != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for fi, _ in faces:
        first = find(key(fi[0]))
        for i in fi[1:]:
            other = find(key(i))
            if other != first:
                parent[other] = first
    kinds = {"attached": [], "free": []}
    for e, c in count.items():
        if c != 1:
            continue
        u0, u1 = uv_at[(e, e[0])], uv_at[(e, e[1])]
        if u0 > 0.9 and u1 > 0.9:
            kinds["attached"].append(e)
        elif u0 < 0.1 and u1 < 0.1:
            kinds["free"].append(e)

    def chains(edges):
        nbr = defaultdict(list)
        for a, b in edges:
            nbr[a].append(b)
            nbr[b].append(a)
        seen, out = set(), []
        for start in nbr:
            if start in seen or len(nbr[start]) == 2:
                continue
            chain, prev, cur = [start], None, start
            seen.add(start)
            while True:
                nxt = [n for n in nbr[cur] if n != prev and n not in seen]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                seen.add(cur)
                chain.append(cur)
            out.append((find(chain[0]), np.array([pos[k] for k in chain])))
        # (closed loops: no ends)
        for start in nbr:
            if start in seen:
                continue
            chain, prev, cur = [start], None, start
            seen.add(start)
            while True:
                nxt = [n for n in nbr[cur] if n != prev and n not in seen]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                seen.add(cur)
                chain.append(cur)
            chain.append(start)
            out.append((find(chain[0]), np.array([pos[k] for k in chain])))
        return out

    attached, free = chains(kinds["attached"]), chains(kinds["free"])
    segments = defaultdict(list)
    for piece, f in free:
        segments[piece] += [(f[i], f[i + 1]) for i in range(len(f) - 1)]

    def nearest_free(p, piece):
        best, at = np.inf, p
        for a, b in segments[piece]:
            d = b - a
            t = np.clip(np.dot(p - a, d) / max(np.dot(d, d), 1e-12), 0, 1)
            q = a + t * d
            dist = np.linalg.norm(q - p)
            if dist < best:
                best, at = dist, q
        return at, best

    # each attached edge simplified, its free side the nearest point on any free edge from each of its points
    ribbons = []
    for piece, a in attached:
        pts = simplify3(a, 1.0)
        across = [nearest_free(p, piece) for p in pts]
        ribbons.append((pts, np.array([q for q, _ in across]), float(np.median([d for _, d in across]))))
    return ribbons


def light_tables():
    """Each floor piece's baked light: a profile along one axis (bins of equal size, contiguous) or its mean"""
    stats = json.load(open(LIGHTMAPS))
    profiles, meshes, regions = stats["profiles"], stats["per_mesh"], stats["hex_regions"]

    def profile(key, axis):
        rows = profiles[key]
        bin_size = rows[0][1] - rows[0][0]
        start = rows[0][0]
        count = round((rows[-1][1] - start) / bin_size)
        known = {round((r[0] - start) / bin_size): np.array(r[2]) for r in rows}
        # (an empty bin, where the piece isn't (the halfway strip under the centre disc): its neighbours' mean)
        rgb = []
        for i in range(count):
            if i in known:
                rgb.append(known[i])
                continue
            lo = max(k for k in known if k < i)
            hi = min(k for k in known if k > i)
            rgb.append(known[lo] + (known[hi] - known[lo]) * (i - lo) / (hi - lo))
        return {"axis": axis, "start": start, "bin": bin_size, "rgb": [list(c) for c in rgb]}

    def mean(rgb):
        return {"axis": None, "start": 0, "bin": 1, "rgb": [rgb]}

    return {
        "hexSide": profile("hex_side_strips||y|", "|y|"),
        "hexPads": mean(regions["hex_end_zones(|x|<3072)"][:3]),
        "disc": mean(meshes["Field_Center"]["sections"]["Reflective_Floor_V2_Mat"]["mean_up"]),
        "goalEnd": profile("Goal_STD_Floor|x(V2)", "x"),
        "goalMouth": profile("Goal_STD_Floor||y|(B)", "|y|"),
        "centreStrip": profile("Field_CenterField|y|", "|y|"),
        "halfway": profile("Field_Mid_A|x", "x"),
        "trim": profile("Field_STD_Trim||y|", "|y|"),
        "trimB": profile("Field_STD_TrimB||y|", "|y|"),
        "centreTrim": mean(meshes["Field_Center_Trim"]["sections"]["Frame_01_V2_Mat"]["mean_up"]),
    }


def side_glass():
    """The glass panel beside the +y goal's mouth (Goal_STD_Glass[0], y 5124, x > 900): its outline in (x, z)"""
    (path,) = glob.glob(f"{MESHES}/*/Goal_STD_Glass.obj")
    v, tris, g = [], [], ""
    for line in open(path):
        if line.startswith("v "):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("g "):
            g = line.split()[1]
        elif line.startswith("f ") and "HexGlass" in g:
            p = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
            tris += [(p[0], p[k], p[k + 1]) for k in range(1, len(p) - 1)]
    v = np.array(v)
    tris = [t for t in tris if all(abs(v[i, 1] - 5124) < 6 and v[i, 0] > 900 for i in t)]
    plane = np.c_[v[:, 0], v[:, 2], v[:, 1]]  # (x, z) as the plan's (x, y)
    key, ids = {}, []
    for x, z in plane[:, :2]:
        ids.append(key.setdefault((round(x * 20), round(z * 20)), len(key)))
    pts = np.zeros((len(key), 2))
    for i, k in enumerate(ids):
        pts[k] = plane[i, :2]
    tris = [tuple(ids[i] for i in t) for t in tris]
    (outline,) = [l for l in loops(pts, tris)][:1]
    return [[round(float(x), 1), round(float(z), 1)] for x, z in outline[:-1]]


def region_json(rs):
    out = []
    for mirror, o, hs in rs:
        r = {"mirror": mirror, "outline": [round(float(c) * 2) / 2 for c in o.flatten()]}
        if hs:
            r["holes"] = [[round(float(c) * 2) / 2 for c in h.flatten()] for h in hs]
        out.append(r)
    return out


def main():
    grass = regions("Field_STD_Floor_Team2")
    hex_all = regions("Field_STD_Floor_Hex")
    hex_side = [r for r in hex_all if r[1][:, 0].min() >= 3000]
    hex_pads = [r for r in hex_all if r[1][:, 0].min() < 3000]
    goal_ends = regions("Goal_STD_Floor", group="Reflective_Floor_V2")
    goal_mouths = regions("Goal_STD_Floor", group="Reflective_Floor_B")
    centre_strip = regions("Field_CenterField_Team2")
    halfway = regions("Field_Mid_A", zmax=1)
    centre = regions("Field_Center")
    # (the trim's raised top, z 1: a band round the disc, bent in over the strips' ends, and a ring round the vent)
    trim = regions("Field_Center_Trim", zmin=0.5, group="Frame_01_V2")
    # the goal glows (Goal_STD_Glow, TrimLight_Glow_Team2_MIC: the +y goal's; the -y goal's its mirror)
    goal_glow = glow_ribbons("Goal_STD_Glow", "_0_0_")
    marking_groups = {name: centrelines(name) for name in ("Goal_Lines", "Field_Side_Lines", "Field_Center_Lines")}
    # the frame pieces' stripes, each with its mesh's baked light: the field's edge trim (the glowing lines round the
    # panels), the centre's trim, the centre-field strips and the halfway strip (Field_STD_TrimB has none)
    frame = [
        ("trim", frame_lines("Field_STD_Trim", zmax=2)),
        ("centreTrim", frame_lines("Field_Center_Trim", zmin=0.5, group="Frame_01_V2")),
        ("centreStrip", frame_lines("Field_CenterField_Team2", zmax=1)),
        ("halfway", frame_lines("Field_Mid_A", zmax=1)),
    ]
    marking = lambda w, p: [round(float(w), 1)] + [round(float(c) * 2) / 2 for c in p.flatten()]  # noqa: E731
    plan = {
        "grass": region_json(grass),
        # (the traced grass has the seams' gaps: the floor under it shows there)
        "seams": [],
        "hexSide": region_json(hex_side),
        "hexPads": region_json(hex_pads),
        "goalEnds": region_json(goal_ends),
        "goalMouths": region_json(goal_mouths),
        "centreDisc": region_json(centre),
        "centreTrim": region_json(trim),
        "centreStrips": region_json(centre_strip),
        "halfway": region_json(halfway),
        "frameLines": [
            {"kind": k, "piece": piece, "mirror": m, "width": round(w, 1), "points": [round(float(c) * 2) / 2 for c in p.flatten()]}
            for piece, ls in frame
            for k, w, p, m in ls
        ],
        "markings": {
            group: [marking(w, p) for w, p in marking_groups[name]]
            for group, name in (("goal", "Goal_Lines"), ("side", "Field_Side_Lines"), ("centre", "Field_Center_Lines"))
        },
        "goalGlow": [
            {"attached": [round(float(c), 1) for c in a.flatten()], "free": [round(float(c), 1) for c in f.flatten()]}
            for a, f, _ in goal_glow
        ],
        "goalSideGlass": side_glass(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(plan, f)
    print(f"{OUT}: {len(grass)} grass, {len(hex_side)}+{len(hex_pads)}+{len(goal_ends)}+{len(goal_mouths)} panel, {len(centre_strip) + len(halfway)} strip, {len(centre)} disc, {len(trim)} trim regions, {sum(len(v) for v in marking_groups.values())} markings, {len(goal_glow)} glow ribbons, side glass {len(plan['goalSideGlass'])} points")


if LIGHT_ONLY:
    for piece, v in light_tables().items():
        axis = "null" if v["axis"] is None else '"' + v["axis"] + '"'
        rgb = ", ".join("[" + ", ".join(f"{c:.4g}" for c in c3) + "]" for c3 in v["rgb"])
        print(f"  {piece}: {{ axis: {axis}, start: {v['start']:g}, bin: {v['bin']:g}, rgb: [{rgb}] }},")
else:
    main()
