# Input: from keys and sticks to car controls

Decoded from `TAGame.upk` scripts (`scripts/ubytecode.py`) and the exe's native input code. Ported in
`client/src/input/mapping.ts` and the engine (`engine/README.md` patches 21–22).

## Actions (`PlayerInput_TA.GetDefaultActions`)
Each action either adds to an input axis (`Axis`, with `AxisSign` 1 = positive, 2 = negative) or runs a command.

| Action | Axis / command |
|---|---|
| ThrottleForward / ThrottleReverse | `aForward` + / − |
| SteerRight / SteerLeft | `aStrafe` + / − |
| YawRight / YawLeft | `aPositiveYaw` / `aNegativeYaw` (negative axis holds negative values) |
| PitchUp / PitchDown | `aPositivePitch` / `aNegativePitch` |
| RollRight / RollLeft | `aPositiveRoll` / `aNegativeRoll` |
| SwivelUp / SwivelDown / SwivelRight / SwivelLeft | `aLookUp` / `aLookDown` / `aTurnRight` / `aTurnLeft` |
| Jump / Boost / Handbrake | `ToggleJump true \| OnRelease ToggleJump false` (and Boost, Handbrake) |
| ToggleRoll (air roll) | `Button bRoll` |
| SecondaryCamera (ball cam) / RearCamera | `PressSecondaryCamera \| OnRelease ReleaseSecondaryCamera`, same for rear |
| MouseSteerLeft/Right, MouseThrottleForward/Reverse | `aMouseStrafe`, `aMouseForward` (optional mouse steering, see below) |

## Axis values (native `PlayerInput_X` InputAxis override, `0x140e386b0`)
For each binding of the event's key (PC bindings for keyboard/mouse, gamepad bindings for pads):
- The binding's `AxisSign` filters the key's side: positive skips negative deltas; negative skips positive
  ones and takes the absolute value.
- Mouse axes are multiplied by `MouseSensitivity` first.
- Gamepad: deadzone = the `GamepadDeadzones` entry for this platform and key (triggers: 0.1), otherwise
  `GamepadDeadzone`. **Per axis**, not circular: `sign(v) · max(0, |v| − dz) / (1 − dz)`.
- Keyboard: optional blend-in over `KeyboardAxisBlendTime` (0: full value at once).
- The action's `AxisSign` 2 negates the value; then it is added to the axis.

`GamepadDeadzone` is set from the profile's `ControllerDeadzone` (`PlayerInput_TA.HandleProfileGamepadSave`).

## `PlayerInput_TA.PlayerInput` (per frame)
- **Air roll held** (`bRoll`): `aPositiveRoll = aPositiveYaw; aNegativeRoll = aNegativeYaw; yaw = 0`.
  Free air roll *replaces* directional roll: Q/E do nothing while it is held.
- Look axes (`aLookUp`, `aLookDown`, `aTurnRight`, `aTurnLeft`, ...) are multiplied by `FOV / 90` (current camera FOV).
- Flags for mouse steering: `bIsUsingMouseSteer` when both MouseSteer actions are bound to `MouseX`, etc.

## `PlayerController_TA.PlayerMove` (per frame)
```
Throttle = aForward; Steer = aStrafe
if Throttle == 0: UpdateMouseGroundThrottle(MouseYDeadZone)      // only when mouse throttle is bound
if Steer == 0:    UpdateMouseGroundSteer(MouseXDeadZone)
ModifiedAirRotationByMouseInput(...)  // Pitch = aPositivePitch + aNegativePitch, Yaw, Roll likewise
                                      // (+ mouse air control when bound to MouseX/MouseY)
if no car or car on ground: bHasPitchedOrRolled = false
DodgeForward = -Pitch; DodgeRight = Yaw; bAirRoll = bRoll != 0
ApplyAirPitchSafety()
```
**ApplyAirPitchSafety** (keyboard/mouse only; profile `bAirPitchSafetyEnabled`, default on):
```
if enabled and !bHasPitchedOrRolled and !bUsingGamepad:
    if Pitch >= 0 or |Roll| > 0: bHasPitchedOrRolled = true
    else: Pitch = 0          // after DodgeForward was taken: dodges keep the pitch
```
So leaving the ground while holding nose-down (W) doesn't pitch until W is released or the player rolls,
but a front flip still works.

Mouse steering (decoded, not ported; off by default): `CalculateMouseAxis(center, loc, deadzone, max) =
clamp((d − sign(d)·deadzone if |d| ≥ deadzone else 0) / max, −1, 1)`; ground steer accumulates
`aMouseStrafe` into `Car.MouseAccel.Y` (max 250, deadzone 15% of max), decaying with `FInterpTo(…, 0, dt, 15)`;
throttle max 1250; air uses `MouseAirAccel` with max 300.

## Player preferences in the physics (`PRI_TA.SetUserCarPreferences`)
The client sends `DodgeInputThreshold`, `SteeringSensitivity`, `AirControlSensitivity` to the server
(`ServerSetUserCarPreferences` validates to 0–1, 1–10, 1–10). The car applies them:
- `FUN_140396ca0(input, sens)`: if `sens > 10` or `|sens − 10| < 0.001`, input = sign(input); then
  `clamp(input · sens, −1, 1)`. Steering: VehicleSim `FUN_140f1e830`. Air control: `FUN_140eb3400`
  (pitch, yaw, roll each). The dodge check and direction use the raw `DodgeForward`/`DodgeRight`/`Roll`.

## Camera input
- `ReplicateCameraRotation`: `InputPitch = (aLookUp + aLookDown) · SwivelPitchDir`, `InputYaw = aTurnLeft + aTurnRight`,
  replicated as bytes (`FloatToRangeByteSigned`: v<0 → max(v·128, −128), else min(v·127, 127); byte =
  round(q + 128); back: (b − 128)/128 below 128, else /127).
- `SwivelPitchDir = bInvertSwivelPitch ? −1 : 1` (`HandleCameraSave`); profile default `bInvertSwivelPitch = True`.
- Swivel (`Camera_TA.UpdateSwivel` / `GetDesiredSwivel`) and rear view (`ApplyRearCameraView`): `notes/camera.md`.
- Ball cam and rear camera buttons toggle or hold: `bToggleSecondaryCamera` (default True), `bToggleRearCamera` (False).

## Profile defaults and menu limits
| Setting | Default | Menu range |
|---|---|---|
| Controller deadzone (`ControllerDeadzone`) | 0.2 | 0–0.75, step 0.01 |
| Dodge deadzone (`DodgeInputThreshold`) | 0.8 (PRI / dodge component default 0.5, used for bots) | 0.1–1 |
| Steering sensitivity | 1.0 | 1–10 |
| Aerial sensitivity (`AirControlSensitivity`) | 1.0 | 1–10 |
| Mouse sensitivity / `MouseYDeadZone` | 10 / 0.4 | 1–100 / 0–1 |
| Trigger deadzone | 0.1 (fixed, `GamepadDeadzones`) | – |

Sources: `Default__ProfileGamepadSave_TA`, `Default__ProfilePCSave_TA`, `Default__ProfileCameraSave_TA`,
`Default__GFxData_Settings_TA` (`*Limits`).
