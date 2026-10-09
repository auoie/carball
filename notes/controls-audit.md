# Controls audit: the client's input path vs the game's (static session, 2026-10-08)

Static analysis of the 2026-06-16 build (addresses), with the live 2026-10-06 build checked through its scripts,
packages, the live `DefaultInput.ini` (decrypted Coalesced) and the update diff. Ours: `client/src/input`
(bindings.ts, devices.ts, mapping.ts), `client/src/settings`, the engine's input handling. Sub-agent files (full TAGame
disassemblies of both builds, decompiles) are local in `out/bsim/agents/C1/`. Sent to the live session, which owns
`client/`.

## Hypotheses

| # | What | Game | Ours | Difference / suggestion | Impact |
|---|---|---|---|---|---|
| C-1 | Gamepad camera swivel pitch | XInput reader `FUN_140dc5440`: RightY = −sThumbRY/32768 (positive = stick down, UE3); `SwivelUp = RightY AxisSign_Positive`; `InputPitch = (aLookUp + aLookDown)·SwivelPitchDir`, `SwivelPitchDir = bInvertSwivelPitch ? −1 : 1`, positive = look up; old default invert True → stick up looks up | `bindings.ts:72-73` swivelUp = axis(3, −1) (browser axes[3] also positive when down) + default invert (`settings.ts:93`) → stick up looks down (`mapping.test.ts:104`) | Bind swivelUp = axis(3, +1), swivelDown = axis(3, −1). Live caveat: per-input camera settings (`CameraKBM`/`CameraController.bInvertSwivelPitch`, default False; migrated profiles keep the old value), so a new live profile may be un-inverted | high (visible) |
| C-2 | DodgeForward | `PlayerMove`: DodgeForward = −Pitch (before the air-pitch safety), DodgeRight = Yaw; `FUN_140f30a70` quantises all 7 axes separately → DF = q(−p); read by `HasDodgeInput` (deadzone), `SetDodgeSettings` (direction) and the flip cancel `FUN_140eb72b0` (raw DF: torque × (1 − min(|DF|, 1)) when opposing) | engine uses −q(p) (`Car.cpp:900-901, 930, 941, 810-816`); q scales 127 positive / 128 negative | Stick forward 0.8 with deadzone 0.8: game DF = 102/127 = 0.803 → dodge; engine 102/128 = 0.797 → double jump. Partial cancels differ 0.4–0.8 %. Carry a DodgeForward byte in CarControls/protocol and use it at the three sites | accuracy |
| C-3 | Live default controls ("Modern") | `ControlPreset_X.DefaultPresetName = 'Modern'`; live PC: LShift boost, Space jump (+ `JumpAlternative` on LMB), RMB powerslide/air roll, MMB ball cam, LCtrl rear cam, mouse free look; camera preset Modern (ball cam hold on KBM / toggle on pad, mouse free look on KBM, CameraAccelRate 10.8 KBM / 5.8 pad, Distance 290). Standard/Legacy keep the old layout; pad unchanged | old Standard layout (`bindings.ts:59-70`) | product decision; whether new profiles apply the Modern camera preset is unverified | – |
| C-4 | Several bindings per action | Presets: arrays of `PlayerBinding {Action, Key, AxisSign, PressType, Speed, Remappable…}`; profile per-action overrides (`MergeUserBindings`: user replaces default); menu `SetSingleBinding` allows one key per action per device (second jump = separate action `JumpAlternative`); pad stick axes not remappable; binding a stick axis auto-binds the opposite sign; any change → Custom preset. Runtime: every matching binding fires (one key → many actions); axes summed then clamped; buttons are per-event commands (`ToggleJump true` / `OnRelease ToggleJump false`) → last event wins (inferred, not traced) | `mapping.ts:66`: max of one KBM and one pad input per action, minus opposites; buttons OR; everything remappable | same for default layouts; differs only for contrived overlaps | low |
| C-5 | Triggers as buttons | Standard/Modern pad: air roll = LT digital; digital trigger pressed when raw > 30/255 (0.12); trigger axis deadzone `GamepadDeadzones` 0.1 only for 360/PS4/XB1 platform types, else the stick 0.2 | air roll on X (Legacy); `mapping.ts:56, 79-88`: > 0.5 after a 0.1 deadzone | raw > 0.12 for trigger buttons; PC pad platform type unknown (test: RT 0.15 → throttle 0.0556 or 0) | medium |
| C-6 | Taps shorter than a frame | `ToggleJump` latches `bJumped`; `FUN_140f1c190` passes `bJump ‖ bJumped` and clears the latch after one tick → a jump tap = 1 tick; boost/powerslide/air-roll taps inside one frame are lost | `devices.ts:58-63` holds a tapped key for all ticks of the frame | extra jump-force ticks at low fps; sub-frame taps become input | low |
| C-7 | Options | KeyboardAxisBlendTime 0–0.25 s (default 0): linear ramp from the press; mouse steer / air control / free look | not ported | – | low |
| C-8 | Live ball-cam hold | `ReleaseSecondaryCamera` ignores the release while blending in; ball cam auto-exits on free look only with toggle + unconstrained rotation | released at once (`freeplay.ts:138`) | camera only | low |

## Confirmed same
Per-axis (not radial) stick deadzone `sign·max(0, |v| − dz)/(1 − dz)` after the AxisSign filter, profile
`ControllerDeadzone` 0.2 (the ini's 0.3 is overwritten); opposite keys cancel; keyboard keys full value at once
(blend 0); air roll maps yaw → roll and zeroes yaw, DodgeRight = Yaw, Roll enters the dodge; air-pitch safety order;
sensitivity `FUN_140396ca0` (≥ 10 → sign, else clamp(input × sens)) only on steer and air pitch/yaw/roll; dodge
deadzone `PRI.DodgeInputThreshold` 0.8 (bots 0.5) on raw inputs; byte quantisation round-half-up, q/127 or q/128
(= `protocol.ts:74`, `Quantize::InputAxis`); input sampled once per render frame and applied to each physics tick of
that frame. `FUN_140e386b0`, `FUN_140f1c190`, `FUN_140f30a70` unchanged in the update apart from layout.

## Game input defaults
| Item | Default | Source |
|---|---|---|
| Controller deadzone | 0.2 (menu 0–0.75) | `Default__ProfileGamepadSave_TA` |
| Free-look deadzone (live) | 0.1 | `ControllerFreeLookDeadzone`, `GamepadFreeLookDeadzone` |
| Trigger axis deadzone | 0.1 (360/PS4/XB1) | `GamepadDeadzones` |
| Digital trigger | raw > 30/255 | `FUN_140dc5440` |
| Dodge deadzone | 0.8 (bots 0.5; menu 0.1–1) | ProfileGamepadSave, `CarComponent_Dodge_TA` |
| Steering / aerial sensitivity | 1.0 / 1.0 (menu 1–10) | ProfileGamepadSave |
| Keyboard axis blend | 0 (0–0.25 s) | ProfilePCSave |
| Mouse sensitivity / MouseYDeadZone | 10 / 0.4 | `Default__ProfilePCSave_TA` |
| Invert swivel pitch | old True; live per input False (migrated profiles keep theirs) | ProfileCameraSave |
| Pad | RT throttle, LT reverse, LS steer/yaw, LS Y pitch (up = nose down), RS swivel; A jump, B boost, X powerslide, Y ball cam, LT digital air roll (Legacy: X), R3 rear cam | `ControlPreset_X` |
| PC old / Standard | W/S, A/D, Q/E roll, LMB boost, RMB jump, LShift powerslide + air roll, Space ball cam, MMB rear cam | old ini |
| PC live (Modern) | LShift boost, Space jump (+ LMB), RMB powerslide + air roll, MMB ball cam, LCtrl rear cam, mouse free look | live ini, `Default__ControlPreset_X` |
| Demo spawn select (live) | PC A / D; pad LeftX −/+; SteamInput LB / RB; axis `aDemoSpawnSelect`, once when \|v\| crosses 0.3 | `ControlPreset_X`, `PlayerInput_TA.PlayerInput` |

## Open
Whether `PlayerMove` runs before or after the frame's physics steps (0 vs 1 frame of input latency); the platform
type a PC XInput pad reports (C-5); whether new live profiles apply the Modern camera preset and their invert setting;
last-event-wins buttons and summed axes (inferred); live per-device ownership of free-look axes.

## Live build (2026-10-06) addresses

Checked 2026-10-08. Each function cited here was mapped through BinDiff (out/bsim/bindiff/function_map.tsv) and
semantic-diffed old vs live (out/bsim/scripts/semantic_diff.py; offsets, addresses and stack frames ignored);
key ones were re-decompiled in the live project out/bsim/rl-20261006.

Same apart from layout (old → live): `140396ca0` → `14039d410` · `140eb72b0` → `140ebb700`.

Changed:
- `140dc5440` → `140dc4ac0`: data decoded as code (not compared); live 0x140dc4ac0 re-decompiled for notes/client-loop-timing.md
- `140e386b0` → `140e39bc0`: per-device axis ownership added (notes/camera-respawn-goal.md CAM-16)
- `140f1c190` → `140f215f0`: copies one more dword (the new input field); jump latch unchanged (mask 0xffffffeb, re-decompiled)
- `140f30a70` → `140f36790`: one more field; quantisation unchanged (×128 / ×127, round half up; re-decompiled)
