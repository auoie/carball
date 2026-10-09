# Free look, respawn cameras, goal sequence: spec (static session, 2026-10-08)

Live build (2026-10-06) scripts and archetypes. Native addresses are the live build's (old build in brackets), from K1's
live-exe disassembly or mapped and checked through out/bsim/bindiff/function_map.tsv.
Tags: [S] script, [A] archetype/default value, [D] decompiled native, [I] inferred. `TA:n` = line in the local
TAGame dump (out/bsim/work/tagame_live_all.txt). Sub-agent files local in out/bsim/agents/K2/ (notes.txt, work/).
Extends notes/camera-update-audit.md (CAM-1..9); numbering continues there.

## 1. Free look (CAM-1), complete

### Open items from camera-update-audit.md, answered
- **Mouse units.**
  - Native InputAxis multiplies MouseX/MouseY by `MouseSensitivity` (default 10) [D]. The free-look bindings have
    Speed 0 (no dt factor), the deltas are summed per frame, and `PlayerInput_TA.PlayerInput` multiplies by FOV/90 [S].
  - Per-frame target = Raw · FreeLookSpeed · 0.83 rotator units. At defaults that is 10 · 2.5 · 0.83 = 20.75 units
    = 0.1140° per mouse count.
  - Counts are raw per frame, Y positive = mouse forward (UE3 convention) [I].
- **Exit floor 30/s:** |(CachedPitch, CachedYaw)|/dt in sensitivity-scaled counts/s, so 3 counts/s at sensitivity 10.
  Effectively "the mouse moved this frame" [S].
- **Device ownership** [D, live asm]:
  - Every key or button event sets `bDeviceOwnerIsGamepad` to its device. Mouse and stick motion never do.
  - While `DeviceOwnedAxes` = the four free-look axes, free-look axis input from the other device is dropped. That is
    every frame while `PRI.GameEvent.IsActive()` (Countdown, Active, PostGoalScored); empty in replay, lobby, podium [S].
  - Also gated by an unidentified native feature bit (assume on).
- **Car → Demolished blend: 0.25 s EaseIn²** (not 0.5) [S][A].
  - `Car_TA.FinishDemo` ends with `DetachFromController()`, so `CameraState_Car_TA.GetEndBlendParams` (TA:15599)
    falls back to Demolished's start params.
  - The Demolished archetype has no DefaultBlendParams, so it uses `Default__CameraState_X`: 0.25 s, EaseIn, exponent 2.
- **Cloud profile on a new device: the cloud copy wins** [S][A][I].
  - `ProfileCameraSave_TA` is cloud-synced. It is created as Modern on first run, then the EOS sync replaces it with the
    cloud object unless the local SaveTick is ≥ the cloud's.
  - Loading the cloud object runs the version delegates, so a pre-update cloud save (Version 0) is migrated: classic,
    free look off.
  - Modern defaults remain only with no cloud save.

### Constants
| Item | Value | Tag |
|---|---|---|
| Free-look sensitivity scale (mouse / analog stick / digital) | 0.83 per frame / 10000·dt / 5000·dt | [A] Default__CameraState_TA |
| MaxFreeLookPitchDegrees | 75 (±13653 rotator units) | [A] |
| GamepadFreeLookDeadzone | 0.1 hard cut (\|v\| > dz ? clamp(v, −1, 1) : 0), after the 0.2 per-axis rescaled stick deadzone | [A][S] |
| MouseSensitivity | 10 (menu 1–100) | [A] |
| Per-input defaults (CameraKBM / CameraController) | invert False, free look False, accel 5.8, decel 10.8, smoothing True, speed 2.5 | [A] |
| Modern preset overrides | KBM: free look on, accel 10.8, ball cam hold. Pad: free look off, accel 5.8, ball cam toggle | [S] |
| Modern camera | FOV 90, Height 100, Pitch −3, Distance 290, Stiffness 0.5, Swivel 2.5, Transition 1.0 | [A] |
| FreeLookExitSpeedFloor / Duration | 30 / 0.15 s | [A] |
| Full-rate speeds (speed 2.5) | pad 25000 u/s = 137.3°/s; keys 12500 u/s = 68.7°/s | derived |

### Input math (TA:105538, 105561) [S]
```
S = FreeLookSpeed
KBM:  raw = Cached;                                   scale = digital ? 5000*dt : 0.83
pad:  raw = |Cached| > 0.1 ? clamp(Cached, -1, 1) : 0; scale = digital ? 5000*dt : 10000*dt
  (digital: the key bound to that direction is not an analog axis)
target = raw*S*scale;  if dt <= 0: offset = 0
tr = target/dt
smoothing on:  rate += (tr - rate) * (1 - e^(-lambda*dt)),  lambda = raw == 0 ? Decel : Accel   (per axis)
smoothing off: rate = tr
offset = (int)(rate*dt)          (truncates toward 0, per axis; roll 0)
```
Test vectors (out/bsim/agents/K2/work/fl_vectors.py, 120 fps):
- Full pad stick for 1 s (speed 2.5, accel 5.8): 20745 u = 113.96°.
- Then released for 1 s: 22910 u in total.
- No smoothing: 24960 u.
- 100 mouse counts in one frame (sens 10, accel/decel 10.8): 2036 u. Per-frame offsets 178, 163, 149, …

### Per-frame order
1. **Native input events.** Each key/button event sets the device owner. Axes: mouse × MouseSensitivity; AxisSign
   filter; other-device free-look input dropped (ownership active); values summed into aFreeLook* [D].
2. **`PlayerInput_TA.PlayerInput`:** no mouse smoothing; aFreeLook* *= FOV/90 (the last view's FOV);
   `SetFreeLookDeviceOwnershipActive(GameEvent.IsActive())` [S].
3. **`PlayerController_TA.PlayerMove` → `ReplicateCameraRotation`:**
   - If M (free-look mode): CachedPitch = (aFreeLookUp + aFreeLookDown) · SwivelPitchDir (invert ? −1 : 1);
     CachedYaw = aFreeLookLeft + aFreeLookRight.
   - Otherwise the swivel axes.
   - Then the ball-cam exit check (CAM-15) [S].
4. **`Camera_X.UpdateCamera(dt)`:**
   - select the state (keep-executing, else the first `ShouldExecute` in list order);
   - Blender.Tick; the state's UpdatePOV on the persistent POV; finalize;
   - post-process: add the blend delta; aspect FOV; swivel only if `state.bCanSwivel && !M` (TA:14834); rear view
     +32768 yaw; knocks; ClipToField z ≥ 10 [S];
   - dt is the dilated world dt [I].

### Car state with free look (`UpdateValidPOV` TA:15389) [S]
1. Free-look input, or turn it off.
2. View offset; air/ground blend.
3. **Focus.** When active, the car-facing frame F = RLerp(InterpRotationGround, InterpRotationWall, 1 − |GroundNormal.z|)
   is used for both CalculatedLocation = Focus − F · Distance and the lag axis.
4. Save Rotation (if active and not the first frame).
5. **`UpdateAirAndGroundCamera`.** When active, the ground interp smooths InterpRotationGround and InterpRotationWall
   from their own previous values toward car forward + Angle pitch (roll 0). In the air only `UpdateAirPOV` runs, so F
   is frozen at takeoff.
6. Restore Rotation; Pitch += ViewOffset.Pitch − AppliedAnglePitch.
7. Distance (speed term along F); FOV.
8. **Finish.**
   - If not active: roll modifiers and bouncy chassis.
   - Else `ApplyFreeLook`: Rotation += FreeLookOffset; Pitch = int(clamp(±13653)); Roll = 0.

### Items
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| CAM-10 | Mode and gating | M per device. allowed = state.bCanFreeLook && M && !(rear allowed && behind view) (TA:105527). bCanFreeLook: Car, Demolished, DemoSpawnSelect; not LookAtBall, ScorerLiveReplay, Prespawn. BallCam_TA never runs while M (LookAtBall replaces it). Swivel off while M [S][A] | Classic only (`camera/rlCamera.ts:157-181`); swivel always (`:538-543`) | Per-device free-look flag; skip swivel when M; per-state bCanFreeLook |
| CAM-11 | Input source and units | As above [D][S] | No mouse motion (`input/devices.ts`); look = swivel stick (`game/online.ts:192-193`, `game/freeplay.ts:96-98`) | Pointer Lock (`unadjustedMovement`). Per frame, sum movementX and −movementY as counts × sens × FOV/90; invert pitch. Pad free-look DZ 0.1 after the stick DZ |
| CAM-12 | Rate smoothing | Formula above [S] | none | Port exactly (int truncation; lambda switches on raw == 0) |
| CAM-13 | Apply in the car cam | UpdateValidPOV order above [S] | `rlCamera.ts:157-181`, `:211-222`, `:307-314` | Add the free-look branch; keep InterpRotationGround/Wall as separate state |
| CAM-14 | Entry and reset | Begin from a non-car state snaps behind the car (first frame). New car → ResetToCarView (TA:105607). Rear view = recenter. Leaving LookAtBall keeps its rotation (copies its interp). No other auto-recenter [S] | `reset()` only (`rlCamera.ts:522-524`) | As described |
| CAM-15 | Ball cam in free-look mode (LookAtBall) | Ball-cam maths, no swivel or free look, roll 0. On entry it copies the car interp, including AirGroundBlend, bOnGround and GroundNormal (CopyInterpStateFrom TA:105619), then sets bFirstExecution = (Car.Controller == PCOwner): true for the local car, so the first frame snaps the rotation to the ball and the blender fades the old view out (TA:105666 [01f3]; corrected 2026-10-09). BlendTime = lerp(0.5, 0, TransitionSpeed − 1). Exit, toggle mode: KBM speed > 30 for ≥ 0.15 s (any frame ≤ 30 resets); pad: either axis past 0.1 exits at once; never while blending in, forced, or not current (TA:107519, 105700). Hold mode: lasts at least BlendTime; release ends it [S][A] | none (toggle/hold flags at `online.ts:376-377`) | Add the LookAtBall state and both exit rules |
| CAM-16 | Device ownership | Owner = device of the last key/button event; during Countdown/Active/PostGoalScored, free-look axes from the other device are ignored [D][S] | `devices.ts:52-56`: any button or axis > 0.5 switches | Owner from key/button events only; drop the other device's free-look during a match |
| CAM-17 | Input-type switch | Shell.InputType selects the unit path (TA:101258) and swaps the per-device camera settings (save outgoing, load incoming; TA:104132 → TA:107081) [S] | single `usingGamepad` | Save/load the per-device camera settings on a switch |
| CAM-18 | Defaults and presets | New profile Modern. Presets 0/1/2/4 copy their camera into both per-input sets with free look off; 3 (Custom) untouched [S][A] | Distance 270, toggle, invert True (`settings/settings.ts:91,93`; `rlCamera.ts:44-52`) | Offer Modern (KBM free look) and Default |
| CAM-19 | Remote free look (spectating, replays) | Replicated byte input × S · 10000 · dt, plus drift toward the replicated anchor: rate 1.5 + 0.3/° error, snap ≥ 45°; anchor every 0.0333 s, reliable after 0.1 s idle [S][A] | none | Only for spectators/replays |

## 2. Respawn cameras after a demolition (CAM-6), spec

**State order** (`Camera_Default.States`) [A]:
1. KismetOverride, SeasonIntro
2. LiveReplay, ScorerLiveReplay
3. Podium states
4. PreMatchLobby states
5. Waiting
6. **Prespawn**
7. **Demolished**
8. **DemoSpawnSelect**
9. LookAtBall, BallcamInverted, Ballcam
10. FreeCam
11. CarInverted, Car

Selection: the current state stays while `ShouldKeepExecuting()`, otherwise the first in order whose `ShouldExecute()`
passes [S]. One persistent POV: a field a state doesn't write keeps the last value ("rotation held") [S].

### Timeline (t = server demolition tick; 120 ticks per game second; ±1 tick)
| t (game s) | ticks | Server | Camera |
|---|---|---|---|
| 0 | 0 | `FinishDemo`: SetViewTarget(wreck), `Camera.Demolished`, hide, DetachFromController; spawn ticket 3.0 s; demo selection active | Car/ball cam → **Demolished**, 0.25 s EaseIn² |
| first select press, before 2.5 | – | `SetDemoSpawnPreference` (left 1 / right 2) | → **DemoSpawnSelect**, 0.25 s EaseIn² (DemoSelectLerpTime). Later presses: 0.1 s linear move between spots |
| 2.5 | 300 | `HandlePrespawn`: PC.Prespawn = {true, loc, rot}; selection closed | → **Prespawn**: from Demolished 0.5 s (PrespawnLerpSpeed); from DemoSpawnSelect lerp(0.5, 0, TS − 1) = 0.5 s at TS 1; both EaseIn². Arrives at 3.0 |
| 3.0 | 360 | `RestartPlayer` at the prespawn spot (else a 192 uu offset); bPrespawnSet cleared | When the new car is valid → **Car** (or ball cam): 0.5 s EaseIn². Settled at 3.5 s |

Timers run on dilated game time. There are no respawns in PostGoalScored or ReplayPlayback [S].

### Per-state math
- **Demolished** (TA:16450) [S][A]:
  - Begin: wreck = Camera.DemolishedPawn; TurnOffFreeLook.
  - Focus = wreck.Location + (0, 0, Height) on the first frame; Distance 400 and FOV = InitialFOV 120 are written every frame (TA:16450; same result). Then UpdateFreeLook /
    ApplyFreeLook each frame.
  - Rotation is never written (it keeps the car cam's last rotation, including roll in classic mode). Demolisher
    tracking is dead code (`bTrackDemolisher` never set).
  - Execute = Camera.bDemolished. Keep = !bPrespawnSet && !HasDemoSelection && ViewTarget ∈ {None, wreck, PC}.
- **DemoSpawnSelect** (TA:103053) [S][A]:
  - Entered only after the first press (SelectionState ≠ 0 && SpawnPreference ≠ 0). Distance and FOV = profile.
  - On a spot change: for s < 0.1, Focus = VLerp(prev, spot, s/0.1) and Rotation = RLerp(prevRot, spotRot, s/0.1,
    shortest). Afterwards Focus = SpawnLocation, Rotation = SpawnRotation (pitch 0). Begin sets s = 0.1 (no lerp on
    entry).
  - Then Focus.z += Height.
  - Free look: Accum += FreeLookOffset (pitch ±75°), Rotation += Accum, roll 0; Accum = 0 when inactive.
- **Prespawn** (TA:17120) [S]:
  - Focus = Prespawn.Location + (0, 0, Height). Spawn actors are at z 83, so the focus is at z 183.
  - Distance = profile; Rotation = Prespawn.Rotation; FOV = profile; no free look.
  - Execute = !HasDemoSelection && bPrespawnSet. Keep = that || PC state == 'WaitingForPawn'.
- **Blends** (TA:16420, 17133, 103084, 103089, 15613) [S][A]:
  - All blends are EaseIn², pct = (remaining/T)², applied to the frozen start difference.
  - Demolished → DemoSpawnSelect: 0.25. Demolished → Prespawn: 0.5. Demolished → anything else: a cut.
  - DemoSpawnSelect or Prespawn → other states: lerp(0.5, 0, clamp(TS − 1, 0, 1)).
  - Profile ranges: PrespawnLerpSpeed 0.5, DemoSelectLerpTime 0.25 (clamped ≤ 0.4), DemoSelectChangeSpawnTime 0.1
    (menu 0–0.5).

| # | What | Ours | Implement |
|---|---|---|---|
| CAM-20 | Selection order and rules | two states (`rlCamera.ts:529`) | Prespawn > Demolished > DemoSpawnSelect > LookAtBall/ball cam > car |
| CAM-21 | Trigger (`Car_TA.FinishDemo` TA:20622 → `Camera_TA.Demolished` TA:14913) | car hidden only (`render/entities.ts:68`); the camera follows the hidden car | On the local car's demoed flag: latch the drawn position as the wreck; enter Demolished |
| CAM-22 | Car → Demolished 0.25 s EaseIn² | – | Blender with per-transition time and a cut option |
| CAM-23 | Demolished math | – | As above |
| CAM-24 | DemoSpawnSelect | data exists: `car.spawnSelection` (`engine/world.ts:78-82`), `respawnSpots` (`:348`), HUD (`hud.ts:21-31`) | Spot = `respawnSpots(team, side)[index]` at z 83; 0.1 s lerp on change; accumulated free look |
| CAM-25 | Prespawn from 2.5 s | `spawnSelection.locked` (`world.ts:81`) | Enter when the respawn timer ≤ 0.5 or locked; locked spot (z 83) + Height; spot yaw, pitch 0 |
| CAM-26 | Blends between them | fixed TransitionSpeed blend (`rlCamera.ts:362-380`) | Per-state start/end params; fold any unfinished delta |
| CAM-27 | New car | online: no reset on respawn; freeplay resets (`freeplay.ts:207-212`) | Normal Prespawn → car 0.5 s blend, no reset. The car state starts fresh: first frame behind the car; ResetToCarView in free-look mode |
| CAM-28 | Classic mode in these states | – | Swivel and rear view still apply; clip z ≥ 10 |
| CAM-29 | Edge cases | – | No prespawn (respawn delay < 3, disabled, bots): Demolished → car is a cut. A goal while demolished: stay until the replay/kickoff cameras take over |

## 3. Goal sequence: slow motion, replay, kickoff reset

### Timeline (default online soccar, MatchTimeDilation 1)
| Event | game s | ticks | real s |
|---|---|---|---|
| Goal: `Ball.Explode`, `GotoGameState('PostGoalScored')`, state timer `PostGoalTime` 3.0 → 'StartReplay' [S][A] | 0 | 0 | 0 |
| Dilation starts falling | 0.125 | 15 | 0.125 |
| Minimum 0.1875 | 0.225 | 27 | 0.331 |
| Back at 1 | 0.625 | 75 | 1.155 |
| `StartReplay`: destroy balls and cars; replay or `StartNewRound` [S] | 3.0 | 360 | 3.530 |
| No replay: countdown | 3.0 → 7.0 | 360 → 840 (go) | 3.53 → 7.53 |
| With a replay of L game s (S_slomo s of it at 0.25 dilation): `StartNewRound` at its end or on skip, then 480 ticks | – | – | 3.53 + L + 3 · S_slomo, then + 4.0 |

The real-time figure is the integral of the curve: 0.125 + 0.206 + 0.824 + 2.375 (re-derived). It reconciles
notes/match-rules-audit.md: "goal → reset 360 ticks" and "goal → go 840 ticks" are game time, 3.53 s and 7.53 s real.
With a replay, tick 360 is the replay's start, not the kickoff.

| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| GS-1 | Goal moment (critical) | Ball removed the same tick; PostGoalScored: clock stopped, cars drivable, no respawns [S] | `server/src/game.rs:305-311` matches | – |
| GS-2 | Slow-mo curve (critical) | `PostGoalScored.Tick` (TA:4270): x += dilated dt; TimeDilation = Eval(ScoreSlomoCurve, x) · MatchTimeDilation, applied the next frame. Curve keys (0.125, 1), (0.225, 0.1875), (0.625, 1), linear, clamped (`Archetypes.GameEvent.GameEvent_Soccar`, verified) [S][A]. EndState restores 1 | fixed 1/120 s real (`server/src/game_loop.rs:13`) | Keep the tick count; tick k after the goal lasts (1/120) / D(k/120) real s on server and clients, keyed to the goal's server tick |
| GS-3 | Time base | Physics steps fixed 1/PhysicsFramerate from an accumulator over the frame dt (`FUN_140f54bd0 [old 140f4ec60]`) [D]. That dt is the dilated world dt [I, pending the loop spec], so 120 ticks per game second during slow-mo. State timers on game time [I] | none | Same; camera smoothing on dilated dt |
| GS-4 | Replay start (critical) | `StartReplay` (TA:4262): DestroyBalls, DestroyCars, then ReplayPlayback if a director exists and someone wants it, else `StartNewRound` [S] | `game.rs:358-362` starts a new round at 360 | Replay phase; cars removed at 360 |
| GS-5 | Who wants a replay | any PRI with !bBot && !bAutoSkipGoalReplay (TA:3654); profile default False [S][A] | none | Per-player auto-skip flag |
| GS-6 | Skip vote (critical) | `SetAllowReadyUp(true)` clears ready; checked every 0.01 s; all ready → `StartNewRound` (TA:1558, 1569, 4312). Bots, auto-skippers and team-less players are auto-ready. ReadyUp = Space / pad A. Otherwise ends with the replay (TA:4317) [S][A] | none | Unanimous over humans |
| GS-7 | Replay window | `GetReplayStartTime` (TA:84933): S = scoring touch time (0 if none) → min(S, goal − 4) − 2 → max(S, 0, goal − 10, record start, ball spawn); end = goal + 3 game s [S][A] | none | Same; clients replay their own snapshot history |
| GS-8 | Replay slow-mo | TimeDilation `SlomoTimeDilation` 0.25 for t ∈ (hit − 0.25, hit + 0.1), or (goal − 0.25, goal) if bSlomoForDefender (a defender within 200 + its radius + 95.49 of the ball) [S][A] | none | Server deadline = L + 3 · S_slomo real s |
| GS-9 | Replay focus | next toucher + ball; after the scoring touch, ball only [S] | none | Presentational |
| GS-10 | Replay camera `CameraState_LiveReplay_TA` | LocationOffset (9000, ±4000, 1000), Distance 1800, FOV 75, VelocityPrediction (0.3, 0.3, 0.1), FocusSpeed curve (0, 0.1)→(1, 4), on game time since the last change to a non-None focus car (LastFocusChangeTime is updated only when the new FocusCar != None, TA:15838; corrected 2026-10-09). During slow-mo FOV 25 / Distance 2800 over 1 s real. Cut in, 0.5 s fade from black. Full math: out/bsim/agents/K2/work/gs_notes.txt [A][S] | not ported (`rlCamera.ts:9`) | Presentational |
| GS-11 | Scorer view | `ScorerLiveReplay`: ball cam from the scorer's proxy (FOV 110, Height 70, Stiffness 0.3), toggled with `ToggleScoreView` [S][A] | none | Optional |
| GS-12 | Kickoff reset (critical) | `StartNewRound` (TA:3015), same frame as the replay end or skip (no replay: tick 360): winner → EndGame; time ≤ 0 → Overtime; Countdown (1 + 3 s = 480 ticks); ResetBalls (0, 0, 100.49); ResetPlayers (destroy + RestartPlayer at kickoff spots); ResetPickups [S] | `game.rs:250-255, 267-279` | Run it after the replay |
| GS-13 | View before tick 360 | own car cam on the dilated dt; goal message, light bar [S] | `online.ts:327-331`, `:394` | Apply GS-2 to rendering and camera dt |
| GS-14 | Offline vs online | Same flow offline (bots auto-ready). Offline PostGoalTime 3.0 [S][A]. **Freeplay (corrected 2026-10-09; see "Freeplay after a goal" below):** a goal runs the full sequence (PostGoalScored 3.0 s with slow-mo, then a replay unless the local Skip Goal Replay is on, then a new round), and the car is released 0.01 s after the reset without input. GoalResetType: 0 Standard (default); 1 Ball Reset (instant ball respawn, car untouched, no PostGoalScored; online freeplay only); 2 Disabled (= the offline "Disable Goal Reset" toggle: goals disabled entirely) [S] | `freeplay.ts:19, 144-149`: 2 s | 3.0 game s with the slow-mo |
| GS-15 | MatchTimeDilation | default 1 (game-speed mutators) [A][S] | none | Only if game speed is added |
| GS-16 | Camera at the kickoff | The old car is destroyed, so no state runs (POV frozen); the new car begins fresh (a cut behind it). After a replay, LiveReplay (blend 0), then the fade [I][S] | online: no reset on kickoff | `camera.reset()` on the kickoff spawn (not on a demolition respawn) |

**Timing-critical:** GS-1, 2, 4, 6, 8 (deadline), 12, and the respawn timers (300 / 360 ticks).
**Presentational:** GS-9, 10, 11, 13, 16 and all of CAM-6.

## Open
- **Unidentified gate:** the native feature bit gating device ownership (`[0x142380fc0]+0x7c` bit 3 (old-build data address)).
- **Input-type switching:** GFxShell's rules; button-driven switching is assumed.
- **Mouse convention:** raw counts with Y up-positive is the UE3 convention, not decompiled.
- **Dilated dt for physics and camera** [I]. Live check: a stopwatch from the goal to the replay or kickoff (3.53 s);
  the loop spec covers the physics side.
- **EOS cloud replace step:** only partly decoded.
- **Replication order:** possible one-frame gaps around prespawn and respawn.
- **`bSlomoForDefender`:** never cleared in script.
- **Live checks:** full-stick free look ≈ 114° in 1 s; 0.114° per mouse count (sens 10, FOV 90); FOV 90 → 120 within
  0.25 s after a demolition.

## Freeplay after a goal (offline, goal reset on), added 2026-10-09
Sources:
- the script dump (TA = out/bsim/work/tagame_live_all.txt) and live natives;
- the user's live checks: after a goal, the explosion, then a reset with no replay; A/D turns the front wheels after a
  reset;
- sub-agent notes in out/bsim/agents/FPQ1/.

Offline freeplay is GameInfo_Soccar_TA + GameEvent_Soccar + Mutator_Freeplay_TA (?GameTags=Freeplay).

1. **Goal tick G.** HandleHitGoal (TA:4061): ball explosion as in matches. Either net scores for the player's team
   (both goals TeamNum 1, TA:70293). **No scored message:** ShowScorerGoalMessage is false in offline freeplay
   (TA:4592).
2. **PostGoalScored, 3.0 game s = 360 ticks,** with the ScoreSlomoCurve slow-mo; the car stays drivable. Backspace
   (FreeplayCommands_TA.ResetTraining, TA:29964; 1.0 game s cooldown) goes straight to step 4, also during this state.
3. **Tick G + 360: StartReplay** (TA:4262): DestroyBalls, DestroyCars.
   - A replay plays iff ShouldPlayReplayPlayback: any PRI that's not a bot and not bAutoSkipGoalReplay (TA:3654).
     Freeplay has no special case, so it follows the player's Gameplay → "Skip Goal Replay" (default off).
   - The user saw no replay, in freeplay and in offline exhibitions alike: their "Skip Goal Replay" is on
     (confirmed 2026-10-09). So the rule is no freeplay special case: our "Skip goal replays" setting drives it
     the same way as in matches.
   - Otherwise StartNewRound in the same tick.
4. **New round** (StartNewRound TA:3015; shared with Backspace): StartCountDown, ResetBalls, ResetPlayers, ResetPickups.
   Soccar Countdown.BeginState also resets pickups again 0.1 s later (TA:3948).
   - **Ball** at its spawn (0, 0, 100.49), at rest, XY-locked until Active.StartRound (Z free).
   - **Car** re-created at spot S[k mod 10], with k = NextSpawnIndex (++ per countdown end, TA:3969). The 10 spots are
     [B(P0), O(P0), B(P1), O(P1), …]: P is the session's shuffled 5 kickoff spots, B blue, O the mirrored orange
     (−x, −y, yaw + 180°). So consecutive resets alternate field halves (DistributeSpawnPointsEvenly / HandleTeams,
     TA:70341/70343; GetSpawnOrientation TA:2707).
   - **Boost** per Boost Options: Unlimited (default) = 100 and no drain; Standard = 33.3; Auto-Refill = 33.3 refilling
     at 100/s after 1.5 s on the ground.
5. **Countdown with CountdownTime 0** (Mutator_Freeplay_Base_TA.Init, TA:70297): InitCountDown arms a 0.01 s timer
   (TA:1867) → StartEvent → Active, so the **car is released after one frame (0–2 ticks) without input**. The
   ShouldStartRound poll (throttle/jump/boost, every 1/60 s) exists but the timer fires first. No GO!/countdown text
   (bCountdownMessagesDisabled, TA:70307).
   - **While held (bDriving false):** horizontal XY lock on car and ball (a 6-DOF constraint; gravity and suspension
     act); throttle, brake, handbrake and physics steer are 0; no jump (OnJumpPressed returns, TA:20440), boost, dodge or
     air control.
   - **Still active while held:** **visual front-wheel steer** follows the steer input (wheel bones ease to
     WheelsSteer × SteerFactor, no gate; natives 0x140f66000, 0x140f664a0), and the engine sound follows throttle. So
     "A/D turns the wheels" doesn't tell held from released.
6. **Total from goal to driving:** about 362 ticks (≈ 3.55 s real at speed 1, without a replay).
7. **"Disable Goal Reset" ON** (TrainingDisableGoals → GameplaySettingsSave.bDisableFreeplayGoals, default False; type
   2): goals disabled entirely (Goal_TA.bEnabled false). No detection, explosion, score, slow-mo or reset; only
   Backspace resets.
8. **Live confirmation of step 5, no mods:** after a reset, wait about 2 s without input, then tap Jump once. If it
   jumps on the first tap, the car was already released (expected). If only the second tap jumps, it was held.
