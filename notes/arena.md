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
- Segment angles are slightly non-uniform in the game (11.6°, 11.3°, 11.1°, 11.0°, …). That makes
  < 0.1 uu of difference against uniform 11.25° steps.

## Corners (plan view)
- 45° diagonal wall on **|x| + |y| = 8064**.
- Joined to the side wall and to the back wall by arcs tangent to both lines. Each arc's tangent points
  are **256√2 = 362.04** from the line intersection, so **radius = 874.04**, 8 segments each.
  - Side arc: centre (3221.96, 3605.96), from (4096, 3605.96) to (3840, 4224).
  - Back arc: centre (2581.96, 4245.96), from (3200, 4864) to (2581.96, 5120).
  - The game's vertices are within 1.4 uu of these circles (the best free fit is r ≈ 863, a little off-tangent).
- Wall vertical from the floor curve up to z 1536, then the 512 ceiling curve (constant all round).
- Floor curve: 256 along the side arc and the diagonal. Across the back arc it narrows to the back wall's 160:
  at station k (k = 0 at the back-wall tangent … 8 at the diagonal), `r = 160 + 96·smoothstep(k/8)`
  (measured 164.5, 175.7, 191.0, 208.4, 225.7, 240.9, 252.0, 256; each cross-section is a true quarter circle).

## Goal
Local coordinates of the +Y goal: x across, y = depth behind the goal line (world y = 5120 + y), z up.
The −Y goal is the same mesh rotated 180°. Every edge below is a circular arc with 8 segments per 90°.

**Mouth**
- Opening on the back-wall face (y = 0): x ±904, height 648, top corners rounded r 104 (centre x ±800, z 544).
- A 45° chamfer 8 uu deep runs all round the mouth to the inner outline at y = 8:
  **x ±896, crossbar underside z 640**, top corners r 96. (The earlier ≈893 / 642.8 readings were mid-chamfer.)
- Post base: the back wall's r-96 floor curve wraps round each post into the goal's side floor curve. It is the
  floor-curve profile revolved about the vertical axis (x ±904, y 8), radius 8 + profile offset, over 90°.

**Profile at the centre line (side view)**
| Piece | Shape |
|---|---|
| Floor | z = 0 (arena floor plane) to y = 236, then a straight ramp up to **z = 16 at y = 640** (≈2.3°) |
| Back | arc r **240**, centre (y 640, z 256): bottom quarter from (640, 16) to (880, 256); top part continues to 67.5° at (732, 478) |
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
  | game corner → ours | 0.19 | 1.77 | 2.56 |
  | game side curves → ours | 0.06–0.12 | 0.7–1.1 | 2.0 |
  | game goal + back wall → ours | 0.03 | 0.64 | 2.0 |
  | ours → game | 0.06 | 1.43 | 2.62 |

  The worst spot is the corner's floor-curve blend near the back wall (x 2748, y 5074, z 84). Game surfaces
  hidden behind another piece (overlaps) are excluded.
- `engine/tests/arena_smoketest.cpp` (stock RocketSim; same results with the patched engine, where ball–triangle contacts are one-sided):
  - 500 random balls at up to ~10,000 uu/s for 10 s each: none escaped; the closest any centre came to the outside was 51 uu.
  - A car on the goal ramp sits at ramp + 17.0 (replays: 17.0 ± 0.1).
  - A car drives up the side wall, and along the back wall through the corner onto the side wall.
  - A ball at the post bounces back.
