# Client loop, input and frame timing: spec (static session, 2026-10-08)

**Sources.** Addresses are the live build's (2026-10-06), with the old build's in brackets. Decompiled first from the
2026-06-16 build, then checked against the live build: semantic_diff.py and objdump show every loop, physics-frame,
render-pose and input-tick function below is identical apart from layout. The key constants were re-decompiled in the
live project: the accumulator, the 5-substep cap at +0x194, α at +0x1a4, the 0.0005/0.4 dt clamp and the jump-latch
mask. There are three exceptions: FUN_140f215f0 copies one more dword; the InputAxis native (FUN_140e39bc0) gained
per-device axis ownership (see notes/camera-respawn-goal.md CAM-16); UWindowsClient::Tick (FUN_140dc8550) has a new
raw-mouse thread (LT-11).

**Tags.** [dec] decompiled, [scr] script, [cdo] class default or ini, [inf] inferred. Sub-agent files are local in
out/bsim/agents/L1/ (notes.txt; decompiles under runs/*/c/).

## Frame order (decompiled)
1. **`FEngineLoop::Tick`** (FUN_140ddad30): the frame limiter (FUN_140ddc400, LT-10). GDeltaTime is the
   QueryPerformanceCounter delta.
2. **`UGameEngine::Tick`** (FUN_1406ee6a0 [old 1406e9650]) → `UWindowsClient::Tick` (FUN_140dc8550 [old 140dc8af0]):
   - deferred window messages → `ViewportClient->InputKey` (key events and commands run now);
   - then the mouse read and `ProcessInput` (FUN_140dc4ac0 [old 140dc5440]): one `XInputGetState` per frame. Axes are sent as InputAxis
     with the latest value; buttons are diffed against the last poll into press/release events.
3. **`UWorld::Tick`** (FUN_140753ed0 [old 14074ee80]):
   1. net receive (TickDispatch);
   2. dt clamp (LT-3);
   3. **TG_PreAsyncWork:** PlayerController_TA tick (FUN_140f4c920 [old 140f46cc0]): Interactions Tick(dt) → PlayerTick
      (`PlayerInput_TA.PlayerInput`, then `PlayerMove`, which writes VehicleInput) → Interactions Tick(−1), which zeroes
      the input axes;
   4. **then the physics:** EngineShare tick (FUN_140f22c90 [old 140f1d800] → FUN_140f54bd0 [old 140f4ec60]): pending rollback/resim, then the substeps;
      each substep copies PC.VehicleInput into the car (FUN_140f215f0 [old 140f1c190]);
   5. TG_DuringAsyncWork, **TG_PostAsyncWork** (RBActors compute their render pose, LT-8);
   6. UpdateCamera(DeltaSeconds) per controller.
4. **Render,** FFrameEndSync (OneFrameThreadLag), then the OS message pump.

**Result:** PlayerMove runs before the frame's physics, so **input latency is 0 frames**. Input is sampled once per
render frame, and every tick of that frame uses the same VehicleInput (except the jump latch, LT-4). This closes the
open item in notes/controls-audit.md.

## Items
| # | What | Game | Ours | What to implement | Impact |
|---|---|---|---|---|---|
| LT-1 | Input latency | Order above [dec]; PlayerTick = PlayerInput then PlayerMove [scr]; PC tick group TG_PreAsyncWork (only RBActor_TA and CarComponent_TA are PostAsyncWork) [cdo] | sample → ticks → draw (`client/src/game/freeplay.ts:88,103-112`, `online.ts:176,197-206`) | none: 0 frames in both | – |
| LT-2 | Substeps and leftover time | FUN_1402b0460 [old 1402af960]: f32 acc += dt; if acc ≥ step: n = (int)(acc/step), acc −= n·step. FUN_140f54bd0 [old 140f4ec60]: run min(n, MaxPhysicsSubsteps) substeps, **cap 5** (EngineShare_TA+0x194, CDO 5). Ticks over the cap are **dropped**; only the fractional remainder is kept [dec, verified] | `client/src/loop/fixedStep.ts:13` cap 12; `:20-23` sets accumulator = 0 on overflow | Cap 5 per frame and subtract all n·step (keep fmod(acc, step)). Below 24 fps the game runs slower than real time (20 fps → 83.3 %, 15 → 62.5 %, 10 → 41.7 %); at most 41.67 ms of simulation per frame. Tests: advance(0.05) repeated → 5 ticks per frame; advance(5) → 5 ticks, alpha = the remaining fraction | medium-low |
| LT-3 | Frame-delta clamp | UWorld::Tick: DeltaSeconds = clamp(dt · TimeDilation · DemoPlayTimeDilation, 0.0005, 0.4); RealDeltaSeconds = clamp(dt, 0.0005, 0.4). The physics accumulator and the camera both use **DeltaSeconds, the dilated dt**, which confirms GS-3 in camera-respawn-goal.md (physics slows with the goal slow-mo). An offline-only GDeltaTime cap at GameEngine+0xac0 has CDO 0, so it is off [dec; name MaxDeltaTime inf] | `client/src/main.ts:146` min(0.25, …) | Use 0.4 (physics is already bounded by LT-2; this changes camera and sync-error decay after hitches). Multiply by TimeDilation for the goal slow-mo | low |
| LT-4 | Jump taps (C-6) | ToggleJump(true) sets bJump and latches bJumped [scr]. Each tick FUN_140f215f0 [old 140f1c190] uses bJump ‖ bJumped and clears PC.bJumped (mask 0xffffffeb) [dec]. A tap gives exactly **1 tick** of jump, on the first tick after the press; the latch survives frames with 0 ticks | `client/src/input/devices.ts:52-65` keeps a tap for one snapshot; `freeplay.ts:105`, `online.ts:201` give every tick of the frame the same controls | Per tick: jump = held ‖ latch. Set the latch on the press event; clear it when the first tick consumes it (online it is in exactly one input frame). Today a 30 fps tap gives 4 jump ticks (33 ms) instead of 1, and at 144 Hz a tap in a 0-tick frame (1 frame in 6) is lost. Tests: 30 fps tap → exactly 1 jump tick; tap in a 0-tick frame → jump on the next tick | medium |
| LT-5 | Boost, powerslide, air-roll taps (C-6) | ToggleBoost/ToggleHandbrake (press true / OnRelease false) and Button bRoll act at event time [scr]. Events run in Client->Tick before PlayerMove and the ticks, so a press and release within one frame leaves the state false at tick time: **the tap is lost**. Pad: one XInput poll per frame, so taps between polls produce no events [dec] | `client/src/input/mapping.ts:96-115` ButtonLatch ("press and release in one frame: pressed"); `:130,138,139` | For boost, handbrake and air roll use the state after the last event (no tap retention). The pad already matches (Gamepad API polled once per frame) | low |
| LT-6 | Keyboard axis keys | PlayerInput_X::InputKey (FUN_140e3a2b0 [old 140e38d40]) lists released keys (+0xf0); UInput::Tick (FUN_1409da2a0 [old 1409d4eb0]) sends InputAxis(key, 1.0) for held keys **and** keys released since the last frame, then InputAxis(key, 0) for the released ones, then clears the list. Any key that was down at any time since the last frame counts as full value for that frame [dec] | taps: same (`devices.ts:22,58`); releases: `devices.ts:26` deletes the key at once (0 this frame) | Add a "released since last snapshot" set, counted for **axis** actions only (throttle/steer/pitch/yaw/roll keys), not buttons. A keyboard axis release takes effect 1 frame later | low |
| LT-7 | Analog axes | Pad: latest XInputGetState value, /32768 (triggers /255), one per frame, no averaging; PlayerInput_TA.PlayerInput does no DeltaTime scaling and no super call (no mouse smoothing). Mouse deltas summed per frame. KeyboardAxisBlendTime 0 [dec/scr] | latest Gamepad API value per frame | same | – |
| LT-8 | Render interpolation | RBActor_TA ticks in TG_PostAsyncWork, after this frame's physics. physRigidBody (FUN_140f704b0 [old 140f6a240]): loc, vel, angVel = lerp(Old, RB, α); rotation = slerp (FUN_140388840 [old 140382150]; shortest path, linear when \|dot\| ≥ 0.9999), normalised; then the sync error. α = clamp(acc/step, 0, 1) (EngineShare+0x1a4) [dec, verified]. Old = tick N−1, RB = tick N (pre-step FUN_140f21850 [old 140f1c3c0] / post-step FUN_140f1ef70 [old 140f19b30]). **No extrapolation** (bExtrapolateRendering, PhysicsConfig bit 0x40, False) [cdo] | `client/src/render/interpolated.ts:20-26` lerp/slerp (same); `blended()` `:28-44` for the camera (`freeplay.ts:234`) lerps the rotation axes | Use slerp in blended() too, so the camera sees the drawn pose (difference ~1e-5 rad per tick) | very low |
| LT-9 | Camera rate | UpdateCamera(DeltaSeconds) once per render frame, after every tick group, on the interpolated and smoothed actor pose [dec] | once per frame after the ticks (`freeplay.ts:234`) | same, apart from LT-3's dt | – |
| LT-10 | Frame pacing | GetMaxTickRate (FUN_140ef6d90 [old 140ef2000]): if bSmoothFrameRate (CDO True), avg += (min(dt, 0.2) − avg)/300 (initial 0.01) and rate = clamp(1/avg, MinSmoothedFrameRate 22, MaxSmoothedFrameRate). MaxSmoothedFrameRate = the MaxFPS setting (CDO 62; CustomFPS 30–10000; "Uncapped" clears bSmoothFrameRate). Wait 1/rate − dt (Sleep(wait − 2 ms) if wait > 5 ms, then spin). The simulation gets the **measured** dt [dec/scr/cdo] | rAF pacing, measured dt | Nothing in a browser; match the frame rate for replay or feel comparisons | info |
| LT-11 | Keyboard vs pad sample time | The OS queue is pumped at the end of the previous frame and events processed at the start of this one; the pad is polled after the limiter wait. So keys pressed during the wait arrive a frame later than pad input [dec]. The live build adds a raw-mouse input thread (RLRawMouseInput) and processes deferred messages again after ProcessInput | the browser delivers events before rAF | mouse only; nothing to implement | info |
| LT-12 | Step precision | step = 1.0f/120.0f (0.0083333338 s), f32 accumulator [dec]. WorldInfo.MaxPhysicsSubsteps 5 / MaxPhysicsDeltaTime 1/3 are PhysX settings and unused here [cdo] | f64 | Tick counts can differ at exact boundaries; negligible | very low |
| LT-13 | Online clock | The client dt goes through InputBuffer->ModifyDeltaTime (vtable 0x698; only in one net mode) before the accumulator. The default ServerConsume is the identity (0x140618a20 [old 1406139a0]), so the client never stretches or compresses time. STS (±0.9 %) and CSTS (×1.0256 … 0.9756 by buffer level) are opt-in [dec/scr/cdo]. Input frames are recorded per tick (FUN_140f215f0 [old 140f1c190]); corrections are resimmed inside the EngineShare tick before the new substeps, then sent | no time scaling; corrections before sampling; sends inside the tick loop | same, apart from the send cadence (notes/netcode-audit.md N-9) | – |

## Confirmed same
- Fixed 120 Hz step, input sampled once per frame and used by every tick of the frame, 0 frames of input latency.
- Render = lerp/slerp between the last two ticks with α = remainder/step clamped to [0, 1]; 0-tick frames allowed;
  camera once per frame after the physics.
- Pad: once-per-frame state poll (same tap loss); latest stick value, no averaging.
- Keyboard taps on axis keys register for one frame.
- No local input buffering or delay; no client time scaling in ServerConsume.
- Order: receive → PlayerMove → (resim) → ticks → send.

## Open
- The name MaxDeltaTime for GameEngine+0xac0 is inferred (CDO 0, so off).
- bExtrapolateRendering and MaxPhysicsSubsteps could be overridden by online config (PhysicsConfig_TA is an
  OnlineConfig_X); the shipped defaults are False and 5.
- The live raw-mouse thread is not decompiled (mouse only).
