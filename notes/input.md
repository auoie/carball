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

## Input bytes (`Vehicle_TA.SetVehicleInput`, native `FUN_140f30a70`)
The vehicle stores every axis as a byte and the physics reads it back: q = round(v × 127) for v ≥ 0 and round(v × 128)
below (halves up), value q / 127 or q / 128. Applies to the server and the locally controlled car. Our engine does it
every tick (patch 29); the network protocol sends q. Details in `notes/physics-values.md`.

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

## Mouse wheel (WHEEL1, static session 2026-10-24; RV-1137)

- **Path:** in play, Raw Input on its own thread (`RLRawMouseInput`, FUN_140dc6f50) rings each RI_MOUSE_WHEEL event;
  `UWindowsClient::ProcessInput` (FUN_140dc6220) replays each as a WM_MOUSEWHEEL (`wParam = usButtonData << 16`); in the
  menus the legacy WM_MOUSEWHEEL (WndProc FUN_140dc8410). Both end in FUN_140dc3040 case 0x20a. Drained before
  `UWorld::Tick`, in order (FUN_140dc8550).
- **One message, one press then one release** of `MouseScrollUp` or `MouseScrollDown` (InputKey 0x140dc47ce, then
  0x140dc4802): no accumulation, remainder, time window, rate limit or debounce. Several notches in a frame are several
  press/release pairs.
- **Sign:** `q = (short)HIWORD(wParam) / 120`, truncated; MouseScrollDown only if q < 0, else MouseScrollUp, so a message
  under one notch (a high-resolution wheel's 15 or 30 pieces) is MouseScrollUp whichever way it turned (a game bug).
- **No horizontal wheel** (RI_MOUSE_HWHEEL unread, WM_MOUSEHWHEEL to DefWindowProc), no modifiers, no wheel axis.
- **What a bound action sees:** an axis 1.0 for that frame; the jump one tick (its latch, LT-4) however many notches;
  boost, powerslide and air roll nothing (released by the frame's end, LT-5); a toggled ball cam or rear camera flips on
  each press (N taps, N flips), held mode nothing; a plain command once per tap; DoubleTap on two notches within 0.25 s.
- **Carball** (`client/src/input/devices.ts` WheelTaps): one browser `wheel` event is one message; at least a notch (32
  px, or any lines or pages) taps in its direction, an event the browser merged several notches into that many taps
  (against a fixed notch, Chromium's Windows 100 px or 3 lines, so every ordinary notch is one tap: a stand-in for
  separate messages, not a sum; RV-1145, RV-1148); Shift's sideways turn (Chromium's Shift+wheel) the same turn,
  sideways without Shift none. The cameras and free play's and training's commands count each press
  (`ActionButton`: a toggle flips, a command runs, once a press, RV-1146: `ActivateFreeplayCommand`, TAGame dump 77100
  and 29833, no cooldown); a held camera is one flag, the last press or release of any of its inputs winning
  (`ReleaseSecondaryCamera`, 76995: one `bHoldingBallCamKey`, RV-1144). **Smaller
  than a notch: one tap in its own direction**, a deliberate difference from the exe (the user's choice, 2026-10-24: the
  game's truncated delta / 120 sign test makes every such piece MouseScrollUp, which isn't copied).
- **A button held through a menu (RV-1149, WHEEL1):** the game flushes at the first menu's open
  (`SetReceiveInput`/`SetCaptureAllInput` true, ProjectX dump 7245, 7261 → `PlayerInput.ResetInput` → `FlushPressedKeys`
  0x1409cd290: a release per held key, its OnRelease commands run, the axes zeroed) and nothing at the close; the pad poll
  and the keys' states keep their own, so no new press, but the first repeat after the flush is taken as a press
  (`PlayerInput_X::InputKey` 0x140e3a2b0): a pad button still held is pressed again within its repeat interval (~0.1 s,
  the delays config only, inferred) of the close, a key only while Windows still repeats it (the last pressed: not one
  held under the Escape that opened the menu). Carball: empty input under a menu (everything released), a pad button
  still held pressed on the close's frame (the game's re-press, up to ~0.1 s early), a key not until pressed again
  (repeats ignored). Left as it is.
- **Labels:** the HUD's prompts (the ball cam's hint, the respawn's, the replay's skip, quick chat) build their key
  names each frame they're shown, so a layout switched mid-play shows at their next frame; the open Controls screen
  redraws on the layout change itself (RV-1132, RV-1143).
- **Not matchable in a browser:** the delta per Windows message (a wheel sending 2 × 60 a notch shows 50 px pieces, taken
  as notches, while the game gives Up); Chromium's coalescing (counted from size); a trackpad, which the browser can't
  tell from a precision wheel; a Shift-tilt wheel (vertical here, ignored by the game).

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
