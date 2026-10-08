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
sensitivity), `--no-warmup`, `--no-handbrake-history`, `--fit-handbrake` (see below), `--zero-ball-spin`.

Recordings of the live game (offline modes only; `tools/physlog/README.md`): a BakkesMod plugin records every tick's
car and ball state and full input in freeplay, from your own driving or scripted scenarios (`tools/physlog/scenarios`).
Copy the CSVs into `out/live/` (git-ignored) and compare:
```sh
engine/build/live_validate out/live/steer_<date>.csv              # state set from the recording every tick
engine/build/live_validate out/live/air_<date>.csv --continuous   # runs on from its own state (drift)
engine/build/live_validate --synth tools/physlog/scenarios/air.txt /tmp/air.csv   # our engine's own recording (exact)
engine/build/live_validate out/live/steer_sweep_<date>.csv --fit-steer         # per tick, the steer our engine needs
```
It first reports the recording's tick spacing, angular velocity units and whether a row is the start of its tick.
The player's steering and air control sensitivities shape the inputs inside the physics: PhysLog writes them into the
header and the validator applies them (`--steer-sensitivity`/`--air-sensitivity` for older recordings). Offline the
game leaves `RBState.Time` at 0, so rows are timed by their tick counter.

Car–car (bumps and demolitions, finding 17), here over the 602 replays in `out/replays/more` (2v2/3v3 heavy),
states piped so no large CSV is written (~20 s with 8 batches in parallel):
```sh
scripts/replay_extract/target/release/replay_extract --demos out/replays/demos_more.csv /dev/null out/replays/more/*.replay
scripts/replay_extract/target/release/replay_extract /dev/stdout BATCH.replay... \
  | engine/build/replay_validate /dev/stdin --carcar BATCH.csv --demos out/replays/demos_more.csv
```

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
  them with one tick from the replay state, then puts the state back. (Since patch 31 friction no longer uses the
  previous tick's values; the warm-up still sets the other per-tick state.)
- Handbrake ramp: the handbrake value rises 5/s while held and falls 2/s after release, and only the held flag is
  replicated. The extractor integrates it frame by frame from the flag's history (each change taken halfway between
  the frame it arrived in and the one before) into the `handbrake_ramp` column; `--no-handbrake-history` uses 0/1 instead,
  `--fit-handbrake` also searches the best value for car-alone cases (diagnostic). The ramp is known to about a frame
  (±0.08), which matters while it changes: lateral grip drops to 10% at full handbrake.

## Results (all patches in, handbrake ramp from the history; latest run, arena mesh with the game's tessellation)
| Category | Cases | Ball position error p50 / p90 | Ball velocity error p50 / p90 | Car position error p50 / p90 |
|---|---|---|---|---|
| Ball in free flight | 174,058 | 0.000 / 0.001 uu | 0.00 / 0.01 uu/s | – |
| Ball touching the arena | 46,449 | 0.000 / 0.010 | 0.00 / 0.01 | – |
| Car near the ball, on the ground, no touch | 5,539 | 0.000 / 0.010 | 0.00 / 0.01 | 0.011 / 2.9 uu |
| Car on the ground, touch | 546 | 0.075 / 1.5 | 0.46 / 54 | 0.022 / 2.8 |
| Car on the ground, dribble | 790 | 0.000 / 0.40 | 0.01 / 20 | 0.010 / 2.1 |
| Car in the air, no touch (no air control) | 4,111 | 0.000 / 0.010 | 0.00 / 0.01 | 0.000 / 1.2 |
| Car in the air, touch (no air control) | 228 | 0.69 / 2.9 | 17 / 106 | 0.16 / 2.7 |
| Car alone, flat floor | 95,526 | – | – | 0.010 / 2.2 |
| Car alone, walls, curves, ceiling | 15,708 | – | – | 0.046 / 2.2 |
| Car alone, in a goal (by the side wall) | 1,482 (346) | – | – | 0.020 / 1.5 (0.030 / 0.58) |
(Errors after about 4 ticks. 0.01 is the replays' own precision. "Gravity only" for comparison: 0.1–0.4 uu
without touches, 20 uu with them.)

Flat floor by situation: straight, no handbrake ramp 0.000 / 0.52 (32,452); steering 0.030 / 0.42 (37,345);
powerslide fully engaged 0.015 / 0.73 (157); handbrake ramping 0.97 / 4.9 (18,321: its value is only known to a frame).

Ground driving (engine − game, uu/s², flat floor; `validation_report.py`):
| | Game | Error |
|---|---|---|
| Coasting (no throttle) | −525.8 | 0.0 |
| Full throttle, 400–800 / 800–1200 / 1200–1400 uu/s | 847 / 506 / 238 | 0.0 / 0.0 / 0.0 |
| Full steer, lateral, 100–500 / 500–1000 / 1500–2400 uu/s | 760 / 1702 / 3040 | −0.6 / −1.7 / −2.5 |

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
11. **Steering: the average angle, as the code says (corrected).** `PhysicsConfig_TA.bUseAckermannSteering` is false in
    the package, which turns the car's Ackermann steering into the average of inner and outer angle at setup
    (`FUN_140f17d30`, `FUN_140ec7c00`). A first replay test favoured per-wheel Ackermann (20,668 vs 3,907 cases), but it
    ran before patch 31 and the handbrake ramp: per-wheel angles were partly compensating the friction lag. Re-tested
    afterwards, the average wins in every category (35,026 cases better, 13,584 worse) and removes a low-speed turning
    deficit: full-steer lateral acceleration error −18 / −20 / −13 / −7 / −4 uu/s² (50–300 … 1500–2400 uu/s) became
    +3 / +1 / +2 / 0 / −2; flat floor 0.020 → 0.010 uu, goals 0.075 → 0.038, near the ball 0.041 → 0.020. Lesson:
    re-test earlier decisions after fixing other things. Separately, `FUN_1402c58b0` appears to give the front-right
    wheel the front-left wheel's frame; with equal front angles that changes nothing, which fits the game's symmetric
    turning (1615 / 1583 uu/s² left / right at low speed).
12. **Powerslide matches; its error was the hidden handbrake ramp.** With the handbrake held the error looked large
    (median 4.27 uu with the ramp taken as 0/1). With the ramp reconstructed from the flag's history it is 0.43, the
    best possible ramp value per case gives 0.054, and fully engaged powerslides (ramp certainly 1) are 0.015 with a
    lateral acceleration error of −2 to −5 uu/s²: the slide physics is right. The ramp also explained much of what
    looked like steering and wall error (cases just after a powerslide); accounting for it improved every category
    (table above; e.g. touches 2.06 → 0.85 uu/s, flat floor 0.032 → 0.020 uu).

13. **Car touches are exact when the car is; the tail comes from the car's own prediction.** Ground touches where
    both sides kicked the ball (967): median error 1.45 uu/s (0.4% of the kick, 0.09° in direction), p90 22% / 5.3°.
    Split by how well the car itself was predicted (its position error at its own best tick):
    | | Cases | Ball velocity error p50 / p90 | Of the kick p50 / p90 | Direction p50 / p90 |
    |---|---|---|---|---|
    | Distinct hits, car within 0.1 uu | 314 | 0.30 / 1.0 uu/s | 0.0% / 0.1% | 0.00° / 0.0° |
    | Distinct hits, car off by ≥ 0.5 uu | 141 | 24 / 135 | 2.2% / 13% | 0.5° / 4.4° |
    | Continuous contact (dribbles), car within 0.1 uu | 309 | 0.74 / 21 | 1.0% / 29% | 0.3° / 4.9° |
    | Continuous contact, car off by ≥ 0.5 uu | 108 | 21 / 59 | 18% / 48% | 4.8° / 17° |
    The car is mispredicted just as often without a touch (25.5% of cases near the ball vs 25.3% with one), and the car's
    velocity error along the hit direction is unbiased (median −0.03 uu/s): the contact physics is right. In continuous
    contact a tail remains even with a well-predicted car, from state a replay doesn't carry (persistent contact points,
    the phase of the every-other-tick extra impulse). The car misprediction itself: handbrake ramping (63% of those cases
    are off by ≥ 0.5 uu), walls and curves (35%), and otherwise ~20% — next to investigate.
    (`replay_kick`, `engine_kick`, `kick_angle` in the cases file.)

14. **Pinches match.** Pinch = a car touch with the ball against an arena surface (within 40 uu) and a kick over
    1500 uu/s. Mined from 600 more 2v2/3v3 replays with `--min-replay-kick 2500` (`out/replays/more/`): 303 pinches,
    74 with the car on a wall or curve, fastest 5437 uu/s (game) vs 5436 (engine). Engine kick / game kick:
    | | Cases | p50 | p10–p90 | Direction p50 / p90 |
    |---|---|---|---|---|
    | All | 303 | 1.0000 | 0.997–1.002 | 0.03° / 0.4° |
    | Car predicted within 0.1 uu | 212 | 1.0000 | 0.999–1.001 | 0.02° / 0.1° |
    | Car on a wall or curve, predicted well | 40 | 1.0000 | 0.997–1.001 | 0.04° / 0.1° |
    | Kick over 4000 uu/s, car predicted well | 36 | 1.0000 | 1.000–1.000 | 0.00° / 0.0° |
    (The first 90 replays: 117 pinches, same result.) No ceiling pinches or 6000 uu/s pinches in these replays.
15. **Flips, jumps and double jumps are now covered.** The extractor records the replicated DodgeTorque (×100 it is
    the rounded flip torque, roll and pitch, e.g. 184 / 158) and when each jump, double jump and dodge component turned
    on (frame resolution, halfway estimate); the validator sets the car's flip/jump state from them (flip torque for
    0.65 s, Z damping, jump force while held). Cases where a component turns on or off between the two frames are
    skipped (7018). Flip cancels can't be modelled (pitch input isn't replicated). Car position error after ~4 ticks:
    flipping on walls/curves 0.010 / 5.9 uu (4464 cases), flipping near the ball 0.030 / 7.1; **jumping from the flat
    floor 3.99 / 18 uu (146 cases): off, to investigate** (jumping on walls/curves 0.08).

16. **Jumps and flips match; their errors were start timing.** Like the jump flag, a car's components replicate
    separately from its state, so the flag can arrive before the state shows the action. Jumps: a car flagged as
    jumping that isn't moving up yet hasn't jumped in that state; pressing jump at a fitted tick (0–8) brought floor
    jumps from 3.99 to 0.29 uu (median, p90 17.6 → 5.7). Flips (`--fit-flip-time`, diagnostic): late in the flip
    (≥ 0.3 s) the engine is exact as is; earlier, fitting the start time (±8 ticks) or a dodge that starts during the
    interval (stick direction from DodgeTorque) brings the median to ~0.02 uu and the p90 from 12–26 to 1.2–4.6.
    The dodge impulse, flip torque and Z damping are right.

17. **Bumps and demolitions match (engine patches 33, 34 from the code).** The car–car pass takes two cars close
    together (closest approach within 250 uu over the interval), far from other cars, and simulates them together
    and each alone; the ball is simulated too when near. The tick offset between the two cars is fitted (−6..6).
    Rows that exactly repeat a moving car's previous row (stale states) are skipped. Over the 692 replays (5,192
    cases, deduplicated):
    - **Bumps:** where both the engine and the game show one, with both cars on the ground, the worse car's error is
      0.43 uu (median; p90 6.4) with our bump against 28 uu without it; velocity error 8 uu/s median. With a car in
      the air: 2.2 vs 17.7 uu (air control isn't in replays).
    - **The attacker loses speed in a demo, as in our engine.** The demo tick's contact is solved: attacker error
      1.33 uu with it, 6.99 uu with the victim removed before the solve (1,549 demos; better in 1,050 vs 27).
    - **The demo cone is tested at the time of impact (patch 33).** `ShouldDemolish` sweeps both cars (Bullet's
      continuous convex cast) from one tick before to one tick after their start-of-tick states; bumps use the
      start-of-tick states. It reproduced 23 more of the game's demos, with no new false ones.
    - **Supersonic lasts 1 s below 2200 (patch 34).** The game's timer counts time spent below 2200 while
      supersonic (`TimeBelowSupersonicSpeed`); RocketSim's counted from becoming supersonic, so after a second of
      supersonic it ended just below 2200. 128 replay demos were made at 2100–2200 by attackers that RocketSim's
      rule calls not supersonic. With both patches the engine demolishes in 1,219 of the 1,549 cases where the game
      did (from 1,150) and in 49 of 3,248 opponent pairs where the game didn't (from 47). Most remaining misses
      have the attacker's inputs changing between the frames (often starting to boost), which the run can't know.
    - Speed clamp timing (not car–car, checked alongside): top-speed boosting cars on the flat floor match to
      0.010 uu (median, 1,384 cases). The game, like the engine, clamps after integrating the position.
    - Validator fix: the car-alone loop iterated over a temporary copy of the replays, so the descriptive columns
      of 2.7% of car-alone rows in `cases.csv` (speed, inputs, handbrake) read freed memory. Errors were unaffected.

18. **Walls and curves: the arena mesh's tessellation (fixed in `scripts/arena_gen.py`).** After patch 31, cars on
    curves were still 0.22 uu off (median) against 0.010 on the flat floor, with 0.29° of rotation error, and it
    didn't depend on inputs. Warming the wheels up from the previous replay frame changed nothing (0.193 → 0.197),
    but the game's own mesh brought curves to 0.067: our generated mesh was the difference. Its shape was within
    ~0.1 uu, but the game tessellates every 90° arc as a cubic Bézier sampled at t = i/8 (angles 11.617°, 22.892°,
    …; facets up to 0.38° off uniform 11.25° steps), and its corner arcs are Béziers too, not the circles we had
    (notes/arena.md). With both, and the goal ramp starting at 234.67, our mesh is as good as the game's:
    | Where (cars alone) | Cases | before | now | game's mesh |
    |---|---|---|---|---|
    | Side-wall floor curve | 2,462 | 0.171 | 0.058 | 0.057 |
    | Corner curve | 1,516 | 0.417 | 0.090 | 0.084 |
    | Back-wall floor curve | 1,029 | 0.166 | 0.079 | 0.066 |
    | Vertical walls | 6,511 | 0.036 | 0.020 | 0.020 |
    | Goal floor | 1,127 | 0.020 | 0.010 | 0.010 |
    All walls/curves/ceiling: 0.117 → 0.046 (p90 2.25 → 2.23).

19. **Double jumps match; their errors were start timing too.** Like the jump flag, the double jump component's flag
    can arrive before the state shows the impulse. Both passes now also try the double jump (jump pressed, no stick)
    starting at each tick 0–8 of the run when the flag is under 0.1 s old. Cars alone: p90 12.7 → 0.25 uu (median
    0.000); near the ball, no touch: median 2.24 → 0.000 (p90 5.8 → 2.0); touches: ball velocity p90 119 → 21 uu/s.
20. **Boost pads and kickoffs (engine patches 35–37).** Pickups reach 176 uu for small pads (the level's 128 radius
    + the car's 48), 208 for big ones; the kickoff ball sits at z 92.75; cars get no input for 4.0 s after a kickoff
    reset (notes/physics-values.md, Boost pads and Kickoffs). Extractor: `--pickups PICKUPS.csv` writes every
    replicated pad pickup state.

21. **Other car bodies: RocketSim's presets fit; steering is a little off.** `--bodies OUT.csv` runs every
    non-Octane-hitbox car alone with each of the six presets (the replays don't say which preset a body uses).
    Over the 602 extra replays (~51,000 cases) every body has a clear best preset. Bodies 11603 and 6939 are
    Octanes (0.010); 403, 4770, 1286 and 3426 are Dominus; 803 Plank; 11505 Breakout; 1919 is nearest the Plank but
    fits it worse (0.090 on the floor), probably a preset variant RocketSim doesn't have (the game has many, some
    with other hitbox offsets, e.g. `LongCar_Aa`). With the right preset, straight driving is exact (0.010 or
    better), but steering is 0.032 (Dominus), 0.045 (Breakout) and 0.057 (Plank) against the Octane's 0.010. Not
    the inertia: the Octane's inertia on the other presets makes them 4× worse. The presets match the game's data
    (hitbox = PhysAsset box + 2.5; wheel x/y and radii equal; wheel z offset by the same 12 for every preset).
    Open.
22. **Input changes between frames: throttle matches; steering changes are inexact.** The car-alone pass now also
    runs cases whose inputs change between the frames, switching from the first frame's inputs to the next frame's
    at the best tick (0–8; ~275,000 cases, categories `car alone input change/...`). Flat floor: throttle changes
    0.020 uu (median), boost 0.050, steering 0.090, handbrake 0.19 (its ramp is only known to a frame), several at
    once 0.22. The best tick is often 0 or past the compared state: like the components, replicated inputs don't
    line up with the states. Steering changes stay at 0.08–0.12 even when both values are digital (−1/0/+1), with
    no steering rate in the vehicle data (`VehicleSim_TA` has only `HandbrakeRate`) or the input classes found.
    Analog input also changes within a frame, which two samples can't show. Finding 23 found one cause (a steer
    change gripped too hard for one tick, engine patch 38); it moves these medians only by ~0.003 uu, so the rest is
    what replays can't show.
23. **Live recordings (2026-10-07): steering exact, after one fix.** Scripted freeplay runs through the PhysLog plugin
    (`steer`, `steer_sweep`: held steer values 0.05–0.9 at ~1000 and ~1850 uu/s), state set from the recording every
    tick:
    - The game used `min(1, 1.40 × steer)` — the player's steering sensitivity (1.4 in this profile), applied in the
      physics on the byte-quantized input (`out_steer` = 1.4 × 13/127 for 0.1, 1.4 × −26/128 for −0.2): finding 3's
      shaping and the input quantization, confirmed live. Front wheel angles change at once (no steering rate).
    - With the sensitivity applied, steady steering matched exactly, but the first tick after a steer change was off
      by up to 1.6 uu/s: the game responded only ~95% as strongly (~98–99% at 1850 uu/s). VehicleSim rebuilds the
      wheels' bases from the new angle before measuring their slip; RocketSim measured along the previous tick's
      axles (engine patch 38). After it, worst tick 0.04 uu/s and 0.0006 rad/s, position 0.01 uu — the game's own
      per-tick quantization.
    - Replays, paired per case: steering changes on the floor better in 18,747 cases, worse in 13,734 (median
      −0.006 uu); handbrake changes 1,987 / 1,076; no category worse beyond noise.
24. **Live recordings: jumps, flips and landings tick-exact (engine patches 39–42).** The `jumps` scenario (jump,
    double jump, front/back/side/diagonal flips, a flip cancel, a flip at speed while boosting), signed per-axis
    errors (`--ticks`) per tick, state set from the recording every tick:
    - Flip press tick: the game turns the car by exactly the dodge torque for one tick (224/120 = 1.867 rad/s); ours
      ran air control first. Z damping in the game from the 18th tick after the press to the 78th (vz held at
      −15.48, the fixed point of damping then gravity); ours a tick earlier at both ends (35 and 5.4 uu/s). The
      decompiled dodge gets one ActiveTime for cancel and damping: the time active before the tick (patch 39).
    - Air control keeps running during the dodge with pitch forced to 0: yaw torque on a side flip's press tick
      (95 × CAR_TORQUE_SCALE / 120 = 0.076 rad/s), pitch damping after a front flip's press tick (0.045) (patch 42).
    - Jumps: the game gains 291.67 + (1458.33 − 650 − 325)/120 uu/s on the press tick and 4.02 per tick after:
      full jump force from the start (RocketSim's 0.62 ramp, patch 40), and no suspension support on the press
      tick. The sticky force still acts on the first tick the rays find no contact and not yet on the first tick
      they find one (2.71 = 325/120 uu/s), and a boosted liftoff tick still uses the ground boost (0.55 uu/s):
      the car's pre-physics step runs on the previous tick's contacts, before the vehicle's rays (patch 41).
    - Recorded wheel contacts equal ours on every tick (0 mismatches over 14 liftoffs and landings): the game casts
      its rays at the start of the tick, like the engine.
    - After: car velocity p99 4.9 → 1.07 uu/s, angular velocity p99 0.045 → 0.002 rad/s; left is the car body
      meeting the floor. Run continuously (`--continuous`), the engine stays on the game's path through every jump,
      flip and wheel landing; it drifts only where the hitbox strikes the floor (a flip's nose into the floor, the
      tumble after a landing, up to 260 uu/s). The per-tick mode's single-tick spike on a nose-first landing is an
      artifact of resetting the state (Bullet's persistent contact carries our own history): that landing is exact
      when run continuously. `steer`, `steer_sweep`, `air` and `powerslide` stay exact.
    - `flip_cancel`: stick back from the 4th tick after the press doesn't cancel, from the 5th it does, as patch 39
      has it (no error on either tick).
    - Replays, paired per case against patch 38 alone: cars alone on walls/curves/ceiling 0.046 → 0.024 uu (better
      in 4,916 cases, worse in 1,651; the note under finding 22's table, "walls and curves are less exact than
      the flat floor", was largely the sticky force switching a tick early), in goal 0.020 → 0.011, jumping on walls 0.080 → 0.014, jumping
      dribbles 0.375 → 0.059, jumping without a touch 0.108 → 0.016; all categories 26,080 better / 15,667 worse.
      The air-control change (patch 42) is neutral there (replays carry no pitch/yaw/roll input).
25. **Car body on the floor: contact points never persisted (engine patch 43).** `body_drops` drops the car with no
    input onto its roof, nose, side, a corner while moving, its roof while sliding and while spinning
    (`live_validate --continuous`; `--contacts FROM-TO` prints the car's contact points and lowest corners).
    - Edge and corner hits matched (nose down 0.16 uu/s, corner 0.2), flat ones didn't: on a flat roof landing the
      first tick matched exactly (one corner touches), the second was 176 uu/s off. The game's convex-vs-plane
      contact code is stock Bullet plus a finite-plane bounds check (`FUN_1402944b0`), one new point per tick like
      ours, and its collision configuration has no multipoint perturbation (adding it made the first tick 360 off).
    - The difference was persistence: our manifold held one point per tick, always lifetime 1, cycling through the
      roof's corners even at rest. RocketSim's broadphase removed every pair at the start of each tick (destroying
      the algorithms and their manifolds); the game's axis sweep keeps them. Keeping overlapping pairs: the flat
      landing's second tick 176 → 0.1 uu/s, the spinning roof landing 65 → 0.1, `body_drops` p90 46 → 6.8.
      `jumps`, `flip_cancel`, `walls` and `ball_roof` are bit-identical either way (single-point contacts).
    - Left in continuous mode: a flip driving the nose into the floor (`flip_cancel` tick 152, 88 uu/s) and the
      tumble after it — single-corner contacts, so something else.
    - The live game's executable changed on 2026-10-06 (39,389,184 bytes, vs 39,334,912 for the 2026-06-16 build the
      static analysis used). Byte windows of the physics functions are mostly found in the new one (Bullet's 15–16
      of 16, the game's 7–11, as expected for moved code); everything decompiled so far matched the live game.
26. **Car–ball touches: exact, after the touch threshold (engine patch 44).** `ball_hits` (straight, glancing,
    boosted, jumping, a ball rolling into a parked car, a ball dropped on a moving car): every touch tick exact per
    tick, and run continuously the car stays within 0.05 uu and the ball within 0.16 uu over 869 ticks.
    - `ball_roof` (a ball bouncing on a parked car's roof): the game adds the car's extra hit impulse (OnHitBall,
      every other tick while touching) on ticks where our car–ball manifold has no point: Bullet's own distance at
      the start of those ticks was 1.928, 1.921, 1.930, 1.943 uu, over our threshold of 1.905 (the ball's: RocketSim
      gives the sphere a bounding radius of r + 0.08 BU). The game kicked at every start distance ≤ 1.943 and never
      at ≥ 1.990: its car–ball threshold is 1.943–1.990. With the sphere's bounding radius at r + 0.118–0.122 BU
      (threshold ~1.945 uu) every kick matches and the ball's continuous error drops 21.8 → 0.38 uu; at 0.125 a wrong
      kick appears. The game's ball rests 1.90 uu above the floor, just under its threshold, which bounds the
      ball's threshold to 1.90–1.95: consistent. Replays with +0.12 (paired): 91 better / 52 worse, dribbles 58 /
      33, ball–arena contacts unchanged (13 cases move from free flight to arena contact; same percentiles).
      Adopted (2026-10-08): `ball_roof` worst ball tick 95 → 6 uu/s, continuous 21.8 → 0.38 uu; dribbles' ball
      velocity p90 20.0 → 15.2 uu/s. Left: two ticks of the ball rolling off the roof onto the floor (≤ 6 uu/s).
    - The game's second global Bullet hook (`FUN_140407f90`) is its warning printer, not a contact callback; its
      contact-added callback (`FUN_14040a5f0`) only sets friction/restitution and flags special contacts.
    - `live_validate` now also treats a ball-only placement and a car turned in place as placements.

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
  when the input was zero, and flip cancels can't be modelled.
- Touch residuals (~5 uu/s median) are dominated by what replays can't give: the car's exact sub-frame state and the
  car/ball tick offset (fitted).
- Not covered yet: multi-car touches, bumps with three or more cars.
- Not validated: a ball left on a parked car's roof slowly rolls forward and off, because the game's impulse direction
  leans forward (`PushForwardScale`) and each touch after a bounce adds a little. Competitive replays don't have that
  situation.
