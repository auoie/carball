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
engine/build/rl_patch_tests                                        # one check per patch (75 checks)
engine/build/arena_smoketest out/arena/collision_meshes            # arena mesh in the sim
engine/build/determinism out/arena/collision_meshes 120            # scripted 2v2, hash per second
engine/build/rollback out/arena/collision_meshes 300               # restored snapshots continue bit for bit
engine/build/replay_validate out/replays/states.csv                # physics vs replays (notes/validation.md)

# WebAssembly (Arch: emscripten package; its bin dir is /usr/lib/emscripten)
export PATH=/usr/lib/emscripten:$PATH
emcmake cmake -S engine -B engine/build-wasm -DCMAKE_BUILD_TYPE=Release
emmake make -C engine/build-wasm -j
node engine/build-wasm/rl_patch_tests.js                           # same tests under Node
node engine/build-wasm/determinism.js /collision_meshes 120
node engine/wasm/test_node.mjs                                     # the JS module end to end
engine/tests/check_native_wasm.sh 600                              # native and WebAssembly must match bit for bit
```
The arena mesh comes from `scripts/arena_gen.py` (`out/arena/`). Native tests find it via `ARENA_MESH_DIR`;
the WebAssembly test programs embed it at `/collision_meshes`.

## JavaScript module (`engine/build-wasm/rlengine.mjs` + `rlengine.wasm`, ~620 KB)
Bindings: `wasm/bindings.cpp` (embind). ES modules: `rlengine.mjs` (browsers, workers and Node; used by tests)
and `rlengine_web.mjs` (browser-only; bundled by the client). Emscripten also generates TypeScript types from
the bindings (`rlengine*.d.mts`; typed arrays via `EMSCRIPTEN_DECLARE_VAL_TYPE`), which the client type-checks against.
```js
import createEngine from "./rlengine.mjs";
const E = await createEngine();
E.init([new Uint8Array(await (await fetch("soccar_arena.cmf")).arrayBuffer())]);  // once
const sim = new E.Sim();
const id = sim.addCar(0, 0);             // team 0 blue / 1 orange; type 0 Octane, 1 Dominus, 2 Plank, 3 Breakout, 4 Hybrid, 5 Merc
sim.resetKickoff(seed);
sim.setControls(id, throttle, steer, pitch, yaw, roll, jump, boost, handbrake, airPitchSafety);
sim.setCarPreferences(id, dodgeDeadzone, steeringSensitivity, airControlSensitivity);  // player settings (0.5, 1, 1)
sim.step(1);                             // 1 tick = 1/120 s
const car = sim.carState(id);            // Float32Array: E.CAR_POS, CAR_VEL, CAR_ANG_VEL, CAR_ROT (fwd, right, up), CAR_BOOST, flags...
const ball = sim.ballState();            // Float32Array: E.BALL_POS, BALL_VEL, BALL_ANG_VEL, BALL_ROT
const cfg = sim.carConfig(id);           // Float32Array: E.CFG_HITBOX_SIZE, CFG_HITBOX_OFFSET, wheel offsets/radii/rest
const pads = sim.boostPads();            // 34 x E.PAD_SIZE: position, isBig, isActive, cooldown
const events = sim.takeEvents();         // Int32Array of [type, a, b]: EVENT_GOAL (team), EVENT_BUMP / EVENT_DEMO (attacker, victim)
const snapshot = sim.saveState();        // Uint8Array (~2 KB for 2 cars); sim.loadState(snapshot) restores it exactly
sim.delete();                            // free the C++ object
```
Getters return copies. Offsets are exported as constants (`E.CAR_BOOST`, ...); see the `Layout` namespace
in `bindings.cpp`. A goal is reported once, when the ball first crosses the line.

## Determinism (native server == WebAssembly clients)
The game server runs natively; browsers run WebAssembly. Both must simulate **bit-identically**, so the
server and every client agree exactly. Verified with `engine/tests/check_native_wasm.sh` (run after
building both): a scripted 10-minute 2v2 gives the same hash every second and the same snapshot bytes,
and the arena smoke test (incl. 600,000 ticks of random ball bounces) prints identical results.
A native Debug (-O0) build matches too.

What makes this work:
- **`detmath/`**: musl's `sinf, cosf, tanf, asinf, acosf, atanf, atan2f, expf, logf, powf` (MIT, from the musl in
  Emscripten 6.0.10), prefixed `det_` and compiled into both builds. Bullet's `btSin`/`btCos`/... and RocketSim's
  direct calls use them. The platform libm (glibc, musl, MSVC) is never called; `nm` shows no references.
  (`sqrtf`, `fmodf`, `fabsf`, `floorf` and `lrintf` are exact by IEEE 754 and stay as they are.)
- **`BT_DISABLE_SIMD`** (PUBLIC define): Bullet's hand-written SSE/NEON vector code is off. It reorders
  operations and uses approximate reciprocal square roots, so native x86/ARM would differ from WebAssembly.
- **`-ffp-contract=off -fno-fast-math`**: no fused multiply-adds, no reassociation.
- No platform-dependent containers or algorithms in the simulation: a fixed random engine and shuffle, cars
  ordered by ID, and no uninitialized state.

Rules for server and client code that feeds the simulation:
- Always pass an explicit kickoff seed (`resetKickoff(seed)`). Without one, the engine seeds from the clock.
- Don't use `std::uniform_*_distribution`, `std::shuffle` or `std::default_random_engine` for anything that
  affects the game; they differ between standard libraries.
- Don't rely on the evaluation order of function arguments (GCC and Clang differ). Compute values into locals first.
- Build both sides from the same commit with these CMake settings. Anything that adds `-ffast-math` or
  `-march=native`-style FMA contraction breaks determinism.

**Snapshot restore is exact** (`saveState`/`loadState`; `Arena::Serialize`, `DeserializeNew`, `DeserializeInPlace`,
`Clone`): a restored arena continues bit for bit like the original, which rollback netcode relies on. Snapshots
carry the bodies' exact Bullet-unit values, the wheel values carried between ticks and Bullet's persistent contact
points, and Bullet processes contacts in a fixed order (patches 23–25). `tests/rollback.cpp` checks it: a scripted
2v2 restored every 150 ticks (new arena, in place into a long-lived arena, and cloned), and scenarios with lasting
contacts (ball on a roof, cars stacked, a pile of cars and ball, a car on its roof) restored at every tick. Both
builds pass, with identical output (`check_native_wasm.sh`).

## Performance
- **Arena creation and first tick:** ~1 ms each (they were 260 ms and 520 ms with the whole-arena mesh before the broadphase fix).
- **Per tick, 2v2 + ball:** native ~13 µs, WebAssembly (Node 26) ~15 µs (scripted 20-minute match, 144,000 ticks).
  At 120 Hz one core could step several hundred 2v2 matches in real time, so physics is a small part of server cost.
- **First tick after loading the module:** a one-off ~0.7 s while V8 compiles the module. Warm up during loading.
- **Snapshots (2v2):** ~3 KB; save ~3 µs; load in place ~5 µs (`DeserializeInPlace`, used by `loadState` when the
  cars match); load into a new arena ~3.3 ms.

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
| 28 | Car–ball extra hit impulse from the bodies' **start-of-tick** velocities (`OldRBState`). RocketSim read them during the step, when they already hold that tick's gravity and car forces: a ball resting on a car's roof got ~3.5 uu/s pushed up every other tick. Replays: the ball left the car +3.0 uu/s too fast along the hit direction (95%: 2.6–3.5), now +0.2; dribbles +2.6 → 0.0 | `Car_TA.ApplyBallImpactForces` (`OldRBState.LinearVelocity`) | `Ball.cpp` `_OnHit`, `Ball::_startOfTickVel`, `Car::_oldState` |
| 29 | Inputs are bytes: every axis is stored as 128 + q, q = round(v × 127) for v ≥ 0 and round(v × 128) below (halves up), read back as q / 127 or q / 128, on the server and for the local player. Applied to the controls every tick (idempotent) | `Vehicle_TA.SetVehicleInput` `FUN_140f30a70` | `Quantize::InputAxis`, `Car.cpp` `_PreTickUpdate` |
| 27 | Air throttle while boosting: the game uses ThrottleForce × (boost active ? 1 : throttle), so boosting in the air gives 1058.33 uu/s² whatever the throttle. RocketSim's air boost (1058.33) already includes that, then added throttle × 66.67 again: boost + throttle in the air was 6% too strong, boost + reverse 6% too weak | AirControl ApplyForces `FUN_140eb3400` (`BoostComponent.bActive`) | `Car.cpp` `_PreTickUpdate` |
| 12 | Per-tick state quantization: location to 0.01; velocity truncated to 0.01 (+0.001 away from zero); angular velocity to 0.0001 (+0.00001); smallest-three quaternion with 18 bits | `FUN_140eed9e0` → `FUN_140e45c10` → `FUN_140e3e960` | `Sim/Quantize/`, `Car` and `Ball` `_FinishPhysicsTick` |
| 21 | Player preferences in the physics, like the game's `PRI_TA.SetUserCarPreferences`: steering and air control shape their input with the player's sensitivity (`clamp(input × s, −1, 1)`, any input is full input at 10); dodge deadzone per car (was already a config value). The dodge check and direction use the raw stick | `FUN_140396ca0`, VehicleSim `FUN_140f1e830`, AirControl `FUN_140eb3400` | `CarConfig.h`, `Car.cpp` `ShapeInput` |
| 22 | Keyboard air pitch safety: a control flag that makes air control ignore pitch while dodges still use it (the game zeroes `VehicleInput.Pitch` after copying it into `DodgeForward`). The client decides when it is on (`PlayerController_TA.ApplyAirPitchSafety`) | `PlayerController_TA.PlayerMove` | `CarControls.h`, `Car.cpp` `_UpdateAirTorque` |

Engine fixes (not game behaviour; needed for determinism across builds, snapshots and speed):

| # | Change | Where |
|---|---|---|
| 13 | Fixed random engine (`std::minstd_rand0`) and our own shuffle for kickoffs: `default_random_engine` and `std::shuffle` differ between standard libraries | `Math.cpp/.h`, `Arena.cpp` `ResetToRandomKickoff` |
| 14 | Cars kept in a set ordered by ID (was pointer-ordered, so update order, e.g. contested boost pads, depended on memory addresses) | `Arena.h` |
| 15 | `DeserializeNew` / `Clone` keep car IDs correctly (stock lost a car when the saved order wasn't ascending, and `Clone` broke the ID map) | `Arena.cpp` |
| 16 | Snapshots keep everything that affects the next tick: boost (was reset to the spawn amount on load), `isSupersonic`, and the wheel values carried between ticks (steer angle, drive/brake force, friction) | `Car.h/.cpp`, `Arena.cpp` |
| 17 | Grid broadphase finds a static mesh's cells by walking its triangles once, instead of querying the mesh per cell. Same cells, so results are bit-identical | `btRSBroadphase.cpp` |
| 18 | All transcendental maths through `detmath` (musl, compiled into every build) | `btScalar.h`, `Framework.h`, direct calls in `Car`/`Arena`/`Ball`/`MathTypes` |
| 19 | `BT_DISABLE_SIMD`: Bullet's SSE/NEON paths can be switched off (on in our builds) | `btScalar.h`, `engine/CMakeLists.txt` |
| 20 | `BallState::DropshotInfo::lastDamageTick` initialized (was uninitialized, so snapshot bytes held garbage) | `Ball.h` |
| 23 | Exact snapshots: the bodies' Bullet-unit values (converting game units back × 0.02 is not exact), the wheel pushback (kept between ticks unless the ray misses), and Bullet's persistent contact points (a car resting on another car depends on them), rebuilt on load with callbacks off. `Clone` copies the same. `DeserializeInPlace` loads into an existing arena in microseconds | `PhysState/RawBodyState.h`, `Car.h/.cpp`, `Arena.cpp` `_SerializeContacts` |
| 24 | Fixed processing order: every collision object has a sort key (static pieces by build order, ball, cars by ID), and Bullet's deterministic mode sorts contact pairs and the solver's manifolds by it, instead of an order that depends on the world's history (pair creation and removal, reused broadphase slots) | `BulletLink.h`, `btOverlappingPairCache.cpp`, `btSimulationIslandManager.cpp`, `Arena.cpp` |
| 25 | Solver time step set when the arena is built: the wheel pushback reads it before Bullet sets it, so the first tick of any new or restored arena used 1/60 s | `Arena.cpp` constructor |
| 26 | Upstream fixes: `threeWheels` (Psyclops) was not in snapshots; the car-mass mutator gave cars the ball's mass; loading a snapshot never applied its mutators; `Clone` kept default mutators | `CarConfig.h`, `Arena.cpp` |

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
