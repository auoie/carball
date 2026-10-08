# Match rules: the game's competitive match flow (live 2026-10-06) vs our server (static session, 2026-10-08)

Sources: the live TAGame script dump (`out/bsim/work/tagame_live_all.txt`, `resync.py` past decoder errors), defaults
from `GameInfo_Soccar_SF`/`Stadium_P`/`TAGame`/`ProjectX`/`Startup`, seven natives on the old build, and replay checks
(`out/replays/states.csv`, 60 1v1 + 30 2v2 replays, old build). Ours (read only): `server/src/game.rs`,
`game_loop.rs`, `engine.rs`, `engine/capi/rlengine.cpp`, RocketSim `Arena.cpp`. Sub-agent files local in
`out/bsim/agents/M1/`. Sent to the live session, which owns `server/`.

Ours today: on the first join a RocketSim kickoff reset (seed 1, 2, 3, …) with a 480-tick countdown
(`game.rs:101-103, 143-148`); a goal event adds a point and resets 360 ticks later (`game.rs:172-176, 183-185`);
nothing else (no clock, overtime, end, replay, forfeit).

## The game's rules (live)

### Kickoff spawns
- `Pylon_Soccar_TA_0.SpawnPoints`: 5 primary at z 83 — (0, −4608) yaw 90°, (±256, −3840) yaw 90°, (−2048, −2560) yaw
  45°, (2048, −2560) yaw 135° — and 4 secondary (respawn). `InitField` shuffles them once per match
  (`RandomizeSpawnPoints`, `Rand`) before the teams build their lists, so `PrimaryStarts` has one random order P per
  match, shared by both teams; team 1's copy is mirrored (`MapInfo_TA` `MFT_XY`, rotation 180 about (0, 0): (x, y) →
  (−x, −y), yaw +180°).
- Assignment (round not active): `NextSpawnIndex %= 5`; the k-th player (in `Players` order) of each team gets
  P[(N + k) mod 5] (first free spot cycling from there, `SpotIsEncroached`); `NextSpawnIndex++` in
  `Countdown.EndState` — one step per kickoff, overtime included; the first kickoff uses index 0. Replays: 751
  consecutive-kickoff transitions are +1 in a fixed per-match cycle (the 4 exceptions are missed detections), orange
  mirrored at 859/859 kickoffs, 2v2 pairs are consecutive spots.
- Array sort direction verified natively (`FUN_140366160` → CRT `qsort` with comparator `FUN_14036ac80` = −delegate(A,
  B)): a positive delegate result puts A first. So `SortSecondary` (|B.x| − |A.x|) puts the inner respawn spot first
  (confirms DS-3).
- **Uneven teams (new, `bUseDisadvantageSpawnAdjustment` True, only in the Countdown state, i.e. every kickoff after a
  goal or at overtime, not the first):** NumPlayersDown = max over teams (other.Members − mine) (bots count); if > 0,
  window W = P[N .. N + MaxTeamSize − 1], UsedSpawns = P[N .. N + Members − 1]; sort W by `SortPreferableSpawn`
  (smallest distance² from the centre first: diagonals 10.75M, off-centre 14.81M, back-centre 21.23M; ties → x·y < 0,
  the player's own left); if the best is not in UsedSpawns it is swapped into P[N + Members − 1]. So the short team's
  last player takes the most central spot of the full team's window; the full team is unchanged.

### Countdown
`Countdown.BeginState` → `SetAllDriving(false)` (`ZeroMovementVariables`); `InitCountDown`: 1 s lead-in, then
`CountdownTime` 3 ticking each second ("3/2/1"); at 0 `GotoGameState('Active')`, `SetAllDriving(true)`: 4.0 s = 480
ticks (frame-timer granularity ±1 tick; replays 3.99–4.05 s). Frozen: undriven cars get throttle/brake/steer 0 (no idle
brake) and a 6-DOF constraint (`FUN_140f2f610`; reading: linear X/Y locked, Z and rotations free); the ball is
`SetConstrained2D(true)` until `Active.StartRound`. Spawn boost 0.333; pads reset (`ResetPickups`) at the new round
and 0.1 s into the countdown. Inputs count from the first tick after "go".

### Goal → replay → reset
- Detection (native `FUN_140f59720`, ball post-physics on the authority, every tick, `RBState.Location`): the ball
  sphere must be entirely inside an enabled `Goal_TA` volume (x ±960, |y| 5120–6032, z −64…688) → |y| ≥ 5120 + R,
  R = `Ball_TA.UpdateRadius` = mesh bounds 95.49 (spawn z 100.49 = FieldCenter.Z 755 − (FieldExtent.Z 750 − R)). Ours
  |y| > 5215.5. (Gameplay radius 95.49, not ≈ 94.5 as `notes/physics-values.md:287` says.)
- `Active.HandleHitGoal`: `Ball.Explode` (physics None, no collision, `TerminateRBPhys`: the ball is gone that tick)
  → `PostGoalScored` (clock stopped, cars keep driving; demolished players are not respawned until the kickoff).
  Goal-explosion knockback (`ExplosionComponent_X.ProcessHit`): `AddImpulse(dir · 5000 · DamageScale, VelChange)`,
  EndRadius 3000, Falloff 0.1, wave Speed 10000, centre offset (−500, 0, −500) in goal space (replays: Δv ≈ 2700 mean,
  4450 max within 500 uu, ~1100 at 3000–3500 uu, arriving 0.08 s / 0.32 s after the goal). Slow motion
  `ScoreSlomoCurve` (0.125, 1) → (0.225, 0.1875) → (0.625, 1).
- `SetStateTimer(PostGoalTime 3.0, 'StartReplay')` on game time = 360 ticks (~3.53 s real); then destroy balls and
  cars; replay if any non-bot player lacks `bAutoSkipGoalReplay` (window max(min(last scoring touch, goal − 4) − 2,
  goal − 10, recording start, ball spawn) to the end incl. the 3 s after; skippable when all are ready, bots auto-ready),
  else straight to `StartNewRound` → Countdown. Goal → "go" without replay: 840 ticks.

### Ball reset
`GetBallSpawnOrientation`: FieldCenter − (0, 0, 750 − R) = (0, 0, 100.49); `SpawnNewBall`, `WakeRigidBody`, zero
velocity, XY-locked in the countdown; no randomness.

### 0:00 and overtime
At time ≤ 0 (`Active.UpdateGameTime` → `WaitForEndRound`): time 0 and an `EndRoundComponent`; the round ends when the
ball's world contact has normal.z > 0.96 (`GroundToleranceZ`) or the ball sleeps (then ball physics None,
`StartNewRound`); goals still count meanwhile. `StartNewRound`: `HasWinner` (scores differ and time ≤ 0 or overtime) →
`EndGame`, else time ≤ 0 → `StartOvertime` (`bOverTime`, time from `OvertimeComponent`, none → 0, counting up). First
overtime goal wins; no cap unless a playlist adds an `OvertimeComponent` (90 s ball-ground timeout, tiebreak). A goal
with time left gives a normal kickoff with that time.

### Clock and the rest
- `Active.Tick` → `CanUpdateGameTime` (`bBallHasBeenHit` and (count-up or time > 0)) → time −= DeltaTime /
  MatchTimeDilation (per frame, game time). `bBallHasBeenHit`: first car touch or `BallHasBeenHitStartDelay` 5.0 s after
  "go" (≤ 600 ticks). Display `int(t) + 1`. Runs only in Active. `GameTime` 300 s = 36000 ticks.
- `EndGame`: `FreezePawns`, `SetAllDriving(false)`, MVP (score, goals, assists, saves); `PrePodiumSpotlight` 3.0 s →
  `PodiumSpotlight` 5.3 s (old 5.0) → `Finished` 60 s (rematch vote 50 s).
- Forfeit: a team without humans forfeits automatically 0.01 s after a leave (not in bot matches or while joining;
  also checked at `Countdown.EndState`; both empty = no contest); votes after game-clock elapsed ≥
  `ForfeitVoteWaitGameTime` 60 s casual / 90 s ranked, always in overtime; pass threshold not found. No mercy rule.
- Casual fills with bots (`bFillWithAI`); a joining human takes over a bot's car (position and velocity), not in the
  countdown. Ranked: no bots. Private pause → 4 s unpause countdown. Match start: players spawn undriven at kickoff
  spots, wait for reserved players (30 s public / 90 s tournament), `WarmupTime` 3 s, then the countdown.
- New, not physics: `MatchType_HonorDuel_TA` (post-match 1v1 with spectators), the winners explosion (0.6 s into the
  podium), PodiumTime 5.3, the disadvantage adjustment.

## Differences (ranked)

| # | What | Game | Ours | Suggestion / test | Impact |
|---|---|---|---|---|---|
| MR-1 | No match | 300 s clock (starts at first touch or 5 s after go, stops outside Active), 0:00 ball-on-ground rule, sudden-death count-up overtime, winner/end | only `score`; the loop runs forever (`game_loop.rs:13-45`) | implement; unit tests on server ticks (clock holds in countdown and until a touch; starts at the touch or go + 600; at ≤ 0 waits for floor contact normal.z > 0.96 or a sleeping ball; tie → overtime from 0 counting up; first overtime goal ends) | high |
| MR-2 | **Ball survives the goal (bug)** | the ball is removed the same tick (`Ball.Explode`); one goal per round | the ball keeps simulating; `rl_step` re-arms `goalReported` once |y| ≤ 5215.5 (`rlengine.cpp:88-94`); a ball that rebounds out and is tapped back in within the 360 ticks fires a second `Event::Goal` (+1 point, timer restarted, `game.rs:172-176`) | on a goal remove or freeze the ball and ignore goals until the reset; test: ball at y 5300 moving out at −1500 uu/s then pushed back in → score 1 | high |
| MR-3 | Match start | all frozen at kickoff spots, wait for players, 3 s warm-up, 4 s countdown | the first joiner starts a kickoff (`game.rs:101-103`); later joiners spawn mid-play at respawn spots (`Arena.cpp:56-70`), no new kickoff | a joiner during the countdown gets a free kickoff spot | medium-high |
| MR-4 | Kickoff spot sequence | one random permutation P per match, +1 per kickoff | a fresh Fisher–Yates shuffle every kickoff (`Arena.cpp:282-381`), seeds 1, 2, 3, … from server start (`game.rs:71, 146`): repeats possible, identical on every run | keep P and the index in the arena snapshot; car k of each team (ID order) gets P[(n + k) mod 5]; unit test + `out/bsim/agents/M1/work/cycle_check.py` on replays | medium |
| MR-5 | Uneven teams (new) | disadvantage adjustment above | the short team takes the first M spots (`Arena.cpp:327-366`) | implement; tests 1v2, 2v3, 1v3 at every n | medium |
| MR-6 | Post-goal | explosion knockback, slow motion (same 360 ticks), skippable replay; demolished cars wait for the kickoff | none of these; our demolished cars respawn after 3 s during post-goal | feel only; no replay = everyone skips | medium-low |
| MR-7 | Disconnects | auto-forfeit / no contest, forfeit votes (60 s casual / 90 s ranked), bots in casual | the leaver's car is removed, play continues (`game.rs:112-123`) | – | low-medium |
| MR-8 | Teammate order | k-th player in join order, same index for both teams | same | keep car-ID (join) order in the MR-4 fix | low |

## Confirmed same
Spot coordinates and yaws, the mirror, the shared index; countdown 480 ticks with inputs from tick 481; frozen cars
and ball equivalent to zeroed controls; spawn boost 33.3; all pads reset at kickoff; kickoff ball (0, 0) at rest
(the fall from 100.49 to 92.75 is patch 36); the goal test per physics tick on the post-step position (5215.49 vs
5215.5), the scoring team; goal → reset 360 ticks, goal → go 840 without a replay; cars drivable after a goal.

## Open
The knockback falloff (`DamageScale`, native); whether physics runs dilated during the slow motion (ticks unaffected);
the forfeit-vote archetype; whether `PlayerController.Prespawn.bPrespawnSet` is cleared before a kickoff (else a player
who reached prespawn 0.5 s before a goal could spawn at the respawn spot); array op 0x04 = Contains (inferred); the
6-DOF axis reading; `Players` order = join order (assumed); the disadvantage rule needs a live check with uneven teams
(BakkesMod or a LAN private match; offline exhibitions refill with bots).

## Parameters
| Item | Value | Ticks | Source |
|---|---|---|---|
| GameTime | 300 s | 36000 | GameEvent_Soccar archetype |
| Clock start after go | first touch or 5.0 s | ≤ 600 | `BallHasBeenHitStartDelay`, `Active.StartRound` |
| Countdown | 1 s + CountdownTime 3 | 480 | GameEvent_TA, `InitCountDown` |
| WarmupTime (first kickoff) | 3 s | 360 | archetype |
| PostGoalTime | 3.0 s game time (~3.53 s real) | 360 | archetype; ScoreSlomoCurve |
| Goal | sphere inside the volume: \|y\| ≥ 5120 + 95.49 | per tick | `FUN_140f59720` |
| Ball spawn | (0, 0, 100.49), XY-locked in countdown | – | `GetBallSpawnOrientation` |
| 0:00 rule | contact normal.z > 0.96 or ball asleep | per tick | EndRoundComponent_TA |
| Overtime | sudden death, counts up, no cap | – | `StartOvertime`, `ShouldCountUp` |
| Goal explosion | Δv 5000·DamageScale, radius 3000, falloff 0.1, speed 10000 | – | ExplosionComponent_X |
| Forfeit vote wait | 60 s casual / 90 s ranked | – | MatchType_Public_TA / MatchType_TA |
| Wait for players | 30 s public / 90 s tournament | – | MatchType defaults |
| Podium | delay 3.0 s, podium 5.3 s, finished 60 s, rematch vote 50 s | – | archetype |

## Follow-ups (2026-10-08)
- **Warm-up order:** `WaitingForPlayers.CheckStart` → once players are ready and `WarmupTime` (3) > 0,
  `SetGameStateTime(WarmupTime)` (1 s repeating game-state timer, still in WaitingForPlayers) → `OnGameStateTimeLapsed`
  → `StartInitialCountDown` → Countdown (1 s + 3). First kickoff: 3 s warm-up then 4 s countdown (840 ticks frozen);
  later kickoffs 480.
- **MaxTeamSize** (disadvantage window) is the playlist's team size (`GameEvent_Team_TA.UpdateMaxTeamSize` →
  `MatchType.GetMaxTeamSize()`: NumPublicConnections / 2, else GameData default 3; soccar archetype 3; grows only if a
  team has more humans), not the larger team's member count.
- **Goal-explosion knockback** (`Ball_Default.ExplosionArchetype.DefaultExplosion`, `ExplosionComponent_X`:
  RBVelocityChange 5000, StartRadius 0, EndRadius 3000, Speed 10000, Falloff 0.1, bPassThroughWorldGeometry,
  MomentumOffset (−500, 0, −500)); native tick `FUN_140e5ad50`: radius = StartRadius + LifeTime·Speed (LifeTime before
  this frame's dt, game time); while radius ≤ EndRadius, t = LifeTime·Speed/(EndRadius − StartRadius), DamageScale =
  (1 − t)^Falloff; every actor whose collision the sphere overlaps (Physics > 1, not yet in `DamagedActors`; no trace for
  the goal) is hit **once** with HitLocation = its own Location. Script `ProcessHit`: needs a collision component,
  PHYS_RigidBody, DamageScale > 0; MomentumDir = Normal(HitLocation − (ExplosionLocation + MomentumOffset rotated by the
  goal orientation)); `AddImpulse(dir·5000·DamageScale, HitLocation, VelChange)` at the centre of mass (no spin). Origin
  = the ball's location at the goal (`Ball_TA.Explode`); the ball (Physics None by then) and demolished cars (no body)
  are not affected; the scorer is. Δv ≈ 4900 at 500 uu, ≈ 3500 at 2900 uu, then the speed cap (2300) applies.
- **Per-goal-explosion physics:** `Ball_TA.InitExplosionFX`: if the scorer's goal explosion product has
  `ExplosionComponents` and `PhysicsConfig.bEnableCustomExplosionPhysics` (True, both builds), its handlers are attached
  (`SetExplosionHandler`) and the default `ExplosionComponent` is **detached**: the knockback is then the product's
  (`DefaultHitHandler_TA`: own RBVelocityChange·DamageScale at the explosion's location, optional pull toward it, or a
  per-tick velocity drive; `ApplyVelocityHitHandler_TA`, Jiggle/Orbit/Stasis/FX/Demo handlers). The default product
  slot has no components, so the Classic explosion keeps the base wave. The native AddImpulse path
  (`FUN_1409801c0`: ×0.02, bVelChange → ×1/m_inverseMass, applyImpulse at HitLocation − origin) has no extra factor. Replay
  fits that mix products (live session: ~0.82×, steeper falloff) need splitting by the scorer's goal-explosion ID.
