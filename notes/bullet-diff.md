# Bullet in RocketLeague.exe vs stock Bullet 2.82

Static session (BSim). Lists every function in the game's Bullet that differs from stock Bullet, with what changed and
the physics it affects. Addresses are for the **2026-06-16** build (`documents/binaries`, image base 0x140000000)
unless marked otherwise; the live game updated on 2026-10-06 (see "Live build" below once BinDiff has run).
Hypotheses sent to the live session are numbered **B1, B2, …** (status in the table).

## Version and build settings

- **Bullet 2.82.** The exe's two serialization DNA blobs (`SDNANAME`, file offsets 0x224be60 / 0x224e4e0, 32- and
  64-bit) are byte-identical to `sBulletDNAstr` / `sBulletDNAstr64` of the 2.82 tag and differ from 2.83 and later.
  In git history the DNA is unchanged from `c28652de` (2013-09-14) to `89aeae91^` (2014-09-16), so the code is 2.82 or
  a snapshot up to Sept 2014. Upstream changes in that window that a diff could be confused with are listed under
  "Upstream after 2.82". So far every difference matches no upstream commit (i.e. they are Psyonix's).
- **Compiler:** MSVC x64, `/O2`, **`/fp:precise`** (Bullet functions match a `/fp:precise` build exactly far more
  often than `/fp:fast`; the `/fp:fast`-only matches are trivial stubs), no LTCG/PGO (no LTCG/POGO records in the Rich
  header), `/GS` on (stack cookies in some functions), RTTI off (no Bullet RTTI). `BT_NO_PROFILE` (no profiler
  strings), Windows SSE defaults (`BT_USE_SSE` without `BT_USE_SSE_IN_API`: scalar `movss` vector maths). The game's
  Rich header lists VS2015–VS2022 toolsets; Bullet's code differs from a VS2022 17.14 build only in prologues and stack
  frame sizes, i.e. an older MSVC with the same flags. Build our reference with `/O2 /fp:precise`.
- **Region:** Bullet's code is contiguous at about `0x14026c000–0x1402d4000` (1,143 functions); a few header inlines
  live in game code.

## Method (reproducible, everything under `out/bsim/`, git-ignored except `scripts/`)

1. Stock 2.82 sources (`out/bsim/bullet-2.82/src`, from the bullet3 tag) built from WSL with MSVC 14.44 in two
   variants, `/O2 /Ob2 /Oi /Ot /GS- /GR- /Gy` + `/fp:fast` or `/fp:precise`, into a DLL with PDB keeping every
   function: `out/bsim/scripts/build_bullet_msvc.sh 2.82 precise "<flags>"` → `out/bsim/build/2.82-precise/`.
2. Ghidra project `out/bsim/BulletStock` (both DLLs, PDB names). The game's project is used read-only through a file
   copy, `out/bsim/rl-20260616/` (a headless run locks the project even with `-readOnly`; the copy keeps
   `ghidra/RocketLeague` free for the live session).
3. BSim H2 databases (`medium_nosize`): `out/bsim/db/bullet_rl` (all 89,683 functions of the game) and
   `out/bsim/db/stock282` (both stock builds). Scripts: `AddToBSim.java` (sign + insert), `QueryBSim.java`
   (nearest matches → TSV), `summarize.py`, `region_table.py` (`out/bsim/region.tsv`: each game function in the
   Bullet region with its best stock match and similarity), `DecompTo.java` (decompile into a directory),
   `vtbl_cmp.py` (game vtable vs stock vtable slot by slot), `asmdiff.py`, `pdbfuncs.py`.
4. Every function below 1.0 similarity on the physics path is decompiled on both sides and read against the 2.82
   source. Similarity 1.0 is treated as unchanged (checked on a sample: identical instructions apart from prologue
   and frame size).

```sh
cd out/bsim   # headless runs: GHIDRA_HEADLESS_MAXMEM=12G /opt/ghidra/support/analyzeHeadless ...
analyzeHeadless $PWD/rl-20260616 RocketLeague -process RocketLeague.exe -noanalysis -readOnly \
  -scriptPath $PWD/scripts -postScript DecompTo.java $PWD/decomp/rl 0x1402ac650
analyzeHeadless $PWD BulletStock/2.82-precise -process bullet.dll -noanalysis -readOnly \
  -scriptPath $PWD/scripts -postScript DecompTo.java $PWD/decomp/stock 're:btPersistentManifold::'
```

## Changes found

Ranked roughly by physics impact. "Engine" = our RocketSim fork (Bullet 3.24). Detailed write-ups with quotes of both
sides: `out/bsim/reports/{A,B,C,D,E}.md` (A solver/world, B convex narrowphase, C mesh/compound, D broadphase/manifold,
E unmatched/Psyonix additions). Status: "sent" = hypothesis sent to the live session.

| # | Function (2026-06-16) | Change vs 2.82 | Physics affected | Engine | Status |
|---|---|---|---|---|---|
| B6 | (engine side) `restitutionCurve` | 2.82 and the game: `rest = e·(−v_n)` with no threshold. Bullet 3.24 zeroes it when \|v_n\| < `m_restitutionVelocityThreshold` (default 0.2 BU/s = 10 uu/s), which the engine never overrode | Slow bounces (ball, car–ball, car–world) below 10 uu/s normal speed | fixed (threshold 0) | **confirmed live** (`ball_roof` 4.87 → 0.01 uu/s, `walls` 1.67 → 1.47); adopted |
| B7 | `btGjkPairDetector::getClosestPoints` 0x1402a6540 (asm 0x1402a7005) | With `m_fixContactNormalDirection` on and shape B a triangle: normal := the triangle's face normal (e1×e2, rotated, normalised, no sign test) instead of 2.82's AABB-centre sign flip; distance and pointOnB unchanged, so positionWorldOnA = pB + n_face·d | Car hitbox vs mesh at edges/vertices (seams, curbs, posts, ramp edges); later refreshes measure along n_face | differs (keeps the GJK normal + internal-edge clamp) | **confirmed live** (`walls` 1.04 → 0.40 uu/s); adopted |
| B8 | `btAdjustInternalEdgeContacts` 0x1402867d0, `btNearestPointInLineSegment` 0x140288b40 | Closest-edge search on segments shrunk by 1e-5·length at both ends (runtime setting `m_btNearestPointInLineSegment_adjustment`, byte 0x142351e8d, default on); every edge the contact lies on (< FLT_EPSILON) is processed, not only the best one | Normal of mesh contacts at a mesh vertex (car and ball); on our soccar mesh a different edge in 49% of vertex-exact cases, different outcome in 28% | differs (stock) | sent; the 49% / 28% figures came from our generated mesh, whose quad diagonals differ from the game's in places (being fixed), so the real effect is likely smaller |
| B9 | `btRigidBody::applyDamping` 0x1402c23a0; RB-state read-back `FUN_140eed9e0` | Two clamps: Bullet-side, \|v\| to body+0x368 (MaxLinearSpeed×0.02) and \|ω\| to +0x36c **before** the stock damping, at the start of each substep; game-side, the per-tick state read-back (which also quantises) clamps the state's velocities to the actor's MaxLinearSpeed (+0x560) / MaxAngularSpeed (+0x564) | The observable end-of-tick state is capped (2300.001, 5.50001 live); the substep clamp only matters when game code raises the velocity above the cap between ticks (dodge, jump, bumps, hits at max speed): the game integrates that tick from the clamped velocity | end-of-tick clamp matches; the substep clamp is absent | end-of-tick cap confirmed live; dodge-at-max test suggested |
| B10 | Vehicle contact pass `FUN_1402c3360`, suspension `FUN_1402c2a40`, friction `FUN_1402c49d0` | (a) Each wheel touching a **dynamic** body: wake it, then impulse −PushForce·n at the contact every substep (not dt-scaled; PushForce = `Wheel_TA.PushForceConstant` 1.0 × config+0x1ec). (b) Bottom-out (trace < radius + rest − maxRaise) only against static ground or a dynamic body whose broadphase group is in the vehicle's u16 mask (+0x30): impulse = `resolveSingleCollision` vs that body (or the fixed body) with a private default solver info, not applied; car gets ¼ along n (wheel+0xe8), dynamic ground the full opposite impulse. (c) Friction treats every ground as **static and motionless**: `resolveSingleBilateral` against the fixed body (`FUN_1402c31f0`), brake friction from the chassis-only contact velocity; friction and suspension impulses go to the chassis only | Ball under a wheel (≈ 1.67 uu/s per wheel per tick); car perched on the ball or another car | (a) adopted; (b) not adopted (a version without the mask was worse); (c) engine used the ground body and its velocity | (a) **confirmed live** (`wheel_ball` p90 3.80 → 0.09 uu/s); (b), (c) answered, to test |
| B11 | Car compound: `btCompoundShape(true)` (only construction, 0x140409a84) | The game's car compound has a dynamic AABB tree → car–car through `MycollideTT` (tree vs tree) then box–box with manifold (car0, car1) | Car–car contact points (btBoxBoxDetector is not symmetric) and near-miss contacts | differs (`btCompoundShape(false, 1)`: nested compound, manifold (car1, car0)) | tried with 3.24's tree path: car–car replays worse (70 better / 340 worse). Likely body order: the game's body0 is the proxy with the lower axis-sweep handle (spawn order, LIFO handle reuse), not the lower car ID; full 2.82 path sent |
| B1 | `btSphereShape` vtable 0x141a4dd70: `getAabb` 0x1402a58c0, `getBoundingSphere` 0x1402a5c00 | AABB half extent and bounding radius `r·scale + 0.04 + 0.04`, centre 0 (stock: half extent r, radius √3·r); contact surface unchanged | Ball contact-breaking threshold 0.02 × (r·s + 0.08) BU = 1.905 uu for r = 91.25 uu | matches (r + 0.08) | **confirmed live** (ball–floor manifold threshold 1.905; patch 44's +0.12 had compensated for the box bug below and was reverted) |
| B5 | `createPredictiveContacts` 0x1402b2e80 (+ ray callback 0x1402b0400 / 0x1402b7c30), setter `FUN_1402bad10` (world+0x1a5) | Gated by the Psyonix world flag +0x1a5; enabled with `m_ccdMotionThreshold` = 0.02 BU for **every RB actor** by `FUN_140f17910` (physics init) and by `EnableCCD`, except on network clients (net-mode byte 3). A **ray** (`rayTest`, static/kinematic objects only) from the centre − 0.04·dir (compounds: child 0) to the predicted centre instead of a sphere sweep; hit → point with distance = (remaining motion)·n ≤ 0, restitution 0 | Tunnelling guard only (centre path must cross geometry within a substep) | absent | sent |
| – | `integrateTransforms` 0x1402b7640 | CCD motion-clamp branch removed (the threshold only feeds predictive contacts) | none in practice | inactive | – |
| B3 | `internalSingleStepSimulation` 0x1402b7b40 | `applyGravity` → `predictUnconstraintMotion` → **vehicle update** (`FUN_1402c1430` → `FUN_1402c5340`, while `m_updateVehiclesBeforePhysics`, byte 0x142351e8c, default on) → predictive contacts → collision detection → islands → solve → integrate → `updateActivationState` → `clearForces`. Gravity and clearForces per substep; no tick callbacks. `stepSimulation` is stock (the game drives the internal step; `FUN_1402af960` is its substep-count half) | Tick order (engine patch 41) | matches | sent (FYI) |
| B12 | `buildIslands` 0x1402890e0, `solveGroupCacheFriendlyFinish` 0x1402bd390; `setGravity` 0x1402ba8d0, `addRigidBody` 0x1402aff40/0x1402b0130 | A sleeping body in an awake island is woken only if it has non-zero velocity after the solve (stock: at island build, timer reset). World gravity reaches every non-static body, sleeping or flagged (filters moved into `applyGravity`, B4) | Zero-velocity touches keep the ball asleep; gravity mutators with a sleeping ball | differs (stock) | sent |
| B2 | `updateAabbs` 0x14027f4a0 | Skips only `DISABLE_SIMULATION`; stock also skips `ISLAND_SLEEPING` | Sleeping bodies moved by a set-state reach the broadphase at once | differs | sent |
| B4 | `btRigidBody::applyGravity` 0x1402c29b0 | Skips bodies with `BT_DISABLE_WORLD_GRAVITY` (+0x240 bit 0) and inactive ones | Flagged bodies only | – | sent (FYI) |
| B13 | `rayTestSingleInternal` 0x14027ab70 | Analytic branch for the Psyonix plane (type 28): world +Z normal through the origin, front side only, extents ignored | Wheel rays vs the floor; same as stock for front-side rays | – | sent |
| B14 | `btSubsimplexConvexCast` 0x1402a0ef0, `btGjkConvexCast` 0x1402a0ac0 | Iteration cap 64 (2.82 float build: 32) | Ray/convex casts against convex shapes | 32 | sent |
| – | `btSequentialImpulseConstraintSolver::setupContactConstraint` 0x1402badc0 | Speculative term (`velocityError −= d/dt` for d > 0) only if a new solver-info bool (info+0x54, default false, never set) | Contacts inside the margin act as touching | matches (RocketSim comments the line out) | – |
| – | `convertContact` (split into `FUN_1402b2720` + `FUN_1402bc020`), `solveGroupCacheFriendlySetup` 0x1402be240, `FUN_1402b2390`, `solveSingleIteration` 0x1402bfda0 | "Special" contacts (flag point+0x10c, set by `gContactAddedCallback` `FUN_14040a5f0` for sphere vs triangle/plane): no own normal/friction rows, averaged into one contact per body (accumulator embedded in the rigid body at +0x250, sums at +0x360/+0x364); split-impulse rows still per point. Rolling friction removed. Impulse multipliers point+0x104/+0x108 (always 1.0, dormant) | Ball–world merged contact | matches (patch 11) | known |
| – | `resolveSingleCollision` 0x1402b8bb0 | Returns the impulse without applying it (only caller: the vehicle) | – | matches | known |
| – | `SphereTriangleDetector::collide` 0x14028aaf0 | One-sided triangles; nearest edge wins | Ball vs mesh | matches | known |
| – | `btConvexPlaneCollisionAlgorithm::processCollision` 0x1402944b0 (+ `collideSingleContact` 0x14028b2f0, `btContinuousConvexCollision::computeClosestPoints` 0x1402a3d30) | Psyonix finite plane: normal (0,0,1), constant 0, bounds check `|x| ≤ ex + thr`, `|y| ≤ ey + thr` (the perturbation and CCD variants have no bounds check; perturbation is off) | Car/ball vs floor, walls, ceiling | matches (patch 43) | known |
| – | `addCollisionObject` 0x140270430; `btAxisSweep3::createProxy` 0x140272130; `internalAddPair` 0x140278c90 | First AABB from the extra shape virtual (+0x10; the plane gives a tight box), replaced by `getAabb` on the next `updateAabbs`; `createProxy` fills the proxy's float AABB; pair filter run twice | none | – | – |
| – | `setMassProps` 0x1402c4380, `setupRigidBody` 0x1402c44b0, `setCenterOfMassTransform` 0x1402c3a40 | Inertia tensor updated in setMassProps; max speeds from construction info +0xa0/+0xa4; teleports of sleeping bodies pushed to the motion state | negligible | – | – |
| – | Layouts | `btManifoldPoint` 0x110 (stock 0xc0): +0x50/+0x60 two vec3 (zeroed; added to the lever arms in convertContact, never non-zero as far as found), `m_distance1` +0x70, vel1/vel2/restitution velocity bookkeeping +0xe0/+0xf0/+0x100, impulse multipliers +0x104/+0x108, special flag +0x10c. `btPersistentManifold` 0x480 (+0x450 body0, +0x458 body1, +0x460 count, +0x464 threshold). `btRigidBody` 0x3e0: Psyonix block +0x250–0x36f (embedded merged-contact point, sums +0x360/+0x364, max speeds +0x368/+0x36c), stock tail moved +0x120 (`m_deltaLinearVelocity` +0x370, `m_angularFactor` +0x390, `m_invMass` +0x3a0, `m_pushVelocity` +0x3b0). `btCollisionShape` vtable: one extra virtual at +0x10 (tight AABB; base forwards to `getAabb`), later slots +8. `btDispatcherInfo` repacked (0x28 bytes). Config ctor 0x140281860: members reordered, same create functions | – | – | – |

Psyonix runtime "Bullet settings" (getter `FUN_140283370`, setter `0x140415030` logging "Bullet set %s = %s", console
`BTENABLE` / `BTDISABLE <name>`): `m_updateVehiclesBeforePhysics` (0x142351e8c) and
`m_btNearestPointInLineSegment_adjustment` (0x142351e8d), both on by default.

Snapshot date: no difference matches an upstream commit, and the code predates 644d01d2 (2013-10-31) and 7151865c
(2014-05-01), so the base is the 2.82 release itself.

## Checked, same as stock 2.82 (logic; layouts may differ)

Contact creation and removal (asked by the live session for finding 27):
- `btPersistentManifold::refreshContactPoints` 0x1402ac650: keep while `m_distance1 ≤ thr`; remove when the lateral
  drift² > thr²; same `thr` (+0x464) for both; `gContactProcessedCallback` / `gContactDestroyedCallback` as stock.
- `btCollisionDispatcher::getNewManifold` 0x140277900: `CD_USE_RELATIVE_CONTACT_BREAKING_THRESHOLD` (dispatcher+8 bit
  1) → `thr = min(shape0, shape1).getContactBreakingThreshold(gContactBreakingThreshold)`; processing threshold =
  min of the objects'. `gContactBreakingThreshold` (.data 0x14224e008) = 0.02.
- `btCollisionShape::getContactBreakingThreshold` 0x14028d570, `getAngularMotionDisc` 0x14028cc30 (|centre| + r),
  generic `getBoundingSphere` 0x14028ccc0 (identity-transform AABB: r = ½|max−min|).
- `btCompoundShape` ctor 0x140281490 (margin 0), `getAabb` 0x14028c320, `recalculateLocalAabb` 0x1402980c0 (children's
  `getAabb`, slot +0x8), `addChildShape` 0x140284940.
- `btBoxShape` ctor 0x1402812a0 (`setSafeMargin`: margin = 0.1 × smallest half extent if below 0.04), `getAabb`
  0x14028bfe0, `localGetSupportingVertex` 0x140290550 (sharp corner = half extents incl. margin), `setMargin` 0x140299300.
- `btManifoldResult::addContactPoint` 0x140284bc0: gate `depth ≤ thr`; friction = f0·f1 clamped ±10, restitution
  r0·r1, rolling friction clamped ±10; `replaceContactPoint` keeps impulses, lifetime and user data. Only additions:
  initialises the new point fields, and `btPlaneSpace1` guards its 1/√a with `a > 2.2e-16`.
- `btPersistentManifold::getCacheEntry` 0x1402a62c0 (merge radius thr on `m_localPointA`), `addManifoldPoint`
  0x14029ebe0, `getContactBreakingThreshold` 0x1402a74a0 (plain getter).
- `btDiscreteDynamicsWorld::stepSimulation` 0x1402c0f40, `predictUnconstraintMotion` 0x1402b7c60, world
  `applyGravity` 0x1402b0670, `clearForces` 0x1402b2340.
- Also stock (reports A–E list each function): the rest of the solver (friction rows, row solvers, writeback, restitution
  without a velocity threshold, erp/erp2 selection), `integrateVelocities`, `predictIntegratedTransform`,
  `btTransformUtil`, `updateActivationState`, island manager apart from B12; broadphase (axis sweep add/update/remove,
  pair cache), dispatch (`needsCollision`, `needsResponse`, `defaultNearCallback`, `findAlgorithm`), filtering,
  `sortCachedPoints` (keeps the deepest point); convex–convex and GJK distances (start axis (0,1,0), REL_ERROR2 1e-6,
  degeneracy catch, EPA fallback), box/sphere support functions, convex–concave and `btConvexTriangleCallback`
  (triangle margin 0, AABB culling without a threshold term), BVH traversal, compound algorithms (each child algorithm
  owns its manifold; no upstream 9aad9231), `btGenerateInternalEdgeInfo` (default `btTriangleInfoMap`), `btClampNormal`.
- Never used by the game: polyhedral features/clipping (no `initializePolyhedralFeatures` call), perturbation
  (convex–convex 0/3, convex–plane 1/0), `btDbvtBroadphase` (raycast accelerator off), sphere–box algorithm.

## From the game's actors to Bullet (for live reads)
Verified in both builds (byte pattern of `FUN_140eddd00` matches the live 2026-10-06 exe with the same offsets).
- `btRigidBody* = *(ARBActor_TA + 0x780)` (Ball_TA, Car_TA). Body: +0x10 world transform (BU), +0xd0 shape, +0xf4
  activation, +0x11c ccdSweptSphereRadius, +0x120 ccdMotionThreshold, +0x160/+0x170 lin/ang velocity; Psyonix
  +0x368 max linear speed (BU), +0x36c max angular speed (`execSetMaxLinearSpeed` / `execSetMaxAngularSpeed`).
- Shapes: +0x8 type, +0x20 localScaling, +0x30 implicitShapeDimensions, +0x40 margin. Compound: children count +0x1c,
  data +0x28 (stride 0x60: transform, shape* +0x40, type +0x48, margin +0x4c), local AABB +0x40/+0x50, margin +0x6c.
  `execSetCollisionScaleNative` calls the shape's `setLocalScaling` (vtable +0x30).
- World: `UWorld* = *(0x1424a1308)` (2026-06-16) / `*(0x1424ae6d0)` (2026-10-06); scene = `*(UWorld + 0x208)`;
  wrappers = `*(scene + 0xb0)`, count `*(int*)(scene + 0xb8)` (created in `FUN_1409af240`, one 0x58-byte wrapper per
  physics scene, built by `FUN_140403cc0`); index = `*(uint8*)(*(Actor + 0x208) + 0x80)` (`FUN_140987da0`).
  Wrapper: +0x00 config, +0x08 dispatcher, +0x10 broadphase, +0x18 solver, +0x20 world.
- Dispatcher manifolds: count `*(int*)(disp + 0x14)`, array `*(disp + 0x20)`; predictive ones: world +0x1ac / +0x1b8.

## Game-side answers given to the live session (not Bullet)
Offsets are for 2026-06-16. In the live build `Vehicle_TA` fields moved (+0x18 up to `Input`, +0x20 after it); see
"Live build" below. `RBActor_TA` offsets are unchanged.
- Contact-added callback `FUN_14040a5f0` (all bodies have `CF_CUSTOM_MATERIAL_CALLBACK`): friction = f0·f1·k² clamped
  ±10 (k = `DAT_142258db8`), restitution = **max**(r0, r1) clamped [0, 1], then `btAdjustInternalEdgeContacts`, then the
  special flag (+0x10c) for sphere vs triangle (type 1) or plane (type 28).
- `WorldContact.bHasContact` is set by any contact point added that tick, speculative ones included (confirmed live:
  0 mismatches in 1,806 ticks).
- Auto-roll gate (car pre-physics `FUN_140f1c600` → `FUN_140eb8560`): DodgeComponent not `bActive`, Input.Throttle ≠ 0,
  0 < wheels with `bHasContactWithWorldGeometry` < wheel count, or none of them and `WorldContact.bHasContact`. Normal =
  normalised sum of those wheels' contact normals, else `WorldContact.Normal`. Confirmed live and adopted (`walls` p99
  0.83 → 0.041 uu/s, the goal-wall wobble; `dodge_fast` 11.1 → 0.05).
- `WorldContact` (car+0x690) is rebuilt in the post-physics step (`FUN_140f19b30` → `FUN_140f55040`) as the average of
  this step's `RBCollisions` records with world-geometry partners (other actor null or flag +0xf8 & 0x100); records
  come from `NotifyRigidBodyCollision` (`FUN_140f13c80`, UE3 `FCollisionImpactData`). Which Bullet points produce
  those notifications was not found statically; the live session can read `WorldContact` directly.
- Vehicles: `world+0x190` actions array (count +0x184); vehicle +0x40 chassis, +0x30 u16 bottom-out group mask, +0x54
  wheel count, +0x60 wheels (stride 0xf0). Bodies are added with group = 1 << UE RBChannel and mask =
  RBCollideWithChannels (`FUN_140409570`).

## World setup (game code, `FUN_140403cc0`)
`btDefaultCollisionConfiguration` (pools 4096/4096, EPA on) · `btAxisSweep3` (±10485.74 BU, 16384 handles, raycast
accelerator off) · `btCollisionDispatcher` · `btSequentialImpulseConstraintSolver` · `btDiscreteDynamicsWorld`;
solver info: `m_splitImpulse` 1 with `m_splitImpulsePenetrationThreshold` 1e30 (split impulse for every contact),
`m_solverMode` 0; `m_forceUpdateAllAabbs` false; gravity set from the wrapper's float ×0.02. Global hooks:
`gContactAddedCallback` = `FUN_14040a5f0`, `DAT_142352c20` = `FUN_140407f90` (warning printer).

## Upstream after 2.82 (inside the DNA window, for attribution)
`13936eb9` fuzzyZero uses ε² · `7151865c` GJK convex cast raytest flags · `0e1b90d7`/`0b6d1af1` SSE4/FMA solver rows ·
`7f3cbc06` sticky GJK workaround removed · `26019322` addConstraint filtering · `eb74688c` btCollisionShape
userIndex · `6cbf8990` clearForces after stepVelocities (2014-08-25).

## 2.82 vs 3.24 (the engine) on the game's simulation path
Differences that change results, beyond the Psyonix changes above (see each report's section 4):
- Restitution velocity threshold (B6): 3.24 zeroes restitution below 0.2 BU/s; 2.82 and the game have none.
- GJK normal fix (B7): 2.82 flips by AABB centres (the game replaces it for triangles); 3.24 removed the workaround.
- Compound without a tree (engine choice, B11) falls back to nested compound algorithms in 3.24.
- `needsCollision` checks both bodies in 3.24; ray vs convex uses the subsimplex cast in 3.24, the GJK cast in the game.
- EPA in 3.24 retries 9 guess directions when both EPA and the fallback fail (rare).
- Pair and manifold order: the game's depends on history (axis sweep, swap-on-remove); the engine sorts (patch 24).
- Maths: the engine routes sqrt/sin/cos/pow through `detmath`; the game uses the MSVC CRT (`powf` in applyDamping,
  `sinf`/`cosf` in integrateTransform). Last-ulp differences possible.
Equivalent at the engine's settings: split impulse always (threshold 1e30), erp2, solverMode 0, no gyroscopic force,
scalar row solvers, `integrateTransform` (3.24 guards |ω| < ~3e-4 rad/s only), sphere–box via GJK in both.

Found through this work in the engine (RocketSim's Bullet, not 2.82 vs 3.24 upstream), confirmed live 2026-10-08:
- RocketSim's `btBoxShape` constructor computed the implicit half extents with the default 0.04 margin before
  `setSafeMargin` lowered the margin (non-virtual `setMargin`, no correction), so every car box was 0.0677 uu too small
  per half extent (and its inertia off). The game's (2.82) order is right: live child box implicit 58.3207 / 41.4167 /
  17.3966 uu + margin 1.9330 = the hitbox half extents. Fixing it solved finding 27 (car–floor/corner contacts) and the
  car–ball touch threshold; car threshold 2.0334 uu as in the game.
- RocketSim had `getCacheEntry` hard-disabled (always −1). The game merges new points within the threshold (stock);
  confirmed live (point lifetimes).

## Live build (2026-10-06) — BinDiff
`out/bsim/bindiff/`: BinExport (built from source for Ghidra 12.1.2, private settings dir) of the 2026-06-16 project
and of the live exe (copied to `out/bsim/live-20261006/`, analysed in its own project `out/bsim/rl-20261006/`), BinDiff
result `rl-20260616_vs_rl-20261006.BinDiff` (SQLite). Overall similarity 98.78% (confidence 99.03%); 98,537 / 98,511
functions; 97,891 identical, 1,365 changed. Maps: `function_map.tsv` (every match), `cited_map.tsv` (every 0x14…/FUN_14…
address cited in `notes/*.md` and `engine/README.md`, 167 of them, all matched; mid-function addresses through BinDiff's
instruction matches), `changed_region.tsv`. Scripts: `out/bsim/scripts/bindiff_map.py`, `datamap.py` (globals and vtables
through aligned references in matched functions), `dispmap.py` (field offsets from aligned instructions).

- **Bullet is unchanged** in the update: the 10 "changed" functions in the Bullet region are tiny stubs matched to an
  identical twin, or UE3 code linked after Bullet. Bullet code moved by about +0xb00 (e.g. `updateAabbs`
  0x14027f4a0 → 0x14027ffa0). For tiny stubs BinDiff may pick an identical twin; take vtable-referenced ones from the
  vtable.
- **BinDiff similarity ignores operand constants**, so "identical" functions can still use different field offsets.
  Class layouts did change (from aligned instructions, `out/bsim/bindiff/dispmap_car.txt`):
  - `RBActor_TA` unchanged up to at least +0x780 (+0x690 `WorldContact`, +0x6ac, +0x780 `BulletRigidBody` verified
    live by the live session and by pattern match).
  - `Vehicle_TA` (+0x7c0…): **+0x18** up to the end of `Input` (`CarMesh` 0x7c0→0x7d8, `VehicleSim` 0x7c8→0x7e0,
    `StickyForce` 0x7d0→0x7e8, auto-roll torque/force 0x7d8/0x7dc→0x7f0/0x7f4, flags 0x7e0→0x7f8, `Input`
    0x7e4→0x7fc). `VehicleInputs` grew 0x20 → 0x24 (new dword at its end, live car+0x81c, copied by `SetVehicleInput`
    but not quantised), so `ReplicatedThrottle/Steer`, `InputRestriction` 0x804–0x806 → 0x820–0x822 (+0x1c) and
    everything from 0x808 on **+0x20** (`BoostComponent` 0x858→0x878, `DodgeComponent` 0x860→0x880, `AirControl`
    0x868→0x888, `JumpComponent` 0x870→0x890, `DoubleJump` 0x878→0x898, `NumWheelsForGrounded` 0x890→0x8b0,
    `TimeBelowSupersonicSpeed` 0x8a0→0x8c0).
  - The live packages no longer decrypt with `decrypt_upk.py` ("unknown compression method"), so layouts can't be
    recomputed from them yet.
- Changed cited game functions (logic aside from offsets not yet checked): car pre-physics `0x140f1c600` →
  `0x140f21a90` (0.992: the offset shifts above), `SetVehicleInput` `0x140f30a70` → `0x140f36790` (0.978: the new input
  dword), `0x140e386b0` → `0x140e39bc0` (0.937, input.md), `0x140eb6f80` → `0x140ebb410` (0.850, netcode.md),
  `0x140f06e50` → `0x140f0c070` (0.963, Boost component constructor).
- Data: `UWorld*` 0x1424a1308 → **0x1424ae6d0**; `gContactBreakingThreshold` 0x14224e008 → 0x14225b008 (still 0.02);
  Bullet settings 0x142351e8c/d → 0x14235ed4c/d; `gContactAddedCallback` 0x142351e68 → 0x14235ed28; warning hook
  0x142352c20 → 0x14235fae0; vtables: sphere 0x141a4dd70 → 0x141a53d70, finite plane 0x141a4eef8 → 0x141a54ef8,
  world 0x141a4f6d0 → 0x141a556d0.
- Functions cited in this file, 2026-06-16 → live: `14026c000` → `14026caf0` (est.) · `140270430` → `140270f30` · `140272130` → `140272c30` · `140277900` → `140278400` · `140278c90` → `140279790` · `14027ab70` → `14027b670` · `14027f4a0` → `14027ffa0` · `1402812a0` → `140281da0` · `140281490` → `140281f90` · `140281860` → `140282360` · `140283370` → `140283e70` · `140284940` → `140285440` · `140284bc0` → `1402856c0` · `1402867d0` → `1402872d0` · `140288b40` → `140289640` · `1402890e0` → `140289be0` · `14028aaf0` → `14028b5f0` · `14028b2f0` → `14028bdf0` · `14028bfe0` → `14028cae0` · `14028c320` → `14028ce20` · `14028cc30` → `14028d730` · `14028ccc0` → `14028d7c0` · `14028d570` → `14028e070` · `140290550` → `140291050` · `1402944b0` → `140294fb0` · `1402980c0` → `140298bc0` · `140299300` → `140299e00` · `14029ebe0` → `14029f6e0` · `1402a0ac0` → `1402a15c0` · `1402a0ef0` → `1402a19f0` · `1402a3d30` → `1402a4830` · `1402a58c0` → `1402a63c0` · `1402a5c00` → `1402a6700` · `1402a62c0` → `1402a6dc0` · `1402a6540` → `1402a7040` · `1402a7005` → `1402a7b05` (instr.) · `1402a74a0` → `1402a7fa0` · `1402ac650` → `1402ad150` · `1402af960` → `1402b0460` · `1402aff40` → `1402b0a40` · `1402b0130` → `1402b0c30` · `1402b0400` → `1402b0f00` · `1402b0670` → `1402b1170` · `1402b2340` → `1402b2e40` · `1402b2390` → `1402b2e90` · `1402b2720` → `1402b3220` · `1402b2e80` → `1402b3980` · `1402b7640` → `1402b8140` · `1402b7b40` → `1402b8640` · `1402b7c30` → `1402b8730` · `1402b7c60` → `1402b8760` · `1402b8bb0` → `1402b96b0` · `1402ba8d0` → `1402bb3d0` · `1402bad10` → `1402bb810` · `1402badc0` → `1402bb8c0` · `1402bc020` → `1402bcb20` · `1402bd390` → `1402bde90` · `1402be240` → `1402bed40` · `1402bfda0` → `1402c08a0` · `1402c0f40` → `1402c1a40` · `1402c1430` → `1402c1f30` · `1402c23a0` → `1402c2ea0` · `1402c29b0` → `1402c34b0` · `1402c2a40` → `1402c3540` · `1402c31f0` → `1402c3cf0` · `1402c3360` → `1402c3e60` · `1402c3a40` → `1402c4540` · `1402c4380` → `1402c4e80` · `1402c44b0` → `1402c4fb0` · `1402c49d0` → `1402c54d0` · `1402c5340` → `1402c5e40` · `1402d4000` → `1402d7ff0` (est.) · `140403cc0` → `14040a6c0` · `140407f90` → `14040e990` · `140409570` → `14040ff70` · `140409a84` → `140410484` (instr.) · `14040a5f0` → `140410ff0` · `140415030` → `14041ba30` · `140987da0` → `14098cd40` · `1409af240` → `1409b45a0` · `140eb8560` → `140ebc9b0` · `140eddd00` → `140ee25f0` · `140eed9e0` → `140ef2770` · `140f13c80` → `140f190b0` · `140f17910` → `140f1cd50` · `140f19b30` → `140f1ef70` · `140f1c600` → `140f21a90` sim 0.992 · `140f55040` → `140f5b120`

## Pending
- Logic review of the changed game functions above (beyond offsets), and the new `VehicleInputs` dword.
- Live tests of B1 and B5–B14 (live session).
