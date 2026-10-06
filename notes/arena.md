# Soccar arena measurements

Measured from the standard stadium's collision meshes (`Stadium_P.upk`, `FieldCollision_Standard.*`,
`CollisionMeshes.Plane32768`, `Goal_STD_Collision`) with `scripts/staticmesh.py`. Extracted meshes stay local in
`out/arena_local/` (git-ignored). **Build our own arena from these numbers; never ship Psyonix meshes.**

Units uu. Field centre at origin, +Z up. All pieces are mirrored into the four quadrants by negative actor scale.

## Flat surfaces (planes)
| Surface | Position |
|---|---|
| Floor | z = 0 |
| Ceiling | z = 2048 |
| Side walls | x = ±4096 |
| Back walls | y = ±5120 (outside the goal mouth) |

## Edge curves (all quarter circles tangent to both surfaces, 8 segments each)
| Edge | Radius | Centre (in the +x / +y quadrant) |
|---|---|---|
| Side wall → floor | 256.5 | x 3839.6, z 256.4 |
| Side wall → ceiling | 512.8 | x 3583.2, z 1535.2 |
| Back wall → floor | 160.3 | y 4959.7, z 160.3 |
| Back wall → ceiling | 513.0 | y 4607.3, z 1535.2 |

## Corners (plan view)
- 45° diagonal wall on **|x| + |y| = 8064**.
- Blends into the back wall and the side wall with arcs of radius ≈ **863** (fits: 863.4 and 862.1),
  tangent to the wall and the diagonal.
- Straight side-wall section runs y = ±3840; corner pieces cover x 2426–4107, y 3326–5125.
- Floor and ceiling edge curves continue around the corner (corner mesh blends 256 → 160 at the floor).

## Goal
Local coordinates of the +Y goal: x across, y = depth behind the goal line (world y = 5120 + y), z up.
The −Y goal is the same mesh rotated 180°. Every edge below is a circular arc with 8 segments per 90°.

**Mouth**
- Opening on the back-wall face (y = 0): x ±904, height 648.
- 45° chamfers 8 uu deep (posts and crossbar) narrow it to the interior: **x ±896, crossbar underside z 640**.
  (The earlier ≈893 / 642.8 readings were taken mid-chamfer.)

**Profile at the centre line (side view)**
| Piece | Shape |
|---|---|
| Floor | z = 0 (arena floor plane) to y = 236, then a straight ramp up to **z = 16 at y = 640** (≈2.3°) |
| Back | arc r **240**, centre (y 640, z 256): bottom quarter from (640, 16) to (880, 256); top part continues to 67.5° at (733, 477) |
| Back wall | furthest point **y = 880** (world 6000) at z = 256 |
| Roof | flat z = 640 from y = 8 to 224, then slopes down (≈17.7°, z = 640 − 0.32·(y − 224)) to meet the back arc at (733, 477) |

**Side walls**: vertical at x = ±896 from y = 8 to 784.

**Fillets (all radius 96)**
- side wall ↔ floor ramp: centre 96 in from the wall, 96 above the floor
- side wall ↔ roof: same, following the roof slope
- side wall ↔ back (plan view): centre (x ±800, y 784)

**Other**
- Back-wall pieces beside the goal: x ±896…±2688; the back-wall → ceiling curve continues above the goal.
- In-game duplication: the level places the full goal mesh (`Goal_STD_Collision`) **and** four mirrored copies of
  its half (`Goal_STD_Collision_Half`). Both block rigid bodies and the triangles are identical, so every goal
  surface exists twice in the Bullet world. Build one copy: duplicate ball contacts are averaged by the special
  contact anyway.
- Replay check: on-ground cars sit at z 17.01 up to world |y| 5300, then rise with the ramp
  (z − ramp = 17.0 ± 0.1 across |y| 5350–5700). This confirms the ramp.
- Replays can't show the ball deep in the goal: the goal is scored at ball |y| = 5215.5
  (= 5124.25 + 91.25, RocketSim's threshold; max observed 5215.48).

## Collision behaviour notes (from the exe)
- Arena triangles are one-sided for the ball (no contact when the ball centre is behind a triangle).
- All arena surfaces use materials with friction 1.0, restitution 0.3, `bStickyWheels`.
- The extracted meshes extend slightly past the planes (e.g. x to 4107, z to −13) as overlap.
