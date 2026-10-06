# Soccar arena measurements

Measured from the standard stadium's collision meshes (`Stadium_P.upk`, `FieldCollision_Standard.*`,
`CollisionMeshes.Plane32768`) with `scripts/staticmesh.py`. Extracted meshes stay local in
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
- Mouth half-width ≈ 893 (posts rounded), crossbar height ≈ 642.8 (matches the known 642.775).
- Goal depth 880 (back of goal at y = ±6000).
- Goal mesh spans x ±2688 (back wall pieces beside the goal) and z up to ~2075.
- TODO: interior goal shape (side/back/roof radii) from `Goal_STD_Collision`.

## Collision behaviour notes (from the exe)
- Arena triangles are one-sided for the ball (no contact when the ball centre is behind a triangle).
- All arena surfaces use materials with friction 1.0, restitution 0.3, `bStickyWheels`.
- The extracted meshes extend slightly past the planes (e.g. x to 4107, z to −13) as overlap.
