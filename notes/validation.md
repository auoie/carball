# Physics validation against replays

Our engine is compared with real matches: 90 ranked replays from June–September 2025 (60 1v1, 30 2v2,
standard-collision maps) from the replay dataset (see the `rl-replay-dataset` notes in HANDOFF). Run on 2026-10-06.

## How to run
```sh
python3 scripts/replay_pull.py out/replays                                   # newest replays out of the dataset zip
cargo build --release --manifest-path scripts/replay_extract/Cargo.toml
scripts/replay_extract/target/release/replay_extract out/replays/states.csv out/replays/*.replay
engine/build/replay_validate out/replays/states.csv --cases out/replays/cases.csv   # summary per category (~1 min)
python3 scripts/validation_report.py out/replays/cases.csv                   # accelerations, touch bias
```
`out/replays/` is git-ignored (replays hold player data). Options: `--no-sensitivity` (ignore the players' steering
sensitivity), `--no-warmup` (see below).

## Method (`engine/tools/replay_validate.cpp`)
- Replays carry the server's physics states exactly as the game quantizes them every tick (positions and velocities in
  0.01 steps, angular velocity × 100, 18-bit quaternion components). A replay frame's states go into the engine as they
  were on the server; the engine steps tick by tick and is compared with the next frame.
- Replays don't say how many physics ticks lie between frames. At 30 frames/s it's about 4, but `k − Δt × 120` ranges
  from −3 to +4, so `k` is fitted (best of 1..30).
- The car's and the ball's states in one replay frame are often from different server ticks (offset mostly 0 or ±2).
  For car cases the offset is fitted too (−6..6): the body with the older state is advanced alone first.
- Car cases: exactly one car within 400 uu of the ball, every other car at least 700 away; Octane hitbox (Octane,
  Fennec: 86% and 13% of cars in these replays); replicated inputs (throttle, steer, handbrake, boost) unchanged
  between the frames; no jump, double jump or dodge active. Pitch, yaw and roll are not replicated, so cars in the air
  are simulated without air control and reported separately.
- Warm-up: a car's wheel forces use values from its previous tick (the "wheel carry"), which a replay doesn't have.
  Without it the first tick has no drive or brake force (one tick's worth of acceleration missing). The tool computes
  them with one tick from the replay state, then puts the state back.

## Results (all patches in)
| Category | Cases | Ball position error p50 / p90 | Ball velocity error p50 / p90 | Car position error p50 / p90 |
|---|---|---|---|---|
| Ball in free flight | 174,058 | 0.000 / 0.001 uu | 0.00 / 0.01 uu/s | – |
| Ball touching the arena | 46,449 | 0.000 / 0.010 | 0.00 / 0.01 | – |
| Car on the ground, no touch | 5,453 | 0.000 / 0.010 | 0.00 / 0.01 | 0.19 / 3.1 uu |
| Car on the ground, touch | 614 | 0.12 / 1.7 | 4.0 / 55 | 0.29 / 2.8 |
| Car on the ground, dribble | 787 | 0.000 / 0.45 | 0.01 / 26 | 0.09 / 2.5 |
| Car in the air, no touch (no air control) | 3,917 | 0.000 / 0.010 | 0.00 / 0.01 | 0.001 / 1.4 |
| Car in the air, touch (no air control) | 258 | 0.77 / 3.8 | 25 / 163 | 0.21 / 3.8 |
(Errors after about 4 ticks. 0.01 is the replays' own precision. "Gravity only" for comparison: 0.1–0.4 uu
without touches, 20 uu with them.)

Ground driving (engine − game, uu/s², flat floor; `validation_report.py`):
| | Game | Error |
|---|---|---|
| Coasting (no throttle) | −525.8 | 0.0 |
| Full throttle, 400–800 / 800–1200 / 1200–1400 uu/s | 829 / 497 / 228 | +7 / +5 / +4 |
| Full steer, lateral, 500–1000 / 1500–2400 uu/s | 1732 / 3204 | −1 / +16 |

## Findings
1. **Ball physics is exact.** Free flight and every contact with the arena (floor, walls, curves, goals) match to the
   replays' precision. This includes the arena mesh we generated, drag, the per-tick quantization and the merged
   ball–world contact.
2. **Car driving matches.** Cars in the air without input are exact. On the ground, coasting deceleration (525.8) is
   exact, and throttle and steering are within about 1%. The remaining ~0.2 uu per 4 ticks comes from state a replay
   can't give (wheel carry, suspension).
3. **Steering sensitivity is applied in the physics**, as decoded: the replicated steer is the raw input. Applying the
   player's sensitivity fits better in 152 of 182 partial-steer cases where it matters.
4. **The ball was too bouncy on the car (fixed: engine patch 28).** The game computes the extra hit impulse from the
   bodies' start-of-tick velocities (`Car_TA.ApplyBallImpactForces` reads `OldRBState`). Stock RocketSim read them
   during the step, when they already hold that tick's gravity and car forces. Replays, 990 touches by cars on the
   ground, ball velocity error along the car-to-ball direction:
   - stock: median +3.03 uu/s (95% bootstrap interval 2.55–3.51); dribbles +2.55 (2.00–3.28), vertical +1.4 to +1.7;
   - patched: +0.18 (0.10–0.27); dribbles +0.01 (−0.01–0.10), vertical 0.00 to 0.06;
   - the patch reduced the error in 731 cases and increased it in 257.

   A ball resting on the roof has no relative velocity at the start of the tick, so the game adds no extra impulse.
   Stock RocketSim saw ~5 uu/s (gravity during the step) and pushed the ball up ~3.5 uu/s every other tick of contact:
   about 200 uu/s² of lift, a third of gravity.
5. **Inputs are bytes (engine patch 29, from the code).** `Vehicle_TA.SetVehicleInput` (`FUN_140f30a70`) stores every
   axis as 128 + q, q = round(v × 127) above zero and round(v × 128) below, and the physics reads the values back.
   Replays carry these bytes, so they confirm the encoding but can't show the rounding.
6. **The extra hit impulse is applied at most every other tick** of continuous contact
   (`Car_TA.OnHitBall`: `CurrentFrame − LastBallImpactFrame > 1`), as in RocketSim. The other variant (blocked on the
   first compared tick) fits worse: 7.1 vs 5.1 uu/s median.

7. **The ball stops (fixed: engine patch 30).** The game uses Bullet's stock deactivation for the ball
   (`updateActivationState` `FUN_1402c14a0`, `gDeactivationTime` = 2.0, default thresholds 0.8 BU/s = 40 uu/s and
   1 rad/s): after 2 s below both, the ball falls asleep and its velocity is zeroed. Replays: a ball placed at rest falls
   asleep 2.0 s later in 782 of 795 kickoffs (11 at 2.1 s). Competitive play never leaves the ball that slow during play,
   so the rolling case comes from the code. RocketSim woke the ball every tick unless its velocity was exactly zero: a
   slow ball rolled on forever. Cars never sleep (`Car_Default.bDisableSleeping`): no car fell asleep in 2,180 kickoff
   waits of about 4 s.
8. **Ball on the floor**, replays vs engine: sliding decelerates at about 230 uu/s² plus the 3%/s drag (replays 247 /
   268 / 298 uu/s² at ~600 / 1400 / 2400 uu/s; engine 250 / 271 / 301); rolling at 2.3%/s (engine 2.31%/s). A sliding
   ball can only start rolling below 6 rad/s × 91.25 = 547.5 uu/s (the ball's `MaxAngularSpeed`), so it slides until
   then. (These match a summary the user found: "230 uu/s² sliding, rolling about 2.2%/s, stops below 40 uu/s and
   10 RPM". The time before stopping is 2.0 s, not the 2.5 s it gave.)
9. **Car jitter against goal walls: in the vehicle model, not in our arena mesh.** A car pressing into a goal side wall
   with throttle, or resting on the curve where the goal floor meets its side or back, wobbles by up to 1.3 uu and
   1.7° from tick to tick (a wheel ray alternating between neighbouring triangles). The same scan on the game's own
   collision mesh (local measurement only) gives the same: 84 vs 93 spots with throttle, 29 vs 32 parked, same
   magnitudes. Replays have only 27 cases of slow cars with throttle by a goal side wall; the engine predicts them as
   well as elsewhere (0.32 uu median after ~4 ticks). Whether the game wobbles the same way can't be told from them.
   Not changed.

10. **The vehicle update (fixed: engine patch 31), found by reading the game's Bullet vehicle and confirmed here.**
    Six differences from RocketSim, each tested alone and together on the replays (car position error, median uu):
    | | Before | Pushback 1/60 alone | All six |
    |---|---|---|---|
    | Walls, curves, ceiling | 0.480 | 0.292 | 0.162 |
    | In a goal | 0.238 | 0.131 | 0.099 |
    | In a goal by the side wall (p90) | 0.348 (1.46) | 0.271 (1.27) | 0.124 (0.99) |
    | Near the ball, on the ground | 0.186 | 0.143 | 0.102 |
    | Flat floor | 0.050 | 0.050 | 0.032 |
    | Ball velocity after ground touches | 3.91 uu/s | 2.54 | 2.06 |
    The pushback's solver step (the game passes a default solver info: 1/60 s) mattered most; friction order, the raw
    axle and the ray length each helped further; the pushback reset and the minimum hit distance a little (better in
    more cases than worse in every category). Throttle acceleration error fell from +5–10 to +0.1 uu/s², and the last
    touch bias (+0.18 uu/s along the hit direction) to 0.00 (95%: −0.01 to 0.02).
    The goal-wall wobble is reduced (jittering spots in the scan 93 → 65, worst height wobble 1.34 → 0.69 uu) but a car
    pressing into a goal side wall with throttle still tilts by up to 1.7° per tick.
11. **Checks where the code alone would have misled.** `PhysicsConfig_TA.bUseAckermannSteering` is false in the
    package, which turns the car's Ackermann steering into the average angle at setup (`FUN_140f17d30`,
    `FUN_140ec7c00`). Replays say otherwise: per-wheel Ackermann fits better in 20,668 full-steer cases vs 3,907 (the
    online config presumably overrides it), so patch 8 stays. Likewise `FUN_1402c58b0` appears to give the front-right
    wheel the front-left wheel's frame, which would make turning asymmetric; the game turns symmetrically (lateral
    acceleration 1615 / 1583 uu/s² left / right at low speed, 2712 / 2712 at medium).

Cars alone (far from the ball and other cars), car position error after ~4 ticks, our mesh / the game's mesh
(before patch 31):
| Where | Cases | p50 | p90 |
|---|---|---|---|
| Flat floor | 95,490 | 0.050 / 0.050 | 2.99 / 3.00 |
| Walls, curves, ceiling | 14,580 | 0.49 / 0.45 | 3.35 / 3.37 |
| In a goal | 1,486 | 0.24 / 0.24 | 2.97 / 2.93 |
| In a goal by the side wall | 351 | 0.35 / 0.33 | 1.46 / 1.45 |
Walls and curves are less exact than the flat floor on either mesh: something in driving on curved surfaces (or state
a replay doesn't carry) differs. Next to look at.

## Limits and next steps
- Air control (pitch, yaw, roll) is not in replays: aerial touches and car rotation in the air can only be checked
  when the input was zero. Jumps, double jumps and dodges are skipped (the component flags say when they're active,
  not on which tick they started); they could be added by fitting the start tick.
- Touch residuals (~5 uu/s median) are dominated by what replays can't give: the car's exact sub-frame state and the
  car/ball tick offset (fitted).
- Not covered yet: car–car bumps and demos, cars on walls and the ceiling (included in "ground" when the wheels
  touch, not checked separately), non-Octane hitboxes, multi-car touches.
- Car driving on walls and curves: 0.16 uu median error after patch 31, still five times the flat floor's.
- Not validated: a ball left on a parked car's roof slowly rolls forward and off, because the game's impulse direction
  leans forward (`PushForwardScale`) and each touch after a bounce adds a little. Competitive replays don't have that
  situation.
