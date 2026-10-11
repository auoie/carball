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
| MR-6 | Post-goal | explosion knockback, slow motion (same 360 ticks), skippable replay; demolished cars wait for the kickoff | none of these; our demolished cars respawn after 3 s during post-goal | feel only; no replay only when every human has auto-skip on; the skip needs every non-bot player ready (MR-6.x below) | medium-low |
| MR-7 | Disconnects | auto-forfeit / no contest (public match types only), forfeit votes (unanimous, 20 s, allowed after 60 s casual / 90 s ranked of clock), bots in casual (MR-7.x below) | the leaver's car is removed, play continues (`game.rs:112-123`) | – | low-medium |
| MR-8 | Teammate order | k-th player in join order, same index for both teams | same | keep car-ID (join) order in the MR-4 fix | low |

## Confirmed same
Spot coordinates and yaws, the mirror, the shared index; countdown 480 ticks with inputs from tick 481; frozen cars
and ball equivalent to zeroed controls; spawn boost 33.3; all pads reset at kickoff; kickoff ball (0, 0) at rest
(the fall from 100.49 to 92.75 is patch 36); the goal test per physics tick on the post-step position (5215.49 vs
5215.5), the scoring team; goal → reset 360 ticks, goal → go 840 without a replay; cars drivable after a goal.

## Open
The 6-DOF axis reading; the disadvantage rule needs a live check with uneven teams
(BakkesMod or a LAN private match; offline exhibitions refill with bots).

**Settled 2026-10-10 (MR-6.x/MR-7.x below):** physics runs slowed after a goal (fixed 1/120 s step, fewer steps per real
second); the forfeit-vote archetype; prespawn is cleared at the goal; array op 0x04 = Find (Contains with its flag);
`Players` order = join order.

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
  the goal) is hit **once** with HitLocation = its own Location (the actor Location, which lags the body by one tick; KNB-6). Script `ProcessHit`: needs a collision component,
  PHYS_RigidBody, DamageScale > 0; MomentumDir = Normal(HitLocation − (ExplosionLocation + MomentumOffset rotated by the
  goal orientation)); `AddImpulse(dir·5000·DamageScale, HitLocation, VelChange)` at HitLocation, so the one-tick lag gives a small lever and the push spins the car (corrected 2026-10-10, KNB-6). Origin
  = the ball's location at the goal (`Ball_TA.Explode`); the ball (Physics None by then) and demolished cars (no body)
  are not affected; the scorer is. Δv ≈ 4900 at 500 uu, ≈ 3500 at 2900 uu, then the speed cap (2300) applies.
- **Per-goal-explosion physics:** `Ball_TA.InitExplosionFX`: if the scorer's goal explosion product has
  `ExplosionComponents` and `PhysicsConfig.bEnableCustomExplosionPhysics` (True, both builds), its handlers are attached
  (`SetExplosionHandler`) and the default `ExplosionComponent` is **detached**: the knockback is then the product's
  (`DefaultHitHandler_TA`: own RBVelocityChange·DamageScale at the explosion's location, optional pull toward it, or a
  per-tick velocity drive; `ApplyVelocityHitHandler_TA`, Jiggle/Orbit/Stasis/FX/Demo handlers). The default product
  slot has no components, so the Classic explosion keeps the base wave. The native AddImpulse path
  (`FUN_1409801c0`: ×0.02, bVelChange → ×1/m_inverseMass, applyImpulse at HitLocation − origin) has no extra factor. **Magnitude settled 2026-10-10 (KNB1):** the decoded 5000·(1 − r/3000)^0.1 is right; the replays' ~0.82× was a
  measurement artefact (an engine-from-frame run gives a scale of 1.02, 615 pushes). See "Goal-explosion knockback (KNB-1..10)" below.

## Live build (2026-10-06) addresses

Checked 2026-10-08. Each function cited here was mapped through BinDiff (out/bsim/bindiff/function_map.tsv) and
semantic-diffed old vs live (out/bsim/scripts/semantic_diff.py; offsets, addresses and stack frames ignored);
key ones were re-decompiled in the live project out/bsim/rl-20261006.

Same apart from layout (old → live): `140366160` → `14036c7b0` · `14036ac80` → `1403712d0` · `1409801c0` → `140985160` · `140e5ad50` → `140e5dcb0` · `140f2f610` → `140f35330` · `140f59720` → `140f5f800`.

---

## Match rules 2: post-goal slow motion, goal replay, forfeits and leavers (MR-6.x, MR-7.x, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent MRL1 (decompiles, log copies and helper scripts local in
out/bsim/agents/MRL1/). The static session spot-checked the vote archetype (ForfeitVoteArchetype: TimeRemaining 20,
bUnanimousVote True). The §8 text keys are cleared to ship verbatim (user, 2026-10-10); exact strings at the end of this section.

This draft continues `notes/match-rules-audit.md` MR-6 and MR-7. It also settles four items from that file's "Open" list.
It covers the live build, 2026-10-06.

**Sources**
- **Script:** the live TAGame dump (`TA:n` = line in out/bsim/work/tagame_live_all.txt). Functions that dump fails
  to decode were re-read in STAT1's patched dump (out/bsim/agents/STAT1/work/tagame_stat1.txt), cited as `S1:n`.
- **Archetypes:** TAGame.upk and GameInfo_Soccar_SF, read with scripts/props.py.
- **Natives:** objdump and the Ghidra decompiler on a copy of the live project.
- **AS3 HUD:** HUD1's decompiles (out/bsim/agents/HUD1/dec_as3/).
- **Logs:** the user's game logs, read-only copies in out/bsim/agents/MRL1/logs/ (they contain account IDs, so they
  stay local). Only facts are used here.
- **Our code:** the working tree, read only.

**Tags:** [S] script, [A] archetype or class default, [D] native (disassembled or decompiled, live address), [G] GFx
AS3, [L] the user's logs, [I] inferred.

**Units:** "game s" = dilated world time. One tick = 1/120 game s.

### Summary

| # | Finding | Conf. |
|---|---|---|
| MRL-1 | **Physics runs dilated during the post-goal slow motion.** The step stays 1/120 game s. The number of steps per real second drops to 120·D. PostGoalScored lasts exactly 360 ticks, about 3.532 s real. **Client log evidence:** across 109 goals without a replay, the client's world clock lost a median of 0.530 s (σ 0.026) against real time. The curve predicts 0.530 s continuous, or 0.532 s per tick. | high [D][L] |
| MRL-2 | **The server dilates too.** It keeps the fixed 1/120 s step and slows its tick rate. It does not shorten dt. `PostGoalScored.Tick` runs on the authority, and `WorldInfo.TimeDilation` is a replicated property (`CPF_Net`). Clients also compute the curve themselves (the state's Tick is `simulated`). | high [S][D], server loop [I] |
| MRL-3 | **Per-tick pacing rule for our server:** tick n after the goal (n = 1..360) lasts (1/120)/D((n−1)/120) real seconds. Ticks 17..75 are slowed; the slowest is tick 28 (D = 0.1875). The kickoff is at 840 ticks = 7.532 s real. The working tree already does this (`server/src/game.rs` `next_tick_seconds`). | high |
| MRL-4 | **Array ops settled.** Sub-op 0x26 = **Any**, 0x25 = **Every** (All); native 0x14036bf90 even carries the error string "Dynamic array Any/Every". Sub-op 0x04 = **Find**; with its flag byte set it returns a bool (**Contains**). Consequences: the replay plays if any non-bot player wants it, and the skip needs every non-bot player ready. | high [D] |
| MRL-5 | **Goal replay.** It starts at tick 360 after the goal: balls and cars are destroyed, then the replay plays. Window: [max(min(t_hit, goal−4) − 2, 0, goal−10, record start, ball spawn), goal + 3.0]. That is about 7–13 game s (normally 9–13), at most 14.8 s real. It ends at the end of the recording, or when every non-bot player is ready. The kickoff countdown starts in that same frame. This confirms GS-4..8 and GS-12. | high [S][A] |
| MRL-6 | **Skip.** The rule is unanimous over non-bot PRIs. Auto-ready: bots, players with auto-skip on, and team-less non-spectators. Ready cannot be undone. The ready check runs every 0.01 game s. The HUD lists the names of players not yet ready; it shows no count. A player who joins during the replay must also press skip. | high [S][G] |
| MRL-7 | **Prespawn is cleared at the goal.** When Active ends, the PlayerSpawn feature stops. `HandlePlayerSpawnStop` then clears `Prespawn.bPrespawnSet` and destroys the spawn tickets. So the kickoff `RestartPlayer` always uses kickoff spots. bPrespawnSet is also cleared when overtime starts and on a team change. | medium-high [S][I] |
| MRL-8 | **`Players` order = join order.** `AddPlayer` appends; humans are added at `PostLogin`. Bots are appended when spawned (0.1 s timer each). A reconnecting player goes to the end. Random order (`AddPlayers`, `Rand`) applies only to a game event created while players are already connected, not the main soccar event, which is created at map load. | high [S] |
| MRL-9 | **Forfeit votes.** Per team. Voters are the team's humans at the start (joiners added, leavers removed). **Unanimous; 20 s** (archetype `TimeRemaining` 20, `bUnanimousVote`). Idle-banned (AFK) voters are not needed, but their yes counts. There is no "no" button, so a vote fails only by timing out. A pass is a forfeit: the other team wins. | high [S][A][G] |
| MRL-10 | **When a vote is allowed (`bCanVoteToForfeit`).** All of: the playlist allows it (`bAllowForfeit`, or `bApplyQuitPenalty`, or a 1v1 playlist); no winner yet; and the clock has run for ≥ `ForfeitVoteWaitGameTime` (casual 60 s, ranked 90 s, others 90 s) or counts up. It is never allowed in PreMatchLobby. The wait counts **clock time since the match start**, not time since a teammate left (the brief's premise). | high [S][A] |
| MRL-11 | **Who can start a vote.** Each player can start one vote per cycle. A failed vote re-enables everyone only when no teammate can start one any more. There is no time cooldown; a teammate can start the next vote at once. A disconnect does not reset a player's own lockout (`ForfeitInitiatorIDs`). **The server does not enforce the lockout; only the menu does.** A team of one human (a 1v1, or teammates gone or bots) forfeits on the press; only 1v1 playlists ask for a confirm. | high [S][G] |
| MRL-12 | **Auto-forfeit.** 0.01 game s after a human leaves, a team with no humans left forfeits. This applies only in public match types (casual, ranked, tournament) once WaitingForPlayers' 30 s has expired or the match has started. It does not apply if a reserved player is still joining, in bot matches, or once a winner is decided. It is re-checked at every countdown's end. If both teams are empty, the match is a no contest. Private, LAN and offline matches never auto-forfeit. | high [S][A] |
| MRL-13 | **When a forfeit takes effect.** In Active or Countdown, `EndGame` runs at once. In PostGoalScored or ReplayPlayback, `bForfeit` is set but `EndGame` waits for `StartNewRound` (the end of the post-goal or replay). Our server ends the match at once in every phase. | high [S] |
| MRL-14 | **A leaver's car is demolished** (`Demolish(None)`). In casual (`bAllowBotFills`), a bot takes the slot 0.1 game s later, with the leaver's car location, rotation and linear velocity (a temporary spawn spot, valid 1 game s). In the countdown it takes a kickoff spot instead; in PostGoalScored or ReplayPlayback it gets a car at the kickoff. A human joining in place of a bot waits a 3 s ticket, then takes the bot's car pose. Ranked has no bots and no takeovers. | high [S][A] |
| MRL-15 | **A leave in a full, penalised lobby destroys any forfeit vote in progress.** When the leave penalty lifts (`OnPenaltyChanged`), every team's vote is destroyed. | high [S] |
| MRL-16 | **Clients' input-packet cadence during the slow motion.** Our client sends one packet every 2 ticks. During the slow motion that drops to 60·D packets per real second, and the server's jitter buffer, which measures gaps in **real** time like the game's `ClientJitterBuffer_TA`, may grow. The game sends at most one packet per render frame (N-9). | medium [S][I] |

### 1. Post-goal slow motion (MR-6.1 to MR-6.6)

#### Rules
| # | Rule | Source |
|---|---|---|
| MR-6.1 | **Curve.** On the goal tick: `Active.HandleHitGoal` → `GotoGameState('PostGoalScored')`. `BeginState` sets `ScoreSlomoTime = 0` and `SetStateTimer(PostGoalTime 3.0, 'StartReplay')`. `PostGoalScored.Tick` (simulated, so it runs on the server and every client) does `ScoreSlomoTime += DeltaTime` (the dilated dt), then `WorldInfo.SetTimeDilation(Eval(ScoreSlomoCurve, ScoreSlomoTime) · MatchTimeDilation)`. The new value applies from the next frame. **Curve keys:** (0.125, 1.0), (0.225, 0.1875), (0.625, 1.0); all `CIM_Linear`; clamped outside. `EndState` restores `MatchTimeDilation` (1). | [S] TA:4245-4273, [A] GameInfo_Soccar_SF (K2 raw dump) |
| MR-6.2 | **What dilates.** UWorld::Tick: `DeltaSeconds = clamp(dt_real · TimeDilation · DemoPlayTimeDilation, 0.0005, 0.4)`. This dilated dt feeds the physics accumulator (FUN_140f54bd0) and every actor and state timer. The step is fixed at 1.0f/120 (LT-12), and nothing in the physics reads TimeDilation (MUT-3). So the step size is unchanged and only the number of steps per real second changes. PostGoalTime 3.0 game s = 360 ticks (±1 with frame alignment). | [D] LT-2/3/12 (UWorld::Tick FUN_140753ed0, accumulator FUN_1402b0460) |
| MR-6.3 | **Measured on the client.** WorldInfo.TimeSeconds (the "Time =" field of DebugNUX `SetUsingSecondaryCamera` lines, S1:15686) against the log's real clock. The first figure for each group is the game time lost between two lines that bracket one whole goal sequence. **No replay:** n = 109, median 0.530 s, 91 of them within 0.50–0.56 s, median 0.532. Predicted: 0.530 continuous, 0.532 per tick, 0.533 per frame. **With a replay:** 27 intervals lost 0.86–2.24 s, i.e. the goal's 0.53 plus 3× the replay's slow-motion game time (touch window 0.35 s → 1.58 total; with the defender window as well → 2.33). So the client's world, and with it the physics accumulator, slows both after the goal and in the replay's slow motion. | [L] work/offsets.py |
| MR-6.4 | **Replication.** `WorldInfo.TimeDilation` is `CPF_Net` (flags 0x4000000020), so the server's value replicates. The client also enters PostGoalScored from the replicated `ReplicatedStateName` and runs the curve itself from that moment. The server's frames stay 120 per game second, and the server's physics slows with its own TimeDilation (same UWorld code). Network sends stay on the server's real frame loop; each send covers fewer physics frames. | [D] Engine.upk WorldInfo.TimeDilation; [S] TA:689-699; server loop [I] |
| MR-6.5 | **During PostGoalScored.** Cars are drivable and inputs keep counting; the state extends `Soccar.ActiveBase`, with no `SetAllDriving(false)`. The ball is gone (`Ball.Explode`) and the clock stopped (`CanUpdateGameTime` only in Active). No respawns: `RestartPlayer` and `AddControllerToRespawnList` are empty, and the spawn feature stops, which clears prespawn and the tickets (MRL-7). Boost pads stay active, with timers on game time. A forfeit is deferred (MRL-13). Demolitions can still happen, and the demolished stay down until the kickoff. | [S] TA:4245-4280, S1:81891 |
| MR-6.6 | **Real time vs game time.** **Game time** (slows): physics; state and actor timers (PostGoalTime, countdown, the 0.01 s forfeit check, vote ticks, respawn tickets, pad respawns); the goal-explosion wave; replay playback; car-camera smoothing (`UpdateCamera(DeltaSeconds)`, LT-9). **Real time**: input sampling (once per render frame; with D < 1 most 60 fps frames step 0 ticks, and the jump latch LT-4 keeps taps); camera swivel (`UpdateSwivel` divides by TimeDilation); the LiveReplay camera (dt / TimeDilation); the jitter buffer (`RealTimeSeconds`, S1:25333); the HUD. **The clock** runs on `GetRealDeltaTime = dt / MatchTimeDilation`, which still slows with the goal curve, but it does not run after a goal anyway. | [S][D] |

#### Timeline (one goal, no replay, MatchTimeDilation 1)
| Event | Tick after the goal | Game s | Real s |
|---|---|---|---|
| Goal: ball removed, PostGoalScored | 0 | 0 | 0 |
| D starts falling (tick 16 is the last at D = 1) | 16 → 17 | 0.133 | 0.133 |
| Minimum D = 0.1875 (tick 28) | 28 | 0.225 | 0.359 |
| D back to 1 | 76 | 0.625 | 1.165 |
| `StartReplay`: destroy balls and cars; replay or `StartNewRound` | 360 | 3.0 | 3.532 |
| Countdown 1 s + 3 s, then "go" | 840 | 7.0 | 7.532 |

**Per-tick table (from work/slomo_ticks.py).** Tick n (n = 1..360) lasts (1/120)/D((n−1)/120) real seconds, so the
real time at the end of tick n is the sum of those durations:

| n | D | real time at end of tick n (s) |
|---|---|---|
| 1 | 1 | 0.00833 |
| 17 | 0.9323 | 0.14227 |
| 27 | 0.2552 | 0.31425 |
| 28 | 0.1875 | 0.35869 |
| 41 | 0.4076 | 0.72918 |
| 75 | 0.9831 | 1.15674 |
| 76 | 1 | 1.16507 |
| 360 | 1 | 3.53174 |

59 ticks are slowed. The continuous integral is 3.53014 s; K2's frame-based figure is 3.533 s.

#### Server-side requirements (authoritative clone)
1. **Fixed step.** Keep the 1/120 s engine step and the tick numbering. Pace the 360 ticks after the goal tick G at
   (1/120)/D((n−1)/120) real seconds each. Clients derive the same schedule from G, which is already sent with
   `Event::Goal`. As a safety net, also send the current dilation in the match state, the way the game replicates
   TimeDilation.
2. **Tick-based timers.** Express all post-goal deadlines (StartReplay at G + 360) in ticks, not wall time.
3. **Real-time estimators.** Real-time estimators (jitter buffer, clock sync, input timeout) see ticks arriving
   up to 5.3× slower for about 0.8 s real. Either send input packets on a real-time cadence (as the game does, at
   most one per render frame) or measure jitter per tick (MRL-16).
4. **MatchTimeDilation.** If game-speed mutators are added: D = curve · MatchTimeDilation. The replay always plays
   at 1.0 (`Playing.BeginState` sets the default), and `Playing.EndState` restores MatchTimeDilation unless the match
   has a winner.

### 2. Goal replay (MR-6.7 to MR-6.14)

| # | Rule | Source |
|---|---|---|
| MR-6.7 | **Start.** At tick 360 (`PostGoalScored.StartReplay`): `DestroyBalls`, then `DestroyCars`. If a ReplayDirector exists and `ShouldPlayReplayPlayback()`, go to ReplayPlayback; else `StartNewRound` in the same frame. `ShouldPlayReplayPlayback = PRIs.Any(!bBot && !bAutoSkipGoalReplay)` (honor duel: spectators excluded). So there is no replay when every human has auto-skip on, and offline the human's own setting decides. | [S] TA:4262, S1 ShouldPlayReplayPlayback; [D] Any |
| MR-6.8 | **Window (`GetReplayStartTime`, S1:88154).** `S = t_hit` (the scoring touch: the newest touch by the scoring team, else the newest; 0 if there are no touches). `S = min(S, goal − MinReplayTime 4) − ReplayPadding 2`, then `S = max(S, 0, goal − MaxReplayTime 10, ReplayStartGameTime, BallSpawnTime)`. **End** = the end of the recording = goal + PostGoalTime (3.0 game s); the recording stops when the director leaves Recording. ReplayStartGameTime is reset whenever the director re-enters Recording (each countdown after a replay). BallSpawnTime is the kickoff reset. So the replay shows 6–10 game s before the goal (less if the round is younger; the countdown can be included) plus 3 s after. Length L = 9–13 game s. For a goal less than 6 s after the kickoff reset (the 4 s countdown included), L = the round's age + 3, so at least about 7 s. | [S][A] ReplayDirectorArchetype |
| MR-6.9 | **Speed.** `Replay.Tick(DeltaTime)` runs on world time, at TimeDilation 1. **Slow-motion windows** (`ShouldSlomo`) run at `SlomoTimeDilation` 0.25: replay time in (t_hit − 0.25, t_hit + 0.1); and, if `bSlomoForDefender`, (goal − 0.25, goal). `bSlomoForDefender` is set when any car of the scored-on team was within 200 + its cylinder radius + ball radius of the ball at the goal frame. It is **never cleared**, so it stays on for the rest of the match. **Real length** = L + 3·S_slow. Examples: 10.05 s (hit 1 s before the goal), 10.8 s with the defender window, 13.0 s with no touch, 14.8 s maximum. | [S] S1:88145, 88323; [A]; [L] MR-6.3 |
| MR-6.10 | **Skip (unanimous).** `ReplayPlayback.BeginState` (authority) calls `ResetPickups` and `SetAllowReadyUp(true)`. That sets every PRI's `bReady = false`, starts a looping 0.01 s `CheckPlayersReady` timer, and runs `AutoReadyPlayers`. **Auto-ready:** bots; non-bots with `bAutoSkipGoalReplay`; team-less non-spectators (honor duel: spectators). `CheckPlayersReady`: `if (PRIs.Length == 0 || PRIs.Any(!bReady)) return`, else `OnAllPlayersReady` → `StartNewRound`. **Input:** the ReadyUp action (Space or pad A; binding name "Skip Replay"; rebindable) → `PRI.ServerReadyUp` (only while `bAllowReadyUp`). Ready cannot be undone during the replay (`SetAllowReadyUp(false)` clears everyone's at its end). Turning auto-skip on during the replay readies the player (`ServerSetAutoSkipGoalReplay`). A human who joins mid-replay starts unready and must press too. | [S] S1 SetAllowReadyUp, CheckPlayersReady, ReplayPlayback.ShouldAutoReadyUp, PRI_TA.ServerReadyUp; [D] Any |
| MR-6.11 | **Cars and ball during the replay.** The live ball and cars **do not exist** (destroyed at tick 360). The server plays the recording back and spawns replay proxy actors, which replicate to clients like normal actors. Players have no car; the camera is LiveReplay (GS-10) or the scorer view (GS-11, toggled with ToggleScoreView: middle mouse or pad Y). Pads are reset at the replay's start and again at the kickoff. The ReplayPlayback state has no spawning (NoSpawnState). | [S] K2 notes, TA:4281 |
| MR-6.12 | **End.** Either the playback reaches the end of the recording (`HandleReplayFinished` → `StartNewRound`) or everyone is ready (`OnAllPlayersReady` → `StartNewRound`). `StartNewRound`: a winner or `bForfeit` → `EndGame` (the replay of a deciding goal goes straight to PrePodiumSpotlight, as seen in the user's 2026-10-09 log); time ≤ 0 → overtime; otherwise Countdown (480 ticks), `ResetBalls`, `ResetPlayers`, `ResetPickups`. **Kickoff "go"** = goal + 3.532 s + replay time (full or until skipped) + 4.0 s. Without a replay: 840 ticks = 7.532 s real. | [S] S1:3252 |
| MR-6.13 | **Online vs offline.** Same code. Offline, bots are auto-ready, so the human's skip alone ends the replay. Freeplay has no special case (GS-14: the profile's Skip Goal Replay decides). Online freeplay "goal reset" option 1 (`bDisableGoalDelay`) skips PostGoalScored entirely. Private matches: spectators are PRIs that are not auto-ready (`Team == None && IsSpectator`), so they may block the skip; this is unconfirmed (open). | [S] |
| MR-6.14 | **UI.** Replay banner (HUD-11). A skip prompt: UIText [Global] `SkipInstructions` (press {key} to skip). A toggle-view prompt: [Global] `ToggleToChangeView` (only with GS-11). A **comma-separated list of the names of players not yet ready** (non-bot, not disconnected; others first, the local player last). There is **no "n/m" count**. | [G] HudMatchInfo `ScoreReplayView` m#8746-8757 |

#### Cross-check with the existing specs
- **camera-respawn-goal.md:**
  - GS-2/3: confirmed, and now measured (MR-6.3).
  - GS-4..8 and GS-12: match the script line for line. GS-6's "unanimous over humans" is now proven by the native
    Any.
  - GS-10: consistent; the LiveReplay camera runs on real dt, cuts in and fades from black over 0.5 s.
  - GS-14 (freeplay follows the profile's Skip Goal Replay, no special case): consistent with `ShouldPlayReplayPlayback`.
- **match-intro-outro.md:**
  - The replay of a deciding goal goes straight to PrePodiumSpotlight ([L] 2026-10-09): `StartNewRound` → `EndGame`.
  - MIO-15 (no contest → Finished) and MIO-19 (the forfeit win label) agree with MR-7.7 and MR-7.11.

#### What the server must track for the replay
- **Touches.** Ball touches since the ball spawned (tick, car, team; the game keeps 50). The scoring touch = the newest
  by the scoring team.
- **Window inputs.** The ball-spawn tick and the recording-start tick (the countdown start after a replay).
- **Goal facts.** The goal tick, the scoring and assist players, and the per-match sticky `slomo_for_defender`.
- **Skip state.** Per player: auto-skip and ready. The replay deadline in **real** time = L + 3·S_slow (the server's
  ticks run at 1/120 real during the replay).
- **The window itself.** Send the window, the slow-motion intervals and the focus list once. Clients replay from their
  own recording. The game instead streams the replay from the server, so a joiner sees it. A **server ring buffer**
  of at least 13 game s at 30 Hz (`RecordFPS` 30) is needed only for players who join or reconnect mid-replay, and
  for spectators.
- **Status.** The working tree already does all of this except the ring buffer (protocol 9 `Replay`/`ReplayReady`).
  The HUD shows a count instead of the names list (MR-6.14).

### 3. Forfeit votes (MR-7.1 to MR-7.8)

| # | Rule | Source |
|---|---|---|
| MR-7.1 | **Vote actor.** One per team (`Team_TA.ForfeitVote`, archetype `Archetypes.Teams.Team0/1.ForfeitVoteArchetype`). Settings: Subject `VoteSubject_Forfeit`, **TimeRemaining 20**, **bUnanimousVote True**, bAllowSplitscreenVoters True, bFilterIdleBannedPlayers True. `PostBeginPlay` starts a 1 s looping timer (game time) that decrements TimeRemaining. At ≤ 0 the authority calls `FinishVote`. **Finished:** `bFinished` is replicated, the HUD shows passed or failed, and the actor is destroyed 5 s later. | [A] TAGame.upk; [S] S1:103209-103375 |
| MR-7.2 | **Voters.** At creation: `AddTeam` → every team member whose owner is a `PlayerController_TA` (humans; bots excluded). Later: `Team_TA.AddToTeam` adds a joiner and `RemoveFromTeam` removes a leaver, while the vote is unfinished. Each voter change re-checks the result. | [S] S1:103234-103262, 32945-32960 |
| MR-7.3 | **Threshold.** If there are no idle-banned voters (or all of them are): Required = number of voters (unanimous). Otherwise: Required = non-idle voters + idle voters who voted yes. **Passed** = yes votes ≥ Required. **Failed** = any non-idle "no", but the HUD has no "no" button (only rematch uses VoteYes/VoteNo), so in practice a vote fails only at the 20 s timeout. The **same rule holds for every team size**: 1 human → passes on the press; 2v2 → both; 3v3 → all three humans. | [S] S1 `RequiredVotes`/`Passed`/`Failed`; [G] |
| MR-7.4 | **Starting and joining.** Menu → `Shell.VoteToForfeit` → `PRI.ServerVoteToForfeit` (needs `GameEvent.bCanVoteToForfeit` and a team) → `Team.VoteToForfeit(PRI)`. If there is no vote, or the old one has timed out (TimeRemaining ≤ 0): destroy the old one, spawn a new one, call `PRI.SetStartVoteToForfeitDisabled(true)` (the starter is recorded in `ForfeitInitiatorIDs`), and log the metric. Then set this PRI's vote to yes. A press during a running vote **joins** it as a yes. | [S] S1:84001, 33225-33236 |
| MR-7.5 | **Initiator lockout (the only cooldown).** A player who started a vote cannot start another (menu-gated). When a vote fails, or a member leaves or the vote is destroyed, all members are re-enabled **if nobody on the team can start one any more**. When a teammate is flagged idle-banned, the other active members are re-enabled (partial decode). `ForfeitInitiatorIDs` survives a reconnect (`CheckInitiatedForfeit` in `AddPlayer`). **The server does not check the lockout** (`VoteToForfeit` never reads it), so a client that skips the menu could restart votes. The clone should enforce it on the server. | [S] S1:33240-33300, 1862; [G] MidgameMenu m#9108 |
| MR-7.6 | **Allowed (`bCanVoteToForfeit`, replicated; re-evaluated on clock-second change, state change, player add or remove, penalty change).** Soccar: `!HasWinner() && EnoughTimePassedToForfeit() && base`. **Base:** `Playlist.bAllowForfeit || Playlist.bApplyQuitPenalty || Playlist.PlayerCount == 2`. **EnoughTimePassedToForfeit:** `ShouldCountUp()` (overtime without an OvertimeComponent, or unlimited time) `|| GameTime − GameTimeRemaining ≥ MatchType.ForfeitVoteWaitGameTime`. Effective in a 5:00 match: from the clock showing **4:00 (casual)** or **3:30 (ranked)**, and always in overtime. It is never allowed in PreMatchLobby, and stays false after a match-deciding goal. Without a playlist (offline), it is false. | [S] S1:776, 3480, 3847, 4198; [A] |
| MR-7.7 | **Result.** Pass → `Team.Forfeit` (`bForfeit`, EventForfeit) → `GameEvent_Team.HandleTeamForfeit` (`bForfeit = true`) → `OnTeamForfeited`. In Countdown or Active that is `EndGame` at once; in PostGoalScored or ReplayPlayback it is deferred to `StartNewRound` (MRL-13). `GetWinningTeam`: the other team wins **regardless of score**. The label is "winner by forfeit" (cleared, MIO-19). Fail → metric, then re-enable the starters if needed. | [S] S1:2371-2400, 3405-3430 |
| MR-7.8 | **Menu and HUD.** The leave button is enabled in every online state except PreMatchLobby and WaitingForPlayers. **1v1 playlists (MaxPlayers ≤ 2):** while `bCanVoteToForfeit`, a red "Forfeit Match" button with a yes/no confirm; else "Abandon Match" or "Leave Match". **Team playlists:** "Vote to Forfeit" (ranked) or "Vote to Concede" (casual). It shows if `bForfeitVoteAllowed && bCanVoteToForfeit` and (the player may start, or a vote is running that they have not voted in); there is no confirm. `bForfeitVoteAllowed` (HUD) = `bAllowForfeit || (bApplyQuitPenalty && PlayerCount ≥ 2)`. Otherwise "Abandon Match" (with the leave-penalty warnings) when the lobby has the penalty, else "Leave Match". **HUD vote widget** (`VoteToForfeitView`): the tally "{yes}/{required}" (ranked `VoteToForfeitCount`, casual `VoteToConcedeCount`), a progress bar, the time left (m:ss), and "press {pause key} to vote" (`VoteInstructions`, until the local player votes). It fades out 0.3 s after the vote is destroyed or at FINISHED. | [G] MidgameMenu m#9101-9115, HUD m#9508-9519 |

### 4. Leavers, auto-forfeit, no contest and bots (MR-7.9 to MR-7.15)

| # | Rule | Source |
|---|---|---|
| MR-7.9 | **Leave sequence (`RemovePlayer` → `OnPlayerRemoved`).** The leave penalty is re-evaluated. If the lobby had the penalty (`bApplyQuitPenalty && humans == PlayerCount`, no winner yet) and the player had a connection, they get a matchmaking ban; this is server-side and out of scope. Then: `RemovePlayerFromTeam` → `AddTemporarySpawnSpot(team, car)` (location, rotation, velocity, time) → `Team.RemoveFromTeam` → **`Car.Demolish(None)`**. Then the leaver's (player, team) entry is queued and `CheckAllTeamsForfeitState` runs **0.01 game s** later; `UpdateBotCount` runs 0.1 s later. | [S] S1:1088, 2190-2246 |
| MR-7.10 | **Auto-forfeit (`ShouldTeamForfeitFromPlayerLeave`).** All of: `MatchType.CanCheckForForfeit()`; the leaver is not an AI or a local splitscreen player; `Team.GetNumHumans() == 0`; the dedicated server is not a bot match and has no reserved player still joining. **Soccar:** also no winner yet. **`CanCheckForForfeit`:** public (casual or ranked) = `IsWaitingForPlayersTimeExpired()`, i.e. false in PreMatchLobby, false in WaitingForPlayers until 30 s have passed, true in every later state. Tournament: the same unless bot teams. **Private, custom, LAN, offline: always false** (the base `MatchType_TA` function has no body). | [S] S1:2273-2290, 70350-70365, 70479; [D] bytecode 04 3a…, returns false |
| MR-7.11 | **Resolution (`CheckAllTeamsForfeitState`).** No forfeiting team → nothing. Every team forfeits → **`ForceNoContest`** (`bNoContest`, `EndGame` → Finished: no podium, MIO-15). Otherwise the first forfeiting team forfeits (MR-7.7). The check is repeated for every team at each `Countdown.EndState` and in `WaitingForPlayers.CheckStart`. Before the match: `ShouldCancelMatch` gives a no contest. **Casual:** the wait expired and not every team has a human (bot match: no team has one). **Ranked:** the wait expired, **or** a reservation timed out, **or** nobody is still joining but the lobby is not full (MIO-1). | [S] S1:2248-2270, 3943, 4233, 70339, 70409 |
| MR-7.12 | **Bots fill leavers in casual.** `bFillWithAI = Playlist.bAllowBotFills` (online), or the private match's bot setting. `UpdateBotCount`: while a team has fewer than MaxTeamSize members it calls `SpawnBot`, one per call; the bot's `AddPlayer` re-arms the 0.1 s timer for the next one. Not in Finished. The bot's `RestartPlayer` (non-ranked playlists) takes the team's newest temporary spawn spot if it is under 1 game s old: **the leaver's location, rotation and linear velocity** (no MoveToGround in Active). Without one, it uses a normal spot (Active: a random respawn spot; countdown: a kickoff spot; Countdown has no temporary spots). In PostGoalScored or ReplayPlayback there is no spawn until the kickoff. Too many bots are destroyed when humans exceed MaxTeamSize. | [S] S1:2300-2330, 1160-1200, 32970-33000 |
| MR-7.13 | **A human takes a bot's place (casual).** Joining a full team → `FindBotReplacement` → `SetBotReplacement(bot)` → a spawn ticket of `RespawnDelaySeconds` 3 s, with the replacing-bot countdown messages (numerals and "GO"). Then `ReplaceBot`: the bot car's location, rotation and velocity, and the bot is destroyed. This is not in ranked. | [S] S1:2300-2327, 81898 |
| MR-7.14 | **Rejoin.** `CheckJoinInProgress` restores the player's match stats from `PlayerMatchData`. The player is appended to `Players`, so their next kickoff position follows the new order. The forfeit lockout persists (MR-7.5). | [S] |
| MR-7.15 | **Leave penalty and forfeit votes.** Leaving lifts the penalty: `bHasLeaveMatchPenalty` needs `humans == PlayerCount`. That destroys every team's running forfeit vote (`GameEvent_Team_TA.OnPenaltyChanged`) and turns "Abandon Match" into "Leave Match" for everyone. The remaining humans can then start a new vote. If a team is down to one human, that vote passes on the press. | [S] S1:2380-2386, 754 |

#### Match-type differences
| | Casual (`MatchType_Public_TA`) | Ranked (`MatchType_PublicRanked_TA`) | Private (`MatchType_Private_TA`) | Offline exhibition |
|---|---|---|---|---|
| ForfeitVoteWaitGameTime | 60 | 90 | 90 (base) | 90 (no playlist → no vote) |
| Vote label | "Vote to Concede" | "Vote to Forfeit" | per `bRankedMatch` [I] | – |
| Auto-forfeit on an empty team | yes (after the 30 s wait) | yes | **never** | never |
| Bots fill leavers | yes (`bAllowBotFills`) | no | per settings | yes (offline bots) |
| Human takes over a bot | yes (3 s) | no | – | – |
| Cancel before the start | wait expired and a team has no human | wait expired, a reservation timed out, or the lobby is not full | – | – |
| WaitForPlayersTime | 30 s | 30 s | 15 s (Custom) | – |

The playlist flags (`bAllowForfeit`, `bApplyQuitPenalty`, `bAllowBotFills`, `PlayerCount`) come from PsyNet at run
time. They are not in the packages; casual and ranked are inferred to have bApplyQuitPenalty from their leave-penalty
UI. Tournament matches inherit ranked's 90 s and add series forfeits (out of scope).

#### Server-side requirements (MR-7)
1. **Per-team vote.** Store the voters (team humans), statuses, 20 s on ticks, and the yes count. Pass when yes ≥
   the number of voters. Fail at the timeout. Linger 5 s for the HUD. A press during a running vote is a yes.
2. **Lockout.** Store a per-player "has started a vote" flag. Re-enable the whole team when no member can start one.
   Keep the flag across reconnects. Enforce it on the server.
3. **Allowed predicate.** Recompute `can_vote` every clock second, on state changes and on joins and leaves: no
   winner, and (overtime count-up, or clock elapsed ≥ 60/90 s). The playlist predicate is a server config.
4. **Leaver.** Demolish the car (explosion FX, no demolition stat), then run the forfeit check 0.01 game s (1–2
   ticks) later.
5. **Forfeit check.** A team with no humans forfeits if the match is public and started; both teams empty → no
   contest. Defer `end_match` to the end of PostGoal or Replay (`new_round`).
6. **Bots (if added).** Fill the slot 0.1 s later at the leaver's pose and velocity, if under 1 s old.
7. **A leave in a full lobby.** Cancel running votes.

### 5. Settled open items (match-rules-audit.md "Open")
- **Physics dilated during the slow motion:** yes, see MRL-1 to MRL-3.
- **`PlayerController.Prespawn.bPrespawnSet` before a kickoff:** cleared at the goal.
  - Active's PlayerSpawn feature stops when PostGoalScored begins; PostGoalScored's state components are only
    `PauseMetricsState_X`, while Countdown and Active have `PlayerSpawnState_TA`.
  - `PlayerSpawnSystem_TA.HandlePlayerSpawnStop(Feature, C)` then clears bPrespawnSet and destroys
    `PlayerSpawnTicket_TA` and `ReplicatedRespawnTicket_TA`.
  - The "stop on feature destroy" semantics of the system are inferred from the handler's (Feature, C) signature
    [I].
  - bPrespawnSet is also cleared by `HandleOvertimeUpdated` and `HandleTeamChanged`, and by `HandlePlayerSpawned` at
    each spawn.
  - `RestartPlayer` tries `GetOrientationFromDesiredSpawn` (the prespawn) first, so clearing it matters.
- **Array op 0x04:** Find, with a flag byte (handler 0x14034c9b0). Flag set → `index != -1` (Contains, a bool); flag
  clear → the index (−1 if missing).
  - The sub-op table is at 0x142395ad0 and is filled by 0x14036dfe0 from static initializers at
    0x140181440-0x140182800.
  - 0x25 → 0x140351250 and 0x26 → 0x140351270 both call 0x14036bf90 with the flag 0 or 1. It returns the predicate
    value as soon as that equals the flag, else !flag; an empty array gives (flag == 0). So **0x25 = Every, 0x26 =
    Any**.
- **`Players` order:** join order, see MRL-8.

### 6. Corrections for notes/match-rules-audit.md
1. **"Forfeit:" bullet.** Change "a team without humans forfeits automatically 0.01 s after a leave (not in bot
   matches or while joining; …)" to add:
   - only public match types (casual, ranked, tournament), once the 30 s wait-for-players has expired or the match
     has started;
   - never in private, LAN or offline matches;
   - not once a winner is decided;
   - in PostGoalScored and ReplayPlayback the end is deferred to `StartNewRound`.
2. **"Votes after game-clock elapsed ≥ ForfeitVoteWaitGameTime 60 s casual / 90 s ranked, always in overtime; pass
   threshold not found".** Replace with:
   - unanimous among the team's human voters (idle-banned excused), 20 s, no "no" button;
   - the wait is the match clock's elapsed time (from 4:00 casual, 3:30 ranked);
   - "always in overtime" means whenever the clock counts up;
   - private matches use 90 s;
   - one start per player per cycle, enforced by the menu only.
3. **MR-6 row, "no replay = everyone skips".** More precisely: no replay when every human has auto-skip on; the skip
   needs every non-bot player ready, with no count shown, only names.
4. **"Casual fills with bots…" bullet.** Add that the leaver's car is demolished and the bot spawns 0.1 s later with
   the leaver's pose and linear velocity.
5. **The "Ours" lines are out of date.** The working tree has the slow-motion pacing, the replay plan, the skip and
   auto-skip, and the team-empty forfeit (`server/src/game.rs`). The audit's "Ours today" paragraph and the MR-6/MR-7
   "Ours" cells should be refreshed.
6. **Open list.** Remove the four settled items (§5). The 6-DOF axis reading, the knockback falloff and the live
   uneven-teams check stay.

### 7. Ours (working tree) vs the game, remaining differences
| # | Game | Ours | Impact |
|---|---|---|---|
| D-1 | A forfeit in PostGoal or Replay ends the match at `StartNewRound` (the replay runs on) | `leave()` ends the match at once in every phase | low |
| D-2 | Forfeit and concede votes (MR-7.1-7.8) | none | medium (multiplayer UX) |
| D-3 | Both teams empty → no contest | everyone gone: idle until the next joiner starts a new match | very low |
| D-4 | The leaver's car is demolished (explosion) | the car vanishes (`remove_car`) | low (visual) |
| D-5 | Casual bot fill and bot takeovers | none (a project choice) | – |
| D-6 | Replay HUD lists the names of players not yet ready | `ReplayReady {ready, total}` count | presentational |
| D-7 | Input packets per render frame (real-time cadence) | every 2 ticks, so slower during the slow motion; the jitter buffer measures real-time gaps | low; check |
| D-8 | A joiner during the replay sees it (server-streamed) and must press skip | must press skip (same), but has no recording to play | low (needs a server ring buffer) |

**Status (main session, 2026-10-10, protocol 10, uncommitted):**
- **D-1 done.** A forfeit in PostGoal or Replay sets `forfeiting`; the match ends at `new_round`. Test:
  `a_forfeit_after_a_goal_ends_the_match_at_the_next_round`.
- **D-2 done.** Per-team votes: 20 game s, unanimous, a joiner added and a leaver removed, failed only at the timeout,
  5 s linger. The initiator lockout is enforced on the server, keyed by a per-tab client key (Hello's `key`,
  sessionStorage) so it survives a reconnect; the team is re-enabled when nobody on it can start one.
  `bCanVoteToForfeit` is evaluated per tick as the first tick past the wait (4:00 shown in casual); 90 s for ranked and
  private; overtime always; never once `HasWinner`.
  - Playlist predicate: casual and ranked allow votes; private allows them in 1v1s only (its flags are unknown, §9.3).
  - Server options: `--match-type casual|ranked|private`, `--forfeit-vote-wait SECONDS`.
  - Client: the Escape menu shows "Vote to Concede"/"Vote to Forfeit" or the 1v1 "Forfeit Match" with its confirm,
    and "Leave Match" with its confirm (back to freeplay). The HUD widget shows the tally, the m:ss time and a time
    bar [I], plus "Press Esc to Vote" until the player votes; it fades in 0.3 s.
  - MR-7.15: a leave from a full public lobby ends every vote.
  - Tests: 5 server tests, client unit tests, and e2e `forfeit.spec.ts`.
- **D-3 done.** When everyone has gone, the match is a no contest (flag 16). Our arena stops ticking with nobody in it,
  so this happens at the leave, not 0.01 s later.
  - The countdown-end recheck of every team is not done: our matches start without the 30 s WaitingForPlayers, so a
    team empty from the start (solo play) is not a forfeit.
  - The leave's own check runs 2 ticks later (`CheckAllTeamsForfeitState`), in casual and ranked only.
- **D-4 done.** Event kind 2 `left`: the others draw the demolition effect, shake and sound where the car was drawn,
  with no stat.
- **D-6 partly.** The skip prompt is now `SkipInstructions` ("Press Space to Skip" / "(A)") and the n/m count is
  gone. The names list needs player names, which come with the scoreboard.
- **D-7: no change needed (MRL-16, corrected by RV-238).** The client already sends its input packets at 60 Hz of real
  time, once a frame, as the game does, so their gaps don't stretch in the slow motion. The jitter buffer measures in
  real time as the game's (RealTimeSeconds, MR-6.6): 7 before the goal, 7 through and after it (30 Hz: 8 → 9 either
  way). A game-clock sizing tried in 5acdfe3 was reverted; it rested on a test that sent a packet every 2 game ticks,
  which the client doesn't. Test: `the_slow_motion_after_a_goal_leaves_the_jitter_buffer_as_it_was` (the real cadence).
- **D-5** (bots) and **D-8** (a ring buffer) remain open.

### 8. Text the clone would need (keys and paraphrases; not cleared unless noted)
| Where | Key | Meaning |
|---|---|---|
| Replay skip prompt | UIText `[Global] SkipInstructions` | press {key} to skip |
| Replay view toggle (only with GS-11) | UIText `[Global] ToggleToChangeView` | press {key} to toggle the view |
| Binding name | Controls `[ReadyUp] Label` | skip the replay |
| Setting | UserSettings `[AutoSkipGoalReplay] Label`/`Description` | skip goal replays; votes to skip automatically |
| Menu (teams) | UIText `[Global] VoteForfeit` / `VoteConcede` | vote to forfeit (ranked) / vote to concede (casual) |
| Menu (1v1) | UIText `[Global] ForfeitMatch` + `[ModalPopups] ForfeitMatchInquiry` + Yes/No | forfeit the match; are you sure? |
| HUD tally | UIText `[Global] VoteToForfeitCount` / `VoteToConcedeCount` | vote to forfeit / concede {n}/{total} |
| HUD hint | UIText `[Global] VoteInstructions` | press {key} to vote (the key opens the pause menu) |
| Menu (leave) | UIText `[Global] LeaveMatch` + `[ModalPopups] LeaveMatchInquiry` | leave the match; are you sure? |
| Penalty texts (only with leave penalties) | `[Global] AbandonMatch`, `[ModalPopups] LeaverPenaltyInquiry`, `ConcedeMatchLow/Med/HighInquiry` | abandon; warnings about matchmaking bans |
| Already cleared | `[GFxHUD_TA] PlayerLeaveString` (join/leave); `[Global] WinnerByForfeit`, `MatchCancelled`/`MatchCancelledDesc` (end menu) | – |

The **new text to clear** with the user is the first ten rows (skip prompt through the penalty texts).

### 9. Open
1. **Server-side dilation.** No dedicated-server binary is available, so this rests on the shared UWorld code, the
   authority-run Tick, the replicated TimeDilation and the netcode staying consistent. [I], high.
2. **Playlist flags** (`bAllowForfeit`, `bApplyQuitPenalty`, `bAllowBotFills`, `PlayerCount`): PsyNet data, not in
   the install. Casual and ranked are inferred from the UI.
3. **Private matches.** Whether a forfeit vote is offered (it depends on the private playlist's flags), and whether
   spectators are PRIs that block the replay skip.
4. **`Team_TA.OnPlayerMarkedAsIdleBanned`** is only partly decoded (unknown token 0x62). Reading: it re-enables the
   other active members' vote start.
5. **The game's input-packet cadence during the slow motion** (real time vs game time accumulation for the
   1/60 s send gate, N-9).

**Live checks worth asking the user for** (offline-safe items first):
- **Freeplay or exhibition:** with Skip Goal Replay off, stopwatch from the goal to the replay's first frame:
  expect about 3.5 s; 3.0 s would mean no dilation.
- **Exhibition:** after a goal with the replay skipped at once, the time from the goal to "GO": about 7.5 s + the
  skip delay.
- **Online casual** (the user's own matches only): the "Vote to Concede" button appears at 4:00; the tally shows
  {n}/{team humans}; a solo human on a team forfeits at once.

### Files (local, out/bsim/agents/MRL1/)
- `work/fn.py` (disassembler with raw hex), `work/children.py` (function params), `work/propflags.py` (UProperty
  flags), `work/findcalls.py` (call-site finder).
- `work/slomo_ticks.py` (the per-tick table), `work/offsets.py` and `work/autolines.py` (log analysis).
- `decomp/` (0x14036bf90, 0x14034c9b0), `logs/` (copies of the user's logs; local only).

**Cleared to ship verbatim (user, 2026-10-10):** the replay-skip, vote, forfeit and leave text below. The
abandon/leave-penalty warnings (AbandonMatch, LeaverPenaltyInquiry, ConcedeMatchLow/Med/HighInquiry) stay out until
leave penalties are added.

| File | Section | Key | Verbatim string |
|---|---|---|---|
| UIText.int | `[Global]` | `SkipInstructions` | Press {0?KeyBinding} to Skip |
| UIText.int | `[Global]` | `ToggleToChangeView` | Press {0?KeyBinding} to Toggle View |
| UIText.int | `[Global]` | `VoteForfeit` | Vote to Forfeit |
| UIText.int | `[Global]` | `VoteConcede` | Vote to Concede |
| UIText.int | `[Global]` | `VoteToForfeitCount` | Vote to Forfeit {0?Number}/{1?Total} |
| UIText.int | `[Global]` | `VoteToConcedeCount` | Vote to Concede {0?Number}/{1?Total} |
| UIText.int | `[Global]` | `VoteInstructions` | Press {0?KeyBinding} to Vote |
| UIText.int | `[Global]` | `ForfeitMatch` | Forfeit Match |
| UIText.int | `[Global]` | `LeaveMatch` | Leave Match |
| UIText.int | `[ModalPopups]` | `ForfeitMatchInquiry` | Are you sure you want to forfeit the match? |
| UIText.int | `[ModalPopups]` | `LeaveMatchInquiry` | Are you sure you want to quit the match? |
| Controls.int | `[ReadyUp]` | `Label` | Skip Replay |
| UserSettings.int | `[AutoSkipGoalReplay]` | `Label` | Skip Goal Replay |
| UserSettings.int | `[AutoSkipGoalReplay]` | `Description` | Automatically votes to skip the goal replay. |

---

## Goal-explosion knockback (KNB-1..10, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent KNB1 (decompiles, an engine copy with a goal_push tool,
and replay data local in out/bsim/agents/KNB1/). The velocity cap at the start of each substep is bullet-diff.md B9
(applyDamping 0x1402c23a0; caps |v| to body+0x368 = MaxLinearSpeed × 0.02). The proposed text for validation.md
finding 46 is in the draft; the live session owns that file.

KNB1, 2026-10-10. Live build 2026-10-06. Addresses are from the live Ghidra project (a copy of
`out/bsim/rl-20261006` in `out/bsim/agents/KNB1/rl-live`). Game-derived data stays in this workspace.

### Verdict
**The decoded size holds: Δv = 5000 · (1 − r/3000)^0.1 uu/s, with no hidden factor.** The ~0.82× was a
**measurement artefact** of finding 46's formula fit. Its main cause: the push direction was taken from the car's
position in the replay row *before* the push, not at the push tick. A product handler doesn't explain it: Classic and
~50 other products carry no physics of their own. Slow motion doesn't explain it either, because the push is a pure
Δv with no dt.

The engine-from-frame check (the clone's engine run from each replay row through the push, with tick count, push
tick and scale fitted) fits the replays to their own precision. On the 441 best cases the position error is
0.01–0.05 uu and the velocity error 0.4–2 uu/s. The fitted scale is **s = 1.02** (IQR 1.007–1.045; per product
0.999–1.045; Classic 1.024). A free fit gives A = 5143 and falloff 0.109; 4442 / 0.18 is rejected (median residual
837 vs 105 uu/s).

The same runs found three things the engine gets wrong (KNB-5…7): the speed cap order, the spin, and the origin.

### Summary
- **KNB-1 (chain, static, high).** No factor between the script's `RBVelocityChange · DamageScale` and Bullet's Δv:
  ×0.02 (uu→BU), ×1/m_inverseMass (VelChange), then applyImpulse ×m_linearFactor·m_inverseMass, so Δv (uu/s) is the
  script's vector. Details below.
- **KNB-2 (magnitude, data, high).** Engine from each frame: s = 1.019–1.026 (median, by model variant) over
  615 well-fit base-product pushes, and 1.007–1.04 on the 5 uncapped cases. No distance trend with falloff 0.1
  (0.18 makes the far pushes 13% too big). The decoded 5000 / 0.1 stands.
- **KNB-3 (the 0.82 is an artefact, data, high).** The formula fit `cap(v_A + p·u) ≈ v_B` on the same cases gives
  0.92 with u from the car's row position and 1.04 with u from its position at the push tick (1.017 with the lag
  of KNB-6). Gravity left out of the formula accounts for its 25 uu/s residuals (5 uu/s with gravity).
- **KNB-4 (products, static + data, high).** Of the 58 goal-explosion products in the 98 replays, only four carry
  `ExplosionComponents`. These detach the base wave (`Ball_TA.InitExplosionFX`):
  - Air Strike 5287: `DefaultHitHandler_TA` 1500, Speed 2500, EndTime 1.0, plus `DemoExplosionHandler_TA` 1.375–2.116 s, radius 500.
  - Sweet Score 9805: `DefaultHitHandler_TA` 3500, Falloff 0, EndTime 1.0, plus `OverrideMaterialsHitHandler_TA`.
  - Reaper Ultra 11747 and Brimstone 8536: `OverrideMaterialsHitHandler_TA` only, so no push. The replays agree (17/28 and 4/6 goals push nobody, the rest are noise).

  Classic 1903 (`Explosion_Default`) and the rest have none; neither does the slot archetype or the class default.
  Finding 46's "Butterflies its own way" is one player's goals ("Bosco", 2 replays, 9 goals: no push). The other
  Butterflies goals push with the base wave (s 1.02–1.05). Likely a wrong product attribution in the extract (open).
- **KNB-5 (cap order, data + static, high). Engine fix.** The game caps the pushed velocity *before* integrating
  it. The explosion's push lands between ticks, and the next substep's `applyDamping` (0x1402c2ea0) scales |v| to
  body+0x368 = MaxLinearSpeed·0.02 first. The engine pushes after `Car::_PreTickUpdate`'s `_LimitVelocities`, so it
  integrates up to |v0 + Δv| ≈ 3000–7000 uu/s for one tick. Replays: car position error 0.17 → 2.8 uu median
  (p90 0.86 → 8.7), velocity 6 → 27 uu/s.
  **Correction (2026-10-10, OLD1, live) [N]:** the first cap is the next physics frame's **pre-step read-back**, not
  applyDamping. The car pre-step (TickNotify +0x28, FUN_140f21a90 → FUN_140f21850) sets OldRBState = RBState =
  FUN_140ef2770(actor) (|v| scaled to MaxLinearSpeed 2300 and |ω| to 5.5 in uu, then quantised) and writes it back into
  the body (FUN_140f35870) before the Bullet step; applyDamping then changes nothing. Every game read of the body goes
  through that getter, so **OldRBState in the tick after a push holds the capped, quantised pushed velocity** (never the
  raw push, never the pre-push value). Bump/demo (ApplyCarImpactForces, GetBumpImpulse, ShouldDemolish) and
  ApplyBallImpactForces read it, and the uncapped value is never replicated or visible. The push itself is
  applyImpulse at once (0x1402b11d0, + activate) from ExplosionComponent_X's component Tick (FUN_140e5dcb0), always
  outside a physics frame.
- **KNB-6 (spin, data + static, high on the effect, medium on the exact lag). Engine fix.** `HitLocation` is
  `Victim.Location`, and AddImpulse applies the impulse there (`applyImpulse(J, HitLocation·0.02 − origin)`). The
  replays fit when Location is the car's body position **one tick earlier** (actor Location lags the body by a
  tick). So the push also spins the car: Δω = I⁻¹_world · ((L_prev − x) × J), lever ≈ one tick of travel (≈ 10–19 uu).
  The direction uses L_prev too. Car angular velocity error drops 4.85 → 0.83 rad/s median, and linear errors also
  improve (velocity 6.1 → 5.2). The engine applies the push with no spin.
- **KNB-7 (origin, data, high). Engine fix.** The explosion goes off at the ball's location **one tick before**
  the goal is detected. `Ball_TA.Explode`'s default `ExplodeLocation = Location` is the stale actor Location, the
  same lag as KNB-6. In all 810 goals the replicated exploded ball sits at |y| ≤ 5215.49, and one tick of its
  velocity further would cross it (99.5%). The engine uses the detection-tick position (≈ v/120 deeper, 10–30 uu).
  Its fits are worse: position 0.17 → 0.35 uu, velocity 6 → 12 uu/s. MomentumOffset is (500 back, 500 down)
  exactly: ±10 uu on either axis is worse.
- **KNB-8 (slow motion, data + static, high).** The push is unaffected.
  - AddImpulse has no dt. The wave uses the component DeltaTime only for LifeTime (radius = LifeTime_before·10000).
  - In the replays each physics tick is 1/120 game s: gravity fits to 0.01 uu through the window. Game time per
    replay frame stays ≈ 1/30 s through the `ScoreSlomoCurve` window (0.125 → 0.225 at 0.1875 → 0.625).
  - Pushes landing before the curve starts and after it give the same s (1.03–1.05 at < 0.125 s, 1.01–1.03 after).
- **KNB-9 (overlap test, static, high; effect on the hit tick: small).** `FUN_1407fc990` / `FUN_1407fc5f0`
  (octree ActorOverlapCheck) tests the point-to-AABB squared distance from the explosion's location to each
  colliding primitive's bounds box (Origin ± BoxExtent) against radius². That gives one result per actor, excluding
  the explosion actor. The car's CollisionComponent is its CollisionCylinder (R 48, H 32, from `Default__Car_TA`),
  so the box is (lagged) Location ± (48, 48, 32), plus any other colliding primitive (the body mesh, unverified).
  The engine uses the OBB hitbox distance. This changes only when the wave reaches a car (DamageScale by < 1% inside
  2500 uu). The uncapped far cases need a hit about 30–100 uu earlier than the OBB distance for s = 1.
- **KNB-10 (small residual, open, low).** About 2% excess remains at short range (s 1.03 inside 750 uu, 1.006
  at 1500–2500). It is probably a remaining detail of the direction or lever model rather than a size factor, since
  the static chain has none. With s fixed at 1 (KNB-5…7 in), the median errors are 0.50 uu and 18 uu/s, against
  0.15 / 5.2 with s free.

### The chain (live addresses)
1. **`Ball_TA.Explode`** (TA:11417) runs on the authority from `HandleHitGoal`. It is called from the ball's
   post-physics goal check `FUN_140f5f800` on the tick the RB position has |y| ≥ 5120 + 95.49.
   - `ExplodeLocation` defaults to `Location`, the actor Location from one tick before (KNB-7).
   - `Explosion = ExplosionArchetype.SpawnInstance(ExplodeLocation, GoalOrientation.Rotation)` spawns an `Explosion_X`.
     Its `ExplosionComponent_X` is `Archetypes.Ball.Ball_Default.ExplosionArchetype.DefaultExplosion`:
     RBVelocityChange 5000, EndRadius 3000, Falloff 0.1, bPassThroughWorldGeometry, MomentumOffset (−500, 0, −500).
     Class defaults: Speed 10000, StartRadius 0, bIgnoreInstigator false.
   - `InitExplosionFX` replaces it with the product's handlers only if the product has `ExplosionComponents` (KNB-4).
     Its trailing `SetOwner(Scorer.Car)` changes the actor's Owner, not the component's (no effect on `Owner.Location`).
2. **Component tick `FUN_140e5dcb0`**, (this, DeltaTime):
   - `radius = StartRadius + LifeTime·Speed` uses LifeTime **before** `LifeTime += DeltaTime` (game time).
   - Only while radius ≤ EndRadius: `t = LifeTime·Speed / (EndRadius − StartRadius)` (1 if ≤ 0), and
     `DamageScale = powf(1 − t, Falloff)`.
   - Overlap `GWorld->Hash` vtable +0x48 = `FUN_1407fc990` (KNB-9), centred on the owner's Location, with radius.
   - Per actor it skips deleted or pending-kill actors, Physics ≤ 1 (byte +0xcb), and actors already in `DamagedActors`.
   - The line trace is skipped (bPassThroughWorldGeometry). `DamagedActors.AddItem`, then the `ProcessHit` event
     with (Victim, HitLocation = Victim.Location (+0x90), hit info, DamageScale).
3. **`ExplosionComponent_X.ProcessHit`** (ProjectX dump line 6013):
   - Requires a CollisionComponent, Physics == rigid body, RBVelocityChange > 0 and DamageScale > 0.
   - `MomentumDir = Normal(HitLocation − (Owner.Location + MomentumOffset >> Owner.Rotation))`.
   - `CollisionComponent.AddImpulse(MomentumDir·RBVelocityChange·DamageScale, HitLocation, <empty BoneName>, true)`.
     The raw bytecode has the empty-parameter token before `true`, so `true` is bVelChange.
4. **`UPrimitiveComponent::execAddImpulse` 0x140981ff0** calls vtable +0x378. All AddImpulse implementations in
   the vtables (0x140985160, and the overrides 0x140985400 / 0x140985880) call **`FUN_140985160`**:
   - It finds the component's btRigidBody (`FUN_140966d50`, internalType rigid body).
   - `J = Impulse·0.02`; `rel = Position·0.02 − m_worldTransform.origin` (0 if Position is zero).
   - If bVelChange and m_inverseMass (+0x180) > 0: `J *= 1/m_inverseMass`.
   - `applyImpulse(J, rel)` 0x1402b11d0, then `activate(false)` 0x140270ef0.
   - There's no clamp and no dt. The non-Bullet branch (PhysX-style actor, velocity-change mode 2, wake 0.4 s)
     isn't taken for cars: the data shows the pushes.
5. **applyImpulse 0x1402b11d0** is stock 2.82 (`out/bsim/bullet-2.82` btRigidBody.h:318–338):
   `v += J·m_linearFactor(+0x190)·m_inverseMass`, and `applyTorqueImpulse(rel × (J·m_linearFactor))`.
   **0x1402b1300** is `ω += I⁻¹_world(+0x130)·τ·m_angularFactor(+0x390)`. So Δv = Impulse_uu·0.02 BU/s, exactly the
   script's vector in uu/s.
6. **Speed cap.** `ARBActor_TA::execSetMaxLinearSpeed` 0x140e73a50 writes body+0x368 = MaxLinearSpeed·0.02 (Car_Default
   2300). `applyDamping` 0x1402c2ea0 (Psyonix, stock 2.82 has none) scales |v| to it, and |ω| to +0x36c, before the
   stock damping. Stock `predictUnconstraintMotion` calls it at the start of every substep. The push is therefore
   capped before it moves the car (KNB-5). The RB-state read-back 0x140ef2770 (old 0x140eed9e0) caps again at the
   end of the tick.

### Evidence
Tool: `eng/tools/goal_push.cpp` (a copy of `replay_validate.cpp`'s loader and setup with a new main), built in
`build/eng`.
- Per goal it takes the ball's replicated exploded row as the origin. Running the ball from its last moving row
  reproduces that row to 0.000 uu (median) after n ticks.
- Per car within 3600 uu it takes the row pair with the biggest no-push error (a push happened: 1372 of 1507 base
  rows). It runs the Octane-preset car from row A with the replicated inputs (the validator's warm-up). It fits k
  (1–24 ticks), the push tick j, and s (grid 0.30–1.50, then golden section) to row B's position and velocity.
- Variants are run in parallel on the 819 clean cases: base-product, pushed, error < 3.

| Variant (819 clean cases) | pos err | vel err | ang err | s (err < 0.5) |
|---|---|---|---|---|
| base: game order, origin = exploded row, no lever | 0.173 uu | 6.06 uu/s | 4.85 rad/s | 1.051 |
| + engine order (uncapped for one tick) | 2.758 | 27.0 | – | 0.960 |
| origin = detection-tick ball (the engine's) | 0.346 | 12.2 | 4.85 | 1.032 |
| **lever/direction from the car's position one tick earlier** | **0.150** | **5.16** | **0.83** | **1.024** |
| same, lag 2 ticks | 0.153 | 5.22 | 1.48 | 1.004 |
| lag 1, DamageScale from r = d | 0.149 | 5.16 | 0.83 | 1.021 |
| lag 1, falloff 0.18 | 0.153 | 5.16 | 0.83 | 1.077 (beyond 1500 uu: 1.128) |
| lag 1, MomentumOffset (490 / 510, 500) and (500, 490 / 510) | 0.154–0.482 | 5.50–17.2 | 0.81–0.84 | 1.017–1.026 |
| lag 1, s fixed at 1 | 0.50 | 18.1 | 0.82 | 1 |

(Medians. "err" = pos + 0.05·vel. Variant CSVs: `work/var/*.csv`. Full run of all 1686 car–goal rows:
`work/gp_all.csv`.)

s by distance (lag 1, r = d): 1.042 (< 250 uu), 1.032, 1.033, 1.025 (750–1000), 1.017, 1.010, 1.006
(2000–2500), 1.021 (2500–2800). s by product (≥ 5 cases): 0.999–1.045, median 1.021; Classic 1903 1.024 (13).

Uncapped pushes (the size itself, not only its direction): s 1.007, 1.015, 1.018, 1.033, 1.040 at d 2500–2830.
That is s = 1 if the car is reached 30–100 uu before its OBB distance (KNB-9).

Artefact check (same 475 in-air cases, Python, `cap(v_A + p·u)` vs v_B):

| u from | gravity | median s | residual |
|---|---|---|---|
| car's row position | no | 0.921 | 25.3 uu/s |
| car's position at the fitted push tick | no | 1.043 | 24.4 |
| row position | yes | 0.931 | 5.8 |
| push-tick position | yes | 1.043 | 5.1 |
| push-tick position, one-tick lag | yes | 1.017 | 5.1 |

### Corrections
**match-rules-audit.md MR-6.** In "Goal → replay → reset" and the Follow-ups:
- "Goal-explosion knockback": keep `AddImpulse(dir · 5000 · DamageScale, VelChange)` and Falloff 0.1. Fix three things:
  - "HitLocation = its own Location … at the centre of mass (no spin)" becomes: HitLocation = the victim's actor
    Location, one physics tick behind its body. The impulse acts there, so the car gets Δω = I⁻¹(rel × J) with
    rel = L_prev − x. The direction is from L_prev too.
  - The origin is the ball's actor Location at the goal, i.e. its position one tick before the detection tick.
  - The push lands between ticks and is capped to 2300 (Bullet `applyDamping`, start of the next substep) before it
    moves the car.
- The overlap is "the sphere vs each colliding primitive's bounds box (point–AABB distance ≤ radius); for cars the
  CollisionCylinder box Location ± (48, 48, 32)". The note says "actor's collision".
- "Per-goal-explosion physics", "Replay fits that mix products (live session: ~0.82×, steeper falloff) need
  splitting": replace with "The replays fit the decoded wave for every product without ExplosionComponents (engine
  from each frame: s = 1.02, falloff 0.1; KNB1). The 0.82× was a fit artefact."
- Products in the replays with handlers: Air Strike, Sweet Score (pushes of their own), Reaper Ultra, Brimstone (no push).
- Optional: the live-address list gains 0x140981ff0 (execAddImpulse), 0x1402b11d0 / 0x1402b1300 (applyImpulse /
  applyTorqueImpulse), 0x1402c2ea0 (applyDamping cap), 0x1407fc990 / 0x1407fc5f0 (overlap), 0x140e73a50
  (SetMaxLinearSpeed).

**validation.md finding 46.**
- "Size: … about 0.82 of the decoded …; a fit gives 4442 × (1 − d/3000)^0.18 …" and "Why the default products fit
  lower is unsettled …": replace with this.

  > Running the engine from each replay frame through the push (KNB1, `goal_push`), the decoded size fits: s = 1.02
  > (IQR 1.007–1.045, 615 pushes; Classic 1.024; free fit 5143 × (1 − d/3000)^0.109; 4442/0.18 median residual 837 vs
  > 105 uu/s). The 0.82 came from taking the push's direction from the car's row before the push instead of its
  > position at the push tick (0.92 → 1.04 on the same cases), plus gravity left out (25 → 5 uu/s residual).

  Then add the three model fixes (KNB-5…7) with their numbers. The engine keeps 5000 / 0.1.
- "Butterflies (2700) its own way": one player's 9 goals with no push (likely a misattributed product). Other
  Butterflies goals push normally.
- "(Reaper Ultra carries a visual handler … Air Strike a 1500 push)": add Sweet Score (3500, falloff 0) and
  Brimstone (visual only).

### Engine spec (patch 77 follow-up, for the main session)
1. Apply the push before the cars' start-of-step cap. For example, run `_UpdateGoalExplosion` before
   `car->_PreTickUpdate`, so `_LimitVelocities` caps it, matching the game's `applyDamping` order. Jump and dodge
   impulses in the same tick then come after it, as in the game.
2. Keep each car's position one tick behind (its position at the start of the previous step). Use it as
   HitLocation: dir = normalize(L_prev − M), and `applyImpulse(J, L_prev − x)` with J = Δv·mass. That gives the spin;
   keep Δv = 5000·DamageScale·dir.
3. Origin = the ball's position at the start of the scoring step (one tick before detection), not after it.
4. Optional: reach test against the cylinder box (lagged Location ± (48, 48, 32)) instead of the OBB.
5. Tests: the existing `TestGoalExplosion` plus three checks. A car above 2300 after the push moves no more than
   2300/120 uu that tick. A car moving at the push gets the expected spin. The origin is one tick short of the line.

### Open questions
- KNB-10: the ~2% short-range excess (direction or lever detail; at s = 1, 18 uu/s median vs 5).
- KNB-9: whether the car's body mesh is also a colliding primitive (larger bounds, earlier reach).
- Why the actor Location lags the body by one tick (tick-group order of the Location sync vs the explosion and goal
  check). The data fixes the effect, not the code path.
- "Bosco"'s 9 no-push goals listed as Butterflies 2700: check the extractor's loadout or team choice for that player.
- Possible live check (offline exhibition with PhysLog, user at the controller): score with Classic while a bot or
  the player's car is airborne near the goal. Log per-tick velocity and angular velocity around the goal. That
  confirms KNB-5 (no over-cap tick), KNB-6 (spin, lag) and KNB-10 directly. It isn't needed for the magnitude verdict.

### Files (workspace)
- `knockback.md` (this), `scripts/` (Ghidra scripts DecompDown, FindSym, VtFromString, VtDump; Python scanners and
  analyses), `decomp/` (live decompiles).
- `eng/` (engine snapshot + `tools/goal_push.cpp`, `g_knbSkipClampOnce` experiment hook in `Car.cpp`), `build/`
  (`eng/goal_push`, `eng/replay_validate`, `rx/release/replay_extract`).
- `data/` (states / goals / demos extracted from `out/replays/*.replay`; `states_goals.csv` = goal windows).
- `work/` (handlers.txt, products_scan.txt, gp_all.csv, var/*.csv, only_clean.txt).
