# walls_20261008_021027 tick 125: what the game can do per wheel, and what PhysLog should record (static session, 2026-10-08)

**The question.** At t125 the car climbs the goal's side-wall curve, and the engine has a one-tick error (per-tick mode):
- world frame: dv (0.18, 0.01, −0.08) uu/s, dω (0.0040, −0.0001, 0.0037) rad/s;
- car frame: roll 0.0044, yaw 0.0033, little pitch; +0.17 forward, −0.10 up.

notes/rocketsim-audit.md RS-12 guessed "one front wheel". This answer comes from the game's code, with addresses in the
live build (2026-10-06); old build in brackets. Sub-agent files are local in out/bsim/agents/W1/ (notes.txt; cmf.py,
a mesh loader and Bullet-style ray test; dispcmp.py, an old/live instruction diff; decomp/).

## Answer: not a wheel
- **Both front rays hit the same triangle.** I cast the four t125 rays from row 125's pose against our goal mesh, in
  float64, and they reproduce the recorded suspension distances:
  - FL −4.7789 vs −4.7797; FR −4.7561 vs −4.7569; RL −2.2699 vs −2.2698; RR −2.2756 vs −2.2755.
  - Both front wheels hit tri 836, n (−0.4771, −0.0347, 0.8781), 2.3–2.4 uu from the crease, and both switch to
    tri 827 together at t126.
  - Crossing the crease would change a suspension length by about 0.57 uu, so a switch at one wheel is ruled out.
- **No other per-wheel term in the game can differ** at that tick; see the table below.
- **The tick is dominated by a hitbox contact with the curve.** Game Δv at t125 is (−55.4, −1.2, +31.0) uu/s.
  - Wheels, gravity and the sticky force (the game's formulas) explain about (+3.8, −0.3, +8.6).
  - The rest is about 60 uu/s along n3 (−0.771, −0.025, 0.636) plus 20.5 tangential.
  - It comes from two manifold points at the hitbox nose: P0 inside tri 831; P1 exactly on the 825/831 diagonal of a
    non-planar quad, where the game gives P0 tri 831's normal and P1 tri 825's.
  - The same kind of hit repeats at t127 and t131.
  - The positive-distance points still get full velocity constraints (no speculative term).
- **The engine's error fits a 0.25–0.35 % change in that contact's impulse at P0** (residual 2–4 %).
  - A front-left-wheel model fits only at 7–30 %; any front-right model fails.
- **"Little pitch" is the 5.5 rad/s angular cap, not a property of the event.**
  - Rows 126–128 have \|ω\| = 5.4999: the end-of-tick cap in the read-back (FUN_140ef2770 [old 140eed9e0],
    RBActor+0x564).
  - ω is nearly pure pitch, so the cap removes the pitch part of any error and scales roll/yaw by 5.5/\|ω_pre\|.
- **PhysLog's "impulse" column is never written by the game.** It is 0 in every recording: 2.82 writes the applied
  impulse back to the manifold only with warm starting, and the game's solverMode is 0. Drop it.

## Per-wheel conditions in the game's code (ranked by fit)
At FL, car frame: suspension direction (−0.348, 0, 0.937), drive direction (0.937, 0, 0.348).

| # | Condition | Live (old) | Formula | Asymmetric with equal suspension? | Fits? |
|---|---|---|---|---|---|
| 1 | Not a wheel: hitbox–facet contact impulse split between P0 and P1 | narrowphase (B7 face normal), setupContactConstraint | positive distance → full velocity constraint | yes (P0 at y −41.4, P1 at +5.4 on a diagonal) | **yes, 2–4 %** |
| 2 | FL suspension together with FL drive | 1402c3540 (1402c2a40), 1402c3e60 (1402c3360), 1402c54d0 (1402c49d0) | needs about −5 % suspension and +6 % drive at one wheel | no mechanism at t125 (all inputs equal) | partial, 7–30 % |
| 3 | Ray hit: triangle, normal, object | 1402c4650 (1402c3b50); broadphase query 1402c2230 (1402c1730); rayTestSingle 14027b620 (14027ab20) | meshes use btTriangleRaycastCallback (a pure ray; GJK only for convex targets); face normal; ties go to the first triangle/object; a hit is rejected if dist² < wheel+0x54 | only with different triangles or objects; excluded here | no |
| 4 | Wall friction curve / sticky wheels | 140f5e9d0 (140f588f0) | lat and long × WallFrictionCurve(Normal.z), unless PhysMatProp.bStickyWheels && Throttle ≠ 0 | only with a different normal or object | no |
| 5 | Slip curves | 140f5e9d0 (140f588f0) | slip = \|v_lat\| / (\|v_long\| + \|v_lat\|) if \|v_lat\| > 5 uu/s, at the hard point | no (shared axle; v_lat ≈ 0.4 uu/s) | no |
| 6 | Lateral friction | 1402c54d0 (1402c49d0) + resolveSingleBilateral 1402b9260 (1402b8760) | × dt × 60 × lat, at the contact point projected onto the chassis plane | no | no (no roll) |
| 7 | Longitudinal friction | 1402c54d0 (1402c49d0) | engine force × dt, else clamp(fwd·v × 113.73963, ±brake) × dt × 60, × long | no (one engine force for all wheels) | no |
| 8 | Suspension damping / clamps | 1402c3540 (1402c2a40) | F = max(0, ((rest − len)·k·clippedInv − relVel·c)·scale); no max force or travel clamp | no (relVel +20.7 / +20.5, relaxing on both) | no |
| 9 | Bottom-out pushback | 1402c3e60 (1402c3360) + 1402b96b0 (1402b8bb0) | if trace < r + rest − 2.5: 0.25 × impulse against the fixed body; uses the world inverse inertia | no (active on both) | no |
| 10 | Steer angle | 140f66000 (140f5ff00), 1402c63b0 (1402c58b0) | wheel+0xbc = steer × SteerFactor; FR's basis is a copy of FL's | no (steer 0 here) | no |
| 11 | Contact flags / hysteresis | 140f5e390 (140f582b0) | none in the physics; friction scales refreshed only while bHasContact | no | no |
| 12 | Throttle / brake / handbrake | 140f24270 (140f1e830) | one value × 0.25 to every wheel | no | no |
| 13 | Client resim stored-plane path | vehicle+0x48; 1402c52d0 (1402c47d0) | re-intersects each ray with a stored plane | network clients only | no (log the flag) |

## PhysLog fields (live build)
- **Layout.** The old and live instructions of every vehicle/wheel/Wheel_TA native are identical except Vehicle_TA
  Input.Throttle (0x7e4 → 0x7fc) and the bDriving flags (0x7e0 → 0x7f8). So these offsets hold for the live build.
- **Timing.** Row T+1 holds tick T's values (as w_susp does today).
- **Pointers.**
  - W = WheelWrapper.memory_address
  - VS = \*(W+0x150), BV = \*(VS+0x140), i = \*(int\*)(W+0x158) (game order 0 FL, 1 FR, 2 RL, 3 RR)
  - B = \*(BV+0x60) + 0xf0·i, FI = \*(BV+0x18) + 0x10·i, CH = \*(BV+0x40) (= the car body)
- **Units.** BU (× 50 for uu); a car Δv in uu/s = impulse × 50/180.

| Name | Field | Offset | When (tick T's vehicle update) |
|---|---|---|---|
| wN_inc | btWheelInfo isInContact | B+0x40 (u8) | ray pass |
| wN_obj | ground object (log BodyName, obj+0x40..48) | B+0x48 (ptr) | ray pass |
| wN_n | contact normal | B+0x00..08 | ray pass |
| wN_p | contact point | B+0x10..18 | ray pass |
| wN_hp | hard point | B+0x30..38 | ray pass |
| wN_len | suspension length (unclamped) | B+0x50 | contact pass |
| wN_vc | chassis velocity at P | B+0x20..28 | contact pass |
| wN_inv | clippedInvContactDotSuspension | B+0xd4 | contact pass |
| wN_relv | suspension relative velocity | B+0xd8 | contact pass |
| wN_push | bottom-out pushback (already × 0.25) | B+0xe8 | contact pass |
| wN_force | suspension force (≥ 0) | B+0xdc | suspension |
| (derived) | suspension impulse = n·(force/120 + push), applied only if force ≠ 0 | – | – |
| wN_fi | friction impulse (long + lateral), world | FI+0..8 | friction |
| wN_lat, wN_long | friction scales | B+0xe0, B+0xe4 | hook (refreshed while bHasContact) |
| wN_eng, wN_brake | engine force, brake | B+0xc0, B+0xc4 | hook |
| wN_steer | physics steer angle | B+0xbc | hook |
| wN_axle | wheel basis column 1 | B+0x64, +0x74, +0x84 | hook, after steer |
| wN_cflags | Contact flags (bit0 bHasContact, bit1 WithWorldGeometry) | W+0x160 & 3 | hook |
| wN_sticky | PhysMatProp.bStickyWheels | \*(W+0x1a8) → +0x68 bit0 (−1 if null) | hook |
| wN_slip | FrictionCurveInput | W+0x1b4 | hook |
| wN_longdir | Contact.LongDirection (Normal at W+0x184) | W+0x19c | hook |

- **Also per row:** BV+0x48 (u8, expect 0); CH+0x130..0x158 (world inverse inertia, RS-1); CH+0x180 (inverse mass).
- **Once, as a sanity dump:** BV+0x54 = 4; B+0xa0 0.25, +0xa4 0.5351, +0xa8 0.24, +0xac 0.05, +0xb0 500, +0xb4 25,
  +0xb8 40, +0xc8 ≈ 35.735 (front) / 54.265 (rear), +0xcc 0.
- **Hit triangle:** not stored by the game (ClosestRayResultCallback drops it); recover it offline from wN_p/wN_n
  (W1's cmf.py).
- **Contact side (settles item 1).** Add per manifold point to BulletContacts:
  - +0xe0 m_vel1 and +0xf0 m_vel2: pre-solve velocities at the point. These separate "wheels or upstream wrong" from
    "solver or contact wrong".
  - +0x88/+0x8c index0/1 (triangle index); +0x80/+0x84 partId.
  - +0x74 combined friction; +0x7c combined restitution; +0x100 restitution velocity; +0xc0 lateral friction dir 1.

## Scenario to record (`walls_goal_wheels.txt`)
Four segments, each repeating the first 180 ticks of walls.txt: the front wheels reach the curve about 57 ticks into the
throttle, and the nose hits around ticks 65/67/71.
```
ball -3000 -2000 92.75  0 0 0  0 0 0
car 600 5500 30  0 0 0  0 0 0  0 0 0  0
wait 60
input 120 1 0 0 0 0 0 0 0
car -600 5500 30  0 180 0  0 0 0  0 0 0  0   # mirror: a geometric roll/yaw error should flip
wait 60
input 120 1 0 0 0 0 0 0 0
car 600 5440 30  0 0 0  0 0 0  0 0 0  0      # shifts the nose points relative to the 825/831 diagonal
wait 60
input 120 1 0 0 0 0 0 0 0
car 600 5500 30  0 0 0  0 0 0  0 0 0  0
wait 60
input 120 0.5 0 0 0 0 0 0 0                   # slower entry: less or no nose contact
```
Engine side: the same per-wheel dump and the pre-solve contact velocities from live_validate at the same ticks.

## Open
- **Per-point solver impulses:** btSolverConstraint is 0xd0 bytes (applied impulse +0x70). The solver's pool offsets
  are unverified (stock order: contact pool data +0x38, friction +0x78).
- **Lifetime-1 points at row 126:** these may mean a refresh after the solve; unchecked.
