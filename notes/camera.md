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

**Ours: the game's feel at the player's own rate, whatever the frames** (`client/src/camera/frameCamera.ts`, `drift`
in `carballCamera.ts`; the user's choice, RV-1251 (b), 2026-11-10: "i care about feeling similar to the game"; this
shape the 2026-11-11 audit's, report 6's design observation, in place of the paced grid).

- **The feel at a rate.** Every smoother in the camera is the game's `x += (T − x)(1 − e^(−λ·dt))`. Behind a target
  moving at v, stepped every h, its lag settles at `v·h / (e^(λh) − 1)`: in a steady full-lock turn (1410 uu/s, 653 uu;
  the ground rotation's λ 29.64 /s at stiffness 0.5) 2.45° at 30 frames a second, 3.23° at 60, 3.68° at 120, 3.76° at
  144, 3.92° at 240. That's what the camera feels like at a frame rate.
- **Why uneven frames wobble.** The step treats the whole of its target's move as made at its end, so the lag after a
  frame depends on that frame's length: dropped frames, a busy browser's, a timer's jitter change it frame by frame
  (0.76° at 60 Hz with 15 % of frames doubled, 1.1° on a 66 ms hitch: the user's report, phone and Firefox).
- **Part A: whole updates across the frame.** Each frame runs the game's own update once for each nominal frame (1 /
  the feel's rate) the scene's move spans, to the nearest whole number (8 at most), each on the car and ball as a frame
  at its moment would have drawn them: between the two physics ticks about it, the later one's flags (the games tell
  the camera each tick's car and ball; online the car with its correction's offset, SyncError, which decays once a tick:
  RV-1247). A doubled frame is then exactly two of the game's updates.
- **Part B: an update of any length lands where the game's would.** Each update is told the share of a nominal frame
  it spans, and each smoother adds `drift(λ, dt, frames) × (T − lastT)`: the difference, exact for a target moving
  evenly, between one step of that length and the game's steps at the nominal length (`q − (1 − q)·q1 / ((1 − q1)·
  frames)`, q = e^(−λ·dt), q1 = q^(1/frames); 0 at a share of 1, so at even frames at the feel's rate the camera is the
  game's, update for update). On the focus, focus offset and distance (InterpVector), the ground's and the wall's
  rotations, and the ball cam's. With it: the view's direction the focus is projected along is the last update's (the
  game's: a frame before this one's end), so it is carried on at the last update's rate over the frames past one. A
  target not followed the update before (a state begun, the ball cam for the car cam) has no last value: that update
  is the game's step.
- **The air view is no smoother** (RV-1301: the first version treated it as one and wobbled three times the game's
  own in a steady air turn). The game's frame turns the view a fixed share s toward the focus as seen from the
  camera's last place: a direction one frame of the focus's travel ahead of the view, which goes on ahead as the view
  turns (the camera swings round the focus with it). So n frames turn the view n shares of that one frame's angle,
  not 1 − (1 − s)^n of it. An update spanning `frames` of them is that step taken `frames` long: it looks ahead by
  the focus's move over the *first* nominal frame of its span (taken along the focus's last three places, so a turn's
  bend counts: along the chord alone the lag was off by half a frame's turn for each frame past one) and turns
  min(1, s × frames) of the way. The steady lag is then the game's at any update length (19.110° in a 3000 uu air
  circle for updates of 0.4 to 2 frames). The pitch's flattening (the pitch scaled by `keep` each frame the car flies
  against the view) is that frame's pair repeated: keep^frames of the pitch, plus the turns' own scaled sum.
- **The rate (the feel's) needs no precision:** it sets the lag and nothing else (a 20 % error moves a steady lag
  0.15°; no frames can make it wobble). It's the page's own frames' rate of late (`RefreshMeter.recentHz`: the nearest
  common display rate of the fast frames of the last 120, the highest such measure of the last 10 s, so it comes
  down when a window moves to a slower screen). The fast frames are the cluster about the fastest tenth, and their
  mean is the interval: the edge alone read a jittered 75 Hz as 90 (RV-1305). A stall (100 ms) and the 30 frames after
  it aren't counted: a catch-up burst read 360 Hz for 10 s (RV-1302). A rate rises when two measures in a row agree and
  holds while a twenty-fifth of the frames still run at it: one threshold for both flipped the feel between a rate and
  its half at nine frames in ten doubled (RV-1303). Or a touch device's Frame Rate when that's the lower (a phone capped at
  60 has the game's feel at 60, whatever its screen: 90 Hz at 60 too, which the grid couldn't without the car shimmering
  against the ball); 60 before the first measure. A page can't see its screen's true refresh or its phase, only when its
  own frames ran: the paced grid before this needed both, and five review rounds found the cases where they can't be
  had (a phone's browser missing refreshes, most frames doubled, a variable-refresh screen: the audit's REN-01, 02, 03).
- **The car is drawn at the frame's moment,** like the ball and every other car (the grid drew it at its last step's:
  REN-03). A new car (a spawn's count, a demolition, a teleport) is never blended across (REN-08): the updates step to
  it by the ticks, the car put there at its tick's moment (RV-1306), or with no ticks told, in the frame's one update.
  A frame another camera draws (the garage's, the editor's, a goal replay's) and a reset start the player's afresh
  from its own car.
- **The mouse's free look** is its counts, not a rate: a frame's are shared over its updates, and the part of a
  rotator unit each update's truncation leaves is carried to the next, so the frame's turn is truncated once, as the
  game's frame's is (RV-1304). The swivel's real time and a goal's slow motion are each update's share of the frame's.
- **Measured** (`frameCamera.test.ts`, the real camera code, physics clock and frame pacer):
  - even frames at 30, 60, 120, 144, 165, 240 Hz: the game's camera frame for frame (a turn, the air's quarter turn,
    a goal's slow motion, the ball cam);
  - a steady turn, the car's yaw on screen within 0.01° at the feel's lag, where the game's own camera wobbles 0.2 to
    2°: 15, 85 and 95 % of 60 Hz frames doubled, 45 % at 144, Firefox's 16/17 ms, ±1 and ±2 ms of timer jitter, a
    variable-refresh screen (7 to 14 ms), a 66 ms hitch a second, a 120 Hz phone at 60 in a browser busy past a
    refresh (frames 2 and 3 refreshes apart, 20 and 40 % late), a 90 Hz phone at 60. The car's place in the view
    within 0.05° (the busy phone's 0.04°: the focus follows the car's curved path between updates as along a line;
    the game's own 0.26°);
  - a steady turn in the air on the same kinds of frames: the lag within 0.02° of the even camera's and still to
    0.01°, where the game's own wobbles 0.03 to 0.25°;
  - through transients, against the even-frame camera at the same moments, the view and the car's place in it, ten
    seeds a pattern (one seed's worst frame is no guide). Doubled frames (40, 90 %): that camera's to 0.001°
    everywhere, a jump included (the game's own 1 to 3° off). Frames that fall between an even camera's (jitter, the
    phones' patterns): between events within 0.01° of an even camera at some phase (the game's own 0.2 to 0.4° off
    every phase); in ball cam the same; through a slalom all in the air within 0.11°. **At a take-off or a landing
    it is no one even camera's:** those differ among themselves by 0.7 to 1.9° by when each first sees the car off
    the ground, and a frame between two of theirs is inside that spread, 0.3° from the nearest at worst (mean 0.1 to
    0.16°), as the game's own camera on such frames is.
- **What it gives up:** on uneven frames the camera isn't only the game's code (Part B's terms are ours); under a
  timer's jitter the whole picture moves with the frame's time, as in any game.

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
