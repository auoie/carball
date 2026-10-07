# Soccar arena measurements

Measured from the standard stadium's collision meshes (`Stadium_P.upk`, `FieldCollision_Standard.*`,
`CollisionMeshes.Plane32768`, `Goal_STD_Collision`) with `scripts/staticmesh.py`. Extracted meshes stay local in
`out/arena_local/` (git-ignored). **Build our own arena from these numbers; never ship Psyonix meshes.**

Our arena: `scripts/arena_gen.py` builds it from the numbers below (see [Generated arena](#generated-arena)).

Units uu. Field centre at origin, +Z up. All pieces are mirrored into the four quadrants by negative actor scale.

## Layout in the level
| Surface | Collision |
|---|---|
| Floor z = 0, ceiling z = 2048, side walls x = ±4096 | finite planes (`Plane32768`, `bSimpleCollisionPlane`) |
| Everything else: edge curves, corners, back walls, goals | one-sided triangle meshes |

There is **no back-wall plane**. The back walls (y = ±5120) are part of the goal and corner meshes.

## Edge curves
All are quarter circles tangent to both surfaces, 8 segments, with the end segments extended under or
behind the neighbouring plane so no mesh edge is exposed. (Earlier fits of 256.5 / 512.8 / 160.3 / 513
included those extension points; the true radii are round numbers.)

| Edge | Radius | Centre (+x / +y quadrant) |
|---|---|---|
| Side wall → floor | **256** | x 3840, z 256 |
| Side wall → ceiling | **512** | x 3584, z 1536 |
| Back wall → floor | **160**, narrowing to 96 near the posts (below) | y 4960, z 160 |
| Back wall → ceiling | **512** | y 4608, z 1536 |

- The back-wall floor curve narrows from 160 to 96 between |x| = 1344 and 960:
  `r = 96 + 64·smoothstep((|x| − 960) / 384)`. It is 96 from |x| 960 to the post at 904.
- **Tessellation (every 90° arc in the arena and the goal):** a cubic Bézier quarter circle with its control
  points at **0.5518 · r**, sampled at equal parameter steps t = i/8. Vertex angles 11.617°, 22.892°, 33.984°,
  45°, … (not 11.25° steps); vertex radii +0.015% / −0.027% off the circle. It fits every measured arc to 0.002 uu.
  The positions differ from uniform steps by < 0.1 uu, but the facet angles by up to 0.38°, and a car on a curve
  sits on the facets: with uniform steps, cars on the side curves were 0.17 uu off the replays after ~4 ticks
  (0.06 with the Bézier steps, as on the game's own mesh).

## Corners (plan view)
- 45° diagonal wall on **|x| + |y| = 8064**, from (3840.471, 4223.529) to (3200, 4864) in 4 equal segments.
- Joined to the side wall and to the back wall by **cubic Bézier arcs** (not circles), tangent to the wall and the
  diagonal, both control arms **245.85** long, sampled at t = i/8 (fit to 0.003 uu):
  - Side arc: from **(4096, 3584)** to (3840.471, 4223.529).
  - Back arc: from (3200, 4864) to **(2560, 5120)**.
  - The wall ends are 384 from the line intersections, the diagonal ends ~362. (The earlier circle model, r 874.04
    with tangent points 362.04 away, was within 1.4 uu but left cars in corners 0.42 uu off the replays; 0.09 now.)
  - In the game the first and last segments run on behind the wall planes (no vertex at the wall end).
- Wall vertical from the floor curve up to z 1536, then the 512 ceiling curve (constant all round).
- Floor curve: 256 along the side arc and the diagonal. Across the back arc it narrows to the back wall's 160:
  from the diagonal (t = 0) to the back wall (t = 1) the radius at t = i/8 is **256, 251.668, 240.628, 225.399,
  208.130, 190.816, 175.483, 164.355, 160** (read where each cross-section meets the vertical wall;
  `160 + 96·smoothstep` is within 0.5).

## Goal
Local coordinates of the +Y goal: x across, y = depth behind the goal line (world y = 5120 + y), z up.
The −Y goal is the same mesh rotated 180°. Every edge below is a quarter circle tessellated as above (Bézier, 8 steps per 90°).

**Mouth**
- Opening on the back-wall face (y = 0): x ±904, height 648, top corners rounded r 104 (centre x ±800, z 544).
- A 45° chamfer 8 uu deep runs all round the mouth to the inner outline at y = 8:
  **x ±896, crossbar underside z 640**, top corners r 96. (The earlier ≈893 / 642.8 readings were mid-chamfer.)
- Post base: the back wall's r-96 floor curve wraps round each post into the goal's side floor curve. It is the
  floor-curve profile revolved about the vertical axis (x ±904, y 8), radius 8 + profile offset, over 90°.

**Profile at the centre line (side view)**
| Piece | Shape |
|---|---|
| Floor | z = 0 (arena floor plane) to **y = 234.67**, then a straight ramp up to **z = 16 at y = 640** (≈2.3°) |
| Back | arc r **240**, centre (y 640, z 256): bottom quarter from (640, 16) to (880, 256); top part continues for 6 of the 8 quarter-circle steps, to 67.1° at (733.4, 477.1) |
| Back wall | furthest point **y = 880** (world 6000) at z = 256 |
| Roof | flat z = 640 from y = 8 to 224, then slopes down (≈17.7°, z = 640 − 0.32·(y − 224)) to meet the back arc |

**Side walls**: vertical at x = ±896 from y = 8 to 784.

**Fillets (all radius 96)**, a quarter circle swept along the centre-line profile:
- side wall ↔ floor ramp: centre 96 in from the wall, 96 above the floor
- side wall ↔ roof: same, following the roof slope
- side wall ↔ back (plan view): centre (x ±800, y 784)
- at profile kinks the offset is mitred (the game's vertex at the back is 96.5 from the wall)

**Other**
- Back-wall pieces beside the goal: x ±896…±2688 (overlapping the corner pieces from |x| 2426).
- The level places the full goal mesh (`Goal_STD_Collision`) **and** four mirrored copies of its half
  (`Goal_STD_Collision_Half`; the side curves are doubled the same way). Both sets have `BlockRigidBody` and the
  triangles are identical. RocketSim's list of 16 dumped soccar meshes fits 4 corners + 12 halves, so the full
  copies may not reach the physics world. Either way it doesn't matter: build one copy.
- Replay check: on-ground cars sit at z 17.01 up to world |y| 5300, then rise with the ramp
  (z − ramp = 17.0 ± 0.1 across |y| 5350–5700). This confirms the ramp.
- Replays can't show the ball deep in the goal: the goal is scored at ball |y| = 5215.5
  (= 5124.25 + 91.25, RocketSim's threshold; max observed 5215.48).

## Collision behaviour notes (from the exe)
- Arena triangles are one-sided for the ball (no contact when the ball centre is behind a triangle).
- All arena surfaces use materials with friction 1.0, restitution 0.3, `bStickyWheels`.
- The extracted meshes extend slightly past the planes (e.g. x to 4107, z to −13) as overlap.

## Generated arena
`python3 scripts/arena_gen.py` → `out/arena/` (no Psyonix data; safe to commit and ship):
- `soccar_arena.obj`: uu, for viewing.
- `collision_meshes/soccar/soccar_arena.cmf`: RocketSim's mesh format (int32 triangle count, int32 vertex count,
  int32×3 indices, float×3 vertices in Bullet units = uu × 0.02). RocketSim adds the floor, ceiling and side-wall
  planes itself. It warns that the mesh hash is unknown; that is expected.

One welded mesh: 5,702 vertices, 10,904 triangles, normals into the playable space, consistently wound
(no edge used twice in the same direction). The only open edges are under the floor, above the ceiling,
behind the side walls, or on the side-wall plane where the corner starts.

**Checks**
- `scripts/arena_check.py` (local only; needs `out/arena_local/`) compares with the game's meshes in one quadrant:
  | | median | p99 | max |
  |---|---|---|---|
  | game corner → ours | 0.00 | 1.39 | 2.00 |
  | game side curves → ours | 0.00 | 0.83–1.19 | 2.0 |
  | game goal + back wall → ours | 0.00 | 0.64 | 2.0 |
  | ours → game | 0.00 | 0.17 | 1.44 |

  Game samples more than 2 uu from ours that lie behind our surface are dropped (the game's pieces overlap and run
  on behind each other; ours is one welded mesh), so the game side's max is 2 by construction.
- Replays (notes/validation.md finding 18): cars driving on walls, curves and corners are as close to the replays on
  our mesh as on the game's own (0.046 uu median after ~4 ticks; corners 0.090 vs 0.084, side curves 0.058 vs
  0.057). The one visible remainder is where the corner meets the back wall (|x| 2560–2700, 60 cases): the game's
  corner and goal pieces overlap there and a wheel ray takes the nearer one.
- `engine/tests/arena_smoketest.cpp` (stock RocketSim; same results with the patched engine, where ball–triangle contacts are one-sided):
  - 500 random balls at up to ~10,000 uu/s for 10 s each: none escaped; the closest any centre came to the outside was 51 uu.
  - A car on the goal ramp sits at ramp + 17.0 (replays: 17.0 ± 0.1).
  - A car drives up the side wall, and along the back wall through the corner onto the side wall.
  - A ball at the post bounces back.
