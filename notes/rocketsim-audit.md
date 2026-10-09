# RocketSim-only code vs RocketLeague.exe (static session, 2026-10-08)

The target is the exe; RocketSim is no reference. This audit isolates RocketSim's own changes in our engine and checks
each against the game (Bullet 2.82 + B1–B19, `notes/bullet-diff.md`; packages; decompiles). Method: pristine Bullet 3.24
(git archive) vs `engine/rocketsim/libsrc/bullet3-3.24` with every RL PATCH reverse-applied → 577 RocketSim hunks in 165
files (287 mechanical: formatting, signatures, removed virtuals/serialisation/debug; 290 reviewed by hand), plus
RocketSim's `src/` constants and behaviour without an RL PATCH. Each behaviour difference was tested with an env switch in
an engine copy against the live recordings (`out/live/*_20261008_*`, per-tick and continuous) and the replay validator
(648k cases). Sub-agent files local in `out/bsim/agents/R1/` (switches `R1_*`, diffs, runners, results).

**Status (2026-10-08):**
- **Adopted by the live session as engine patches 82–89** (RS-10, 3, 4, 11, 5, 2, 7, 1); see notes/validation.md
  finding 50.
- **Kickoffs and respawns refresh the tensor; plain SetState keeps it** (as Car_TA.Teleport does).
- **A replay regression was the validator's warm-up re-placement** keeping a one-tick-ahead tensor, now fixed.
  Afterwards the batch against HEAD is 470 better / 396 worse (all small); live is 28 better / 9 worse.
- **Open:** walls_021027 t125 needs per-wheel PhysLog columns and a re-recording.

## Findings (ranked by expected effect)

| # | What | Game | Ours | Effect / test |
|---|---|---|---|---|
| RS-1 | World inverse-inertia tensor after the tick's write-back | write-back `FUN_140f2fb50` sets origin ×0.02, basis via setRotation, lin/ang vel; **no** `updateInertiaTensor` → tensor stays from the last integrateTransforms (pre-quantisation basis; old pose after a teleport). Live: ball_5050 header's car tensor (+0x130) = R_prev·D·R_prevᵀ to 7 digits | refreshed in `Quantize.cpp:130` (RL PATCH 12) and `Car::SetState` (`Car.cpp:88`) | dropping the Quantize refresh, continuous: ball_5050 car pos p99 2.17 → 0.040 uu, vel 11.9 → 0.16, car2 vel 5.70 → 0.05, ang 0.243 → 0.0023; walls_011401/020943 vel 0.55 → 0.22; worse: walls_021027 0.21 → 0.31 (unexplained), car_car2 slightly. Carry the tensor in CarState/snapshots/NetState. Test: PhysLog the car's +0x130..+0x15c every tick incl. teleports |
| RS-2 | BVH traversal order | ctor `FUN_14026edf0` sets m_traversalMode (+0xd0) = 0, never changed → `reportAabbOverlappingNodex` (`FUN_14027be70`) walks stackless over 0..m_curNodeIndex | `btQuantizedBvh.cpp:321` always cache-friendly subtrees | same triangle sets, different order (→ manifold point order): ball-size queries 7.5 % (corners 10–27 %), car-size 3.1 %. Replays 33 better / 5 worse; live unchanged. One-line fix. Drop spots in `R1/work/bvhspots` |
| RS-3 | Wall friction curve breakpoint | package WallFrictionCurve 0→0.1, 0.707→0.5, 1→1 | `RLConst.h:513` 0.7075 | live per tick: car vel 38/18, ang 78/14 better/worse; replays neutral |
| RS-4 | Boost pads | Stadium_P prefab: small z 64.082016, big z 72; four small pads at (±1788, ±2302) | small z 70, big 73 (`RLConst.h:309-341`); (±1788, ±2300) | vertical cutoff small 160.08 vs 166, big 168 vs 169; car origin (1788, −2125, 17): ours picks up (175 uu), game not (177). Open: reference point (body origin vs actor location) |
| RS-5 | End-of-tick velocity cap | read-back `FUN_140eed9e0`, in uu after ×50: l2 = vy² + vx² + vz², v·(1/√l2)·max | BU before Quantize (`Car.cpp:352`, `Ball.cpp:165`) | 1.8 % of capped ticks one 0.01 quantum off; live 5/0 |
| RS-6 | Broadphase | btAxisSweep3 16-bit: AABBs snapped outward to 32 uu; statics keep creation AABBs; pair cache insertion order + swap-remove | btRSBroadphase, exact AABBs; plane AABB bands ±10 uu with a sign bug (`btStaticPlaneShape.cpp:46-52`: −axis normals → ceiling/+x bands to +∞) | contact sets equal. Game dispatcher order (incl. empty manifolds) fed into the island sort: bit-identical on all live recordings. Risks: islands/sleeping (ball within ~32 uu of a car's AABB shares its island in the game); rollback determinism (island ids depend on pair history) |
| RS-7 | WorldContact normal | rebuilt after the step from RBCollision records, all world geometry one record (`FUN_140f55040`, `FUN_140f13c80`) | last added point (`Arena.cpp:804`) | normalised sum over all world points with points: mismatching ticks 495 → 12 (hands), 119 → 31 (exhibition). Gates auto-roll/auto-flip only (`FlipCar.CanActivate`: Normal.Z > 0.707, Normal·Up < −0.966) |
| RS-8 | Bump/demo and ball-hit events | per actor pair at end of step, from manifolds with points incl. persisted | per added contact point | 0 ticks changed in recordings; edge cases only |
| RS-9 | Vehicle update inside each car's pre-tick | – | car2's _oldState includes car1's wheel impulses (feeds bump/ball-hit) | known GA item; not re-measured |
| RS-10 | Hitbox constants | Octane length 118.0074 + 2.5, offset 13.875660 / 20.754988 | 120.507, 13.8757 / 20.755 (`CarConfig.cpp:21, 32`) | ≤ 0.0002 uu; copy exact values |
| RS-11 | libm in deterministic paths (our fork) | – | `powf` (`Arena.cpp:394`, explosion falloff), `cosf`/`sinf` (`Car.cpp:143`, respawn offset) | WASM vs native may differ by 1 ulp → client/server divergence at goals and respawns |

## RS-12: why walls_021027 gets worse with RS-1 (follow-up, 2026-10-08)
- **The RS-1 rule is right and complete.**
  - All 43 PhysLog `_bullet.csv` header dumps: car tensor (+0x130) = T(interpolation basis +0x50) bit-exactly, not
    T(world basis +0x10). ga_jump's dump is at an ordinary tick (bases differ only by the rotation rounding; T(world)
    is off by 2.2e-8, T(interp) exact).
  - Statically, `updateInertiaTensor` (0x1402c4fb0) is reached only from `setCenterOfMassTransform` (called only by
    integrateTransforms) and Psyonix's `setMassProps` (0x1402c4380). Its game callers are `URB_BodyInstance::InitBody`
    (0x140964d80) and `RBActor_TA::SetMass` (0x140f2ff50: init, and welding in script).
  - Neither write-back caller refreshes it: per-tick post-physics `FUN_140f1c3c0` (gated on a flag at +0x230/+0x1ac
    bit 4) and the history restore `FUN_140f19b30`.
  - Rule: tensor = T(basis of the last integrateTransforms) = T(m_interpolationWorldTransform), after the rounding and
    after teleports.
- **The worsening is a second, tensor-independent difference exposed by the fix.**
  - At t125 (four wheels on the goal side-wall curve) per-tick mode has a 0.197 uu/s error, dv (0.18, 0.01, −0.08),
    dω (0.0040, −0.0001, 0.0037). It is the same under every tensor rule, R1's BVH, wall-0.707 and friction switches,
    and in the live session's current build.
  - The fixed continuous run tracks the recording closely enough to show it (0.206, same signature). The unfixed run's
    quantum-level drift cancels it (0.000).
  - In the car frame it is roll 0.0044 + yaw 0.0033 rad/s, +0.17 forward, −0.10 down: a left/right-asymmetric
    front-wheel force. Suspension tracks the game symmetrically, so the suspects are per-wheel friction or contact.
  - Open: needs per-wheel normals and impulses in PhysLog.
- **Not chaos:** with `R1_JITTER` (random 2e-6 rad tensor rotation per tick, 10 seeds) the unfixed run stays at
  0.199–0.205 and the fixed run at 0.310.
- **Corrected RS-1 evidence** (Quantize-only, continuous, all recordings, with jitter ranges):
  - robust: walls_011401/020943 0.551 → 0.224;
  - chaotic: ball_5050 (unfixed + jitter already spans 0.164–11.88), car_car2, human runs;
  - walls_021027 as above; the rest unchanged.
- **Validator artifact:** stale SetState in the validator (`R1_KEEP_INERTIA_SETSTATE`) diverges at tick 1 after the
  opening placement, where the engine's "previous pose" is its spawn pose (flip_cancel 0.01 → 44, jumps 0.11 → 28).
  Files: `out/bsim/work/inertia/`.
- **Placements (resolved):**
  - The PhysLog header is dumped after the placement write and before the first step: header z 1300.000 / 120.000 /
    17.000 with velocity 0; row 1 is one step later. So the header tensor belongs to the step a placement skips
    (row 0 → 1).
  - The validator's first simulated step (row 1 → 2) comes after the game's integrateTransforms refresh, so
    refreshing at placements is the right emulation. Seeding the header there is one step late.
  - Direct test (`R1_HEADER_STEP` in R1's validator copy): simulate the skipped step from the header's exact body.
    With the header's stale tensor, row 1's angular velocity is reproduced in 15 of 15 recordings (11 exact, 4 within
    one 1e-4 quantum). With a refreshed tensor every one misses, by 0.004–0.11 rad/s.
  - So a placement keeps the stale tensor for exactly one step.
- **The game's own teleports:**
  - Kickoff resets (`GameEvent_TA.ResetPlayers`: DestroyCars + RestartPlayer) and demo respawns (RestartPlayer, which
    destroys any old pawn) spawn a new car (`SpawnCar` → `CarArchetype.SpawnInstance`). Its new body gets
    InitBody → setMassProps, whose Psyonix version refreshes the tensor from the spawn transform: fresh. The engine
    should refresh at kickoffs and respawns.
  - `Car_TA.Teleport` (SetLocation, SetRBLinear/AngularVelocity 0, SetRBPosition, SetRotation/SetRBRotation) moves
    the existing body: stale for one step. It has no refresh path, and uses the same setters as the placements above.
    Used only by debug TeleportCar/ServerTeleportCar, `ClientUseItem` (Rumble items), `SeqAct_SpawnBot` (training
    bots) and `GameEvent_TA.TeleportCar` (spawn-point cycling).
  - The ball's tensor is isotropic: no effect.

## Checked and equal
GJK (2.82 + patch 52); speculative contact term off; no solver early exit; resolveSingleCollision; special contacts
(C1b; extra friction rows never solved); sphere AABB and bounding radius; convex–plane path (perturbation off);
planes ≡ 32768 boxes for contacts; static bodies → fixed solver body; devirtualisation tables; TestTriangleAgainstAabb2
axis order; wheel-ray candidates; VirxEC SphereTriangleDetector (zero change live and in replays); per-pair
friction/restitution (car–car 0.09/0.1, car–world 0.3/0.3, car–ball 2.0/0, ball–world 0.35/0.6, the last equal only
through RocketSim's min/max rule; the game's is friction = k·f0·k·f1 clamped ±10, restitution = max clamped 0..1,
`FUN_14040a5f0`, which matters under mutators); read-back getRotation / write-back setRotation, ×50 / ×0.02; UE3
curves (all CIM_Linear); wheel friction (slip threshold 5 uu/s, velocity at the hard point, TireFrictionScale 1);
friction impulse arithmetic order; suspension order; damping 0, additionalDamping off, sleep thresholds 0.8 / 1.0;
RollingFriction 0; pad radii; m_noRot (orientation only); AABB cache (rows 0–1 determine a rotation);
btPolyhedralContactClipping (formatting only, path unused).

## Open
Per-tick tensor log (RS-1, walls_021027); game island ids and world object array order; dispatchInfo
m_useContinuous; pad reference point and timing; ball sleep thresholds (RS-6 island test); WorldContact residuals
after the averaged normal; ball_5050 t626 0.22 uu/s (not solver order or notification; RS-1 suspected).
