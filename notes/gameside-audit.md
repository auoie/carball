# Game-side physics audit (static session, 2026-10-08)

Psyonix's game-side physics (the code above Bullet: car components, VehicleSim, Car_TA/Vehicle_TA scripts and natives,
body setup) read statically and compared with the engine (`engine/rocketsim/src`). Bullet itself: `notes/bullet-diff.md`.
Addresses are for the 2026-06-16 build; the 2026-10-06 update changed no game-side physics logic or constants
(`notes/bullet-diff.md`, "Live build"), so everything here holds for the live game. Line numbers are
`engine/rocketsim/src/Sim/Car/Car.cpp` unless stated. Sub-agent working files (decompiles, scenario files, engine
predictions, body tables) are local under `out/bsim/agents/G1…G4/`.

Status column: **open** = hypothesis, not yet tested live; values in parentheses are engine-only predictions.

## Hypotheses

| # | Mechanic | Game | Engine | Expected difference | Impact |
|---|---|---|---|---|---|
| GA-1 | Boost on the ground sets the **input** throttle to 1 | `Car_TA.SetVehicleInput` (script, before the quantiser): `if (IsOnGround() && NewInput.bActivateBoost && BoostComponent.ActivateDriveThrottle()) NewInput.Throttle = 1` (`ActivateDriveThrottle` = boost > 0 before this tick's use; `IsOnGround` = ≥ 3 wheel contacts from the previous tick). Every reader sees it: VehicleSim `FUN_140f1e830`, wall-friction skip `FUN_140f588f0` (`bStickyWheels && Input.Throttle ≠ 0`), sticky wall share `FUN_140eb70a0`, auto-roll gate `FUN_140f1c600` | throttle-or-boost only inside `_UpdateWheels` (505–509), with any contact count and after boost consumption; sticky (657), wall friction (624) and auto-roll (224) use the raw throttle (patch 32) | Boost with throttle 0 on a wall/curve: engine applies the wall friction curve (×0.1 vertical) and the 0.5 sticky factor, game holds full grip (engine slides; G2 synth: 5 → 368 uu/s apart over 40 ticks with steer). Landing while boosting with throttle 0: game idle-brakes on the landing tick (+4.45 vs engine +10.86 uu/s at 1317 uu/s) and on 1–2-wheel ticks. No auto-roll in the engine with 1–3 wheels. One tick when boost runs out. Already visible live: `steer_20261007_210526.csv` rows 2–7 `out_throttle` = 1 with raw throttle 0. Replays can't show it (replicated throttle includes the override) | high |
| GA-2 | Re-pressing jump | `OnJumpPressed`: ground jump needs `!bJumped`; `bJumped` clears only on `OnGroundChanged` (real landing, `FUN_140f5bd60`) or in pre-physics after the Jump component has been inactive ≥ `JumpLeaveGroundTime` 0.125 s while grounded. `OnJumpReleased` sets `bDeactivate`, which stays until the next activation; Jump PrePhysicsStep `FUN_140f1ba60` ends the jump once `bDeactivate && ActivityTime > 0.0249` even if pressed again | `_UpdateJump` (723–748): new ground jump whenever grounded and pressed (no `hasJumped` check; `hasJumped` reset at jumpTime ≥ 0.05); continuation uses the current button | Jump 3 ticks, release 1, press again while the wheels still touch (they do for 6 ticks): engine second jump (vz 296 → 592), game nothing and no double jump. Press 1, release 1, press: game 3 ticks of jump force, engine up to 24 | medium–high |
| GA-3 | Auto-flip (FlipCar) | `CanActivate`: `WorldContact.bHasContact && Normal.Z > 0.707 && Dot(Normal, Up) < −0.966` (relative to the contact normal); tried in `OnJumpPressed` only when the dodge is inactive; no restart while flipping; PrePhysicsStep `FUN_140f1ba00` ends it when `IsOnGround` (≥ 3 wheels) or after 0.4·|roll|/π s; air control stays active (no wheel contact), so its damping and the player's input act during the flip: plateau ≈ 5.5/1.03995 = 5.29 rad/s | `_UpdateAutoFlip` (1004–1021): world |Euler roll| > 2.8 rad (160.4°), no normal; can restart, ignores the dodge, timer only; air control off during the flip (811); 5.5 rad/s with overshoot | Roof on a curve: game flips, engine double-jumps. 160–165° on flat ground: engine flips, game double-jumps. Flat roof: 5.29 vs 5.50 rad/s; roll input acts in the game only | medium |
| GA-4 | Throttle deadzone | `FUN_140f1e830`: `t > 0.01` forward, `t < −0.01` reverse, else coasting (brake 0.15, 1.0 below 25 uu/s) → quantised bytes ±1 coast | `THROTTLE_DEADZONE = 0.001` (`RLConst.h:94`, `Car.cpp:521`) | Byte +1 at 1000 uu/s: game −4.38, engine +0.04 uu/s per tick; byte −1: game −4.38, engine −29.2; byte +1 from rest: engine creeps | medium |
| GA-5 | Air-control pitch lock after a dodge | AirControl ApplyForces `FUN_140eb3400` zeroes pitch while the dodge is active and for 0.3 s after it deactivates; the dodge deactivates on `IsOnGround` (`FUN_140f1b970`) | landing clears `hasFlipped` (865–870), removing the lock (826–832) | After a dodge that ends by landing at tick L (wavedash, flip into a wall), the game ignores pitch in the air until L+36; full-length dodges agree (unlock at press+115) | medium |
| GA-6 | Spawn/respawn position per body | `CarMeshComponentBase_TA.InitBodyAsset` translates the mesh by T = (HandlingPresetXOffset, 0, Tz) (Tz = `CalculatePresetSuspensionOffset` `FUN_140ecaeb0`); the Bullet body is created at the mesh component's world transform (`FUN_14098cf10` → `FUN_140964d80` → `FUN_140409570`), i.e. actor ⊗ T, and the actor then follows the body. So a new car (kickoff, respawn) starts displaced by T in its own frame; nothing else uses T | kickoff at (x, y, 17) (`Arena.cpp:189`), respawn z 36 (`Car.cpp:138`), no per-body offset | Z part confirmed by 30 replays: creation height 35.774 + Tz within 0.003 uu for 4 bodies (Octane 0.020, Dominus 0.010, Fennec 2.61, Plank-body 2.11). X part (untested): 18 bodies start shifted along their facing, e.g. body_aa +7.75, body_smoke +10.25, body_cured / body_fracture −12.5, body_cobaltdagger +5 | medium (X-offset bodies at kickoff) |
| GA-7 | Near-stall dodge impulse | `GetDodgeImpulse` `FUN_140eef310` zeroes each component of the normalised `DodgeDirection` only if ≤ 0.1; no raw-input check; `DodgeForward` quantised separately from pitch | 909–913 zero the impulse when `|yaw+roll| < 0.1 && |pitch| < 0.1` before normalising | Yaw 0.95, roll −1: game full side impulse (direction (0,−1)), engine torque only | medium–low |
| GA-8 | Air throttle vs boost state | AirControl runs before Boost (component order inferred from `DefaultCarComponents`: AirControl, Boost, Jump, DoubleJump, Dodge, FlipCar), so its air throttle uses the previous tick's `Boost.bActive` | this tick's boost state (240) | 0.556 uu/s on each air press/release with throttle 0 (press tick 8.264 vs 8.819) | low |
| GA-9 | Breakout rear rest length | LongCar box centre z 11.75 − rear `LocalRestPosition.Z` −5.91 → 29.66 (+12 convention) | `BACK_WHEEL_SUS_REST[BREAKOUT] = 29.666` (`CarConfig.cpp:58`) | Breakout rear ~0.006 uu high, rest pitch ~7e-5 rad (above the rotation quantum); every other preset/axle matches | low (just fix the constant) |
| GA-10 | Boost data | `BoostConsumptionRate` 0.333, `StartBoostAmount` 0.333 (fractions of 1) | 100/3 (`RLConst.h` 61, 65) | 361 vs 360 boost ticks from full; start 33.3 vs 33.33 | low |
| GA-11 | Dodge window end | `min(InactiveTime of Jump, Dodge, DoubleJump) ≤ 1.25` from the jump's deactivation (up to D+150) | `airTimeSinceJump < 1.25` (880) from the later of deactivation and leaving the ground | boundary ticks only | low |
| GA-12 | VehicleSim input state | throttle/steer read the forward speed from the capped, quantised RBState copy (`FUN_140eed9e0`) | raw body velocity | ≤ 0.011 uu/s; only at exactly 25 uu/s | negligible |
| GA-13 | Sticky gravity | `GetGravityZ` (actor) | `RLConst::GRAVITY_Z` (663) | mutators only | – |
| GA-15 | The demo tick: the victim still acts | `Car_TA.Demolish` (rejects only `IsDemolished()`) records and calls `QueueDemolish`, which defers `FinishDemo` to `EventPostPhysicsStep` while `bRunningPhysicsFrame` is set; `IsDemolished` (`DemolishDestroyTimer` active) is only set in `FinishDemo`. So the victim's own post-physics still runs `ApplyCarImpactForces(attacker)`, which never checks its own demolished state | `Arena.cpp:416-417` returns when either car `isDemoed`; the demo branch `continue`s (468–473), so the result depends on pair order | Mutual supersonic head-on: game **double demo**, engine one. Non-supersonic victim moving at the attacker with the attacker in its cone: game also **bumps the attacker** (attacker 2250 vs victim 1000 head-on: +793.9 along the victim's direction, +198.5 up) | high when it happens |
| GA-16 | Bump cooldown | `GetPhysicsTime() > LastHitTime + BumpInterval (0.25)`, `execGetPhysicsTime` 0x140e71b90 = `(1/120.f)·(float)PhysicsFrame`: after 30 frames the difference exceeds 0.25 by 1.3e-8, below float rounding, so in float32 a repeat bump is allowed at +30 in only 23 of 28,572 frame numbers (0–200,000; re-checked), otherwise at +31 | `cooldownTimer = 0.25` (`Arena.cpp:492-493`), −1/120 per tick in the same tick's `_PostTickUpdate` (`Car.cpp:288-289`): allowed at +30 | Continuous pushes (pinned against a wall): every repeat bump one tick early in the engine | medium |
| GA-17 | Car–car body order (B11) | Game logic doesn't depend on it (both cars get the contact; scripts use only `OldRBState` and `IsOnGround`). Bullet does: stock 2.82 `internalAddPair` sorts by the axis-sweep handle index, so **body0 = the car with the lower broadphase handle** (all 306 car–car manifold rows in the three two-car recordings have body0 = the player's car, spawned first). Handles: allocated at spawn, freed by `TerminateRBPhys` at the end of the demo tick, reused last-freed-first; each round `ResetPlayers` destroys all cars then respawns them | manifold (car1, car0) | Prediction: every kickoff reset reverses the cars' handle order; a demo + respawn gives the victim back its own handle | per B11 |
| GA-18 | Respawn | `PlayerSpawnSystem_TA` ticket of `RespawnDelaySeconds` 3 (360 frames) → `RestartPlayer`; spot from the team's `SecondaryStarts` ((±2304, ±2688, −4608), yaw 90°), start index `Rand(count)`, first spot not encroached (`SpotIsEncroached`), else the first free 192-uu offset in 8 directions (side choice when the player picked one); new actor and Bullet body, zero velocity, boost 0.333, `MoveToGround` (as kickoffs, ~38.6 measured); no demolish invulnerability in soccar | `Car.cpp:117-143`: `Math::RandInt(0, 4, -1)` from a clock-seeded thread-local generator (`Math.cpp:44-64`, not deterministic, not in snapshots); no encroachment check; z 36 (`RLConst.h:147`); frozen for one tick (`Car.cpp:169-177`) | Respawn height/first tick; cars can respawn into each other in the engine; the clone needs a seeded, snapshotted choice regardless | medium (determinism) |
| GA-19 | Supersonic flag after a bump | computed in pre-physics from the quantised velocity, which includes the previous tick's bump | `Car.cpp:271-285`, before `_FinishPhysicsTick` adds the impulse cache: one tick late | only a demo on the tick after a bump that crosses 2200/2100 | low |
| GA-20 | Two cars on one pad in a tick | the first car whose touch is processed takes it | the last colliding car (`BoostPad.cpp:72-73`) | tie-break only | low |
| GA-14 | Psyclops (body_tritip) | own preset (Octane box, rear wheels (−34.25, ±29.5) r 15, rest z −4.3) + `Mutator_Robin` (own VehicleSim, sticky 1.5, Robin jump/air control) | PSYCLOPS config: hitbox +0.134, rear x −33.75, z 15.0, rests 33.0/31.3 (game 33.005/31.305) | special mode only | – |

## Confirmed same (game code vs engine)
- **Tick order** (`FUN_140f1c600` → Bullet substep → vehicle update `FUN_1402c5340`): matches patches 41/51; the engine
  runs each car's vehicle update inside its own `_PreTickUpdate` (only another body's wheel-push impulse differs,
  < 0.3 uu/s). Per car: RB read-back, auto-roll, sticky, supersonic, jump-landing reset, then each component's
  PrePhysicsStep → ApplyForces(ActivityTime) → ActivityTime += dt (`SetActive` `FUN_140f2f370` resets it). Velocity
  changes read the start-of-tick state, so component order only matters for GA-8 and GA-3.
- **Throttle/brake:** drive curve with `VehicleSim_TA.OnAttached` adding (InVal±10, 0) at both ends → 1410 → 0
  (closes the "throttle top speed" open item); force per wheel curve × throttle × 288000 × 0.25 × 0.02, ×0.25 with < 3
  contacts; brake 10500 × 0.25 × 0.02 (1.0 against motion above 25 uu/s, 0.15 coasting, 1.0 coasting below 25); handbrake
  passes throttle, no brake, +5/s −2/s.
- **Steering:** curve(|fwd|) blended to the handbrake curve, shaped input, SteerFactor, no rate; Ackermann conversion
  (`FUN_140f17d30` → `FUN_140ec7c00`) = engine `AverageSteerCurve` (Octane = RocketSim's curve; all six presets
  recomputed in `out/bsim/agents/G2/work/expected_steer_curves.txt`).
- **Friction** (`FUN_140f588f0`, solver `FUN_1402c49d0`), **suspension/contact pass** (`FUN_1402c3360`, `FUN_1402c2a40`),
  **wheel setup** (`FUN_140f044e0`: hard point = (rest x, ±y, box centre z), rest = box z − LocalRestPosition.z,
  travel 12, max raise 2.5, min hit distance box z/2 − 1), NumWheelsForGrounded 3 (any surface).
- **Jump** (52500 impulse, 262500 force, 24 ticks held, 3 minimum), **double jump**, **dodge** (deadzone, direction,
  torques, cancel from 0.041 s, Z damping 0.15–0.21 s ×0.35, ends on ground or at 0.65 s, impulse scales 1.9/2.5, bases
  96000/90000, speed ratio /2300, backward rule at 100 uu/s), **air control** (torques, damping, pitch zeroed during
  the dodge; `bAirRoll` only gates auto-target), **boost** (178500 along start-of-tick forward, ground = air, active on
  the press tick, MinBoostTime 12 ticks, no supersonic gating), **supersonic** (≥ 2200 on, off after 1 s below or under
  2100; only gates demolition), **auto-roll** and **sticky** (formulas as patch 53, except the throttle source, GA-1),
  **FlipCar** values (Δv 200 along −up, Δω 1000·forward capped, 49 ticks at 180°). Torque component not in soccar;
  AirActivate unlimited. Car RollingFriction 0, DeltaGrav 0.
- **Body setup** (`InitBodyAsset`, `GetPhysicsAsset`, builder `FUN_140409570`): hitbox = the preset's physics asset
  when the body has one; one compound child box at the box translation (live read 13.875660 0 20.754988 = engine
  `hitboxPosOffset`); centre of mass = mesh component origin (no COM nudge); mass 180 for every car; inertia from the
  inflated child box (= engine). The six presets match `CarConfig.cpp` (hitbox = box + 2.5 within 0.0002, offsets, wheel
  x/y/radii, rests except GA-9). `HandlingPresetXOffset/ZOffset`, `SuspensionTravelMin/Max`,
  `bUseLegacySuspensionOffsets`, `SteerScale` (visual wheel turn), `ChassisSpring*`, `AdditionalAxles` are visual only
  (apart from GA-6). The variant presets (LongCar_aa etc.) are unused by every body in both builds. `Body_Darkcar`
  (no preset) is physically a Plank.
- **Online config:** the cached PsyNet config overrides no physics property (only a music-player debug flag).
- **Contact → script path** (`FUN_140f2aeb0`, one physics tick): pre-physics (RB read-back `FUN_140f1c3c0`:
  `OldRBState = RBState = quantize(Bullet)`, written back, `RBCollisions` cleared) → Bullet step `FUN_140418cf0` →
  `FUN_140ed91b0` turns manifolds with points into notifications (skips no-contact-response, sleeping or
  simulation-disabled bodies) → `FUN_1409a7db0` (UE3 DispatchRigidBodyCollisionNotifies) calls each actor's
  `OnRigidBodyCollision` (actor 1 with the normal negated) → `FUN_140f13c80` accumulates one record per other actor →
  post-physics (`FUN_140f19b30` → `FUN_140f55040`) fires the script once per (actor, other actor) per tick and rebuilds
  `WorldContact` → `EventPostPhysicsStep` (queued demolitions finish here). Script impulses go straight into Bullet
  (`FUN_14097f5c0`, `AddImpulse`) and are capped/quantised at the next pre-physics = the engine's
  `_velocityImpulseCache`. All script inputs are start-of-tick `OldRBState`, so actor order doesn't matter.
- **Ball touch:** `OnHitBall` once per car per tick; extra impulse only if `Frame − LastBallImpactFrame > 1`;
  `ApplyBallImpactForces` from `OldRBState` (relative speed cap 4600, Z 0.35, forward 0.65, push curve, mutator terms 0)
  = `Ball.cpp:246-297`; two cars in one tick both apply. Car–ball friction 2.0 / restitution 0 come from a Vehicle_TA
  contact hook (`FUN_140eb0fa0`, writing `Ball.CarInteraction` into the manifold point) = `Ball.cpp:257-258`.
- **Car–car formulas** = engine patches 5–7, 33, 34 (start-of-tick states, demo before cooldown, non-bumper hit starts
  the cooldown with no push, ground/air curves, Z push only on a grounded victim, `PushFactor` 0,
  `AddedCarForceMultiplier` 0, demos only on the other team, supersonic, forward speed ≥ 2100, backwards allowed); each
  car may bump the other once per contact, no double application. The demo tick's contact is solved normally.
- **Respawn constants** (3 s, spots, yaw, boost 33.3, zero velocity), **boost pads** (no pickup when full, not driving
  or demolished; re-checked every frame while touching; respawn `RespawnDelay × RespawnDelayScale` = 4 s / 10 s;
  amounts 0.12 and full), **ball** (max speed 6000, angular 6, no per-tick forces in soccar, ignores car contacts),
  `ApplyHitWallAdjustmentForces` empty. The live scripts differ only in stat/authority checks in `OnHitBall`, `BumpCar`,
  `Demolish`.

## Per-body table (live 2026-10-06; local `out/bsim/agents/G4/bodies_live.tsv`, `presets_live.tsv`)
235 body assets in 219 packages (507 of 520 body packages decrypt): MuscleCar (Dominus) 84, Octane 48, LongCar (Breakout)
39, Hybrid 27, Merc 14, Plank 11, no preset 11 (Body_Darkcar + 10 mystery placeholders on the Octane asset), own preset 1
(body_tritip). 33 use legacy suspension offsets. X-offset bodies (GA-6): LongCar body_aa +7.75, body_smoke +10.25,
body_pete +3.25, body_hero −5; Plank body_cured −12.5, body_fracture −12.5; Merc body_banjo +5, body_greenclaw +5; Hybrid
body_skunkz +6.5, body_wedding +5, body_bluetorque +3, body_sheepbolt +2, body_tagtiger +2; MuscleCar body_pixie +6.75,
body_macht +3, body_cutie +2, body_topple +2; Octane body_cobaltdagger +5 (new). New in the update: body_cobaltdagger
(Octane), body_neonmarmot (MuscleCar), body_safari (LongCar), all standard preset physics. Not decryptable yet
(unreleased): burnishedraven, opticorange, revivalline, trackspice; fancyflake, neptuneshell, sandscreen (old data only).
Old vs live: presets identical, no body physics property changed.

## Live recordings
One car, any time (the live session's scenario runner; scenario files and engine predictions in
`out/bsim/agents/G2/scenarios/`, `work/`):
- **GA-1:** boost-only on the side wall from rest (`car 4079 0 600 0 90 90 0 0 0 0 0 0 100`, `input 120 0 0 0 0 0 0 1 0`;
  control with throttle 1), boost-only drive up the wall with steer (`g2_boost_wall.txt`), landing while boosting with
  throttle 0 (`g2_boost_land.txt`). Measure z/vz, `out_throttle` (lags one tick), wheel contacts.
- **GA-2:** `car 0 -3000 17 0 90 0 0 0 0 0 0 0 100`, `wait 60`, then (a) jump 3, release 1, jump 20; (b) second press at
  P+5/P+6/P+7; (c) jump 1, release 1, jump 20 (`g2_jump_retap.txt`). Measure vz, `b_jumped`, jump/double-jump state.
- **GA-3:** flat roof `car 0 -2000 60 0 90 180 0 0 0 0 0 0 0`, `wait 120`, press jump 1 tick (roll ω per tick, hop, end
  tick, landing angle); same with roll ±1 held; 162° edge (`car 0 -2000 52 0 90 162 …`, expect game double jump); side
  curve at 30° (`car 3946 0 73 0 90 -150 …`, press on the 2nd tick, expect game flip).
- **GA-4:** throttle bytes ±1 at 1000 uu/s and from rest (`g2_throttle_byte.txt`).
- **GA-5:** wavedash then jump + pitch back (free driving through `live_validate`, or the scripted falling dodge).
- **GA-7:** `wait 60`, jump 10, wait 15, press jump with yaw 0.95 roll −1; sideways Δv on the press tick.
- **GA-8:** in the air (`car 0 0 1300 0 90 0 0 0 0 0 0 0 100`), boost 40 ticks, release; forward Δv on press/release
  ticks (also shows the component order).

Body switching (the user's batched sitting; the player's own car, a respawn after each switch):
- **LR-0:** dump every body product's ID, label and asset package (BakkesMod `GetAllProducts`), to map packages to IDs.
- **GA-6 / LR-1:** for Breakout (reference), body_aa, body_smoke, body_cured (or body_fracture), Octane, Fennec: switch,
  start a recording, force a new car (demolish → respawn or restart freeplay), record 2 s. Expect the header hitbox
  offset/extent and wheel rests to be the preset's (LongCar 12.5 0 11.75, extent 66.996 41.511 16.4), and the first
  RBState displaced along the car's forward axis by the X offset (z0 = z + vz²/1300 = 35.774 + Tz) relative to the
  reference at the same spot. Bots won't do (G4: a bot's hitbox is always the Breakout's).
- **LR-2:** body_aa `steer` + `body_drops` against the engine's Breakout config: expect the same errors as Breakout.
- **Steering curves per body (G2 L5):** after each switch + respawn, read VehicleSim (live car+0x7e0) +0xb0
  `SteerAngleCurve`, +0xf0 `HandbrakeSteerAngleCurve` (TArray; points 0x1c bytes, InVal +0, OutVal +4), +0xd0
  `DriveTorqueCurve` (5 points), +0x11c bit 0 (0 after init); also once after a switch without a respawn (the Ackermann
  conversion runs once per VehicleSim, so a body change on the same car might keep the old curves). Expected OutVals in
  `out/bsim/agents/G2/work/expected_steer_curves.txt` (Octane 30.5705 18.2943 10.4296 6.0559 4.8740 1.9792 | 22.4785
  7.2243; Dominus 29.9238 …).

Two cars (the player's Octane + `physlog_spawn <octane> bot` on the other team; ball parked with
`ball 3000 -2000 92.75 0 0 0 0 0 0`). PhysLog first: log each body's broadphase handle (car, car2, ball) in the header
and whenever it changes: `*(int*)(*(uintptr_t*)(body + 0xc8) + 0x18)`.
- **L0 T-bone reference:** `car2 0 0 17 0 0 0 0 0 0 0 0 0 0`, `car 0 -1000 17 0 90 0 0 1000 0 0 0 0 0`,
  `input 90 1 0 0 0 0 0 0 0`, `wait 40`; bot bump (0, 793.9, 0) + (0, 0, 198.5) uu/s.
- **L1 pin (GA-16):** `car2 4050 0 17 0 90 0 0 0 0 0 0 0 0`, `input2 0 0 0 0 0 0 0 0`,
  `car 3500 0 17 0 0 0 800 0 0 0 0 0 0`, `input 240 1 0 0 0 0 0 0 0`, `wait 30`; bot velocity jumps every 31 ticks
  (engine 30).
- **L2 head-on demo, slower victim (GA-15b):** `car2 0 300 17 0 -90 0 0 -1000 0 0 0 0 0`, `input2 1 0 0 0 0 0 0 0`,
  `car 0 -900 17 0 90 0 0 2250 0 0 0 0 100`, `input 60 1 0 0 0 0 0 1 0`, `input2 0 0 0 0 0 0 0 0`, `wait 420`;
  the player also gets (0, −793.9, +198.5) uu/s on the demo tick.
- **L3 double demo (GA-15a), last (the player's car may die):** `car2 0 600 17 0 -90 0 0 -2250 0 0 0 0 100`,
  `input2 1 0 0 0 0 0 1 0`, `car 0 -600 17 0 90 0 0 2250 0 0 0 0 100`, `input 60 1 0 0 0 0 0 1 0`,
  `input2 0 0 0 0 0 0 0 0`, `wait 420`; both demolished in the same tick.
- **L4 (GA-17):** after both respawn, repeat L0 and compare the car–car manifold's body0 and the logged handles.
- Replays: R1 count same-frame mutual demos (`replay_extract --demos`); R2 demos where the victim moved at the attacker
  (attacker in its cone, no bump in the previous 31 ticks): error with/without the victim's bump; R3 fit body0 per
  kickoff segment (prediction: flips at every kickoff reset, not at demos); R4 demo → respawn: 360 ticks ± 1, one of the
  4 secondary spots, never on another car, z ≈ 38.6.
- Without new data: re-run the existing `car_car` recordings with the car–car manifold forced to (player, bot).

## Open
- Component order (AirControl, Boost, Jump, DoubleJump, Dodge, FlipCar) is inferred from `DefaultCarComponents`; GA-8's
  test or a dump of car+0x270 → +0x78 settles it.
- `bOnGround` / `OnGroundChanged` also update in the per-frame Vehicle tick `FUN_140f51e30`; with several physics ticks
  per frame a jump on the first grounded tick could fail (server frame rate unknown).
- An undriven car (`!bDriving`) gets throttle 0, brake 0 (no idle brake), steer 0, and `FUN_140f2f610` attaches a 6-DOF
  constraint: the second car must be a driven bot.
- Non-Octane steering residual (validation finding 21) is not explained by the curves (G2 L5 above).
- `PhysicsConfig_TA` is online-overridable (`OnlineConfig_X`); the cached config has no override.
- GA-17's kickoff reversal assumes `Destroy()` frees the broadphase handle synchronously and that the body is created at
  spawn; GA-18's ~38.6 respawn height is assumed from kickoffs; the tail of `GetSpawnOrientation` (uneven teams) is not
  decoded; goal detection (`FUN_140f59720`, ball radius ≈ 94.5) not compared with the engine.
- Only Collision_Sticky (+_ForceBallGround), Goalpost_Post, Goalpost_Crossbar, Fence_Sticky and Glass_Sticky have
  `bStickyWheels`; the soccar arena collision is Collision_Sticky (27 refs in Stadium_P).
