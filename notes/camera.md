# Camera values (build 2026-06-16)

Values read from `GameInfo_Soccar_SF.upk` (`Archetypes.Camera.*`) and `TAGame.upk` with `scripts/props.py` /
`scripts/search_props.py`. The update logic is UnrealScript (TAGame `CameraState_Car_TA`, `CameraState_BallCam_TA`,
`CameraState_CarRef_TA`, `Camera_TA`; ProjectX `Camera_X`, `CameraStateBlender_X`, `CameraUtils_X`; Core smooth
interps), disassembled with `scripts/ubytecode.py` (local output: `out/decomp/camera_script.txt`,
`camera_base_script.txt`). Ported to `client/src/camera/rlCamera.ts`; see "Algorithm" below.

## Player settings (defaults)
`TAGame: Default__CameraState_DirectorBallCam_TA.ForcedCameraSettings`, the stock profile values:

| FOV | Distance | Height | Angle (pitch) | Stiffness | Swivel speed | Transition speed |
|---|---|---|---|---|---|---|
| 90 (horizontal) | 270 | 100 | −3 | 0.5 | 2.5 | 1.0 |

## Car cam (`Archetypes.Camera.CameraState_Car`, class `CameraState_Car_TA`)
| Property | Value |
|---|---|
| InterpToAirRate / InterpToGroundRate | 4.0 / 2.0 |
| FocusInterp Rate / MaxDistance | 6.32 / 100 (Rate_Old 6.0) |
| FocusOffsetInterp Rate | 2.03 (Rate_Old 2.0) |
| DistanceInterp Rate | 4.14 (Rate_Old 4.0) |
| GroundRotationInterpRate / …Wall | 13.39 / 2.03 |
| AirVelocityInfluence / …MaxSpeed | 35 / 10 |
| DistanceSpeedScale / DistanceOffsetMin | 0.05 / −50 |
| MaxSpeedFOV / FOVInterpSpeed | 5 / 25 |
| SupersonicFOV / SupersonicFOVInterpSpeed | 10 / 40 |
| BouncyChassisScale / RollScale | 0.065 / 0.1 |
| GroundNormalInterpRate | 10.46 |
| DefaultBlendParams.BlendTime | 0.5 (the archetypes override only this; the base `Default__CameraState_X.DefaultBlendParams` is VTBlend_EaseIn, BlendExp 2, so a state switch's offset fades as (remaining / 0.5)², not linearly: static session CAM-2, client fixed 2026-10-08) |

## Ball cam (`Archetypes.Camera.CameraState_Ballcam`, class `CameraState_BallCam_TA`)
The car-cam values above, plus:

| Property | Value |
|---|---|
| RotationRate | 8.59 |
| PitchScale | 0.8 |
| PitchFocusZFactor | 0.005 |
| PitchExtentMin / Max | 4000 / 8000 (rotator units; 65536 = 360°, so 22.0° / 43.9°) |

## Camera (`Archetypes.Camera.Camera_Default`, class `Camera_TA`)
| Property | Value |
|---|---|
| SwivelExtentSlow | PitchMin −8900, PitchMax 5500, YawMax 22500 (rotator units) |
| SwivelExtentFast | PitchMin −8900, PitchMax 5500, YawMax 18000 |
| SwivelFastSpeed / SwivelDieRate | 2500 / 2.0 |
| ClipRate | 4.0 |
| Splitscreen | horizontal height −40, horizontal FOV −20, vertical FOV +10 |

Demolished camera: InitialFOV 120, FOVBlendTime 1.0, MaxZoomInFOV 15, MaxFOVBlendDistance 5000, Distance 400.

## Input (`TAGame/Config/DefaultInput.ini`, plain text in the install; full pipeline in `notes/input.md`)
- `PlayerInput_TA`: GamepadDeadzone 0.3 (replaced by the profile's controller deadzone, default 0.2),
  GamepadFreeLookDeadzone 0.3 (a dead ini key: the live profile field `PlayerInput_X.GamepadFreeLookDeadzone` is 0.1,
  menu 0–0.75; static session CAM-9), triggers 0.1 (`GamepadDeadzones`), MouseSensitivity 10, KeyboardAxisBlendTime 0.
- Default bindings ("Standard" preset): W/S throttle + pitch, A/D steer + yaw, Q/E roll, LMB boost, RMB jump, Left
  Shift powerslide + air roll, Space ball cam, MMB rear camera, Backspace reset training, 1/2/3 freeplay ball helpers.
  The live game's default since the 2026-10-06 update is "Modern" (the client's default): Space jump (LMB the
  alternative jump), Left Shift boost, RMB powerslide + air roll, MMB ball cam, Left Ctrl rear camera (static
  session C-3, notes/controls-audit.md).
  Gamepad: RT/LT, left stick, A jump, B boost, X powerslide, Y ball cam, RS click rear camera, RB reset,
  D-pad down/up ball helpers. The base preset puts gamepad air roll on the left trigger; "Legacy" puts it on X.

## Algorithm (decompiled)
Each frame, per rendered frame with the frame's DeltaTime (`Config.bFramerateIndependentInterp = True`).

**Ours steps it at the screen's rate, on a steady clock** (`client/src/camera/pacedCamera.ts`; the user's choice,
RX82's RV-1251 (b), 2026-11-10: "i care about feeling similar to the game"; RX84's fixes). The formulas are the game's,
stepped as the game steps them at a rate R, so its lag behind a turning car is the game's at R: in a steady full-lock
turn (1410 uu/s, 653 uu) 2.45° at 30, 3.23° at 60, 3.68° at 120, 3.76° at 144, 3.81° at 165, 3.92° at 240, and the air
camera settles as the game's at R. At even frames it is the game's camera frame for frame (tested: a turn, the air's
quarter turn, a goal's slow motion).

- **Why a clock, not the frame's time:** stepped once a frame with that frame's length, the smoothing's lag behind a
  turning car changes with each frame's length, so uneven frames (a phone's dropped ones, Firefox's timer, a hitch)
  wobbled the car on screen in a steady turn: 0.76° at 60 Hz with 15 % of frames dropped, a 1.1° jump on a 66 ms hitch
  (the user's report, phone and Firefox). Ours runs whole steps of 1/R on a grid phase-locked to the frames.
- **R is the screen's refresh**, so on a screen with a fixed refresh every frame drawn lands on a step (RX84's RV-1259):
  a desktop's measured from its frames (each interval over the whole refreshes it spans, a dropped frame two, averaged: a
  timer's jitter cancels; seeded from their median, or from the short ones' median when they're a sixth or more of them,
  most frames doubled, RX85's RV-1268; taken every 30 frames, and at once when the newest eight are all the same and a
  tenth or more shorter: a window moved to a faster screen, RV-1272), a touch device's from its frame pacer, which sees
  every animation frame (input/touchSettings.ts FramePacer, the same estimate, exact: the step's length every frame,
  the lock holding the phase alone, RV-1270). A phone's Frame Rate cap that divides the refresh (120 Hz at 60 or 30, 60
  at 30, 90 at 30) is R instead: the game's feel at the cap (3.23° at 60), the frames drawn landing on its steps; a
  vsync missed (the pacer's re-phase) takes one step of the time that passed, as the game's on a late frame, the steps
  from that frame on. A cap that doesn't divide it (90 Hz at 60, 144 at 60) steps at the refresh (90/60: 3.53°), its
  frames a refresh or two apart each on a step, the car never shimmering against the ball (RV-1262: the user's choice
  (i), 2026-11-10). A rate moved 2 % is a new one (another screen, a refresh changed, a cap chosen): the grid starts again
  on it (RV-1269); the lock (a small phase and rate correction) follows a desktop's screen a little off the rate measured.
  A variable-refresh screen has no fixed refresh: R follows its frames' mean rate, and the frames that come before a
  step (8–10 % at 7–14 ms) keep the last step's car with its view (the car with its camera; a few uu from the scene, a
  wobble of a few tenths of a degree): RV-1271, open, a real variable-refresh screen's to answer.
- **Each step** takes the car and ball as they were at its moment, blended from the ticks (the last 32: car, ball,
  respawn; online the car with its correction's offset, SyncError, notes/netcode-audit.md N-1, which decays once a tick
  and is drawn between the last two: RV-1247), carried at most 0.15 tick past the newest (a timer's jitter: a wall's or a
  touch's overshoot under 3 uu, RV-1263). The car it follows is drawn as its last step saw it, at that step's moment (the
  frame's), so the two agree whatever the frames; a frame without a step (a variable-refresh screen's) keeps the last
  step's car with its view.
- **Resets, stalls, time away:** a reset forgets the ticks before it, so the new car is drawn at once with the view
  behind it (RV-1260); a stall past a quarter second runs no steps, one step of the time the scene moved and the grid
  from there (RV-1261: no more swing than the game's at a 40–100 ms hitch at 240 Hz); back after frames it didn't plan
  (the editor's camera, a replay) only that frame's moving is stepped (RV-1264).
- **Its inputs:** the frame's controls; the mouse's free look (its counts, not a rate) shared over the frame's steps,
  taken only on a frame the camera runs (none piled up through a goal replay: RV-1248); the swivel's real time 1/R a
  step; a goal's slow motion and the time the physics clock drops in a stall in each step's world time (the scene's).
- Measured with the real camera code (pacedCamera.test.ts), on fixed-refresh screens: no frame without a step and the car
  within 0.5 uu of its camera and 3 uu of the scene (a third of 60 Hz frames doubled, 30 to 45 % at 60 and 144 over ten
  runs each, half and 70 % at 60, a 1 ms timer at 120, a window from 60 to 144 Hz, Firefox's 16/17 ms, ±1 ms of jitter,
  phones at 144/60, 144/30, 120/30, 90/60 and 120/60 with 2 % of vsyncs missed, the 30 caps over ten runs); a steady turn
  still on screen (under 0.01°; 0.05° at ±2 ms of jitter at 144, where the game's wobbles 0.5°); after a window's move,
  still within 4 s whatever the time before it, a faster screen stepped every frame within 0.2 s; a phone's missed vsync
  swinging no more than the game's camera on the same frames; a 40 ms hitch at 240 Hz under 0.1°; no step's moment more
  than 0.15 tick past the newest. On a variable-refresh screen the car stays with its camera.

**Camera_X.UpdateCamera**: the active state updates a persistent orientation `POV {Focus, Rotation, Distance,
FOV, CalculatedLocation}`. Then `FinalizeOrientation`: normalize the rotation, set
`CalculatedLocation = Focus - Vector(Rotation) * Distance`. A copy gets post-processing (transition offset,
swivel, rear view) and is finalized again for display. States always read the un-post-processed POV of the
previous frame.

**CameraState_Car_TA.UpdateValidPOV**, in order:
1. `UpdateViewOffset`: Focus.Z = Height; Pitch = Angle × 182.044 (rotator units); Distance = Distance × max(0.75, mesh scale).
2. `UpdateAirGroundBlend`: on ground = `Car.IsOnGround()` and the jump component not active. Blend += 2·dt on
   ground, −= 4·dt in the air, clamped 0..1. On landing GroundNormal snaps to `Car.GetGroundNormal()`.
3. `UpdateFocusWorldOffset`: on ground (blend 1) the offset is (0,0,Height) rotated by the car (along the car's up);
   otherwise world up. Smoothed with rate 2.03.
4. `UpdateFocus`: Focus = car location + offset; a lagged copy (rate 6.32, at most 100 uu behind). The lagged copy
   keeps only its sideways/vertical offset relative to the view, then `POV.Focus = lerp(lagged, Focus, Stiffness)`.
5. Rotation:
   - **Ground**: U = GroundNormal smoothed at rate 10.46; F = (U × CarForward) × U is the car's forward in
     the ground plane. CameraDir = lerp(F, ±U, min(|pitch(F)|/48000, 1)), i.e. up to a third of the way toward
     the surface normal when climbing. Then add the angle offset. Turn toward it with RSmoothInterpTo at rate
     13.39 × lerp(1, 3.427, Stiffness) on floors and 2.03 × the same on walls, mixed by 1 − |U.z|
     (Stiffness 1 snaps on floors).
   - **Air**: turn toward the direction from the camera's current position to the focus, at
     lerp(35, 10, speed / 2300) × (1/60) per frame (a fixed 1/60, not DeltaTime). If moving away from the view,
     scale the pitch by (1 − horizontal speed / 2300). On the first frame: the car's yaw blended toward the
     velocity yaw by min(|v2d|/500, 1).
   - Between ground and air: both are computed and blended by the air/ground blend.
6. `UpdateDistance`: Distance + max(v · viewDir × 0.05 × (1 − Stiffness), −50), smoothed at rate 4.14.
7. `UpdateFOV`: target FOV + 5 × speed/2300 (25 deg/s), or FOV + 10 when supersonic (40 deg/s). It moves linearly,
   at most rate × dt per frame.
8. `UpdateRotationModifiers` (car cam only): Roll = −0.1 × pitch(car right axis) × blend, i.e. a tenth of the car's
   roll on the ground. Plus "bouncy chassis" = chassis spring bone rotation × 0.065 (not ported).

**Ball cam** (CameraState_BallCam_TA) overrides:
- Focus offset is (0,0,Height) in world space with no smoothing; the focus lag is clamped to 0.001 uu.
- Rotation: toward the ball from the focus. The focus is raised by |pitch to ball| × 0.005. The pitch is
  lerp(Angle, pitch to ball, 0.8 × clamp((|pitch| − 4000)/4000, 0, 1)), so the camera only tilts once the ball is
  more than about 22° above or below, reaching full effect at about 44°. Smoothed at RotationRate 8.59.
- No roll.

**Transitions** (CameraStateBlender_X): switching state snapshots the old state's view, starts the new one fresh, and adds
(old − new) × remaining/blendTime to the displayed view. Blend time = lerp(0.5, 0, clamp(TransitionSpeed − 1, 0, 1)),
linear.

**Helpers**: `GetSmoothInterpLerpValue(λ, dt) = 1 − e^(−λ·dt)`; `RLerp` takes the shortest path;
`Vehicle_TA.GetGroundNormal` (native `FUN_140ef00c0`) is the normalized average contact normal of the wheels in
contact, or (0,0,1). `Camera_TA.ClipToField` keeps the camera ≥ ground + 10.

**Swivel** (`Camera_TA.PostProcessCameraState`, after the blend offset; states with `bCanSwivel`, car and ball cam):
```
UpdateSwivel(dt):                       // dt / TimeDilation
  InputPitch, InputYaw = RangeByteToFloatSigned(CameraSettings.CameraPitch / CameraYaw)   // notes/input.md
  PitchSpeed = YawSpeed = ProfileSettings.SwivelSpeed
  Desired = GetDesiredSwivel(InputPitch, InputYaw):
    Alpha = clamp(|car velocity| / SwivelFastSpeed, 0, 1); Extent = int(Lerp(Slow, Fast, Alpha)) per field
    Yaw = int(InputYaw * Extent.YawMax)
    Pitch = int(InputPitch > 0 ? InputPitch * Extent.PitchMax : |InputPitch| * Extent.PitchMin)
  if |Desired.Pitch| < |Current.Pitch|: PitchSpeed *= SwivelDieRate      (same for yaw)
  Current.Pitch = int(Lerp(Current.Pitch, Desired.Pitch, min(PitchSpeed * dt, 1)))  (same for yaw)
ApplySwivel: OutPOV.Rotation += CurrentSwivel
ApplyRearCameraView: if bUsingBehindView and state.bAllowRearCamera: OutPOV.Rotation.Yaw += 32768
```
With the rear camera on, the ball cam's overrides (`UpdateAirAndGroundCamera`, `UpdateFocusWorldOffset`, the focus
max distance) fall back to the car cam's, and switching it on or off makes the ball cam start over (`bWasReverseCam`).
The ball cam keeps no car roll either way.

**Not ported yet**: proximity distance (off unless a proximity target class is set), bouncy chassis,
demolished/replay/goal cameras.
