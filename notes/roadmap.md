# Roadmap: Rocket League physics, camera and controls

Goal: a web game whose physics, camera, controls and competitive multiplayer feel like Rocket League.
Plan: start from RocketSim (already right on nearly everything), patch in the differences found
here, and build the remaining pieces (arena, camera, controls, netcode).

Values and formulas: `notes/physics-values.md`. Binary/package notes: `notes/findings.md`.
Generated constants: `out/rl_physics_constants.json` (`scripts/export_constants.py`).

---

## Done

- [x] Exe recon: UE3, unpacked, EAC present, Bullet ≥ 2.83
- [x] Native names (4,145), class registrations and vtables (2,404), UE3 globals (`GNames`, `GObjObjects`, `GNatives`)
- [x] Package decryption and parsing (names, imports, exports, tagged properties, native field offsets)
- [x] All tuning values: car, components, wheels, suspension, steering/torque curves, ball, arena materials, boost pads, gravity, tick rate
- [x] UnrealScript disassembler with Rocket League's shuffled token map
- [x] Decoded: boost, dodge (inputs, torque rounding, 0.041 s cancel lock, Z damping), auto-flip, speed clamps
- [x] Decoded: throttle/brake input logic, drive/brake torque, Ackermann steering, wheel friction solver
- [x] Decoded: car–ball hit push, car–car bump impulse, bump/demo cone test, demo speed rules
- [x] Camera tuning values (car cam, ball cam, presets, slider limits)
- [x] Netcode tuning values (input redundancy, jitter buffer, sim-time scaling, correction rates)

---

## 1. Physics (blocking)

- [ ] **Arena geometry**: build our own collision mesh to Rocket League's dimensions.
  - Measure the soccar map's collision meshes locally: floor/wall/ceiling transitions, corner ramps, goal shape and depth.
  - Never ship Psyonix meshes; fit our own geometry to the measurements.
  - Start: `Stadium_P.upk` collision static meshes; arena materials in `Startup.upk` (`PhysicalMaterials.Collision_Sticky`).
  - Done when: ball and car rest heights, wall rides and corner bounces match replays.
- [ ] **Car hitboxes and wheel setup per body type** (Octane, Dominus, Plank, Breakout, Hybrid, Merc).
  - Box size and offset, wheel positions and radii, suspension rest lengths, inertia.
  - Start: `Body_*_SF.upk` (`ProductAsset_Body_TA`: `FrontAxle`/`BackAxle`, `bUseLegacySuspensionOffsets`); compare with RocketSim `CarConfig.cpp`.
- [ ] **Suspension and sticky force**: decompile Psyonix's suspension raycasts and sticky-force application.
  - Start: VehicleSim update `FUN_140f5ff00`, wheel update `FUN_140f584c0`, Bullet vehicle object at `VehicleSim+0x140`.
- [ ] **Air control**: decompile `CarComponent_AirControl_TA` `ApplyForces` (`0x140eb3400`) and `PrePhysicsStep` (`0x140f1b480`); compare with RocketSim's air-torque formula.
- [ ] **Jump / double jump / flip state machine**: jump hold, 1.25 s flip window, flip resets, `JumpLeaveGroundTime` (0.125).
  - Start: Jump `ApplyForces` `0x140eb4ce0`, DoubleJump `0x140eb4800`, script in `Car_TA` / `CarComponent_*_TA`.
- [ ] **Bullet setup**: solver iterations, collision margins, CCD, contact thresholds, and what `bQuantizePhysics` rounds (matters for client/server agreement).
- [ ] **Open question: throttle top speed (~1410)**. No cutoff found in the code; data keeps 10% torque above 1400. Measure from replays.
- [ ] **Open question: ball collision radius** (Bullet shape 90 vs RocketSim 91.25). Measure resting height and bounces from replays.

## 2. Patch RocketSim with verified differences

- [ ] Flip cancel: block pitch-cancel for the first 0.041 s (`MinDodgeTorqueTime`)
- [ ] Dodge: torque from `Normal(-Pitch, Yaw + Roll)`, rounded to whole numbers
- [ ] Dodge vs double jump: `Abs(DodgeForward) + Abs(DodgeRight) + Abs(Roll) >= threshold`
- [ ] Auto-flip: angular velocity jumps to the 5.5 rad/s cap immediately (not a 50 rad/s² ramp)
- [ ] Bumps/demos: elliptical cone test (bump yaw 70°, demo yaw 45.57°, pitch 36.87°) instead of the distance check
- [ ] Demos: require supersonic **and** forward speed ≥ 2100
- [ ] Bump curves: exact values (ground 150/200000/275000, air 150/250000/350000, Z 50/50000/75000, ÷ mass 180)
- [ ] Steering: per-wheel Ackermann angles instead of the averaged curve
- [ ] Unit tests for each patch against the decoded formulas

## 3. Camera

- [ ] Decompile the car-cam and ball-cam update logic so the extracted values are used the game's way.
  - Start: `CameraState_Car_TA`, `CameraState_BallCam_TA` (natives and script); archetypes in `GameInfo_Soccar_SF.upk`.
- [ ] Extract full camera presets: distance, height, angle (FOV, stiffness, swivel, transition already extracted).
- [ ] Implement car cam and ball cam with the extracted smoothing rates, speed/supersonic FOV boost and ball-cam pitch.

## 4. Controls

- [ ] Stick input to car input: controller deadzone, sensitivity curves, steering smoothing (`FUN_140396ca0(steer, SteeringSensitivity, 10)`).
  - Start: `PlayerInput_TA`, `PlayerController_TA.PlayerMove` (already decoded).
- [ ] Mouse/keyboard: `UpdateMouseGroundSteer`, `UpdateMouseGroundThrottle`, `ModifiedAirRotationByMouseInput`, `ApplyAirPitchSafety` (decoded).
- [ ] Default bindings from `TAGame/Config/DefaultInput.ini`; air roll left/right, boost, jump, handbrake.

## 5. Gameplay rules

- [ ] Kickoff spawn positions and countdown, goal detection, respawn and demo-respawn timing.
- [ ] Boost pad pickup test (cylinder r 96 / 160, h 64 against the car), amounts and respawn times (done: 12 / full, 4 s / 10 s).
- [ ] Verify against the game's scripts (`GameEvent_Soccar_TA`, `VehiclePickup_Boost_TA`).

## 6. Netcode (competitive play)

- [ ] Server input buffer and client sim-time adjustment: decompile `NetworkInputBuffer_TA` / `NetworkInputBuffer_STS_TA` (`ClientAdjustSimTime` and friends).
- [ ] Remote car and ball correction: how `NetworkSyncSettings` (fix rates, min deltas) are applied.
- [ ] Design our transport (WebRTC/WebTransport unreliable channel), redundant inputs (up to 10 frames/packet), 60 Hz input rate.

## 7. Validation

- [ ] Replay parser (`boxcars` / `rattletrap`) to pull ball and car states from real replays.
- [ ] Comparison harness: our sim vs replays vs RocketSim (kickoffs, ball bounces, throttle/boost acceleration, flips).
- [ ] Measure the two open questions (throttle top speed, ball radius).

## 8. Engine build

- [ ] Compile patched RocketSim to WebAssembly (Emscripten); headless Node test.
- [ ] Load our arena mesh; Three.js renderer; keyboard and gamepad input; offline freeplay.
- [ ] Authoritative server running the same WASM at 120 Hz; client prediction and rollback.
