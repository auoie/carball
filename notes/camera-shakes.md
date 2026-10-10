# Camera shakes: spec (static session, 2026-10-09)

Live build (2026-10-06). Requested by the live session for the visual-timing work. Tags: [A] package data (class
defaults read from Engine/ProjectX count as data); [S] script (TA = line in out/bsim/work/tagame_live_all.txt, PX/EN =
ProjectX/Engine bytecode); [N] native (live address); [I] inferred. Sub-agent files, local:
out/bsim/agents/SHK1/notes.txt, decompiles in dec*/.

**Summary.**
- **Engine path:** every gameplay shake goes through RL's own **ShakeComponent_X** (an actor component on an FX actor
  or the car), not UE3's CameraModifier_CameraShake / PlayCameraShake / PlayWorldCameraShake. TAGame never calls
  PlayWorldCameraShake.
- **How RL's oscillator differs from UE3's:**
  - the random phase offset is in **seconds**, not radians;
  - the location offset is added on **world axes**;
  - the rotation offset is added per component to pitch/yaw/roll;
  - a shake with **OscillationDuration 0 moves no camera at all**.
- **Combining:** shakes sum, with no cap.
- **Time base:** they run on the **dilated** world dt, so they slow down in the goal slow-mo.
- **Settings gate:** only the **Default** camera preset shakes; Modern, the new-profile default, doesn't.

## Shakes
- **Units:** rotation in rotator units (65536 = 360°); **frequency in rad/s** (12 rad/s ≈ 1.9 Hz); location in uu;
  time in s.
- **Columns:** D = OscillationDuration, BI/BO = oscillation blend in/out.
- **Offsets:** "rnd" = EOO_OffsetRandom, "zero" = EOO_OffsetZero; "(def)" = the class default (Default__CameraShake:
  D 0, BI 0.1, BO 0.2; FOscillator default offset rnd).
- **Not present:** none of these shakes has a FOV oscillation or an Anim.

| Shake | D / BI / BO | Rotation P / Y / R (amp @ rad/s, offset) | Location X / Y / Z | Component and play rule |
|---|---|---|---|---|
| **Explosion_Large** (goal) | 1.0 / 0.1 (def) / 1.0 | 1000@12 rnd / 2000@12 rnd / 1000@12 rnd | 5@40 rnd / 5@50 rnd / 5@70 rnd | BallExplosion_Base_FXActor.ShakeComponent_X_0, attached @Spawned at the ball. Inner 0, Outer 6000, Falloff 2, **bAttenuate False** (the distance scale is computed once, on the first tick). Receiver **All** (every local player in range). Identical for Explosion_Default and the product parents [A; values re-read] |
| **Explosion_Medium** (demolition) | 0.25 / 0.1 (def) / 0.1 | 500@50 rnd on all three | 5@50 rnd / 5@50 rnd / 5@50 zero | Demolish_FXActor.ShakeComponent_X_0, @Spawned at the demolished car. Inner 0, Outer 4096, Falloff 1, bAttenuate True (re-measured every tick), Receiver All [A] |
| **Impact_Medium** (the car hits the ball, a car, or the world) | 0.15 / 0.05 / 0.05 | 300@900 zero / 150@600 zero / 0 | 10@32 zero / 0 / 0 | Car_Default.ImpactEffectsComponent. AmplitudeScale = curve(\|v_rel·n\|), linear (0, 0), (200, 0), (201, 0.1), (4000, 1) [A].<br>**Local car only:** the car's top PlayerController must be local [N 0x140403c00, 0x1406555d0].<br>Called from HandleCollision 0x140f03160 (via the RB collision dispatch 0x140f5b120) **before** the sparks/sound gate (0x140f1b080), so **no cooldown**: MinImpactMomentum 50 / MinImpactDelay 0.15 gate only the effects.<br>Each hit restarts the one per-car component: StopShake(0), set the scale, PlayShake [N 0x140f1b2d0] |
| **BoostOrb_Used** (any pad pickup by any car) | 0.2 / 0.05 / 0.15 | 128@32 zero / 0 / 0 | 0 | BoostBase_FXActor ShakeComponent_X_152 @PickedUp (both pad sizes). Inner 512, Outer 1024, Falloff 1, bAttenuate True, Receiver All. **AmplitudeScale 0.5, FrequencyScale 0.5**, so effectively pitch 64 @ 16 rad/s [A] |
| **Jump** (jump and double jump) | 0.15 / 0.05 / 0.05 | 0 | 0 / 0 / 5@30 zero | Car_FXActor.ShakeComponent_X_0 (@Jump) and _180 (@DoubleJump). They are separate components, so the two can overlap. Receiver **Local**; no distance falloff [A] |
| **Dodge** | 0.1 / 0.1 (def) / 0.05 | 0 | 5@30 rnd / 0 / 0 | Car_FXActor.ShakeComponent_X_181 (@Dodge), Receiver Local [A] |
| **Land** | **0 (def)** / 0.05 / 0.05 | 400@900 rnd / 200@600 rnd / 400@1200 rnd | 0 / 0 / 20@60 zero | **No camera motion:** with D = 0, InitParams sets the camera duration to 0 [N 0x140e383f0], and ApplyShake skips the camera branch [N 0x140e14670]. Only the rumble Land_FF (0.1 s) plays. Scale curve (0, 0), (199, 0), (200, 0.1), (2200, 1) (CurveAuto, zero tangents); local cars only; restarts per landing (wheel update 0x140f66850 → 0x140e865c0 → 0x140f1b580) |
| Throttle (ThrottleShakeComponent_TA) | 0 (def) / 0.05 / 0.25 | 0 | 0 / 0.25@48 rnd / 0.25@48 rnd | **No camera** (D = 0); Throttle_FF also has duration 0. Scale × Throttle (rise 3/s, fall 1.5/s) [N 0x140ebb4e0, 0x140f51390] |
| Boost / BoostActivation / FlipReset / GameFound | – | – | – | Rumble only (ShakeParams None). **There is no supersonic shake** [A] |

**Receivers** [N 0x140e21ac0]:
- **Local:** the receiver's PlayerController is in the component owner's Owner chain, or its camera's
  ViewTarget.Target is. In practice: your own car, or the car you are spectating.
- **All:** every local player, scaled by distance.

## Engine rules
1. **PlayShake (PX:19487).**
   - Only starts if the component isn't already playing; a second PlayShake while playing does nothing.
   - Sets PlayTime = 0 and calls InitParams [N 0x140e383f0]:
     - per-axis time offset τ_k = rand()/32767 **seconds** for rnd, 0 for zero;
     - D = DurationScale × OscillationDuration;
     - FFDur = the sum of the rumble waveform's sample durations.
2. **Tick(dt)** [N 0x140e5f490].
   - If bAttenuate or on the first tick, rebuild the receivers with their distance scale s_r.
   - PlayTime += dt (and StopTime += dt once stopping).
   - Component fade α = min(PlayTime/BlendIn_c, 1 − StopTime/BlendOut_c). Each ramp counts as 1 when its time is 0 or
     when not stopping. ShakeComponent_X defaults: BlendIn_c 0, BlendOut_c 0.2.
   - Apply to each receiver with t = PlayTime and scale s_r·α.
   - When t ≥ D and t ≥ FFDur: StopShake(0.2), then auto-detach after that fade.
3. **Distance scale** [N 0x140e653b0].
   - Ro = RadiusScale·Outer, Ri = RadiusScale·Inner; d = |P − Owner.Location|.
   - P = the local player's car (Pawn) location, or the view point without a pawn [I].
   - If Ro = 0: s = 1. Else if d ≥ Ro: s = 0. Else s = (1 − clamp((d − Ri)/(Ro − Ri), 0, 1))^Falloff.
4. **Oscillator** [N 0x140e14170].
   - rem = max(0, D − t).
   - wOut = rem/BO when D > 0, BO > 0 and BO > rem, else 1.
   - wIn = min(1, t/BI), or 1 if BI ≤ 0.
   - w = min(wIn, wOut).
   - v_k = Amp_k·A·sin((t + τ_k)·Freq_k·F), with A = AmplitudeScale and F = FrequencyScale; 0 when Amp_k = 0.
   - Location_k = w·v_k; Rotation_k = trunc(w·v_k) as an int.
5. **Accumulate** [N 0x140e14670].
   - Only when D ≠ 0 and the camera is a Camera_X.
   - ShakeLocationOffset += Loc·s; ShakeRotationOffset += trunc(Rot·s); FOV offset += fov·s.
   - **Every active shake sums**, with no cap and no dedupe. Land and Impact restart their single per-car component,
     so the newest hit replaces the old one.
6. **Duration:** D > 0 oscillates for D s; D = 0 gives no camera output (rumble only); D < 0 runs until stopped.
7. **Apply** [N Camera_X::ApplyCameraModifiers 0x140e14050].
   - Engine modifiers first (0x14062b290).
   - Then, if !bDisableCameraShake (Camera + 0x6a8):
     - POV.Location += offset (**world axes**);
     - POV.Rotation += offset (per-component add);
     - FOV += offset.
   - The accumulators are zeroed every frame, even when disabled.
   - **Order in the camera pipeline:** PostProcessCameraState (swivel, rear view; TA:14834) → FinalizeOrientation →
     ApplyCameraModifiers (shake) → ClipToField on Z (TA:14918/14922). So the shake is applied after swivel and rear
     view, and rotates the camera in place.
8. **Settings gate:**
   - bDisableCameraShake = !bEnableCameraShake (TA:75833).
   - ProfileCameraSave_TA.ApplyCameraPreset sets **bEnableCameraShake = (Preset == Default (0))** (TA:107030,
     verified). Presets: 0 Default, 1 Balanced, 2 Wide, 3 Custom (left as is), 4 Legacy, 5 Modern.
   - A new profile applies Modern in OnCreate (TA:103850), so **shake starts off**. The podium forces it off
     (TA:20846). The gate doesn't affect rumble.
9. **Time base:** component ticks use the dilated world dt, clamp(real·TimeDilation·DemoTD, 0.0005, 0.4) (UWorld::Tick
   0x140753ed0 → 0x140756460 → ConditionalTick 0x1405d2110). **Shakes slow down in the post-goal slow-mo.** The swivel,
   by contrast, uses real time.

**Impact and landing triggers** (2026-10-10): see notes/impact-triggers.md (IT-1..5). Impact_Medium restarts per
120 Hz physics step only while v = |Δv·n| > 200 (v ≤ 200 never restarts it); the landing shake has D = 0, so there is no
camera motion.

## For the client
- **Component per source.** One component per source, as above:
  - one per car for Impact, Jump, DoubleJump and Dodge;
  - one per FX actor for the explosions and pickups.
  - Restart-on-hit applies to Impact (and Land, which has no camera output).
- **Per frame:**
  - sum location/rotation offsets over all playing components into one accumulator;
  - add it after swivel/rear view, in world axes;
  - zero it.
- **Ticking:** tick shakes with the world (dilated) dt.
- **Gate:** shake only when the camera preset is Default (our Modern default: off).

## Corrections to other notes
- **notes/visual-timing.md VT-16:** "12 Hz" is 12 rad/s (≈ 1.9 Hz).
- **VT-26 / its open item:** Land_CameraShake's duration 0 means no camera shake (rumble only). The note's open item is
  answered.
- **Impact_Medium:** the "local view [I]" in VT-8 is confirmed: local car only.

## Open
- **FX re-attach:** whether @Jump/@Dodge/@PickedUp fired while the same component is still attached (within
  max(D, FFDur) + 0.2 s) is ignored [I].
- **Lag:** same-frame vs one-frame lag between the shake tick and the camera read.
- **Product explosions:** product goal explosions (Portal, S5, Target, Dragon, …) add their own shakes (not dumped).
