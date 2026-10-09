"""Derive cage_topology.json: the game's force-field cage (Stadium_P FFCage_Full beams) as a lattice on our own arena
surface: its graph (nodes, edges as node chains, cells with their sides and region) and, per node, a lattice address
(row and step along our contour, a ceiling column and row, a goal-mouth cut, or free); plus the few layout rules
(cage_layout.py lays it out). Only indices, counts and a handful of rule parameters are written: no coordinates.

LOCAL ONLY: reads the game's lattice as extracted by the static session (out/bsim/assets_local/cage/cage_lattice.json,
written by out/bsim/work/cage/extract_cage.py from the decrypted level). Node order is that file's, so cage_layout.py
--compare can measure the layout against it.

Usage: cage_topology_derive.py [LOCAL_cage_lattice.json] [OUT.json] [--no-marks]
  The half-period marks (fractions of the corner's and the back wall's length at every 3 steps, measured on the
  game's rows; per row class round the corner, one list along the back walls) are written by default: they cut the
  back walls' error from ~19 to ~4 uu (median) and the corners' from ~25 to ~11. --no-marks: even steps instead.
"""
import collections
import json
import os
import sys

import numpy as np

import cage_layout as cl

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = os.path.join(REPO, "out/bsim/assets_local/cage/cage_lattice.json")

# Layout rules (uu; see cage_layout.py): the cage is our surface pushed `offset` outward; wall rows every `row_height`
# up the wall (rows 1..wall_rows, the last where the fillet starts), every `row_arc` of arc on the fillet, and the
# last (ceiling_row) on the ceiling `edge_row_inside` inside its edge; side_steps steps along the side straight;
# ceiling columns col_step apart (col_shift_range shifted col_shift, the last on the ceiling row); the back seam's
# ceiling rows seam_rows inside the ceiling's edge; the goal mouth's cut.
PARAMS = {
    "offset": 16.0,
    "row_height": 256.0,
    "wall_rows": 6,
    "row_arc": 256.0,
    "side_steps": 24,
    "col_step": 216.0,
    "col_shift": 11.0,
    "col_shift_range": [1, 8],
    "ceiling_row": 10,
    "edge_row_inside": 168.0,
    "seam_rows": [917.0, 767.0, 548.0, 381.0],
    "goal_cut": {"z": 704.0, "x": 1137.7},
    "relax_iterations": 400,
}
ROW_Z = {1: 256, 2: 512, 3: 768, 4: 1024, 5: 1280, 6: 1539, 7: 1786, 8: 1973, 9: 2057}


def add_marks(S, prm, rows, N, addr, s_of):
    """The half-period marks: the fraction of a region's length (along the row's own curve) at every 3 steps, measured
    on the game's rows. Round the corner per row class (rows 1-7; 8; 9; 10: the corner pentagons change the count);
    along the back wall one list for every row (the rows agree to 0.002)."""
    def fractions(r, reg):
        row = rows[r]
        L = S.row_length(r)
        l_side, l_back, l_end = (np.interp(x, S.s, L) for x in (S.s_side, S.s_back, S.s_end))
        pts = sorted((a[2], float(np.interp(s_of(N[i]), S.s, L))) for i, a in enumerate(addr)
                     if a and a[0] == "wall" and a[1] == r and N[i, 0] >= 0 and N[i, 1] >= 0)
        k0, k1, l0, l1 = ((prm["side_steps"], row["k_back"], l_side, l_back) if reg == "corner"
                          else (row["k_back"], row["k_end"], l_back, l_end))
        ks = np.array([p[0] for p in pts] + ([k1] if reg == "back" else []))
        ls = np.array([p[1] for p in pts] + ([l_end] if reg == "back" else []))
        marks = [min(k0 + 3 * j, k1) for j in range((k1 - k0 + 2) // 3 + 1)]
        return [(np.interp(m, ks, ls) - l0) / (l1 - l0) for m in marks]

    def mean(lists):
        n = min(len(f) for f in lists)
        out = [round(float(np.mean([f[j] for f in lists])), 4) for j in range(n)]
        out[0], out[-1] = 0.0, 1.0                    # (the region's ends, by definition)
        return out
    prm["back_marks"] = mean([fractions(r, "back") for r in rows if r >= 3])
    for cls in ((1, 2, 3, 4, 5, 6, 7), (8,), (9,), (10,)):
        cm = mean([fractions(r, "corner") for r in cls if r >= 3 or len(cls) == 1])
        for r in cls:
            rows[r]["corner_marks"] = cm
    print("back marks", prm["back_marks"], "corner marks", {r: rows[r]["corner_marks"] for r in (3, 8, 9, 10)})


def main():
    src = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else SRC
    out = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else os.path.join(HERE, "cage_topology.json")
    g = json.load(open(src))
    N = np.array(g["nodes"])
    deg = np.array(g["node_degree"])
    n = len(N)
    prm = dict(PARAMS)
    S = cl.Surface(prm)
    adj = collections.defaultdict(set)
    for e in g["edges"]:
        for a, b in zip(e["nodes"], e["nodes"][1:]):
            adj[a].add(b)
            adj[b].add(a)

    # s along our contour (quadrant-local) of each node: the nearest contour point (offset curves share normals)
    A, B = S.P[:-1], S.P[1:]
    AB = B - A
    L2 = np.maximum((AB * AB).sum(1), 1e-12)

    def s_of(p):
        q = np.abs(p[:2])
        t = np.clip(((q - A) * AB).sum(1) / L2, 0, 1)
        foot = A + AB * t[:, None]
        i = int(np.argmin(np.linalg.norm(foot - q, axis=1)))
        return S.s[i] + t[i] * (S.s[i + 1] - S.s[i])

    addr = [None] * n
    row_of = {}
    inset_ceiling_row = cl.ag.R_CEIL + prm["edge_row_inside"]
    for i, p in enumerate(N):
        if p[2] >= 2060:
            # the wall lattice's last row lies on the ceiling, edge_row_inside inside its edge
            q = np.abs(p[:2])
            t = np.clip(((q - A) * AB).sum(1) / L2, 0, 1)
            if np.min(np.linalg.norm(A + AB * t[:, None] - q, axis=1)) - inset_ceiling_row > -3 and \
                    np.min(np.linalg.norm(A + AB * t[:, None] - q, axis=1)) - inset_ceiling_row < 3:
                row_of[i] = prm["ceiling_row"]
            continue
        for r, z in ROW_Z.items():
            if abs(p[2] - z) < 4:
                row_of[i] = r
    # wall rows, per quadrant: sort by s, side straight k = s / STEP, then continue with the honeycomb's alternation
    # (a horizontal edge spans 2 steps, the gap to the next one 4)
    rows = {}
    cut_rows = []
    for r in sorted(list(ROW_Z) + [prm["ceiling_row"]], key=lambda r: (r == 1, r)):   # (the rim after row 2)
        for sx in (1, -1):
            for sy in (1, -1):
                ids = [i for i, rr in row_of.items() if rr == r and (N[i, 0] >= 0 if sx > 0 else N[i, 0] <= 0)
                       and (N[i, 1] >= 0 if sy > 0 else N[i, 1] <= 0)]
                ids.sort(key=lambda i: s_of(N[i]))
                ks = []
                for j, i in enumerate(ids):
                    s = s_of(N[i])
                    if s <= S.s_side + 1:
                        k = round(s / cl.STEP)
                        assert abs(s - k * cl.STEP) < 3, (r, s)
                    elif r == 1:                      # the rim: diagonals' lower ends only; one step from row 2's
                        (up,) = [j2 for j2 in adj[i] if row_of.get(j2) == 2]
                        k = addr[up][2] + (1 if s > s_of(N[up]) else -1)
                    else:
                        prev = ids[j - 1]
                        k = ks[-1] + (2 if i in adj[prev] else 4)
                        if deg[i] == 2 and abs(N[i, 0]) < 1:   # the back wall's middle splits an edge: half of it
                            k = ks[-1] + 1
                    ks.append(k)
                    if addr[i] is None:
                        addr[i] = ["wall", r, int(k)]
                if sx > 0 and sy > 0:
                    # the row's last node is on the back wall's middle (x = 0): k_end; k_back: the step nearest the
                    # back wall's start (s_back), as an integer the row's own count of steps over the corner
                    s_list = [s_of(N[i]) for i in ids]
                    # the back wall's middle (x = 0, mirror line) is the middle of the row's last edge (odd rows: a
                    # node there) or of its last gap (even rows: 2 steps past the last node)
                    x_last = abs(N[ids[-1], 0])
                    if x_last < 1:
                        k_end = ks[-1]
                    elif x_last < 2.5 * cl.STEP:
                        k_end = ks[-1] + 2
                    else:                            # cut by the goal mouth: the row's stretch is the full one's 2 up
                        cut_rows.append((r, ks, s_list))
                        continue
                    best = None
                    for kb in range(prm["side_steps"] + 1, k_end):
                        row = {"k_back": kb, "k_end": k_end}
                        err = max(abs(S.along(r, row, k) - s) for k, s in zip(ks, s_list))
                        if best is None or err < best[0]:
                            best = (err, kb)
                    rows[r] = {"k_back": best[1], "k_end": int(k_end)}
    for r, ks, s_list in cut_rows:            # rows below the mouth's cut: as the full row two up (same alternation)
        rows[r] = dict(rows[r + 2])
        err = max(abs(S.along(r, rows[r], k) - s) for k, s in zip(ks, s_list))
        print("row", r, "cut by the mouth: uses row", r + 2, "(max along error %.1f)" % err)
    if "--no-marks" not in sys.argv:           # the half-period marks (approved 2026-10-08)
        add_marks(S, prm, rows, N, addr, s_of)
    # ceiling: column and row
    cols = S.columns
    for i, p in enumerate(N):
        if p[2] < 2060:
            continue
        x, y = abs(p[0]), abs(p[1])
        c = int(np.argmin([abs(x - cx) for cx in cols]))
        k = round(y / cl.STEP)
        if addr[i] is not None:
            continue
        if abs(x - cols[c]) < 2 and abs(y - k * cl.STEP) < 2 and (k % 3 != 0 or k == 0):
            addr[i] = ["ceil", c, int(k)]
            continue
        for j, d in enumerate(prm["seam_rows"]):
            if abs(x - cols[c]) < 2 and abs(y - (cl.ag.BACK_Y - cl.ag.R_CEIL - d)) < 2:
                addr[i] = ["seam", c, j]
    # goal-mouth cuts: open ends off the rows; their beam runs from the neighbour (a wall node) one row down, one step
    for i in range(n):
        if addr[i] is not None or deg[i] != 1 or N[i, 2] >= 2060:
            continue
        (j,) = adj[i]
        if addr[j] is None or addr[j][0] != "wall":
            continue
        r, k = addr[j][1], addr[j][2]
        dk = 1 if s_of(N[i]) > s_of(N[j]) else -1
        addr[i] = ["clip", r, k, r - 1, k + dk]
    for i in range(n):
        if addr[i] is None:
            addr[i] = ["free"]
    kinds = collections.Counter(a[0] for a in addr)
    # the defects: 5- and 7-sided cells, with their region and the wall rows (or ceiling) they span
    defects = []
    for ci, c in enumerate(g["cells"]):
        if c["sides"] == 6:
            continue
        rs = sorted({addr[v][1] for v in c["nodes"] if addr[v][0] == "wall"})
        defects.append({"cell": ci, "sides": c["sides"], "region": c["piece"],
                        "wall_rows": rs, "on_ceiling": any(N[v, 2] >= 2060 for v in c["nodes"])})
    nodes = [{"q": [1 if N[i, 0] >= 0 else -1, 1 if N[i, 1] >= 0 else -1], "a": addr[i]} for i in range(n)]
    topo = {
        "about": "The game's force-field cage (Stadium_P FFCage_Full beams) as a lattice on our arena surface: nodes "
                 "with lattice addresses, edges as node chains (beams), cells (5-, 6-, 7-sided) with their region, and "
                 "the layout rules (scripts/cage_layout.py). Indices, counts and rule parameters only; derived by "
                 "scripts/cage_topology_derive.py.",
        "params": prm,
        "rows": {str(r): v for r, v in sorted(rows.items())},
        "nodes": nodes,
        "edges": [e["nodes"] for e in g["edges"]],
        "cells": [{"nodes": c["nodes"], "sides": c["sides"], "region": c["piece_main"],
                   "goal_surround": c["goal_surround"]} for c in g["cells"]],
        "defects": defects,
        "boundary": [h["nodes"] for h in g["holes"]],
    }
    with open(out, "w") as f:
        json.dump(topo, f, separators=(",", ":"))
    print("nodes", n, dict(kinds), "rows", rows, "->", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
