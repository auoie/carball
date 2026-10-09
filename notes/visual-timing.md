# Visual timing: spec (static session, 2026-10-08)

For the web client's effects, with its own art. Live build (2026-10-06); every native was decompiled in the live
project, and the addresses are live. Tags: [S] script, [A] archetype/package value, [N] live native, [I] inferred.
Particle lifetimes "x–y" are uniform ranges. Sub-agent files, local in out/bsim/agents/V1/:
- notes.txt;
- decomp/live1..4;
- work/*_sum.txt (archetype and particle summaries);
- the decrypted packages Boost_Standard, ss_default and Explosion_Default.

**FX framework (applies to every row)** [S/N]:
- **State push/pop.** States are pushed or popped on an FX actor; each attachment has attach-if-any, attach-if-all and
  detach-if-any lists. A push re-evaluates the attachments at once (140e12d80 → 140e64a80).
- **Activation is deferred.** Activate() only sets a pending bit, so it takes effect on the next FX tick. FX ticks run
  once per rendered frame, not per physics tick.
- **Detach behaviour** (FXActor_X.DeactivateFXComponent):
  - particles stop spawning and the existing ones finish their life (unless bKillOnDeactivate);
  - audio fades out over 0.25 s;
  - meshes vanish instantly;
  - camera shakes stop.
- **Lingering after destroy.** After DeactivateAndDestroy the actor lives up to DestroyWaitTime 10 s, so its
  particles can finish.
- **Children.** A child (BindTo) gets its parent's states, except the activation state.
- **Delays.** All attach/detach delays are 0, except the ball's location beam (1.0 s) [A].

## Boost
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| VT-1 | Boost on/off | **On** in CarComponent_Boost.PrePhysicsStep [N 140f20bb0] when the input bit is set and CanActivate passes [N 140ecf9d0]: driving, amount > 0, not restricted, under the air-activate limit.<br>**Off** in the same tick when the amount reaches 0 (no minimum), when restricted, or when the input is released and active time ≥ **MinBoostTime 0.1 s = 12 ticks** [N 140ed02f0].<br>**Drain:** dt·0.333/s from the tick after activation [A].<br>SetActive [N 140f35090] bumps the parity counter ReplicatedActive (odd = active), then state Active sets CarMesh.bBoosting and FXActor.Activate() [S] | engine `boosting` | Visual state = physics `boosting` (incl. the 12-tick minimum and the cut at 0); visuals update on the next rendered frame |
| VT-2 | Flame and trail pieces (Boost_Standard on the Octane body) | **Cone mesh:** on car state Boost (= CarMesh.bBoosting, set per frame in car TickFX [N 140f52b60]); appears and vanishes **instantly** on the Octane; the Fennec's cone attachment has AttachDelay 0.1 s, and the Fennec duplicates trail, idle exhaust and flare onto BoostEmitterLeft/Right [A; added 2026-10-09].<br>**Boost-mesh material time:** 0 → 1 on start and 1 → 2 on end [N 140f52880, 140ecc6a0/140ecc730, 140f5a500]; the standard boost has no curves on it.<br>**Particle trail Boost_Painted_PS:** on @Active; spawns **per distance only** (1 per 32 uu × SpawnRate, at most 128 uu per frame), so a stationary boost leaves no trail. Life 1.0–1.5 s with an alpha fade. **No velocity inherited:** the VelocityInheritParent module is disabled, so puffs spawn at rest with only +Z acceleration (0–30 uu/s²) and VelocityOverLife. Size comes only from the ParticleSize instance parameter (the fixed Size module is disabled; Fennec 20–35) [A; corrected 2026-10-09].<br>**Lens flare and loop sound:** on @Active.<br>**Idle exhaust Drive_PS:** on @Throttling, **detached while boosting**; 10/s, life 0.5–1 s, alpha 0.5 [A/N] | `client/src/render/entities.ts:67` toggles one cone | Instant cone. A distance-spawned ribbon (1 per 32 uu, life 1.0–1.5 s) that lingers after release. Optional flare; idle puffs hidden while boosting |
| VT-3 | Boost held with an empty tank | No flame. On a bHoldingBoost rising edge, for a local car, when CanActivate fails: DryFireSound (UI_BoostFail) once [N 140f52880] | – | Local-only "dry" click on the press edge at 0 boost |
| VT-4 | Remote cars | Follow ReplicatedActive (rep-notify; component net frequency 30/s). Simulated proxies drain boost locally while active. The amount replicates as a byte (1/255), on grant and at the end of boosting [S]. So the remote flame changes one replication later [I] | same flag | Same visuals from the replicated active flag |
| VT-5 | Body glow BoostGlowIntensity | glow += min(1, dt·BoostGlowRate 2.0)·(target − glow). Target = forward speed / Car+0x560 (probably 2300 [I]) on the ground **or** boosting, else 0; pushed to the chassis and boost materials every frame [N 140f52b60, 140ef4c80] | – | Optional speed-driven emissive with 2/s smoothing |

## Supersonic
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| VT-6 | State | Physics: on at ≥ 2200; off after **1 s below 2200**, or below 2100 at once. The FX state mirrors Car.bSupersonic each frame with no extra hysteresis [N 140f52b60]. On entry: SuperSonic state, enter and loop sounds. On exit: SuperSonicEnd, loop stops | `supersonic` flag | Drive visuals from the physics flag |
| VT-7 | Trail | Product trail actors (SS_Default: ribbons 120/s, life **0.1 s**, ≤ 100 per ribbon) exist only on **rear wheels 2 and 3**. Each is active only if [N SetWheelEffectActive 140f36dc0]: that wheel **has ground contact**, the car is supersonic, and the direction rule picks it.<br>**Direction rule:** with f forward and s side speed, if \|s\| ≤ 500 or \|s\| ≤ f, the rear wheels are chosen when f > −50 (front when reversing); otherwise a sideways slide picks wheels by the sign of s [N 140f52b60].<br>**In the air the trail stops**; it fades within about 0.1 s, with no start fade. Rear-wheel dust is suppressed while supersonic | `client/src/render/supersonic.ts:17` 0.35 s life; runs in the air; starts from the body's rear corners; SonicBoom ring (`:143-176`) | Emit from the rear wheel contact points, only with contact and the direction rule; 0.1 s ribbon. Remove the in-air trail and the SonicBoom ring (no game counterpart) |
| VT-8 | Body aura | Supersonic_Team1/2_PS on SuperSonic + team, **owner-only** (bOnlyOwnerSee): spark stream life 0.0625 s, 0.1 s burst at start [A] | – | Optional, owner-only |

## Ball hits
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| VT-9 | Car–ball sparks | Each rigid-body collision builds an impact record [N 140f03160]: momentum = **\|v_rel · n\|**. The effect plays if ≥ MinImpactMomentum (car 50) and ≥ **MinImpactDelay 0.15 s** since the last impact of that kind; world and actor hits have separate cooldowns [N 140f1b080, A].<br>Ball physmat: BallCollisionEffects.Metal_PS, a 0.125 s emitter at 1024/s × lerp(0.25, 1, ImpactVel/6000), life 0.125–0.25 s, plus a 0.2 s flash.<br>Camera shake Impact_Medium 0.15 s, scaled 0 at ≤ 200, 0.1 at 201, 1 at 4000 (local car only, confirmed; notes/camera-shakes.md). Sound: notes/sound-behaviour.md SND-6 | no visual; sound from Δv ≥ 160 with a 0.07 s cooldown (`client/src/audio/detect.ts:30,49`) | Sparks at the contact when \|v_rel·n\| ≥ 50 with a 0.15 s cooldown, intensity ∝ speed/6000; match the sound gate |
| VT-10 | Ball trail colour | RecordCarHit sets HitTeamNum (replicated). The trail takes the team colour normalised to full brightness; white before the first touch [S GetActiveTeamColor, N execUpdateTrailColor 140e76b80] | – | Tint on touch |

## Boost pads (standard arena; team-independent)
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| VT-11 | Values | Small 0.12 boost, **4 s** (28 pads); big full, **10 s** (6) [A] | `entities.ts:190` (4/10) | ✓ |
| VT-12 | Pickup | **All pads:** brightness 1 → 0 over **0.1 s**; non-local pickup sound; **camera shake** BoostOrb_Used (0.2 s, blend 0.05/0.15, ×0.5, full inside 512 uu, none past 1024).<br>**Small:** the pad stays (dark), burst of 1+8+1 particles over 0.1 s (life 0.1–0.25 s).<br>**Big:** the orb vanishes **instantly**, burst of 1+6 (0.1–0.2 s); the base glow mesh stays [A/S] | instant instance swap | Add the 0.1 s dim, the burst and the shake |
| VT-13 | Respawn wait | **Big pads only** have a warm-up actor; small pads have none. With n = 1 − remaining/delay: PanAnimate = 0.5·n; Brightness = 1 + 3·(1 − √(1 − n²)). At remaining ≤ 1.0 s an extra particle starts (2/s, life 1 s). On respawn: burst 1+6 (0.1–0.2 s) and an end sound; the orb returns instantly and brightness goes 0 → 1 over 0.1 s [S VehiclePickup_Boost_TA.PickedUp.Tick, A] | warm-up on both sizes (`entities.ts:217`, `:254-262`) | Remove the warm-up from small pads; add the 0.1 s brighten |
| VT-14 | Network | The server alone decides pickups; a client starts its RespawnDelay timer when the pickup counter replicates (lags by one-way latency; notes/netcode-audit.md N-7). The game **does not predict** pickups [S] | predicts pickups | Design choice; key the visuals to pad state |

## Goal (t0 = goal tick)
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| VT-15 | Ball | At t0, Explode: physics and collision off; ball FX deactivated (the trail ribbon finishes: life 1.0 / 0.5 s). The ball **dissolves**: opacity 1 → 0 at 3/s = **0.333 s**, dt capped at 1/30 per frame [N 140f5c880, verified; A BallFadeOutSpeed −3]. Destroyed at t0 + 3.0 game s [S] | hidden instantly (`game/online.ts:493`, `freeplay.ts:234`) | 0.333 s dissolve |
| VT-16 | Explosion | Spawned at the ball with the goal's orientation, in the **scoring** team's colour [S SetExplosionFXActor].<br>Explosion_Default [A]: flash bursts 0.1 / 0.5 s; 64 spark parents (0.25–0.5 s); 256 outer sparks (0.5–1.0 s); smoke puffs (start 0.1 s, 2–5 s); smoke trails 4–6 s; light trails 0.5–1 s. LifeSpan 5 s. Knockback wave 10000 uu/s to 3000 uu.<br>**Camera shake** Explosion_Large: 1.0 s, blend out 1.0 s, rotation amplitude 1000/2000/1000 at 12 rad/s (≈ 1.9 Hz; full parameters in notes/camera-shakes.md), to 6000 uu with falloff 2.<br>Arena shockwave material parameter = lerp(−0.25, 1, (t − t0)/2.5 s) [N 140f5cda0] | sound only | Particle burst, 1 s shake, 5 s cleanup |
| VT-17 | Slow-mo and replay | ScoreSlomoCurve (0.125, 1) → (0.225, 0.1875) → (0.625, 1) on game time (notes/camera-respawn-goal.md GS-2). While slowed, the ball trail's SpawnRate = clamp(1/dilation, 1, 4) [N 140f52560]. Replay or kickoff at +3.0 game s | `goalSequence.ts:10-17` ✓ | ✓ |
| VT-18 | Goal message | GoalScoredMessage broadcast at t0 (scorer, or team); the banner's duration lives in Flash (unknown); the controller light bar strobes [S] | 2 s text | Keep (duration open) |

## Demolition
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| VT-19 | Explosion and wreck | FinishDemo in post-physics of the demo tick [S]: SetHidden at once; TerminateRBPhys; ClearFX (car, body and boost FX linger ≤ 10 s); explosion at the car.<br>Demolished_New_PS [A]: embers (125, 0.5–1 s); streams 455/s for 0.35–0.5 s (life 1–1.5 s); **husk meshes (engine, chassis, 4 rims) live 3 s**; smoke 1.6–2 s; flash 0.2 s; text sprite after 0.1 s (life 2 s).<br>Camera shake Explosion_Medium 0.25 s within 4096 uu. Actor destroyed at +5 s; respawn at +3 s | car hidden (`entities.ts:68`), no effects | Burst + 3 s debris + 0.25 s shake |
| VT-20 | Respawn | Body SpawnFX: 256 sparks after a **0.1 s delay**, life 0.25–1.0 s, team colour; not on replay actors [S/A] | – | Optional |

## HUD
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| VT-21 | Boost meter | Every frame: 0 if amount ≤ 0, else **clamp(floor(pct·100), 1, 100)** (verified, GFxHUD_TA.GetBoostAmountForUI); Flash is told only when the integer changes; Flash-side smoothing unknown [S] | `Math.round` (`hud.ts:141`) | floor, minimum 1 while > 0 (99.6 → 99, 0.4 → 1) |
| VT-22 | Speedometer | none in the game | uu/s (`hud.ts:144`) | debug only |
| VT-23 | Clock | SecondsRemaining = int(t) + 1, 0 at t ≤ 0; shown M:SS, with "+" in overtime [S Active.UpdateGameTime]. Runs only after the first touch, or 5 s after GO. Overtime shows "+0:00" until the touch, then "+0:01" at once | regulation `ceil` (differs for one tick at whole seconds); overtime `floor` (`matchClock.ts:8`) | int(t) + 1 in both |
| VT-24 | Kickoff countdown | Countdown state t = 0: "3" at **1.0 s**, "2" at 2.0, "1" at 3.0, **"GO" at 4.0 s** (when cars can drive), each with its sound; clients get them as broadcasts (one-way latency late) [S] | beeps only at those times (`online.ts:261-262`) | Show the digits and GO at those times |
| VT-25 | Ball and goal indicators | Ball arrow in Active and Countdown when the profile option is on; the goal indicator is static per team [S] | – | – |

## Other effects
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| VT-26 | Landing | Per-wheel contact edge 0 → 1 with \|v·n\| > 50: wheel impact sound and a landing shake (rumble only: Land_CameraShake has duration 0, so no camera motion, notes/camera-shakes.md; local cars only; scaled 0 at ≤ 199, 0.1 at 200, 1 at 2200) [N 140f66850, 140f1b580] | airborne ≥ 0.12 s, sound only (`detect.ts`) | Optional |
| VT-27 | Wheel dust and powerslide | Same direction rule as VT-7, needs contact. The particle comes from the contact material: field = Grass, so Grass_PS with rate ramping 0 → 1 as SideSpeed goes **80 → 100 uu/s** (only while sliding), life 0.19–0.75 s; walls = Metal, so Rock_PS (70 → 80). The material refreshes for one car per frame [N/A] | – | Dust at the chosen wheels when side slip > 80 uu/s |
| VT-28 | Jump, double jump, dodge | **Jump:** burst life 0.125–1 s + 0.15 s shake. **Double jump:** dodge ribbon. **Dodge:** ribbons over 0.5 s (life 1 s) + 0.1 s shake. A double jump also leaves a jump-blast decal on the pitch [A/S] | – | Optional |
| VT-29 | Pitch marks | PitchTekDrawingComponent (tyre tracks, jump blasts, goal and demo decals), entirely native | – | Open |
| VT-30 | Ball idle effects | Ground reticle decal always on; location beam starts **1.0 s** after spawn. Fade-in at spawn 0 → 1 at 1/s (1 s), skipped during replay and post-goal. Trail opacity eases to 1 above speed **2000**, alpha step min(1, 3·dt) [N 140f52560] | ball marker only | Speed-gated trail with 3/s easing |

## Open
- **Flash-only:** the boost-meter animation, the banner, the countdown and clock layout, and how long messages show.
- **Car+0x560:** the BoostGlowIntensity divisor (probably 2300).
- **Land_CameraShake:** answered 2026-10-09: duration 0 means no camera output; only the Land_FF rumble plays (notes/camera-shakes.md).
- **SideSpeed / ForwardSpeed:** the exact formula for the wheel FX parameters.
- **Car-impact shake:** confirmed local car only (notes/camera-shakes.md).
- **Remote boost:** whether simulated proxies also start boost from replicated input bits.
- **PitchTek decals:** persistence and fade.
