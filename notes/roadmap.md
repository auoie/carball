# Roadmap: Rocket League physics, camera, controls and multiplayer

Goal: a web game whose physics, camera, controls and competitive multiplayer feel like Rocket League.
Plan: start from RocketSim (already right on nearly everything), patch in the differences found
here, and build the remaining pieces (arena, camera, controls, netcode, competitive layer).

Values and formulas: `notes/physics-values.md`. Arena: `notes/arena.md`. Binary/package notes: `notes/findings.md`.
Resuming in a new session: `notes/HANDOFF.md`. Generated constants: `out/rl_physics_constants.json`.

## Next up
1. Physics validation against replays (§7): extend to jumps/dodges and bumps when needed.
2. Netcode (§6): in-process network tests (latency/jitter/loss), sim-time scaling, update size; then the
   competitive layer (§9).

---

## Done

- [x] Exe recon: UE3, unpacked, EAC present, Bullet ≥ 2.83
- [x] Native names (4,145), class registrations and vtables (2,404), UE3 globals (`GNames`, `GObjObjects`, `GNatives`)
- [x] Package decryption and parsing (names, imports, exports, tagged properties, native field offsets)
- [x] UnrealScript disassembler with Rocket League's shuffled token map
- [x] All tuning values: car, components, wheels, suspension, steering/torque curves, ball, arena materials, boost pads, gravity, tick rate
- [x] Car hitboxes and wheel setup for all six body types; the +2.5 hitbox / inertia difference is UE3's skin width (+1.25 uu per side)
- [x] Decoded: boost, jump / double jump / flip state machine (incl. flip resets), dodge (inputs, torque rounding, 0.041 s cancel lock, Z damping), auto-flip, speed clamps
- [x] Decoded: throttle/brake input logic, drive/brake torque, Ackermann steering, wheel friction solver, suspension, sticky force, air control
- [x] Decoded: car–ball hit push, car–car bump impulse, bump/demo cone test, demo speed rules
- [x] Bullet world: split impulse on, warm starting off, 10 iterations, one-sided triangles, friction product / restitution max,
      merged "special" ball–world contact, per-tick state quantization (`bQuantizePhysics`)
- [x] Ball: Bullet sphere 91.25; rests at 93.15 on flat surfaces (measured from replays)
- [x] Throttle top speed: 1600 → 160 uu/s² up to 1400, then 0 (measured from replays; RocketSim's curve is right)
- [x] Arena measured: planes, edge curves, corners, goal mouth and full goal interior (`notes/arena.md`)
- [x] Our own arena collision mesh generated and validated (`scripts/arena_gen.py`, `out/arena/`)
- [x] RocketSim forked into `engine/` with all verified patches and tests
- [x] WebAssembly build of the engine with a JS API (`engine/build-wasm/rlengine.mjs`)
- [x] Browser freeplay client (`client/`)
- [x] Replay tools: `scripts/replay_extract` (Rust/boxcars) + `scripts/replay_measure.py`
- [x] Camera tuning values (car cam, ball cam, presets, slider limits)
- [x] Netcode tuning values (input redundancy, jitter buffer, sim-time scaling, correction rates)

---

## 1. Arena

- [x] Generate our own arena mesh: `scripts/arena_gen.py` → `out/arena/` (RocketSim `.cmf` + `.obj`).
      Within 2.6 uu of the game's surfaces everywhere (`scripts/arena_check.py`); loads and holds in RocketSim (`engine/tests/arena_smoketest.cpp`).
- [ ] Check ball and car rest heights, wall rides and corner bounces against replays once the patched sim exists (§7).
      Done so far: goal ramp ride height matches replays (17.0).

## 2. Patch RocketSim with verified differences

Done: `engine/` (patched RocketSim, `engine/README.md`, tests `engine/tests/rl_patch_tests.cpp`, 46 checks pass).

Already correct in RocketSim (no change): boost, jump and double jump, air control, sticky force, car–ball push,
throttle curve, hitbox sizes and wheel setup, ball radius, dodge-vs-double-jump threshold, boost pads, gravity, 120 Hz tick.

- [x] Flip cancel: block pitch-cancel for the first 0.041 s (`MinDodgeTorqueTime`)
- [x] Dodge: torque from `Normal(-Pitch, Yaw + Roll)`, rounded to whole numbers
- [x] Dodge vs double jump: already identical in RocketSim (regression test)
- [x] Auto-flip: angular velocity jumps to the 5.5 rad/s cap immediately (a car on its roof now turns over; stock didn't)
- [x] Bumps/demos: forward cone test (bump yaw 70°, demo yaw 45.57°, pitch 36.87°) instead of the distance check
- [x] Demos: supersonic **and** |forward speed| ≥ 2100; backwards demos allowed; bump cooldown doesn't block demos
- [x] Bump impulse: exact curves at the attacker's speed; Z push only for grounded victims; side contacts push 0
- [x] Steering: per-wheel Ackermann angles
- [x] Suspension scale per car from wheel positions
- [x] Solver warm starting off; one-sided sphere–triangle contacts
- [x] Special ball–world contact: re-normalised normal, averaged friction/restitution
- [x] Per-tick state quantization
- [x] Unit tests for each patch
- [ ] Verify against replays: flip-cancel tick alignment, in-integration speed clamp, attacker speed after a demo
      (see `engine/README.md`)

## 3. Camera

- [x] Decompile the car-cam and ball-cam update logic (UnrealScript; `notes/camera.md` "Algorithm")
  - Start: `CameraState_Car_TA`, `CameraState_BallCam_TA` (natives and script); archetypes in `GameInfo_Soccar_SF.upk`.
- [x] Extract camera values: player defaults, car-cam and ball-cam archetypes, swivel extents (`notes/camera.md`).
- [x] Car cam, ball cam and transitions ported (`client/src/camera/rlCamera.ts`), with scenario tests
- [x] Swivel (right stick) and rear camera, with the game's toggle/hold and invert options
- [ ] Not yet: bouncy-chassis wobble, demolished/goal cameras, proximity distance

## 4. Controls

- [x] Input pipeline decoded and ported (`notes/input.md`): per-axis controller deadzone (profile default 0.2),
      air roll replacing directional roll, keyboard air pitch safety, sensitivities and dodge deadzone applied in the
      physics like the game's PRI car preferences (engine patches 21–22).
- [ ] Optional mouse steering (`UpdateMouseGroundSteer` etc., decoded in `notes/input.md`; off by default in the game).
- [x] Default bindings from `TAGame/Config/DefaultInput.ini` (`client/src/input/bindings.ts`, `notes/camera.md`).
- [x] Settings menu: rebind controls, camera settings (game's limits), deadzones and sensitivities; saved locally.

## 5. Gameplay rules

- [ ] Kickoff spawn positions and countdown, goal detection, respawn and demo-respawn timing.
  - Goal detection: replays confirm the goal is scored at ball |y| = 5124.25 + 91.25 = 5215.5 (RocketSim's threshold).
- [ ] Boost pad pickup test (cylinder r 96 / 160, h 64 against the car), amounts and respawn times (done: 12 / full, 4 s / 10 s).
- [ ] Verify against the game's scripts (`GameEvent_Soccar_TA`, `VehiclePickup_Boost_TA`).

## 6. Netcode (competitive play)

- [x] Exact snapshot restore for rollback: bit for bit, new arena or in place (~5 µs) (`engine/README.md` patches 23–26,
      `engine/tests/rollback.cpp`).
- [x] Netcode decoded (`notes/netcode.md`): input upload and acks, the three server input-buffer modes and jitter
      buffer, client sim-time scaling (STS/CSTS), replication rates, client rewind-and-replay with per-frame history,
      remote-car input fading, correction thresholds.
- [ ] Visual smoothing of corrections (`SyncErrorLocation`, fix rates 4/5): not decoded in detail.
- [x] Transport: WebTransport (datagrams + a control stream), protocol v1 (`protocol/README.md`, byte vectors shared by
      server and client tests). Redundant inputs (up to 10 unacknowledged frames per packet), 60 Hz input rate.
- [x] Native authoritative server (`server/`, Rust + the engine's C API): 120 Hz, the game's `ServerConsume` input
      buffer and jitter buffer, update rates (near ball every update, others 15 Hz), splitting into datagrams.
- [x] Browser online mode (`client/src/game/online.ts`) with client prediction and rollback
      (`client/src/net/predictor.ts`): exact for the local car (unit test against a simulated server; browser test
      with two players against a real server).
- [ ] In-process network tests with scripted latency, jitter and loss, counting mispredictions exactly (step 5).
- [ ] Client sim-time scaling (STS/CSTS) to keep the server's buffer at its target; until then the server's
      catch-up and repeat rules do it, at one misprediction per event.
- [ ] Update size: ~330 bytes per car (a 2v2 update is split over two datagrams); compress (deltas, fewer floats).
- [ ] Car preferences can't change mid-match (sent once in Hello).

## 7. Validation

- [x] Comparison harness (`engine/tools/replay_validate.cpp`, `notes/validation.md`): replay states into the engine,
  step, compare with the next frame. Ball (free flight, arena contacts) exact; car driving within ~1%; car–ball
  touches unbiased. Found and fixed: hit impulse from start-of-tick velocities (patch 28, the "bouncy" ball on the
  car); found in the code on the way: input bytes (patch 29).
- [x] Ball sleeping (patch 30: a slow ball stops after 2 s, as in the game); floor friction and rolling checked.
- [x] Vehicle update decompiled and matched (patch 31): wall/curve error 0.48 → 0.16 uu, goal 0.24 → 0.10.
- [x] Powerslide checked: matches (fully engaged 0.015 uu); the apparent error was the unreplicated handbrake ramp,
      now reconstructed by the extractor (all categories improved).
- [ ] Low-speed turning: lateral acceleration 20 uu/s² (2.6%) short below 500 uu/s, shrinking with speed.
- [ ] Walls and curves still 6× the flat-floor error; goal-wall wobble reduced but not gone (up to 1.7°/tick).
- [ ] Next: jumps, double jumps, flips (fit the start tick); input changes between frames; bumps/demos; boost pads;
      kickoffs; other hitboxes.
- [ ] Wheels on dynamic bodies (car on car / ball): the game's pushback and reaction impulses not modelled.
- [ ] Extend: jumps/dodges (fit the start tick), car–car bumps, other hitboxes, kickoffs.

## 8. Engine build

- [x] Patched RocketSim builds natively with tests (`engine/`)
- [x] Compile it to WebAssembly (Emscripten) with JS bindings (`engine/wasm/bindings.cpp`); headless Node tests pass;
      deterministic run to run (`-ffp-contract=off`); snapshots save/restore (`engine/README.md`)
- [x] Offline freeplay in the browser (`client/`): Three.js, our arena, keyboard/mouse/gamepad, 120 Hz fixed step
      with interpolation, HUD, goals and freeplay helpers. Strict TypeScript + ESLint + Vitest + Playwright.
- [x] Native and WebAssembly builds simulate bit-identically (`engine/detmath`, `BT_DISABLE_SIMD`;
      `engine/tests/check_native_wasm.sh`), so the server can be native
- [ ] Native authoritative game server (decision 2026-10-06) at a fixed 120 Hz with the game's per-tick state
      quantization; WebAssembly clients with prediction and rollback

## 9. Competitive layer

- [ ] Accounts and authentication.
- [ ] Matchmaking queues (1v1, 2v2, 3v3) and skill rating (e.g. Glicko-2 or OpenSkill).
- [ ] Lobbies and private matches.
- [ ] Dedicated server hosting by region and latency-based server selection.
- [ ] Replays and spectating (record inputs plus periodic snapshots).
- [ ] Anti-cheat: largely covered by the authoritative server; add input-rate and sanity checks.

## 10. Own assets (nothing from Psyonix ships)

- [ ] Car models built around the six hitbox shapes (Octane, Dominus, Plank, Breakout, Hybrid, Merc dimensions).
- [ ] Arena visuals, ball, boost pads and goal art.
- [ ] Sound effects and music.
- [ ] Original names and branding for the game, cars and arena.
