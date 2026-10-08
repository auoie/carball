# Camera: old build (2026-06-16) vs live (2026-10-06), and the client (static session, 2026-10-08)

Every TAGame/ProjectX/Engine/Core script function diffed between the builds (offsets normalised), camera archetypes and
defaults dumped, `FInterpEaseIn` read in Ghidra. Sub-agent files local in `out/bsim/agents/K1/` (full per-function diff
`work/cam_diff_ubc.txt`). The client's camera (`client/src/camera/rlCamera.ts`, `notes/camera.md`) was ported from the
old build. Lead-session checks: `Default__CameraState_X.DefaultBlendParams` (EaseIn, exponent 2, both builds) and the
live `Default__ProfileCameraSave_TA` (preset Modern, per-input invert False).

## Findings (ranked by visible impact)

| # | What | Game | Client | Note |
|---|---|---|---|---|
| CAM-1 | **Free Look Camera** (new) | per-input profile mode `bUnconstrainRotation`: `CameraState_Car_TA.UpdateValidPOV` runs the normal car-cam update but restores the previous rotation (view direction changes only by input), skips roll/chassis modifiers, applies the free-look offset; focus/distance use the car-facing frame (`GetCarFacingRotation`); swivel off (`bCanSwivel &&= !bUnconstrainRotation`) | not implemented (`rlCamera.ts:157-181` always follows, `:527-536` always swivels) | matches only with free look off (migrated profiles); spec below |
| CAM-2 | Transition blend curve (port error, both builds) | archetypes override only BlendTime 0.5; base `DefaultBlendParams` = EaseIn, exponent 2 → offset weight ((remaining)/BlendTime)² (`FInterpEaseIn` `FUN_140378b90`) | linear (`rlCamera.ts:423`) | every car ↔ ball-cam switch; inference from serialisation deltas (high confidence); live test: toggle ball cam with the car and ball still, log the camera yaw per frame |
| CAM-3 | New-profile defaults | `ProfileCameraSave_TA.OnCreate` → `ApplyCameraPreset(Modern)` (default changed Custom → Modern): FOV 90, Height 100, Pitch −3, **Distance 290**, Stiffness 0.5, Swivel 2.5, Transition 1.0; camera shake off; `RegisterPresetInputOverrides`: ball cam hold on KBM / toggle on pad, free look on for KBM / off for pad, CameraAccelRate 10.8 KBM / 5.8 pad. Migrated profiles keep their camera (the migration turns Modern/hold profiles into Custom; free look off) | Distance 270, toggle, invert True, no shake (`rlCamera.ts:44-52`, `settings.ts:91, 93`) | client = migrated/Default-preset profile |
| CAM-4 | Per-input camera settings | `CameraKBM` / `CameraController` (`ProfileCameraInputSettings`: invert, free look, accel/decel, smoothing, FreeLookSpeed), loaded on input-type change; **`bInvertSwivelPitch` default False** (old single default True; migrated profiles keep theirs) | invert True (`settings.ts:93`) | with C-1's sign, a new live pad profile has stick down = look up; check the user's menu value |
| CAM-5 | Free-look ball cam `CameraState_LookAtBall_TA` (new) | only with free look: same maths/constants as the ball cam, no swivel or free look, roll 0; copies the car cam's interp state on entry; on exit the car cam keeps the ball cam's last rotation | absent | classic release semantics already match (`freeplay.ts:138`, `online.ts:331`) |
| CAM-6 | Respawn cameras | Demolished (focus latched at wreck + Height, Distance 400, FOV 120, rotation held; live adds free look), Prespawn (spawn location + Height, spawn rotation, blend `PrespawnLerpSpeed` 0.5 s EaseIn²), DemoSpawnSelect (selected spot, 0.1 s linear lerp between spots, blend 0.25 s; live adds free look) — existed in the old build too | none: while demolished the camera follows the hidden car (`render/entities.ts:68`); online nothing resets the camera on respawn (only freeplay, `freeplay.ts:206`) | existing gap |
| CAM-7 | Blender snapshot rotation (live) | `CameraStateBlender_X.BlendCameraState`: after the outgoing state's last update, its rotation is reset to the previous frame's | advanced rotation (`rlCamera.ts:408-409`) | restore `snapshot.rotation = pov.rotation` after `#from.update`; one frame of rotation over 0.5 s |
| CAM-8 | Transition offset clearing (live) | `TransitionToState` clears the delta also on the first state | first-state path after `reset()` doesn't (`rlCamera.ts:376`) | tiny |
| CAM-9 | Input plumbing (live) | actions `FreeLookUp/Down/Right/Left` (axes `aFreeLook*`, ×FOV/90; PC mouse, pad right stick); `PlayerInput_X.GamepadFreeLookDeadzone` (new field, profile `ControllerFreeLookDeadzone` 0.1, menu 0–0.75; the old ini's 0.3 was a dead key, so `notes/camera.md:55` is stale); per-device axis ownership in the native InputAxis | none | – |

## Free look (live), spec
- **Active:** `Camera.bUnconstrainRotation` (from `CameraKBM`/`CameraController` by input type), in states with
  `bCanFreeLook` (Car, Demolished, DemoSpawnSelect; not BallCam/LookAtBall/Prespawn), not in rear view. Starts behind the
  car on car-cam begin and on a new car (`ResetToCarView`).
- **Input:** pitch = (aFreeLookUp + aFreeLookDown)·SwivelPitchDir, yaw = aFreeLookLeft + aFreeLookRight. KBM mouse: per
  frame target = Raw·FreeLookSpeed·0.83 rotator units; KBM keys: Raw·FreeLookSpeed·5000·dt. Pad: Raw =
  `ApplyControllerDeadzone(v, 0.1)` (hard cut, no rescale, on the already 0.2-deadzoned and FOV-scaled value); rate =
  Raw·FreeLookSpeed·10000 u/s (137.3°/s at full stick, speed 2.5). Rate control (swivel is position control).
- **Smoothing** (`bFreeLookSmoothing`, default on): rate = FSmoothInterpTo(rate, target/dt, λ, dt), λ = CameraAccelRate
  while input ≠ 0 (pad 5.8, Modern KBM 10.8; 1–15) else CameraDecelRate 10.8; per-frame offset = int(rate·dt).
- **Apply:** rotation += offset; pitch clamped to ±75° (`MaxFreeLookPitchDegrees`), roll 0, yaw unbounded. In the air
  only `UpdateAirPOV` runs (the car-facing frame freezes at takeoff).
- **Suspended:** rear camera (offset reset; on release free look resumes from behind the car = recenter); ball cam →
  LookAtBall; respawn → `ResetToCarView`. No other auto-recenter.
- **Ball cam exit by free look** (toggle mode): KBM when sqrt(pitch² + yaw²)/dt > `FreeLookExitSpeedFloor` 30 for ≥
  `FreeLookExitDuration` 0.15 s (any frame ≤ 30 resets); pad when either axis passes 0.1; never while blending in or
  forced. Hold mode: a release during the blend-in is ignored; the ball cam lasts at least the full blend (0.5 s).
- **Presets:** [0] Default, [1] Balanced, [2] Wide, [3] Custom, [4] Legacy unchanged (free look off; FreeLookSpeed 5.0 for
  Wide, else 2.5); [5] Modern as CAM-3. Per-input defaults: invert False, free look False, accel 5.8, decel 10.8,
  smoothing on, speed 2.5; menu accel/decel 1–15, speed 1–10.

## Unchanged
Car/ball-cam archetypes, swivel extents, profile camera defaults and limits, `Camera_X` blending code,
`CameraUtils_X.GetBlendPercent`, the smooth-interp functions, the classic car-cam and ball-cam pipelines (all additions
are gated off in classic mode), swivel/rear view/clip-to-field, the FOV/90 look scaling, the XInput reader and byte
quantisation. In classic mode the client matches apart from CAM-2, CAM-7, CAM-8.

## Open
The EaseIn inference (CAM-2; a live recording settles it); the pad swivel sign at the new invert default (C-1/CAM-4);
mouse units for free look (degrees per count, the 30/s exit floor); native per-device axis ownership; the
car → Demolished blend (0.5 or 0.25 s); whether a cloud profile on a new device is created (Modern) or migrated.
