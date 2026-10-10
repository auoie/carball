# Controller rumble: spec (static session, 2026-10-10)

> **Reference only (user decision, 2026-10-10):** the clone will not implement controller rumble. The trigger rules here
> (impacts, landings, jumps, explosions) still describe the events behind the camera shakes and impact sounds.

Requested by the user (relayed by tmp-6f). Drafted by sub-agent RMB1; the sampler's no-break loop (0x140e144b0) and
the low-16 wrap (0x140dbe092–0x140dbe0db) were re-checked in the asm by the static session.

Live build 2026-10-06. Tags: [A] package data, [S] script, [N] native (live addresses, decompiled on the copy
out/bsim/agents/RMB1/rl-live), [I] inferred.

Script cites:
- TA:n = out/bsim/work/tagame_live_all.txt.
- PX:n / EN:n = out/bsim/agents/SHK1/work/projectx_all.txt / engine_all.txt (the dumps live in SHK1/work, not work/).

Local evidence (git-ignored): out/bsim/agents/RMB1/work/ (scan outputs, rumble_ref.py, which produces the test vectors),
d1..d14/ (decompiles, asm, Ghidra logs).

## Summary

**Hardware path**
- **RMB-1. One rumble system.**
  - All rumble comes from the force-feedback half of RL's **ShakeComponent_X**, the same components as the camera shakes.
  - UE3's waveform player (ClientPlayForceFeedbackWaveform → ForceFeedbackManager.FFWaveform) produces **no motor
    output** on PC. RL's XnaForceFeedbackManager::ApplyForceFeedback ignores FFWaveform and only sends the shake
    accumulators. TAGame doesn't call that player anyway. [N 0x140dbe060, 0x1406f1cf0; S]
- **RMB-2. XInput, two motors.**
  - Output goes through XInputSetState (delay-loaded XINPUT1_3 ordinal 3; IAT 0x14235ecb8, thunk 0x14118d970).
  - Left = low-frequency (strong) motor, right = high-frequency (weak) motor.
  - **No trigger rumble on PC.** WaveformSample has Left/RightTrigger amplitude and function bytes (+2, +3, +6, +7),
    but the sampler reads only +0/+1/+4/+5. [N 0x140e144b0, 0x140dbe060]
- **RMB-3. Amplitude scale.**
  - Per-sample motor value = trunc(f(t/D) · Amp · 655), so 0–100 maps to 0–65500. [N 0x140e29240]
  - Then × the component's ForceFeedbackScale, × the receiver scale (distance × component fade), summed into
    FFM.ShakeLeft/ShakeRight (int). [N 0x140e144b0, 0x140e14670]

**Waveform behaviour**
- **RMB-4. Sampler quirk (exe behaviour).**
  - The per-sample loop has no `break`. Every sample whose Duration exceeds the running local time overwrites the
    output, and the running time is reduced only by samples it has passed. [N asm 0x140e14550–0x140e14628]
  - Multi-sample waveforms therefore play differently from their authoring:
    - **Explosion_Large** gives three decays: 100→0 over 0–0.25 s, 66.7→0 over 0.25–0.75 s, 100→0 over 0.75–1.0 s.
    - **Explosion_Medium** gives 100→0 over 0–0.15 s, 30→0 over 0.15–0.25 s, 100→0 over 0.25–0.40 s.
    - **FlipReset** is a constant L60/R30 for 0.15 s.
    - **JoinGameCountdown** is 100→0 over 0–0.5 s, 100 over 0.5–1.0 s, 100→0 over 1.0–1.5 s.
  - Single-sample waveforms are unaffected.
- **RMB-5. Rumbling events (Soccar).** [A/S/N]
  - jump, double jump, dodge;
  - wheel landing (speed-scaled);
  - body impact with the ball, a car or the world (speed-scaled);
  - boost activation;
  - held boost (only in mode "All");
  - demolition explosion (radius 4096, falloff 1);
  - goal explosion (radius 6000, falloff 2);
  - flip reset;
  - "match found" in the menu.
- **RMB-6. Not rumbling:** supersonic, boost-pad pickup, kickoff countdown, throttle (Throttle_FF lasts 0 s),
  podium/match end (rumble is disabled), every other menu. [A/S]
- **RMB-7. Who feels it.**
  - Landing and impact: the local car only (its top controller must be local). [N 0x140f1b2d0, 0x140f1b580]
  - Jump, dodge, boost and flip reset: Receiver Local, which is your car or the car your camera's ViewTarget is
    (spectating). [N 0x140e21ac0]
  - Goal and demolition: Receiver All, scaled by the distance from your car to the explosion.

**Mixing and output**
- **RMB-8. Mixing.**
  - All components sum (plain int add, no priority, no cap).
  - Each frame: motor = low16(trunc(sum × ForceFeedbackScale_user × 0.6)). The "clamp" is
    `CMP CX,0xFFFF; CMOVC`, so values ≥ 65536 **wrap** (only possible with stacked events or intensity > 1.67).
    [N 0x140dbe092–0x140dbe0db]
  - Then ShakeLeft/Right are zeroed.
  - The same component never stacks. Impact and Land restart their single per-car component on every hit (newest
    replaces). Goal and demolition FX and flip resets are separate instances, so they sum.
- **RMB-9. Output rate.**
  - ApplyForceFeedback runs every input poll (per frame, per connected XInput pad).
  - XInputSetState is sent when the value changes or **≥ 0.1 s** since the last send (constructor sets the interval
    0.1 at +0xa0). [N 0x140dbe060, ctor 0x140dc2560, caller 0x140dc4ac0]
  - When paused, 0 is sent. [N 0x14074e6d0]
- **RMB-10. Time base.**
  - Waveforms advance with the component PlayTime, which uses the **dilated** world dt like the camera shakes, so the
    goal rumble stretches in the post-goal slow-mo.
  - No cooldowns anywhere. MinImpactDelay gates only sparks and sound.

**Settings**
- **RMB-11. Settings.**
  - "Controller Vibration" (ForceFeedbackMode): 0 Disabled / 1 Default (enum Impact) / 2 All; **default 1**.
  - "Vibration Intensity" (ForceFeedbackScale): 0–3 step 0.1, **default 1.0**.
  - Effective output factor = ForceFeedbackScale × WaveformScalar 0.6, so the default peak is 39300/65535 ≈ **0.60**.
  - Disabled sets bAllowsForceFeedback = false (all zeros).
  - Default vs All differs only by the held-boost loop. [A/S]

**Browser**
- **RMB-12. Browser mapping.**
  - Linear: magnitude = motor/65535; strong = left, weak = right.
  - Re-issue `dual-rumble` on change or every 100 ms with a 250 ms duration; `reset()` at zero.
  - Table-driven design below.

## 1. Event table

All values are at the default settings. "Peak" is the motor magnitude (0–1) at full event scale, after × 0.6.

| Event | Trigger rule | Waveform (L / R) | Effective envelope | Scale | Who | Restart / combine | Peak |
|---|---|---|---|---|---|---|---|
| **Jump** | FX event Jump on Car_FXActor (ShakeComponent_X_0) [A] | Jump_FF: 15/15 LinDec 0.15 s | 9825→0 over 0.15 s | 1 | Receiver Local (own or spectated car) | Own component per car. PlayShake is a no-op while playing (≤ 0.35 s) [S PX:19487]. Sums with other components | 0.09 |
| **Double jump** | FX event DoubleJump (ShakeComponent_X_180) | Jump_FF | same | 1 | Local | separate component from Jump, so the two can overlap | 0.09 |
| **Dodge** | FX event Dodge (ShakeComponent_X_181) | Dodge_FF: 15/15 LinDec 0.15 s | same | 1 | Local | own component | 0.09 |
| **Wheel landing** (ground, wall, ceiling, ball) | Per wheel: contact rising edge with v = \|v_wheel(prev) · n\| **> 50** uu/s (MinImpactMomentum, strict) and landCurve(v) > 0 [N 0x140f66850 → 0x140f1b580] | Land_FF: 50/50 LinDec 0.10 s | 32750·s → 0 over 0.1 s | FFScale = landCurve(v) | local-controlled car only | **restart** (StopShake(0) + PlayShake) per wheel; the last wheel processed wins | 0.30·s |
| **Body impact** (ball, car, world) | Every queued rigid-body collision of the car (HandleCollision 0x140f03160), **before** the 0.15 s effects gate; v = \|(v_a − v_b) · n\| uu/s [N] | Impact_Medum_FF: 100/100 Sin90to180 0.15 s | 65500·cos(π/2·t/0.15)·s | FFScale = impactCurve(v) | local-controlled car only | **restart** per hit (newest replaces, even if weaker); no cooldown | 0.60·s |
| **Boost activation** | Boost FX actor enters state Active (attachment "BoostActivationSHake", ShakeComponent_X_1) [A] | BoostActivated_FF: 70/70 Sin0to180 0.15 s | 45850·sin(π·t/0.15) (peak at 0.075 s) | 1 | Local | modes Default **and** All. Released within 0.15 s: likely cut (Detached → StopShake(0)) [I] | 0.42 |
| **Boost held** | While CarComponent_Boost_TA is Active **and mode == All (2)**: car FX state BoostShake pushed [S TA:22284–22297], attachment "BoostShake" (ShakeComponent_X_0) | BoostBase.FX.ForceFeedback: 10/10 Constant 3.0 s, **bIsLooping** | constant 6550 | 1 | Local | stops immediately on release (state popped → Detached → StopShake(0) [S PX:19483]) | 0.06 |
| **Demolition** | Demolish_FXActor spawned at the demolished car (@Spawned) [A] | Explosion_Medium_FF: 75/75 LinDec 0.25 s, 100/100 LinDec 0.15 s | 100→0 (0–0.15 s), 30→0 (0.15–0.25 s), 100→0 (0.25–0.40 s) | radial: Inner 0, Outer 4096, Falloff 1, **re-measured every tick** | **Receiver All**: every local player in range (victim, attacker, bystanders) | new FX actor per demo, so demos sum | 0.60·s_r |
| **Goal** (default explosion) | Ball explosion FX actor spawned at the ball (BallExplosion_Base / Explosion_Parent_FXActor ShakeComponent_X_0) [A] | Explosion_Large_FF: 100/100 LinDec 0.75 s, 100/100 LinDec 0.25 s | 100→0 (0–0.25 s), 66.7→0 (0.25–0.75 s), 100→0 (0.75–1.0 s) | radial: Inner 0, Outer 6000, **Falloff 2**, bAttenuate False (**measured once**, first tick) | **Receiver All**, both teams alike | per explosion | 0.60·s_r |
| **Flip reset** | Car_TA.EventPerformedFlipReset → FXActor_FlipReset_TA.HandleFlipReset. Requires FlipResetFxPref ≠ Off (default Enabled) and Car.IsLocallyControlled. A **new instance** of FlipResetShake is attached to the PC [S TA:100408–100443] | FlipReset_FF: 30/60 Const 0.075 s, 60/30 Const 0.075 s | **constant L 39300 / R 19650 for 0.15 s** (quirk) | 1 | Local (PC-owned) | new instance per reset, so resets sum | L 0.36 / R 0.18 |
| **Match found** (menu) | OnlineGameJoinGame_X.JoinCountdown.BeginState: JoinGameShake (GameFoundFF) on every local PC [S PX:10741–10750] | JoinGameCountdown_FF: 100/100 Const 1.0 s, 100/100 LinDec 0.5 s (triggers 100/100, ignored on PC) | 100→0 (0–0.5 s), 100 (0.5–1.0 s), 100→0 (1.0–1.5 s) | 1 | all local PCs | once | 0.60 |
| Podium / match end | Car_TA.EnablePodiumMode with GameEvent.IsFinished: FFM.bAllowsForceFeedback = false [S TA:20838–20846] | — | all output 0 | — | — | until UpdateForceFeedback runs again (profile event or new PC) [I] | 0 |

**Confirmed silent** [A/S]:
- **Supersonic:** no ShakeComponent with FF; the Buff_Supersonic "Car_FXActor_Proto" in Startup is just a copy of the
  jump/dodge components.
- **Boost pad pickup:** BoostOrb_Used shake has no FF.
- **Kickoff countdown:** no FF object, no attach.
- **Throttle:** Throttle_FF has Duration 0, so FFSamplesTime 0 and the FF branch is skipped. [N 0x140e14670]
- **Camera-preset shake setting:** doesn't affect rumble.
- **Menus:** silent apart from "match found".
- **Car preview (garage):** boost FF is stripped (TA:22866ff).

**Out of scope** [A]:
- Rumble/Items modes: SpecialPickupShake = Dodge_FF; BoostOverride adds the held-boost loop to the target car in mode
  All (TA:91951).
- Product goal explosions add extra components: 74 product components use Explosion_Medium_FF or Large_FF, radius
  6000 (some 10000, some no radius), some with ForceFeedbackScale 0.5.
- The custom-training goal explosion BallExplosion_BaseTUT is Receiver Local with Outer 1, so probably silent [I].

## 2. Waveforms

UE3 WaveformSample in RL (12 bytes):
- LeftAmplitude +0, RightAmplitude +1;
- LeftTriggerAmplitude +2, RightTriggerAmplitude +3;
- LeftFunction +4, RightFunction +5;
- LeftTriggerFunction +6, RightTriggerFunction +7;
- Duration +8.

ForceFeedbackWaveform: bIsLooping (+0x60 bit 0), Samples (+0x68/+0x70), MaxWaveformDistance /
WaveformFalloffStartDistance (unused by this path). [A Engine.upk; N]

The data is identical in every copy: TAGame/Startup/Stadium_P, all 232 explosion packages, and all 276 boost packages
that parse. [A]

**Content-key boosts:** 68 boost packages use a per-package content key, not the public key.
- **42** have keys baked into the exe. Decrypted with them (out/bsim/agents/keys/keys.py, 2026-10-10), all 42 carry the
  same BoostActivated_FF (70/70 Sin0to180 0.15) and the looping held-boost ForceFeedback (10/10 Constant 3.0). Their
  two ShakeComponent_X override only Receiver = Local. [A]
- **26** have keys that only the server delivers online. They are out of reach under the offline rule and are not
  checked.

Item boosts aren't in scope for the clone anyway; the default boost's waveforms are above.

| Waveform | Samples (L amp / R amp, function, duration) | Loop | Total |
|---|---|---|---|
| Jump_FF | 15/15 WF_LinearDecreasing 0.15 | no | 0.15 |
| Dodge_FF | 15/15 LinearDecreasing 0.15 | no | 0.15 |
| Land_FF | 50/50 LinearDecreasing 0.10 | no | 0.10 |
| Impact_Medum_FF | 100/100 WF_Sin90to180 0.15 | no | 0.15 |
| BoostActivated_FF | 70/70 WF_Sin0to180 0.15 | no | 0.15 |
| BoostBase.FX.ForceFeedback (held) | 10/10 WF_Constant 3.0 | **yes** | ∞ |
| Explosion_Medium_FF | 75/75 LinDec 0.25; 100/100 LinDec 0.15 | no | 0.40 |
| Explosion_Large_FF | 100/100 LinDec 0.75; 100/100 LinDec 0.25 | no | 1.00 |
| FlipReset_FF | 30/60 Constant 0.075; 60/30 Constant 0.075 | no | 0.15 |
| JoinGameCountdown_FF | 100/100 Const 1.0; 100/100 LinDec 0.5 (trigger 100/100 Const, then LinDec) | no | 1.50 |
| Throttle_FF | 0/0 LinDec 0.0 | no | 0 (inert) |

**Amplitude functions** [N 0x140e29240] (x = t/D, a = amplitude 0–100; float32; result & 0xFFFF):

| Function | Value |
|---|---|
| Constant | a·655 |
| LinearIncreasing | trunc(x·a·655) |
| LinearDecreasing | trunc((1−x)·a·655) |
| Sin0to90 | trunc(sin(x·π/2)·a·655) |
| Sin90to180 | trunc(sin(x·π/2 + π/2)·a·655) = trunc(cos(x·π/2)·a·655) |
| Sin0to180 | trunc(sin(x·π)·a·655) |
| Noise | trunc(rand()/32767·a·655) (unused) |
| Function > 6 | 0 |

**Sampler** [N 0x140e144b0, ShakeComponent_X vtable slot 97; asm verified]:

```
T = FFSamplesTime (sum of durations)
if !loop: if t >= T: return (0, 0)
else: while t >= T: t -= T; t = max(t, 0)
L = R = 0
for s in samples:                         # NO break
    if s.Duration <= t: t -= s.Duration
    else: L = trunc(amp(s.LF, s.LA, t, s.D) * FFScale); R = trunc(amp(s.RF, s.RA, t, s.D) * FFScale)
balance (ForceFeedbackBalance, 0 everywhere): b > 0: L *= 1 - min(b, 1); b < 0: R *= 1 - min(-b, 1)
```

**Test vectors** (FFScale 1, raw motor units before × 0.6; from work/rumble_ref.py):

| Waveform | t = 0 | 0.05 | 0.1 | 0.15 | 0.2 | 0.25 | 0.3 | 0.5 | 0.75 | 0.9 | 1.0 | 1.2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Impact | 65500 | 56724 | 32750 | 0 | | | | | | | | |
| BoostActivated | 0 | 39707 | 39707 | 0 | | | | | | | | |
| Explosion_Medium | 65500 | 43666 | 21833 | 19649 | 9824 | 65500 | 43666 | | | | | |
| Explosion_Large | 65500 | 52400 | 39300 | 26199 | 13099 | 43666 | 39300 | 21833 | 65500 | 26200 | 0 | |
| FlipReset (L/R) | 39300/19650 | 39300/19650 | 39300/19650 | 0 | | | | | | | | |
| JoinGameCountdown | 65500 | 58950 | 52400 | 45850 | 39300 | 32750 | 26199 | 65500 | 65500 | 65500 | 65500 | 39299 |

## 3. Scaling

**Component ForceFeedbackScale** (+0x158):
- Default 1.0.
- Impacts and landings overwrite it with the speed curve before each restart. [N 0x140f1b2d0, 0x140f1b580]
- Curves (UE3 InterpCurve; clamped to the end values outside the range):
  - **impactCurve(v)** (Car_Default.ImpactEffectsComponent, all CIM_Linear):
    - (0, 0), (200, 0), (201, 0.1), (4000, 1);
    - so 0 for v ≤ 200; 0.1·(v − 200) on 200–201; 0.1 + 0.9·(v − 201)/3799 on 201–4000; 1 above.
    - v = \|Δv · n\|: the relative velocity of the two bodies along the contact normal, uu/s [N 0x140f03160].
  - **landCurve(v)** (Car_FXActor.ShakeScaleCurve):
    - (0, 0) Linear, then (199, 0), (200, 0.1), (2200, 1), all CIM_CurveAuto with **stored tangents 0**, so each
      segment is a smoothstep h(u) = 3u² − 2u³;
    - so 0 for v ≤ 199; 0.1·h(v − 199) on 199–200; 0.1 + 0.9·h((v − 200)/2000) on 200–2200; 1 above.
    - The trigger also needs v > 50.

**Receiver scale** s = radial × component fade [N 0x140e653b0, 0x140e5f490]:
- radial = 1 if Outer = 0. Otherwise d = \|P − FXActor.Location\|, with P = the local player's **pawn (car)** location
  (the view point if no pawn [I]):
  - s = 0 if d ≥ Outer;
  - otherwise s = (1 − clamp((d − Inner)/(Outer − Inner), 0, 1))^Falloff.
- **Goal:** (1 − d/6000)², computed once at the first tick.
- **Demolition:** 1 − d/4096, recomputed every tick.
- **Fade:** BlendInTime 0, so 1. The 0.2 s blend-out happens after the waveform has ended, so it has no effect
  (looping boost stops via Detach with StopShake(0)).

**Accumulation** [N 0x140e14670]: FFM.ShakeLeft = trunc(L·s + ShakeLeft), and likewise for Right.
- Gated on: FFWaveform with Samples.Num > 0, FFSamplesTime > 0, FFDuration ≠ 0 (−1 when looping), and
  PC.ForceFeedbackManager ≠ None.
- **Not** gated on: the camera-shake setting, PlayerInput.bUsingGamepad, or team.

## 4. Timing and mixing

**Component clock** [N 0x140e5f490, 0x140e383f0]:
- PlayShake sets PlayTime 0.
- Each component tick does PlayTime += dt (dilated world dt) **before** sampling, so the first sample is at t = dt.
- FFDuration = loop ? −1 : FFSamplesTime. The component auto-stops at max(camera D, FFDuration) and detaches 0.2 s
  later.

**Restart and stacking** [S PX:19478–19510; N]:
- PlayShake is a no-op while playing.
- Impact and Land call StopShake(0) + PlayShake on their single per-car component, so they restart (replace).
- FX-attached components (jump, dodge, boost) play when the FX system attaches them. Whether a repeat event within
  the component's life restarts it is unresolved [I].
- Flip reset, goal and demolition create new instances, so they sum.

**Mix, every frame** [N 0x140dbe060]:
- If the world is not paused:
  - L = (WORD)trunc(ShakeLeft × ScaleAllWaveformsBy), likewise R. This keeps the **low 16 bits**: CMOVC keeps
    0xFFFF only when the low word is exactly 0xFFFF.
  - Then ShakeLeft = ShakeRight = 0.
  - ScaleAllWaveformsBy = ProfileControlsSave.ForceFeedbackScale × WaveformScalar (0.6) (TA:75864–75870, 84193).
- If EnableTime > 0 and EnabledTimeRemaining ≤ 0, the output is 0. EnableTime is 0 here, so this idle cut-off is off;
  gamepad input re-arms it in GameViewportClient input [N 0x140823030, 0x1408238c0].
- If !bAllowsForceFeedback, the output is 0.
- Send XInputSetState(pad, {L, R}) when {L, R} ≠ the last sent value, or ≥ 0.1 s (QPC) since the last send.

**No cooldowns or rate limits** beyond the 0.1 s keepalive. MinImpactMomentum 50 / MinImpactDelay 0.15 gate only
the impact sparks and sound (the shake is called first).

## 5. Settings

ProfileControlsSave_TA class defaults [A TAGame]:
- ForceFeedbackMode = **ForceFeedbackMode_Impact (1)**; ForceFeedbackScale = **1.0**; WaveformScalar = **0.6**.
- Legacy: ForceFeedbackType default Light; LegacyForceFeedbackScales [1] 0.5, [2] 1.0, [3] 1.75, [4] 3.0, [5] 1.0
  ([0] unset = 0).

UI (GFxData_Settings_TA.InitControlsSettings, TA:56459–56460; localization from the decrypted Coalesced_INT):

| Setting | Key | Values | Default | Effect |
|---|---|---|---|---|
| **Controller Vibration** | ForceFeedback | 0 "Disabled" (FFDisabled), 1 "Default" (enum Impact; loc FFImpact "Impact"), 2 "All" (FFAll) | **1 Default** | 0 sets bAllowsForceFeedback = false (TA:75869) and greys out the intensity slider (TA:56652). 2 adds the held-boost loop (TA:22287). Description: "Default only vibrates on impacts, boost activation, and explosions." |
| **Vibration Intensity** | ForceFeedbackScale | slider 0.0–3.0, step 0.1 | **1.0** | output factor = value × 0.6 |

**Notes on the settings:**
- **Jumps, dodges, landings and flip resets have no mode gate** in data or script. Only the boost component reads the
  mode (TA:22287, 91958). So "Default" also rumbles on jumps and dodges (15% amplitude), despite the UI text [S; see
  open item 3].
- **Legacy profile migration** (TA:84201–84203): mode = (Type == Disabled ? 0 : 2), scale = LegacyForceFeedbackScales[Type].
- **Flip Reset Indicator** (GameplaySettingsSave_TA.FlipResetFxPref: Off/AudioOnly/VisualOnly/Enabled, default
  Enabled): flip-reset rumble plays unless Off.
- **Engine.PlayerController.SetRumbleScale** writes ScaleAllWaveformsBy directly; TA doesn't use it.

## 6. Native path (live addresses)

1. ShakeComponent_X::Tick 0x140e5f490 (vtable 0x141e10938):
   - UpdateReceivers 0x140e653b0, filter 0x140e21ac0;
   - per receiver: ApplyShake 0x140e14670 (slot 96).
2. ApplyShake FF branch → GetForceFeedbackValues 0x140e144b0 (slot 97) → amplitude 0x140e29240.
   - Writes into PC.ForceFeedbackManager (PC+0x5e8): ShakeLeft +0x88, ShakeRight +0x8c (RL fields added to
     Engine.ForceFeedbackManager).
3. Input poll: FWindowsViewport input routine 0x140dc4ac0 (virtual; vtable entry 0x141df2fa8), per XInput pad 0–3.
   - After XInputGetState (ordinal 2):
     - not paused: ViewportClient.GetForceFeedbackManager(pad) (vcall +0x70), then vcall +0x278;
     - paused (0x14074e6d0): every GamePlayer's FFM gets vcall +0x278.
4. vcall +0x278 = UXnaForceFeedbackManager::ApplyForceFeedback(pad, dt) 0x140dbe060 (vtable 0x141df3078; constructor
   0x140dc2560 sets +0xa0 = 0.1 (double), +0x78 = 1.0, bAllowsForceFeedback = 1).
   - Fields: +0x98 last send time, +0xa8 last sent XINPUT_VIBRATION.
   - Sends with XInputSetState.
5. ForceClear (+0x280) 0x140dbf2a0 sends 0. UE3's UpdateWaveformData 0x1406f1cf0 (FFWaveform clock) is never part of
   the output.
6. FFM class = WinDrv.XnaForceFeedbackManager (Default__PlayerController.ForceFeedbackManagerClassName [A Engine]).
   - Created in PlayerController.InitInputSystem (EN:9696–9700).
   - Command line -NOFORCEFEEDBACK sets a global (0x140dd7350; consumer not traced).

## 7. Browser design (table-driven)

**Gamepad API facts:**
- `vibrationActuator.playEffect("dual-rumble", {startDelay, duration, strongMagnitude, weakMagnitude})`, magnitudes
  0–1; a new call preempts the running one.
- Chrome on Windows/XInput writes wLeftMotorSpeed = strong·65535 and wRightMotorSpeed = weak·65535 (linear) [I,
  Chromium behaviour, not checked here].
- So **map linearly, no curve.** RL itself applies none, and the motor's own dead band is the same for both.
- Don't use "trigger-rumble": RL on PC never drives trigger motors [N].

**Tables (shippable values):**

```ts
// fn: 0 Const, 1 LinInc, 2 LinDec, 3 Sin0to90, 4 Sin90to180, 5 Sin0to180
type S = { l: number; r: number; lf: number; rf: number; d: number };
type W = { loop: boolean; s: S[] };
export const WAVE: Record<string, W> = {
  jump:      { loop: false, s: [{ l: 15, r: 15, lf: 2, rf: 2, d: 0.15 }] },
  dodge:     { loop: false, s: [{ l: 15, r: 15, lf: 2, rf: 2, d: 0.15 }] },
  land:      { loop: false, s: [{ l: 50, r: 50, lf: 2, rf: 2, d: 0.10 }] },
  impact:    { loop: false, s: [{ l: 100, r: 100, lf: 4, rf: 4, d: 0.15 }] },
  boostOn:   { loop: false, s: [{ l: 70, r: 70, lf: 5, rf: 5, d: 0.15 }] },
  boostHeld: { loop: true,  s: [{ l: 10, r: 10, lf: 0, rf: 0, d: 3.0 }] },
  demo:      { loop: false, s: [{ l: 75, r: 75, lf: 2, rf: 2, d: 0.25 }, { l: 100, r: 100, lf: 2, rf: 2, d: 0.15 }] },
  goal:      { loop: false, s: [{ l: 100, r: 100, lf: 2, rf: 2, d: 0.75 }, { l: 100, r: 100, lf: 2, rf: 2, d: 0.25 }] },
  flipReset: { loop: false, s: [{ l: 30, r: 60, lf: 0, rf: 0, d: 0.075 }, { l: 60, r: 30, lf: 0, rf: 0, d: 0.075 }] },
  gameFound: { loop: false, s: [{ l: 100, r: 100, lf: 0, rf: 0, d: 1.0 }, { l: 100, r: 100, lf: 2, rf: 2, d: 0.5 }] },
};
// event -> source rule
export const EVENTS = {
  jump:       { wave: 'jump',      who: 'viewTarget', slot: 'perCar:jump',   onRepeat: 'ignoreWhilePlaying' },
  doubleJump: { wave: 'jump',      who: 'viewTarget', slot: 'perCar:djump',  onRepeat: 'ignoreWhilePlaying' },
  dodge:      { wave: 'dodge',     who: 'viewTarget', slot: 'perCar:dodge',  onRepeat: 'ignoreWhilePlaying' },
  land:       { wave: 'land',      who: 'localCar',   slot: 'perCar:land',   onRepeat: 'restart', scale: 'landCurve' },
  impact:     { wave: 'impact',    who: 'localCar',   slot: 'perCar:impact', onRepeat: 'restart', scale: 'impactCurve' },
  boostStart: { wave: 'boostOn',   who: 'viewTarget', slot: 'perCar:boostOn', onRepeat: 'restart', stopOnRelease: true },
  boostHeld:  { wave: 'boostHeld', who: 'viewTarget', slot: 'perCar:boostHeld', whileBoosting: true, mode: 'all' },
  demolition: { wave: 'demo',      who: 'all', radial: { inner: 0, outer: 4096, falloff: 1, live: true },  slot: 'new' },
  goal:       { wave: 'goal',      who: 'all', radial: { inner: 0, outer: 6000, falloff: 2, live: false }, slot: 'new' },
  flipReset:  { wave: 'flipReset', who: 'localCar', slot: 'new', unless: 'flipResetIndicator=off' },
} as const;
export const WAVEFORM_SCALAR = 0.6, RESEND_MS = 100, EFFECT_MS = 250;
```

**Per frame** (after the game tick, with the **dilated** dt the camera shakes use):

```ts
for (const src of sources) {
  src.t += dt;
  const [l, r] = sampleWave(WAVE[src.wave], src.t, src.ffScale); // exe sampler incl. no-break loop (section 2)
  const s = src.radial ? radial(src) : 1;
  accL = Math.trunc(l * s + accL);
  accR = Math.trunc(r * s + accR);
  if (!WAVE[src.wave].loop && src.t >= total(src.wave)) remove(src);
}
const k = intensity * WAVEFORM_SCALAR;               // intensity 0..3, default 1
let mL = Math.trunc(accL * k) & 0xffff;              // exe wraps (low 16 bits); see note
let mR = Math.trunc(accR * k) & 0xffff;
if (mode === 'disabled' || paused || podium) mL = mR = 0;
const strong = mL / 65535, weak = mR / 65535;
if (strong !== last.s || weak !== last.w || (strong + weak > 0 && now - lastSend >= RESEND_MS)) {
  if (strong === 0 && weak === 0) pad.vibrationActuator?.reset();
  else pad.vibrationActuator?.playEffect('dual-rumble',
    { startDelay: 0, duration: EFFECT_MS, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  last = { s: strong, w: weak }; lastSend = now;
}
```

**Notes:**
- **Cadence.** RL's rule is "on change, else every 100 ms", evaluated once per frame. EFFECT_MS = 250 (> 2 × 100) avoids
  gaps between re-issues and stops the motor within 250 ms if the page stalls (RL's XInput state would persist; that
  deviation is intended). Also call `reset()` on blur and visibilitychange.
- **Mixing.** One call carries the per-motor sum of all sources, as in RL.
- **Wrap.** The 16-bit wrap is the exe behaviour. It is reachable only with intensity > 1.67 or stacked
  goal + demo + impact. **Keep it** (the fidelity target is the exe). Clamping to 65535 would be a deviation that
  needs the user's OK.
- **Radial.** d is from the local car's position; with no car (demolished, spectator), use the camera position [I].
  Goal: compute once on the explosion's first tick. Demolition: every frame.
- **Who.**
  - 'localCar': only events of the car this client controls.
  - 'viewTarget': the car the camera follows (own car, or the spectated one).
  - 'all': every explosion, scaled by radial.
- **Determinism.** A unit test can compare against the test vectors in section 2, using Math.fround in amp() for
  exact parity; float64 differs by at most 1 unit.
- **Firefox fallback** (no dual-rumble): `hapticActuators[0]?.pulse(max(strong, weak), EFFECT_MS)` [I].

## 8. Confidence

| Item | Confidence | Basis |
|---|---|---|
| Waveform sample values, loops, durations | high | [A] identical across all copies |
| Event to component mapping, receivers, radii | high | [A/S]; FX attach events from Car_FXActor and BoostBase.FXActor |
| Amplitude functions, × 655, FFScale, accumulation | high | [N] decompile and asm |
| Sampler no-break quirk and the resulting envelopes | high | [N] asm 0x140e144b0 read instruction by instruction |
| Mixing (sum), × 0.6 × intensity, low-16 wrap | high | [N] asm 0x140dbe060 |
| 0.1 s resend / on-change send, pause → 0 | high | [N] constructor constant 0x3fb999999999999a |
| Per-frame call cadence (input poll per frame) | medium-high | [N] call site and UE3 structure [I] |
| Settings values and defaults | high | [A/S] + localization |
| Default mode includes jump, dodge, land and flip reset (only held boost needs All) | medium | [S] no other mode read; the UI text says otherwise |
| Impact and landing speed definitions | medium-high | [N] (with SHK1) |
| Boost-activation truncation on early release; FX re-attach within a component's life | low | [I] |
| Demolition victim distance (pawn gone → view point) | low-medium | [I] |
| Chrome linear magnitude mapping | medium | [I] external knowledge |

## 9. Open questions

1. **FX re-attach.** When an FX event or state re-fires while its ShakeComponent is still attached (jump→land→jump
   within 0.35 s, re-boost within 0.35 s): no-op or restart? Also: does releasing boost within 0.15 s cut
   BoostActivated (Detach → StopShake(0))? Desired attach state is computed in 0x140e64a80; the attach/detach tick
   was not traced.
2. **Demolition victim.** Is the victim's pawn still present on the explosion's first tick? This decides whether d is
   from the car or the camera.
3. **Default vs All.** Live check of whether jumps and dodges rumble in "Default" (expected yes). This needs a
   controller on the user's machine (offline game): not done here.
4. **Replays.** Whether rumble plays during goal replays. Receiver Local follows the ViewTarget, so replayed
   jumps/dodges/boost may rumble. Impacts and landings need a local top controller, so they probably don't.
5. **Product items.** Rumble from product goal explosions and custom demolition FX is not specified (74 extra product
   components carry FF).
6. **Latency.** Tick order between the component tick and the input poll: probably one frame of latency.
