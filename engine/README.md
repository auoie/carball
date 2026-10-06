# Engine: patched RocketSim

`rocketsim/` is [RocketSim](https://github.com/ZealanL/RocketSim) (MIT, see `rocketsim/LICENSE`),
vendored at upstream commit `c2baacb` (2026-07-14). It has been patched with the differences we verified
against the game (`notes/physics-values.md`). Every change is marked `RL PATCH` in the source, and
`rocketsim-rl-patches.diff` holds the full diff against upstream.

RocketSim's README asks people not to build and sell a playable Rocket League clone on it.
We chose to fork it anyway (decision 2026-10-06).

## Build and test
```sh
# native
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release
make -C engine/build -j
engine/build/rl_patch_tests                                        # one check per patch (46 checks)
engine/build/arena_smoketest out/arena/collision_meshes            # arena mesh in the sim
engine/build/determinism out/arena/collision_meshes 120            # scripted 2v2, hash per second

# WebAssembly (Arch: emscripten package; its bin dir is /usr/lib/emscripten)
export PATH=/usr/lib/emscripten:$PATH
emcmake cmake -S engine -B engine/build-wasm -DCMAKE_BUILD_TYPE=Release
emmake make -C engine/build-wasm -j
node engine/build-wasm/rl_patch_tests.js                           # same tests under Node
node engine/build-wasm/determinism.js /collision_meshes 120
node engine/wasm/test_node.mjs                                     # the JS module end to end
```
The arena mesh comes from `scripts/arena_gen.py` (`out/arena/`). Native tests find it via `ARENA_MESH_DIR`;
the WebAssembly test programs embed it at `/collision_meshes`.

## JavaScript module (`engine/build-wasm/rlengine.mjs` + `rlengine.wasm`, ~620 KB)
Bindings: `wasm/bindings.cpp` (embind). ES module; works in browsers, workers and Node.
```js
import createEngine from "./rlengine.mjs";
const E = await createEngine();
E.init([new Uint8Array(await (await fetch("soccar_arena.cmf")).arrayBuffer())]);  // once
const sim = new E.Sim();
const id = sim.addCar(0, 0);             // team 0 blue / 1 orange; type 0 Octane, 1 Dominus, 2 Plank, 3 Breakout, 4 Hybrid, 5 Merc
sim.resetKickoff(seed);
sim.setControls(id, throttle, steer, pitch, yaw, roll, jump, boost, handbrake);
sim.step(1);                             // 1 tick = 1/120 s
const car = sim.carState(id);            // Float32Array: E.CAR_POS, CAR_VEL, CAR_ANG_VEL, CAR_ROT (fwd, right, up), CAR_BOOST, flags...
const ball = sim.ballState();            // Float32Array: E.BALL_POS, BALL_VEL, BALL_ANG_VEL, BALL_ROT
const pads = sim.boostPads();            // 34 x E.PAD_SIZE: position, isBig, isActive, cooldown
const events = sim.takeEvents();         // Int32Array of [type, a, b]: EVENT_GOAL (team), EVENT_BUMP / EVENT_DEMO (attacker, victim)
const snapshot = sim.saveState();        // Uint8Array (~1.7 KB for 2 cars); sim.loadState(snapshot)
sim.delete();                            // free the C++ object
```
Getters return copies. Offsets are exported as constants (`E.CAR_BOOST`, ...); see the `Layout` namespace
in `bindings.cpp`. A goal is reported once, when the ball first crosses the line.

## Determinism
- **Run to run:** native and WebAssembly builds are each deterministic (identical 120 s scripted 2v2 runs).
- **WebAssembly everywhere:** WebAssembly float semantics are fixed, so the same `.wasm` gives identical results in
  every browser and in Node. **The server should run the same `.wasm` as the clients.**
- **Native vs WebAssembly differ:** glibc and musl round `sinf`/`cosf`/`atanf` differently in the last bit
  (e.g. the kickoff rotation on tick 0). Native builds are for tests and analysis. Making them match would
  mean compiling musl's maths functions into the native build.
- `-ffp-contract=off` everywhere (no fused multiply-add), so compiler flags can't change results.
- **Snapshot restore** (`saveState`/`loadState`, `Arena::Serialize`/`DeserializeNew`) replays exactly for cars that
  aren't touching anything. With contacts it drifts slightly, because Bullet's cached contact points aren't in the
  snapshot (measured: 0.03 uu/s on the first tick, 0.19 uu after 2 s of busy play).

## Performance
- **Arena creation and first tick:** ~1 ms each (they were 260 ms and 520 ms with the whole-arena mesh before the broadphase fix).
- **Per tick in WebAssembly** (Node 26): ~15–50 µs for 2 cars + ball, including JS-side state reads.
- **First tick after loading the module:** a one-off ~0.7 s while V8 compiles the module. Warm up during loading.

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

Engine fixes (not game behaviour; needed for determinism, snapshots and speed):

| # | Change | Where |
|---|---|---|
| 13 | Fixed random engine (`std::minstd_rand0`) and our own shuffle for kickoffs: `default_random_engine` and `std::shuffle` differ between standard libraries | `Math.cpp/.h`, `Arena.cpp` `ResetToRandomKickoff` |
| 14 | Cars kept in a set ordered by ID (was pointer-ordered, so update order, e.g. contested boost pads, depended on memory addresses) | `Arena.h` |
| 15 | `DeserializeNew` / `Clone` keep car IDs correctly (stock lost a car when the saved order wasn't ascending, and `Clone` broke the ID map) | `Arena.cpp` |
| 16 | Snapshots keep everything that affects the next tick: boost (was reset to the spawn amount on load), `isSupersonic`, and the wheel values carried between ticks (steer angle, drive/brake force, friction) | `Car.h/.cpp`, `Arena.cpp` |
| 17 | Grid broadphase finds a static mesh's cells by walking its triangles once, instead of querying the mesh per cell. Same cells, so results are bit-identical | `btRSBroadphase.cpp` |

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
- **Demo collision:** in the demo tick the collision is still solved, so a 2300 uu/s attacker drops to ~1040
  (same as stock). The game probably doesn't slow the attacker. Check against replays (attacker speed around demos).
- Not ported: the reverse-gravity mutator's dodge direction flip.

## Updating from upstream
Re-apply `rocketsim-rl-patches.diff` on a fresh clone, or merge by hand using the `RL PATCH` markers.
Then rerun both test programs.
