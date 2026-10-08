"""The arena's 16 pieces laid out as the game's: each piece's vertices, from our own rules (arena_gen.py), and its
triangles from a table of indices into them (arena_topology.json).

The game's soccar collision is 16 meshes (4 pieces, each placed in the four quadrants, mirrored), cooked by PhysX
into a triangle order of their own, and Bullet's contacts depend on that order where two triangles touch the same
body (which point a contact manifold keeps; validation finding 41). To be the game's to the triangle, a piece needs
the game's vertices, triangles and order. The vertices here come from rules and a few measured constants (no
coordinates from the game's meshes); the table holds only which of these vertices make each triangle, in the game's
order (derived from the game's meshes by arena_topology_derive.py, which needs the local extraction; the user agreed
to an order table of this kind, as for the diagonals).

Each pool is in the +x/+y quadrant's frame (the goal-and-back piece in its own frame: y from the goal line, the game's
actor space); quadrant(piece, q) mirrors it. The index of a vertex is its place in the pool.
"""
import math

import arena_gen as ag

QUADRANTS = {"px_py": (1, 1), "nx_py": (-1, 1), "px_ny": (1, -1), "nx_ny": (-1, -1)}
PIECES = ["corner", "side_floor", "side_ceiling", "goal_and_back"]

# --- the side halves (Field_STD_Collision_SideBot_Half / _SideTop_Half): the side wall's floor and ceiling fillets
# from y 0 to 3840 (the corner piece overlaps them from y 3326) ---
SIDE_COLUMNS_FLOOR = [0.0, 512.0, 1024.0, 1536.0, 2048.0, 2560.0, 3072.0, 3840.0]
SIDE_COLUMNS_CEILING = [0.0, 3840.0]
# The fillets' end segments run on past the planes they meet (the tangent vertex left out): measured on the game's
# mesh. Floor fillet: 128 along under the floor, to 10 behind the wall; ceiling fillet: to 11.333 behind the wall and
# above the ceiling
FLOOR_EXT_UNDER = 128.0
FLOOR_EXT_BEHIND_WALL = 10.0
CEIL_EXT_BEYOND = 11.333


def _on_line(a, b, axis, value):
    """The point on the line through profile points a and b (offset, z) where coordinate `axis` is `value`."""
    t = (value - a[axis]) / (b[axis] - a[axis])
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def side_floor_profile():
    """(offset from the wall, z): under the floor, the floor fillet's points but the last, behind the wall."""
    pts = ag.floor_profile(ag.R_SIDE_FLOOR)[1:-1]          # the 9 fillet points, floor tangent first
    d = math.dist(pts[0], pts[1])
    under = tuple(a + (a - b) / d * FLOOR_EXT_UNDER for a, b in zip(pts[0], pts[1]))
    return [under] + pts[:-1] + [_on_line(pts[-2], pts[-1], 0, -FLOOR_EXT_BEHIND_WALL)]


def side_ceiling_profile():
    """(offset from the wall, z): behind the wall, the ceiling fillet's points but the two tangents, above the ceiling."""
    pts = ag.ceil_profile()[1:-1]                          # the 9 fillet points, wall tangent first
    return ([_on_line(pts[1], pts[0], 0, -CEIL_EXT_BEYOND)] + pts[1:-1] +
            [_on_line(pts[-2], pts[-1], 1, ag.H + CEIL_EXT_BEYOND)])


# --- the corner (Field_STD_Collision_Corner): the corner wall swept along our stations (arena_gen.stations, from the
# side arc's first point to the back arc's last; the arcs' tangent stations left out), each station's profile the
# floor fillet (its 9 points), the wall at 512 ... 1536, the ceiling fillet's points 1-7 and an extension above the
# ceiling, offsets mitred (stations()["m"]); and a cut at each end, measured on the game's mesh: the pieces were cut by
# a vertical plane through a point behind the side / back wall (the first and last chords run on to it), the rings on
# the plane at a fixed ratio of the profile's offsets (start), the back wall's 160 fillet laid square (end floor)
CORNER_CEIL_EXT_Z = 2070.92
CORNER_START = ((4106.91, 3326.21), 166.414, 1.0366)       # cut station, ring direction (deg), offset ratio
CORNER_END = ((2434.60, 5125.33), -83.243, 1.0107)          # (its floor ring: square to the back wall, R_BACK_FLOOR)
CORNER_STATIONS = range(8, 27)                              # arena_gen.stations() indices: side arc k=1 .. back arc k=7


def _ceiling_ext(pts):
    """The ceiling fillet's last chord run on to CORNER_CEIL_EXT_Z: (offset, z)."""
    return _on_line(pts[-2], pts[-1], 1, CORNER_CEIL_EXT_Z)


def corner_profile(rf):
    """(offset, z) at a corner station: under the floor (as the side fillet's), the floor fillet, the wall, the ceiling
    fillet without its tangents, above the ceiling."""
    fp = ag.floor_profile(rf)
    cp = ag.ceil_profile()[1:-1]
    return ([fp[0]] + fp[1:-1] + [(0.0, z) for z in (512.0, 768.0, 1024.0, 1280.0, 1536.0) if z > rf] + cp[1:-1] +
            [_ceiling_ext(cp)])


def _corner_pool():
    S = ag.stations()
    P = []
    for i in CORNER_STATIONS:
        s = S[i]
        (px, py), (nx, ny), m = s["p"], s["n"], s["m"]
        prof = corner_profile(s["rf"])
        fp0 = ag.floor_profile(s["rf"])
        for k, (o, z) in enumerate(prof):
            if k == 0:   # under the floor: the mitred floor tangent plus the (unmitred) extension
                o = fp0[1][0] * m + (fp0[0][0] - fp0[1][0])
                P.append((px + nx * o, py + ny * o, z))
            else:
                P.append((px + nx * o * m, py + ny * o * m, z))
    # start cut: the corner profile on the cut plane, but its two lowest floor points (and the extension under the
    # floor) where the side wall's floor fillet meets the plane
    (cx, cy), ang, k0 = CORNER_START
    ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    side = ag.floor_profile(ag.R_SIDE_FLOOR)
    for j, (o, z) in enumerate(corner_profile(ag.R_SIDE_FLOOR)):
        if j <= 2:
            t = (cx - (ag.SIDE_X - side[j][0])) / -ux        # where the cut line reaches x = SIDE_X - o
            P.append((cx + ux * t, cy + uy * t, side[j][1]))
        else:
            P.append((cx + ux * o * k0, cy + uy * o * k0, z))
    # end cut: the back wall's floor fillet laid square to the back wall from the cut station, then the wall and the
    # ceiling fillet on the cut plane
    (ex, ey), ang, k1 = CORNER_END
    ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    for o, z in ag.floor_profile(ag.R_BACK_FLOOR):
        P.append((ex, ey - o, z))
    for z in (512.0, 768.0, 1024.0, 1280.0, 1536.0):
        P.append((ex, ey, z))
    cp = ag.ceil_profile()[1:-1]
    for o, z in cp[1:-1] + [_ceiling_ext(cp)]:
        P.append((ex + ux * o * k1, ey + uy * o * k1, z))
    return P


# --- the goal and the back wall (Goal_STD_Collision_Half): in its own frame (y from the goal line, + into the goal;
# placed at y +-5120 by the body: GOAL_BODY_OFFSET). Our goal and back-wall geometry (arena_gen) plus the columns the
# game adds: its back wall above the mouth, its ceiling fillet and the goal's inside are laid on a 256 grid in x
GOAL_BODY_OFFSET = ag.BACK_Y                               # uu, +y for the halves at +y (the game's actor translation)
GOAL_GRID = [0.0, 256.0, 512.0, 768.0, 1024.0, 1280.0, 1536.0, 1792.0, 2048.0, 2304.0, 2688.0]
GOAL_CEIL_EXT_Z = 2075.45


GOAL_SKIRT_CHORDS = 5.15 / 1.95   # the goal piece's fillets run on under the floor this many first chords (to
                                  # z = -5.15 R / 96: measured on the game's mesh)


def _old_goal_vertices():
    """The vertices of our own goal-and-back piece (arena_gen's construction), in the goal's frame, and its skirt: each
    floor fillet's first chord run on under the floor."""
    pieces = dict(ag.build_old())
    m = pieces["goal_and_back_px_py"]
    V = [(x, y - GOAL_BODY_OFFSET, z) for (x, y, z) in m.verts]
    skirt = []
    for t in m.tris:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0]), (t[1], t[0]), (t[2], t[1]), (t[0], t[2])):
            pa, pb = V[a], V[b]
            if abs(pa[2]) < 1e-6 and 0.5 < pb[2] < 3.5 and math.dist(pa, pb) < 40:
                skirt.append(tuple(u + (u - w) * GOAL_SKIRT_CHORDS for u, w in zip(pa, pb)))
    return V + skirt


def _goal_pool():
    P = []
    cells = {}

    def add(p):
        """p, unless a vertex is already within 0.05 of it (the same vertex of two constructions)"""
        c = tuple(int(math.floor(v / 1.0)) for v in p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q in cells.get((c[0] + dx, c[1] + dy, c[2] + dz), ()):
                        if math.dist(p, q) < 0.05:
                            return
        cells.setdefault(c, []).append(p)
        P.append(p)
    for p in _old_goal_vertices():
        add(p)
    # the goal's inside: its cross-section (y, z) at x = 0 repeated at the grid columns inside the goal
    section = [(y, z) for (x, y, z) in P if abs(x) < 0.01 and y > 0.01]
    for x in (256.0, 512.0):
        for y, z in section:
            add((x, y, z))
    # the back wall over the mouth (y = 0) and its ceiling fillet (y < 0), on the grid
    rows = sorted({z for (x, y, z) in P if abs(y) < 0.01 and z > ag.GOAL_TOP + ag.CHAMFER - 0.5})
    cp = ag.ceil_profile()[1:-1]
    for x in GOAL_GRID:
        for z in rows:
            add((x, 0.0, z))
        for o, z in cp[1:-1]:
            add((x, -o, z))
        o, z = _on_line(cp[-2], cp[-1], 1, GOAL_CEIL_EXT_Z)
        add((x, -o, z))
    # the overlap end at x 2688: the wall and the back floor fillet's profile
    for o, z in ag.floor_profile(ag.R_BACK_FLOOR)[:-1]:
        add((2688.0, -o, z))
    for z in (512.0, 768.0, 1024.0, 1280.0, 1536.0):
        add((2688.0, 0.0, z))
    return P


def _side_pool(columns, profile):
    return [(ag.SIDE_X - o, y, z) for y in columns for (o, z) in profile]


def pool(piece):
    if piece == "side_floor":
        return _side_pool(SIDE_COLUMNS_FLOOR, side_floor_profile())
    if piece == "side_ceiling":
        return _side_pool(SIDE_COLUMNS_CEILING, side_ceiling_profile())
    if piece == "corner":
        return _corner_pool()
    if piece == "goal_and_back":
        return _goal_pool()
    raise NotImplementedError(piece)


def quadrant(piece, q):
    """The piece's pool placed in quadrant q (mirrored; the goal-and-back piece stays in its own frame, see
    GOAL_BODY_OFFSET)."""
    sx, sy = QUADRANTS[q]
    return [(x * sx, y * sy, z) for (x, y, z) in pool(piece)]
