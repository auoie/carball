# Engine: patched RocketSim

`rocketsim/` is [RocketSim](https://github.com/ZealanL/RocketSim) (MIT, see `rocketsim/LICENSE`),
vendored at upstream commit `c2baacb` (2026-07-14). It has been patched with the differences we verified
against the game (`notes/physics-values.md`). Every change is marked `RL PATCH` in the source, and
`rocketsim-rl-patches.diff` holds the full diff against upstream.

RocketSim's README asks people not to build and sell a playable Rocket League clone on it.
We chose to fork it anyway (decision 2026-10-06).

## Build and test
```sh
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release
make -C engine/build -j
engine/build/rl_patch_tests                                        # one check per patch (46 checks)
engine/build/arena_smoketest out/arena/collision_meshes            # arena mesh in the sim
```
The arena mesh comes from `scripts/arena_gen.py` (`out/arena/`). The tests find it via `ARENA_MESH_DIR`.

## Patches
| # | Change | Game source | Where |
|---|---|---|---|
| 1 | Flip cancel only once the dodge has been active 0.041 s (`MinDodgeTorqueTime`; RocketSim had 0.41, unused) | dodge ApplyForces `FUN_140eb72b0` | `Car.cpp` `_UpdateAirTorque`, `RLConst.h` |
| 2 | Dodge torque from `Normal(-pitch, yaw + roll)` with no deadzone, rounded to whole numbers (e.g. diagonal −184 / 158) | `CarComponent_Dodge_TA.SetDodgeSettings` | `Car.cpp` `_UpdateDoubleJumpOrFlip` |
| 3 | Dodge vs double jump `|pitch|+|yaw|+|roll| ≥ 0.5`: **already in RocketSim**, regression test only | `Car_TA.HasDodgeInput` | – |
| 4 | Auto-flip: angular-velocity change of 1000 per tick, capped at 5.5 rad/s at once (stock ramps at 50 rad/s²). A car flat on its roof now turns over; stock never did | FlipCar component | `Car.cpp` `_UpdateAutoFlip` |
| 5 | Bump/demo direction test: forward cone between hitbox centres (bump yaw 70°, demo yaw 45.57°, pitch 36.87°) instead of the contact point's x > 64.5 | `IsCarWithinForwardEllipticalCone`, native `FUN_140f0d620` | `Arena.cpp` `IsWithinForwardCone` |
| 6 | Demo needs supersonic **and** \|forward speed\| ≥ 2100. Backwards demos are allowed (`bAllowBackwardsDemolitions`), and the 0.25 s bump cooldown does not block demos | `Car_TA.ShouldDemolish`, `ApplyCarImpactForces` | `Arena.cpp` |
| 7 | Bump impulse: exact curves (data / 180) evaluated at the attacker's **speed** (not speed towards the car); upward push only when the victim is on the ground; non-bumper contacts push 0 but still start the cooldown; both cars' start-of-tick states (`OldRBState`) | `Car_TA.GetBumpImpulse`, `BumpCar` | `Arena.cpp`, `RLConst.h`, `Car` `_oldState` |
| 8 | Ackermann steering: the curves are the inner wheel's angle; outer = atan(L / (W + L / tan θ)) from the car's own wheelbase and track | VehicleSim `FUN_140f5ff00`, `FUN_140eca900` | `Car.cpp` `_UpdateWheels`, `RLConst.h` |
| 9 | Suspension force scale per car: mass × \|other axle x\| / wheelbase / 2 (Octane 35.735 / 54.265, Dominus 36.772 / 53.228) | Bullet vehicle `FUN_1402c52a0` | `Car.cpp` `_BulletSetup` |
| 10 | Solver warm starting off (`solverMode = 0`); sphere–triangle contacts one-sided | world setup `FUN_140403cc0`; SphereTriangleDetector | `Arena.cpp`, `SphereTriangleDetector.cpp` |
| 11 | Merged ball–world contact: averaged normal re-normalised; friction/restitution averaged instead of last-wins | `FUN_1402b2720`, `FUN_1402be240` | `btSequentialImpulseConstraintSolver.cpp` |
| 12 | Per-tick state quantization: location to 0.01; velocity truncated to 0.01 (+0.001 away from zero); angular velocity to 0.0001 (+0.00001); smallest-three quaternion with 18 bits | `FUN_140eed9e0` → `FUN_140e45c10` → `FUN_140e3e960` | `Sim/Quantize/`, `Car` and `Ball` `_FinishPhysicsTick` |

Driving, turning circles and jump height stay within 0.5% of stock (e.g. full-lock radius at 500 uu/s:
300.3 vs 299.8; jump 234.9 vs 235.2). The patches change details, not the overall feel.

## Assumptions and open points
- **Cancel-lock timing:** the game checks the 0.041 s lock with the same active time it uses for the Z damping.
  Stock RocketSim advances that time after the air torque, so the patch adds one tick. With it, the first cancellable
  torque tick is the 4th. This is not yet verified against replays.
- **Speed limits:** the game also "pushes the limits into the Bullet body", which may clamp during
  integration. RocketSim clamps at the end of the tick. This is unverified, so it is unchanged (only the
  auto-flip clamps immediately).
- **Demo impact:** the game sweeps the cars to the time of impact (`GetTimeOfImpact`). We use the start-of-tick
  states, which is what the game falls back to.
- **Quantization** follows the game's arithmetic, but the basis→quaternion conversion is Bullet's, so it is
  not bit-identical to the game.
- The car-bump callback now fires for every bump, including zero-push side contacts (the game's `EventBumpedCar`).
- Not ported: the reverse-gravity mutator's dodge direction flip.

## Updating from upstream
Re-apply `rocketsim-rl-patches.diff` on a fresh clone, or merge by hand using the `RL PATCH` markers.
Then rerun both test programs.
