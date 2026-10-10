# Private-match mutators: spec (static session, 2026-10-10; live build 2026-10-06)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent MUT1 and two forks; their rule and item detail is
appended below as Appendix A (match rules, "forkB R-n") and Appendix B (Rumble items, "forkA"). The static session
re-checked the Slo-Mo clock (GameEvent_TA.GetRealDeltaTime = dt / MatchTimeDilation; GameTimeRemaining uses it, TA:3813).
Option labels are by localization key only (not cleared to ship).

Fidelity target: live `RocketLeague.exe` 2026-10-06. Game data only from the snapshot
`rocketleague-20261006/` (decrypted copies in `out/bsim/agents/MUT1/`, git-ignored).

Tags: **[A]** package data · **[S]** UnrealScript (`out/bsim/work/tagame_live_all.txt`, cited `TA:<line>`) ·
**[N]** native code (live addresses, Ghidra copy `out/bsim/agents/MUT1/rl-live`, objdump of the live exe) ·
**[I]** inferred. Names are setting / object names and loc keys (`MutatorSetting_<name>`,
`MutatorCategory_<cat>`, `MutatorSettingDefault_<cat>`); no UI label text.

Companion files (same directory):
- Appendix B (was `forkA/items.md`) — the Rumble (`Items`) category in full (pools, give rates, every pickup's constants).
- Appendix A (was `forkB/rules.md`) — the match-rule categories in full (time, score, overtime, max time, series, multi-ball,
  respawn / goal delay, score mutators, presets, the hidden categories, how mutators are applied).
- `work/table_raw.txt` — machine-generated category → option → archetype-property list (the source of §2).
- `decomp/d1..d9/` — the decompiles cited below; `scan/` — displacement scans (`ghidra_scripts/FindDisp.java`).

---

## 1. Where the table lives and how an option becomes behaviour

1. **Category list** = `Archetypes.Online.GameSettings.GameSettings_Default.GameSettingCategories`
   (`OnlineGameSettings_X`, TAGame.upk) [A]: 65 categories, in this order (hidden ones marked h, `bUseableWhileHidden` u):
   Clean h, Lobby h, Official h, Bots h, BotDifficulty h, Playlists h, PlayerCount h, Presets h, FreePlay h,
   AerialTargets h, SpawnTargets h, OnlineFreeplay h, BoostOption h, GoalResetOption h, PhysicsLogPlayback h,
   **GameTimes, GameScores, OvertimeRules, MaxTimeRules** (u), **MatchGames, GameSpeed, BallMaxSpeed, BallType,
   BallWeight, BallScale, BallBounciness, BallGravity, MultiBall, Boosters, BoostPadRespawnTime, Items**,
   ItemGiveRate hu, Attachments h, CarMaxSpeed h, **BoosterStrengths, Gravity, Demolish, RespawnTime**,
   AudioRules h, GameEventRules h, TritipModeRules h, **CarJumps, DodgeInputTimer, TerritoryRules**,
   LockedBreakoutTiles hu, BreakoutTileStartingState hu, BreakoutBallLockedIndex hu, **GoalScore, AerialGoalScore**,
   BackwardsGoalScore hu, BicycleGoalScore hu, LongGoalScore hu, TurtleGoalScore hu, **AssistScore,
   DemolishScore, PossessionRules**, GoalScoringRules hu, FireBallObstacle h, BoostRestriction hu,
   InputRestriction hu, SpawnPointRules hu, KeepUpRules hu, MatchAdmin h, DemoFX h, GoalShields hu.
   Bold = shown in the private-match UI. Each category's first UI entry is the implicit "default"
   (`MutatorSettingDefault_<cat>`) = no mutator for that category.
2. **Option → mutator**: each option is a `MutatorGameSetting_TA` whose `GetMutator()` loads
   `MutatorPackage . Name` (TA:70742-70746); `MutatorPackage` default `Mutators.Mutators.Mutators` [A], overridden to
   `Mutators_Balls…` (BallType) and `Mutators_Items…` (Items). The archetypes live in `Mutators_SF`,
   `Mutators_Balls_SF`, `Mutators_Items_SF` [A]. `MutatorConfig_TA` defaults: `MaxAllowedMutators` 18,
   `MaxPreviewMutators` 8 [A] (menu-only, forkB R-0.9). `MutatorGroupID` only selects the menu tab (2 = ball, 1 = car /
   world, 0 = match; forkB R-0.8).
3. **Application** [S]: the URL carries `?GameTags=<Setting>,<Setting>,…` (forkB R-0.1). `GameEvent_TA.InitMutators`
   (before `OnInit`, TA:849-855, 877) instantiates the playlist's `DefaultMutators` (minus those whose
   `ProhitibitedDefaultMatchTypes` lists the current match type), then one mutator per active setting, then calls
   `Init(GameEvent)` on each (rules, world gravity, time dilation, ball archetype). `MutateObject(O)` runs for every
   mutator on every pad at init, every car after `SpawnCar` (kickoff and every demo respawn), every car component as it
   is added (TA:1514-1516), every ball in `AddGameBall` (every spawn/respawn) (forkB R-0.5). So **every respawned car
   and every new ball gets the per-object settings again**, starting from the archetype.
   **Order = category order** of item 1, one setting per category [N `GetActiveGameSettings` 0x140de05e0 →
   0x140e2ca20: loops `GameSettingCategories` in order, then that category's `GameSettings` in order, keeping the
   first selected]. Same-field conflicts therefore resolve as:
   - BallMaxSpeed < BallWeight: `MagnusFutballLess` (×0.5) overrides any BallMaxSpeed option (each call sets
     `default × s`, not cumulative); BallWeight < BallScale / BallGravity: those categories override the
     `MagnusFutballLess` / `BalloonBall` / `MagnusFutball*` values.
   - **BallBounciness is cumulative**: `SetWorldBounceScale` multiplies the *current* override material's restitution
     (TA:11184-11191), so `MagnusFutballLess` (0.5) + HighBounciness (1.25) → 0.6·0.5·1.25 = 0.375; a Magnus
     `PhysMatOverride` (BallWeight) comes before BallBounciness and is then scaled.
   Menu constraints [A, raw FString arrays, forkB R-0.10]: BoosterStrengths.* and BoostPadRespawnTime.*
   `DisallowedWithMutators = ['NoBooster']`; GiantBall `DisallowedWithMutators = ['Ball_Basketball']`; NoBooster
   `MutatorCategoriesToDisable = ['BoosterStrengths', 'BoostPadRespawnTime']`. Menu-only; the game event does not
   enforce them.
4. **`default.X` in these scripts reads the actor's archetype**, not the class default object
   [N `execDefaultVariable` 0x14034b350: `ObjectArchetype` (+0x58) unless the property lies outside the archetype's
   class, then the class default]. So `Ball.default.MaxLinearSpeed` = 6000 (Ball_Default), `default.GravityScale` = 1
   (Pawn_X default), `Car.default.Mass` = 180.

---

## 2. Mutator table (every live option)

Values are the archetype's non-default properties [A] (`work/table_raw.txt`); class defaults [A]:
`Mutator_Car_TA` MaxTimeForDodge −1, MaxNumJumps −1 (= unchanged); `Mutator_Booster_TA` RespawnDelayScale 1;
`Mutator_Match_TA` GameScore −1, ItemGiveRateOverride −1; `Mutator_Demolish_TA` bAwardDemolishCredit true;
`Mutator_Breakout_TA` LockedDamageIndex −1; everything else 0/false/None (= "leave unchanged", each setter is
guarded by `> 0` / `!= 0` / `!= None`, TA:70128-70169, 70180-70220, 70238-70264, 70269-70282).
P = engine physics, R = game rules (server/game-event logic), C = cosmetic/lobby.

### 2.1 Physics categories

| Category (default) | Option (h = hidden) | Archetype values [A] | Target [S/N] | P/R | Effect (exact) |
|---|---|---|---|---|---|
| **GameSpeed** (1.0) | SloMoGameSpeed | `Mutator_GameSpeed_TA` GameSpeed 0.65 | `GameEvent.MatchTimeDilation` (TA:70509-70512 → TA:1508) | P+R | `WorldInfo.TimeDilation` = 0.65 from every Countdown (TA:1858-1862); post-goal slow-mo = curve × 0.65 (TA:4270-4273); reset to MatchTimeDilation after the goal (TA:4259), to 1 at the podium (TA:4331-4333); the match clock runs on real time (dt / 0.65). §3.1 |
| | SloMoDistanceBall | `Mutator_Ball_TA` BallSloMoDuration 0.5, BallSloMoDilation 0.5, BallSloMoCooldown 2.0, BallSloMoRadius 400 (BallSloMoDiffSpeed 0) | `BallSlomoComponent_TA` attached to each ball (TA:70138-70147, 70170-70176) | P+R | While the round is active: a car within 400 uu of the ball and `TimeSeconds > BallSloMoNext` → TimeDilation 0.5, `BallSloMoNext = now + 0.5 + 2.0`, restore to **1** after 0.5 s (TA:12925-12946). §3.1 |
| **BallMaxSpeed** (6000) | SlowBall / FastBall / SuperFastBall | BallMaxLinearSpeedScale 0.25 / 1.5 / 2.5 | `Ball.SetBallMaxLinearSpeedScale` → `SetMaxLinearSpeed(default.MaxLinearSpeed·s)` + `ReInitRBPhys` (TA:11176-11180) | P | Linear speed cap **1500 / 9000 / 15000 uu/s**, both caps (actor +0x560 and Bullet body +0x368 = cap·0.02) [N `execSetMaxLinearSpeed` 0x140e73a50]. Angular cap unchanged (6 rad/s). |
| **BallType** (Ball_Default) | Ball_CubeBall, Ball_Puck, Ball_BasketBall, Ball_Beachball, Ball_Anniversary, Ball_Haunted h, Ball_SpookyCube h, Ball_Ekin h, Ball_Egg, Ball_Fire, Ball_Breakout, Ball_Score, Ball_PizzaPuck h, Ball_Shoe h, Ball_Strike, Ball_SpookyBalloon h, ball_luminousairplane h, Ball_WorldCup h | `Mutator_Ball_TA` BallArchetype = `Archetypes.Ball.<…>` (`Mutators_Balls_SF`) | `SoccarGame.BallArchetype` (TA:70091-70092; lobby too TA:70099-70101) | P | Replaces the ball actor: shape, mass, material, car-interaction curve, special class. §3.4 table |
| **BallWeight** ("Ball Physics"; none) | LightBall | BallCarBounciness 0.75 | `Ball.ReplicatedAddedCarBounceScale` (TA:11181-11183) | P | Car-hit impulse ×1.75; hit-dir Z scale 0.35·1.375. §3.3 |
| | HeavyBall | BallCarBounciness −0.9 | same | P | Car-hit impulse ×0.1; Z scale stays 0.35 (or the ground rule: B uses the ball's ground-bounce Z when b ≤ 0). §3.3 |
| | SuperLightBall | BallCarBounciness 1.25 | same | P | ×2.25; Z scale 0.35·1.625 |
| | MagnusBall | BallMaxAngularSpeed 12, BallHitSpinScale 1.0, BallMagnusCoefficient (0.015, 0.015, 0.00725), PhysMatOverride Physmat_Ball_Magnus | `SetMaxAngularSpeed`, `Ball.BallHitSpinScale`, `Ball.MagnusCoefficient`, `SetPhysMatOverride` (TA:70152-70160) | P | Magnus acceleration (ω×v)⊙C, spin from off-centre hits, ω cap 12. Material = same numbers as Physmat_Ball (0.35/0.6/0.03) [A]. §3.3 |
| | MagnusBeachBall | BallCarBounciness 0.5, MaxAngular 12, HitSpin 1.0, Magnus (0.025, 0.025, 0.025), Physmat_Ball_BeachBall | as above | P | ×1.5 hits, Z scale 0.35·1.25, Magnus C 0.025 all axes |
| | MagnusFutball h | BallGravityScale 1.75, MaxAngular 12, HitSpin 0.75, Magnus (0.015, 0.015, 0.00725), Physmat_Ball_Magnus | | P | |
| | MagnusFutballTest h | Gravity 1.65, MaxAngular 12, HitSpin 0.85, Magnus as MagnusBall, Physmat_Ball_Magnus | | P | |
| | MagnusFutballMore h | Gravity 2.0, MaxAngular 12, HitSpin 1.0, Magnus as MagnusBall, Physmat_Ball_Magnus | | P | |
| | MagnusFutballLess | BallScale 0.9, BallBounciness 0.5, BallCarBounciness 0.5, BallGravityScale 1.5, BallMaxLinearSpeedScale 0.5, BallHitSpinScale 0.25, Magnus (0.05, 0.05, 0), BallMagnusMinSpeed 500 | | P | radius 82.05, restitution max(0.3, 0.3)=0.3, hits ×1.5, gravity ×1.5, cap 3000, ω cap stays 6, Magnus only when horizontal speed ≥ 500 |
| | BalloonBall h | BallBounciness 1.25, BallCarBounciness 3.0, BallGravityScale 1.5, BallMaxLinearSpeedScale 1.25, BallAirResistance (1.75, 2.25, 1.75), AdditionalCarGroundBounceScaleXYOverride 1.2 | + `Ball.AirResistance` / `MinResistanceVelocity` (TA:70162-70166) | P | restitution 0.75, hits ×4 (Z scale 0.35·2.5), gravity ×1.5, cap 7500, per-axis air drag, +1.2·HitDirXY |
| **BallScale** (1.0) | SmallBall / MediumBall / BigBall / GiantBall | BallScale 0.75 / 1.3 (f32 1.2999999523) / 1.5 / 2.25 | `Ball.SetBallScale` (TA:11147-11170) | P | Bullet sphere radius **68.25 / 118.85 / 137.25 / 206.25** uu; mass unchanged (30); inertia from the new sphere. §3.2 |
| **BallBounciness** (1.0) | LowBounciness / HighBounciness / SuperBounciness | BallBounciness 0.25 / 1.25 / 1.75 | `Ball.SetWorldBounceScale`: new PhysicalMaterial instance, Restitution ×s, `ReInitRBPhys` (TA:11184-11191) | P | Ball material restitution 0.15 / 0.75 / 1.05 → ball–arena **0.3 / 0.75 / 1.0** (combine = max, clamped to [0, 1]) [N 0x140410ff0]. §3.2 |
| **BallGravity** (1.0) | LowGravityBall / HighGravityBall / SuperGravityBall | BallGravityScale 0.5 / 2.0 / 5.0 | `Ball.GravityScale = default.GravityScale·s` (Pawn_X, TA:11171-11175) | P | Ball gravity = world gravity × s (−325 / −1300 / −3250 with default world gravity) via a per-step "DeltaGrav" acceleration [N 0x140ebb9c0]. §3.2 |
| **MultiBall** (1) | TwoBalls / FourBalls / SixBalls | TotalGameBalls 2 / 4 / 6 | `SoccarGame.SetTotalGameBalls` (TA:70089-70090) | P+R | N balls at x = {−(N−1) … N−1, step 2}·(SpawnWidth + 50), same z as the single ball (default ball: ±145.49; ±436.47; ±727.45); every ball gets every ball mutator; the first goal ends the round, other balls' goals are ignored outside Active (forkB §6) |
| **Gravity** (−650) | LowGravity / HighGravity / SuperGravity / ReverseGravity h | Gravity 0.5 / 1.75 / 5.0 / −1.0 | `WorldInfo.WorldGravityZ *= Gravity` (TA:70515-70517) | P | World gravity **−325 / −1137.5 / −3250 / +650**; reaches Bullet via the per-frame world gravity [N 0x140f54bd0 → 0x14041f6f0]; also scales the cars' sticky force and flips dodge Y on reverse gravity. §3.2 |

### 2.2 Car / boost categories

| Category (default) | Option | Archetype values [A] | Target [S/N] | P/R | Effect (exact) |
|---|---|---|---|---|---|
| **Boosters** ("Boost Amount"; standard) | NoBooster | bNoBooster | `Boost.SetNoBoost(true)` (amount 0, TA:22205-22209); pickups `SetNoPickup()` (TA:70206-70208) | P | No boost ever: amount 0, `GiveStartingBoost` skipped, pads disabled, `CanActivate` fails (amount 0) [N 0x140ecf9d0] |
| | UnlimitedBooster | bUnlimitedBoost | `Boost.SetUnlimitedBoostDelayed(true)` → after **0.1 s** `SetUnlimitedBoost(true)`: `GiveFullBoost` + `UnlimitedBoostRefCount++` (TA:22188-22204); pickups disabled (TA:70206) | P | Boost 100 and never consumed while refcount > 0 [N 0x140f20bb0]; a (re)spawned car starts at 33.3 for 0.1 s, then 100 |
| | SlowRecharge / RapidRecharge | BoostRechargeRate 0.0666 / 0.1666 (per s, of max 1.0), BoostRechargeDelay 2.0 | `SetRechargeRate`, `SetRechargeDelay` (TA:70196-70199) | P | While boost is inactive and `ActivityTime > 2.0` s: +6.66 / +16.66 boost per second (×dt each physics step), clamped to 100 [N 0x140f20bb0, 0x140f352b0]. Pads stay on |
| **BoosterStrengths** (1×) | BoostMultiplier1_5x / 2x / 5x / 10x | BoostStrength 1.5 / 2 / 5 / 10 | `Boost.SetBoostModifier` → `BoostModifier` (TA:70194-70195, 22185) | P | Boost force = BoostForce 178500 × k along the car's forward axis [N `ApplyForces` 0x140eb8a50]: **991.67·k uu/s²** (the air-throttle 66.67 is separate and unscaled) |
| **BoostPadRespawnTime** ("Boost Pad Charge Rate"; 1×) | BoostPadRespawn2 / 1_5 / 0_667 / 0_5 / 0_2 / 0_1 | RespawnDelayScale 2 / 1.5 / 0.667 / 0.5 / 0.2 / 0.1 | `BoostPickup.RespawnDelayScale` (TA:70209-70210); `GetRespawnDelay = RespawnDelay × RespawnDelayScale` (TA:107661-107662) | P | Big pads 10 s → 20 / 15 / 6.67 / 5 / 2 / 1 s; small 4 s → 8 / 6 / 2.668 / 2 / 0.8 / 0.4 s (forkB for timing). Not applied when NoBooster/UnlimitedBooster disable the pads (TA:70206-70210) |
| **CarJumps** (MaxNumJumps 2) | Grounded / 2DoubleJumps / 3DoubleJumps / 4DoubleJumps / NoJumps | MaxNumJumps 1 / 3 / 4 / 5 / 0 | `Car.SetMaxNumJumps` (authority only, TA:20199-20202) | P | Air activations (double jump or dodge) allowed = MaxNumJumps − 1; 0 = no ground jump either. §3.5 |
| | UnlimitedJumps | bUnlimitedJumps | `Car.SetUnlimitedJumpsEnabled` (TA:20195-20198) | P | Ground jump always allowed; air jump/dodge always available (still needs the dodge window unless the car never jumped) |
| **DodgeInputTimer** (1.25 s) | DodgeTwoSeconds / DodgeThreeSeconds / DodgeUnlimitedSeconds | MaxTimeForDodge 2.0 / 3.0; bUnlimitedTimeForDodge | `Car.MaxTimeForDodge` / `SetUnlimitedTimeForDodgeEnabled` (TA:70245-70249, 20191-20194) | P | Air jump/dodge window after the last jump/air activation: 2.0 / 3.0 / ∞ s (TA:20499-20504) |
| **Demolish** (car default: OtherTeam + Supersonic) | NoDemolish | DemolishTarget None | `Car.DemolishTarget` (TA:70272-70273) | P | No car–car demolitions (bumps unchanged) |
| | DemolishAll | DemolishTarget Everyone | | P | Supersonic demos also on teammates |
| | AlwaysDemolishOpposing | DemolishTarget OtherTeam, DemolishSpeed None | + `Car.DemolishSpeed` | P | **Any** contact with an opponent demolishes it (no speed, direction or cone test; no bump) — both cars in a contact are demolished. §3.6 |
| | AlwaysDemolish | DemolishTarget Everyone, DemolishSpeed None | | P | Same for every car, teammates included |
| | TeamDemoBall / TeamDemoBallSilent h | VehicleDemolishMode VDM_Team (Silent: bAwardDemolishCredit false) | `Ball.VehicleDemolishMode` (TA:70276-70281) | P | A car touching a ball last touched by the other team is demolished (car demos stay default). §3.6 |
| | FFADemoBall / FFADemoBallSilent h | VDM_FFA (Silent: no credit) | | P | Every car touch of the ball demolishes the toucher |
| **RespawnTime** (3 s, `PlayerSpawnConfig_TA.RespawnDelaySeconds`) | TwoSecondsRespawn / OneSecondsRespawn | RespawnTime 2 / 1 | static `Mutator_RespawnTime_TA.Mutate(Feature)` → `RespawnDelaySeconds` (TA:70668-70671); `bAllowDemoSpawnSelection = false` when < 3 (TA:70660-70661) | P+R | Demo respawn after 2 / 1 s (240 / 120 ticks); no respawn-side selection |
| | DisableGoalDelay | bDisableGoalDelay (BallRespawnTime 0) | `SoccarEvent.SetDisableGoalDelay(true, BallRespawnTime)` (TA:70658-70659) | R | A goal that does not decide the match: no PostGoalScored (no slow-mo, replay, countdown); one ball → `StartNewRound` with the ball respawned at once, **cars not reset**, pads reset, clock keeps running; several balls → only the scoring ball respawns (forkB §7) |
| BoostRestriction h,u | AerialBoostOnly | BoostRestriction EBR_AerialOnly | `Boost.SetBoostRestriction` (TA:70202-70203) | P | Boost unavailable/cut while ≥ 3 wheels touch (`IsOnGround`) [N 0x140f11540, 0x140f122e0]. §3.7 |
| InputRestriction h,u | BackwardsMode | EIR_BackwardsMode | `Vehicle.SetInputRestriction` (TA:70524-70529) → `Vehicle_TA.InputRestriction` +0x822 | P | Forward throttle (> 0.01) is treated as no throttle (coast: brake 0.15 above 25 uu/s, 1.0 below) unless the car rolls backwards faster than 25 uu/s (then the usual opposite brake) [N VehicleSim throttle/brake 0x140f24270]; positive DodgeForward is negated (no forward dodges) and bots' positive throttle is negated [N `execUpdateRestrictedInput` 0x140e83ef0, input packing 0x140f36790]. §3.8 |
| CarMaxSpeed h | (no options in the live list; archetypes CarMaxSpeed2x/4x exist, CarMaxLinearSpeedScale 2 / 4) | — | `Car.SetCarMaxLinearSpeedScale` (TA:20870-20874) | dormant | |
| Attachments h, GoalShields hu, SpawnPointRules hu, ItemGiveRate hu, AerialTargets h, SpawnTargets h | (no options) | — | — | dormant | |

### 2.3 Rules / scoring / other categories (detail in forkB, Rumble in forkA)

| Category | Options [A] | Target | P/R |
|---|---|---|---|
| **GameTimes** (default 300 s, `GameEvent_Soccar.GameTime`) | 1Minute h 60, 2Minutes h 120, 3Minutes h 180, 4Minutes h 240, 10Minutes 600, 20Minutes 1200, UnlimitedTime (bUnlimitedTime) | `SoccarGame.GameTime` / `bUnlimitedTime` (TA:70558-70569) | R — clock f32, runs after the first touch, decremented by dt/MatchTimeDilation; unlimited counts up and only MaxScore/forfeit ends the match (forkB §1) |
| **GameScores** (default unlimited, MaxScore 0) | Max1, Max3, Max5, Max7, Max10, Max20, Max30, Max40, Max50, Max60, Max70, Max80, Max90, Max100, Max151 h (GameScore = N; ProhitibitedDefaultMatchTypes MatchType_Private_TA — filters only a playlist's default mutators) | `SoccarGame.MaxScore`, `SetAlwaysShowMatchTypeLabel(true)` (TA:70571-70573) | R — `score >= MaxScore`: after the post-goal sequence for a goal, ~0.01 s later (mid-play) for other points (forkB §2) |
| **OvertimeRules** (default unlimited sudden death, counts up) | Overtime5MinutesFirstScore (OvertimeGameTime 300), Overtime5MinutesRandom (300, TieBreaker Random) | new `OvertimeComponent_TA` (TA:70576-70580) | R — overtime counts down 300 s; tied at 0:00 → ball-ground rule or 90 s timeout → winner = team of the match's first goal / a random team picked once (forkB §3) |
| **MaxTimeRules** (u; default none) | MaxTime1Minute … MaxTime15Minutes: TimeLimitSeconds 60·n; WarningTimeSeconds 30, 90, 150, 210, 270, 330, 360, 420, 480, 540 (10 min), 540 (11 min), 600, 660, 720, 780 | `MaxTimeComponent_TA` added to the event (TA:70574-70575) | R — at the limit the match ends at once: score leader, else more team shots, else random (forkB §4) |
| **MatchGames** (series 1) | 3Games, 5Games, 7Games | `SeriesLength`, `MatchSeries_TA` (TA:70560-70566) | R — best of N, ceil(N/2) wins, persists across matches (forkB §5) |
| **Items** (off) | 14 options (forkA) | `SoccarGame.SubRules` (TA:70581-70589) | P+R |
| **GoalScore** / **AerialGoalScore** | GoalScore0/2/3/5/10; AerialGoalScore0/2/3/5/10 (`GoalStatEventScore` {Goal / AerialGoal, N}) | `GameEvent_Soccar_TA.GetGoalScorePoints` + `Mutator_Score_TA.GetGoalScore` (TA:3597-3615, 70718) | R — goal points = max N over the score mutators whose event matches the scoring touch's goal types (else 1) + the ball's bonus (forkB §9.1) |
| **AssistScore** / **DemolishScore** (off) | AssistScore1/2/3, DemolishScore1/2/3 (`TrackedStatEventScore`) | `HandleStatGiven` adds N team goals + PRI score per Assist/Demolish of an opponent while active (TA:70692-70705); notes/match-stats.md §5.1 | R |
| **PossessionRules** (off) | Possession1Second/2Seconds/3Seconds (PossessionSeconds 1/2/3, PossessionScore 1) | `BallPossessionComponent_TA.SetIntervalAndScore` (TA:70707-70714) | R |
| **TerritoryRules** (TA class, off) | TerritoryEnabled: CarComponent_TerritoryDemolish; StaleBallMaxTime 30, WarningThreshold 10, NoTeamMaxTime 10, NoTeamWarningThreshold 5, YRespawnOffset 2000 | car component + `BallStaleTimerComponent_TA` (TA:70724-70735) | P+R |
| KeepUpRules hu | KeepUpEnabled (BallComponent_KeepUp), KeepUpStageEnabled (…_Stage, ScoreIncrementSeconds 0) | `KeepUpCompArchetype.SpawnInstance(Ball)` (TA:70715-70716) | R |
| GoalScoringRules hu | DisableGoalScoring | `SetGoalsEnabled(false)` (TA:70283-70287) | R |
| FireBallObstacle h | FireBallObstacleEnabled (Ball_RingSpawner, delay 5 s, +1000 z), BladeBallEnabled (BallSpawner_Blade, 3 s, +1000 z) | `Mutator_ActorSpawner_TA` (TA:70048-70066) | P+R |
| BreakoutBallLockedIndex hu | BreakoutBallIndex2 (LockedDamageIndex 2) | `Ball_Breakout.SetLockedDamageIndex` (TA:70233-70237, 11772-11778) | P |
| LockedBreakoutTiles hu, BreakoutTileStartingState hu | (no options in the list; class `GameSettingCategory_TA`, AllowedMapSet Breakout) | `Mutator_Breakout_TA.Init` | dormant |
| MatchAdmin h | MatchCreatorAdminEnabled | `bMatchCreatorAdminEnabled` (TA:70590-70591) | C |
| DemoFX h | SilentDemoFX (DemoFXOverride PongBall FX) | `GameEvent.DemoFXOverride` (TA:70266-70267) | C |
| AudioRules h | HauntedAudio | `AudioSoundMode` (TA:70080-70085) | C |
| GameEventRules h | HauntedGameEventRules h, RugbyGameEventRules | StatFactory / EndRoundComponent (TA:70499-70508) | R |
| TritipModeRules h | Tritip | loadout override body_tritip (TA:70530-70554) | C/P (body) |
| Presets h | Custom, Moonball, DemolitionDerby, TimeWarp, Pinball, CubeBall, BeachBall, SnowDay, Rugby, InvertedBall, Territory (+27 `GameModeMutatorSettingPresets`) | `MutatorGameSettingPreset_TA.Presets` → `Archetypes.Mutators.MutatorPreset_*` | UI (forkB) |
| FreePlay, OnlineFreeplay, BoostOption, GoalResetOption, PhysicsLogPlayback, Bots, BotDifficulty, PlayerCount, Playlists, Clean, Lobby, Official | lobby/freeplay plumbing (forkB) | | C/R |

---

## 3. Simulation details

### 3.1 Game speed = world time dilation (SloMoGameSpeed, SloMoDistanceBall)

- **What is dilated:** `WorldInfo.TimeDilation`. UWorld::Tick computes `DeltaSeconds = clamp(dt_real · TimeDilation ·
  DemoPlayTimeDilation, 0.0005, 0.4)` and **the physics accumulator consumes DeltaSeconds** (notes/client-loop-timing.md
  LT-2/LT-3; EngineShare tick [N 0x140f54bd0]). The physics step stays **1/120 s of game time**
  (`1.0f / PhysicsFramerate`, `FUN_140f30970(physMgr, 1/120, gravityZ)` [N 0x140f55049]); only the number of steps per
  real second changes: **78 steps per real second at 0.65, 60 at 0.5**. Everything on game time slows with it:
  physics, Timers_X timers, `TimeSeconds`, boost consumption, pad respawns, respawn tickets, animations, camera
  smoothing (notes/camera-shakes.md item 9).
- **Exception — the match clock:** `Active.Tick` decrements `GameTimeRemaining` by `GetDesiredDeltaTime(dt) =
  GetRealDeltaTime(dt) = dt / MatchTimeDilation` (TA:4196, 1511-1512; forkB §1). Under SloMoGameSpeed the clock
  therefore runs in **real** seconds: (1/120)/0.65 s per tick, a 5:00 match = 23,400 ticks instead of 36,000. Time Warp
  changes only `WorldInfo.TimeDilation` (MatchTimeDilation stays 1), so its slow-downs also slow the clock.
- **When:** MatchTimeDilation (0.65) is pushed to WorldInfo at each `Countdown.BeginState` (TA:1858-1862, only when ≠ 1),
  after each goal (`PostGoalScored.EndState`, TA:4256-4260) and during the goal slow-mo as
  `Eval(ScoreSlomoCurve, t) · MatchTimeDilation` (TA:4270-4273; curve (0.125, 1), (0.225, 0.1875), (0.625, 1) [A]).
  Before the first countdown (lobby / WaitingForPlayers) the world runs at 1. `PrePodiumSpotlight` restores 1
  (TA:4331-4333). `GameInfo_TA.HandleTimeDilationChanged` forces anything > 1 back to 1 (TA:36650-36653).
- **SloMoDistanceBall ("Time Warp")** [S TA:12925-12946]: `BallSlomoComponent_TA.Tick` (a frame tick, every machine)
  — if the round is active: for each `Car_TA` within `BallSloMoRadius` 400 of the ball (`AllPawns(…, Location, 400)`)
  and, because BallSloMoDiffSpeed = 0, the cooldown branch: if `TimeSeconds > BallSloMoNext`:
  `BallSloMoNext = TimeSeconds + 0.5 + 2.0`, `TimeDilation = 0.5`, a 0.5 s timer then sets `TimeDilation = 1`.
  So: 0.5 game-seconds at half speed (1 real second), then at least 2 game-seconds at full speed. Only the first
  car found matters (the loop returns). Not combinable with SloMoGameSpeed (same category).
- **No effect on the step size or on any physics constant** [N]: nothing in the physics reads TimeDilation.

### 3.2 Ball scale, bounciness, gravity, world gravity

**Ball scale** (`SetBallScale`, TA:11147-11170): `StaticMesh.SetScale(s)` re-creates the Bullet body from the scaled
mesh (component scale replaces 1.0; the ball archetypes set no other scale [A]).
- Bullet sphere radius = `s·0.02·92 + 0.025 − 0.04` BU [N shape builder 0x14096c420 line 119: `Scale3D.X·0.02·r +
  0.025`; converter 0x14040ff70 case 1: `r·50·0.02 − 0.04`] = **92·s − 0.75 uu**:
  0.75 → 68.25, 0.9 → 82.05, 1.0 → 91.25, 1.3 → 118.85, 1.5 → 137.25, 2.25 → 206.25.
  For other sphere ball types use their authored radius instead of 92 (§3.4).
- Mass stays `Pawn.Mass` 30 (the RB init sets the archetype mass when > 0 [N 0x140f1cd50 → 0x140f35c70]); inertia
  = the Bullet shape's `calculateLocalInertia(mass)` [N 0x14097db50 end: shape vtable +0x40, then
  `btRigidBody::setMassProps` 0x1402c4e80] → sphere 0.4·m·r² with the new r.
- Gameplay values scale too: `Radius = CollisionComponent.Bounds.BoxExtent.Z` (95.49·s for the default ball;
  notes/match-rules-audit.md), `SpawnWidth = BoxExtent.Y`, `VisualRadius = 95·s`, touch cylinder (Radius, Radius);
  `EnableCCD(true)` (predictive contacts, notes/bullet-diff.md B5). Goal tests and anything using `Ball.Radius`
  use the scaled value.

**Ball bounciness** (`SetWorldBounceScale`, TA:11184-11191): `PhysMaterial = Override.NewInstance(); Parent =
Override; Restitution *= s; SetPhysMaterialOverride; ReInitRBPhys`. The body's restitution becomes
0.6·s (Physmat_Ball 0.6 [A]); friction unchanged. Contact restitution = **clamp(max(r_a, r_b), 0, 1)** and friction =
**clamp(f_a·f_b, −10, 10)** for every pair [N `gContactAddedCallback` 0x140410ff0; the friction scale constant at
0x142265e08 = 1.0]. Arena materials have restitution 0.3 [A, notes/physics-values.md], so the ball–arena bounce is
Low **0.3**, High **0.75**, Super **1.0** (1.05 clamped). Repeated calls compound (each multiplies the current override), e.g. `MagnusFutballLess` 0.5 then HighBounciness 1.25 → 0.375 (§1 item 3); a respawned ball starts again from the archetype material. Car–ball contacts: the engine already overrides them
(friction 2.0, restitution 0, notes/physics-values.md) — whether the game's car–ball override also ignores the ball's
restitution is not re-checked here [I: name "WorldBounceScale"].

**World gravity** (Mutator_Gravity_TA, TA:70515-70517): `WorldInfo.WorldGravityZ *= Gravity`.
- `AWorldInfo::GetGravityZ` [N 0x140821c00]: lazily `WorldGravityZ = bDisableGlobalGravityZ ? DefaultGravityZ :
  (GlobalGravityZ ≠ 0 ? GlobalGravityZ : DefaultGravityZ)` when 0; Default__WorldInfo: bDisableGlobalGravityZ true,
  DefaultGravityZ −650, RBPhysicsGravityScaling 1 [A]. The mutator multiplies the already-initialised −650 [I].
- Per frame the EngineShare tick computes `g = RBPhysicsGravityScaling · WorldInfo.GetGravityZ()`
  (0x140946250 → 0x140822900) and passes it to every physics step [N 0x140f55036-0x140f55049]; the step wrapper
  calls `world->setGravity((0, 0, g·0.02))` only when g changed (cached at scene+0x50) [N 0x14041f6f0], which sets
  every body's gravity (B12). Low −325, High −1137.5, Super −3250, Reverse +650 uu/s².
- Car-side uses of gravity [N]: the sticky force = `GetGravityZ() · (|up.z|·(ground − wall) + wall) ·
  (g ≤ 0 ? 1 : −1)` along −up, i.e. it scales with |g| and still pushes into the surface on reverse gravity
  [N 0x140ebb4f0, GA-13]; dodge Y flips when `GetGravityZ() > 0` (notes/physics-values.md "Dodge").

**Ball gravity** (Mutator_Ball BallGravityScale, TA:11171-11175): `Pawn_X.GravityScale = 1·s`.
- `APawn_X::GetGravityZ` = `AActor::GetGravityZ() · GravityScale` [N 0x140e2e870]; for PHYS_RigidBody
  `AActor::GetGravityZ` = `WorldInfo.RBPhysicsGravityScaling · PhysicsVolume->GetGravityZ` [N 0x140821b70].
- Each physics step, `RBActor_TA` PrePhysicsStep calls 0x140ebb9c0 [N]: if the body exists and is awake
  (component vtable +0x3d8): `delta = GetGravityZ() · BodyInstance.CustomGravityFactor (1.0 [A]) − g_world`; if
  |delta| > 1e-4: `AddForce((0, 0, delta), mode 5 = acceleration, "DeltaGrav")` → Bullet `applyCentralForce(delta·0.02·m)`
  [N 0x140eb27a0 → 0x140984560]. Net ball gravity = g_world·s (with world gravity mutators: multiplied).
  Not applied while the ball sleeps.
- The same function also applies PhysicsVolume fluid friction / ZoneVelocity (0 in soccar [I]).

### 3.3 Car–ball hits and the "Ball Physics" (BallWeight) options

`Car_TA.ApplyBallImpactForces` (TA:20227-20255; called from `OnHitBall` at most every other physics frame,
TA:20205-20226) with the ball's fields (defaults in brackets):
```
RelVel = Car.OldRBState.LinearVelocity − Ball.OldRBState.LinearVelocity; RelSpeed = min(|RelVel|, MaxRelativeSpeed [4600])
RelPos = Ball.OldRBState.Location − Car.OldRBState.Location; HitDir = Normal(RelPos)
HitDir.Z *= PushZScale [0.35] · (1 + 0.5 · B)        B = GetAdditionalCarBounceScaleZ(Car) (TA:11523-11528):
                                                      ReplicatedAddedCarBounceScale if > 0, else
                                                      AdditionalCarGroundBounceScaleZ [0] if Car.IsOnGround() and GroundNormal.Z > 0.1, else 0
HitDir = Normal(HitDir); if PushForwardScale [0.65] ≠ 1: HitDir −= Fwd·Dot(HitDir, Fwd)·(1 − 0.65); HitDir = Normal(HitDir)
HitDirXY = (HitDir.X, HitDir.Y, 0)
Impulse = HitDir · RelSpeed · PushFactorCurve(RelSpeed) · (1 + ReplicatedAddedCarBounceScale [0])
        + HitDirXY · AdditionalCarGroundBounceScaleXY [0]
Impulse += Impulse · Car.AddedBallForceMultiplier [0; items]
if Ball.BallHitSpinScale > 0:                         # Magnus options
    VelDir = Normal(RelVel); Off = −RelPos; Off −= VelDir·Dot(VelDir, Off); Off.Z *= PushZScale
    Off = Normal(Off) · Ball.Radius · BallHitSpinScale  # gameplay radius (95.49·scale)
    Ball.CollisionComponent.AddImpulse(Impulse, Ball.RBState.Location + Off, bVelChange = true)
else Ball.AddForce(Impulse, VelocityChange)
```
- `AddImpulse` with bVelChange: Bullet `applyImpulse(Impulse·0.02·m, Off·0.02)` → Δv = Impulse, Δω = I⁻¹(r × mΔv)
  [N mode 2 path of 0x140984560; the script's third argument = bVelChange, I].
- BallCarBounciness b → **impulse × (1 + b)**: Light ×1.75, Heavy ×0.1, SuperLight ×2.25, BeachBall-curve ×1.5,
  Futball-less ×1.5, Balloon ×4. Z scale: 0.35·(1 + b/2) only for b > 0 (0.48125, 0.56875, 0.4375, 0.4375, 0.875);
  Heavy keeps 0.35 (or the ground rule).
- `AdditionalCarGroundBounceScaleZ` 1.1 on Ball_BasketBall_Mutator and ball_luminousairplane [A] → Z scale 0.5425
  when the car is grounded (normal Z > 0.1) and b ≤ 0.
- `AdditionalCarGroundBounceScaleXY` (Balloon 1.2) adds at most 1.2 uu/s horizontally (not speed-scaled).

**Ball forces applied every physics step** — `Ball_TA` PrePhysicsStep [N 0x140f20590, `this` = actor+0x558]:
```
# GroundForce (puck balls): WorldContact = last step's merged world contact (actor+0x690: bHasContact, Normal +0x1c)
if GroundForce > 0 and WorldContact.bHasContact:
    k = clamp(WorldContact.Normal.Z + 1, 0, 1)
    AddForce(−WorldContact.Normal · GroundForce · k, mode 5 = acceleration)
# Magnus (v, ω = RBState linear / angular velocity at the start of the step, uu/s and rad/s)
if MagnusCoefficient ≠ 0 and MagnusMinSpeed² ≤ v.x² + v.y²:
    AddForce((ω × v) ⊙ MagnusCoefficient, mode 5 = acceleration)     # component-wise product
# Air resistance, per axis i
if AirResistance ≠ 0:
    target_i = sign(v_i) · min(|MinResistanceVelocity_i|, |v_i|)       # sign: v_i < 0 → −1 else +1   [N 0x140ef2ce0]
    v'_i = FInterpTo(v_i, target_i, dt, AirResistance_i)               # [N 0x14037f3f0] AirRes 0 → v; |target−v|² < 1e-8 → target;
                                                                       # else v + (target − v)·clamp(dt·AirRes, 0, 1)
    AddForce(v' − v, mode 2 = velocity change)
then RBActor_TA PrePhysicsStep [N 0x140f21850]: DeltaGrav (§3.2), then RollingFriction:
if RollingFriction > 0 and WorldContact.bHasContact:
    AddForce(−ω · RollingFriction · (|ω| / MaxAngularSpeed), mode 2 on the angular velocity)   # torque path FUN_140986500
```
- Mode semantics [N 0x140984560]: 0 force, 1 impulse, 2 velocity change (×mass), 5 acceleration (×mass, as a force
  integrated over the step); all ×0.02 to Bullet units.
- MagnusBall at 6 rad/s spin and 2000 uu/s: 0.015·6·2000 = 180 uu/s² sideways. BalloonBall air drag per 1/120 s step:
  X, Z ×(1 − 1.75/120), Y ×(1 − 2.25/120), on top of Bullet's linear damping 0.03.
- Max angular speed: `SetMaxAngularSpeed(12)` writes actor +0x564 and the Bullet body +0x36c (rad/s, no ×0.02)
  [N 0x140e73af0 / the RB init 0x140f1cd50].

### 3.4 Ball types (BallType)

All [A] from `Mutators_Balls_SF` (archetypes, meshes' `RB_BodySetup`, materials) unless marked. Bullet size: sphere =
authored r + 1.25 − 2 (§3.2); convex hull = the cooked hull points ×0.02, Bullet default margin 0.04 BU (2 uu) on top
[N converter 0x14040ff70 case 5 builds a `btConvexHullShape` from the cooked mesh, no margin call; I: no PhysX skin
on hulls]. Push curve "std" = 0→0.65, 500→0.65, 1400→0.6, 2300→0.55, 4600→0.3; PushZScale 0.35, PushForwardScale
0.65, MaxRelativeSpeed 4600, car–ball friction 2.0 unless noted. Mass 30, MaxLinearSpeed 6000, MaxAngularSpeed 6,
material Physmat_Ball (friction 0.35, restitution 0.6, linear damping 0.03) unless noted.

| Option | Class / mesh | Collision (authored → Bullet) | Differences from the default ball |
|---|---|---|---|
| (default) | Ball_TA / Ball_DefaultBall00 | sphere 92 → 91.25 | — |
| Ball_CubeBall | Ball_TA / Ball_CubeBall_SM | hull: cube ±76.6697 (8 points) + 2 margin | material Physmat_CubeBall: friction 1.0, restitution 0.6, **linear damping 0.1, angular damping 0.01**, density 0.05 (mass still 30) |
| Ball_SpookyCube h | Ball_TA / PumpkinCube2_SM | same cube hull | Physmat_CubeBall |
| Ball_Puck | Ball_TA / HockeyPuck_SM | hull: 32-gon prism r 112, z ±28 (64 points) + 2 margin | **mass 50**, Physmat_Puck: friction 0.1, **restitution 0.8**, damping 0.03; **GroundForce 700** (§3.3) — identical to the Snow Day archetype (Gameinfo_Hockey_SF) |
| Ball_PizzaPuck h | Ball_TA / PizzaCheezyPuck_SM | hull 56 points r ≈114, z −27.92…28.89 | mass 50, Physmat_Puck, GroundForce 700 |
| Ball_BasketBall | Ball_TA / Ball_Basketball_SM | sphere 97.1331 → 96.3831 | AdditionalCarGroundBounceScaleZ 1.1 (= the Hoops ball) |
| ball_luminousairplane h | Ball_TA | sphere 97.1331 → 96.3831 | AdditionalCarGroundBounceScaleZ 1.1 |
| Ball_Beachball | Ball_TA / Ball_Beachball_SM | sphere 92 → 91.25 | push curve 0→1.0, 500→0.75, 1400→0.6, 2300→0.55, 4600→0.3; **PushZScale 0.28** |
| Ball_Anniversary | Ball_TA / Ball_DefaultBall00 | sphere 92 → 91.25 | push curve 0→3.0, 500→1.5, 1400→1.0, 2300→0.9, 4600→0.5; **MaxRelativeSpeed 5500** |
| Ball_Ekin h, Ball_SpookyBalloon h | Ball_TA | sphere 92 → 91.25 | — |
| Ball_Strike | Ball_TA / Ball_Soccer_SM | sphere 93.6721 → 92.9221 | — |
| Ball_Shoe h | Ball_TA / ball_adidas_sm | sphere 94.5461 → 93.7961 | — |
| Ball_WorldCup h | Ball_TA / Ball_SphereGulp_SM | sphere 93.4871 → 92.7371 | — |
| Ball_Egg | Ball_TA / eggball_sm | hull 114 points, x/y ±85.5, z −111.14…108.53 | — |
| (Ball_Football: archetype exists in Mutators_Balls but no live option) | Ball_TA / Football_06_SM | hull 150 points, x −153.74…154.26, y/z ±95.70 | MaxAngularSpeed 20, RollingFriction 0.12 |
| Ball_Breakout | Ball_Breakout_TA / Ball_Breakout_SM | sphere 101.0065 → 100.2565 | Dropshot charge: car hits with relative speed > 500 add min(RelSpeed, 2500 − recent) to AbsorbedForce (recent decays 2500/s); DamageIndex = number of DamageForceLevels (2500, 11000) exceeded (TA:11702-11721, 11818-11826); no goal bonus |
| Ball_Score | Ball_Breakout_TA | sphere 101.0065 → 100.2565 | DamageForceLevels (10000, 44000); goal bonus `DamageIndexPointsToAward[DamageIndex − 1]` = +1 / +2 (TA:11837-11838) |
| Ball_Haunted h | Ball_Haunted_TA | sphere 101.0065 → 100.2565 | push curve std; seeking/trap logic (TA:12352-12530; SeekPositionRange ±3000, height 150–300, NextSeekTime 2–4 s, TrappedHoverHeight 200, VerticalSpeed 400, HitPhysicsDuration 1.5) — out of scope |
| Ball_Fire | Ball_Fire_TA (Ball_God family) / GodBall_RL_SM | sphere 92 → 91.25 | **MaxLinearSpeed 2100**, TargetSpeed 2100, TargetLowSpeedThreshold 50, WallBounceSpeed 0.3, WallBounceBackDistance 300, **VehicleDemolishMode VDM_Team** (demolishes per §3.6); seeks the closest car (`GetClosestVehicle`) with a ramp-up — seeking physics native, out of scope (TA:11987-12110) |

### 3.5 Jumps and dodge timer (CarJumps, DodgeInputTimer)

`Car_TA.OnJumpPressed` (TA:20440-20466) and helpers:
```
CanActivateJump   = !GameEvent.IsActive() || bUnlimitedJumps || MaxNumJumps > 0                      (TA:20471-20475)
ground jump       : CanActivateJump && JumpComponent && !bJumped && IsOnGround()                      (else, grounded: OnGroundedJumpFailed sound)
air activation    : HasAvailableDoubleJump() && !IsOnGround() && (!bJumped || IsWithinDodgeTimeWindow())
                    → bJumped = bDoubleJumped = true; Dodge if DodgeComponent.CanActivate() else DoubleJump
HasAvailableDoubleJump (TA:20476-20491):
    bUnlimitedJumps → true
    n = MaxNumJumps − 1
    !bDoubleJumped && n > 0 → true;   bDoubleJumped && n == 1 → false
    used = Dodge.LocalAirActivateCount + DoubleJump.LocalAirActivateCount
    GameEvent.IsActive() ? used < n : used < max(n, 1)
IsWithinDodgeTimeWindow = bUnlimitedTimeForDodge || min(InactiveTime of Jump, Dodge, DoubleJump) <= MaxTimeForDodge (TA:20499-20504)
LocalAirActivateCount: +1 when the component activates off the ground; 0 on landing (EventLanded) (TA:22066-22093)
```
- Default (MaxNumJumps 2): one air activation. Grounded (1): ground jump only. NoJumps (0): no jump while the game
  event is active (allowed in countdown/pre-match, since `!IsActive()`). 2/3/4DoubleJumps: 2/3/4 air activations,
  each needing the window measured from the **latest** jump/air activation (the min of the three inactive times).
- **A car that never jumped (drove off a ledge) has no window limit** (`!bJumped`).
- Dodge timer options set MaxTimeForDodge 2.0 / 3.0 or unlimited (default 1.25, Car_Default [A]).
- `SetMaxNumJumps` / `SetUnlimited*` run on the authority only; clients learn the result through replication [S].

### 3.6 Demolitions (Demolish)

Enums [A]: EDemolishTarget {Unset 0, OtherTeam 1, Everyone 2, None 3}; EDemolishSpeed {Unset 0, None 1, Low 2,
Medium 3, High 4, Supersonic 5}; EVehicleDemolishMode {VDM_None, VDM_Team, VDM_FFA}. Car_TA default: OtherTeam +
Supersonic [A]. `PhysicsConfig_TA.DemoSpeedThreshold` [2] 900, [3] 1300, [4] 1700 [A];
`GetSpeedRequiredForDemo`: Supersonic → 2200 − 100 = 2100, None → 0, else the table (TA:75215-75221).

**Car vs car** (`Car_TA.ApplyCarImpactForces`, each car of a contact runs it for the other car; TA:20293-20321):
```
if Role == Authority and DemolishSpeed == None and DemolishTarget != None
   and (DemolishTarget == Everyone or the two PRIs' teams differ):        # quick path: any contact
    Other.SetAttackerPRI(PRI); Other.Demolish(self); return             # no bump
… normal speed / approach tests, then ShouldDemolish (TA:20347-20406):
    DemolishTarget == None → false
    DemolishSpeed > None: (Supersonic requires bSupersonic) and |forward speed| ≥ GetSpeedRequiredForDemo,
                          time-of-impact sweep + cone checks (notes/physics-values.md)
    DemolishTarget == OtherTeam and same team → false
```
`Demolish` is queued to post-physics (QueueDemolish; GA-15), so both cars of an "on contact" pair are demolished
(each car's handler demolishes the other) [S/I]. The live Demolish category has no speed options; the
`Low/Med/HighDemoSpeed(FF)` archetypes exist but are not listed [A] (dormant).

**Ball vs car** (`Ball_TA.RecordCarHit`, TA:11302-11330; `ShouldDemolishVehicle` TA:104818-104820):
```
on every car touch (HitType_Car): OldTeam = HitTeamNum; HitTeamNum = car's team
if VehicleDemolishMode > VDM_None and Role == Authority and the car is not invulnerable to ball demos:
    if VehicleDemolishMode == VDM_FFA or (OldTeam != 255 and OldTeam != new HitTeamNum):
        Attacker = bAwardDemolishCredit ? last toucher from OldTeam (Touches[1..], GetAttackerPRI TA:104821)
                                         : (OldTeam != 255 ? the car itself (no credit) : None)
        car.DemolishFromSource(ball, EDS_Ball, Attacker); ++Attacker.BallDemolitions
```
VDM_Team: touching a ball whose last toucher was on the other team demolishes you; VDM_FFA: every touch demolishes
the toucher. The ball keeps its own physics (the touch impulse still applies) [I].

### 3.7 Boost (Boosters, BoosterStrengths, BoostRestriction, BoostPadRespawnTime)

`CarComponent_Boost_TA` fields [A layout]: BoostConsumptionRate +0x328 (0.333/s), MaxBoostAmount +0x32c (1.0),
StartBoostAmount +0x330, CurrentBoostAmount +0x338, **BoostModifier +0x33c** (class default 1.0), bRechargeGroundOnly
+0x348 bit1, bNoBoost bit2, BoostForce +0x34c (178500), RechargeRate +0x354, RechargeDelay +0x358,
UnlimitedBoostRefCount +0x35c, BoostRestriction +0x360; CarComponent_TA ActivityTime +0x298 (reset to 0 on every
activate/deactivate [N 0x140f35090]), MinInactiveTime +0x29c.

PrePhysicsStep [N 0x140f20bb0], per 1/120 s step:
```
if !bActive:
    if !bNoBoost and RechargeRate != 0 and ActivityTime > RechargeDelay and (!bRechargeGroundOnly or Car.IsOnGround()):
        SetBoostAmount(CurrentBoostAmount + dt·RechargeRate)                 # clamp [0, MaxBoostAmount] [N 0x140f352b0]
    if Input.bActivateBoost and CanActivate(): activate                      # CanActivate [N 0x140ecf9d0]: bDriving,
                                                                             #  inactive ≥ MinInactiveTime, amount > 0,
                                                                             #  !IsBoostRestricted, script check
else:
    used = dt·BoostConsumptionRate
    if UnlimitedBoostRefCount == 0: SetBoostAmount(Current − used)
    BoostUsed += used
    if Current == 0 or IsBoostRestricted(): deactivate                       # restriction cuts immediately
    elif !Input.bActivateBoost and CanDeactivate(): deactivate               # MinBoostTime 0.1
ApplyForces [N 0x140eb8a50]: F = Rotate(Car.RBState.Quaternion, (1,0,0)) · BoostForce · BoostModifier (AddForce, force mode)
IsBoostRestricted [N 0x140f11540]: GroundedOnly → !IsOnGround(); AerialOnly → IsOnGround(); IsOnGround = wheels in
contact ≥ NumWheelsForGrounded 3 [N Vehicle vtable +0x838 = 0x140f122e0]
```
- Recharge starts **strictly after** RechargeDelay seconds of the boost being off: ActivityTime is zeroed on every
  activate/deactivate [N 0x140f35090] and compared with `>` [N 0x140f20bb0]; that it advances by the physics dt each
  step (game time) is inferred [I] (consistent with GA-11's InactiveTime). Slow/Rapid: 2.0 s; the hidden OFP auto-refill: 1.5 s, ground only.
- `Car_TA.SetVehicleInput` still turns a held boost on the ground into throttle 1 when amount > 0, regardless of the
  AerialOnly restriction (`ActivateDriveThrottle` = amount > 0) [S TA:20423-20430, GA-1].
- Pads: NoBooster and UnlimitedBooster call `SetNoPickup()` on every `VehiclePickup_Boost_TA` (TA:70205-70208);
  `CanPickup` also refuses `bNoBoost` cars (TA:99168). Pad respawn time = RespawnDelay × RespawnDelayScale
  (TA:107661-107662).
- Dropshot's own boost (GameEvent_Breakout `Mutator_Booster_TA`: start 1.0, RechargeRate 0.1, delay 0.25 [A]) uses
  the same code, confirming the units (fraction of MaxBoostAmount per second).

### 3.8 Backwards mode (InputRestriction, hidden but usable)

`Vehicle_TA.InputRestriction` (+0x822) = EIR_BackwardsMode (1) on every vehicle (TA:70524-70529) [A/S]. Readers [N]:
- VehicleSim throttle/brake 0x140f24270 (the live copy of the notes' "Throttle/brake" function): with bDriving and no
  handbrake, `throttle > 0.01` → if forward speed < −25 (rolling backwards): brake = OppositeBrakeFactor as usual;
  otherwise, **in backwards mode only**, throttle := 0 and brake := (|forward speed| ≥ 25 ? IdleBrakeFactor 0.15 : 1.0),
  i.e. pressing forward coasts/stops the car instead of driving it. Reverse throttle is unchanged.
- `Vehicle_TA.UpdateRestrictedInput` (native `execUpdateRestrictedInput` 0x140e83ef0) and the replicated-input packing
  0x140f36790: `DodgeForward > 0 → −DodgeForward` (forward dodges become backward), and for AI-controlled vehicles
  (`AIController` +0x828 set) `Throttle > 0 → −Throttle`.
- Boost still pushes forward (ApplyForces is unaffected) [N 0x140eb8a50].

---

## 4. Clone requirements

### 4.1 What is per match, per object, per tick

| Data | Lifetime | Where it must live |
|---|---|---|
| World gravity Z (uu/s²) | match (Init) | MutatorConfig (already: `gravity`) |
| Time dilation (MatchTimeDilation; current TimeDilation incl. time-warp and goal slow-mo) | match / per tick | server game state; **sent to clients with the tick it starts** (it changes tick pacing, not physics) |
| Ball archetype (shape, mass, material, push curve/Z/forward/max-rel-speed, GroundForce, RollingFriction, MaxLinear/AngularSpeed, special class) | match | MutatorConfig → ball setup |
| Ball modifiers: scale, gravity scale, max-speed scale, world-bounce scale, added car-bounce scale, ground-bounce XY/Z, Magnus C / min speed, hit-spin scale, air resistance / min resistance velocity, max angular speed | match (items can change some per ball) | MutatorConfig; per-ball state if Rumble is supported |
| Per car: BoostModifier, RechargeRate/Delay/GroundOnly, BoostRestriction, bNoBoost, UnlimitedBoostRefCount (+ the 0.1 s enable timer), MaxNumJumps, bUnlimitedJumps, MaxTimeForDodge, bUnlimitedTimeForDodge, DemolishTarget, DemolishSpeed, GravityScale | per car (set at spawn; items change some) | car config at spawn + **CarState** for the dynamic ones (refcount/timer, item overrides) |
| Per car per tick: boost amount, boost active, **ActivityTime** (recharge delay, MinBoostTime, MinInactiveTime), Dodge/DoubleJump **LocalAirActivateCount**, time since last jump/air activation (InactiveTime ×3), bJumped/bDoubleJumped | per tick | CarState (snapshot) |
| Per ball per tick: **WorldContact (bHasContact, Normal) from the previous step** (GroundForce, RollingFriction), sleeping state (DeltaGrav skipped), HitTeamNum + last touches (ball demos), Breakout DamageIndex/AbsorbedForce/ForceAccumRecent/LastDamageTime/LastCarTouch | per tick | BallState (snapshot) |
| Pads: RespawnDelayScale; disabled flag (NoBooster/Unlimited) | match | MutatorConfig / pad config |
| BallSlomo: BallSloMoNext, restore timer | per tick | server game state (+ TimeDilation broadcast) |
| Respawn delay (1/2/3 s), demo-spawn-selection allowed | match | MutatorConfig (respawnDelay exists) |
| Match rules (time, score, overtime, max time, series, goal delay, scoring mutators, multi-ball) | match | server (forkB) |

### 4.2 Engine changes (new MutatorConfig fields / behaviour)
1. `ballGravityScale` (DeltaGrav as an acceleration force each step, only while the ball is awake; total = g·s).
2. Sticky force from |gravity| (GA-13) and dodge-Y flip for g > 0.
3. `ballMaxAngSpeed` (cap + quantiser; today the constant `BALL_MAX_ANG_SPEED`).
4. Ball restitution combine: clamp(max(a, b), 0, 1) (today unclamped max → 1.05 possible).
5. Car-ball hit: `addedCarBounceScale` (impulse ×(1+b) — today `ballHitExtraForceScale` covers this part), the Z-scale
   term 0.35·(1 + 0.5·B) with B's rules, `groundBounceScaleXY`, `groundBounceScaleZ` (generalises the Hoops special
   case), `hitSpinScale` (off-centre velocity-change impulse using the gameplay radius), per-ball push curve,
   PushZScale, PushForwardScale, MaxRelativeSpeed.
6. Ball step forces: Magnus (C, min speed), air resistance (per-axis FInterpTo), GroundForce (from last step's world
   contact), RollingFriction (football; dormant in the live list).
7. Ball shapes: sphere with any authored radius (r + 1.25 − 2), scaled (92s − 0.75); convex hulls (cube, puck,
   pizza puck, egg, football) from the cooked points + 0.04 BU margin; per-type material (friction, restitution,
   linear and **angular** damping), mass.
8. Boost: `boostModifier` (scale the boost force only; keep the 66.67 air throttle separate — the engine's
   `boostAccelAir − THROTTLE_AIR_ACCEL` split already allows this), `boostRestriction` (none/grounded/aerial with
   immediate cut-off), `rechargeGroundOnly`, recharge from ActivityTime > delay (strict), `noBoost` (amount 0, cannot
   activate, cannot pick up), unlimited = refcount semantics with the 0.1 s delayed fill, pads disabled flag.
9. Jumps: `maxNumJumps` (0 … 5, default 2), `unlimitedJumps`, per-car air-activation counter, `maxTimeForDodge`
   (default 1.25), `unlimitedDodgeTime`; the "not active → may jump" exception for NoJumps.
10. Demolish: `demolishTarget` {OtherTeam, Everyone, None} × `demolishSpeed` {None, Low 900, Medium 1300, High 1700,
    Supersonic 2100}; `ballDemolishMode` {None, Team, FFA} + `awardDemolishCredit`.
11. Multiple balls (MultiBall) — the engine has one ball.
12. Time dilation: the engine stays fixed-step; the server/clients pace ticks at (1/120)/D real seconds.

### 4.3 Snapshot / network rules for determinism
- All match-constant values go in the arena snapshot's MutatorConfig (it is serialized already) **and** in the match
  start message, so a client can build the same arena; changing them mid-match is a resync.
- New per-tick fields (boost ActivityTime, air-activation counts, inactive times, refcount + pending timer, ball
  world-contact normal, Breakout charge state) go in CarState / BallState serialization (the engine's field-count
  check will reject old snapshots — bump the version).
- TimeDilation changes are server events keyed to a tick (time warp, goal slow-mo already handled by the server as
  GS-2); the physics result does not depend on them, only the wall-clock schedule.
- Use tick counts, not float seconds, for every timer (0.1 s unlimited fill = 12 ticks, respawn 1/2/3 s = 120/240/360,
  recharge delay 2.0 s → ActivityTime > 2.0 i.e. from the 241st tick off). Timers_X / TimeSeconds in the game are
  float game seconds; tick counting reproduces them except at float-rounding boundaries [I].
- Random choices (Rumble pools, respawn spot) need a seeded, snapshotted RNG (forkA §4, GA-18).

---

## 5. Gap list vs the current engine / protocol / server (read-only review)

Engine: `engine/rocketsim/src/Sim/MutatorConfig/MutatorConfig.h` fields gravity, carMass, carWorldFriction,
carWorldRestitution, ballMass, ballMaxSpeed, ballDrag, ballWorldFriction, ballWorldRestitution, jumpAccel,
jumpImmediateForce, boostAccelGround, boostAccelAir, boostUsedPerSecond, respawnDelay, bumpCooldownTime,
boostPadCooldown_Big/Small, carSpawnBoostAmount, ballHitExtraForceScale, bumpForceScale, ballRadius,
unlimitedFlips, unlimitedDoubleJumps, rechargeBoostEnabled/PerSecond/Delay, demoMode {NORMAL, ON_CONTACT, DISABLED},
enableTeamDemos, goalBaseThresholdY. Protocol (`protocol/README.md`) and server (`server/src`) carry **no mutator
data**; the wasm build exposes only `setUnlimitedBoost` / `setDemolitions` (`engine/wasm/bindings.cpp:241-257`).

| # | Mutator | Engine today | Gap / disagreement with the exe |
|---|---|---|---|
| GAP-1 | Gravity | `gravity` ✓ (world) | Sticky force uses the constant `GRAVITY_Z` (GA-13); dodge-Y flip for reverse gravity missing |
| GAP-2 | Ball gravity | — | No per-body gravity scale (DeltaGrav, awake only) |
| GAP-3 | Ball max speed | `ballMaxSpeed` ✓ | Max angular speed fixed at `BALL_MAX_ANG_SPEED` (cap and quantiser) — MagnusBall needs 12 |
| GAP-4 | Ball size | `ballRadius` ✓ (sphere) | Callers must use 92·s − 0.75 (not 91.25·s); gameplay radius 95.49·s for goal/encroach/hit-spin uses; inertia ✓ (calculateLocalInertia) |
| GAP-5 | Ball bounciness | `ballWorldRestitution` ✓ | Combine is Bullet's static max without the [0, 1] clamp → SuperBounciness 1.05 vs game 1.0 |
| GAP-6 | Ball Physics (weight) | `ballHitExtraForceScale` ≈ (1 + b) | Missing: Z-scale term, ground XY term, hit-spin offset impulse, Magnus, air resistance, max-angular-speed |
| GAP-7 | Ball types | sphere only (+ Snow Day hull) | Cube/egg/football hulls, per-type push curves (Beachball, Anniversary), PushZScale 0.28, MaxRelativeSpeed 5500, cube material (angular damping 0.01, linear 0.1, friction 1.0), Breakout/Score charge on soccar maps, Fire/Haunted seeking |
| GAP-8 | **Snow Day puck constants disagree with the exe** | `Snowday::PUCK_RADIUS` 114.25, `PUCK_HEIGHT` 62.5, 20 points, `PUCK_RESTITUTION` 0.3, `PUCK_GROUND_STICK_FORCE` 70 (`RLConst.h:224-233`) | Exe (Ball_Puck, Snow Day and mutator alike): 32-gon hull r 112, z ±28 + 2 uu margin; restitution 0.8 (contact max with 0.3 → 0.8); GroundForce 700 uu/s² acceleration × clamp(n.z + 1, 0, 1) along −n from last step's world contact; friction 0.1, mass 50 ✓ |
| GAP-9 | Boost strength | `boostAccelGround/Air` (constants) | No modifier; set ground = 991.67·k and air = 991.67·k + 66.67 (air throttle unscaled) |
| GAP-10 | Boost amount | `rechargeBoost*` ✓, `SetUnlimitedBoost` binding | Unlimited: game fills after 0.1 s and **disables pads** (engine keeps pads); NoBoost absent; recharge "≥ delay since boosting" vs game "ActivityTime > delay" (strict, from deactivation); no ground-only; default `rechargeBoostDelay` 0.25 / 10 per s are Dropshot's (✓ for Dropshot) |
| GAP-11 | Boost restriction | — | Aerial-only (hidden) absent |
| GAP-12 | Pad respawn scale | `boostPadCooldown_Big/Small` ✓ | set 10·k / 4·k; pads must be disable-able |
| GAP-13 | Jumps | `unlimitedFlips`, `unlimitedDoubleJumps` (RocketSim semantics: unlimited per kind) | Game has one counter over dodges + double jumps (MaxNumJumps − 1), NoJumps/Grounded, and a single bUnlimitedJumps; these two fields don't map |
| GAP-14 | Dodge timer | constant `DOUBLEJUMP_MAX_DELAY` 1.25 | needs `maxTimeForDodge` / unlimited |
| GAP-15 | Demolish | `demoMode` NORMAL/ON_CONTACT/DISABLED + `enableTeamDemos` ✓ covers NoDemolish, DemolishAll, AlwaysDemolishOpposing, AlwaysDemolish | Ball demos (VDM Team/FFA, credit) absent; the game's on-contact path also requires authority (server) — the client prediction must not demolish (as RV-112) |
| GAP-16 | Respawn time | `respawnDelay` ✓, prespawn only when ≥ 3 ✓ (`RLConst.h:171`) | matches (`bAllowDemoSpawnSelection` cleared below 3) |
| GAP-17 | Game speed | — | No time dilation in server tick pacing / client loop; goal slow-mo must multiply by MatchTimeDilation |
| GAP-18 | Multi-ball | single `ball` | needs N balls (+ every ball-level mutator per ball) |
| GAP-19 | Protocol / server | no mutator config | needs a match-config message (all match-constant fields) and TimeDilation events |
| GAP-20 | Snapshot | MutatorConfig serialized ✓ | new CarState/BallState fields (§4.1) |
| GAP-21 | Boost/consumption constants | `BOOST_USED_PER_SECOND` 100/3, spawn 100/3 | game 0.333·100 = 33.3 (GA-10, known) |
| GAP-22 | Backwards mode (hidden) | — | forward throttle → coast/brake, forward dodges negated (§3.8) |
| GAP-23 | Server match clock | `MATCH_TICKS` const 300·120, integer tick clock (`server/src/game.rs:53-56, 586-603`) | needs GameTime / unlimited from config and the game's f32 clock decremented by (1/120)/MatchTimeDilation (forkB §1) |
| GAP-24 | Server score | `score: [u8; 2]` (`server/src/protocol.rs:83`) | 10-point goals, possession, unlimited time can exceed 255 → u16; MaxScore check after every score change (forkB §2) |
| GAP-25 | Server overtime | counts up only (`game.rs:592-594`) | 5-minute count-down overtime with first-score / random tiebreak and the 90 s ground timeout (forkB §3) |
| GAP-26 | DisableGoalDelay round | — | ball-only respawn without car reset, pads reset, clock continues (forkB §7) |

---

## 6. Open questions
1. `Mutator_Gravity_TA.Init` multiplies `WorldGravityZ`, which `AWorldInfo::GetGravityZ` initialises lazily [N 0x140821c00];
   the mutator only works if GetGravityZ ran before Init (it runs every frame once the physics scene ticks). The order at
   match start was not traced [I]. Live check: LowGravity private match, ball free-fall −325 uu/s².
2. Car–ball contact restitution under BallBounciness: does the game's car–ball override (friction 2.0) also ignore the
   ball material's restitution, as the engine does (restitution 0)? Not traced.
3. Convex hulls: no PhysX skin, Bullet default margin 0.04 BU, inertia = Bullet 2.82
   `btPolyhedralConvexShape::calculateLocalInertia` (AABB incl. margin, plus margin again) — inferred from the converter
   (case 5) and the mass update [N 0x14097db50], not executed.
4. `AddImpulse(…, true)` = bVelChange: the native reads four parameters (impulse, position, bone, bVelChange)
   [N 0x140981ff0 → vtable +0x378]; the script decompiler dropped the empty bone argument. High confidence.
5. Time Warp: `AllPawns` radius boundary (≤ or <) and that the component's frame tick should become a per-tick server
   check in the clone [I].
6. Rumble: the BallFreeze pool entries that point at a StatEvent (forkA note F) — empty draws at runtime? Live check.
7. ORS-dispatched pieces (static `Mutator_RespawnTime_TA.Mutate`, `MaxTimeSystem_TA.StartMaxTimer`): native dispatch and
   whether MaxTime counts real or game time (forkB).
8. Ball_Fire / Ball_Haunted seeking physics, territory self-destruct natives (0x140e85a80, 0x140e85b60, 0x140e85bf0,
   0x140f20f10) and the item pickups' ApplyForces natives (forkA list) — separate specs.

---

## 7. Summary (MUT-n) — confidence H high / M medium / L low

| # | Finding | Tags | Conf |
|---|---|---|---|
| MUT-1 | 65 categories (live order fixed by `GameSettings_Default.GameSettingCategories`); 24 shown in the UI; option → archetype `MutatorPackage.Name` in Mutators_SF / Mutators_Balls_SF / Mutators_Items_SF; one mutator per category; applied in category order; per-object effects re-applied at every car/ball spawn | A,S,N | H |
| MUT-2 | `default.X` in mutator scripts reads the actor's archetype (`execDefaultVariable` 0x14034b350) → scales are relative to the ball/car archetype (6000, 1.0, 180) | N | H |
| MUT-3 | Game speed: Slo-Mo 0.65 = `WorldInfo.TimeDilation` from each countdown; the physics step stays 1/120 game-s (78 steps per real s); goal slow-mo × 0.65; podium 1; the **match clock runs in real seconds** (dt / MatchTimeDilation) | S,N | H |
| MUT-4 | Time Warp: per ball, a car within 400 uu → TimeDilation 0.5 for 0.5 game-s, then ≥ 2 s cooldown, restores to 1 | S | H |
| MUT-5 | World gravity mutators multiply `WorldGravityZ`: −325 / −1137.5 / −3250 / +650 (reverse, hidden); pushed to Bullet only when changed; sticky force scales with \|g\| and keeps pushing into surfaces on reverse gravity; dodge Y flips for g > 0 | A,S,N | H (Init timing M) |
| MUT-6 | Ball gravity ×0.5 / 2 / 5 = per-step "DeltaGrav" acceleration (g·(s − 1)), only while the ball is awake | S,N | H |
| MUT-7 | Ball max speed caps 1500 / 9000 / 15000 (actor + Bullet); angular cap untouched unless BallMaxAngularSpeed (12 for Magnus options) | S,N | H |
| MUT-8 | Ball size: Bullet sphere 92·s − 0.75 = 68.25 / 118.85 / 137.25 / 206.25 uu; mass 30; inertia from the new shape; gameplay radius, spawn width, visual radius and touch cylinder scale | S,N | H |
| MUT-9 | Bounciness: restitution 0.6·s; contact restitution = clamp(max(a, b), 0, 1), friction = clamp(a·b, ±10) for all pairs → ball–arena 0.3 / 0.75 / 1.0; compounding with other bounce-scale mutators | S,N | H (car–ball part M) |
| MUT-10 | "Ball Physics" (BallWeight) is not mass: car-hit impulse ×(1 + b) (Light 1.75, Heavy 0.1, SuperLight 2.25, …), Z-scale 0.35·(1 + b/2) for b > 0; Magnus options add (ω×v)⊙C acceleration, hit-spin off-centre impulses and ω cap 12; Balloon adds per-axis air drag (FInterpTo) and a +1.2 XY hit term | S,N,A | H |
| MUT-11 | Ball types: exact shapes (sphere radii 92 / 93.4871 / 93.6721 / 94.5461 / 97.1331 / 101.0065 + 1.25 − 2; hulls cube ±76.67, puck 32-gon r 112 ±28, pizza, egg, football + 0.04 BU margin), cube material (friction 1, damping 0.1 / 0.01), puck mass 50, restitution 0.8, GroundForce 700; Beachball / Anniversary push curves; Breakout/Score charge rules; Fire ball = VDM_Team seeking ball (out of scope) | A,S,N | H (hull margin/inertia M) |
| MUT-12 | Boost strength = `BoostModifier` × BoostForce 178500 (991.67·k uu/s²); air throttle unscaled | S,N | H |
| MUT-13 | Boost amount: NoBoost (0, pads off), Unlimited (refcount, full after 0.1 s, pads off), Recharge slow/fast 6.66 / 16.66 per s after the boost has been off > 2.0 s (ActivityTime) | S,N | H |
| MUT-14 | Aerial-only restriction (hidden): boost refused/cut while ≥ 3 wheels touch; ground boost button still gives throttle 1 | N,S | H |
| MUT-15 | Pad respawn = 10 s / 4 s × 2, 1.5, 0.667, 0.5, 0.2, 0.1 (f32 products) | A,S | H |
| MUT-16 | Jumps: one counter for dodges + double jumps (MaxNumJumps − 1); NoJumps blocks the ground jump only while the event is active; window = min inactive time of the three components ≤ MaxTimeForDodge (1.25 / 2 / 3 / ∞); no window if the car never jumped | S | H |
| MUT-17 | Demolish: Target {OtherTeam, Everyone, None} × Speed {None, Low 900, Med 1300, High 1700, Supersonic 2100}; "on contact" options demolish both cars of a contact without bumps, authority only; ball demos: VDM_Team (touching a ball last touched by the other team) / VDM_FFA (any touch), credit to the last opposing toucher | A,S | H |
| MUT-18 | Respawn 1 / 2 s (no spawn selection below 3 s); DisableGoalDelay = goal without post-goal phase, ball-only respawn, cars not reset, pads reset, clock runs | S | H |
| MUT-19 | Backwards mode (hidden): forward throttle → coast/brake, forward dodges negated, bots' throttle negated | N | H |
| MUT-20 | Rules (forkB): clock, MaxScore ≥, 5-min overtime + tiebreaks, max-time limit tiebreak (leader → shots → random), series ceil(N/2), multi-ball spawn x = ±(W + 50) steps, goal/aerial/assist/demolish/possession/keep-up scoring | S,A | H/M |
| MUT-21 | Rumble (forkA): 14 options, give rates 10 / 20 / 5 / 7 / 1 s, cycle pools of ceil(weight) copies shuffled with Rand, a 1 s check timer on match time; three pools reference a StatEvent instead of the freeze pickup (empty draws) | A,S | H (empty draw M) |
| MUT-22 | Engine gaps: GAP-1…26 (§5); the engine's Snow Day puck constants disagree with the exe (GAP-8); the server's clock, score width and overtime need config (GAP-23…25); protocol carries no mutators (GAP-19) | code review | H |

---

# Appendix A: match rules (forkB)

## Mutators, part B: match rules (live build 2026-10-06)

Fork of MUT1 (static session). Scope: the rule categories of the private-match mutator table (clock, score, overtime,
series, balls, respawn, pads, score alterations, game-mode rules, hidden/lobby categories) and how mutators are applied.
Physics categories (ball, boost, car, gravity, game speed, demolish) are in MUT1's main spec.

Tags: [A] package data (TAGame.upk `Archetypes.Online.GameSettings.GameSettings_Default.*`, `Mutators_SF`,
`Archetypes.Mutators.*`), [S] script (`out/bsim/work/tagame_live_all.txt`, cited TA:line; ProjectX dump PX:line),
[N] native (name/address from `out/bsim/live-20261006/natives.csv`, not decompiled here), [I] inferred.
Confidence: H high, M medium, L low. Option names are the setting names (= GameTags values) and loc keys, never label text.

Local working files (git-ignored): `forkB/presets_raw.txt` (preset dump), `forkB/strarrays.py` (raw FString-array
parser), MUT1's `work/gs_small.txt`, `work/mutators_sf_dump.txt`.

---

### 0. How a mutator gets into a match

| # | Fact | Tag | Conf |
|---|---|---|---|
| R-0.1 | **URL format:** `?GameTags=<Setting>,<Setting>,...` — a comma list of setting names (e.g. `Start Stadium_P?game=...?Playtest?GameTags=BotsEasy,PlayerCount6`, TA:43197; `CreateOnlineGameSettings('?GameTags=' $ Settings.GameTags)`, PX:9496; the private-match UI does `SetGameTag(Category.InternalName, SettingName)` and `''` for the default, TA:49264-49266). Parsing is native (`UOnlineGameSettings_X::execUpdateFromURL` 0x14066dfc0, `execSetGameTag` 0x140de0820, `execHasSetting` 0x140de06d0, `execGetActiveGameSettings` 0x140de05e0) | S,N | H |
| R-0.2 | **Category list** (live order) = `GameSettings_Default.GameSettingCategories`: Clean, Lobby, Official, Bots, BotDifficulty, Playlists, PlayerCount, Presets, FreePlay, AerialTargets, SpawnTargets, OnlineFreeplay, BoostOption, GoalResetOption, PhysicsLogPlayback, GameTimes, GameScores, OvertimeRules, MaxTimeRules, MatchGames, GameSpeed, BallMaxSpeed, BallType, BallWeight, BallScale, BallBounciness, BallGravity, MultiBall, Boosters, BoostPadRespawnTime, Items, ItemGiveRate, Attachments, CarMaxSpeed, BoosterStrengths, Gravity, Demolish, RespawnTime, AudioRules, GameEventRules, TritipModeRules, CarJumps, DodgeInputTimer, TerritoryRules, LockedBreakoutTiles, BreakoutTileStartingState, BreakoutBallLockedIndex, GoalScore, AerialGoalScore, BackwardsGoalScore, BicycleGoalScore, LongGoalScore, TurtleGoalScore, AssistScore, DemolishScore, PossessionRules, GoalScoringRules, FireBallObstacle, BoostRestriction, InputRestriction, SpawnPointRules, KeepUpRules, MatchAdmin, DemoFX, GoalShields (65) | A | H |
| R-0.3 | **Setting → mutator archetype:** `MutatorGameSetting_TA.GetMutator() = DynamicLoadObject(MutatorPackage $ '.' $ Name, Mutator_TA)` (TA:70742-70747). `MutatorPackage` default `Mutators.Mutators.Mutators` (package `Mutators_SF`); BallType settings use `Mutators_Balls.Mutators.Mutators_Balls`, Items use `Mutators_Items.Mutators.Mutators_Items`. One setting has no archetype: `GoalResetOption.ResetStandardOFP` (load fails → no mutator, i.e. "standard") | A,S | H |
| R-0.4 | **InitMutators** (`GameEvent_TA.Init` → `InitMutators`, before `OnInit`, TA:849-855). `GameEvent_Soccar_TA.InitMutators` first instantiates `DefaultSubRules` (TA:2588-2593). Then `GameEvent_TA.InitMutators` (TA:877; tail decoded by hand from raw bytes): (1) for each archetype `DefaultMutators` entry **not** listed in its `ProhitibitedDefaultMatchTypes` for the current `MatchTypeClass` → `NewInstance(self)`, append to `Mutators`; (2) `GetOnlineGameSettingsMutators()` (active game settings → `MutatorGameSetting_TA` → `GetMutator()`, non-None) → each `NewInstance(self)` appended (`__GameEvent_TA__InitMutators_0x1`, TA:32757); (3) for each mutator: `GameMetrics.PlayMutator(Name)` if `bRecordMetrics`, then `Mutator.Init(self)` (virtual `Init`, name idx 0x6739) | S | H (order within (2): settings order from the native `GetActiveGameSettings`, assumed category order — M) |
| R-0.5 | **MutateObject** is called for every mutator on: every `VehiclePickup_TA` at `GameEvent.Init` (TA:858-862); every car right after `SpawnCar` in `RestartPlayer` (TA:1134-1135; kickoff and every demolition respawn) and every car component as it is added (`HandleCarAddCarComponent`, TA:1514); every game ball in `AddGameBall` (TA:3035-3039, i.e. every spawn/respawn); the temporary ball of `CalculateBallDimensions` (TA:3073); item dispensers (TA:34322); the freeplay session manager (TA:30261). So per-object mutator effects are **re-applied at each spawn** | S | H |
| R-0.6 | **Composition:** each `Mutator_*_TA.MutateObject` writes a field only when its value is set (`> 0`, `!= 0`, enum `> 0`), so mutators of different categories compose; if two touch the same field, the later one in `Mutators` wins (e.g. `MagnusFutballLess` sets BallScale 0.9 and `BallScale` comes after `BallWeight` in R-0.2) | S,I | M |
| R-0.7 | `ProhitibitedDefaultMatchTypes`: `IsInProhitibitedDefaultMatchTypes(MT) = ProhitibitedDefaultMatchTypes.Find(MT)` (TA:70046, hand/STAT1 decoder). Every `Max*` archetype lists `MatchType_Private_TA` [A]. It filters **only `DefaultMutators`** (a playlist's built-in score cap is dropped in private matches); a user-selected `Max*` tag is never filtered | A,S | H |
| R-0.8 | `MutatorGroupID` (on `MutatorGameSetting_TA`): UI tab only (`GFxData_Mutators_TA.GetMutatorsByGroupID`, TA:49272; loc keys `MutatorGroupLabel_0/1/2`). Group 2 = ball settings (BallBounciness/Gravity/MaxSpeed/Scale/Type/Weight, MultiBall, BreakoutBallLockedIndex); 1 = car/world (Boosters, BoosterStrengths, BoostPadRespawnTime, BoostRestriction, CarJumps, Demolish, DodgeInputTimer, GameSpeed, Gravity, InputRestriction, Items, RespawnTime, TerritoryEnabled); 0 (unset) = match | A,S | H |
| R-0.9 | UI limits (`MutatorConfig_TA` CDO): `MaxAllowedMutators` 18, `MaxPreviewMutators` 8 — only copied into the menu data (TA:48758-48759), not enforced by the game event | A,S | H |
| R-0.10 | Constraints (raw FString arrays; props.py misparses them): `BoosterStrengths.*` and `BoostPadRespawnTime.*` have `DisallowedWithMutators=['NoBooster']`; `BallScale.GiantBall` `DisallowedWithMutators=['Ball_Basketball']`; `Boosters.NoBooster` `MutatorCategoriesToDisable=['BoosterStrengths','BoostPadRespawnTime']`. No `RequiresMutators` anywhere. Entries may also be `Maps.<map>` or `CategoryDefault.<category>`; checked by the menu (`IsValidSetting` TA:49140, `UpdateCategoriesDisabledByMutator` TA:49228) | A,S | H |
| R-0.11 | `bHidden` (category or setting) hides it in the menu; `bUseableWhileHidden` keeps a hidden category usable via tags/presets. `GameSettingCategory_TA.AllowedMapSet` gates by map (TerritoryRules → `MapList.Sets.Territory`; Locked/StartingState Breakout → `MapList.Sets.Breakout`; TA:37717-37731) | A,S | H |

**Clone:** the match config = the set of active setting names (one per category) → resolved at match creation into a
`MatchRules` struct (below) + the physics `MutatorConfig` (MUT1). Send the setting-name list to clients once (reliable),
not per tick; both sides derive the same structs. Per-object effects must be applied at every spawn (cars, balls).

---

### 1. Match length — `GameTimes`

| Option | Archetype value | Target | Notes |
|---|---|---|---|
| (default) loc `MutatorSettingDefault_GameTimes` | — | `GameEvent_Soccar_TA.GameTime` = 300 (archetype `GameEvent_Soccar`) | |
| `1Minute` / `2Minutes` / `3Minutes` / `4Minutes` (all `bHidden`) | `GameTime` 60/120/180/240 | `Mutator_Match_TA` → `SoccarGame.GameTime` | |
| `10Minutes`, `20Minutes` | 600, 1200 | same | |
| `UnlimitedTime` | `bUnlimitedTime` true | `SoccarGame.bUnlimitedTime` | |

`Mutator_Match_TA.Init` (TA:70555-70592): `if bUnlimitedTime: SoccarGame.bUnlimitedTime = true`; `if GameTime > 0:
SoccarGame.GameTime = GameTime`; `if FinishTime > 0: SoccarGame.FinishTime = FinishTime` (no archetype sets it; archetype
FinishTime 60 = the `Finished` state length, TA:1904-1907). [A][S] H

**Clock rules** (TA:4187-4227, 2765-2770, 3590-3593; full flow in `notes/match-rules-audit.md`):
- `ResetToDefaultTime`: `GameTimeRemaining = bUnlimitedTime ? 0 : GameTime` (float), `SecondsRemaining = int` copy.
- `Active.Tick`: if `CanUpdateGameTime` (`bBallHasBeenHit && (ShouldCountUp() || GameTimeRemaining > 0)`):
  `GameTimeRemaining += GetDesiredDeltaTime(dt) * (ShouldCountUp ? +1 : −1)`; `SecondsRemaining = int(t) + 1`;
  `t <= 0 → WaitForEndRound` (t = 0, attach `EndRoundComponent`: the 0:00 ball-on-ground rule).
- `ShouldCountUp = (bOverTime && OvertimeComponent == None) || bUnlimitedTime` (TA:3592).
- **`GetDesiredDeltaTime = GetRealDeltaTime(dt) = dt / MatchTimeDilation`** (TA:4196, 1511). The clock therefore runs
  in *real* seconds when the GameSpeed mutator sets `MatchTimeDilation` (Slo-Mo 0.65): per physics tick the clock moves
  (1/120)/0.65 s; a 5:00 match = 23 400 ticks instead of 36 000. TimeWarp (`SloMoDistanceBall`) changes only
  `WorldInfo.TimeDilation` (MatchTimeDilation stays 1), so its slowdowns also slow the clock. [S] H
- `HasWinner` (TA:2965): `(MaxScore > 0 && leader.Score >= MaxScore)` or `((t <= 0 || bOverTime) && !bUnlimitedTime && leader)` or `bForfeit`.
  **Unlimited time: the match only ends by MaxScore or forfeit**; no 0:00, no overtime. [S] H
- `StartNewRound` (TA:3015): `HasWinner || bForfeit → EndGame`; else `t <= 0 && !bUnlimitedTime → StartOvertime`.

**Clone/state:** `game_time_s: u16` (config), `unlimited_time: bool` (config, send in MatchState), clock as **f32
seconds** decremented per tick by `(1/120)/match_time_dilation` exactly like the game (count-up when unlimited/plain
overtime). Snapshot/rollback: clock value, `ball_has_been_hit`, `go_tick`. Server today: `MATCH_TICKS` const and an integer
tick clock (`server/src/game.rs:53-56, 586-603`) — must become config-driven and dilation-aware. H

### 2. Max score — `GameScores`

| Option | `GameScore` | Notes |
|---|---|---|
| (default) loc `MutatorSettingDefault_GameScores` | — | `MaxScore` 0 (class default) = no cap |
| `Max1`,`Max3`,`Max5`,`Max7`,`Max10`,`Max20`,`Max30`,…,`Max90`,`Max100` | 1…100 | `Max151` (`bHidden`) 151 |
| (archetype `UnlimitedScore` GameScore 0 exists but no setting uses it) | 0 | |

`Mutator_Match_TA.Init`: `if GameScore >= 0 (default −1): SoccarGame.MaxScore = GameScore; SetAlwaysShowMatchTypeLabel(true)`
(TA:70571-70573). All carry `ProhitibitedDefaultMatchTypes = [MatchType_Private_TA]` (R-0.7). [A][S] H

**How it ends the match:**
- Team score changes in `Active` (any source: possession, assist/demolish score, keep-up) → `Active.HandleTeamScoreUpdated`
  arms a 0.01 s timer → `OnTeamScoreUpdated`: `GameWinner == None && HasWinner() → EndGame` (TA:4234-4241). So a cap reached by
  a **non-goal** point ends the match ~0.01 s (2 ticks at 120 Hz [I]) later, mid-play.
- A **goal**: `HandleHitGoal` scores, then (unless DisableGoalDelay) `GotoGameState('PostGoalScored')`; `Active.EndState`
  clears that 0.01 s timer (TA:4010-4011). The full post-goal sequence (3.0 s + replay) plays, then `StartNewRound` →
  `HasWinner` → `EndGame` (no kickoff). `PostGoalScored.BeginState` precomputes `bFullMatchWinnerDecided` for the UI (TA:4245-4254).
- `>=`: overshoot (e.g. a 10-point goal at 145/151) still ends it. [S] H

**Clone:** `max_score: u16` in config/MatchState. Server `score: [u8; 2]` (`protocol.rs:83`) can overflow with unlimited
time + 10-point goals or possession; widen to u16. Check after every score change: goals at round end, other points after
the 0.01 s timer (2 ticks). H

### 3. Overtime — `OvertimeRules`

| Option | Archetype (`Mutator_Match_TA.OvertimeComponent` → `OvertimeSettings_TA`) |
|---|---|
| (default) loc `MutatorSettingDefault_OvertimeRules` | none: sudden death, counts up from 0, no cap |
| `Overtime5MinutesFirstScore` | `OvertimeGameTime` 300, `TieBreaker` FirstScore (0) |
| `Overtime5MinutesRandom` | `OvertimeGameTime` 300, `TieBreaker` Random (1) |

`Mutator_Match_TA.Init` (TA:70576-70580): creates `OvertimeComponent_TA`, copies TieBreaker and OvertimeGameTime, attaches it
to the game event. Class defaults: `BallHitGroundTimeoutSeconds` 90.0, `FirstScoreTeamIndex` −1, `RandomWinningTeamIndex` −1
[A]. Logic [S] H:
- `Attached` binds `GameEvent.EventGoalScored` → `HandleGoalScored` (TA:74469-74480): on the **first goal of the match**
  (it unbinds itself) `FirstScoreTeamIndex = (Goal.TeamNum == 0) ? 1 : 0` (the scoring team).
- `StartOvertime` (TA:3211): `bOverTime = true; GameTimeRemaining = OvertimeComponent.OvertimeGameTime` (None → 0).
  With the component the overtime clock **counts down** from 300 (ShouldCountUp is false).
- Any goal in overtime → `HasWinner` true → match ends after the post-goal sequence (as default).
- Overtime reaching 0:00 tied → `WaitForEndRound` → `EndRoundComponent_TA.Attached`: in overtime with a component it also
  arms `SetTimer(90, 'HandleBallHitGroundTimeout')` (TA:27096-27101); the round ends on ball-ground contact
  (normal.z > 0.96 / sleeping ball, `notes/match-rules-audit.md`) or after 90 s → `StartNewRound` → `HasWinner` →
  `GetWinningTeam`: tie && bOverTime && t <= 0 && component → `PickWinner` (TA:3203-3207):
  FirstScore → `Teams[FirstScoreTeamIndex]` (None if the match had no goal → no winner → `StartOvertime` again: another
  300 s) [S, the 0-0 loop I-M]; Random → `RandomWinningTeamIndex = Rand(Teams.Length)` once, cached (TA:74493-74497).
- `EndGame` stores `TieBreakDecision` only via MaxTime (§4); overtime tiebreak sets no flag.

**Clone:** config `overtime_limit_s: Option<u16>`, `tiebreak: FirstScore|Random`; state `first_score_team: Option<u8>`
(set at the first goal of the match), `random_winner: Option<u8>` (server RNG, chosen once), overtime 90 s ground timeout
(tick counter, game time). Server today: overtime counts up only (`game.rs:592-594`). H

### 4. Max time limit — `MaxTimeRules`

Category not hidden (`bUseableWhileHidden`); options `MaxTime1Minute` … `MaxTime15Minutes`. Each is a `Mutator_Match_TA`
with `MaxTimeComponent` (`MaxTimeComponent_TA`): [A] H

| Setting | TimeLimitSeconds | WarningTimeSeconds |
|---|---|---|
| MaxTime1Minute | 60 | 30 |
| MaxTime2Minutes | 120 | 90 |
| MaxTime3Minutes … MaxTime6Minutes | 180/240/300/360 | 150/210/270/330 |
| MaxTime7Minutes | 420 | 360 |
| MaxTime8Minutes, 9 | 480, 540 | 420, 480 |
| MaxTime10Minutes | 600 | 540 |
| MaxTime11Minutes | 660 | 540 |
| MaxTime12…15Minutes | 720/780/840/900 | 600/660/720/780 |

(Warning = limit − 60 except 1 min −30, 10 min −60, 11 min −120: data as shipped.)

Logic [S] (TA:68182-68240):
- `Mutator_Match_TA.Init` adds the component to the game event's ORS group (TA:70574-70575). `MaxTimeSystem_TA.StartMaxTimer`
  (static, ORS system; no script caller — dispatched natively when the component appears [I]) sets ORS timers
  `MaxTimeWarning_TA` at WarningTimeSeconds and `MaxTimeEndGame_TA` at TimeLimitSeconds, and publishes wall-clock epochs for
  the HUD. The limit therefore counts from match creation (warm-up, countdowns, replays included) [I-M]; whether ORS timers
  run on real or game time is not established [L].
- Warning: broadcasts the 30 s / 1 min / 2 min remaining message when `Limit − Warning` equals 30/60/120 (TA:68226-68232).
- End (`ReceivedMaxTimeEndGame`, TA:68217): if the match hasn't ended, `MaxTimeEndGame_TA.GetWinningTeam` (decoded by hand
  from raw bytecode): normal winner (score leader) → `TieBreakDecision` 1; else per-team sum of `PRI.MatchShots` over team
  members — different → team with more shots, decision 2; equal → `Teams[Rand(Teams.Length)]`, decision 3; then
  `SetMatchWinner(Team, Decision)` → `EndGame` immediately (mid-play). [S] M (decision numbers from bytes)

**Clone:** optional; needs a server timer from match start, per-team shot totals (stat tracking), seeded RNG. Low priority.

### 5. Series — `MatchGames`

Options `3Games`, `5Games`, `7Games` (`MatchGames` 3/5/7); default loc `MutatorSettingDefault_MatchGames`: SeriesLength 1
(class default). [A] H

`Mutator_Match_TA.Init` (TA:70560-70566): `SoccarGame.SeriesLength = N`; if no `MatchSeries_TA` exists in the global object
provider, create one with `SeriesLength = N` and add it (it outlives the game event). Logic [S] H/M:
- At game end `UpdateTeamScores` (TA:2779): `MatchSeries.ScoreGame(winner)` (`GamesWon++`); if a team has no members and
  the series isn't over, the remaining games are forfeited to the winner (`ForfeitGame` loop).
- Series winner: first team with `GamesWon >= ceil(SeriesLength * 0.5)` (`GetSeriesWinCount`, TA:67449-67450;
  `GetSeriesWinnerFromData`). `AllGamesPlayed = winner != −1`.
- `Finished.OnFinished`: the series object is removed only when the series is complete (TA:4497-4499); the dedicated server
  doesn't kick players while it isn't (TA:71733-71738), so the next game starts as a fresh match [I-M].

**Clone:** server-only state `series_length`, `games_won[2]`, persisted across matches; reset when complete. No physics.

### 6. Number of balls — `MultiBall`

Options `TwoBalls`, `FourBalls`, `SixBalls` (`Mutator_Ball_TA.TotalGameBalls` 2/4/6); default 1. `Mutator_Ball_TA.Init`:
`if TotalGameBalls > 0: SoccarGame.SetTotalGameBalls(N)` (replicated; also copied to `GameShare_TA`) (TA:70089-70090, 3282-3284,
3644-3645). [A][S] H

**Spawn positions** (`ResetBalls` TA:3116, `GetBallSpawnOrientation` TA:3080, `CalculateBallDimensions` TA:3073) [S] H:
- R, W = `Radius` and `SpawnWidth` of a temporary ball spawned from `BallArchetype` and **mutated** (so ball type/scale
  count); `Radius = Bounds.BoxExtent.Z`, `SpawnWidth = Bounds.BoxExtent.Y` (TA:11221-11224). `BallSpacing` = 50 (class default).
- First ball: `FieldCenter + (0,0,−(FieldExtent.Z − R)) + (−(W+50)·(N−1), 0, 0)`; each next ball `+X·2·(W+50)`
  (TA:3133). So x ∈ {−(N−1), …, N−1, step 2}·(W+50), y 0, z as the single ball (100.49 for the default ball:
  `notes/match-rules-audit.md`). Default ball W ≈ R ≈ 95.49 [I] → 2 balls x = ±145.49; 4: ±145.49, ±436.47;
  6: ±145.49, ±436.47, ±727.45. (Maps with `BallSpawnPoints` use those instead.)
- `SpawnNewBall`: `MoveToGround` then wake; each ball gets `GameBallIndex` = its slot (TA:3150-3158).
- All balls are frozen 2D in the countdown and released in `Active.StartRound` (TA:4025-4026).

**Goals with several balls:** `Active.HandleHitGoal` per ball; the first goal → `PostGoalScored` (all cars/balls destroyed at
`StartReplay`, everything resets). In `PostGoalScored` other balls entering a goal hit the global `HandleHitGoal` stub
("called out of active state", TA:3324): ignored. With DisableGoalDelay only the scoring ball respawns (§7). [S] H
0:00 rule: `EndRoundComponent` listens to every ball; the round ends on the first ball touching ground (TA:27100-27112). [S] H

**Clone:** engine has a single `Ball* ball` (`engine/rocketsim/src/Sim/Arena/Arena.h:48`) — needs N balls (bodies, goal test,
touch lists and `HitTeamNum` per ball, ball index in snapshots/updates, client rendering). Snapshot: per-ball state array +
`GameBallIndex`. Big gap. H

### 7. Respawn time — `RespawnTime`

| Option | Archetype (`Mutator_RespawnTime_TA`) |
|---|---|
| (default) | `PlayerSpawnConfig_TA.RespawnDelaySeconds` 3 (int, CDO) |
| `TwoSecondsRespawn` | `RespawnTime` 2 |
| `OneSecondsRespawn` | `RespawnTime` 1 |
| `DisableGoalDelay` | `bDisableGoalDelay` true (`BallRespawnTime` unset = 0) |

[A] H. Logic [S]:
- **Delay:** static `Mutator_RespawnTime_TA.Mutate(Feature, Mutator)`: `if RespawnTime > 0: Feature.RespawnDelaySeconds =
  RespawnTime` (TA:70668-70670). No script caller: the ORS feature system applies it to the `PlayerSpawnConfig_TA` feature
  natively [I-M]. Demolition → `PlayerSpawnSystem_TA.HandleCarDemolished` → spawn ticket with `RespawnDelaySeconds`
  (TA:78868-78870); `TickSpawn` subtracts `Tick.DeltaSeconds` and restarts the player at ≤ 0 (TA:78840-78850).
- **Demo spawn selection off:** `Init`: `RespawnTime > 0 && RespawnTime < PlayerSpawnConfig.default.RespawnDelaySeconds (3)`
  → `SoccarEvent.bAllowDemoSpawnSelection = false` (TA:70660-70661). Prespawn/selection need ≥ 3 s
  (`notes/camera-respawn-goal.md` CAM-29). [S] H
- **DisableGoalDelay:** `Init`: `SetDisableGoalDelay(true, BallRespawnTime)` (TA:70658-70659, 4569-4574). On a goal
  (`Active.HandleHitGoal`, TA:4125-4131): if `bDisableGoalDelay && !HasWinner()`: more than one ball → `ResetBall(Ball)`
  (that ball respawns at its own slot, R-6) ; one ball → `StartNewRound()` directly (no `PostGoalScored`, no slow-mo, no
  replay); `SetTimer(4, ClearReplicatedScoredOnTeam)`. Else the normal `PostGoalScored`.
  `StartNewRound` with the flag (TA:3015-3046): no countdown (`StartCountDown` only if `!bDisableGoalDelay || bOverTime`),
  balls reset after `BallRespawnTime` (0 → immediately, else a state timer), **cars not reset** (`ResetPlayers` only if
  `!bDisableGoalDelay || bOverTime`), **pads reset** (`ResetPickups` always). The state stays `Active`, `bBallHasBeenHit`
  stays true, so the clock keeps running. Overtime still uses a normal kickoff. A goal that produces a winner (MaxScore,
  overtime) takes the normal post-goal path. [S] H
  The new ball spawns at the kickoff spot (z 100.49, at rest; not 2D-frozen since there is no countdown) [S/I] H.
  Balls with `BallLiftImpulse` (Mutator_Ball_TA, no shipped setting) get an upward velocity change on spawn (TA:70093-70127).

**Clone:** `respawn_delay_s` (engine `MutatorConfig.respawnDelay` exists; prespawn gate `DEMO_PRESPAWN_MIN_DELAY` 3,
`Arena.cpp:196` — matches); `disable_goal_delay` + `ball_respawn_time` in MatchRules; server round logic per above (no
PostGoal phase, ball-only reset, pads reset, clock continues). Snapshot unchanged except the pending ball-respawn timer. H

### 8. Boost pad respawn — `BoostPadRespawnTime`

`Mutator_Booster_TA.RespawnDelayScale` (class default 1.0) [A]:

| Option | Scale | Big (10 s) | Small (4 s) |
|---|---|---|---|
| (default) | 1.0 | 10 | 4 |
| `BoostPadRespawn2` | 2.0 | 20 | 8 |
| `BoostPadRespawn1_5` | 1.5 | 15 | 6 |
| `BoostPadRespawn0_667` | 0.667f | 6.67 | 2.668 |
| `BoostPadRespawn0_5` | 0.5 | 5 | 2 |
| `BoostPadRespawn0_2` | 0.2f | 2 | 0.8 |
| `BoostPadRespawn0_1` | 0.1f | 1 | 0.4 |

Logic [S] H: `MutateObject` on each pad at `GameEvent.Init`: `if bNoBooster || (bUnlimitedBoost && !online freeplay) →
SetNoPickup()` (pad disabled: no collision, picked-up FX), else `if RespawnDelayScale != 1: pad.RespawnDelayScale = scale`
(TA:70205-70210). `PickedUp.BeginState`: `CurrentDelay = RespawnDelay * RespawnDelayScale` (`GetRespawnDelay`, TA:107661-107662);
`> 0 → SetStateTimer(CurrentDelay, 'Respawn')` (game time); `< 0 → Respawn()` now (TA:99152-99163). Pad base delays 4/10 s
from `Stadium_P` (`notes/physics-values.md` "Boost pads"). Disallowed with `NoBooster` (R-0.10). Unlimited boost removes
pads entirely, so the scale is moot there.

**Clone:** engine `MutatorConfig.boostPadCooldown_Big/Small` (`BoostPad.cpp:90`) = 10·s / 4·s as **f32 products**; the
timer must tick in game time (tick count: first tick with elapsed ≥ delay [I]). Already in snapshots (pad cooldown). Missing:
the no-pickup state for NoBooster/UnlimitedBooster (MUT1 boost part). H

### 9. Score alterations

#### 9.1 `GoalScore`, `AerialGoalScore`
| Option | `Mutator_Score_TA.GoalStatEventScore` |
|---|---|
| `GoalScore0/2/3/5/10` | {StatEvent `Events.Goal`, Score 0/2/3/5/10} |
| `AerialGoalScore0/2/3/5/10` | {StatEvent `Events.AerialGoal`, Score 0/2/3/5/10} |
(Score 0 = field absent → 0.) [A] H

`GameEvent_Soccar_TA.GetGoalScorePoints` (TA:3597-3615) + `Mutator_Score_TA.GetGoalScore` (decoded with STAT1's decoder):
```
GoalTypes = StatFactory.GetStatEventsForGoalHit(Ball.Touches[0])      # Goal, +Backwards/Bicycle/Aerial/Turtle/Long (match-stats §3)
override = INT_MIN
for m in Mutators (Mutator_Score_TA): if m.GoalStatEventScore.StatEvent != None and in GoalTypes: override = max(override, Score)
points = (override != INT_MIN ? override : Goal.PointsToAward (1)) + Ball.GetGoalScorePoints()
```
Team gets `points` (`Teams[..].ScorePoint`), scorer PRI too (TA:4076-4092). So GoalScore N makes every goal worth N;
AerialGoalScore N makes aerial goals worth N (max with GoalScore when both are set; `AerialGoalScore0` alone makes aerial goals
worth 0). The goal still ends the round. Goal types use the latest touch `Touches[0]`; aerial = the stat's aerial-hit test
(`notes/match-stats.md` §3.3). `BackwardsGoalScore`, `BicycleGoalScore`, `LongGoalScore`, `TurtleGoalScore` categories exist
but have **no settings** in the live build. [S] H
**Clone:** needs the goal-type classification (aerial hit test) of the scoring touch on the server; score as u16. M (aerial test spec in match-stats)

#### 9.2 `AssistScore`, `DemolishScore`
`AssistScore1/2/3` {`Events.Assist`, 1/2/3}; `DemolishScore1/2/3` {`Events.Demolish`, 1/2/3} (`TrackedStatEventScore`).
`Init` binds `StatFactory.EventGaveStat` (TA:70689-70690); `HandleStatGiven` (TA:70692-70705): skip if no PRI, if the
victim is on the receiver's team, or another event; if the game is Active: `Team.ScorePoint(N)` and `PRI.ScorePoint(N)`.
Demolish also enables the 25-point Car/BallDemolitionScore events (`GetScorePointsForStatEvent` > 0, TA:3616-3625;
`notes/match-stats.md` §5.1). A team point here can end the match by MaxScore (§2). [S] H
**Clone:** server: on assist (goal attribution) / demolition (opposite team) add N to the team score. H

#### 9.3 `PossessionRules`
`Possession1Second/2Seconds/3Seconds`: `Mutator_Score_TA` {PossessionSeconds 1/2/3, PossessionScore 1} → on every ball
`BallPossessionComponent_TA.SetIntervalAndScore(sec, 1)` (TA:70709-70714). Class defaults: TeamNum −1, ClearDistance 3000,
ClearResetDistance 1000, LastSecondsForDenial 0.5 [A]. Logic (TA:12833-12911) [S] H:
- Possession team = `Ball.HitTeamNum` (team of the last car touch). On change: `TeamNum = new`, `CurrentPossessionSeconds = 0`,
  streak 0 (steal/denial stats only).
- `Tick(dt)` (game time; only while `bRoundActive`, a team set, interval > 0, score > 0): `secs += dt`;
  `k = floor(secs / interval)`; if k > 0: that team `ScorePoint(1·k)`, its last toucher `ScorePoint`, `secs −= k·interval`.
  So the team holding possession gains 1 point every `interval` seconds of game time. Clears stats use 2D distance to the
  nearest opponent car (ResetDistance 1000, Distance 3000) — stats only.
**Clone:** per-ball possession timer (f32, snapshot) + HitTeamNum; server adds team points; MaxScore check (§2). H

#### 9.4 `KeepUpRules` (hidden, usable)
`KeepUpEnabled` → `BallComponent_KeepUp` (StartingScore 1, ScoreIncrementSeconds 1.0 class default);
`KeepUpStageEnabled` → `BallComponent_KeepUp_Stage` (StartingScore 1, ScoreIncrementSeconds 0). Spawned on each ball with
`bCanBeScored` (TA:70715-70716). Class defaults: RequiredHeight 700, SaveSeconds 0.5, ClearDistance 1750, ClearResetDistance
750 [A]. Authority only (TA:12661-12663, 12741). [S] H:
- States 1 (armed) / 2 (active). `Tick`: needs StartingScore > 0, `bRoundActive`, a car touch since the last ground hit
  (`bHitCar`), a ball team. Armed and `Ball.Location.Z >= 700` → active, `Score = StartingScore`. Active with increment:
  `Score += floor(secs/1.0)` per second of game time.
- Ball hits the ground (`EventHitGround`) while active: `Total = Score + Ball.GetGoalScorePoints()`; if > 0:
  `Teams[Ball.HitTeamNum].ScorePoint(Total)` and its last toucher; back to armed, Score 0, `bHitCar` false; a Dropshot ball's
  damage index is reset (TA:12692-12713). (Points go to the team that touched last.)
- Preset KeepUp also disables goals (`DisableGoalScoring`), LowGravityBall, RapidRecharge, Max151, Ball_SpookyBalloon (§11).
**Clone:** per-ball keep-up state (state, score, secs, bHitCar) in snapshots; ground-hit event (normal.z > 0.96 rule). M

#### 9.5 `GoalScoringRules` (hidden, usable)
`DisableGoalScoring` (`Mutator_DisableScoring_TA.bDisableGoalScoring`): `Init` → `SetGoalsEnabled(false)` → every
`Goal_TA.SetEnabled(false)` (TA:70283-70287, 3635-3640, 32824). Goal volumes stop scoring; the goal geometry is unchanged
[I]. **Clone:** a flag that skips the goal test. H

### 10. Game-mode rule categories

| Category / option | What it does | Tag | Conf |
|---|---|---|---|
| `TerritoryRules.TerritoryEnabled` (map set Territory only) | `Mutator_Territory_TA`: `Init` spawns `TrackerWallDynamicMeshActor_TA` (visual wall); every car (authority, match not finished) gets `CarComponent_TerritoryDemolish` (self-destructs on the opponents' half; side from spawn `Y > 0`; logic native: `execCheckShouldSelfDestruct` 0x140e85a80, `execIsCarBodyInContactWithOppSide` 0x140e85b60, `execStartSelfDemolishSequence` 0x140e85bf0, PrePhysicsStep virtual 0x140f20f10 (old 0x140f1bac0 mapped)); every ball gets `BallStaleTimerComponent_TA.Init(30, 10, 10, 5, 2000)` (TA:70720-70736, 12948-13030). Stale timer: while `|ball.Y| > 0.5` (Tolerance) accumulate game time; reset on crossing midfield, on a car touch by a car not on its own half (`OnMyHalf`: nearest goal, +100 uu² bias), at match start/ball added; warning FX after 10 s (ball with a team) / 5 s (no team); after 30 s / 10 s `ResetBall(ball, (0, wasOnPositiveY ? −2000 : +2000, 0))` (respawn at the kickoff spot moved 2000 toward the other half; Heatseeker balls get a 100 uu/s push instead) | A,S,N | H (car rule: native, not decoded) |
| `GameEventRules.HauntedGameEventRules` (hidden setting) | `Mutator_GameEvent_TA`: StatFactory_HauntedBall + `EndRoundComponent_HauntedBall_TA` (0:00 ground touch ignored while the haunted ball is trapped) (TA:70499-70508, 27141-27146) | A,S | H |
| `GameEventRules.RugbyGameEventRules` | `EndRoundComponent_Rugby_TA`: 0:00 ground touch ignored while the ball is welded to a car (Spike Rush) (TA:27151-27155) | A,S | H |
| `AudioRules.HauntedAudio` | `GameEvent.AudioSoundMode = 'HauntedBall'` (cosmetic) (TA:70080-70085) | A,S | H |
| `TritipModeRules.Tritip` | `Mutator_Loadout_TA`: every player's loadout body overridden to `ProductsDB.Products.body_tritip` (TA:70530-70553). Physics: that body's preset (`notes/gameside-audit.md` GA-14) | A,S | H |
| `BreakoutBallLockedIndex.BreakoutBallIndex2` | `Mutator_Breakout_TA.LockedDamageIndex` 2 → `Ball_Breakout.SetLockedDamageIndex(2)` (Dropshot ball always at its highest damage stage) (TA:70233-70236) | A,S | H |
| `LockedBreakoutTiles`, `BreakoutTileStartingState` | no settings in the live build (class supports `StartingDamageState`, `bLockedTileDamageState`, TA:70221-70232) | A,S | H |
| `FireBallObstacle.FireBallObstacleEnabled` | `Mutator_ActorSpawner_TA`: spawns `Archetypes.Ball.Ball_RingSpawner` (spawns `Ball_Fire_Obstacle`, BallSpawnTime 0.1) at `FieldCenter + (0,0,1000)`, `SpawnDelaySeconds = 5.0` (TA:70048-70066) | A,S | H |
| `FireBallObstacle.BladeBallEnabled` | same with `BallSpawner_Blade` (spawns `Ball_Blade`), delay 3.0 | A,S | H |
| `InputRestriction.BackwardsMode` | `Vehicle_TA.SetInputRestriction(EIR_BackwardsMode)` on every vehicle (TA:70524-70528, 18414-18415); `Vehicle_TA.InputRestriction` at +0x822 is read only natively — effect not decoded here | A,S | H (that it is set) / L (effect) |
| `DemoFX.SilentDemoFX` | `GameEvent.DemoFXOverride = PongBall.FXActor.PongBall_FXActor_TA_Dup` (cosmetic) | A,S | H |
| `MatchAdmin.MatchCreatorAdminEnabled` | `bMatchCreatorAdminEnabled` if `MatchType.AllowsMatchCreatorAdmin()` (TA:70590-70591): lobby/admin powers, no gameplay | A,S | H |

### 11. Presets — `Presets` (hidden) and `GameModeMutatorSettingPresets`

`MutatorGameSettingPreset_TA.Presets` → `Archetypes.Mutators.MutatorPreset_*` (`PresetMutators_X`): a list of
`{Category, Setting, bLockSetting}` tags, optional `RequiresMaps`. Selecting a preset sets those tags (menu; a preset with one
required map coerces the map, TA:49147-49163). [A] H

| Preset | Tags (L = locked) |
|---|---|
| AprilFool | TritipModeRules=Tritip |
| Basketball | PitchSettings=PitchBasketball (L); RequiresMaps HoopsStadium_P, hoopsStreet_p |
| Beachball | BallType=Ball_Beachball, BallWeight=MagnusBeachBall, BallScale=MediumBall |
| BoomerBall | BallWeight=SuperLightBall, BallMaxSpeed=SuperFastBall, BallBounciness=HighBounciness, Boosters=UnlimitedBooster, BoosterStrengths=BoostMultiplier1_5x |
| Cubeball | BallType=Ball_CubeBall, BallWeight=LightBall, BallMaxSpeed=SuperFastBall, BallBounciness=HighBounciness, Boosters=UnlimitedBooster, BallScale=MediumBall |
| Custom | — |
| DemolitionDerby | Demolish=AlwaysDemolishOpposing, Gravity=HighGravity, RespawnTime=OneSecondsRespawn, BallWeight=HeavyBall, DemoFX=SilentDemoFX |
| Dropshot | BallType=Ball_Breakout |
| DropshotRumble | Items=ItemsMode, BallType=Ball_Breakout |
| Eggstra | BallType=Ball_Egg, BallWeight=LightBall, BallMaxSpeed=SuperFastBall, BallBounciness=HighBounciness, Boosters=UnlimitedBooster |
| Football | BallType=Ball_Football |
| GForceFrenzy | Boosters=UnlimitedBooster, BoosterStrengths=BoostMultiplier5x, Gravity=LowGravity |
| Heatseeker | BallType=Ball_God, GameScores=Max7 |
| HeatseekerTerritory | BallType=Ball_God, GameScores=Max7, TerritoryRules=TerritoryEnabled, Boosters=UnlimitedBooster, RespawnTime=OneSecondsRespawn |
| InvertedBall | Gravity=ReverseGravity, Boosters=RapidRecharge, BallWeight=SuperLightBall |
| KeepUp | KeepUpRules=KeepUpEnabled, GoalScoringRules=DisableGoalScoring, BallGravity=LowGravityBall, Boosters=RapidRecharge, GameScores=Max151, BallType=Ball_SpookyBalloon |
| Moonball | BallScale=BigBall, Gravity=LowGravity, Boosters=RapidRecharge |
| Pinball | BallScale=SmallBall, BallBounciness=HighBounciness, BallWeight=LightBall |
| Rugby | RespawnTime=OneSecondsRespawn, Items=ItemsModeRugby |
| Rumble | Items=ItemsMode |
| SnowDay | BallType=Ball_Puck, BallBounciness=LowBounciness |
| SnowDayTerritory | TerritoryRules=TerritoryEnabled, Boosters=UnlimitedBooster, BallWeight=LightBall, RespawnTime=OneSecondsRespawn, BallType=Ball_Puck |
| SpeedDemon | BallScale=BigBall, BallBounciness=LowBounciness, BallWeight=SuperLightBall, Boosters=UnlimitedBooster, BoosterStrengths=BoostMultiplier2x, Demolish=AlwaysDemolishOpposing, RespawnTime=OneSecondsRespawn, DemoFX=SilentDemoFX |
| SpikeDrop | GameScores=Max7, BallScale=SmallBall, Boosters=SlowRecharge, Items=ItemsModeRugby |
| SpikeRush | Items=ItemsModeRugby, RespawnTime=OneSecondsRespawn |
| Territory | TerritoryRules=TerritoryEnabled, Boosters=UnlimitedBooster, BallWeight=LightBall, RespawnTime=OneSecondsRespawn |
| TimeWarp | GameSpeed=SloMoDistanceBall |
| BladeBall | FireBallObstacle=BladeBallEnabled |

The `Presets` category shows 11 (Custom, Moonball, DemolitionDerby, TimeWarp, Pinball, CubeBall, BeachBall, SnowDay, Rugby,
InvertedBall, Territory); the rest are `GameModeMutatorSettingPresets` (playlist modes). `Ball_God` and `PitchBasketball` are
not settings of the live `BallType`/any listed category (`PitchSettings` is not in the category list), so those tags rely on
the playlist's own game info [I-M]. Note: Snow Day here = `Ball_Puck` + LowBounciness, not RocketSim's snowday constants.

### 12. Remaining hidden / lobby categories (one line each)

| Category | Settings | Effect |
|---|---|---|
| `BoostOption` (online freeplay) | `UnlimitedBoosterOFP` (bUnlimitedBoost), `BoostStandardOFP` (no fields), `BoostAutoRefillOFP` (recharge 0.1666/s after 1.5 s, ground only) | boost (MUT1 part); freeplay session manager BoostFillValue 0/1/2 (TA:70212-70219) |
| `GoalResetOption` (OFP) | `ResetStandardOFP` (no archetype), `DisableGoalDelayOFP` (= DisableGoalDelay + GoalResetValue 1), `DisableGoalScoringOFP` (= DisableGoalScoring + GoalResetValue 2) | §7, §9.5 |
| `FreePlay` | `FreePlay` (`Mutator_Freeplay_TA`: CountdownTime 0, unlimited time, no stats, … TA:70293-70320) | offline freeplay (`notes/camera-respawn-goal.md`) |
| `OnlineFreeplay` | `OnlineFreeplay` (freeplay base + no quick chat/crowd; cars `DemolishTarget` None, TA:70602-70631) | online freeplay |
| `PhysicsLogPlayback` | `PhysicsLogPlayback` (goals disabled, own match type; TA:70638-70655) | dev |
| `SpawnPointRules`, `GoalShields`, `Attachments`, `CarMaxSpeed`, `ItemGiveRate`, `AerialTargets`, `SpawnTargets`, `BackwardsGoalScore`, `BicycleGoalScore`, `LongGoalScore`, `TurtleGoalScore` | none in the live build | nothing to implement (archetypes `CarMaxSpeed2x/4x`, `Low/Med/HighDemoSpeed(FF)`, `UnlimitedScore`, `BoostStandard` exist in `Mutators_SF` but no setting references them) |
| `Bots` / `BotDifficulty` | `BotsNone`…`BotsUnfair` | lobby: `InitBotSkill` (`BotsNone` → no AI fill, TA:901-904) |
| `PlayerCount` | `PlayerCount2/4/6/8` | lobby team size |
| `Playlists`, `Clean`, `Lobby`, `Official` | — | lobby/matchmaking tags |
| (`AutoBalance`) | not in the live category list | `Mutator_Handicap_TA.AutoBalanceDifference` → `CheckForAutoBalance` swaps best/worst players at a score gap (TA:2979-3013) |

### 13. Clone requirements (rules side) — summary

| Need | Where | Snapshot / network | Priority |
|---|---|---|---|
| Setting-name list → `MatchRules` + `MutatorConfig` | server config, sent once to clients | reliable at join | H |
| Clock from config (GameTime, unlimited = count-up), dilation-aware f32 decrement | server | MatchState (+ `unlimited_time`) | H |
| MaxScore (≥), end after round for goals, after 2 ticks for other points; u16 scores | server | MatchState `max_score`, wider score | H |
| Overtime limit + tiebreak (first-scorer, random once), 90 s ground timeout | server | `first_score_team`, `random_winner` | M |
| DisableGoalDelay round (no PostGoal, ball-only reset, pads reset, clock runs) | server + engine (ball respawn without car reset) | ball-respawn pending timer | H |
| Respawn delay 1/2/3; selection only at ≥ 3 | engine `respawnDelay` (exists) | — | H (trivial) |
| Pad scale (f32 product) | engine pad cooldown config (exists) | pad timers (exist) | H (trivial) |
| N balls (spawn x-offsets, per-ball goal test, ignore goals outside Active) | engine (single ball today) | per-ball arrays | M (big) |
| Goal points by goal type (aerial test), assist/demolish points | server stats | score | M |
| Possession / keep-up / stale-ball / territory | server + engine (ground-hit event, ball Y side) | per-ball timers | L |
| Series, max-time, presets | server/menu | — | L |

### Open items
- `InputRestriction` effect (`Vehicle_TA+0x822` reader), territory self-destruct natives, ORS dispatch of
  `Mutator_RespawnTime_TA.Mutate` and `MaxTimeSystem_TA.StartMaxTimer`, whether ORS timers (MaxTime) use real or game time.
- Order of `GetActiveGameSettings` (only matters for same-field conflicts, R-0.6).
- `SpawnWidth` vs `Radius` of non-spherical balls (bounds Y vs Z) for multi-ball spacing.
- Pad respawn tick rounding (state timers fire on frames; tick-based server: assume the first tick with elapsed ≥ delay).

---

# Appendix B: Rumble items (forkA)

## Rumble / Items mutator (MUT1 fork A) — live build 2026-10-06

Sources: `Mutators_Items_SF` and `GameInfo_Items_SF` (decrypted in `out/bsim/agents/MUT1/dec/`, key 1) [A];
`TAGame.upk` class defaults [A]; `out/bsim/work/tagame_live_all.txt` [S, cited TA:<line>]; `natives.csv` /
`classes.csv` + exe vtable reads [N, names/addresses only, no decompiles]. Setting names below are the
`MutatorGameSetting_TA` names (= loc keys `MutatorSetting_<name>`); no label text.

### 1. Category, options and their data

Category `Items` (GameSettingCategory_X, visible; loc `MutatorCategory_Items`, default `MutatorSettingDefault_Items`
= no sub-rules). Every option is a `Mutator_Match_TA` in `Mutators_Items.Mutators.Mutators_Items.<name>` whose only
property is `SubRules` [A]. `ItemGiveRateOverride` is never set (class default −1 = no override) [A].
`Mutator_Match_TA.Init` replaces the game's sub-rules: `SubRules.Unapply(); SubRulesArchetype = X;
SubRules = X.NewInstance(SoccarGame); SubRules.Init()` (TA:70581-70585), then applies `ItemGiveRateOverride ≥ 0`
to every dispenser (TA:70586-70589, MutateObject TA:70594-70597) — dormant in the live data.

Hidden category `ItemGiveRate` (bHidden, bUseableWhileHidden) has **no GameSettings** in the live list [A]
(loc keys `MutatorSetting_ItemGiveRate*` exist but no settings point at them) → no live option overrides the rate.

| Setting (hidden?) | SubRules archetype | Pool class | Pool items (weight → copies per cycle) | ItemGiveRate s | Other dispenser flags |
|---|---|---|---|---|---|
| ItemsMode | SubRules.ItemsMode | Cycle | BallSpring, CarSpring, GravityWell, Swapper, BallVelcro, BallGrapplingHook, StrongHit, BallLasso, BallFreeze, BoostOverride ×2; Tornado ×1 (21/cycle) | 10 | – |
| ItemsModeSlow | ItemsMode_Slow | Cycle | as ItemsMode, but the BallFreeze slot references `StatEvents.Events.SpecialPickup_BallFreeze` (a StatEvent_TA, ref 3271), not the pickup (see note F) | 20 | – |
| ItemsModeBallManipulators | ItemsMode_BallManipulators | Cycle | BallSpring, GravityWell, StrongHit, BallLasso, [BallFreeze → StatEvent, note F], BallGrapplingHook ×2; BallVelcro ×1 | 10 | – |
| ItemsModeCarManipulators | ItemsMode_CarManipulators | Cycle | CarSpring, Swapper, StrongHit, BoostOverride ×2; Tornado ×1 | 10 | – |
| ItemsModeSprings | ItemsMode_Springs | Cycle | BallSpring, CarSpring ×2 | 20 | – |
| ItemsModeSpikes | ItemsMode_SpikesOnly | Cycle | BallVelcro ×1 | 10 | – |
| ItemsModeRugby | ItemsMode_Rugby | Cycle | SpecialPickup_Rugby ×1 | 1 | bGiveItemOnFirstBallHit, bHideItemIconByDefault |
| ItemsModeRugbyLightDark (hidden) | ItemsMode_RugbyLightDark | Cycle | SpecialPickup_RugbyLightDark ×1 | 1 | bGiveItemOnFirstBallHit, bHideItemIconByDefault |
| ItemsMode_BM (hidden) | ItemsMode_BM | Cycle | the `BM.*_BM` copies of the ItemsMode list (same numbers; BM lasso = Batarang class) | 10 | – |
| ItemsModeHauntedBallBeam (hidden) | ItemsMode_HauntedBallBeam | Cycle | HauntedBallBeam ×2 | 7 | – |
| ItemsModeSelection | ItemsMode_Selection | Selection, ConcurrentItemCount 3, bPreviewItems | ItemsMode list, weights 2 (Tornado 1), BallFreeze slot → StatEvent (note F) | 10 | PreviewTimeSeconds 10 |
| ItemsModeBoxingGloves | ItemsMode_BoxingGlovesOnly | Cycle | BallSpring ×1 | 5 | – |
| ItemsModeGrapplingHooks | ItemsMode_GrapplingHooksOnly | Cycle | BallGrapplingHook ×1 | 10 | – |
| ItemsModeRPS | ItemsMode_RPS | Selection, 3 concurrent, bPreviewItems | 3 inline pickups (pool sub-objects): Obj = CarSpring (CooldownSeconds 12), Obj_1 = BallSpring (cd 20), Obj_2 = BallFreeze (cd 12) | 5 | PreviewTimeSeconds 5 |

All dispenser flags not listed are the class defaults: false / 0 (`Default__PlayerItemDispenser_TA` has no tagged
properties; `bGiveItemBeforeRoundStart`, `bGiveItemOnRoundStart`, `bResetTimerOnDemolish` false, `PreviewTimeSeconds`
0) [A]. `GameEvent_Soccar_SubRules_Items_TA.StaggerTime` is 0 in every archetype and the class default [A] →
no per-player stagger. The Rumble playlist (`GameInfo_Items_SF`, `GameEvent_Items.DefaultSubRules =
SubRules.ItemsMode`) carries the same ItemsMode dispenser/pool (rate 10, same 11 entries, BallFreeze correct) [A].

**Note F (data quirk, [A] verified on raw bytes):** in `ItemsMode_Slow`, `ItemsMode_BallManipulators` and
`ItemsMode_Selection` the BallFreeze entry's object ref is export 3271 = `StatEvents.Events.SpecialPickup_BallFreeze`
(StatEvent_TA); ItemsMode uses 2854 = `Archetypes.SpecialPickups.SpecialPickup_BallFreeze`. Script consequence [S/I]:
`RefillPool` adds `SpecialPickup_TA(Obj)` = None (TA:64755-64766); `GiveItem` destroys the held item, then
`ApplyItemToCar(Car, None)` does nothing (TA:64740-64754) → that draw is an **empty item** (next item after
`ItemGiveRate` once the dispenser sees AttachedPickup == None, TA:78736-78740). In Selection `RollItems` →
`AddItemToSlot(None, …)` → empty slot (TA:64814-64844). Clone should reproduce the empty draws (or treat as a
known game bug and decide). Confidence high for the data, medium for the "empty item" runtime outcome (needs one
live check: Slow rumble, count empty cycles).

### 2. Pickups (archetypes `Archetypes.SpecialPickups.*`) [A] + rules [S]

Common (`SpecialPickup_TA`, a CarComponent_TA): `CooldownSeconds` class default 10; `ActivationDuration` = active time
limit (`Active.Tick`: deactivate when GetActiveTime() > ActivationDuration, authority/autonomous, TA:91422-91426);
use = `PlayerController_TA.ActivatePickup` → `TryActivate(ClientTarget)` locally + `ServerUsePickup` (TA:77065-77084);
optional hold buffer `PickupActivationBuffer` (user setting, TA:77051-77058). Targeted pickups pick the closest valid
`RBActor_TA` within `Range` around the car; with `bUseDirectionalTargeting` only those with
`Dot(Normal(ToVec.XY), CarViewYaw) > DirectionalTargetingAccuracy` (0.75 → ±41.41°) (`GetTarget` TA:91456-91484);
`bRequireTrace` = FastTrace car→target (TA:91488-91490); `ValidateTarget` team rules TA:91485-91487.
Demolished carrier: active → DeactivatePickup, else Destroy (TA:91315-91320).
`SpecialPickup_TA.ApplyPickup` swaps in `BodyReplacements` (only BallLasso: Batmobile bodies Body_Darkcar,
body_berry, body_eggplant, body_tomb → SpecialPickup_Batarang) (TA:91294-91307).

ApplyForces natives: all `execApplyForces` entries are the shared thunk 0x140e76aa0 → vtable +0x6a8; per-class
implementations read from the exe vtables [N]: Spring/BallLasso(/Batarang) **0x140eba660**, BallFreeze
**0x140eb9640**, BallGravity **0x140eb9870**, HauntedBallBeam **0x140eba100**, GrapplingHook **0x140eb9ca0**, Tornado
**0x140eba990**. Other natives: `execDoSpring` 0x140e8f190 (Spring and Lasso), `execGetRelativeImpulse`
0x140e8f230, `execGetRelativeConstantForce` 0x140e8f2e0, `execGetTargetedLocation` 0x140e8d340,
`execGetPredictedBallLocation` 0x140e8d400, `execDeactivatePickup` 0x140e88200. Script-only pickups: Swapper,
BoostOverride, HitForce, BallVelcro, Rugby.

| Pickup (archetype → class) | Key constants [A] | Behaviour [S] / native [N] | Conf. |
|---|---|---|---|
| BallSpring → BallCarSpring_TA (Spring) | Force 80000; bApplyRelativeForce, RelativeForceCurve 0→0, 1000→25000, 3000→60000; Range 2300, bCanTargetBall, bRequireTrace; MaxSpringLength 3500; SpringLengthCurve (t s → uu) 0→50, 0.2→1500, 0.6→4000; HitDistanceOffset 150; AfterSpringDuration 0.9; WeldedForceScalar 3, WeldedVerticalForce 50000; ActivationDuration 99; Cooldown 25; class: MinSpringLength 30, BallHitType HitType_Item1, RelativeForceNormalDirection 1 | spring extension + hit in native DoSpring/ApplyForces [N 0x140e8f190 / 0x140eba660]; deactivates when owner car touches the ball with HitType > Item0 (TA:91623-91626) | data high, hit math needs decompile |
| CarSpring → BallCarSpring_TA | Force 550000, VerticalForce 400000, Torque (2000,0,0), FromOffset (0,0,−300), HitDistanceOffset 100; targets enemy cars, directional 0.75, Range 2300, trace; rest as BallSpring; Cooldown 15 | as above (native) | same |
| BallLasso → BallLasso_TA (Spring) | RelativeForceNormalDirection −1 (pull); RelativeForceCurve 0→0, 1800→5000, 4000→12000; ConstantForce −20 with RelativeConstantForceCurve 0→0, 1000→6, 2000→12; bApplyConstantForce, bApplyRelativeConstantForce, bBreakConstantForceWithHit, bFollowAfterHit; MaxSpringLength 3000; SpringLengthCurve 0→600, 0.15→1200, 0.3→2000, 0.6→4000; HitDistanceOffset 25; AfterSpringDuration 1.3; Range 1800 (ball, no trace); ActivationDuration 99; Cooldown 25 | native; constant force broken by an owner hit (TA:91627-91631) | same |
| Batarang (BM lasso / Batmobile replacement) → Batarang_TA | as BallLasso + SpinSpeed 80000, HitDistanceOffset 20 | visual spin (TA:91914) | high |
| BallFreeze → BallFreeze_TA | TimeToStop 0.5; Range 2300 (ball; class bCanTargetBall); ActivationDuration 4; Cooldown 20; bMaintainMomentum false (default) | start: store velocities, RecordCarHit(Item2), sleep body if TimeToStop < 0.01, Ball.bItemFreeze = true (TA:91637-91650); stop toward zero in native ApplyForces [N 0x140eb9640]; ends on any car/item touch with HitType > Item0 or explosion (TA:91689-91696); end: wake, velocities **not** restored, bItemFreeze false (TA:91705-91715) | medium (native) |
| GravityWell → BallGravity_TA | BallGravity 55000, Range 1000, Offset (200,0,0), RecordBallHitRate 2, ActivationDuration 6, Cooldown 20, bDeactivateOnTouch false | ball = first Ball_TA overlapping Range around the car (TA:91748-91755); force in native ApplyForces [N 0x140eb9870] | medium |
| BallGrapplingHook → GrapplingHook_TA | Impulse 80000, Force 900000, MaxRopeLength 3500, PredictionSpeed 3300, RopeLengthCurve 0→50, 0.2→1500, 0.6→4000, HitDistanceOffset 35, AfterAttachDuration 3, BlockedRequiredMoveTime 0.3, BlockedRequiredMoveDistance 200, bDeactivateOnTouch, Range 2800, trace, ActivationDuration 6, Cooldown 15 | pull in native ApplyForces [N 0x140eb9ca0] (+ predicted ball location natives); ends on touching the target (TA:92356-92359), ball explosion (TA:92387), or blocked line of sight without moving 200 uu in 0.3 s (TA:92317-92336) | medium |
| BallVelcro (spikes) → BallVelcro_TA | ActivationDuration 12 before a hit; on hit ActivationDuration = ActiveTime + AfterHitDuration 4.5; MinBreakTime 0.6, MinBreakForce 1200, PostBreakDuration 0.6, BallOffset (180,0,105) with bUseRealOffset (real offset used), Cooldown 25; class CheckLastTouchRate 0.5 | on the car's first ball hit: weld ball to car (WeldingInfo Mass 1, offset = ball−car in car frame, relative rotation), ball bIgnoreSyncing (TA:91863-91881); break when an enemy car collides with \|NormalVelocity\| > 1200 or an enemy car touches the ball, after 0.6 s attached (TA:91890-91897); `DisableBallImpactForces` while active (TA:91908 → Car_TA.OnHitBall TA:20211); RecordCarHit every 0.5 s while welded (TA:91853-91862) | high |
| StrongHit → HitForce_TA | BallHitForce 1.5, CarHitForce 30, bBallForce, bCarForce, bDemolishCars, ActivationDuration 12, Cooldown 15 | sets Car.AddedBallForceMultiplier 1.5 → ball hit impulse × 2.5 (TA:20245), AddedCarForceMultiplier 30 → bump impulse × 31 (TA:20287); any RB collision with a car that `CanDemolish` → Demolish (no speed test) (TA:92460-92495) | high |
| Swapper → Swapper_TA | Range 10000, directional 0.75, enemy cars (class), ActivationDuration 0.75, AddVelocityZ 0 | at PickupEnd (0.75 s after use): swap RB position, rotation and **linear** velocity (angular not swapped); breaks a welded velcro on either car (TA:92700-92743) | high |
| BoostOverride → BoostOverride_TA | Range 4000, directional 0.75, enemy cars, ActivationDuration 5, AddVelocityZ 0, Cooldown 10 (class) | target: SetUnlimitedBoost(true) + `bOverrideBoostOn` forces bActivateBoost in SetVehicleInput (TA:20424-20426); end: SetUnlimitedBoostDelayed(false), boost 0 if bNoBoost (TA:91935-91999) | high |
| Tornado → Tornado_TA | Height 800, Radius 400, Offset (0,0,−150), VerticalForceCurve 0→30, 0.25→4, 0.3→4, 0.6→4, 0.7→1, RotationalForce 7, CentripetalForceCurve 0→0, 0.2→20, CarDirectionForceCurve 0→0, 500→7, 1000→13, 2000→20, Torque 5, MaxVelocityOffset 3000, VelocityEase 5 (class), BallMultiplier 3, ActivationDuration 8, Cooldown 10 | all forces native [N 0x140eba990] | low until decompiled |
| Rugby / RugbyLightDark → Rugby_TA | bAutoActivate, ActivationDuration 1e17, MinDetachTime 0.15, MinBreakTime 0.6, MinBreakForce 0, BallReleaseForce 0, BallReleaseLift 0, KickOffActivationDelay 0, CheckLastTouchRate 0.5 (class) | auto-activates on vehicle setup (TA:91378-91386); weld on car ball hit unless another car attached within 0.6 s (TA:92586-92604, 92615-92624); carrier gets no boost while welded (TA:92577-92585); use = release after 0.15 s (TA:92523-92532); enemy car collision (any speed) or enemy touching the ball → release and **carrier demolished** by that car (TA:92569-92576, 92609-92614); release force 0 (TA:92625-92651) | high |
| HauntedBallBeam (hidden mode) → HauntedBallBeam_TA | BallGravity 3500, Range 1200, Offset (400,0,125), ArrivalDistance 200, CarAvoidenceOffset (0,0,100), MaxSimulatedClients 3, ActivationDuration 4 | native [N 0x140eba100] | low |

BM copies (`Archetypes.SpecialPickups.BM.*_BM`) carry identical physics values (only FX differ) [A].

### 3. Hand-out logic [S]

- **Setup.** `SubRules_Items.Init`: hooks PlayerAdded/Removed/TeamsCreated/StartNewRound/GoalScored and starts a
  **1 s repeating Actor timer `CheckPlayers`** on the GameEvent (TA:34305-34314). One dispenser per PRI:
  `DispenserArchetype.NewInstance(self)`, `GameEvent.MutateObject`, `Init(PRI, 0)` (TA:34320-34325). Each dispenser
  owns its own pool instance (pool scripts use `Outer` = the dispenser, TA:64772-64774, 64775-64781) [I, high].
- **Clock.** Dispenser time = `GameEvent.TotalGameTimePlayed` (TA:78716), which only advances in `Active` after
  `bBallHasBeenHit` (first touch or the 5 s BallHasBeenHitStartDelay), by `DeltaTime / MatchTimeDilation`
  (TA:4176-4178, 4187-4192). Countdown, replays and pre-touch kickoff time do not count.
- **Init** (TA:78641-78670): first item at `ItemGiveRate + 0` played-seconds (or flag variants: before-round-start →
  next update; on-round-start → at round activation; on-first-ball-hit → at the first hit, Rugby).
- **Update** (every CheckPlayers tick, TA:78719-78743): waiting-for-round → nothing. Car not set up → defer. If the car
  is visible: `GiveItemForRespawn` (re-give the item lost by demolition). If nothing given yet: at
  `played ≥ NextItemTime` → `ItemPool.GiveItem`, `bGiven = true`; else at `played ≥ NextItemPreviewTime` →
  `PreviewItem` (Selection only). Once given: when the car (visible) has no attached pickup (used item ended or
  destroyed) → `NextItemTime = played + ItemGiveRate`, `bGiven = false`. So hand-outs and cooldown starts are
  **quantized to the 1 s timer**.
- **Cycle pool** (TA:64725-64771): RefillPool = FCeil(weight) copies of each entry, then Fisher-Yates shuffle with
  `Rand()` (`ArrayFuncs__ShuffleArray__SpecialPickup_TA`, TA:30388-30400); GiveItem destroys the held item, pops
  RemainingItems[0], applies it, refills when empty. Demolished with an unused item → that item is re-given on
  respawn (TA:78685-78689, 64732-64739, 64769-64771).
- **Selection pool** (TA:64772-64866): RollItems — if Items.Length == ConcurrentItemCount (RPS) all items in fixed
  slots; else 3 draws without replacement by `_Types_TA.PickWeightedRandom` (`FRand() * TotalWeight`, TA:10-25),
  weights restored after. Preview at `NextItemTime − PreviewTimeSeconds` (≥ now + 0.01) (TA:78773-78776); preview
  items can't be used (TA:87293-87305). Using one item destroys the others (TA:87311-87323) and sets the dispenser's
  ItemGiveRate to that item's `CooldownSeconds` (TA:64845-64848). `GiveItem` first resets
  `ItemGiveRate = default.ItemGiveRate` (class default object → 0) (TA:64806-64813) [I: then the per-item cooldown
  always applies]. Goal: remember the remaining cooldown; new round: cooldown = max(original rate, remembered)
  (TA:64775-64787).
- **Goal / new round** (TA:34344-34363, 78744-78772): goal → `bWaitingForNextRound` (unless bDisableGoalDelay). New
  round: dispenser order re-randomized with `Rand()` (TA:34391-34399, stagger 0 so order only matters for
  same-tick ordering); `NextItemTime = played + clamp(int(ItemGiveRate), 1, int(GameTimeRemaining))` (overtime /
  unlimited: remaining 999; overtime uses ItemGiveRate unclamped) — `int()` truncates (TA:78753-78756). Held items die
  with the cars at the goal (`DestroyCars`, notes/camera-respawn-goal.md).
- **Freeplay** (`Mutator_Freeplay_TA`): stops CheckPlayers, spawns a dummy bot, gives the next item whenever the held
  one is gone (TA:70377-70380, 70415-70440) — separate path.

### 4. Clone requirements (determinism / rollback)

State that must be in the server snapshot (and the parts clients predict):
- GameEvent: `TotalGameTimePlayed`, CheckPlayers timer phase (time to next 1 s fire).
- Per dispenser (server only [I]): NextItemTime, NextItemPreviewTime, bGiven, bWaitingForNextRound, ItemGiveRate
  (mutated by Selection), pool state — Cycle: RemainingItems order, LastDispensedItem, DemolishedItem; Selection:
  ActivePickup, CooldownSecondsAtPreviousGoal, DemolishedItems, LastDispensedItems; SubRules: dispenser order.
- RNG: `Rand()` (shuffle, dispenser order) and `FRand()` (Selection rolls) — engine natives UObject::execRand
  0x14035f510 / execFRand 0x140361230 (global C RNG, unseeded per match) [N]. Clone: one seeded PRNG in the server
  state; clients never roll, they receive the item.
- Per car (replicated): RumblePickups {AvailablePickups[3], SelectedIndex, ConcurrentItemCount, AttachedPickup,
  bItemsArePreview, PreviewTimeSeconds}, PickupTimer {TimeTillItem, MaxTimeTillItem}; per pickup: active state,
  ActivityTime, bHasActivated, Targeted, and type internals (spring length/time/hit flags, lasso constant force,
  freeze stored velocities, velcro/rugby weld + AttachTime/BreakTime, grapple attach/blocked timers, tornado
  affected list, swapper target). Car: AddedBallForceMultiplier, AddedCarForceMultiplier, bOverrideBoostOn,
  boost UnlimitedBoostRefCount/bNoBoost, WeldedInfo; Ball: bItemFreeze, sleep state, bIgnoreSyncing.
- Welding (velcro/rugby) needs the engine's weld (ball as a compound child of the car, mass 1) — not in the
  current engine.

### 5. Open questions / to decompile
1. Native ApplyForces bodies (listed in §2) for Spring/Lasso, Freeze, GravityWell, Grapple, Tornado, plus DoSpring /
   GetRelativeImpulse / GetRelativeConstantForce — needed for exact forces.
2. Note F runtime check (empty draws in Slow / BallManipulators / Selection).
3. Whether the 1 s CheckPlayers timer runs on dilated world time (Actor timer — assumed yes) [I].
4. `Car.SetWelding` native path (weld mass/offset handling).
