# Sound behaviour: spec (static session, 2026-10-08)

Behaviour only; no audio was extracted. Live build (2026-10-06). Every bank, package and script is from the live
install; every native was decompiled in the live project, and the addresses are live.

**Tool provenance (local only; the user's decision of 2026-10-09).**
- **The bank parser:** out/bsim/agents/S2/wwbank.py takes its HIRC layout from reading the public source of wwiser (a
  third-party Wwise bank tool). It stays local and git-ignored, and is never committed, copied into tracked paths or
  shipped. Only the facts it produced (event names, timings, curves) go into specs, such as this note.
- **Decoded audio for testing:** out/bsim/assets_local/sound/ was decoded with our own Wwise Vorbis rebuilder
  (out/bsim/agents/SND1/tools/wwvorbis.py, from the Xiph Vorbis I spec, RFC 3533 and the exe). It is also local only.
- **Same rule elsewhere:** the Oodle decoder is covered in notes/car-paint.md.

**Scope parsed.**
- 1341 Wwise banks, all BKHD version 150 (Wwise 2023.1): 32,197 HIRC objects with 0 size errors.
  - SFX/AMB/VO: 951 banks, 2,878 events, 7,720 sounds.
  - Music: 390 banks.
- Names recovered as FNV-1 hashes of strings from packages, scripts and the exe: events 1,995 of 2,873, RTPCs 76 of 113,
  states 93 of 112.
- Sub-agent files, local in out/bsim/agents/S2/:
  - wwbank.py (parser); explain.py → explain/*.txt (event → action → object tree with every curve);
  - init_buses.txt, rtpc_usage.txt, names.json;
  - props_*.txt; decomp_live/.

**Tags.** [bank] parsed from a bank, [pkg] package property, [script] TAGame bytecode, [native 0x…] live decompile,
[inf] inferred.

**Units and curve math.**
- Volume and MakeUpGain in dB; pitch in cents; LPF/HPF on Wwise's 0–100 scale; distances in uu.
- Curves are (x, y) points. A curve stored with dB scaling holds v, converted **asymmetrically** by the evaluator (live 0x140f97470): v < 0 → dB = 20·log10(1 + v) (v = −1 is −96.3 dB); v ≥ 0 → dB = −20·log10(1 − v). Positive values below were corrected on 2026-10-09 (they had used 20·log10(1 + v) throughout and came out too low). Outside its point range a curve is constant. Exact curve shapes, including the SCurve/InvSCurve/Sine/SineRecip polynomials, are in out/bsim/assets_local/sound/README.txt (local).
- From point i to i+1, with t = (x − x_i)/(x_{i+1} − x_i), a = y_i, b = y_{i+1}, using point i's shape:
  - Linear: a + (b − a)t
  - Constant: a
  - Log3: (1 − t)³(a − b) + b
  - Exp3: t³(b − a) + a
  - Log1: (t − 3)t·0.5(a − b) + a
  - Exp1: (t + 1)t·0.5(b − a) + a
  - SCurve, Sine and the rest: see explain.py / wwiser bnode_rtpc.py.
- Volume, Pitch and MakeUpGain add along the parent chain.

**The IsLocal convention (almost every car sound)** [bank].
- Local car: IsLocal ≥ 0.5, sound 2D (centred; panned by SplitScreenPosition).
- Remote car: 3D, with an attenuation curve.

## Events
| # | Trigger | Wwise event(s) | Parameters | Timing | Notes |
|---|---|---|---|---|---|
| SND-1 | Car engine + exhaust loops (Octane product EngineAudio_Car01_OE), attached by EngineAudioBaseComponent_TA.HandleEnabled. **Only 3 cars have engine audio at a time** (DefaultCarEngineAudioGroup MaxActors 3, UpdateDelay 0.1 s) [pkg, script] | Play_/Stop_Car01_Engine, Play_/Stop_Car01_Exhaust (SFX_Motor_Car01) | **Throttle_Input** = \|throttle\| picks the layer: on-load −96 dB below 0.485, 0 dB from 0.51; off-load 0 dB up to 0.49, −96 dB from 0.515.<br>**RPM crossfades** idle (full 0–1038, gone by 1719, S-curve) and high (1038 → 1719, full to 10000).<br>**High loops RPM → Pitch** (cents): 0–125 −4800, 875 −1431, 1000 −1200, 1250 −814, 1500 −498, 1750 −231, 2000 0, 2250 204, 2500 386, 3000 702, 3500 969, 8000 1744, 10000 2459 (verified). Idle loops have no pitch curve; MakeUpGain −10 (engine) / −3 (exhaust).<br>**Parents** [bank]:<br>• remote: +178 c and 3D;<br>• attenuation (remote): 0 dB to 300, −6 @2300, −12 @5500, −96 @14000; LPF 0@400 → 35@1631 → 76@14000; HPF 0@777 → 47@4962 → 56@14000;<br>• Doppler → Pitch −188 c at ±1;<br>• emitter behind the listener: −200 c, LPF 12, HPF 11;<br>• teammate (IsTeam 1): LPF 13, −1 dB;<br>• IsLocal → −2.5 dB at 1;<br>• BoostLevel → Pitch (REV engines only; stays −1 for Octane).<br>Bus: engines (−4) under Car (+2) under hdr (threshold −24) | Play: 100 ms Exp3 fade-in, loops. Stop: immediate | 45 SFX_Motor_* + 185 SFX_REV_* banks (REV engines: Open) |
| SND-2 | **RPM model** (EngineAudioProfile_TA; tick [native 0x140f61530]). Octane uses the class-default profile [pkg]:<br>• Gears = {down 1000+250r, up 7000+250r}, {4000+250r, 7000+250r}, {5000+500r, 7500+500r} ×2;<br>• GearSwitchTime 0.5, RPMAccelStart 2000, AccelEnd 100, AccelClutched 5500, DecelClutched 1000, MaxClutched 8000;<br>• AccelFactor 35, DecelFactor 1, AccelBoostStart 6000, BoostEnd 500, ShiftUpBoost 1500;<br>• AirMaxThrottleTime 1.0, RevLimitRPM 250, RevLimitRPMDecel 5000, MaxWheelSpeed W = 150 | drives SND-1 | Throttle = VehicleSim.OutputThrottle while driving, else Input.Throttle; w = wheel spin (rad/s) [inf].<br>**Clutched (not driving):** throttle > 0 → RPM += thr·5500·dt. Above 8000 + 250 a rev-limit flag is set: throttle forced to 0 and RPM −= 5000·dt until < 8000. No throttle → RPM −= 1000·dt. Floor 1000.<br>**On the ground:** on entry gear = round(w/W·(nGears − 1)); SetGear picks MinRPM = down.Min + U·down.Rand and MaxRPM = up.Min + U·up.Rand (U uniform). Each tick:<br>• shiftTimer > 0: RPM += (1 − timer/0.5)·(MinRPM − RPM);<br>• else throttle or boost: RPM += [2000 + (100 − 2000)·w/W + (dw/dt)·35]·dt, plus [6000 + (500 − 6000)·w/W]·dt when boosting; above MaxRPM (+1500 boosting) upshift (shiftTimer 0.5, GearChanged);<br>• else RPM −= (RPM − w/W·MaxRPM)·dt, and back to gear 0 below MinRPM;<br>• clamp to [MinRPM, MaxRPM(+1500)].<br>**Airborne:** as clutched, with throttle forced to 0 after 1.0 s in the air.<br>Outputs per tick: RPM, Speed = \|v\|, Altitude = z, Throttle_Input and Throttle_Input_Smooth (Wwise slew 2.5/s) | per frame | |
| SND-3 | Engine one-shots on the product: Ignition (spawn, not replay cars), ThrottleEngage (ground, throttle rising from ≤ 0), ThrottleRelease (throttle back to 0), GearChange (upshift), Blowoff (BlowoffThrottleTime 0.25) [script, pkg] | per product | – | Engage and Release stop each other first | **The Octane has none of these** |
| SND-4 | Tire roll and skid loops: posted when a contact physmat appears, restarted on a material change, stopped without contact [native execSetContactPhysMat 0x140e86320] | Play_/Stop_Tires_Rolling_Loop (SFX_Car_Tires) | **MaterialType** switch = the physmat's AkSwitchValue: Grass (floor), Rock, ForceField, Metal, Glass, Goalpost_* (sticky: none → Grass).<br>**Roll:** WheelForwardSpeed → Volume −96 @0, −9.85 @245, +0.79 @1750; → Pitch −775 @0, +586 @1288, +716 @1750.<br>**Skid:** WheelSideSpeed → Volume −96 @0, −14 @65, −2.4 @858, +1.93 @1750; → Pitch −477 @0 → +60 @1750.<br>Remote attenuation 0 dB to 107, −96 @1000.<br>Sources [native 0x140f51600], averaged over the wheels: forward/side = contact velocity along the wheel axes, smoothed at 5/s when rising and set immediately when falling; WheelSpeed = \|spin\| ≤ 150; WheelsOnGround 1/0 | Play: 100 ms fade-in. Stop: skid 200 ms, roll 100 ms | local bus Tires_Local_Rolling |
| SND-5 | **Landing:** per wheel, when contact goes 0 → 1 and \|v·n\| > 50 (strict; MinImpactMomentum 50) [native 0x140f66850, pkg] | Play_Impact_Wheel (SFX_Impacts) | ImpactIntensity = \|v·n\| (uu/s); MaterialType = surface. Local: −4.6 dB @0 → 0 @1097; soft samples full 0–189, gone by 1342; hard 189 → 1342. Camera shake scale 0 below 200, 0.1 @201, 1.0 @2200 [pkg] | immediate (one layer 0.1 s delay); max 25 | up to 4 per landing, one per wheel |
| SND-6 | **Impacts:** ImpactEffectsComponent HandleCollision [native 0x140e8e370 → 0x140f03160 → 0x140f1b080].<br>Intensity = \|(v_self − v_other)·n\|; plays when ≥ 50 and ≥ **0.15 s** since the last impact (a timer per other-actor type).<br>A pooled emitter at the contact point gets MaterialType = the other surface, plus ImpactIntensity.<br>When both actors have the component, only the higher **SoundPriority** plays (ball 100 > car; ties by index). So car–ball plays the ball's sound with MaterialType Car, and car–car plays one body sound | Car: Play_Impact_Body. Ball: Play_Impact_Ball | **Body (local):** tiers light (full 0–250, gone by 1013), medium (250 → 1013, out by 1500), heavy (1013 → 1500, full to 2000); layer volume −3.5 / −25 dB @0 → 0 @2000.<br>**Ball:** attenuation 0 to 508, −8 @4633, −96 @16000; Volume −8 @0, −4 @200, −2 @500, 0 @1200; random ±(−1.5…+0.3) dB, (−68…+57) c; per-MaterialType curves (Car: −96 @0 → −1.4 @43 → 0 @1300; Pitch −118 → 0 @2000). **BallDistance** switch on DistanceToPlayer: Close < 1500 ≤ Mid < 5270 ≤ Far | immediate; max body 15, ball 5 | Crossbar/post: material Goalpost_*, plus global RTPCs Goalpost_Corner (0–1 along the bar) and Goalpost_Angle [script] |
| SND-7 | Body slide/scrape: AkSlideSoundDelay 0.15 s, AkSlideMomentumMin 200 [pkg] | Play_/Stop_Body_Slide | Speed → Volume −96 @0 → 0 @2300 (Log1); Pitch −1667 @0, −971 @330, 0 @2300; Car_SlideAngle = \|dot(axis, v̂)\| crossfades two sets [native 0x140f64830] | 100 ms in / out | start/stop rule not decompiled |
| SND-8 | **Demolition** (Demolish_FXActor) | Play_Impact_Car_Explode, plus Play_Demolition_Teammate or _Opponent | 3D; Pitch ±250 c; MakeUpGain +7; very flat attenuation (−2 dB @12000); teammate −4 dB | on spawn | Crowd: AnyDemolition, or RelevantDemolition when the victim is < 1500 from the ball and the ball < 3000 from a goal |
| SND-9 | **Jump / double jump / dodge** (FX events on the car FX actor) [pkg; native emitter: inf] | Play_Car_Movement_Jump / _DoubleJump / _Dodge | Local: 2D, MakeUpGain −6, random ±150 c, avoid repeat. Remote: 3D, −1 dB, HPF 20, attenuation 0 to 16, −18 @2000, −50 @13000. Max 2.<br>**DoubleJumpCounter → bus pitch** 1 → 0, 5 → +775 c; value = dodge + double-jump air activations, so chained flip-reset dodges rise in pitch [script, bank] | at event time | Jump pressed while it can't activate → Play_UI_JumpFail. Flip reset → Play_Car_Movement_FlipReset (if FlipResetFxPref is 1 or 3) [script] |
| SND-10 | In-air whoosh, local car only (FX state InAir) | Play_/Stop_Car_Movement_InAirWhoosh_Loop | Three layers on Car_Yaw / Car_Pitch / Car_Roll (0–1, folded orientation vs the view) [native 0x140f52b60]: −96 → 0 dB; pitch −954 → −179 / −895 → −357 / −477 → +119 c. Speed gate −96 @0 → 0 dB @~1200–1330 → +1 @2300 | 300 ms in/out | bus −9 |
| SND-11 | **Supersonic** (bSuperSonic: on at 2200 uu/s; off after 1 s below 2200 or below 2100) [native 0x140f52b60] | Rising edge: Play_Vehicle_SuperSonic + Play_Vehicle_SuperSonic_Loop. Falling: Stop_…_Loop | Local only (remote −96 dB). Loop Speed → Pitch −264 c @0 → +1102 @2300 (Exp1, verified) | loop 200 ms in/out | Wwise state IsSupersonic (cleared on demolition) |
| SND-12 | **Boost loop**: FX state Active of CarComponent_Boost (Boost_Standard product) [pkg] | Play_/Stop_Boost_Standard_Loop (311 SFX_Boost_* banks, one per product) | Play: loop (+4 dB) + start transient. Stop: loop fades 500 ms, transient cut, tail one-shot (−6 dB). Speed → Pitch 0 → +254 c @2300 (Exp3).<br>Shared parent:<br>• remote 3D −3 dB;<br>• **SpamControl_Boost** 1…5 → HPF 19, LPF 18, −5 dB, MakeUpGain −2 at 5 (decay component: max 5; decay 0.2/s at 0 → 3/s at 5; +1 per boost press [inf]);<br>• behind the listener −350 c, HPF 31;<br>• teammate LPF 10, −1 dB | on/off immediate | the player can force DefaultBoostSound = Boost_Standard_Loop |
| SND-13 | **Boost pickup** (pads 0.12 / 4 s, pills full / 10 s) | Local human: Play_Boost_Pickup_Pad_Local / _Pill_Local (2D, +4). Others: Play_Boost_Pickup_NonLocal (3D, −5; 0 to 300, −8 @1850, −14 @5500, −96 @14000). Big pads: Play_Boost_Pickup_Respawn_Start (warm-up) / _End (respawn) | Respawn_Start loops on Boost_Pickup_Respawn_Timer (0–1 progress): silent until ≈0.43, then Pitch 0 → +977 @0.8 → +2048 c @1.0 | on entering PickedUp (same frame as GiveBoost); End stops Start with a 100 ms fade | HUD meter sounds are −108 dB in Soccar |
| SND-14 | Ball roll / fly loops: roll attaches on Spawned, fly on InAir (set as soon as ball contact is lost, cleared after one tick of contact) [native 0x140f52560] | Play_/Stop_Ball_Rolling_Loop, Play_/Stop_Ball_Flying_Loop | Sources: Speed = \|v\|, Altitude = z, DistanceToPlayer = closest local player.<br>**Fly:** +530 c and LPF 13 base; Speed → Pitch −1073 @0 → +929 @2300; Speed → Volume −96 @0, −1.16 @409, +1.81 @2300; Altitude → −96 @0, −1.1 @200, +0.2 @3200; DistanceToPlayer +9.0 @0 → 0 @1000; Doppler ±1000 c; attenuation 0 to 207, −20.5 @1971, −96 @4500.<br>**Roll:** Speed → −96 @0 → 0 @101 → +5.0 @2300; Pitch −700 @0, +685 @1174, +1233 @2300; attenuation −20 @1121, −96 @2560 | fly 300 ms in; stops immediate; max 2 | bus Ball_Movements (−10) |
| SND-15 | **Goal:** ArenaSoundManager PostGoalScored → horn; ball explosion FX on spawn; goal VO | Play_GoalEvent_Horn, Play_GoalEvent_Explosion (product explosions have their own banks), Play_GoalEvent_CameraSloMo_Start / SwoopOut / End (replay camera) | 2D; explosion bus +7 | **Horn delayed 500 ms** (bank); explosion on spawn, killed on detach | state BallExplode Realtime/Replay; music stinger in ReplayPlayback (delay 5 s) |
| SND-16 | **Kickoff countdown and clock:** the countdown timer starts after 1 s, then 3/2/1 messages one second apart and GO; last 10 s one message per second; 60 / 30 s and overtime messages [script, pkg] | Play_SFX_UI_Countdown_03/02/01 (same sample, −3 dB), …_Go (−3 dB), …_EndCounter (−2 dB, +150 c), …_Remaining_60sec / _30sec, …_Overtime | – | one per second, 2D | crowd count-down BG_Crowd_Countdown_10…01 |
| SND-17 | **Crowd:** CrowdSoundManager_TA. Four smoothed values (0–100): Tension (up 1.3/s, down 0.5/s), Excitement (3 / 0.2), Upset (10 / 1), Anticipation (3 / 1). Each = default 0 plus or times a stack of curve/duration modifiers (e.g. Goal +30 over 8 s, Aerial +25 over 4 s, KickoffTouch ×1.1 for 3 s). Pushed each tick as global RTPCs GameTension / GameExcitement / GameUpset / GameAnticipation [script, pkg] | Play_BG_Crowd_01 (bed) + reaction one-shots | **Bed:** Excitement crossfades three loops (0–5, 5–49, 49–95); Tension two (19 → 95; −96 @0 → +0.31 @77 → +3.72 @100; +400 c; LPF 33 → 0); Upset −400 c LPF 19; Anticipation +300 c.<br>**Reactions:**<br>• Shot: scorability > 0.7, ball → goal > 500 uu/s, within 2500;<br>• Save: shot ended within 2 s, last touch within 0.8 s;<br>• OpenGoal: defence ≤ 0.3 for ≥ 0.5 s;<br>• LongTimeNearGoal: ≥ 15 s within 3200;<br>• FastBreak: 3500–6000 from goal, > 1200 toward it, 1.5 s;<br>• Aerial: value ≥ 0.8 for 0.35 s;<br>• Crossbar: force ≥ 1400;<br>• also kickoff touch, demolition, round/game events.<br>Cue = the last whose threshold < the value (e.g. ShotAttempt: MildApplause > 0, Shock > 70, Boo > 95; cooldown 10 s) | event-driven, with cooldowns | bus Crowd_HDR (−27); full tables in props_CrowdSounds_Stadium.txt |
| SND-18 | **Listener and mix:** the listener is the local player's camera [inf]; split-screen listener at the ball | – | Per emitter: IsTeam (1 / 0 / −1 own); MajorityFar = (d² − (L/2)²)/(L/2)² when all remote cars are beyond half the field; FieldSide = Y / FieldSize.Y (reverb buses); DopplerAngle = cos(v, emitter → camera), 0 for your own car [native 0x140da0b10]. Ducking: music ducks an aux bus −96 dB (2 s); the crowd countdown ducks other crowd groups | – | bus tree in init_buses.txt |

## Game parameters (Init.bnk defaults and slews; sources as tagged)
| Parameter | Default / slew | Source | Range used |
|---|---|---|---|
| RPM | 1000 | engine simulator (SND-2) | 0–10000 |
| Throttle_Input / _Smooth | 0 / slew 2.5/s | \|throttle\| | 0–1 |
| Speed | 0 | \|v\| of the emitter's actor | 0–2300 |
| Altitude | 0 | actor z | 0–3200 |
| WheelSpeed / Forward / Side / Turn / WheelsOnGround | 0 / 0 / 0 / 0 (0.1 s filter) / 1 (slew 2) | SND-4 | 0–150, 0–1750, 0–1750, 0–10, 0/1 |
| Car_SlideAngle | 0 | \|dot(axis, v̂)\| | 0–1 |
| Car_Pitch / Yaw / Roll | 0 | folded orientation vs the view (local, in air) | 0–1 |
| ImpactIntensity | 0 | \|v_rel·n\| | 0–2000 |
| DistanceToPlayer (+ BallDistance switch) | 0 | closest local player | 0–10000; 1500 / 5270 |
| DopplerAngle | 0 | cos(v, to camera) | −1…1 |
| SpamControl_Boost | 1 | decay component | 1–5 |
| DoubleJumpCounter | 1 | air activations | 1–5 |
| Boost_Pickup_Respawn_Timer | 0 | respawn progress | 0–1 |
| IsLocal / IsTeam | 0 / −1 (0.3 s filter) | local car / team relation | 0/1, −1/0/1 |
| MajorityFar, FieldSide | 0 (slew 1), 0 | SND-18 | ≥ 0, −1…1 |
| GameTension / Excitement / Upset / Anticipation | 0 | crowd model | 0–100 |
| Goalpost_Corner / Goalpost_Angle | 1 / – | crossbar hit | 0–1 |
| Volume_SFX / MX / Crowd / Ambient / Anthems / Master | 0.9 | settings | 0–1 |

**States:** GameState, GameMode, InUI, IsSupersonic, ScoreStatus, ScoreSeparation, PlayerCount, MajorityFar,
CameraBallFocus (ball cam), BallExplode, LiveReplay, AnthemPlaying, LoadingScreen, ReplayPlaybackSpeed.

**Impact and landing sound triggers** (2026-10-10): see notes/impact-triggers.md (IT-1..5).
- Impact_Body/Impact_Ball need v ≥ 50 and a 0.15 s game-time cooldown (separate world and actor slots); the ball's
  SoundPriority 100 silences the car side.
- Impact_Wheel fires per wheel per frame on landing (v > 50, RTPC = v) with no cooldown.

## Open
1. **LPF/HPF:** the 0–100 → Hz mapping is not extracted (approximate in the client).
2. **REV engines:** the simulator (AkRevPhysicsSimulation, the REV_* RTPCs, 198 profiles) and switch #3177079107 are
   not specified.
3. **Native emitters not decompiled:** the Jump/DoubleJump/Dodge/InAir/Boost FX events; the slide start/stop rule;
   the SpamControl increment; the 3-car engine-audio selection; where IsLocal and SplitScreenPosition are set.
4. **Car_Pitch/Yaw/Roll reference:** compared against car+0x2a0, assumed to be the Controller.
5. **Unresolved names:** 878 non-music event names and some RTPCs/buses; the crowd Excitement/Tension state
   thresholds were not dumped.
6. **Not specified:** product goal explosions (SFX_GoalExplosion_*) and music, though both were parsed.
