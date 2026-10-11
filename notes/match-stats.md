# Match stats and scoring (Soccar): spec (static session, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent STAT1. The static session re-checked the shot/save/
red-zone logic (StatFactory_TA.FindShotGoal, UpdateShotGoal, CalculateShotGoal, UpdateRedZone, TA:93023–93110) and the
scorer/assist selection (GameEvent_Soccar_TA.Active.DetermineScoreTouchIndex / DetermineAssistTouchIndex, TA:4152–4175)
against the script. **Text:** stat names, feed/accolade strings and podium titles ship verbatim by user decision (2026-10-10); see
"Stat text" below (§6.3 lists the keys).

Live build 2026-10-06 only (snapshot `rocketleague-20261006`, decrypted packages in `out/bsim/live-20261006/decrypted/`
plus `GameInfo_Tutorial_SF`, `GameInfo_TrainingEditor_SF`, `GameInfo_Default_SF`, `Mutators_SF`, `GameInfo_Breakout_SF`
decrypted with the baked keys into `out/bsim/agents/STAT1/dec/`).

**Tags:** [A] package data (archetypes/defaults/level), [S] UnrealScript, [N] native code (live addresses), [G] GFx/AS3
(HUD1's decompiles), [I] inferred.

**Citations.**
- `TA:<line>` = function header line in `out/bsim/work/tagame_live_all.txt`.
- That dump fails on some functions (array `Find`, array union). For those, `S1:<line>` = the same function in STAT1's
  re-decode `out/bsim/agents/STAT1/work/tagame_stat1.txt`. It uses G3's decoder plus array sub-ops 0x04/0x05
  (`Find`, `FindByProp`, flag byte + u16 skip) and 0x31 (union into a hidden local).
- `[offset]` = bytecode offset inside the function.
- Raw strings stay in the workspace: `work/coalesced_int.txt` (decoded localization), `work/statevents_*.txt`
  (archetype dumps). This spec carries only facts, constants and localization keys.

**Big picture.**
- **Server-only stat computation.** All of Soccar's stat logic is UnrealScript in one actor, `StatFactory_TA`.
  - `GameEvent_Soccar_TA.OnInit` spawns it from `StatFactoryArchetype` (TA:2595). That runs on the authority only:
    `GameEvent_TA.Init` sets `RemoteRole = 1`, TA:849.
  - `StatFactoryBase_TA` is a plain Actor with no replication [A].
- **Natives involved:** the ball's touch-distance accumulator, the goal-volume test (`notes/match-rules-audit.md`), the
  trace for aerial hits, and the car-ball contact callback.
- **What clients receive:** replicated PRI counters and reliable RPCs.

---

## 1. Objects, constants, lifecycle

### 1.1 Archetypes [A]
- **Soccar's StatFactory:** `GameInfo_Soccar_SF: Archetypes.GameEvent.StatFactory`. It is referenced by
  `Archetypes.GameEvent.GameEvent_Soccar.StatFactoryArchetype`.
- **Its `Events` struct (`StatEventCollection`)** points at the `StatEvent_TA` objects:
  - most live in `TAGame.upk` (`StatEvents.Events.*`);
  - Soccar-only ones are exports of `GameInfo_Soccar_SF` (BallHit, CrossbarHits, OwnGoal, the tracking events, …).
- **`BulletHit`/`BulletGoal` are `None` in Soccar.** They are absent from `Events`, and `AllStatEvents` holds `None` in
  their slots. `GiveScore` ignores `None`, so they are never awarded.
  - Side effect: a bullet hit still stamps `SpecialHitTime` (§3.3).

**StatFactory constants** (archetype unless noted):

| Name | Value | Use |
|---|---|---|
| GoalSizeFudge | 100 | shot window margin |
| ShotArriveTime | 1.5 s | shot prediction horizon |
| ShotMaxDistance | 2300 | max ball–goal-centre distance for a shot |
| ShotMaxTime | 3.0 | unused by Soccar logic |
| RedZoneDistance | 2300 | clear/centre zone radius |
| JuggleMinSpeed | 500 | |
| BulletHitSpeed | 3200 | (bullet events disabled) |
| AerialHitHeight | 500 | aerial, high five |
| AerialHitMinRelSpeed | 100 | |
| BicycleSpinSpeed | 250 °/s | |
| LongGoalDistance | 7000 | |
| HatTrick / Playmaker / Savior thresholds | 3 / 3 / 3 | |
| DemolitionThreshold | 7 | extermination |
| ComebackScoreDifference | 3 | Default__StatFactory_TA |
| MinPossessionTimeForSteal | 0.1 | Default (possession modes) |
| CrossbarHitsCooldown | 0.1 s | Default |
| FlipResetBallAerialBuffer | 0.05 s | Default |
| AerialFlipResetHeight | 500 | Default |

**Other constants:**
- **GameEvent_Soccar** [A]: `AssistMaxTime` 5.0. `ImportantStatEvents` = {Win, Loss, Goal, Save, EpicSave}.
- **Goal_TA defaults** [A Default__Goal_TA]: `EpicSaveMinSpeed` 500, `EpicSaveArriveTime` 0.25,
  `SaveCheckDirectionOffset` (1,0,0), `PointsToAward` 1. The Stadium instances don't override these.

### 1.2 `StatEvent_TA` fields [A layout from TAGame class, sizeof 0xc0]
- `Points` int, `CooldownSeconds` float.
- Flags: `bAddToScore` (default **true**), `bIsLeaderboardStat`, `bNotifyTicker` (default **true**), `bShowOnHUD`
  (default **true**), `bPrimaryStat`, `bSkipReplication`, `bCanMute`, `bCountMultiplied`, `bNotifyReceiverOnly`.
- Display and grouping: `Group`, `Texture` (icon), `UISound` (default `StatEvent_Default`), `Label`/`PluralLabel`/
  `Description` (localized).

**Points rule** [S `StatEvent_TA.GetPoints` TA:40192]:
- 0 if `GameEvent.DisableStatXP()`. That only happens through Soccar SubRules (TA:4576); never in standard Soccar.
- Otherwise `Points·Count` if `bCountMultiplied`, else `Points`.

### 1.3 Lifecycle [S]
- **States.** `StatFactory_TA.SetGameEvent` binds the round-active, goal-scored, match-ended and game-state events
  (TA:92872). The factory is in `Active` while `bRoundActive`, `PostGoalScored` after a goal, else `Inactive`
  (TA:93301, 93263).
  - `bRoundActive` is true exactly while the game is in state `Active`: from "go" until a goal or the end
    (`GameEvent_Soccar_TA.Active.BeginState/EndState`, TA:3981/3998).
- **`Active.BeginState`** (TA:93375):
  - enables `Tick` (TickGroup `TG_PostAsyncWork`, i.e. after physics, once per server frame);
  - registers every ball and car;
  - resets `bGaveFirstTouch` and `PendingDemolitionRespawnPRIs`.
- **`Active.EndState`** (TA:93384) unregisters everything. **The per-ball cache (`BallCache`) is rebuilt every
  kickoff.**
- **`RegisterCar`** (TA:92912) calls `PRI.ResetAllStatCooldowns()`. Cooldowns therefore reset at each kickoff and at
  each respawn.
- **`Tick → TickBalls`** (TA:93114). For each cached ball with `Touches.Length > 0 && bCanBeScored &&
  SoccarGame.bGoalsEnabled`, it runs `UpdateShotGoal`, then `UpdateRedZone`.

### 1.4 Touch history [S `Ball_TA.SetBallHitData` TA:11345, `RecordCarHit` TA:11302]
`Ball.Touches` is newest-first, capped at **50**, and cleared by `Ball_TA.Reset` (TA:11290).

**BallHitInfo** layout (0x10c bytes):

| Offset | Field |
|---|---|
| 0x00 | PRI |
| 0x08 | AttackerPRI |
| 0x10 | CarName |
| 0x18 | TeamNum |
| 0x20 | PreHitCarPhysics |
| 0x60 | PreHitBallPhysics |
| 0xa0 | PostHitBallPhysics |
| 0xe0 | **Distance** |
| 0xe4 | Time |
| 0xe8 | HitLocation |
| 0xf4 | HitNormal |
| 0x100 | bDodging / bWheelsTouching / bWorldTouching (bits) |
| 0x104 | HitType |
| 0x108 | HitID |

**Filling a new touch:**
- `PreHitBall` = the ball's `OldRBState`; `PostHitBall` = the current RB state; `PreHitCar` = the car's `OldRBState`.
- `AttackerPRI` = the hitting car's `AttackerPRI`. `Car_TA.BumpCar` sets it on the bumped car, and it clears **0.6 s**
  later (TA:20752, 20322).
- `Time` = `WorldInfo.TimeSeconds`.
- `bDodging` = `IsDodging()`; `bWheelsTouching` = number of wheel world contacts > 0; `bWorldTouching` =
  `WorldContact.bHasContact`.
- `HitID` = `Touches[0].HitID + 1`.
- **Merge rule:** if `Touches[0]` has the same `Time` and the same PRI, it is replaced; otherwise the new hit is
  inserted at index 0.

**Where touches come from:**
- **`Car_TA.OnHitBall`** (TA:20205) records a touch only when ≥ 2 physics frames have passed since the car's previous
  ball contact. `LastBallTouchFrame` updates on every contact frame, so one continuous contact = **one** touch. It also
  does `++PRI.BallTouches` (authority).
- **`Car_TA.HandleWheelContactChanged`** (TA:20106) records a wheel-on-ball touch at most every 0.15 s.
- **`HitType`:** 3 = car (default); 0–2 = Rumble items; 2 is the freeze item → `FreezeSave`.

**`Distance` is native** [N `FUN_140f57950`, ball actor tick override, after the base actor tick `FUN_140757250`].
- On the authority, if `Touches.Length > 0`:
  `Touches[0].Distance += sqrt((X − OldX)² + (Y − OldY)²)`, then `OldLocation = Location` (Ball_TA +0x954).
- So `Distance` is the **horizontal (XY) path length the ball has travelled since that touch**. It stops growing once a
  newer touch is inserted. No script writes it.

---

## 2. Stat table (Soccar)

Column notes:
- **Pts** = `Points`; **Score** = adds to `MatchScore` (`bAddToScore`); otherwise it goes to `MatchBonusXP`.
- **Popup** = the centre popup for the receiver, governed by `bShowOnHUD`, primary/non-primary and the HUD-filter
  (§6.1). The default display level shows only primary events.
- **Ticker** = top-right feed: "all" = broadcast to every player; "rcv" = receiver only; "–" = none.
- **Rep** = how the receiving client learns about it (§7): **RPC** = `ClientNotifyGainedStat` to the owner; **noRPC** =
  `bSkipReplication`, so the client only sees the replicated counter. All counters named `Match*` are replicated
  unless marked (s).
- **Loc** = localization key `StatEvents.int [Events.<Name> StatEvent_TA]` (Label/PluralLabel/Description) unless
  stated.
- Detail for every row is in §3.

| Event (object) | Pts | Score | Popup | Ticker | Counter | Condition (summary) | Rep |
|---|---|---|---|---|---|---|---|
| Goal | 100 | yes | primary | all | MatchGoals | scoring touch = newest attacking-team touch (§3.5) | RPC |
| AerialGoal | 20 | yes | non-primary | all | – | scoring hit is an aerial hit (§3.3) | RPC |
| BackwardsGoal | 20 | yes | non-primary | all | – | scoring hit with the car's rear (§3.3) | RPC |
| BicycleGoal | 20 | yes | non-primary | all | – | scoring hit is a bicycle hit | RPC |
| TurtleGoal | 20 | yes | non-primary | all | – | scorer upside down on a surface | RPC |
| LongGoal | 20 | yes | non-primary | all | – | scoring hit `Distance > 7000` (XY path since that touch) | RPC |
| OvertimeGoal | 25 | yes | non-primary | all | – | `bOverTime` at the goal | RPC |
| HatTrick | 25 | yes | non-primary | all | – | `MatchGoals % 3 == 0` (3, 6, 9 …) | RPC |
| Assist | 50 | yes | primary | all | MatchAssists | §3.5 (5 s window, teammate, pool-shot override) | RPC |
| Playmaker | 25 | yes | non-primary | all | – | `MatchAssists % 3 == 0` | RPC |
| PoolShot | 20 | yes | non-primary | all | MatchPoolShots | defender touched the ball ≤ 0.6 s after an attacker bumped it, then goal | RPC |
| Shot ("Shot on Goal") | 10 | yes | primary | all | MatchShots | §3.4; per touch; 5 s per-player cooldown | RPC |
| Save | 50 | yes | primary | all | MatchSaves | §3.4; 5 s cooldown shared with EpicSave | RPC |
| EpicSave | 75 | yes | primary | all | MatchSaves + MatchEpicSaves | replaces Save (not added to it) | RPC |
| Savior | 25 | yes | non-primary | all | – | `MatchSaves % 3 == 0` | RPC |
| Clear ("Clear Ball") | 20 | yes | non-primary | – | MatchClears | ball leaves own red zone off a defender (§3.6) | RPC |
| Center ("Center Ball") | 10 | yes | non-primary | – | MatchCenters | ball enters opponent red zone off an attacker, not a shot | RPC |
| FirstTouch | 0 | yes (0) | non-primary, no "+N" (passes the 0-point filter because bAddToScore is true) | – | MatchFirstTouches | first touch after each kickoff | RPC |
| BallHit (Soccar pkg) | **2** | yes | no (bShowOnHUD false) | – | – (the separate `BallTouches` counts every recorded touch) | any touch > 1 s after the ball's last awarded BallHit; not the first touch | noRPC |
| CrossbarHits (Soccar pkg) | **2** | yes | no | – | MatchCrossbarHits | ball hits world inside a post/crossbar volume; 0.1 s cooldown; to `Touches[0]` | noRPC |
| AerialHit | 0 | yes (0) | no | – | MatchAerialHits | §3.3 | RPC |
| BicycleHit | 0 | yes (0) | no | all | MatchBicycleHits | §3.3 | RPC |
| JuggleHit ("Juggle") | 0 | yes (0) | no | – | MatchJuggleHits | 3 consecutive juggle hits by one player | RPC |
| Demolish ("Demolition") | **0** | yes (0) | primary (no "+N") | all, with victim | MatchDemolishes | attacker ≠ victim (§3.7) | RPC |
| Demolished | 0 | no | no | – | MatchTimesDemolished | victim side | RPC |
| Demolition ("Extermination") | 20 | yes | non-primary | all | – | `MatchDemolishes % 7 == 0` | RPC |
| LowFive | 5 | yes | non-primary | all | MatchLowFives | post-goal bump of the scorer by a teammate (§3.8) | RPC |
| HighFive | 20 | yes | non-primary | all | MatchHighFives | same, both airborne, bumper ≥ 500 high | RPC |
| OwnGoal (Soccar pkg) | 0 | yes (0) | no | – | MatchOwnGoals (s, not replicated) | last touch by defender and ball not a tracked shot | RPC |
| MVP | 0 | no | primary | all | `bMatchMVP` (repnotify) | §5.3 | RPC |
| Win / Loss | 0 | no | Win: primary / Loss: filtered | Win: all / Loss: – | – | match end, current team members | RPC |
| TimePlayed | 0 (count = seconds) | no | filtered | – | – | match end | RPC |
| FastestGoal / SlowestGoal / FurthestGoal, Most/Fewest Ball Touches & Boost Pickups, CarTouches, BoostPickups, Small/BigBoostsCollected, BoostUsed, Dodges, Distance*, DoubleGrapple, MaxDodgeStreak, PowerUpsUsed, MaxFlipResetStreak, ComebackWin | 0 | no | no | – | MatchStats only | match end (§5.5); feed the podium titles | RPC |
| FlipReset (+ Aerial/Belly variants) | 0 | no | no | **rcv** (FlipReset only) | MatchFlipResets | §3.9 | RPC |
| DemolitionRespawn | 0 | no | no | – | – | victim respawns in the same round | RPC |
| Equalizer / AerialEqualizerGoal | 0 | no | no | – | – | scoring at 0:00 that ties the game | RPC |
| FreezeSave | 0 | no | no | – | – | Rumble only (HitType 2 saver) | RPC |
| CarDemolitionScore / BallDemolitionScore | 25 | yes | no | – | – | **only with a "Demolish score" mutator** | RPC |

**Mode-specific events** (not in standard Soccar):
- **DemolitionSave** 50, ticker yes: fire-ball LTM.
- **Possession*** (Point 5 / Steal 10 / Denial 15 / Clear 50) and **KeepUp*** (Point 5 / Possession 10 /
  Denial 30 / Clear 20): possession and keep-up modes.
- **Blade***: LTM.
- **HoopsSwishGoal** 20: Hoops.
- **BreakoutDamage / BreakoutDamageLarge** ("Ultra Damage"): **Dropshot only**, `StatFactory_Breakout_TA`.
  - 10 points × damage (`bCountMultiplied`); "large" when `TotalDamage ≥ 8`.
  - Damage is also added to `MatchShots` and `MatchBreakoutDamage` (TA:93554).

**Score totals per typical action:**
- Goal 100; plus each goal modifier 20 (overtime 25), plus 25 per hat trick.
- Assist 50; save 50, or epic save 75; shot 10; clear 20; centre 10.
- Each recorded touch is worth +2 at most once per second per ball (not the kickoff first touch).
- Post/crossbar hit +2. Low five 5, high five 20, extermination 20, pool shot 20.
- **Demolitions give 0 points.**

---

## 3. Detection (pseudocode)

### 3.1 `GiveScore` and replication of an award [S TA:92928, PRI_TA TA:80570–80592]
```
StatFactory.GiveScore(ToPRI, Ev, Ball?, HitIdx?, Victim?, Goal?, Count=1):
  if Ev == None or ToPRI == None or ToPRI.Team == None: return
  ToPRI.GiveScore(Ev, Count)
  EventGaveStat(...)                        -> GameEvent_Soccar.HandleGaveStat, MatchBroadcast, Mutator_Score_TA
  BroadcastStatTickerEvent(ToPRI, Victim, Ev)
  # if (SoccarGame != None && !ToPRI.bBot) {}   empty block: bots are treated like humans

PRI.GiveScore(Ev, Count):
  OnGainedStat(Ev, Count)                   # server copy
  if IsClientPlayerPRI() and !Ev.bSkipReplication:  # owner is a remote (non-local) PlayerController
      ClientNotifyGainedStat(Ev, Count)     # reliable client RPC; the client runs OnGainedStat itself

PRI.OnGainedStat(Ev, Count):
  if Ev.bAddToScore: MatchScore   += Ev.GetPoints(GameEvent, Count)
  else:              MatchBonusXP += Ev.GetPoints(GameEvent, Count)
  IncrementStat(Ev, Count)                  # MatchStats[] (StatEvent, Count), FindByProp/insert
  EventStatEvent(self, Ev, Count)           # HUD popup, achievements, sounds

BroadcastStatTickerEvent(Receiver, Victim, Ev):
  if Ev.bNotifyReceiverOnly: Receiver.ClientNotifyStatTickerMessage(Receiver, Victim, Ev)
  elif Ev.bNotifyTicker: for PRI in SoccarGame.PRIs: PRI.ClientNotifyStatTickerMessage(Receiver, Victim, Ev)
```
**Time-restricted stats** [S `PRI_TA.TryAwardTimeRestrictedStat`, TA:80564 / S1:83644]:
```
if Stat == None: false
if Stat.CooldownSeconds <= 0: true
i = StatCooldowns.FindByProp('Stat', Stat)
if i == -1: add {Stat, UnlockWorldTime = now + CooldownSeconds}; true
if StatCooldowns[i].UnlockWorldTime <= now: UnlockWorldTime = now + CooldownSeconds; true
false
```
Only Save and Shot have `CooldownSeconds` = 5.0 [A]. `IsEpicSave` is tested **after** the Save cooldown passes, so
saves and epic saves share one per-player 5 s cooldown.

### 3.2 Goal frame (Stadium) [A Stadium_P, S `Goal_TA.Init` TA:63562, `GetSaveCheckDirection` TA:63599]
**How `Goal_TA.Init` builds the frame:**
- `Location`/`Rotation` come from the `GoalOrientation` PointInSpace actor.
- `LocalExtent` = |half-extent of the GoalVolume's components bounding box| projected on the goal axes.
- `Location.Z` = the box mid-height.
- `WorldFrontCenter` = box centre + `Direction·LocalExtent.X`.
- `SaveCheckDirection` = `Normal((1,0,0)) >> Rotation`.

| Goal | TeamNum | Location | Rotation (yaw) | SaveDir | LocalExtent (depth, half-width, half-height) | WorldFrontCenter |
|---|---|---|---|---|---|---|
| Blue | 0 | (0, −5120, 312) | 16384 | (0, +1, 0) | (456, 960, 376) | (0, −5120, 312) |
| Orange | 1 | (0, 5120, 312) | −16384 | (0, −1, 0) | (456, 960, 376) | (0, 5120, 312) |

- **Volume box:** x ±960, |y| 5120–6032, z −64…688 (agrees with `notes/match-rules-audit.md`).
- **Ball radius:** `Ball.Radius` = collision bounds extent Z = 95.49 (per that audit) [I].
- **Projection:** `CalculateGravityPosition(P, V, g, t) = P + V·t + ½·g·t²·(0,0,1)` [S Core `Object.CalculateGravityPosition`].
  `g = Ball.GetGravityZ()`, −650 in standard Soccar [I].
- **`OnMyHalf(Loc, Team)`** [S TA:3198]: the closest goal by squared distance, with +100 added to the other teams'
  goals, must belong to `Team`. In Stadium this is the goal team's half, y = 0 counting for both.
- **`IsBallBehindGoal(B, G)`** [S TA:93039] = `((G.WorldFrontCenter − (B.Loc + Dir·R))·Dir) > 0`, i.e. the whole
  ball is past the goal line (|y| > 5120 + R).

### 3.3 Per-touch stats [S `StatFactory_TA.OnCarTouch` TA:93127]
```
OnCarTouch(Ball, Car, HitType):                  # bound to Ball.EventCarTouch, fired by RecordCarHit
  if !Ball.bCanBeScored: return
  Hit = Ball.Touches[0]
  BallCache[BallIdx].RedZoneHitID = 0            # BallIdx is still 0 here (script bug; single ball: harmless)
  IsBackwardsHit(Hit)                            # result discarded
  if !bGaveFirstTouch: bGaveFirstTouch = true; GiveScore(Hit.PRI, FirstTouch); ++MatchFirstTouches; return
  c = BallCache[GetBallIndex(Ball)]
  if Hit.Time - c.BallHitTime > 1:   GiveScore(Hit.PRI, BallHit); c.BallHitTime = Hit.Time
  if Hit.Time - c.SpecialHitTime > 0.5:          # evaluated once; the checks below all run
     if IsBulletHit(Hit):  GiveScore(BulletHit) [None in Soccar];   c.SpecialHitTime = Hit.Time
     if IsBicycleHit(Hit): GiveScore(BicycleHit); ++MatchBicycleHits; c.SpecialHitTime = Hit.Time
     if IsAerialHit(Hit):  GiveScore(AerialHit);  ++MatchAerialHits;  c.SpecialHitTime = Hit.Time
     if IsJuggleHit(Hit):
        n = 1; minT = max(c.JuggleTime, c.GroundHitTime)
        for i = 1.. while i < Touches.Length and n < 3:
           if Touches[i].PRI != Hit.PRI or Touches[i].Time <= minT or !IsJuggleHit(Touches[i]): break
           n++
        if n >= 3: GiveScore(JuggleHit); c.JuggleTime = now; c.SpecialHitTime = Hit.Time; ++MatchJuggleHits
OnBallHitWorld(Ball, HitLoc, HitNormal): if HitNormal.Z > 0.1: c.GroundHitTime = now     # TA:93123
```
**Hit predicates** [S TA:92971–93020]; all use the stored `BallHitInfo` (pre-hit states):
- **IsAerialHit:**
  - false if `bWheelsTouching || bWorldTouching || PreHitCar.Z < 500`;
  - false if `|PreHitCar.V − PreHitBall.V| < 100`;
  - else `IsLocationFarOffGround(PreHitCar.Loc)` = `FastTrace(Loc − (0,0,500), Loc)`: **no world geometry within
    500 uu straight below the car centre** (line trace, bTraceComplex; native `AActor::execFastTrace` 0x14089c5b0).
- **IsBicycleHit:**
  - false if `bWheelsTouching || !bDodging`;
  - `ω_local = PreHitCar.AngVel << Rot(PreHitCar.Quat)`; false if `−ω_local.Y·57.2958 < 250` (needs a nose-up/backward
    pitch rate ≥ 250 °/s; in UE axes, nose-up = ω about the right axis < 0);
  - `off = HitLocation − PreHitCar.Loc`; false if `Fwd·off < 0 || Up·off < 0` (the contact must be in the front-upper
    quadrant);
  - else true.
- **IsJuggleHit:** `PreHitCar.Z < PreHitBall.Z && PostHitBall.V.Z ≥ 500`.
- **IsTurtleHit:** `Hit.PRI.Car.WorldContact.bHasContact` (the car's **current** body contact) and contact
  `Normal.Z > 0.707`, and `|Roll(PreHitCar.Quat)| > 16384` (beyond 90°).
- **IsBackwardsHit:**
  - requires `!bDodging && PRI != None`;
  - `Rear = −Forward(PreHitCar.Quat)`; `RearPt = PreHitCar.Loc + Rear·40`;
  - true if `(HitLocation − RearPt)·Rear > 0 && Rear·HitNormal < 0`. The hit point lies > 40 uu behind the car centre
    along its axis. It is not a velocity test.
- **IsBulletHit:** `|PreHitBall.V − PostHitBall.V| ≥ 3200`.

### 3.4 Shots and saves [S `FindShotGoal` TA:93023, `CalculateShotGoal` TA:93075, `UpdateShotGoal` TA:93043, `IsEpicSave` TA:92957]
These run **every server tick** once the ball has been touched, not only at touch time.
```
FindShotGoal(B):                      # first goal that passes, in SoccarGame.Goals order
  for G in Goals:
    d = G.SaveDir; v = B.Velocity·(−d)                       # speed toward the goal
    if v > 0 and OnMyHalf(B.Loc, G.TeamNum) and !IsBallBehindGoal(B, G):
       dist = (B.Loc − G.Location)·d
       t = max(dist, 0) / v
       if t < 1.5 and |B.Loc − G.Location| < 2300:
          P = B.Loc + B.V·t + ½·g·t²·ẑ ;  L = (P − G.Location) << G.Rotation
          if −(960+100) < L.Y < 960+100 and L.Z < 376+100: return G   # |x| < 1060, z < 788; no lower z limit, no depth test
  return None

UpdateShotGoal(i):                    # c = BallCache[i]
  S = FindShotGoal(B); if S == c.ShotGoal: return
  PRI = Touches[0].PRI; T = Touches[0].TeamNum
  # 1) a tracked shot stopped being a shot without going in -> save
  if c.ShotGoal != None and !IsBallBehindGoal(B, c.ShotGoal) and T == c.ShotGoal.TeamNum
     and PRI.TryAwardTimeRestrictedStat(Save):
        if IsEpicSave(B, Touches[0], c.ShotGoal): GiveScore(PRI, EpicSave); ++MatchEpicSaves
        else GiveScore(PRI, Save)
        if Touches[0].HitType == 2: GiveScore(PRI, FreezeSave)
        c.SaveTime = Touches[0].Time; ++MatchSaves
        if MatchSaves % 3 == 0: GiveScore(PRI, Savior)
  # 2) new shot
  if S != None:
     if T != S.TeamNum:                       # last toucher attacks S
        c.ShotGoal = S
        if c.ShotTime != Touches[0].Time:     # one shot per touch
           c.ShotTime = Touches[0].Time
           if PRI.TryAwardTimeRestrictedStat(Shot): ++MatchShots; GiveScore(PRI, Shot)
     # else: defender's own-direction trajectory: c.ShotGoal left unchanged
  else: c.ShotGoal = None

IsEpicSave(B, H, G):                  # H = Touches[0] (the saving touch)
  D = (H.PreHitBall.Loc − G.Location)·G.SaveDir − B.Radius
  if D <= 0: return true                       # ball already touching the goal-line plane
  if !H.bWheelsTouching or |H.PreHitCar.V| > 500:
     s = H.PreHitBall.V·(−G.SaveDir); if s > 0: return D/s <= 0.25
  return false
```
**Consequences:**
- **The save goes to the last toucher** at the moment the trajectory stops projecting into the goal, only if that
  player is on the defending team.
- **No save when the trajectory changes without a defender touch:** e.g. off the post (last toucher an attacker), or
  when the ball goes in.
- **Shot timing:** a "shot" can be credited after a wall bounce if the trajectory starts qualifying later. It is
  credited to the last toucher only if they are on the attacking side.

### 3.5 Goal, scorer, assist, own goal, pool shot
**Score and assist indices** [S `GameEvent_Soccar_TA.Active.HandleHitGoal` TA:4061; `DetermineScoreTouchIndex` TA:4152;
`DetermineAssistTouchIndex` TA:4161]:
```
ScoreIdx  = first i (newest first) with Touches[i].TeamNum != Goal.TeamNum, else 0       # -1 if no touches
AssistIdx = DetermineAssistTouchIndex(ScoreIdx):
  maxT = Touches[ScoreIdx].Time − 5.0
  for i = ScoreIdx+1 ..:
     if Touches[i].PRI == scorer.PRI: continue          # the scorer's own earlier touches are skipped
     if Touches[i].TeamNum != scorer.TeamNum: continue  # opponent touches are skipped, they do NOT cancel the assist
     if Touches[i].Time < maxT: return −1
     return i
  return −1
```

**Order of `HandleHitGoal`** (server, Active state):
1. Points: `GoalAmount = Goal.PointsToAward (1) + Ball.GetGoalScorePoints()`; a score mutator may override.
2. `Ball.Explode`.
3. `Team.ScorePoint(GoalAmount)`; `TeamLastScored` is set.
4. If the scorer is an attacker: `ScorerPRI.ScorePoint` (the engine `PRI.Score`), the banner via
   `GoalScoredMessage` (TAGame.int `[Messages] GoalScored`, "{Player} scored"), `ClientScoredGoal`.
   Otherwise the team banner, `bShowNoScorerGoalMessage` = true.
   The banner is suppressed in offline freeplay (`ShowScorerGoalMessage`, TA:4592).
5. `ReplayDirector.GoalScored(…, ScoreIdx, AssistIdx)`.
6. **`EventGoalScored` → `StatFactory.OnGoalScored`.**
7. Fastest, slowest and furthest goal tracking.
8. `PostGoalScored`.

**`OnGoalScored`** [S TA:93229]:
```
OnGoalScored(Ball, Goal, ScoreIdx, AssistIdx):
  UpdateComebackTeams()                 # teams trailing the last scorer by >= 3 are remembered (ComebackWin)
  if ScoreIdx == −1: return
  t0 = Touches[0]; Assister = None
  if t0.AttackerPRI != None and team(t0.AttackerPRI) != Goal.TeamNum and team(t0.AttackerPRI) != t0.TeamNum:
       GiveScore(t0.AttackerPRI, PoolShot); ++MatchPoolShots          # bumper on the scoring team
       if t0.AttackerPRI != Touches[ScoreIdx].PRI: Assister = t0.AttackerPRI
  if t0.TeamNum == Goal.TeamNum and BallCache.ShotGoal == None:
       ++t0.PRI.MatchOwnGoals; GiveScore(t0.PRI, OwnGoal)   # defender last touch while not a tracked shot
  H = Touches[ScoreIdx]
  if H.TeamNum == Goal.TeamNum: return                       # only defenders touched: nobody gets Goal/Assist
  ScoringPRI = H.PRI
  for E in GetStatEventsForGoalHit(H): GiveScore(H.PRI, E)   # order below
  ++H.PRI.MatchGoals; if MatchGoals % 3 == 0: GiveScore(H.PRI, HatTrick)
  if Assister == None and AssistIdx != −1: Assister = Touches[AssistIdx].PRI
  if Assister: ++MatchAssists; GiveScore(Assister, Assist); if MatchAssists % 3 == 0: GiveScore(Assister, Playmaker)

GetStatEventsForGoalHit(H) = [Goal] + [BackwardsGoal if IsBackwardsHit] + [BulletGoal (None)] + [BicycleGoal if IsBicycleHit]
   + [AerialGoal if IsAerialHit] + [TurtleGoal if IsTurtleHit] + [LongGoal if H.Distance > 7000]
   + [OvertimeGoal if bOverTime] + [AerialEqualizerGoal | EqualizerGoal if IsEqualizerGoal]     # TA:93205
IsEqualizerGoal = !bUnlimitedTime and !bOverTime and GameTimeRemaining <= 0 and GetWinningTeam() == None   # TA:107161
```
**Notes:**
- **Deflections.** In a deflected shot the attacker keeps the Goal. The defender also gets the hidden OwnGoal stat
  unless the ball was a tracked shot at that moment.
- **Replay banner assist.** The replay's "assisted by" uses `AssistIdx` only (`ReplayDirector_TA.GoalScored`,
  TA:84877), so it can differ from the stat assist on pool shots.

### 3.6 Clear and centre [S `UpdateRedZone` TA:93083, `IsInRedZone` TA:92968]
```
Z = nearest goal G with |B.Loc − G.Location| <= 2300 and !IsBallBehindGoal(B, G), else None
if Z != c.RedZoneGoal:                                  # zone changed this tick
   PRI = Touches[0].PRI; T = Touches[0].TeamNum
   if c.RedZoneGoal != None and T == c.RedZoneGoal.TeamNum and PRI != c.RedZonePRI and Touches[0].Time > c.SaveTime:
        GiveScore(PRI, Clear); ++MatchClears            # left own zone; last touch a defender who was not the last toucher on entry; after the last save
   if Z != None and c.ShotGoal == None and T != Z.TeamNum and Touches[0].HitID != c.RedZoneHitID:
        GiveScore(PRI, Center); ++MatchCenters          # entered opponents' zone off an attacker; not already a shot (UpdateShotGoal ran first this tick)
   c.RedZoneGoal = Z; c.RedZonePRI = (Z != None ? PRI : None); c.RedZoneHitID = Touches[0].HitID
```
The red zone is a **sphere** of radius 2300 around (0, ±5120, 312); there are no directional tests.

### 3.7 Demolitions [S `OnCarDemolished` TA:93267; bound in Active and PostGoalScored]
```
A = Data.AttackerPRI ?? Car_TA(Data.Attacker).PRI ?? Victim.AttackerPRI
if A != None and A != Victim.PRI:
   ++A.MatchDemolishes; GiveScore(A, Demolish, Victim=Victim.PRI)    # ticker row "A [icon] Victim"
   GiveScore(Victim.PRI, Demolished); PendingDemolitionRespawnPRIs.AddUnique(Victim.PRI); ++Victim.MatchTimesDemolished
   if A.MatchDemolishes % 7 == 0: GiveScore(A, Demolition)          # Extermination, 7/14/21…
   car = Victim.DemolishSource < 2 (None/Car, not Ball); if car: ++A.CarDemolitions
   if GetScorePointsForStatEvent(Demolish) > 0: GiveScore(A, car ? CarDemolitionScore : BallDemolitionScore)   # mutator only
++Victim.PRI.SelfDemolitions                                          # unconditional (script quirk)
Active.HandlePlayerRestarted(Car): RegisterCar; if PendingDemolitionRespawnPRIs.RemoveItem(Car.PRI): GiveScore(DemolitionRespawn)
```
There is no team check: in normal Soccar, car demolitions only hit opponents (`DemolishTarget`). Teammates can't be
credited.

### 3.8 Low five / high five [S `PostGoalScored.HandleBumpedCar` TA:93438, `InitiatorFiveHitType` TA:93454 / S1:97004]
They are counted only in StatFactory state `PostGoalScored` (after a goal, until the replay or kickoff). They are fed
by `Car.EventBumpedCar` from `Car_TA.BumpCar` (a valid bump that passes the bump-interval checks).
```
type(Initiator, Receiver):
  if Receiver.PRI != ScoringPRI: 0              # must bump the goal scorer (not an own-goal toucher)
  if Receiver.PRI.Team != Initiator.PRI.Team: 0
  if Initiator in CarsIssuedAnyFiveHit: 0       # once per car per goal
  if Receiver/Initiator.IsAffectedByExplosionHitHandler(): 0   # only "pull" goal explosions
  if Initiator.Z >= 500 and !Initiator.WorldContact and !Initiator.bOnGround and !Receiver.WorldContact
     and !Receiver.bOnGround and IsLocationFarOffGround(Initiator.Loc): 2 (HighFive)
  else 1 (LowFive)
```
### 3.9 Crossbar/post, flip reset, end of match
- **Post/crossbar** [A Stadium_P `GoalCrossbarVolume_TA` ×6; S `GoalCrossbarVolumeManager_TA.TriggerHit` TA:63676,
  `OnBallHitCrossbar` TA:93364]:
  - Crossbar boxes: centre (3.2, ±5120, 626.8), half-extent (967.7, 65.6, 65.6).
  - Posts: centres x −892.8 / +899.2, z 322.8, half-extent (≈68.8, ≈68.8, ≈366).
  - Trigger: while the ball overlaps a volume, a world hit whose location is inside it fires `EventCrossbarHit`.
  - Then: skip if within 0.1 s of the last crossbar hit or in replay; else `GiveScore(Touches[0].PRI, CrossbarHits)`
    (+2 to the last toucher of **either** team).
- **Flip reset** [S TA:101233]: wheel contact with a ball, car and ball both without world contact, and the ball
  ≥ 0.05 s since its grounded state changed.
  - Gives FlipReset; BellyFlipReset if the car is below the ball; AerialFlipReset at car z ≥ 500.
  - All are score-less.
- **Match end** [S `OnMatchEnded` TA:93353 / S1:96836, in `EndGame` after the MVP is set]:
  - Win (+ComebackWin) goes to the winning team's current members and Loss to the others.
  - Then: DeterminePickupCounts and DetermineTouchCounts (most/fewest; boost "most" only if > 10× fewest).
  - Then: TimePlayed per member (count = seconds).
  - Then: MVP; Furthest/Fastest/Slowest goal (count = value/100); the per-PRI totals.

---

## 4. Ordering summary per server frame [S/I]
1. **Physics.**
2. **Car-ball contacts.** `OnHitBall` → `RecordCarHit` → `OnCarTouch` (first touch, BallHit, specials, juggle).
3. **Native ball tick** adds the XY step to `Touches[0].Distance` [N 0x140f57950].
4. **Goal test** [N, match-rules audit] → `HandleHitGoal` → `OnGoalScored`.
5. **`StatFactory.Tick`** (`TG_PostAsyncWork`) → `UpdateShotGoal` (saves, then shots) → `UpdateRedZone` (clear, then
   centre).

**Unverified order** [I]: whether the ball's tick (3) runs before the StatFactory's tick (5) in the same frame. It only
shifts Distance by one frame.

---

## 5. Score, scoreboard, MVP, accolades

### 5.1 Points
- **`MatchScore`** = Σ `GetPoints` over the PRI's awards with `bAddToScore` (the table in §2). It is replicated; the
  client also adds on each RPC'd event, and replication reconciles.
- **`MatchBonusXP`** collects the rest (all 0 in Soccar).
- **Team score** (goals) is separate: `Team.ScorePoint(1 + ball bonus)`.
- **Private-match mutators** "Assist score N" / "Demolish score N" (`Mutator_Score_TA`, TA:70692) add N **team goals**
  (and PRI.Score) per Assist/Demolish, ignoring same-team victims. The Demolish variant also enables the 25-point
  Car/BallDemolitionScore events.

### 5.2 Scoreboard [S `PRI_TA.GetCustomScoreboardStats` TA:106807, `GetCustomStatsData` TA:106812, `GetScoreboardStats` TA:81148; A `Default__ProfileScoreboardSave_TA`; G HUD `ScoreboardRenderer`]
- **Columns:** name (with title, rank/MMR, party, club tag), then **5 stat fields** = `MatchScore` + 4 custom stats,
  then **ping**.
  - Custom stats per mode come from the viewer's `ProfileScoreboardSave_TA`. Soccar default = Goals, Assists, Saves,
    Shots; Dropshot replaces Shots with BreakoutDamage.
  - `bSupportsCustomScoreboard` is true by default [A].
  - The selectable list is `ECustomScoreboardStat` 1–24: Goal, Assist, Save, EpicSave, Shot, Center, Clear,
    AerialHit, BicycleHit, JuggleHit, Demolish, FirstTouch, PoolShot, LowFive, HighFive, FlipReset, BreakoutDamage,
    BallHit (= `BallTouches`), Demolished, Dodges, CrossbarHits, CarTouches, BoostPickups, PowerupsUsed.
- **Fallback** without a custom save: Score, Goals, Assists (**Demolitions in 1v1**: playlist PlayerCount 2 or
  MaxTeamSize 1), Saves, Shots (TA:81156).
- **Ping:** `min(ping, 999)`; colour bands > 250 red, 201–250 orange, 101–200 yellow, ≤ 100 green [G HUD
  ScoreboardRenderer.setPing].
  - The legacy `GFX_MidGameScoreboard` movie uses 150/100/50; it is not the live one [G].
- **Sort** within each team: `GameEvent_Soccar_TA.ScoreboardSort = MVPSort` (TA:3340; used by `GFxHUD_TA` UpdatePRIData,
  TA:61798). The order is MatchScore desc, then MatchGoals, MatchAssists, MatchSaves desc. Full ties are unordered [I].
- **MVP icon:** shown in the row when `bMatchMVP`; the animation starts 1.75 s after it is set [G].

### 5.3 MVP [S `GetMVP` TA:3338 / S1:3585, `MVPSort` TA:3327, `EndGame` TA:2794]
```
EndGame: MatchWinner = GetWinningTeam(); MVP = GetMVP(MatchWinner); if MVP: MVP.NotifyWonMVP()   # bMatchMVP = true (repnotify), lightbar strobe
GetMVP(W): All = W.Members ∪ W.FormerMembers            # players who left the winning team still count
           if MaxTeamSize > 1 and All.Length > 0: return Sort(All, MVPSort)[0]   # descending
           return None
```
- **Winning team only.** No MVP for the losing team, in **1v1** (MaxTeamSize 1), or with no winner (no-contest).
- **Bots are eligible.**
- `GetWinningTeam`: a forfeit makes the other team win; overtime ties are decided by `OvertimeComponent.PickWinner`.
- **Ties:** score → goals → assists → saves. A full tie goes to the first in the sorted array; sort stability is
  unknown [I].
- The **MVP stat event** (0 pts, popup + ticker) is given in `OnMatchEnded`.
- The podium orders winners by `MVPSort` (`InitPodiumCars`, TA:4420).

### 5.4 End-of-match accolades (podium titles) [S `PrePodiumSpotlight.UpdateSpotlight` TA:4366 / S1:4625, `StatTitle_TA.GetNumPoints` TA:93788, `MemberTitleSort` TA:4358; A GameInfo_Soccar_SF `Archetypes.StatTitles.*`]
They are computed on entering `PrePodiumSpotlight`, which happens only when there is a match winner.

**Scoring a title for a player:**
- A `StatTitle` applies if the player's `MatchStats` has its `Stat` with `Min ≤ Count ≤ Max` (Max 0 = none).
- `Points = int((bPerStat ? (bInverseStat ? P·(Max − Count) : P·Count) : P) · CategoryMultiplier)`.
- `StatCount` = 1 if `bClampStatToOne`, else `Count`.

**Assigning titles:**
- Gather every (title, member) pair for **all members of both teams** and sort by Points descending.
- Two passes (primary, then secondary): walk the list greedily.
  - A member gets at most one title per pass.
  - A title name is used once overall: assigned titles are removed for the next pass.
- Results land in `PRI.PrimaryTitle`/`SecondaryTitle` (replicated, repnotify).
- Display text: localization `StatTitles.int [<Category>] <PrimaryTitle key>`, plus the stat value and the stat's
  Label/PluralLabel, with unit conversion for distance and speed (`GFxData_PRI_TA.InitStatTitle`, TA:51666).

**Categories** (multiplier): StatSingleInstance ×4, StatCompound ×3, StatStandard ×2, StatTracking ×0.01.

| Category | Title key (stat, P, Min–Max) |
|---|---|
| SingleInstance | OvertimeGoal (OvertimeGoal, P 10, not per-stat, clamp 1) |
| Compound | Goals_3_5 (Goal 1, 3–5), Goals_6_8 (Goal 1, 6–9), Goals_9 (Goal 1, ≥10), Saves_3_5 (Save 1, 3–5), Saves_6_9 (Save 1, 6–9), Saves_10 (Save 1, ≥10), EpicSaves (EpicSave 2, ≥1), PoolShots (5, ≥1), BackwardsGoal (3, ≥1), BicycleGoal (3, ≥1), AerialGoal (3, ≥1), TurtleGoal (3, ≥1), OwnGoal (4, ≥0), Juggles (JuggleHit 2, ≥1) |
| Standard | Goals, Saves, Assists, Centers, Shots, FirstTouches, Demolitions (each P 1, ≥1) |
| Tracking | MostBoostPickups (20, ≥10), FewestBoostPickups (20), MostBallTouches (5, ≥20), FewestBallTouches (10), CarTouches (20, ≥20), FurthestGoal (6, ≥50 m), FastestGoal (15, ≥20), SlowestGoal (75, inverse, ≤20) |

### 5.5 Match-end tracking values [S `OnMatchEnded`, `DeterminePickupCounts` TA:93307, `DetermineTouchCounts` TA:93329]
- `BoostUsed` count = BoostUsed·100; `DistanceDrivenMeters` = TotalDriveDistanceKM·1000.
- **Fastest/Slowest/Furthest goal** count = value/100 (uu → m, or uu/s → m/s); Slowest is at least 1.
  - Values come from `GameEvent_Soccar` (speed `|v|` at the goal; `GoalHit.Distance`).

---

## 6. On-screen feed (local client)

### 6.1 Centre popup [S `GFxHUD_TA.HandleStatEvent` TA:61573, `CanDisplayStatEvent` TA:61584; G HUD `StatEventView`/`StatEventPopUp`; HUD-9]
**Source.** `OwnerPRI.EventStatEvent` (`SetOwnerPRI`, TA:61121): only the **local player's own** awards.

**Filter** (any match drops the popup):
- `!bShowOnHUD`;
- `!CanDisplayStatEvent` (setting `ShowInGameStats` / `StatEventDisplayLevel`: None → nothing; **Primary (default)** →
  `bPrimaryStat` only; All → all);
- a secondary split-screen player in a full-screen event;
- `bCanMute && HUDMessageThreshold > 0` (setting `HUDMessageLevel` "Match Notifications" not All);
- `points == 0 && !bNotifyTicker && !bAddToScore`.

**Primary events:** Goal, Assist, Save, EpicSave, Shot, Demolish, MVP, Win.

**Data and display:**
- Data: label = `StatEvent.Label` (localized, uppercase), points = `GetPoints` ("+N" only if > 0), icon = `Texture`,
  sound = `UISound`.
- **Queue:** unbounded FIFO, no priority or merging, one popup at a time. Each popup calls `notifyPopupComplete` on
  frame 80 (`addFrameScript(79)`), so the next starts **79/30 = 2.633 s** later [G]. Timeline per HUD-9.
- **Stacking with the goal banner.** The popup view sits at (W/2, **150**); the goal banner is a `GameMessageView`
  message at (W/2, **250**), held 4 s per HUD-8. They are independent views and queues, so the popup sits above the
  banner.
- Typical goal sequence for the scorer: GOAL +100, then any of BACKWARDS/BICYCLE/AERIAL/TURTLE/LONG/OVERTIME GOAL,
  then HAT TRICK. At the default level only GOAL shows. The assister sees ASSIST +50.

### 6.2 Ticker [S `GFxHUD_TA.HandleStatTickerMessage` TA:61595; G HudMatchInfo `StatTickerView`/`StatTickerRenderer`; HUD-14]
- **Source:** `OwnerPRI.EventStatTickerMessage`, i.e. the RPC on the local PRI. Every player receives every event with
  `bNotifyTicker` (§3.1).
- **Filter:** not split-screen, and `CanDisplayStatEvent` (same display level).
  - At default (Primary): Goal, Assist, Save, EpicSave, Shot, Demolish (with victim), MVP, Win.
  - At All: also the goal modifiers, HatTrick, Playmaker, Savior, PoolShot, Extermination, Low/HighFive, BicycleHit,
    and the receiver's own FlipReset.
- **Row content:**
  - receiver name pill, team-coloured;
  - local player → localized "You" (AS3 `LOCTEXT('You')`), else "[CLUBTAG] NAME", uppercase;
  - the event icon (`Texture` path);
  - victim pill if any. The label text is **not** shown.
- **Layout:** top-right (W − 10, 10); new rows append at y = n·36; max **6** (the oldest fades 0.2 s, the rest slide up
  0.2 s). Each row is removed by a **4000 ms** timer [G `StatTickerRenderer.m_removalTimer`].

### 6.3 Localization keys (paraphrased meaning)
- **`StatEvents.int`:** `[Events.<Name> StatEvent_TA]` Label / PluralLabel / Description for Goal, Assist, Save,
  EpicSave, Shot, Center, Clear, AerialHit, AerialGoal, BackwardsGoal, BicycleHit, BicycleGoal, TurtleGoal, LongGoal,
  OvertimeGoal, HatTrick, Playmaker, Savior, PoolShot, Demolish ("demolition"), Demolition ("extermination"),
  FirstTouch, JuggleHit ("juggle"), MVP, Win, Loss ("completed match"), TimePlayed, Fastest/Slowest/FurthestGoal,
  OwnGoal, Most/FewestBoostPickups, Most/FewestBallTouches, CarTouches, LowFive, HighFive, BreakoutDamage(Large),
  HoopsSwishGoal, FlipReset.
  - The Soccar-package events BallHit and CrossbarHits carry copy-pasted package labels and are never displayed.
- **`StatTitles.int`:** `[StatSingleInstance|StatCompound|StatStandard|StatTracking] <key>` (keys in §5.4).
- **`TAGame.int`** `[Messages] GoalScored` (scorer banner); the replay "scored by" text is HUD-11.


## Stat text (shipped verbatim by user decision, 2026-10-10)

Exact English strings from the decrypted localization (`StatEvents.int`, `StatTitles.int`, `TAGame.int`), keyed by
section and key. The popup and ticker show `Label` upper-cased (§6). Mode-specific events are listed separately.

**Stat events, Soccar-relevant** (`StatEvents.int`):

| Section | Label | PluralLabel | Description |
|---|---|---|---|
| `[Events.AerialGoal StatEvent_TA]` | Aerial Goal | Aerial Goals | Score a goal while in the air |
| `[Events.AerialHit StatEvent_TA]` | Aerial Hit | Aerial Hits | Hit the ball while in the air |
| `[Events.Assist StatEvent_TA]` | Assist | Assists | Pass the ball to a teammate who scores |
| `[Events.BackwardsGoal StatEvent_TA]` | Backwards Goal | Backwards Goals | Score a goal while driving backwards |
| `[Events.BicycleGoal StatEvent_TA]` | Bicycle Goal | Bicycle Goals | Score a goal while flipping backwards |
| `[Events.BicycleHit StatEvent_TA]` | Bicycle Hit | Bicycle Hits | Hit the ball while flipping backwards |
| `[Events.CarTouches StatEvent_TA]` | Car Touch | Cars Bumped | Bump other cars |
| `[Events.Center StatEvent_TA]` | Center Ball | Centered Balls | Pass the ball towards the center of the field |
| `[Events.Clear StatEvent_TA]` | Clear Ball | Cleared Balls | Hit the ball away from your own goal |
| `[Events.Demolish StatEvent_TA]` | Demolition | Demolitions | Destroy another player |
| `[Events.Demolition StatEvent_TA]` | Extermination | Exterminations | Demolish 7 players in a single game |
| `[Events.EpicSave StatEvent_TA]` | Epic Save | Epic Saves | Block a shot on goal that's on the verge of scoring |
| `[Events.FastestGoal StatEvent_TA]` | Goal | Goal | Score the fastest goal |
| `[Events.FewestBallTouches StatEvent_TA]` | Ball Touch | Ball Touches | Avoid the ball |
| `[Events.FewestBoostPickups StatEvent_TA]` | Boost Pickup | Boost Pickups | Avoid boost pickups |
| `[Events.FirstTouch StatEvent_TA]` | First Touch | First Touches | Be the first to touch the ball on kickoff |
| `[Events.FlipReset StatEvent_TA]` | Flip Reset | Flip Resets | Regain your dodge by landing on the ball in the air |
| `[Events.FurthestGoal StatEvent_TA]` | Goal | Goal | Score the furthest goal |
| `[Events.Goal StatEvent_TA]` | Goal | Goals | Hit the ball into the opponent's goal |
| `[Events.HatTrick StatEvent_TA]` | Hat Trick | Hat Tricks | Score 3 goals in a single game |
| `[Events.HighFive StatEvent_TA]` | High Five | High Fives | Give a high-flying congratulatory bump to your team's goal-scorer after the goal. |
| `[Events.JuggleHit StatEvent_TA]` | Juggle | Juggles | Keep the ball in the air with multiple hits |
| `[Events.LongGoal StatEvent_TA]` | Long Goal | Long Goals | Score a goal from a great distance |
| `[Events.Loss StatEvent_TA]` | Completed Match | Losses |  |
| `[Events.LowFive StatEvent_TA]` | Low Five | Low Fives | Give a congratulatory bump to your team's goal-scorer after the goal. |
| `[Events.MVP StatEvent_TA]` | MVP | MVPs | Earn the highest score in a match and win |
| `[Events.MostBallTouches StatEvent_TA]` | Ball Touch | Ball Touches | Touch the ball |
| `[Events.MostBoostPickups StatEvent_TA]` | Boost Pickup | Boost Pickups | Get boost pickups |
| `[Events.OvertimeGoal StatEvent_TA]` | Overtime Goal | Overtime Goals | Score a goal after regulation time has ended |
| `[Events.OwnGoal StatEvent_TA]` | Own Goal | Own Goals | Score a goal on your own net |
| `[Events.Playmaker StatEvent_TA]` | Playmaker | Playmakers | Score 3 assists in a single game |
| `[Events.PoolShot StatEvent_TA]` | Pool Shot | Pool Shots | Hit an opponent into the ball to score a goal |
| `[Events.Save StatEvent_TA]` | Save | Saves | Block a shot on goal |
| `[Events.Savior StatEvent_TA]` | Savior | Saviors | Block 3 shots on goal in a single game |
| `[Events.Shot StatEvent_TA]` | Shot on Goal | Shots on Goal | Hit the ball towards the opponent's goal |
| `[Events.SlowestGoal StatEvent_TA]` | Goal | Goal | Score the slowest goal |
| `[Events.TimePlayed StatEvent_TA]` | Time Played | Time Played | Time Played in a match |
| `[Events.TurtleGoal StatEvent_TA]` | Turtle Goal | Turtle Goals | Score a goal while laying on back |
| `[Events.Win StatEvent_TA]` | Win | Wins | Win a match |

**Stat events, other modes or not shown in Soccar** (for completeness):

| Section | Label | PluralLabel | Description |
|---|---|---|---|
| `[Events.BreakoutDamage StatEvent_TA]` | Damage | Damage | Hit a tile with the ball in its first or second phase |
| `[Events.BreakoutDamageLarge StatEvent_TA]` | Ultra Damage | Ultra Damage | Hit a tile with the ball in its third and final phase |
| `[Events.BulletGoal StatEvent_TA]` | Bullet Goal | Bullet Goals | Score a goal with a really hard hit |
| `[Events.BulletHit StatEvent_TA]` | Bullet Hit | Bullet Hits | Hit the ball really hard |
| `[Events.HoopsSwishGoal StatEvent_TA]` | Swish Goal | Swish Goals | In Hoops, score a goal without the ball hitting anything on the way in |
| `[Events.KO_AerialHeavyHit StatEvent_TA]` | Aerial Heavy Attack | Aerial Heavy Attacks | In Knockout, attack an opposing player in the air while traveling at supersonic speed |
| `[Events.KO_AerialLightHit StatEvent_TA]` | Aerial Light Attack | Aerial Light Attacks | In Knockout, attack an opposing player in the air while traveling below supersonic speeds |
| `[Events.KO_BlockTaken StatEvent_TA]` | Block Taken | Blocks Taken | Total number of your attacks that have been blocked by opposing players in Knockout mode |
| `[Events.KO_Death StatEvent_TA]` | Death | Deaths | Total number of times you have been destroyed in Knockout mode  |
| `[Events.KO_DoubleKO StatEvent_TA]` | Double KO | Double KOs | In Knockout mode, score two KOs within a short period of time |
| `[Events.KO_Grabbed StatEvent_TA]` | Grabbed | Grabbed | Total number of times an opposing player has grabbed you in Knockout mode |
| `[Events.KO_HeavyBlock StatEvent_TA]` | Heavy Block | Heavy Blocks | In Knockout, block an opposing player's Heavy Attack |
| `[Events.KO_HeavyHit StatEvent_TA]` | Heavy Attack | Heavy Attacks | In Knockout, attack an opposing player while traveling at supersonic speed |
| `[Events.KO_HitTaken StatEvent_TA]` | Attacks Taken | Attacks Taken | Total number of attacks you have taken in Knockout mode |
| `[Events.KO_Knockout StatEvent_TA]` | Knockout | Knockouts | In Knockout, destroy an opposing player |
| `[Events.KO_KnockoutAssist StatEvent_TA]` | KO Assist | KO Assists | In Knockout, attack or throw an opponent shortly before they are destroyed by another player |
| `[Events.KO_LightBlock StatEvent_TA]` | Light Block | Light Blocks | In Knockout, block an opposing player's Light Attack |
| `[Events.KO_LightHit StatEvent_TA]` | Light Attack | Light Attacks | In Knockout, attack an opposing player while traveling below supersonic speed |
| `[Events.KO_MassKO StatEvent_TA]` | Mass KO | Mass KOs | In Knockout mode, score four or more KOs within a short period of time |
| `[Events.KO_PlayerGrabbed StatEvent_TA]` | Opponent Grabbed | Opponents Grabbed | In Knockout, grab an opposing player  |
| `[Events.KO_PlayerThrown StatEvent_TA]` | Opponent Thrown | Opponents Thrown | In Knockout, throw an opposing player shortly after grabbing them |
| `[Events.KO_Thrown StatEvent_TA]` | Thrown | Thrown | Total number of times an opposing player has thrown you in Knockout mode |
| `[Events.KO_TripleKO StatEvent_TA]` | Triple KO | Triple KOs | In Knockout mode, score three KOs within a short period of time |
| `[Events.KO_Winner StatEvent_TA]` | KO Win | KO Wins | Win matches in Knockout mode |

**Podium titles** (`StatTitles.int`; selection rules in §5.4):

| Section | Key | Title |
|---|---|---|
| `[StatSingleInstance]` | `OvertimeGoal` | Finisher |
| `[StatCompound]` | `Goals_9` | Force of Nature |
| `[StatCompound]` | `Goals_6_8` | Ace |
| `[StatCompound]` | `Goals_3_5` | Prodigy |
| `[StatCompound]` | `Saves_10` | Savior |
| `[StatCompound]` | `Saves_6_9` | Protector |
| `[StatCompound]` | `Saves_3_5` | Warden |
| `[StatCompound]` | `EpicSaves` | Guardian Angel |
| `[StatCompound]` | `PoolShots` | Calculator |
| `[StatCompound]` | `BackwardsGoal` | Show-off |
| `[StatCompound]` | `BicycleGoal` | Acrobat |
| `[StatCompound]` | `AerialGoal` | Aviator |
| `[StatCompound]` | `TurtleGoal` | Turtle |
| `[StatCompound]` | `OwnGoal` | Traitor |
| `[StatCompound]` | `Juggles` | Juggler |
| `[StatStandard]` | `Goals` | Scorer |
| `[StatStandard]` | `Saves` | Goalkeeper |
| `[StatStandard]` | `Assists` | Playmaker |
| `[StatStandard]` | `Centers` | Tactician |
| `[StatStandard]` | `Shots` | Striker |
| `[StatStandard]` | `FirstTouches` | Aggressor |
| `[StatStandard]` | `Demolitions` | Executioner |
| `[StatTracking]` | `MostBoostPickups` | Speed Demon |
| `[StatTracking]` | `FewestBoostPickups` | Hoarder |
| `[StatTracking]` | `MostBallTouches` | Ball Hog |
| `[StatTracking]` | `FewestBallTouches` | Benchwarmer |
| `[StatTracking]` | `CarTouches` | Enforcer |
| `[StatTracking]` | `FurthestGoal` | Sniper |
| `[StatTracking]` | `FastestGoal` | Power Hitter |
| `[StatTracking]` | `SlowestGoal` | Slowpoke |

**Goal banner** (`TAGame.int [Messages] GoalScored`): `{Player} scored!`


---

## 7. Networking (what to send)
**Server (authority) only:** StatFactory, touch history, shot/save/zone caches, `MatchStats`, `MatchBonusXP`,
`StatCooldowns`, `MatchOwnGoals`, `SelfDemolitions`.

**Replicated PRI properties**, all `if bNetDirty` to everyone [S class replication block, my `repcond.py`]:
- Scoreboard counters: `MatchScore`, `MatchGoals`, `MatchAssists`, `MatchSaves`, `MatchShots`, `MatchDemolishes`,
  `MatchBreakoutDamage`.
- Other match counters: `MatchEpicSaves`, `MatchCenters`, `MatchClears`, `MatchAerialHits`, `MatchBicycleHits`,
  `MatchJuggleHits`, `MatchFirstTouches`, `MatchPoolShots`, `MatchLowFives`, `MatchHighFives`, `MatchFlipResets`,
  `MatchTimesDemolished`, `MatchCrossbarHits`.
- Activity counters: `BallTouches`, `CarTouches`, `BoostPickups`, `Dodges`, `PowerUpsUsed`, `TotalGameTimePlayed`.
- Demolition counters: `CarDemolitions`, `BallDemolitions`, `SelfDemolitions`.
- Possession and keep-up counters.
- Repnotify: `bMatchMVP`, `PrimaryTitle`, `SecondaryTitle`.
- Engine `PRI.Score` (goal points).

**Replicated GameEvent_Soccar properties:**
- `MVP`, `MatchWinner`, `GameWinner`, `bOverTime`, `bMatchEnded`, `ReplicatedScoredOnTeam`.
- `ReplicatedStatEvent` (repnotify): set by `HandleGaveStat` (TA:2702 / S1:2852) for **Win, Loss, Goal, Save,
  EpicSave**, then cleared after 1 s. All clients use it for crowd and arena sound.

**RPCs** (all reliable, server → owning client):
- `PRI_TA.ClientNotifyGainedStat(StatEvent, Count)` (flags 0x10201c3), to the awarded PRI's owner, unless
  `bSkipReplication`, a local PRI, or a bot. The client reruns `OnGainedStat`: local MatchScore add, `MatchStats`, and
  the popup.
- `PRI_TA.ClientNotifyStatTickerMessage(Receiver, Victim, StatEvent)`, sent on **every** PRI for ticker events (or
  only the receiver's for `bNotifyReceiverOnly`).
- `PRI_TA.ClientScoredGoal(HitLocation)` to the scorer.
- The goal banner is a broadcast LocalMessage.

**Clone mapping:**
- The server computes everything.
- Send a per-player `statEvent {id, count}` reliable message to the receiver, and a broadcast
  `ticker {receiverId, victimId?, id}`.
- Replicate the counters per player; send MVP and titles at match end.

---

## 8. Modes [S/A]
| Mode | Stats |
|---|---|
| Online ranked/casual, private, LAN, offline exhibition (with bots), tournaments | identical StatFactory logic; bots score, can be MVP, appear in the ticker |
| Free play | **none**: `Mutator_Freeplay_Base_TA.Init` sets `StatFactoryArchetype = None` before `OnInit` (TA:70293; InitMutators precedes OnInit, TA:849). Also no scorer goal banner offline (`ShowScorerGoalMessage`) |
| Tutorials (Basic/Advanced, Aerial/Goalie/Striker training) | none: archetypes in `GameInfo_Tutorial_SF` have no `StatFactoryArchetype` |
| Custom training (TrainingEditor) | none: no `StatFactoryArchetype` |
| Physics-log playback | none |
| Hoops / Dropshot / Heatseeker / Knockout / LTMs | own StatFactory subclasses (Basketball red zone & shot; Breakout damage & ultra damage; HauntedBall; KnockOut) |

**Online-only differences** (no effect on in-match numbers):
- Leaderboard upload (`UpdateStats`, TA:3260): dedicated server with a winner; only `bIsLeaderboardStat` events, which
  are Goal, Assist, Save, EpicSave, Shot, MVP, Win.
- Profile stat commit for local players (ranked/casual/private buckets).
- Product stats (skipped in private matches).
- Online rewards.

---

## 9. Native addresses (live)
| Address | What |
|---|---|
| `0x140f57950` | Ball actor tick override (authority): `Touches[0].Distance += VSize2D(Location − OldLocation)`; OldLocation at Ball_TA+0x954; Touches at +0x898; Distance at element +0xe0 (stride 0x110). Non-authority branch calls `0x140f5f800`. Base tick `0x140757250` |
| `0x14089c5b0` | `AActor::execFastTrace` (aerial "far off ground" test) |
| `0x140f5f800` | goal-volume detection per `notes/match-rules-audit.md` (not re-verified here) |

Everything else (all predicates, thresholds, crediting, HUD filters) is UnrealScript.

---

## 10. Summary
| # | Item | Conf. |
|---|---|---|
| STAT-1 | Stat computation is server-only in `StatFactory_TA` (TA:92870–93478, 101222, 107161); clients get replicated PRI counters + reliable RPCs (§7) | high |
| STAT-2 | Points: Goal 100, Assist 50, Save 50, EpicSave 75 (instead of Save), Shot 10, Clear 20, Center 10, goal modifiers 20, Overtime 25, HatTrick/Playmaker/Savior 25, PoolShot 20, Extermination 20, HighFive 20, LowFive 5, BallHit 2, Crossbar/post 2; **Demolish 0**, FirstTouch/Aerial/Bicycle/Juggle 0, MVP/Win 0 (§2) | high |
| STAT-3 | BulletHit/BulletGoal are disabled in Soccar (None), but a bullet hit still resets the 0.5 s special-hit window | high |
| STAT-4 | Shot = per-tick ballistic prediction: moving toward the goal, on that half, ArriveTime < 1.5 s, within 2300 of goal centre (0, ±5120, 312), projected |x| < 1060 and z < 788; one per touch; 5 s per-player cooldown | high |
| STAT-5 | Save = a tracked shot stops being one (not by going in) with the last touch by a defender; 5 s cooldown shared with epic saves | high |
| STAT-6 | EpicSave: pre-hit ball within R of the goal plane, or (car airborne or > 500 uu/s) and ball would arrive ≤ 0.25 s | high |
| STAT-7 | Scorer = newest attacking-team touch; assist = newest earlier touch by a different teammate within 5 s of the scoring touch, opponent touches ignored; pool-shot bumper overrides the assist | high |
| STAT-8 | OwnGoal stat (hidden) when the last touch is a defender's and the ball isn't a tracked shot; goal still credited to the attacker if one touched | high |
| STAT-9 | Clear/Center = entering/leaving a 2300-radius sphere around the goal centre (§3.6) | high |
| STAT-10 | Aerial: car z ≥ 500, airborne, rel speed ≥ 100, nothing within 500 below; Bicycle: dodging, airborne, backward pitch ≥ 250 °/s, contact front-upper; Juggle: 3 consecutive same-player hits from below with ball vz ≥ 500; Turtle: upside down (roll > 90°) touching a ≤ 45° surface; Backwards: contact > 40 uu behind the centre, not dodging; Long: XY ball path since the scoring touch > 7000 | high (Backwards normal sign: medium) |
| STAT-11 | `Touches[].Distance` is accumulated natively (0x140f57950) as XY path length | high |
| STAT-12 | HatTrick/Playmaker/Savior at every multiple of 3; Extermination at every multiple of 7 demolitions | high |
| STAT-13 | Low/High five only after a goal, teammate bumps the scorer, once per car per goal; high if both airborne and the bumper ≥ 500 high | high |
| STAT-14 | Per-touch BallHit +2 at most once per second per ball; first touch after each kickoff gives only FirstTouch | high |
| STAT-15 | Post/crossbar hits +2 to the last toucher (either team), 0.1 s cooldown, from 6 level volumes | high |
| STAT-16 | MatchScore = Σ points of `bAddToScore` events; the client adds locally on RPC, replication reconciles | high |
| STAT-17 | Scoreboard: Score + 4 custom columns (default Goals, Assists, Saves, Shots) + ping (bands 100/200/250); fallback swaps Assists → Demolitions in 1v1; sort Score > Goals > Assists > Saves desc | high (tie order: low)<br>**Refinement (2026-10-11, SB1, notes/scoreboard.md SB-9) [S]:** the Assists → Demolitions swap in 1v1 happens only on the fallback path (no profile scoreboard save, or a PRI without custom columns). With a local profile the default columns Goals, Assists, Saves, Shots show in **1v1 too**. |
| STAT-18 | MVP: winning team only, Members ∪ FormerMembers, MaxTeamSize > 1 (none in 1v1), sort as STAT-17; bots eligible | high |
| STAT-19 | Podium titles: greedy 2-pass assignment over all players by title points (§5.4) | high |
| STAT-20 | Popup: own events only, display level Primary by default (Goal, Assist, Save, EpicSave, Shot, Demolish, MVP, Win), mutable events hidden unless "Match Notifications" = All, FIFO 2.633 s each at (W/2,150); banner separate at (W/2,250) | high |
| STAT-21 | Ticker: all players get every `bNotifyTicker` event, same display-level filter, 6 rows, 36 px, 4 s, label not shown | high |
| STAT-22 | ReplicatedStatEvent (Win/Loss/Goal/Save/EpicSave, 1 s) drives crowd/arena sound on all clients | high |
| STAT-23 | No stats in freeplay, tutorials, custom training, physics playback; everything else identical online/offline; Ultra Damage is Dropshot-only | high |
| STAT-24 | Cooldowns reset per kickoff and respawn; ball caches rebuilt each kickoff | high |

## 11. Open questions
1. **Contact normal sign.** `HitNormal` sign convention in `Car_TA.OnHitBall` (native caller not traced): it decides
   the `Rear·HitNormal < 0` term of IsBackwardsHit. Check against replays, or decompile the car's RB-collision
   notify.
2. **Sort stability.** Tie order for MVPSort/ScoreboardSort (stability of RL's array `Sort` op 0x20) and the order of
   `Team.Members`.
3. **Tick order and rate.** Does `0x140f57950` tick before `StatFactory.Tick` in the same frame, and is it per frame
   or per physics step on non-120 Hz hosts? On a 120 Hz server these are equal.
4. **`FastTrace` arguments.** The extent/complex arguments in `IsLocationFarOffGround`: the decoder drops empty
   parameters; I assume a zero-extent line trace.
5. **Freeze save.** `FreezeSave` uses `HitType == 2` (Rumble item 2); the item-to-HitType mapping is not verified.
6. **Podium titles.** Where exactly the titles appear (podium nameplates vs the end-game screen) was not traced in GFx.
