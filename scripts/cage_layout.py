"""Lay the game's force-field cage lattice (scripts/cage_topology.json: topology and a few layout rules, no
coordinates) out on our own arena surface. Reference implementation for the client's beam renderer.

The surface: our arena's (arena_gen.py stations: the plan contour, the 512 ceiling fillet, the 2048 ceiling), offset
OFFSET uu outward, as the game's cage sits (its beams 16 uu outside the walls, fillet and ceiling).

Every node of the topology is one of
  wall  (r, k): row r, k steps along the contour from the side wall's middle (quadrant-local, then mirrored)
                - rows 1..6 at z = 256 r on the wall (row 6 where the fillet starts), rows 7..9 on the fillet every
                  row_arc of arc, row 10 (ceiling_row) on the ceiling, edge_row_inside inside its edge;
                - steps are STEP = 896/6 along the row's own curve (our contour offset by the row's inset): k 0..24
                  along the side straight (to its tangent point); beyond it the row's remaining steps share its curve
                  per region, k_side..k_back round the corner and k_back..k_end along the back wall to its middle
                  (rows[r]: the row's own counts, from the topology), piecewise even between the half-period marks:
                  the fraction of the region's length at every 3 steps (rows[r].corner_marks; params.back_marks,
                  shared by every row); without marks, evenly
  ceil  (c, n): x = column c (columns(): col_step apart, columns 1..8 shifted col_shift, the last on row 10's
                line), y = n * STEP, on the ceiling
  seam  (c, j): the back seam's rows on the ceiling: column c, seam_rows[j] inside the ceiling's edge over the back
  clip  (r, k, nr, nk): a beam end cut by the goal mouth (z goal_cut.z for |x| < goal_cut.x): from wall (r, k)
                towards wall (nr, nk), stopped at the cut
  free        : the corner fans (7 per quadrant): each the mean of its neighbours (the others held) in a flat chart
                of the surface, the ceiling as it is and the walls unrolled outward from the ceiling's edge (Chart)
Mirror: a node's q = (sx, sy) are its quadrant's signs; addresses are quadrant-local.

Usage: cage_layout.py [cage_topology.json] [--compare LOCAL_cage_lattice.json]
  prints the counts; with --compare, how far each region's nodes land from the game's (local data only)
"""
import json
import math
import os
import sys

import numpy as np

import arena_gen as ag

STEP = 896.0 / 6        # along: a third of a half period (half an edge's run); edges 2 STEP long, gaps 4 STEP


def quarter_contour(samples=96):
    """Our plan contour, quadrant x, y >= 0: the side wall's middle (4096, 0) round the corner to the back wall's middle
    (0, 5120), as a dense polyline with inward normals and the arc length s at each point. Also s at the side's
    tangent point and at the back wall's."""
    pts, nrm = [], []
    for y in np.linspace(0, ag.CORNER_SIDE[0][1], samples, endpoint=False):
        pts.append((ag.SIDE_X, y))
        nrm.append((-1.0, 0.0))
    d_side, d_diag, d_back = (0.0, 1.0), (-1 / math.sqrt(2), 1 / math.sqrt(2)), (-1.0, 0.0)
    for t in np.linspace(0, 1, samples, endpoint=False):
        p, n = ag.bezier(ag.CORNER_SIDE[0], d_side, ag.CORNER_SIDE[1], d_diag, ag.CORNER_ARM, t)
        pts.append(p)
        nrm.append(n)
    a, b = np.array(ag.CORNER_SIDE[1]), np.array(ag.CORNER_BACK[0])
    for t in np.linspace(0, 1, samples, endpoint=False):
        pts.append(tuple(a + (b - a) * t))
        nrm.append((-1 / math.sqrt(2), -1 / math.sqrt(2)))
    for t in np.linspace(0, 1, samples, endpoint=False):
        p, n = ag.bezier(ag.CORNER_BACK[0], d_diag, ag.CORNER_BACK[1], d_back, ag.CORNER_ARM, t)
        pts.append(p)
        nrm.append(n)
    for x in np.linspace(ag.CORNER_BACK[1][0], 0, samples + 1):
        pts.append((x, ag.BACK_Y))
        nrm.append((0.0, -1.0))
    P, Nn = np.array(pts), np.array(nrm)
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    s_side = s[samples]
    s_back = s[4 * samples]
    return P, Nn, s, s_side, s_back


def columns(p, n_cols=17):
    """The ceiling's columns (x, quadrant-local): col_step apart from the middle, columns in col_shift_range shifted
    col_shift, the last on the wall lattice's ceiling row (edge_row_inside inside the ceiling's edge)."""
    xs = []
    for c in range(n_cols):
        x = p["col_step"] * c
        if p["col_shift_range"][0] <= c <= p["col_shift_range"][1]:
            x += p["col_shift"]
        xs.append(x)
    xs[-1] = ag.SIDE_X - ag.R_CEIL - p["edge_row_inside"]
    return xs


class Surface:
    """Our arena surface offset outward: plan contour C(s) with inward normal n(s); the profile's rows."""

    def __init__(self, params):
        self.p = params
        self.P, self.N, self.s, self.s_side, self.s_back = quarter_contour()
        self.s_end = self.s[-1]
        self.R = ag.R_CEIL + params["offset"]          # the cage's fillet radius (about our fillet's centre)
        self.columns = columns(params)
        self._rl = {}

    def at(self, s):
        s = min(max(s, 0.0), self.s_end)
        i = min(np.searchsorted(self.s, s, side="right") - 1, len(self.s) - 2)
        f = (s - self.s[i]) / (self.s[i + 1] - self.s[i])
        p = self.P[i] + (self.P[i + 1] - self.P[i]) * f
        n = self.N[i] + (self.N[i + 1] - self.N[i]) * f
        return p, n / np.linalg.norm(n)

    def theta(self, r):
        """Row r's angle on the fillet (0 where it starts, at the wall's top), or None on the wall."""
        if r <= self.p["wall_rows"]:
            return None
        return (r - self.p["wall_rows"]) * self.p["row_arc"] / self.R

    def inset(self, r):
        """Row r's plan offset from our wall line, inward (negative: outside), and its height. Rows past the fillet's
        (the last, `ceiling_row`) lie on the ceiling, `edge_row_inside` inside its edge."""
        if r == self.p["ceiling_row"]:
            return ag.R_CEIL + self.p["edge_row_inside"], ag.H + self.p["offset"]
        th = self.theta(r)
        if th is None:
            return -self.p["offset"], self.p["row_height"] * r
        return ag.R_CEIL - self.R * math.cos(th), ag.H - ag.R_CEIL + self.R * math.sin(th)

    def wall_point(self, r, s):
        p, n = self.at(s)
        o, z = self.inset(r)
        q = p + n * o
        return np.array([q[0], q[1], z])

    def row_length(self, r):
        """Arc length along row r's own curve (our contour offset by the row's inset), at each contour sample."""
        if r not in self._rl:
            o, _ = self.inset(r)
            Q = self.P + self.N * o
            self._rl[r] = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]
        return self._rl[r]

    def along(self, r, row, k):
        """Contour s of node k of wall row r (quadrant-local). Steps are measured along the row's own curve: the
        side straight k * STEP; beyond it the row's steps share its curve per region (by the half-period marks, or
        evenly): k_side..k_back round the corner (to the back wall's start), k_back..k_end along the back wall to its
        middle; k_back and k_end are the row's own counts (topology)."""
        L = self.row_length(r)
        k_side = self.p["side_steps"]
        l_side, l_back, l_end = (np.interp(x, self.s, L) for x in (self.s_side, self.s_back, self.s_end))
        if k <= k_side:
            return float(np.interp(k * STEP, L, self.s))
        if k <= row["k_back"]:
            f = self._region(k - k_side, row["k_back"] - k_side, row.get("corner_marks"))
            l = l_side + f * (l_back - l_side)
        else:
            f = self._region(k - row["k_back"], row["k_end"] - row["k_back"], self.p.get("back_marks"))
            l = l_back + f * (l_end - l_back)
        return float(np.interp(l, L, self.s))

    @staticmethod
    def _region(dk, steps, marks):
        """Fraction of a region's length at dk of its steps: even, or (optional marks: the fraction at every half
        period, 3 steps) piecewise even between the marks."""
        if not marks:
            return dk / steps
        ks = [min(3 * j, steps) for j in range(len(marks))]
        return float(np.interp(dk, ks, marks))

    def ceil_point(self, c, n):
        return np.array([self.columns[c], n * STEP, ag.H + self.p["offset"]])

    def seam_point(self, c, j):
        """The back seam's rows: column c's x, `seam_rows[j]` inside the ceiling's edge over the back wall."""
        return np.array([self.columns[c], ag.BACK_Y - ag.R_CEIL - self.p["seam_rows"][j], ag.H + self.p["offset"]])


class Chart:
    """Flat chart: the ceiling as it is (plan); the walls unrolled outward from the ceiling's edge E(s) = C(s) + n(s)
    * R_CEIL, a point d down the profile (from the edge) at E(s) - n(s) d. Quadrant-local (x, y >= 0)."""

    def __init__(self, surf):
        self.S = surf
        self.E = surf.P + surf.N * ag.R_CEIL
        self.quarter_arc = surf.R * math.pi / 2

    def down(self, z_or_theta, on_fillet):
        """Profile distance from the ceiling's edge down to a point at fillet angle theta, or at height z on the wall."""
        if on_fillet:
            return self.S.R * (math.pi / 2 - z_or_theta)
        return self.quarter_arc + (ag.H - ag.R_CEIL - z_or_theta)

    def wall(self, s, d):
        p, n = self.S.at(s)
        return p + n * ag.R_CEIL - n * d

    def to_surface(self, q):
        """A chart point back on the surface: inside the ceiling's edge on the ceiling, outside it down the profile."""
        A, B = self.E[:-1], self.E[1:]
        AB = B - A
        t = np.clip(((q - A) * AB).sum(1) / np.maximum((AB * AB).sum(1), 1e-12), 0, 1)
        foot = A + AB * t[:, None]
        i = int(np.argmin(np.linalg.norm(foot - q, axis=1)))
        s = self.S.s[i] + t[i] * (self.S.s[i + 1] - self.S.s[i])
        p, n = self.S.at(s)
        d = float((foot[i] - q) @ n)
        if d <= 0:
            return np.array([q[0], q[1], ag.H + self.S.p["offset"]])
        if d < self.quarter_arc:
            th = math.pi / 2 - d / self.S.R
            o, z = ag.R_CEIL - self.S.R * math.cos(th), ag.H - ag.R_CEIL + self.S.R * math.sin(th)
        else:
            o, z = -self.S.p["offset"], ag.H - ag.R_CEIL - (d - self.quarter_arc)
        g = p + n * o
        return np.array([g[0], g[1], z])


def layout(topo):
    """Positions (game frame, all four quadrants) for every node of the topology."""
    prm = topo["params"]
    S = Surface(prm)
    C = Chart(S)
    rows = {int(r): v for r, v in topo["rows"].items()}
    n_nodes = len(topo["nodes"])
    chart = np.zeros((n_nodes, 2))          # signed (all quadrants)
    fixed = np.zeros(n_nodes, bool)
    pos3 = np.zeros((n_nodes, 3))
    sign = np.ones((n_nodes, 2))
    for i, nd in enumerate(topo["nodes"]):
        sign[i] = nd["q"]
        a = nd["a"]
        if a[0] == "wall":
            r, k = a[1], a[2]
            s = S.along(r, rows[r], k)
            pos3[i] = S.wall_point(r, s)
            if r == prm["ceiling_row"]:
                chart[i] = pos3[i][:2]
            else:
                th = S.theta(r)
                chart[i] = C.wall(s, C.down(th if th is not None else prm["row_height"] * r, th is not None))
        elif a[0] == "ceil":
            pos3[i] = S.ceil_point(a[1], a[2])
            chart[i] = pos3[i][:2]
        elif a[0] == "seam":
            pos3[i] = S.seam_point(a[1], a[2])
            chart[i] = pos3[i][:2]
        elif a[0] == "clip":
            r, k, nr, nk = a[1:5]
            p0 = S.wall_point(r, S.along(r, rows[r], k))
            p1 = S.wall_point(nr, S.along(nr, rows[nr], nk))
            cut = prm["goal_cut"]
            f = 1.0
            if p0[2] > cut["z"] > p1[2] and p1[0] < cut["x"]:
                f = min(f, (p0[2] - cut["z"]) / (p0[2] - p1[2]))
            if p0[0] > cut["x"] > p1[0]:
                f = min(f, (p0[0] - cut["x"]) / (p0[0] - p1[0]))
            pos3[i] = p0 + (p1 - p0) * f
            chart[i] = pos3[i][:2]
        else:
            continue
        fixed[i] = True
        chart[i] *= sign[i]
        pos3[i, :2] *= sign[i]
    adj = [[] for _ in range(n_nodes)]
    for e in topo["edges"]:
        for a, b in zip(e, e[1:]):
            adj[a].append(b)
            adj[b].append(a)
    free = [i for i in range(n_nodes) if not fixed[i]]
    for i in free:
        nb = [chart[j] for j in adj[i] if fixed[j]]
        chart[i] = np.mean(nb, axis=0) if nb else np.zeros(2)
    for _ in range(prm["relax_iterations"]):
        for i in free:
            chart[i] = np.mean([chart[j] for j in adj[i]], axis=0)
    for i in free:
        g = C.to_surface(np.abs(chart[i]))
        pos3[i] = [g[0] * np.sign(chart[i][0] or 1), g[1] * np.sign(chart[i][1] or 1), g[2]]
    return pos3


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else os.path.join(here, "cage_topology.json")
    topo = json.load(open(path))
    pos = layout(topo)
    print(len(pos), "nodes,", len(topo["edges"]), "edges,", len(topo["cells"]), "cells")
    if "--compare" in sys.argv:
        game = np.array(json.load(open(sys.argv[sys.argv.index("--compare") + 1]))["nodes"])
        if len(game) != len(pos):
            sys.exit("not the lattice this topology was derived from")
        err = np.linalg.norm(pos - game, axis=1)       # (the topology keeps the local file's node order)
        kinds = [nd["a"][0] for nd in topo["nodes"]]
        for kind in ("wall", "ceil", "seam", "clip", "free"):
            m = np.array([k == kind for k in kinds])
            if m.any():
                print("%-5s %4d nodes: median %6.1f  p90 %6.1f  max %6.1f uu" % (
                    kind, m.sum(), np.median(err[m]), np.percentile(err[m], 90), err[m].max()))


if __name__ == "__main__":
    main()
