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
| DefaultBlendParams.BlendTime | 0.5 |

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
  GamepadFreeLookDeadzone 0.3, triggers 0.1 (`GamepadDeadzones`), MouseSensitivity 10, KeyboardAxisBlendTime 0.
- Default bindings: W/S throttle + pitch, A/D steer + yaw, Q/E roll, LMB boost, RMB jump, Left Shift powerslide +
  air roll, Space ball cam, MMB rear camera, Backspace reset training, 1/2/3 freeplay ball helpers.
  Gamepad: RT/LT, left stick, A jump, B boost, X powerslide, Y ball cam, RS click rear camera, RB reset,
  D-pad down/up ball helpers. The base preset puts gamepad air roll on the left trigger; "Legacy" puts it on X.

## Algorithm (decompiled)
Each frame, per rendered frame with the frame's DeltaTime (`Config.bFramerateIndependentInterp = True`):

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
