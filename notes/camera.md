# Camera values (build 2026-06-16)

Read from `GameInfo_Soccar_SF.upk` (`Archetypes.Camera.*`) and `TAGame.upk` with `scripts/props.py` /
`scripts/search_props.py`. The update logic (`CameraState_Car_TA`, `CameraState_BallCam_TA`) is not
decompiled yet (roadmap §3); `client/src/camera/carCamera.ts` uses these numbers with provisional logic.

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

## Input (`TAGame/Config/DefaultInput.ini`, plain text in the install)
- `PlayerInput_TA`: GamepadDeadzone 0.3, GamepadFreeLookDeadzone 0.3, triggers 0.1 (`GamepadDeadzones`),
  MouseSensitivity 10, KeyboardAxisBlendTime 0.
- Default bindings: W/S throttle + pitch, A/D steer + yaw, Q/E roll, LMB boost, RMB jump, Left Shift powerslide +
  air roll, Space ball cam, MMB rear camera, Backspace reset training, 1/2/3 freeplay ball helpers.
  Gamepad: RT/LT, left stick, A jump, B boost, X powerslide, Y ball cam, RS click rear camera, RB reset,
  D-pad down/up ball helpers. The base preset puts gamepad air roll on the left trigger; "Legacy" puts it on X.
