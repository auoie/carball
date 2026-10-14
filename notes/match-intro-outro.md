# Match intro, outro and remaining cameras: spec (static session, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent MIO1 with three forks (UI, SPEC, RPL; raw drafts local
in out/bsim/agents/MIO1/). MIO-n rows cover the sequences; CAM-30..68 continue notes/camera-respawn-goal.md's
numbering. The static session re-checked the end-game timers (PodiumDelay 3.0, PodiumTime 5.3 in the Soccar game
event; SetStateTimer at TA:4345/4442). UI text is by localization key only unless listed as cleared (chat, join/leave,
stat/accolade/podium titles); §5 lists the rest for the user.

Live build 2026-10-06 (snapshot rocketleague-20261006). Extends notes/camera-respawn-goal.md: camera rows continue at
CAM-30, sequence rows are MIO-n.

**Tags:**
- [A] package data: archetypes, class defaults, level objects.
- [S] script. `TA:n` = line in out/bsim/work/tagame_live_all.txt; `S1:n` = STAT1's patched re-decode
  (out/bsim/agents/STAT1/work/tagame_stat1.txt); `PX:n` = ProjectX dump (out/bsim/agents/PNT1/projectx_live_all.txt).
  [S raw] = hand-decoded from the bytecode where the decoders fail.
- [N] live native (address).
- [G] AS3 / GFx (movie, class, method m#).
- [L] the user's game logs (facts only).
- [I] inferred.

**Units and frames:**
- RL world coordinates, which are the clone's arena frame: goals at y = ±5120, blue (team 0) defends −y.
- Rotator units: 65536 = 360°, 182.044 per degree.
- "game s" = dilated game time.
- UI timings are real time on the client, from the moment it sees the replicated state change.

**Local files** (git-ignored), in out/bsim/agents/MIO1/:
- work/: dumps and the podium calculator podium.py;
- UI/: winner/end-screen movies and decompiles;
- SPEC/: spectator director;
- RPL/: replay viewer;
- decomp/: live natives;
- logs/: copies of the user's logs (contain account IDs).

**Camera framework used below** (notes/camera-respawn-goal.md §1 and §2, re-checked) [S PX:4339-4480]:
- **State selection:** the first state in `Camera.States` order whose ShouldExecute passes, or the current one while
  it ShouldKeepExecuting.
- **Persistent POV:** a state that writes nothing holds the last frame.
- **Blends:** the outgoing state's GetEndBlendParams, by default the incoming state's GetStartBlendParams, by default
  `Default__CameraState_X` 0.25 s EaseIn exponent 2.
  - The blend fades a frozen start difference: pct = f(remaining/T).
  - BlendTime 0 is a cut.
- **POV:** CalculatedLocation = Focus − RotVector(Rotation)·Distance (PX:4232).
- **Camera fade** `SetCameraFade(color, T)` (PX:4395-4419): RGBA moves linearly from the current fade colour to the
  target over T, and is applied over the frame.
- **Rotator helpers:** `V << R` rotates by the inverse of R, world to local (execLessLess_VectorRotator
  [N 0x14035b890]: result_i = row_i(R)·V); `V >> R` is local to world [N 0x14035b700].

`Camera_Default.States` (the player's camera; Camera_Replay in §3/§4) [A GameInfo_Soccar_SF]:
1. KismetOverride
2. SeasonIntro
3. LiveReplay
4. ScorerLiveReplay
5. PodiumSpotlightExplosion
6. PodiumSpotlight
7. PrePodiumSpotlight
8. PreMatchLobbyFocus
9. PreMatchLobby
10. Waiting
11. Prespawn, Demolished, DemoSpawnSelect
12. LookAtBall, BallcamInverted, Ballcam
13. FreeCam
14. CarInverted, Car

---------------------------------------------------------------------------------------------------------------------

## 1. Pre-match

### 1.1 State machine (standard Soccar: casual, ranked, private, offline exhibition)
`GameEvent_Soccar` archetype: InitialEventState WaitingForPlayers, WarmupTime 3, CountdownTime 3 [A]. The match
start itself is in notes/match-rules-audit.md (MR-3, "Warm-up order"); the timeline below adds what the player sees.

| t | Server [S] | Player's camera | Screen (UI rows §1.4) |
|---|---|---|---|
| map loaded | `WaitingForPlayers.BeginState` (TA:3666): CheckStart every 0.1 s; `bReadyToStartGame` false. PreMatchLobby only if `MatchType.LobbyTime` > 0 (§1.3). Joiners spawn undriven at kickoff spots; ball XY-locked (TA:3745) | Loading movie closes: fade from black over **1.0 s** (`Camera_X.OnLoadingMovieClosed`, PX:4265). **Waiting** camera (CAM-30) until the car exists and ≥ 3 s have passed | waiting list (online) |
| car possessed, Waiting ≥ 3.0 s | – | **cut** to the car camera (Waiting's DefaultBlendParams BlendTime 0) | – |
| all players in, with cars | `CheckStart` (TA:3678): `bReadyToStartGame`; warm-up `SetGameStateTime(WarmupTime 3)`, still WaitingForPlayers | car camera | waiting list hides; 3 s silent |
| +3 s | `StartInitialCountDown` → Countdown (TA:1380, 3948): 1 s + 3 s; "3/2/1/GO" (VT-24); `SeqEvent_CountDownStart` Kismet (none in Stadium_P) | car camera, no cut (the car already exists) | scoreboard intro (HUD-4) |
| +7 s | Active (cars released) | car camera | – |

### 1.2 Rows (standard play)
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| MIO-1 | Pre-match flow | **States:** WaitingForPlayers → (warm-up 3 s inside it) → Countdown 4 s → Active.<br>**No contest:** online, `ShouldCancelMatch` when the wait expires without enough humans (`WaitForPlayersTime` 30 s public [A Default__MatchType_Public_TA], 90 s tournament) → `EndGame` → Finished, no podium (TA:3678-3693, 2837).<br>**Offline:** the players have cars at once, so the warm-up starts on the first check [I].<br>**Freeplay:** CountdownTime 0 (GS-14) [S][A] | first joiner starts a kickoff; `new_match` adds the 3 s warm-up to the first countdown (`server/src/game.rs:367-380`) | Keep the warm-up. Add a waiting phase (online) that holds until the expected players have cars or 30 s pass |
| MIO-2 | Fade-in at load | Opaque black → clear over 1.0 s, linear, when the loading movie closes [S PX:4265, 4407] | none (`client/src/render/fade.ts` only fades in after replays) | `Fade.fromBlack(1.0)` when the arena first draws |
| MIO-3 | No intro sequence for players | In standard Stadium play: no fly-in, no matinee, no car showcase, no name banners [S][A]. Evidence:<br>• Stadium_P's only Kismet is level-load FX, ads and audio-map streaming (`Main_Sequence`: 3 SeqEvent_LevelLoaded, SeqAct_AttachFX_TA, SeqAct_MultiLevelStreaming, SeqAct_UpdateAd_TA ×10, SeqAct_ToggleHidden). There is no InterpData, SeqAct_Interp, CountDownStart or PodiumStart event.<br>• The countdown "shots" (TailPass, RotateAroundCars) are **spectator-director only** (Camera_Director.Selector_Countdown; §3).<br>• The VS/intro screen and the SeasonIntro orbit need `bShowIntroScene`, set only by the tournament and honor-duel match types (§1.3) | – | Nothing to add. The intro is the Waiting view (CAM-30), then the car |
| MIO-4 | Online vs offline | Same states and cameras. Online adds the wait for reserved players (list, 30 s), bot fill in casual, and a client-side state lag (states replicate as `ReplicatedStateName`, `GameEvent_TA.ReplicatedEvent` TA:689; camera timers run on the client) [S]. Offline Season: no highlights replay (`GameEvent_Season_TA.BeginHighlightsReplay` TA:34242 is a no-op) | – | – |
| CAM-30 | **Waiting camera** (join, before the car) | `CameraState_Waiting_TA` (extends CameraState_CamActor_X) [S TA:18122-18157][A]:<br>• **View:** the level's first CameraActor (`WorldInfo.GetActor(class'CameraActor')`). Stadium_P `CameraActor_7`: location **(3974.73, 0, 342.39)**, rotation pitch 364 (+2.0°), yaw 32768 (looking −x across the field from the +x side wall), **FOV 100** (FOVAngle). Static; post-process override flags all off.<br>• CamActor_X.UpdatePOV: Focus = location + forward, Distance 1, FOV from the actor (PX:4571).<br>• **Execute:** ExecutionTime = 0 and the view target is not a car and not demolished; or Active with `PRI.bTeamChanged` and no team (private-match team change).<br>• **Keep:** not demolished and (no car / PRI / event, or ExecutionTime < **MinExecutionTime 3.0** while WaitingForPlayers).<br>• ExecutionTime only accumulates, so it runs once per camera.<br>• **Exit:** a cut (`Camera_Default.Waiting` DefaultBlendParams BlendTime 0).<br>• A join during Active leaves as soon as the car exists | camera starts behind the car (`rlCamera.ts` `reset()`) | Before the local car exists, and for the first 3 s of WaitingForPlayers, show this fixed view (FOV 100), then cut to the car cam |

### 1.3 Pre-match lobby and intro scene (feature-gated; not standard play)
- **Gating:**
  - `ShowPreMatchLobby` = `MatchType.LobbyTime` > 0 (TA:67571).
  - LobbyTime is 0 in every standard match type. Only `MatchType_HonorDuel_TA` sets it: LobbyTime 90, LobbyIntroTime 7
    [A, UI/matchtypes.txt].
  - FaceIt sets LobbyTime to its wait time (TA:68044); tournaments only on the first game (TA:67969).
  - `bShowIntroScene` is set by `MatchType_Tournament_TA` / `MatchType_HonorDuel_TA.OnStartWaitingForPlayers`
    (TA:67900, 106260) and `PreMatchLobby.StartIntroScene` (TA:3773).
  - The CHAT/STAT notes' "Features.PreMatchLobby" gates only the quick-chat row.
- **PreMatchLobby state** (TA:3755-3914; S raw for the rest) [S][A]:
  - **Begin:** ready-up allowed; lobby spawn cluster `SpawnPointLobbyTeams[MaxTeamSize − 1]` around FieldCenter;
    GameTimeRemaining = LobbyTime; balls hidden and frozen.
  - **Clock:** counts down while no intro scene and every team has players. At 0 the match is cancelled
    (`ShouldCancelMatch`), or an empty honor-duel team forfeits, else ForceMatchStart.
  - **Ready:** a player's car gets "freestyle" (EnablePodiumMode: driving with unlimited boost; TA:3884). All ready →
    `PreMatchPlayersReadyStartDelay` 5.0 s → ForceMatchStart [A Default__GameEvent_Soccar_TA].
  - **Bots** fill once less than `LobbyEndCountdown` 5 s remains (public/private).
  - **ForceMatchStart:** with LobbyIntroTime > 0, the intro scene (VS screen) runs for LobbyIntroTime, then StartMatch.
    StartMatch = ResetToDefaultTime, StartInitialCountDown, RestartPlayers (to kickoff spots), ResetBalls.
- **Lobby car spots** [A SpawnPointGroup_TA]: location = FieldCenter + (Offset << FieldOrientation), yaw =
  FieldOrientation + Facing (TA:91147).

  | Team size | Team A offset (facing) | Team B offset (facing) |
  |---|---|---|
  | 1v1 | (160, 0) (2000) | (−160, 0) (30000) |
  | 2v2 | adds (150, −100) (4000); first is (160, −260) | mirrored x; (28000) |
  | 3v3 | adds (100, 90) (6000) | (24000) |
  | 4v4 | adds (170, −375) (100) | (32100) |

  With FieldOrientation yaw 16384, `<<` maps (x, y) → (y, −x). In 1v1 that puts blue at (0, −160) facing 101° and
  orange at (0, 160) facing 255°: the two cars face each other across the centre line.

| # | What | Game | Implement |
|---|---|---|---|
| CAM-31 | SeasonIntro orbit (tournament/honor-duel wait) | [S TA:18005-18021][A RotateSpeed 20, ZHeightPercent 0.75, XOffsetDistance 1000, DefaultFOV 90]:<br>• Execute while `ShowSeasonIntroScene()`; false inside PreMatchLobby (TA:3751).<br>• Per frame: Yaw += 182.044·20·dt (**20°/s**, an 18 s orbit); Focus = FieldCenter − RotVector(Rotation)·1000, computed before Pitch and Roll are zeroed; Focus.z −= FieldExtent.z·0.75 (755 − 562.5 = **192.5**); Distance 0, so the eye is that point; FOV 90.<br>• The start yaw is whatever the POV held | Skip (no tournaments) |
| CAM-32 | PreMatchLobby overview | [S TA:16885-16921][A Camera_Default.PreMatchLobby]:<br>• Execute in state PreMatchLobby; keep while the car is attached.<br>• POV built once: Focus = Pylon.Location (0, 0, 53); pitch −1600 (−8.79°); yaw 0; Distance from TeamSettings[MaxTeamSize − 1] = 350 (1v1) / 550 (2v2–4v4); FOV = Camera.DefaultFOV 90.<br>• Begin: fade from black 0.25 s.<br>• Blend in/out 1.5 s EaseInOut | Skip |
| CAM-33 | PreMatchLobbyFocus (a player picked in the lobby UI) | [S TA:16922-16968][A]:<br>• Focus = TargetCar.Location; pitch −1600; Yaw = car yaw + 182.044·AngleOffsets[team] (210° blue, 150° orange); Distance 150; FOV 90.<br>• Blend 1.5 s EaseInOut | Skip |
| CAM-34 | KismetOverride | `CameraState_CamActor_X` (PX:4552-4581): runs when the view target is a CameraActor (Kismet/matinee); bCanSwivel false [A]. Never in Stadium play (no camera Kismet) | Skip |

### 1.4 What is on screen before the first kickoff (UI)
Script state → GFx state → HUD (all states, including the end of match):

Bridge [S]:
- `GFxHUD_TA.HandleGameStateChanged` (TA:61386) writes `GameEventData.GameState = G.GetStateName()`, plus `bForfeit`,
  `bNoContest` and `bAntiCheatTerminated`.
- The AS3 side compares upper-case names: WAITINGFORPLAYERS, PREMATCHLOBBY, COUNTDOWN, ACTIVE, POSTGOALSCORED,
  REPLAYPLAYBACK, PREPODIUMSPOTLIGHT, PODIUMSPOTLIGHT, FINISHED [G tagame.constants.GameState]. So the bridge is
  case-insensitive or upper-cases the names [I].
- INTRO, SEASONINTRO, POSTGAME and FTE_INSTRUCTIONS belong to other event types: Season (`GameEvent_Season_TA`), the
  honor-duel post-game lobby (`GameEvent_PostGameLobby_TA`) and the tutorial (`GameEvent_FTE_TA`). Soccar matches
  never enter them [S].

Per-state visibility. "Scoreboard" is HudMatchInfo's MatchInfoView (HUD-2). "Ticker" is the stat feed (HUD-14).
Sources: HudScreen.onGameStateChanged m#10532 and validateShownUIElements m#10537 [G HUD];
HudMatchInfo.onGameStateChanged m#9973 and updateHudElementsVisibility m#9974 [G HudMatchInfo];
MidGameScoreboardViewManager.onGameStateChanged m#263 [G HUD].

| Game state | Scoreboard | Ticker | Boost meter / ball-cam ind. | Tab scoreboard | Esc menu | Other |
|---|---|---|---|---|---|---|
| WaitingForPlayers | hidden | hidden | hidden (explicit WAITING rule) | yes | yes | waiting-for-players list while `!bReadyToStartGame` (MIO-6) |
| PreMatchLobby | shown unless `bShowIntroScene` | yes | only in car cam | no | primary player only | full-screen `PreMatchLobby` screen (MIO-9); input actions off, chat on |
| Countdown | shown (intro animation on becoming visible, HUD-4) | yes | car cam | yes | yes | 3/2/1/GO messages (HUD-8) |
| Active, PostGoalScored | shown | yes | car cam | yes | yes | – |
| ReplayPlayback | shown + replay banner (HUD-11) | yes | hidden (not car cam) | yes | yes | UI sound state "Replay" |
| PrePodiumSpotlight | hidden | yes | hidden (podium camera is not car cam) | **no** | yes | WinnerMenu screen (MIO-18); screen filter (MIO-20); stat popups moved down (MIO-21) |
| PodiumSpotlight | hidden | yes | hidden | **no** | yes | podium panels (MIO-22); vignette |
| Finished | hidden | hidden | hidden (FINISHED rule) | **no** | **no** | EndGameMenu screen (MIO-26); input actions off, chat log always shown |

`bViewingCarCam` comes from the camera: it is true only for the own car or ball cam (HUD-16). So the camera
states decide the boost-meter rule in replay, podium and spectating [I from HUD-16].

| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| MIO-5 | State bridge and per-state HUD | the table above [S][G] | phases countdown / active / postGoal / timeUp / ended / replay (`client/src/net/protocol.ts:16`); no waiting or finished UI | Add client phases waiting, prePodium, podium, finished (server `Phase::Ended` 8.3 s, `server/src/game.rs:57-58`, splits into 3.0 + 5.3, then Finished). Apply the visibility table above |
| MIO-6 | Waiting-for-players list (online only) | [G HUD WaitingForPlayersView m#9521-9534, WaitingForPlayerRenderer m#8328+].<br>• Anchored at (1110 + ΔW, vertical centre), right-aligned. Rows 36 px apart; height n·36, centred, re-centred with a 0.3 s Strong.easeOut tween.<br>• One row per non-bot player. ONLINE/TOURNAMENT pad to MaxPlayers with empty rows (the "finding player" placeholder; a joining player without a name shows the "incoming player" placeholder).<br>• Row: avatar, name, status word with an additive tint: reserved (1, 107, 247), joining (67, 175, 255), ready (63, 255, 0).<br>• Rows fade in/out over 0.2 s.<br>• Header: "waiting for players: M:SS" ($HeaderFont 21 white, glow #43AFFF) while `TimeWaitingForPlayersRemaining` > 0; server-name line ($SmallBoldFont 14) when online.<br>• Visible iff state WAITINGFORPLAYERS && !`bReadyToStartGame` [G][S] | none | Optional (online only): right-edge list of joined players with status, plus the wait timer |
| MIO-7 | First countdown | Nothing beyond HUD-4/HUD-8: the scoreboard plays its intro when it becomes visible on Countdown (1 s delay); 3/2/1/GO. Warm-up (3 s, still WaitingForPlayers) shows no messages: `BroadcastCountdownMessage` runs only in `Countdown.OnGameStateTimeUpdated` (TA:1880) [S][G] | countdown beeps | Hide the scoreboard during warm-up; run its intro on countdown start |
| MIO-8 | Team intro / VS screen | Not used in standard matches (MIO-3, §1.3). For reference, HudMatchInfo `PreGameView` m#8715+ with `bShowIntroScene` [G]:<br>• two team panels ±, the "vs" word, the map name;<br>• panels tween in at frame 75 (2.5 s) for 30 frames (1 s) and out at frame 165 (5.5 s) for 18 frames (0.6 s), Back.easeIn;<br>• labels slide in over frames 75–210;<br>• it captures input until done (about 6.1 s of the 7 s `LobbyIntroTime`).<br>The intro camera is CAM-31 | – | Skip |
| MIO-9 | Pre-match lobby (feature-flagged) | Off in all standard match types (LobbyTime 0). Honor duel only [S][A]. When on [G PreMatchLobby movie: LobbyReadyPrompt m#8050+, LobbyPlayerInfoView m#8039+; S TA:3755-3914]:<br>• full-screen screen;<br>• a banner per car at (car X, Y, GroundZ + `LobbyTagOffsetZ` 100) [A Default__GameEvent_Soccar_TA];<br>• a ready check animates in on ready;<br>• a bottom-centre ready button (its PC and pad labels are separate keys);<br>• the scoreboard clock shows the lobby countdown with the "match starts in" label;<br>• ready → that car gets freestyle (driving, unlimited boost; `EnableFreestyle` TA:3884);<br>• all ready → `PreMatchPlayersReadyStartDelay` 5 s → start | – | Skip |

---------------------------------------------------------------------------------------------------------------------

## 2. End of match

### 2.1 Final whistle (cross-check with notes/match-rules-audit.md MR-1)
The time-up rule is in MR-1 and is confirmed with exact sources [S]:
- `Active.UpdateGameTime` (TA:4199): clock ≤ 0 → `WaitForEndRound` (TA:4216). Time 0, SecondsRemaining 0, attach
  `EndRoundComponent`.
- The component (TA:27096-27139):
  - It listens to each ball's `EventHitGround` (only balls with `bCanEndRoundOnGroundTouch`). The ground test, contact
    normal.z > 0.96 (GroundToleranceZ), is MR-1's.
  - A ball already asleep (and not item-frozen) ends the round at once.
  - On the hit: **the ball's physics is set to None** (it stops where it touched), then `StartNewRound`.
  - Only with a playlist `OvertimeComponent` is there a ball-hit-ground timeout (90 s).
- Goals still count while waiting.
- `StartNewRound` → `HasWinner` (TA:2965): scores differ and (time ≤ 0 or overtime), or MaxScore reached, or forfeit →
  `EndGame`. Otherwise overtime.
- A match-deciding goal (overtime, or at 0:00) runs the normal goal sequence first (PostGoalScored 3 game s, replay if
  wanted); its `StartNewRound` then calls `EndGame`. There is no countdown in between.
  [L] A ranked 2v2 on 2026-10-09: the state went from ReplayPlayback straight to PrePodiumSpotlight at the "Match Ended"
  line.

### 2.2 Timeline (t = `EndGame`, server; 1 game s = 1 s here: PrePodium resets TimeDilation to 1)
| t (s) | Server [S] | Player camera | Screen (§2.4) |
|---|---|---|---|
| 0 | `EndGame` (S1:2974):<br>• time 0; **FreezePawns**: ball and every car `SetFrozen` (TA:3062), so the last frame holds; SetAllDriving(false);<br>• GameWinner, EventGameEnded, bMatchEnded, MatchWinner, **MVP** (STAT-18), GRI.bGameEnded, OnMatchEnded (Win/Loss/MVP stat events, match-end stats), UpdateStats;<br>• `GotoGameState(GetEndMatchState)` (TA:2837): **PrePodiumSpotlight** if there is a winner, else **Finished** (MIO-15).<br>PrePodium.BeginState (TA:4331): TimeDilation reset to the default (1); goal indicators hidden; podium spawn points (explosion variant, or field centre); `UpdateSpotlight` assigns podium titles (STAT-19) | **PrePodiumSpotlight** (CAM-35): holds the last car/ball-cam frame | winner banner 0–0.7 s; screen dims to α 0.8 over 1 s; WIN, then MVP popups |
| 2.5–2.75 | – | fade to black, 0.25 s (FadeOutDelay 2.5, FadeOutDuration 0.25) | UI stays above the black |
| 3.0 | `GotoPodiumSpotlight` (PodiumDelay 3.0). PodiumSpotlight.BeginState (TA:4398):<br>• PodiumStart Kismet (none in Stadium_P);<br>• nameplate hook (cars with a post-match-celebration mesh hide theirs);<br>• winners explosion on: HideBalls (ball `SetEndOfGameHidden` + its end-of-game FX) and a 0.6 s timer; off: DestroyBalls;<br>• **DestroyCars**; **InitPodiumCars** (MIO-11) | **cut** to **PodiumSpotlightExplosion** (CAM-36; BlendTime 0) and fade from black over 0.25 s | banner to the top (1 s); podium panels fade in 0.5–0.8 s; vignette in, dimming out |
| 3.6 | `TriggerWinnersGoalExplosion` (MIO-12) | dolly continues | MVP goal-explosion caption (cosmetic) |
| 8.3 | PodiumTime 5.3 → `FinishEvent` → **Finished** (TA:4466, 1904). Podium.EndState (TA:4414): SetAllDriving(false), FreezePawns, timer 1 s → BeginHighlightsReplay | same podium camera (its ShouldExecute includes Finished); cars frozen | end screen (scoreboard, then buttons after 1 s) |
| 9.3 | `BeginHighlightsReplay` (TA:4502) if the recording has highlights: DestroyBalls, DestroyCars, RestartPlayers, ReplayDirector → PlayingHighlights | **LiveReplay** (above the podium in the list): 0.5 s from black, 7 s clips (CAM-66) | highlights behind the dimmed end screen |
| 8.3 + 60, or all ready | Finished: `SetGameStateTime(FinishTime 60)`; ready-up allowed after 1 s; all ready → `OnFinished` early; rematch vote (MIO-32) | – | next-match countdown |

Timing-critical (server): EndGame freeze, 3.0 s, 5.3 s, 60 s, ready-up after 1 s, rematch 50 s. Everything else is
presentational.

### 2.3 Rows
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| MIO-10 | End-game state machine | EndGame → PrePodiumSpotlight 3.0 s → PodiumSpotlight 5.3 s → Finished 60 s; no winner → Finished.<br>PrePodium, Podium and Finished all extend `FinishedBase` (IsFinished, IsPostMatch, no pausing, no respawns, **no leave penalty** TA:1898) [S][A].<br>Freeze at t = 0 (ball and cars `SetFrozen`); the cars are destroyed at 3.0 s and podium cars spawned | one `Ended` phase of 8.3 s, cars frozen, then a new match (`server/src/game.rs:57-58, 394-400, 626-630`) | Split into prePodium 3.0 / podium 5.3 / finished ≤ 60; podium spawns per MIO-11; leaving free from the whistle |
| MIO-11 | Podium car placement | **InitPodiumCars** (TA:4420):<br>• winning-team members (`DeterminePodiumCars`: Players whose team is MatchWinner) sorted by MVPSort, so index 0 = MVP;<br>• each is restarted at the first free spot of its spawn group (`TryAddToGroup` [S raw]: `SpotPRI.Find(None)`), so member i gets **spot i + 1**;<br>• `EnablePodiumMode`, `SetPodiumSpot(i + 1)`; titles cleared for i > 2 (top 3 keep them);<br>• RestartPlayer → SpawnCar → **MoveToGround**.<br>**Spots** (TA:91147): location = Center + (Offset << Orientation), yaw = Orientation + Facing [A SpawnPointGroup_TA].<br>**Winners-explosion variant (the default):** `bAllowWinnersExplosion` [A Default__GameEvent_Soccar_TA] and Pylon `bWinnersExplosionEnabled` [A Default__Pylon_Soccar_TA] are both True, and Stadium_P overrides neither.<br>• Center = winner's own goal (Goal.TeamNum = defending team) + 3000 (WinnersExplosionGoalDistance) toward the field centre, z = Pylon.SpawnPoints[0].z (83).<br>• Orientation = that direction.<br>• Offsets (−450, −40), (−325, −200), (−300, 150), (−100, −115); facings 6248, 57784, 10548, 13848.<br>• **Blue winners: spots (−40, −1670) yaw 124.3°, (−200, −1795) 47.4°, (150, −1820) 147.9°, (−115, −2020) 166.1°.** Orange: point-mirrored (−x, −y, yaw + 180°).<br>• The MVP is front-centre; spots 2 and 3 flank it, turned in toward the camera; spot 4 sits behind.<br>**Field-centre variant** (explosion off): Center = Pylon.PodiumSpotlightOverride or FieldCenter; Orientation = FieldOrientation (yaw 90°).<br>• Offsets (−40, 450), (−200, 325), (150, 300), (−115, 100); facings 55400, 41400, 59700, 63000 → spots (450, 40) 34.3°, (325, 200) 317.4°, (300, −150) 57.9°, (100, 115) 76.1°.<br>• Bodies with a post-match celebration use SpawnPointsPodiumAnim: same offsets, facings −10100, −14300, −5800, −9100.<br>The `<<` (inverse) rotation is confirmed in the native [N 0x14035b890]. Calculator: work/podium.py | none | Spawn the winners on the ground at these spots (blue table; orange mirrored), MVP first; ignore the celebration-anim variant |
| MIO-12 | Winners' goal explosion | [S TA:106646-106655, 11417-11461][A WinnersExplosionDelaySeconds 0.6]:<br>• **0.6 s** into the podium.<br>• **Featured player** [S raw GetFeaturedPlayer]: the MVP if on the podium, else the first podium car (1v1: the winner).<br>• His goal explosion plays **at the winning team's own goal**: Goal.Location (0, ∓5120, goal mid-height ≈ 312), with the goal's orientation.<br>• Uses the game ball (hidden at podium start) or a newly spawned hidden ball.<br>• `Explode(…, bPodiumExplosion = true)`: the ball's physics and collision are switched off.<br>• Knockback reach is 3000 uu (VT-16); the podium spots are 3100–3450 uu from the goal, outside it.<br>• Camera shake: the podium cars' owners have shake off (MIO-13). Other viewers are about 3.8 k uu away, inside Explosion_Large's 6000 uu, so they likely get a weak shake [I] | none | Play the scorer-style explosion (VT-16) at the winners' goal 0.6 s into the podium, in the winning team's colour; no knockback needed (out of range) |
| MIO-13 | Podium cars: what winners can do | `Car_TA.EnablePodiumMode` (TA:20838; also run on clients by the bPodiumMode repnotify, TA:18363):<br>• **driving on**, with **unlimited boost** (`CarComponent_Boost_TA.OnCreated` TA:22121, unless the body has a celebration mesh);<br>• jumps, dodges and double jumps (`PhysicsConfig.bPodiumDoubleJumpsEnabled` True [A Default__PhysicsConfig_TA]; TA:20464).<br>• **XY-locked on the spot** (PD1, live [N]): the car pre-step `FUN_140f21a90` calls SetConstrained2D(`!bDriving \|\| bPodiumMode`) every physics tick (`and al,0x41; cmp al,1; setne dl` at 0x140f21b7b → `FUN_140f35330`). It creates a stock Bullet 2.82 `btGeneric6DofConstraint` (single body, frameA = identity basis at the body's world origin): **world X/Y of the COM locked, Z and all rotations free**, ERP 0.2 / CFM 0 (velocity-level, e → 0.8·e per tick; no row when the offset is exactly 0, so ≤ ~0.07 uu one-step drift). Anchored at the spot on the car's first tick; released only when the body is destroyed. Boost and dodge impulses lose X/Y (boost nose-up climbs; dodges flip in place). **Podium jumps are short:** the Jump component ends its force at ActivityTime > PodiumJumpForceTime **0.085 s** (vs 0.2; `0x140f20eb0`, the site earlier misread as FX/boost)<br>• Celebration-mesh bodies, or cars with driving off, get zero input (TA:20431). Driving goes off again at Finished (FreezePawns).<br>• The local podium car's owner gets **camera shake off** and **rumble off** (TA:20841-20846; the podium states are IsFinished).<br>• Losers have no car. Both sides: quick chat (post-game group, CHAT-4), Esc menu | – | Winners' cars drivable with unlimited boost for 5.3 s, then frozen; no shake for them |
| MIO-14 | Finished and what players can do | Finished (TA:1904, 2333-2345, 4485; Team/Soccar overrides):<br>• game-state timer 60 s (FinishTime); `AllowReadyUp` after 1 s; all ready → OnFinished early; timer 0 → OnFinished (teardown, next match or menu);<br>• server `EndOnlineGame`;<br>• podium camera still running (frozen podium) until the highlights take over;<br>• **rematch vote** (public match types): VoteActor TimeRemaining 50 s, required yes = ceil(0.51·N) (`bUnanimousVote` False), passes → teams kept, else scrambled (TA:99404-99520).<br>Buttons and countdown UI: MIO-29…32 | `Ended` 8.3 s then auto new match | 60 s finished phase; ready → early start; optional rematch vote |
| MIO-15 | No winner (no contest) | EndGame → Finished directly: no podium, no titles, no MVP. Cars are not destroyed (frozen).<br>Camera: PodiumSpotlight runs anyway (ShouldExecute includes Finished) with no podium cars: focus = FieldCenter xy at PodiumSpotlightZ + 20, base angles, i.e. a view of the empty centre circle [S][I]. A forfeit has a winner, so the podium plays | – | Only if no-contest is added |
| MIO-16 | Client timing | States reach clients as `ReplicatedStateName` (TA:689); camera timers (2.5 s fade, dolly) run on the client from that moment. So the black hold before the podium is 0.25 s ± jitter [S][I] | – | Drive the client podium camera from the replicated phase change |

| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| CAM-35 | **PrePodiumSpotlight camera** | [S TA:17099-17107][A Camera_Default list, archetype CameraState_PrePodiumSpotlight]:<br>• Execute while the game state is PrePodiumSpotlight.<br>• UpdatePOV writes no Focus, Rotation, Distance or FOV, so **the view holds the last car/ball-cam frame** (the world is frozen too).<br>• Entry blend: the car state's end params = PrePodium's start params (0.25 s EaseIn²), overridden by TransitionSpeed to lerp(0.5, 0, TS − 1). It only fades out a one-frame difference: in effect a hold.<br>• ElapsedTime += dt; at **2.5 s**, `SetCameraFade(black, 0.25 s)` (FadeOutDelay 2.5, FadeOutDuration 0.25), so the view is black from 2.75 s.<br>• ElapsedTime is never reset (once per camera).<br>• Swivel and rear-view post-processing still apply (bCanSwivel default True) [I] | camera keeps following the frozen car (`online.ts:279`) | Freeze the view at the whistle; fade to black over 0.25 s starting 2.5 s after the client sees the state |
| CAM-36 | **PodiumSpotlight camera** (and its Explosion variant) | [S TA:16981-17024, 104970-104977, 105747-105764][A]. State order: PodiumSpotlightExplosion first (Execute = Podium's Execute && ShouldPlayWinnersExplosion), then PodiumSpotlight. Execute while the game state is PodiumSpotlight **or Finished**.<br>**Begin:** CameraDistance = 600; fade from black over **0.25 s**; entry is a **cut** (DefaultBlendParams BlendTime 0).<br>**Per frame:**<br>• CachedCars: each car with bPodiumMode, its location latched the first frame it is seen [S raw UpdateCachedCarInfo].<br>• If any cached car has a celebration mesh: +100 distance, +6° pitch, +60 z (AnimDistanceOffset, AnimPitchOffset, AnimZOffset).<br>• `CameraDistance −= (CameraDistance − 400)·dt·1.2`, i.e. **d = 400 + 200·e^(−1.2 t)** (460 at 1 s, 418 at 2 s, 400.3 at 5.3 s).<br>• Rotation = GetRotation(pitchDeg + animPitch, yawDeg), where **GetOffsetRotation = (int(pitchDeg), int(yawDeg))·182.044**, truncated, so −2.5° becomes −2°.<br>• Focus = (mean xy of the cached cars, z = Pylon.PodiumSpotlightZ (0 in Stadium) + CameraZOffset + animZ).<br>• Distance = d + animDistance; **FOV 70**.<br>**Explosion variant (default):** rotation = rotator(Normal2D(winner goal − FieldCenter)) + (−2°, 0); CameraZOffset 60. So for blue winners yaw −90°, pitch −364.<br>• Focus = podium mean at z 60. With 3 cars (−30, −1761.7, 60): camera at (−30, −1162, 80.9) at t = 0, and (−30, −1361.9, 74.0) settled.<br>• 1 car: camera (−40, −1070.4, 80.9) → (−40, −1270.2, 74.0).<br>• The camera looks from the field side toward the winners' goal: the cars face it, the explosion goes off behind them.<br>**Field-centre variant:** yaw 96° + FieldOrientation 90° = 186°, pitch −9° (−1638), CameraZOffset 20; 3 cars → focus (358.3, 30, 20), camera (947.7, 91.9, 113.8) → (751.2, 71.3, 82.6).<br>**Other:**<br>• `ShouldClipCameraToField` is false in Podium and Finished (TA:4396, 4483).<br>• dt is real time (dilation 1).<br>• Swivel post-processing presumably still applies (bCanSwivel default) [I] | none | New podium camera with these constants; the field-centre variant only if the explosion is turned off |

### 2.4 What is on screen at the end (UI)
Coordinates are virtual stage px (W×H content stage, notes/hud-menus.md HUD-1); "rel. centre" = relative to (W/2, H/2). Timings are real time from the client seeing the state change. Local files: UI/ (decrypted GFX_WinnerMenu_SF, GFX_PreMatchLobby_SF; decompiles of WinnerMenu, PreMatchLobby, EndGameMenu; textures).

**No contest** (not enough players, anti-cheat): `GetEndMatchState` returns Finished. HudScreen sees FINISHED with no WinnerMenu open and opens it with the generic "match cancelled" prompt (MIO-25); 3 s later it opens the end screen. No podium, titles or MVP [S][G].

| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| MIO-17 | HUD teardown at the final whistle | At `EndGame` / PrePodiumSpotlight [S][G]:<br>• nameplates hidden (`HideNameplates` TA:61330, via HandleMatchWinnerSet);<br>• scoreboard hidden; boost meter and ball-cam indicator hidden;<br>• Tab scoreboard disabled; open TeamSelect closed;<br>• full-screen UI on; local-name tag hidden.<br>The ticker and chat stay. Quick chat switches to the post-game group (CHAT-4) | centre text "<TEAM> WINS!" (`client/src/game/matchClock.ts:24`) | Same teardown |
| MIO-18 | Winner banner (WinnerMenu screen) | Opened by HudScreen on PREPODIUMSPOTLIGHT or PODIUMSPOTLIGHT [G HudScreen m#10532]. Content `WinnerPrompt` m#8110-8134 at (W/2, H/2). The display is visible only when `WinningTeam` ≥ 0.<br>**Layout rel. centre** (final keyframe of `WinnerAnim_10`, 22 frames = 0.70 s, stops on frame 22; dump/GFX_WinnerMenu.WinnerMenu.anim.txt #25):<br>• Win label: $HeaderFont 40, #707070, black glow 8, centred at y −67.<br>• Team name: $HeaderThinFont 120, #999999, glow #333333 blur 18, at y 0 (text box top −60), width W, shrink-to-fit.<br>• Series record "a-b": $HeaderThinFont 80, #707070, at y 60; empty unless SeriesGames > 1.<br>• **The whole display gets the team's additive colour transform** (+team colour, TeamStyleManager). Blue (+0, 45, 191): text ≈ #709DFF / #99C6FF; orange (+178, 61, 0): ≈ #FFAD70 / #FFD699 [I arithmetic].<br>**Animation:**<br>• 0–0.167 s: white additive flash bar expands (Glow_CenteredFade, scale 1.17×0.31 → 1.56×9.4), then shrinks to 3.9×1.25 grey (+80) at α 0.2 by 0.433 s.<br>• 0–0.433 s: dark band behind (Glow_CenteredFade scale 1.56×7.8) fades to black at α 0.8.<br>• 0.167–0.433 s: radial glow (9.4×6.25) α 0 → 0.8.<br>• Team name: 0.167–0.5 s, scale 2 → 1 with a fade-in from black.<br>• Win label: 0.367–0.7 s, y −95 → −67, scaleY 0.76 → 1, fade-in.<br>• Record: 0.4–0.7 s, y 90 → 60, fade-in.<br>The glow movies are shared components; their native sizes were not traced | text only | Centre banner: team name large, the win word above, team-tinted; 0.7 s slam with flash and dark band |
| MIO-19 | Win label and team-name rules | Win label [G WinnerPrompt.onWinningTeamChanged m#8122]:<br>• forfeit → the "winner by forfeit" key;<br>• tie-break decision > goals (tournaments) → "winner by <method>";<br>• series (SeriesGames > 1): series won → "series winner" (tournament: "<round> winner"), else "game N winner";<br>• otherwise → the "winner" key.<br>Team name [S `TeamNameComponent_TA.GetTeamName` S1:98774 / `GetAnonymizedTeamName` TA:104533], in order: custom/club name; playlist team name; Home/Away when the team has a custom colour; else the `Team_TA` TeamName0/1 keys. All upper-cased. Knockout uses a large single word instead | forfeit text exists | Default names from TeamName0/1; forfeit variant |
| MIO-20 | Screen dimming layers (HudMatchInfo) | [G HudMatchInfo m#9973, m#9975, m#9978; A textures]. Two full-screen layers under the menus:<br>**ScreenFilter.** Multiply blend; a grey radial gradient, centre ≈ 0.39 and edges ≈ 0.18 (img/ScreenFilter.png). In-game multiply at α a: pixel·(1 − a·(1 − f)). At α 0.8 that leaves about 0.51 brightness in the centre and 0.34 at the edges [I].<br>**Podium vignette.** Normal blend; transparent ellipse in the middle, dark grey (≈ #3E3E3E) opaque edges (img/PodiumSpotlightScreenVignette.png), multiplied by the winning team's colour.<br>**Tweens:**<br>• PrePodium: filter → 0.8 over 1 s.<br>• Podium: vignette → 0.75 and filter → 0, over 0.5 s.<br>• Finished: vignette → 0 and filter → 0.8, over 1 s.<br>• Hide scoreboard on the end screen: filter → 0 over 0.3 s (back to 0.8 when shown).<br>Skipped for the Season final; `ShouldShowPodiumUI` is always true (TA:44389) | none | CSS: a darkening radial overlay (multiply) and a team-tinted edge vignette with these alphas and durations |
| MIO-21 | Stat popups at match end | `OnMatchEnded` gives Win (members of the winning team) and MVP; their popups use HUD-9/STAT-20 (own events only). When WinnerMenu opens, StatEventView tweens to y = 250 + (1 − UIScaleModifier)·100 over 1 s (y 250 at Interface Scale 1), so the popups sit under the winner word [G HudScreen m#10532; S match-stats §3.9] | none | Move the popup anchor to y 250 for the podium; queue WIN then MVP |
| MIO-22 | Podium transition and player panels | **On PODIUMSPOTLIGHT** (`WinnerPrompt.showPodiumSpotlight` m#8125):<br>• The banner tweens over 1 s Strong.easeOut to y = −0.35·H rel. centre (0.15·H from the top) at scale 0.8.<br>• The panel container fades in over 0.3 s after 0.5 s.<br>**Panel anchor** [S `GFxHUD_Soccar_TA.UpdateCarData` TA:61975 → `PodiumSpotlight.GetPlayerHUDPosition` TA:4472 → `GFxData_PRI_TA.UpdateScreenPosition` TA:51705; G m#8130-8131]:<br>• Every frame, for each winning-team player with a car: world point (car.X, car.Y, Z = `PodiumTagOffsetZ` −20, absolute, i.e. just under the floor) [A Default__GameEvent_Soccar_TA].<br>• Projected with LocalPlayer.Project; the AS3 multiplies by W and H, so the projection is normalised 0–1 [I].<br>• Excluded: disconnected players, and spot 4 when the winners explosion plays.<br>**Panel contents** (`PodiumPlayerInfoViewMovie`, dump #37; rel. anchor):<br>• player banner (name, XP title, avatar) at (−152, −15), ×0.823;<br>• dark radial backdrop at y 14 (titles) or 0 (none), α 0.9;<br>• primary title: $HeaderFont 18, #BBBBBB + team additive, centred, 400 px box, y 60;<br>• primary stat line "N label": $NormalFont 11, white, y 79;<br>• secondary title: y 97; secondary stat: y 116;<br>• team-tinted radial glow at y 91, α 0.5, only with a title.<br>Title strings: `InitStatTitle` (TA:51666). Text from StatTitles.int [Category] with the stat's Label/PluralLabel (plural when N > 1). Distances in imperial units ×3.28084. Stat = −1 → label only | none | DOM panels projected from (car.x, car.y, −20) each frame; banner name and the two titles. This is where the podium titles show: closes notes/match-stats.md open question 6 |
| MIO-23 | MVP highlight on the podium | No MVP marker on the panels. The MVP is spot 1 (`InitPodiumCars` MVPSort, TA:4420; placement MIO-11).<br>With the winners explosion, `HandleBallExploded` (TA:107866) sets `WinnersExplosionName`. A top-right caption then appears (right edge −15, top +5; $HeaderFont 24 white; MVP icon): "MVP goal explosion:" plus the item name in quotes. Fade-in 0.5 s after a 0.5 s delay [G m#8124].<br>The end-screen scoreboard row MVP icon (1.75 s, slam sound) is in STAT | none | Skip the explosion caption (cosmetic item names); MVP = centre car + end-screen icon |
| MIO-24 | Quick actions on the winner screen | [G WinnerPrompt.configUI m#8112, m#8115-8117; A controlpreset_cdo.txt]. Two `QuickActionButton`s at the left edge (x = 0), scale 0.5.<br>• **Play again:** y = 0.85·H. Ranked + Features.QuickPostMatchRequeue + party leader + active player only. Action `PostMatchRequeue`: KBM Tab, pad Y. Toggles matchmaking.<br>• **Free play:** stacked above, 10 px gap. Features.FastFreeplay, not tutorial/tournament/private/LAN. Action `FastFreeplay`: KBM LeftControl, pad X. Leaves for freeplay (confirmation modal on first use).<br>• Art: an animated chevron strip in blue (0, 146, 255) or orange (255, 127, 0), 60-frame loop (2 s); $HeaderFont 40 label with a key icon | none | Optional: "Free play" quick exit (LeftControl) |
| MIO-25 | No-contest prompt | `GenericPrompt` at the centre:<br>• title: the win-label style (40 px) at y −34;<br>• description: $HeaderFont 28, #999999, glow #333333 10, at y 0.<br>Animation: 17 frames = 0.533 s. Keys "match cancelled" + "not enough players" (or the anti-cheat variant). Closes after 3 s (§2.4 no-contest note) [G m#8077-8081, m#8989-8993] | none | Only if no-contest is implemented (both teams empty) |
| MIO-26 | End-of-match screen: open and sequence | On FINISHED (HudScreen m#10532): close WinnerMenu, open EndGameMenu (Season: SeasonMenu; training: EndGameMenu directly). `EndGameMenuScreen` m#10337-10383:<br>1. XP-progress and unlock screens first if any (online rewards).<br>2. "TeamScoresAndStats": the scoreboard is centred, x = (W − w)/2, y = (H − h)·0.3 (at least 30 below the tabs), and fades in over 0.3 s.<br>3. After 1000 ms, "Menu": the task bar shows; over 0.3 s the scoreboard slides to x = ((350 + W) − w)/2 (400 with visible MMR in ranked; ×1.25 when H/W > 0.5625); the accolades and tabs move to x = ((260 + W) − w)/2; the button menu `EndGameMenuMovie` opens on the left (BranchingMenu, 33 px spacing).<br>Rank, tournament, season reward and challenge tabs: skip | none | Two-step reveal: centred scoreboard 0.3 s fade, then after 1 s it shifts right and the buttons appear |
| MIO-27 | End scoreboard specifics | Same `ScoreboardView` as the Tab scoreboard (STAT §5.2 columns, MVP icon after 1.75 s with a slam sound) [G]. Plus:<br>• On FINISHED, a winner stamp (`mcWinner`, the "winner" key; "series winner" when the series is won) tinted with the winner's additive colour, with the scorecard slam sound. Winner = `WinningTeam`, else the higher score, none on a tie.<br>• A per-row ready check (`setReady`, animate-in) when a player readies up.<br>• Disconnected rows at α 0.4 (0.2 s).<br>• A spectator list line [G m#9456-9484, m#8572] | Tab scoreboard (STAT rows) | Reuse the Tab scoreboard; add the winner stamp and ready checks |
| MIO-28 | "My accolades" (end screen) | `FloatingMatchStatsTitlesView` m#9294-9300: header (the "my accolades" key) with 1–2 tiles. Each tile: title upper-cased, description "N label" or label only. The local player's primary/secondary titles, so **losers see theirs too** (titles go to both teams, §5.4). Hidden when the player has none, and on a no-contest (no PrePodium, so no titles) [G][S] | none | Show the local player's two titles above the scoreboard |
| MIO-29 | End-menu buttons by match type | `EndGameMenu.generateControls` m#10941 [G]:<br>• **Casual online, offline, LAN, private:** Ready (`SetReadyToPlay` → `ServerReadyUp`) and Change playlist (opens matchmaking).<br>• **Ranked:** Play again (re-search the last playlists; disabled while searching or when unable) and Change playlist.<br>• **Training/editor:** Play again, Change mode, Change pack.<br>• **Tournament:** Ready / Continue / Leave tournament.<br>**Then, in order:**<br>• Party up (when `bStayAsPartyButtonVisible`; casual);<br>• Report/Block (online kinds; needs > 1 player record);<br>• Match settings (private/LAN owner, or offline);<br>• Training (no requeue button and has packs);<br>• Options;<br>• Exit to main menu (confirm modal).<br>Each button has a description line. The match-admin flag sits top-right | none | Clone: Ready, Exit to menu, Options (settings). Also Change playlist if a lobby exists |
| MIO-30 | Hide scoreboard / save replay | Button-legend items [G m#10363-10372]:<br>• "Show/Hide scoreboard" (pad R3 or click). Hiding fades the scoreboard, tabs and accolades over 0.3 s and calls `SetIsViewingEndgameReplay(true)`, so the screen filter fades to 0 (MIO-20) and the highlights replay behind is visible.<br>• "Save replay" / "View saved replay" (pad L3; text-input modal for the name, max 35 characters). `AutoSaveReplay` = Backspace / pad Back.<br>• The screen also hides the scoreboard while the play menu is on top | none | Optional: a toggle to view the highlights (CAM-66) undimmed |
| MIO-31 | Next-match countdown and ready-up | **Script** [S `Finished.BeginState` TA:1904, `SetGameStateTimeRemaining` TA:1291, `SetAllowReadyUp` TA:1558, `CheckPlayersReady` TA:1569]:<br>• `GameStateTime` = FinishTime 60, decremented by a 1 s timer; replicated at 0 and multiples of 5, with clients ticking locally.<br>• `bAllowReadyUp` after 1 s; then every 0.01 s, all PRIs ready (bots auto) → `OnFinished`. Timer 0 → `OnFinished`.<br>**Display** [G EndGameMenu m#10970-10971; dump #10]: label + digits above the menu, $HeaderFont 24 and $NumbersWideFont 24, #FFED83 with an orange glow (#FF7F00, 8), on a dark strip. Hidden when ≤ 0. The label key depends on the mode: next match in (casual), leaving in (ranked/honor duel or tournament over), next game in (series continues). A trailing no-break space follows a last digit 1 (font kerning).<br>**What happens next:**<br>• Online: the dedicated server starts the next match with the same players (`HandleMainEventDestroyed` TA:36779); teams are scrambled unless the rematch vote passed (MIO-32).<br>• Offline: `HandleNextGame` (TA:1604) restarts with the same match settings [I] | server: new match 8.3 s after the end (`game.rs:57-58`) | 60 s finished phase with the countdown; ready = all humans ready → next match; offline restart |
| MIO-32 | Rematch vote (casual, MaxPlayers > 2) | **Script** [S `Finished.StartRematchVote` TA:2333, `CheckRematchVote` TA:2342; VoteActor TA:99404-99501; A RematchVoteArchetype TimeRemaining 50]:<br>• Public match types only (`CanRematchVote` TA:67844); voters = primary players.<br>• Required = ceil(0.51·N) (not unanimous); 1 s countdown from 50.<br>• Passed at `OnFinished` → `bScrambleTeams` false.<br>**UI** [G VoteInProgressView m#9335-9346; dump #18-21]:<br>• under the menu; hidden in ranked or with ≤ 2 players;<br>• states: Available (button "vote rematch" with an M:SS timer); InProgress (red progress bar 200×4, "votes n/N", each new vote flashes white over 0.5 s); Success (the "rematch" word pops in at 1.3× → 1 over 0.5 s); Unavailable when time is up;<br>• the button toggles vote/cancel | none | Optional for casual 2v2/3v3: majority keeps teams |

---------------------------------------------------------------------------------------------------------------------

## 3. Spectator cameras (Camera_Replay_TA)

Live spectators and the saved-replay viewer use **the same camera** (Camera_Replay_TA, archetype
`Archetypes.Camera.Camera_Replay`), with the same modes, focus string and spectator HUD logic (§4 adds the viewer's
timeline). Players never use it.

Field frame used by the director [A Stadium_P pylon]: FieldOrientation yaw 16384, FieldCenter (0, 0, 755),
FieldExtent (5936.27, 4036.57, 750), GroundZ 5.

### 3.1 Who spectates
- **A spectator** is a PRI with PawnType 1 and no team [S]:
  - `PRI_TA.Spectate` (TA:80840): ChooseTeam(−1), SetPawnType(1), ConditionalStartSpectatorMatch.
  - Request: the `Spectate` exec or the menu → server `PRI_TA.ServerSpectate` (TA:80830).
  - Refused when the match type auto-selects teams (public and ranked matchmaking; this also reports the player as a
    cheater) or when `GameEvent.CanSpectate()` is false (always true in soccar).
- **Match types** [S][A]:
  - `MatchType_Custom_TA.AllowSpectators` = true: private matches.
  - Tournament and HonorDuel `AutoSpectate`: team-less players join as spectators.
  - Base `MatchType_TA`: false.
  - An all-spectator match with bots starts by itself (`ConditionalStartSpectatorMatch` TA:1730).
- **The rig:** PawnType 1 → `PlayerController_TA.HandlePawnTypeChanged` (TA:76687) → state Spectating_TA.
  `Spectating_TA.BeginState` (TA:77710) swaps in [A Archetypes.Controller.PlayerController]:
  - camera Camera_Replay;
  - HUD GFxHUD_Spectator;
  - input PlayerInput_Spectator_TA;
  - SpectatorCameraSpeed 2000, SpectatorCameraAccel 4000.
  EndState restores Camera_Default.
- **Not spectators:**
  - demolished players: Camera_Default's Demolished / DemoSpawnSelect / Prespawn (CAM-20..29);
  - a player who loses their team in Active: the Waiting view (CAM-30);
  - leavers: back to the menu [I].
- **Shortcut numbers** (`GameEvent_Team_TA.UpdatePlayerShortcuts`, S1:2035): blue 1, 2, 3, … and orange 5, 6, … in
  Team.Members order.

### 3.2 Frame and modes
```
Camera_Replay_TA.UpdateCamera(dt):                                  # TA:15053
  dt /= WorldInfo.TimeDilation * WorldInfo.DemoPlayTimeDilation     # real seconds (players' camera: dilated, GS-13)
  Camera_X.UpdateCamera(dt)                                         # PX:4369; the PC is pinned to the camera:
    PCDeltaRotation / PCDeltaLocation = this frame's look / fly input
    post-process: aspect FOV only if the state's ShouldUpdateAspectRatio (Director, PlayerView: yes; Fly, attach: no;
      FOV' = 2·atan(aspect·0.5625·tan(FOV/2)), PX:4640); swivel only if AllowSwivel (director shots false;
      PlayerView = !LockSpectatorBallCam); ClipToField only if the state's bClipToField (DirectorPlayerView,
      PlayerView yes; other director shots, Fly, attach no)
UpdateCameraState():                                                # TA:15066
  for S in OverrideStates (Kismet, LiveReplay, PodiumSpotlightExplosion, PodiumSpotlight, PrePodiumSpotlight):
     if S.ShouldExecute(): Blender.TransitionToState(S); return     # an override beats every mode
  if CurrentCameraState == None: CurrentCameraState = States[archetype name == CameraMode]
  SetViewTarget(CurrentCameraState.GetFocusActor())
  Blender.TransitionToState(CurrentCameraState.GetProxyCameraState())   # Director, AutoCam, PlayerView hand back a sub-state
```
- **Modes** (`Camera_Replay.States`, in order): Camera_Director, AutoCam, Fly, SoftAttach, HardAttach, PlayerView.
  - CameraTrack exists only in the viewer with `-CameraTrack` (TA:15050).
  - CameraMode = DefaultCameraMode = 'Camera_Director' [A].
- **Blends** [S][A]:
  - TransitionToState(None) ends the old state; from None the new state begins fresh with no blend.
  - Otherwise the blend is the new state's DefaultBlendParams: AutoCam, LiveReplay and Director 0 (cut);
    Fly/SoftAttach/HardAttach/PlayerView inherit 0.25 s EaseIn². Cubic = 3x² − 2x³ with x = remaining/T.
  - A mode change always passes through None (`Camera_Replay_TA.SetCameraMode` TA:15092), so it is a **cut**, and the
    roll is removed from the persistent POV.
- **Focus string** [S TA:15100, 15115]:
  - '' (none), 'AutoCam', 'Ball', or 'Player_' + UniqueId ('Player_Bot_' + name).
  - Resolved every frame to that PRI's car, or GameBalls[0] for 'Ball'.
  - SetFocusActor resets the mode state (a cut) unless the current state is the director.
- **Start:** `GFxHUD_Spectator_TA.InitGFx` (S1:64367) sets focus 'AutoCam'; the mode stays Camera_Director. **A new
  spectator, and the replay viewer, open in the Director.**

**Availability** (`IsDisabled(current mode, focus)`; recomputed after every change; a disabled current mode → Fly;
`GFxData_ReplayViewer_TA.RefreshDisabledModes` TA:53536):

| Mode | Disabled when | Source |
|---|---|---|
| Camera_Director | focus = 'Ball' | TA:16554 |
| AutoCam, Fly | never | TA:15933 |
| SoftAttach | focus '' or 'AutoCam', or the current mode is Director | TA:17942 |
| HardAttach | focus '' or 'AutoCam', or the current mode is Director | TA:17957 |
| PlayerView | focus not a player, or the current mode is Director | TA:17967 |

**Setters** (`GFxData_ReplayViewer_TA`, TA:53504-53682) [S]:
- SetCameraMode('AutoCam') sets focus 'AutoCam'. Fly with focus 'AutoCam' clears the focus.
- SetFocusActorString(''): when not in Fly → Fly. A non-AutoCam focus while in AutoCam → PlayerView.
- In Director mode, every car the director picks is written back as the focus string (HandleCameraTargetChanged
  TA:53668).

**Commands and default bindings** (`GFxHUD_Spectator_TA` S1:64365-64672; snapshot DefaultInput.ini;
`PlayerInput_TA.GetDefaultActions` S1:81401-81476) [S][A]. All view commands are no-ops while
`CanChangeSpectatorView()` is false (PreMatchLobby).

| Command | Key (PC / pad) | Effect |
|---|---|---|
| ViewPlayer t p (live spectators only) | 1–4 blue, 5–8 orange / – | Focus the player whose shortcut = p + 4t + 1 (spectators skipped); mode PlayerView |
| ViewDefault (live only) | 9 (labelled as the ball view) | Mode = DefaultCameraMode = Director |
| ViewAutoCam (live only) | 0 (labelled as "none") | Mode AutoCam. The labels do not match the commands (TA:62287-62296) |
| ViewNext / ViewPrev (live only) | pad D-pad right/left; no PC key | Ring = players by shortcut, then 'Camera_Director', 'AutoCam'; ±1 cyclic; a player → PlayerView. Disabled once bMatchEnded (S1:64632) |
| CycleFocus | LMB tap / X | No-op in AutoCam. Player k → k+1; after the last → 'Ball' (or the first player if the mode disables Ball); 'Ball' → ''; '' → the first player (TA:62183) |
| CycleCamera | RMB tap / Y | If focus is '': restore the last focus if it is Ball or a present player, else CycleFocus. Then the next enabled mode in list order (wraps); Fly → focus ''; AutoCam → 'AutoCam' (S1:64525). Typical loop: Director → AutoCam → Fly → SoftAttach → HardAttach → PlayerView |
| Focus / camera radial menus | LMB / RMB hold (X / Y hold) | Ball, each player, None / every enabled mode [G RH:52252-52292] |
| ZoomIn / ZoomOut | wheel / R3, L3 | CAM-42 |
| CycleHUD | H / B | replay HUD → match info + names → match info only; spectators start with the replay HUD hidden |
| CycleNameplate | J | nameplate shortcut numbers |
| ResetView | R tap / RB tap | Fly: roll ≠ 0 → drop the roll keeping the direction; else pitch 0 (TA:76168) |
| Roll modifier | R hold / RB hold | yaw input becomes roll |
| Move | W/S, A/D, Space/LeftCtrl; left stick, RT/LT | CAM-41 |
| Look, roll | mouse, Q/E; right stick | CAM-41 |

Category split: the saved-replay viewer strips the 'Spectator' keys (PlayerInput_Replay_TA TA:78546); live spectators
lose the 'Replay' keys (roll, reset, scrub, pause, keyframes).

### 3.3 Rows: rig, switching, free cam, attach, player view
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| CAM-37 | Who spectates | Private matches (and tournament/honor-duel auto-spectate). Never in public or ranked; never for demolished players. Spectating_TA swaps in Camera_Replay, the spectator HUD and input, and starts in Director mode (§3.1) [S][A] | none | Private-match spectators only: a spectator rig starting in Director mode |
| CAM-38 | Camera_Replay frame | Overrides first, then the mode's proxy state; real-time dt; aspect, swivel and clip per state; mode change = cut through None (§3.2) [S][A] | `camera/replayCamera.ts` (player goal replay only) | One SpectatorCamera: override list + mode slot, real-time dt |
| CAM-39 | Modes and availability | Director, AutoCam, Fly, SoftAttach, HardAttach, PlayerView; the IsDisabled table; start in Director with focus 'AutoCam' [S][A] | none | Same list and rules |
| CAM-40 | Switching and bindings | Commands table above [S][A][G] | none | Keys 1–9, 0, LMB/RMB tap and hold, wheel, H; pad D-pad cycle |
| CAM-41 | **Free cam (Fly)** | `Spectating_TA.PlayerMove` (TA:76152, 76175) on real dt. Pseudo-code below. Top speed **2000 uu/s**, acceleration **4000 uu/s²**, brake 10/s (exponential), vertical half speed and acceleration, movement in the horizontal plane of the view yaw.<br>**Look** (TA:76008, 76157):<br>• mouse: counts × MouseSensitivity (10) × FOV/90 per frame, i.e. 0.055° per count at FOV 90;<br>• pad: 20000 u/s = 110°/s at full stick (GamepadLookScale 20);<br>• Q/E roll: binding Speed 100, read as 100·dt·100 = 10000 u/s = 54.9°/s at FOV 90 (the K2 rule: a non-zero binding Speed adds a dt factor); one fork read it as 100 u per frame, so medium;<br>• free 6-DOF: no pitch clamp; \|roll\| > 90° flips pitch input, an upside-down view flips yaw input;<br>• invert option "Spectator Invert Pitch" (default off).<br>**View:** camera = PC location and rotation; FOV = Camera.DefaultFOV (90, zoom); no aspect correction; no script position clamp.<br>**Viewer start:** at the level's first CameraActor (GameInfo_Replay_TA.FindPlayerStart TA:37183), i.e. CameraActor_7 (CAM-30) [S][A] | free camera in `debug/arenaViewer.ts` only | Port movement and look exactly (pointer lock; CAM-11 units) |
| CAM-42 | Zoom | ZoomIn/Out (TA:62114-62138; ZoomSpeed 45, ZoomClickTime 0.15) [S][A]:<br>• a press under 0.15 s snaps to the next multiple of 5: int((FOV ∓ 5)/5)·5;<br>• held: ∓45°/s;<br>• FOV clamped 5–120 (SetFOV TA:53619) and written to Camera.DefaultFOV, so it affects Fly and the attach modes | none | Same |
| CAM-43 | Fly with a focus (look-at follow) | Fly with focus Player or Ball (`CameraState_Replay_TA.UpdateFocusActorPOV` TA:15962) [S]:<br>• F = VLerp(F, target, min(5·dt, 1)); F snaps when the target changes;<br>• camera at the PC location, pushed out to ≥ 150 uu;<br>• rotation = rot(F − cam) + look input, pitch ±14000 (±76.9°); look input orbits at constant distance;<br>• `ClampSpectatorLocation` (TA:76102): field-local \|x\|, \|y\| ≤ FieldExtent + 1000 (world \|x\| ≤ 5036.6, \|y\| ≤ 6936.3), z ≥ GroundZ + 10 = 15;<br>• roll = PC roll; FOV = DefaultFOV | none | Optional |
| CAM-44 | SoftAttach | [S TA:17945][A AttachRotation (−3000, 0, 0) = pitch −16.5°, AttachOffset (−300, 0, 75), MaxDistance 1500]:<br>• AttachRotation += PCDeltaRotation; AttachOffset += PCDeltaLocation (world frame);<br>• camera = target + AttachOffset, rotation = AttachRotation (world), \|AttachOffset\| ≤ 1500;<br>• offsets persist for the session (per state instance) | none | Optional |
| CAM-45 | HardAttach | [S TA:17960; same values, bLocalMovement]:<br>• rotation = Quat(target.Rotation)·Quat(AttachRotation);<br>• AttachOffset += PCDeltaLocation >> AttachRotation;<br>• camera = target + (AttachOffset >> target.Rotation), ≤ 1500: a rigid chase cam that rolls with the car | none | Optional |
| CAM-46 | **PlayerView** (watching a player) | Proxy (TA:17981, S1:18494), evaluated with the view target = the focused car:<br>• LookAtBall if it executes (that player in free-look mode with ball cam on); else BallCam if that player's replicated ball cam is on **or** the spectator's "Spectator Ball Cam" (`LockSpectatorBallCam`, default off); else the car cam.<br>• Archetypes CameraState_Car, CameraState_Ballcam, PlayerView.LookAtBallCameraState.<br>• **Settings are the viewed player's** (`Camera_TA.GetCameraSettings` TA:14818 → ViewTarget.PRI.Camera, a replicated and recorded CameraSettingsActor_TA): FOV, height, angle, distance, stiffness, swivel and transition speed, ball cam, rear view, swivel bytes, free-look anchor (CAM-19).<br>• AllowSwivel = !LockSpectatorBallCam; aspect-corrected; ClipToField on.<br>• The spectator's own look input does nothing | none | Needs per-player camera settings in the protocol (and the recording); show that player's own camera |

**CAM-41 movement** (real dt):
```
brake = min(10·dt, 1); A = (aForward, aStrafe, 0)          # keys ±1, stick −1..1
if A != 0:
   dir = N(A); scale = min(max(A.x/dir.x, A.y/dir.y), 1); vmax = 2000·scale
   vXY −= (vXY − dir·(vXY·dir))·brake                       # kill the sideways part
   vXY += A·dt·4000; |vXY| ≤ vmax
else vXY −= vXY·brake
if aUp != 0: vmaxZ = 1000·|aUp|; vZ −= (vZ − sign(aUp)·|vZ|)·brake; vZ += aUp·dt·2000; clamp ±vmaxZ
else vZ −= vZ·brake
v = Normal2D(forward)·vXY.x + Normal2D(right)·vXY.y + (0, 0, vZ)    # HardAttach: raw, in the attach frame
Location += v·dt
```

### 3.4 The director (CameraState_Director_TA, the default spectator mode)
Selectors (`Archetypes.Camera.Director.Camera_Director`; `UpdateSelector` TA:16508) [S][A]:

| Game state | Selector | States |
|---|---|---|
| WaitingForPlayers | Idle | Waiting (the level CameraActor, CAM-30; MinExecutionTime 3, cut) |
| PreMatchLobby | PreMatchLobbySelector | CameraState_PreMatchLobby (CAM-32) |
| Countdown | Countdown if any cars, else Default; sets bSawCountdown | RandomSequence [TailPass, RotateAroundCars] |
| Active, coming from the countdown | Kickoff, for one UpdateSelector call | KickoffState |
| Active first seen without a countdown (mid-match join) | MidMatchJoined until any relevant car moves faster than 50 uu/s (or there are no cars); then Default without the initial shot | RotateAroundCars |
| Active otherwise, PostGoalScored, ReplayPlayback, podium, Finished | Default = Selector_Active | 1 LiveReplay (OverrideAny), 2 DirectorGoalScorer (OverrideLower), 3 DirectorPlayerView (Default), 4 StadiumSide (InitialOnly) |

```
SetSelector(S, skipInitial): if S != Current || skipInitial: Current = S; S.SetActive(skipInitial)
Priority.SetActive(skip): bSelectFirst = true; bSkipInitialState = skip
Priority.SelectState(cur):                                   # S1:18697, checked against the raw bytecode
  if bSelectFirst: bSelectFirst = false
      if !skip: return States[last]                          # the InitialOnly shot (StadiumSide)
      cur = None
  else if Camera.IsTransitioning(): return cur               # never reselect during a blend
  stale = cur == None || !cur.ShouldKeepExecuting()
  sel = cur
  for T in States (list order), T != cur:
      if !stale && P(T) == Default: continue
      if sel != None && P(T) == InitialOnly: continue
      if T.ShouldExecute(): sel = T                          # no break: the LAST passing state wins
  if skip && sel == None: return States[last]
  return sel
RandomSequence: shuffled once at Init; SetActive → StateIdx = (StateIdx + 1) % N; advances only when the current state
  stops ShouldKeepExecuting
DirectorProxy (base of every shot): ShouldKeepExecuting = TimeSeconds − StateStartTime < MinimumStateTime (default 1.0,
  game time); AllowSwivel false; no rear view
```
Consequences:
- A current, non-stale shot is preempted only by LiveReplay or GoalScorer.
- Once in PlayerView, the director stays in PlayerView until an override (the current state is never re-tested in the
  loop).
- After each kickoff the Default selector restarts with StadiumSide.
- The two countdown shots alternate, one per countdown, in a random order per director instance.

| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| CAM-47 | Director selector machine | Table and pseudo-code above [S][A] | none | Port exactly (including "last passing wins" and InitialOnly) |
| CAM-48 | Countdown shot: TailPass | Per shown car: Focus = ball (else the car); FOV 95; Distance = \|car − focus\|₂D + 120; Rotation = rot(focus − car) + (pitch −50, yaw +400) + yaw −160 u/s × active time. A low shot just behind the car looking at the ball, slowly panning. TimePerCar **1.6 s**, MaxCarsShown 2, teams alternate [S][A] | none | Presentational |
| CAM-49 | Countdown / mid-match-join shot: RotateAroundCars | Focus = car; Distance 120; FOV 120; Rotation = rot(−Vector((2000, −3000, 0) rotated by the car rotation)) + yaw 3000 u/s (16.5°/s) × active time. Starts about 113 uu in front, 33 left and 23 up of the car, looking back at it, then orbits. TimePerCar 1.6 s, MaxCarsShown 3, teams alternate [S][A] | none | Presentational |
| CAM-50 | Kickoff shot | Focus = the ball (else the car nearest FieldCenter, else FieldCenter); Rotation = rot(FieldSide) + pitch −12000 (−65.9°), yaw 0; Distance 900; FOV 120. A cut in, one frame, then its end blend **3.0 s Cubic** into StadiumSide: at GO the camera is at about (−367, 0, 915) [S][A] | none | One-frame pose, then a 3 s smoothstep into CAM-51 |
| CAM-51 | StadiumSide (broadcast rail, the initial Active shot) | Rail on the **−X sideline at z 905**; rail y ≈ 0.421·ball.y; moves 0–1000 uu toward the field as the ball goes to the far side, 175 uu back near the near wall; FOV 100 → 50 with the ball's depth across the field; looks at the 0.75 s predicted ball, biased to cars within 1000–4000 uu and the first goal within 2500–5000 uu. Archetype: TrackOffset (0, 0, −600), TrackSize (5000, 1000), MinFOV 50, MaxFOV 100, MinimumStateTime 3.5, cut in. Pseudo-code below (TA:18031, 18044) [S][A] | none | Port with the field frame |
| CAM-52 | Director PlayerView shot | Selection pseudo-code below (TA:16649-16793). Values [A]: MinimumHit 0.65, MinimumHitSeparation 0.3, MinimumTimeToBall 0.5, StaleDistance 4000, MinimumStateTime 5.0, MaintainCurrentDistance 1300, MaintainCurrentHitBias 1.5, MaintainBallScorabilityViewRating 0.5, ContinuityBias (0, 0.6)→(1, 1.5), AttackerBias 1.5, AttackingGoalDistance 3000, BadFocusDistance 7000, BadFocusViewRating 0.01 for 1.0 s, MinimumViewRating 0.6, CarChangeBlendTimeForDistance (0, 0) (1000, 0.75) (2500, 1.25) (2500.01, 0), MaxBlendDistance 1500, MinBlendContinuity 1.25, CarChangeBlendParams Cubic, cut in, bClipToField.<br>**Framing** = CameraState_DirectorBallCam_TA: the normal ball cam with forced settings FOV 100, Height 110, Distance 280, Stiffness 0.8, Pitch −3, Swivel 2.5, Transition 1.0; no free look, no rear view.<br>Profile: DirectorMinSameTeamFocusTime 4.0, DirectorMinChangeTeamFocusTime 5.0, bDirectorAllowCameraBlending True | none | Port the selection; reuse the ball-cam maths with the forced settings |
| CAM-53 | Director ratings (GameObserver_TA) | Natives [N UpdateBallData 0x140e78ae0, UpdateCarsData 0x140e79030 → per car 0x140f5d690, UpdateGoalsData 0x140e78ba0 → per goal 0x140f5f2c0, GetLocationAtTime 0x140ef69e0]; formulas below; archetype `GameObserver_Default` thresholds [A] | none | Port (inputs are replicated car and ball states) |
| CAM-54 | GoalScorer shot | Execute = FocusCar set and state PostGoalScored; FocusCar set on EventPlayerScored unless the view target already is the scorer's car. Focus = scorer car; Distance 300; FOV 100; **rotation held**; blend in **1.5 s EaseIn²**; End clears FocusCar (TA:16581-16613) [S][A] | none | On a goal: 1.5 s ease to a 300 uu look at the scorer from the current direction |
| CAM-55 | Goal replay for spectators | The same CameraState_LiveReplay archetype as players (GS-10), a separate instance: Camera_Replay's override (and redundantly Selector_Active's OverrideAny and AutoCam's proxy). **ShouldExecute is false in PlayerView mode** (TA:15800): a spectator in Player View watches the replay through that player's camera. ScorerLiveReplay (GS-11) is player-only.<br>Quirk [S]: LiveReplay.Tick/UpdatePOV divide dt by TimeDilation again (TA:15838, 15855) after Camera_Replay already did, so a spectator's slow-mo zoom (FOV 75 → 25, distance 1800 → 2800) runs 4× fast (0.25 s instead of 1 s) during the 0.25× replay slow-mo [I: live check] | `replayCamera.ts` | Reuse the GS-10 camera for spectators; skip it in PlayerView; decide on the quirk after a live check |
| CAM-56 | Waiting, lobby, podium for spectators | Idle selector = the Waiting view (CAM-30); PreMatchLobby = CAM-32, view changes blocked (`CanChangeSpectatorView` false, TA:106627); podium states via the override list (CAM-35, CAM-36); Kismet first [S][A] | none | Reuse the player rows |
| CAM-57 | Overhead or goal-line views | None in the soccar spectator (no such states or archetypes). The fixed views are the level CameraActor (Waiting) and the kickoff pose [A][S] | – | – |

**CAM-51 StadiumSide** (`<<` = inverse rotation, [N 0x14035b890]):
```
Init (TA:18031): Orientation = rot(−Vector(FieldOrientation)) = rot(0, −1, 0)
  Side = ((0, FieldExtent.y, FieldExtent.z) + TrackOffset) << Orientation = (−4036.57, 0, 150)
  TrackCenter = FieldCenter + Side = (−4036.57, 0, 905); TrackForward = (0, −1, 0); TrackRight = (1, 0, 0)
  TrackStart = TrackCenter − TrackForward·2500 = (−4036.57, 2500, 905)
UpdatePOV (TA:18044), with a ball:
  F = Ball.PredictPosition(0.75)                                         [N 0x140e7ad00, not decompiled]
  cars: w = CarDistWeight(DistToBall) ((0,1) (1000,1) (4000,0)); F += average over cars with w > 0 of (car − F)·w
  goals: the first goal (RelevantGoals order) with w = GoalDistWeight(DistToBall) ((0,.5) (2500,.5) (5000,0)) > 0:
         F += (GoalFront − F)·w
  frustum at the ball depth: h, v = the ball's offset from POV.Focus in quarter-screen units
  SmoothedFocus = VLerp(SmoothedFocus, F, FocusLerp(max(h, v))·dt)       FocusLerp (0,0) (.3,.3) (.6,1.5) (1,3)
  px = (5936.27 − ball.y)/11872.53; py = (ball.x + 4036.57)/8073.15
 without a ball: F = GetActionFocus(); SmoothedFocus = VLerp(…, F, min(3·dt, 1)); px, py from F
  first frame: snap everything; else
    kY = TrackLerpSide(|Δpy|)·dt ((0,4) (.2,4) (.4,8)); spx += (px − spx)·TrackLerpForward(|Δpx|)·dt ((0,1) (.2,1) (.4,2))
    spy += (py − spy)·kY; prox += (TrackProximityOffsetSide(py) − prox)·kY    ((0.06, −175) (0.08, 0))
  Pos = (−4036.57 + 1000·spy + prox, 2500 − 5000·spx, 905)
  SmoothedFOV += (lerp(100, 50, spy) − SmoothedFOV)·dt
  Rotation = rot(Focus − Pos); Distance = |Focus − Pos| (×0.8 without a ball); FOV = SmoothedFOV (aspect-corrected)
```
Looking +X from the −X rail puts blue (−y) on the screen's left.

**CAM-52 selection** (TA:16649-16793):
```
SetFocusCar(C): if C != Focus:
    blend = Old && bDirectorAllowCameraBlending && same team as Old
            && T = CarChangeBlendTimeForDistance(|C − Old|) > 0 && |C − Old| < 1500
            && Continuity(C) + SimilarCarVelocityContinuity(vC·vOld) > 1.25
    else cut. Ball cam restarted on C; LastCarChangeTime = StateStartTime = now; SetViewTarget(C)
    blend: POV = BlendPOVs(snapshot of the last POV, live ball-cam POV, Cubic(elapsed/T))
FindFocusCar (on every ShouldExecute and UpdatePOV):
  if Focus && the focus-string car != Focus: SetFocusCar(that car); return        # user override
  bad = false
  if Focus:
     r = ViewRating(Focus.loc, rot(ball − Focus), FOV); latch bBad while r < 0.01
     bad = (bBad for > 1.0 s) || Focus.DistToBall > 7000
     if !bad: if Focus.DistToBall < 1300: return;  if HighestScorability > 0.5 && r > 0.5: return
  best = None; minSep = 999
  for each relevant car c with CanConsider(c):
     h = c.BallHitProbability (+ ViewRating(c) if bad); if c == Focus: h *= 1.5
     if Focus && c != Focus: h *= ContinuityBias(Continuity(c))
     if IsAttacking(c): h *= 1.5          # ClosestGoalToBall.DistToBall < 3000 && c.team != goal.TeamNum
     if best == None: if h > 0.65: best = c, bestH = h
     elif h > best.BallHitProbability (raw, sic): minSep = min(minSep, h − bestH); best = c; bestH = h
  if minSep > 0.3 || bad: SetFocusCar(best)
CanConsider(c): c == Focus → !bad
  if Focus && !bad: other team && sinceChange < 5.0 → no; same team && sinceChange < 4.0 → no
  !bad && c.TimeToBall < 0.5 → no;  ViewRating(c) < 0.6 → no;  else yes
ViewRating(P, R, FOV) = max(0, DistToBallWeight(|ball − P|) ((2000,1) (3500,.75) (6000,0))
   + PlayersInViewWeight(#cars in the FOV cone) ((1,−.25) (4,0); 0 cars → −.25)
   + ViewPitchWeight(pitch°) ((−75,−.9) (−20,0) (20,0) (75,−.9)) + 0.5 per goal front in the cone)
Continuity(P, R) = 0.5 if P is inside the current FOV cone + SimilarOrientationContinuity(dir(cam)·dir(R)) ((−1,0) (1,.5))
ShouldExecute = (FindFocusCar(); Focus != None). Keep: Focus None → false; bIsRelevant latches false once
  Focus.DistToBall > 4000; keep = bIsRelevant || now − StateStartTime < 5.0
A demolished focus car → Focus None → the next FindFocusCar picks another car (cut), else the POV freezes
```

**CAM-53 ratings** (constants from the class defaults; ticked while a ball exists):
```
per car: dir = N(b − c); DistToBall = |b − c|; closing = (v_c − v_b)·dir
  TimeToBall = closing == 0 ? 5 : DistToBall/closing; < 0 → 5; ≤ 5
  PredictedDistToBall = |Pos_c(t) − Pos_b(t)|, Pos(t) = p + v·t + ½·a·t²
  timeF = clamp((TimeToBall − 0.5)/1.5); distF = clamp((PredictedDistToBall − 500)/1100)
  BallHitProbability = clamp((1 − distF)·(1 − timeF))
  goal ratings (own goal, other goal): DistToBall ≥ 3000 → 0, else
    clamp(dotBetween)·(1 − clamp((dGoal − gMin)/(gMax − gMin)))·(1 − clamp((DistToBall − 800)/2200)),
    (gMin, gMax) = (1000, 4000) offense / (500, 3000) defense   [which set feeds which term: open]
  aerial (in the air only): clamp(clamp(HitProb/0.7)·((ball.AerialSkill − f)·0.7 + f)),
    f = clamp((predBallZ − GroundZ − 1800)/(1000 − 1800)); ball.AerialSkill = clamp((1800 − (ball.z − GroundZ))/800)
per goal: q = closest point of the goal box to the ball; dot = N(b − q)·GoalForward
  Raw = clamp(min(0.5·(1 − clamp((|b − q| − 500)/2500)), 0.5·clamp((dot − 0.2)/0.8)))
  Scorability = clamp(Raw + 0.5·Σ(attackers' rating A) − 0.5·Σ(defenders' rating B))
  HighestScorability = max over goals; ClosestGoalToBall = smallest DistToBall
```

**Director timeline** (a spectator watching one kickoff and goal):

| t | Shot |
|---|---|
| WaitingForPlayers (incl. the 3 s warm-up) | Waiting: CameraActor_7, fixed, FOV 100 |
| Countdown 0 → 4.0 s | TailPass or RotateAroundCars (alternating per kickoff); a cut to the next car every 1.6 s, alternating teams (cars at 0, 1.6, 3.2 s or at 0, 1.6 s) |
| GO | cut to the kickoff pose for one frame |
| GO → +3.0 s real | smoothstep blend into StadiumSide |
| ≥ GO + 3.5 s game | first possible cut to PlayerView (a car above 0.65) |
| play | PlayerView; car changes blend ≤ 1.25 s (same team) or cut; at least 4 s (same team) / 5 s (other team) between switches |
| goal (PostGoalScored, 3 game s) | GoalScorer: 1.5 s EaseIn² to the scorer, unless already on it |
| replay | LiveReplay override (GS-10), cut in with a 0.5 s fade (not in PlayerView mode) |
| match end | the podium override states (CAM-35, CAM-36); ViewNext/ViewPrev disabled |

### 3.5 AutoCam (CameraState_ReplayAutoCam_TA, TA:17150-17917)
Spectators reach it with key 0, the ring or CycleCamera; it is also the viewer's automatic camera. The camera location
is POV.Focus (Distance 0) [S].

Constants [A]:
- **Class:** FOVInterpSpeed 1.5, FocusYawInterpSpeed 20, FocusPitchInterpSpeed 50, MinMaxPitch 60°,
  MinCameraDistanceToBall 800, LocationAngleInterpSpeed 1.65, AdditionalBackAwayFromBallSpeed 5, FocusPointInterpSpeed
  3, AdditionalFocusZ 200, BallFloorFocusPercent 0.6, FloorTraceDistance 5000, NoCarsNearBallDistance 400, AerialFOV 90,
  MinBallAerialZHeight 415, MinPlayerAerialZHeight 330, Min/MaxStartRadiusForPlayerAerial 500/7000,
  MinFocusActorViewTime 3, FocusActorZViewOffset 100, MinPlayerCameraFloorHeight 50, GoalScorerFocusDistance 150,
  CountDownPanSpeed 4, CountDownRotateSpeed 3000, CountDownPanStartOffset (−120, 30, 5), CountDownRotateOffset (−120,
  0, 5), CameraDistanceLimits.Max 5000, PlayerFocusBlendSpeedLimits.Max 15.
- **Map** (Default__MapInfo_TA; Stadium_P overrides none): MapResetStartHeight 1000, MapResetStartDistance 900,
  MapResetStartRotation 0, MaxWaitTimeTillBallHit 3, GoalScoredDistance 4000, MaxGoalYZoomOutDistance 1200,
  MaxGoalXZoomOutDistance 1000, CountDownFOV 120, BackAwayFromWallDistance 800.
- **Goal zones** (Default__Goal_TA): AutoCamFocusExtent (2250, 4250, 4000) half-extents in the goal frame, centred on
  Goal.Location (0, ∓5120, goal mid-height); MaxGoalScorerAttachRadius 4000, MinAttachGoalToScorerDot 0.05.
- **Viewer settings** (ProfileCameraSave_TA.AutoCam): FOV 90, Height 250, Distance 1200, MoveSpeed 2.0, MoveSpeedZ 0.5,
  RotateSpeed 3.0, AerialDistance 300, FocusBlendSpeed 15, AerialPrediction 0.1, bUseReplayCamera true, bFocusOnGoals
  true.
- M(a, b) = a + (b − a)·(1 − AerialPrediction).

```
UpdatePOV(dt):                                                     # TA:17195
  old = FOV; FOV = BallHasBeenHit() ? Settings.FOV : 120
  G = bFocusOnGoals ? goal whose AutoCamFocusExtent box contains the ball : None
  if G and its box contains the camera and |ball − cam|2D < 800 and fwd(G)·N(ball − cam) ≥ 0.5: IgnoreGoalTime = now
  UpdateDesiredCameraDistance(dt); P = GetBallFloorFocusPoint(dt)
  if not UpdateFocusActor(P, dt):                                  # Countdown / Active (aerials) / PostGoalScored (scorer)
     if bSnapToFocus: UpdateLocation; rot = rotator(P − cam); bSnapToFocus = false
     dy = yaw-plane dot(N(P − cam), fwd); dp = pitch-plane dot
     UpdateRotation(P, R·20·min(0.15, 1 − dy), R·50·(1 − dp), dt)  # R = Settings.RotateSpeed
     UpdateLocation(P, dt)
  if the ball exploded: FOV = 120
  FOV = bSnapFOV ? FOV (once) : FInterpTo(old, FOV, dt, 1.5)
BallHasBeenHit(): first touch, or now − ResetToMapDefaultTime > (RoundNum > 1 ? 3 : 7) s       # TA:17791
UpdateRotation(P, ys, ps): want = rotator(P − cam), pitch ±60°; |P − cam| < 450 → pitch ·= |P − cam|/450
  yaw = RInterpTo(yaw, want.yaw, dt, ys); pitch = RInterpTo(pitch, want.pitch, dt, ps); roll 0
GetBallFloorFocusPoint (TA:17325):
  exploded → the scored goal's location
  B = floor straight below the ball (≤ 5000); Fz = clamp(ball.z − |cam.z − B.z|/2 + 200, B.z + 100,
      min(B.z + 0.6·|ball.z − B.z| + 200, ball.z))
  not hit yet → (ball.x, ball.y, Fz) − dir(MapResetStartRotation)·300
  in a goal zone (not ignored for 3 s) → VInterpTo(last, G + (ball − G)2D·(1 − 0.05·clamp(lateral/4250, 0, 1)), dt, 6)
  else → VInterpTo(ball + lastOffset, (ball.x, ball.y, Fz), dt, 3); z = Fz
UpdateDesiredCameraDistance (TA:17763), D:
  exploded → FInterpTo(D, 4000, dt, 3); not hit → 900 (instant)
  goal zone → FInterpTo(D, Distance + 1200·clamp(lateral/4250, 0, 1) + 1000·clamp(depth/2250, 0, 1), dt, 3)
  no car within 1000 of the ball for > 3 s → Distance + 200 (+ 1200 when looking at a wall)
  else looking at a wall ? (ball > M(0, 415) above its floor ? Distance + 1200 : Distance + 800) : Distance
  (looking at a wall = a trace from the ball 800 uu along the view direction is blocked)
UpdateLocation (TA:17243):
  d0 = |ball − cam|2D; toward = d0 < 800 and N(ball.v)·N(cam − ball) > 0.5
  UpdateLocationAngle()
  LocationAngle = RInterpTo(LocationAngle, DesiredAngle, dt, 1.65·(1 − clamp(d0/5000, 0, 0.9)) + (toward ? 5 : 0))
  anchor = exploded ? goal replay point : ball; want = anchor − dir(LocationAngle)·D
  not exploded: wall avoidance (32 radial traces at 11.25°, the clear spot nearest the camera; side traces ±320)
  bs = ((|lastWant − want|2D > 800 or d0 < 800) ? 2 : 0.5)·MoveSpeed/2; lastBs = FInterpTo(lastBs, bs, dt, 1.5)
  want' = (first frame or exploded) ? want : VInterpTo(lastWant, want, dt, lastBs)
  ls = FInterpTo(ls, MoveSpeed + (toward ? 5 : 0), dt, 2); new = VInterpTo(cam, want', dt, ls)
  z target = floor below want + Height (1000 before the first touch), lowered under a ceiling, raised to the ball's
     height if higher (MoveSpeedZ > 0); minimum floor + 50
  snap → cam = want'; else cam = (new.x, new.y, FInterpTo(cam.z, z, dt, MoveSpeedZ or 0.5)), z ≥ minimum
UpdateLocationAngle (TA:17350): frozen in Countdown, WaitingForPlayers, Finished and after the explosion;
  ball in a goal zone → angle = −goal forward (field side of the ball looking at that goal);
  ball 2D speed < 300 or a wall hit last frame → keep;
  ball within 800 (672 hard, or moving at the camera, dot > 0.25) → side angle ⟂ the ball's velocity on the camera's
     side, if a 0.6·D trace is clear and the camera would not end up ahead of the ball;
  current angle blocked → side angle (trace D), else keep
```

| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| CAM-58 | AutoCam framing | Kickoff overview (map default, snapped): camera at the ball − 900 x̂, z = floor + 1000 → (−900, 0, ≈1000) looking +x and ≈56° down at (−300, 0, 92.75), FOV 120, until the first touch or 3 s (7 s on the first kickoff). Then distance 1200 (+ goal-zone and wall zoom-outs), height 250, behind-the-ball angle with side switching and wall avoidance [S][A] | none | Port (traces against the arena collision mesh) |
| CAM-59 | AutoCam rotation and FOV | Yaw speed 20·R·min(0.15, 1 − dot), pitch 50·R·(1 − dot) at RotateSpeed R = 3; pitch ±60°, flattened inside 450 uu; FOV interp 1.5/s [S][A] | none | Same |
| CAM-60 | AutoCam aerial focus | Off if AerialPrediction = 0 (UpdateFocusActor_Active TA:17504). Once the ball is > M(0, 415) = 373.5 above its floor, after M(0.05, 0.55) = 0.5 s: among **non-bot**, boosting, airborne players within 7000 flying at the ball (velocity·direction > 0.9, ≥ 0.9·330 above their floor, not steeper than \|z\| 0.75, the ball not outrunning them), the smallest time-to-ball in (1.195 s, 7 s) whose velocity points at the ball's predicted position at half that time (dot > 0.95). View (TA:17529): rotation RInterpTo toward ball − (0, 0, 200) at 3; camera = car + (0, 0, 100) − dir·300; a cut at FocusBlendSpeed 15 (the default), else VInterpTo; ≥ 50 above the floor; FOV 90. Held ≥ 3 s, dropped when the player stops flying at the ball [S][A] | none | Same (needs ball prediction) |
| CAM-61 | AutoCam countdown shots | Not on the first kickoff (UpdateFocusActor_CountDown TA:17477). Every **1.36 s** the next player (last scorer first, then the rest in random order). Shot type drawn once per cycle: pan or orbit. Camera 120 uu from the car at pitch −2000 (−11°): orbit 3000 u/s (16.5°/s) from the previous shot's car-relative angle (first: the car's front, −27.5°); pan 60 uu sideways at 0.4 of the path per second, starting 120° round from the previous angle. FOV 120 (orbit) or Settings.FOV (pan), snapped on each pick [S][A] | none | Same |
| CAM-62 | AutoCam goal | Ball exploded: angle = −(scored goal forward) (TA:17855), anchor the goal's replay point, distance → 4000 at 3/s, FOV → 120. Scorer shot (TA:17547): within 0.3 s of the explosion, if the scorer is within 4000 (2D) of the goal, faster than 500 uu/s (2D), rising, moving away from the goal into the field and in front of it (dot > 0.05): follow 150 uu behind at blend speed 4 [S][A] | none | Same |
| CAM-63 | AutoCam settings and game-state hooks | Viewer settings above (settings_table.md "Spectator AutoCam …"). Hooks (TA:17736): Countdown → drop the focus player; Countdown with RoundNum 0 → map default + snap FOV; Active with RoundNum > 1 → map default (snap) at GO; ReplayPlayback → snap. Goal replays proxy to LiveReplay (bUseReplayCamera; redundant with the override list) [S][A] | none | Expose with the spectator settings |
| CAM-64 | Spectator HUD coupling | The boost meter shows for the focused car when the active state has bShowCarHUD (replay modes) and the view target is a car (`GFxData_LocalCar_TA.UpdateViewingCarCam` TA:45533); the focus actor is highlighted in Fly, SoftAttach, HardAttach and PlayerView [S][A] | none | With the spectator HUD |

---------------------------------------------------------------------------------------------------------------------

## 4. Replay viewer cameras

- **Set-up:** the saved-replay viewer is GameInfo_Replay_TA (map URL ?Replay=…?StartTime=…) with
  PlayerController_Replay_TA. Its PlayerWaiting state goes straight to Spectating_TA (TA:78209).
- **Camera and HUD:** the same Camera_Replay and modes as §3; HUD GFxHUD_Replay_TA (extends the spectator HUD).
- **Opens in** the Director; spawns at CameraActor_7.
- **Keys:** the replay key set replaces the live-spectator view keys (§3.2).

### 4.1 Timeline controls (camera side only)
Bindings [snapshot DefaultInput.ini; GetDefaultActions]:
- Left/Right: tap = ScrubTimeline −5/+5 s; hold = previous/next keyframe.
- Up/Down hold: add/remove keyframe.
- LeftShift: tap = pause; hold = speed menu.
- Pad: D-pad and A, same functions.

```
SetSlomo(s) (TA:53596): s = clamp(s, 0, 10); s ≤ 0 → pause; else unpause, DemoPlayTimeDilation = s
   speed menu [G RH:52248]: 1000, 500, 200, 100, 50, 25, 10, 5 %
ScrubTimeline(±5) → AdvanceTime(±5·Slomo) → frame = pending-or-current + Δt·30 (RecordFPS 30)
AdvanceToFrame(f) (TA:53578): clamp; pause; (re)arm a 0.25·DemoPlayTimeDilation timer (0.25 s real) →
   SkipToFrame(f), Tick(0), unpause           # taps within 0.25 s accumulate
```

### 4.2 Rows
| # | What | Game | Ours | Implement |
|---|---|---|---|---|
| CAM-65 | Timeline → camera | **Real-time camera** (§3.2): replay speed and in-replay slow-mo don't change camera smoothing or fly speed. The camera keeps working while paused [I: native paused dt].<br>**A seek does not reset the camera.** After it (EventPostTimeSkip), if the focused PRI no longer resolves, the HUD re-sets the same focus string (KeepFocusOnCurrentPlayer TA:62348) → state → None → the mode restarts fresh (cut; PlayerView starts behind the car).<br>Fly, Soft and Hard re-resolve the focus each frame (a new actor snaps the focus point). AutoCam reacts only to the game-state events the seek replays (CAM-63 hooks).<br>Speeds 5–1000 %; ±5 s × speed per tap; 0.25 s real debounce [S][G] | none | Only if a saved-replay viewer is built |
| CAM-66 | **End-of-match highlights** | `PodiumSpotlight.EndState` (TA:4414): a 1 s timer → `BeginHighlightsReplay` (TA:4502), if the recording has highlights: DestroyBalls, DestroyCars, RestartPlayers, ReplayDirector → PlayingHighlights (TA:85138-85180, authority; clients get the proxies), nameplates shown.<br>**Content:** Replay_Soccar_TA.HighLights = every goal (RecordGoal TA:84691, the scorer) and every save/epic save (RecordSave TA:84702, the saver), in recorded order (despite the name "PlayRandomHighlight").<br>**Clips:** 7 s each (HighlightReplayDuration 7; from TimeBeforeHighlightReplay 4 s before the event to 3 s after), normal speed (no slow-mo), looping until Finished ends.<br>**Camera:** LiveReplay (IsPlayingHighlights, TA:15807) — 0.5 s fade from black at the start; each new clip is a forced cut to the car/ball focus (TA:15887), then the usual LiveReplay framing from that highlight's goal.<br>**No skip input** (it is not the ReplayPlayback game state); it plays behind the dimmed end screen; "hide scoreboard" (MIO-30) shows it undimmed. Spectators see it too. Season mode has none (TA:34242) [S][A] | none (no match end yet) | Keep the match recording; list goals and saves; loop 7 s clips with the GS-10 camera behind the end screen |
| CAM-67 | Goal replay vs the viewer's cameras (cross-reference) | The in-match goal-replay camera is **CameraState_LiveReplay** (GS-10): one archetype, **neither the Director nor AutoCam**. Reached three ways: players through Camera_Default's list; spectators through Camera_Replay's override list (not in PlayerView); the Director's OverrideAny entry and AutoCam's proxy are redundant routes to the same state.<br>**Saved replays never show it:** it needs GameEvent.ReplayDirector, and ReplayDirector_TA is in Replay_TA.IgnoreClasses (not recorded). The goal replays themselves aren't recorded either (ReplayPlayback has no ShouldRecordReplay, TA:84834), nor is the podium (TA:4469). In the viewer a goal shows only as AutoCam's goal behaviour (CAM-62) or the Director's GoalScorer shot (CAM-54) [S][I] | `camera/replayCamera.ts` (players) | Nothing new for the viewer; spectators per CAM-55 |
| CAM-68 | CameraTrack / Kismet | Dev only: CameraTrack with -CameraTrack (keyframes record the POV; native interpolation; flying while paused); Kismet = CamActorCinematic when a level sequence makes a CameraActor the view target [S][A] | – | Skip |

---------------------------------------------------------------------------------------------------------------------

## 5. Text the clone would need (localization key → paraphrase)
Cleared to ship verbatim (notes/quick-chat.md, notes/match-stats.md):
- podium titles (StatTitles.int [Category] <title key> with the stat Label/PluralLabel);
- the Win and MVP stat-popup labels;
- quick chat, including the post-game group.

**Cleared verbatim by the user (2026-10-10)**, except the rows marked "(skip)"; exact strings follow the table:

| Where | Key (file [section] key) | Paraphrase |
|---|---|---|
| Win label | UIText [Global] Winner / WinnerByForfeit | the word "winner"; winner by forfeit |
| Series (skip) | UIText [Global] SeriesWinner | series winner |
| Team names | TAGame [Team_TA] TeamName0 / TeamName1 | the two default team colour names |
| Custom-colour teams (skip) | UIText [Global] Home / Away | home / away |
| No contest | UIText [Global] MatchCancelled, MatchCancelledDesc | match cancelled; not enough players |
| Accolades header | UIText [EndGameMenu] MyAccolades | "my accolades" |
| End-menu buttons | UIText [Global] Ready, ReadyDesc, ExitMainMenu, ExitMainMenuDesc, Options, OptionsDesc, PlayAgain, ChangePlaylistOrTraining, FindNewMatchDesc | ready for the next match; exit to main menu; options; play again; change playlist |
| Exit confirmation | UIText [ModalPopups] ExitMainMenuInquiry; [Global] Yes / No | "are you sure you want to exit?"; yes / no |
| Next-match countdown | UIText [EndGameMenu] NextMatchIn / LeavingIn / NextGameIn | next match in / leaving in / next game in |
| Rematch vote | UIText [EndGameMenu] VoteRematch, CancelVote, Rematch, VoteCount ({0}/{1}) | vote rematch / cancel vote / rematch / votes n of N |
| Scoreboard toggle | UIText [EndGameMenu] ShowScoreboard / HideScoreboard; [Global] Scoreboard | show / hide scoreboard |
| Quick actions | UIText [Global] PlayAgain, FreePlay | play again / free play |
| Waiting list (online) | UIText [Tournaments] WaitingForPlayers; [Global] Reserved, Joining, Ready, Server; [Matchmaking] FindingPlayer, IncomingPlayer | waiting for players; reserved / joining / ready; server; finding / incoming player |
| Spectator modes | TAGame.int [ReplayCameraModes] <Mode>Label / <Mode>Description for Fly, SoftAttach, HardAttach, PlayerView, AutoCam, Camera_Director, CameraTrack | free fly; follow a player's or the ball's position; follow position and rotation; a player's own view; automatic camera; auto-switching director; keyframe camera track |
| Spectator bindings | Controls.int [ReplayCycleFocus], [ReplayFocusMenu], [ReplayCycleCamera], [ReplayCameraMenu], [ReplayCycleHUD], [ReplayCycleNameplate], [ToggleReplayFXMenu], [ReplayMoveForward] … Label rows | the binding names |
| Spectator settings | UserSettings.int [InvertSpectatorPitch], [LockSpectatorBallCam], [DirectorCamAllowBlending], [DirectorMinSameTeamFocus], [DirectorMinChangeTeamFocus], [AutoCamFOV], [AutoCamDistance], [AutoCamHeight], [AutoCamMoveSpeed], [AutoCamMoveSpeedZ], [AutoCamRotateSpeed], [AutoCamPlayerFocusDistance], [AutoCamPlayerFocusBlendSpeed], [AutoCamAerialPrediction], [AutoCamUseReplayCamera], [AutoCamFocusOnGoals] (Label + Description each) | invert spectator pitch; always ball cam when spectating players; smooth director blends; minimum focus times; AutoCam tuning |
| Replay viewer HUD | AS3 replay HUD: the focus menu's Ball / None, the "{N}%" speed format, camera / focus / FOV readouts | – |

**Cleared to ship verbatim (user, 2026-10-10)**: everything in the table above. Exact English strings, from the
decrypted localization (Coalesced_INT) and the HUD's AS3 LOCTEXT defaults:

| File | Section | Key | Verbatim string |
|---|---|---|---|
| UIText.int | `[Global]` | `Winner` | Winner |
| UIText.int | `[Global]` | `WinnerByForfeit` | Winner by forfeit |
| UIText.int | `[Global]` | `MatchCancelled` | Match Cancelled |
| UIText.int | `[Global]` | `MatchCancelledDesc` | Not enough players to begin match. |
| UIText.int | `[Global]` | `Ready` | Ready |
| UIText.int | `[Global]` | `ReadyDesc` | Ready for next match |
| UIText.int | `[Global]` | `ExitMainMenu` | Exit to Main Menu |
| UIText.int | `[Global]` | `ExitMainMenuDesc` | Exit to the Main Menu |
| UIText.int | `[Global]` | `Options` | Options |
| UIText.int | `[Global]` | `OptionsDesc` | Modify your settings |
| UIText.int | `[Global]` | `PlayAgain` | Play Again |
| UIText.int | `[Global]` | `ChangePlaylistOrTraining` | Change Playlist/Training |
| UIText.int | `[Global]` | `FindNewMatchDesc` | Search for a new match |
| UIText.int | `[Global]` | `Yes` | Yes |
| UIText.int | `[Global]` | `No` | No |
| UIText.int | `[Global]` | `Scoreboard` | Scoreboard |
| UIText.int | `[Global]` | `FreePlay` | Free Play |
| UIText.int | `[Global]` | `Reserved` | Reserved |
| UIText.int | `[Global]` | `Joining` | Joining |
| UIText.int | `[Global]` | `Server` | Server |
| UIText.int | `[EndGameMenu]` | `MyAccolades` | My Accolades |
| UIText.int | `[EndGameMenu]` | `NextMatchIn` | Next Match In |
| UIText.int | `[EndGameMenu]` | `LeavingIn` | Leaving In |
| UIText.int | `[EndGameMenu]` | `NextGameIn` | Next Game In |
| UIText.int | `[EndGameMenu]` | `VoteRematch` | Vote Rematch |
| UIText.int | `[EndGameMenu]` | `CancelVote` | Cancel Vote |
| UIText.int | `[EndGameMenu]` | `Rematch` | Rematch |
| UIText.int | `[EndGameMenu]` | `VoteCount` | Votes {0?Number}/{1?Total} |
| UIText.int | `[EndGameMenu]` | `ShowScoreboard` | Show Scoreboard |
| UIText.int | `[EndGameMenu]` | `HideScoreboard` | Hide Scoreboard |
| UIText.int | `[ModalPopups]` | `ExitMainMenuInquiry` | Are you sure you want to exit to the main menu? |
| UIText.int | `[Tournaments]` | `WaitingForPlayers` | Waiting For Players |
| UIText.int | `[Matchmaking]` | `FindingPlayer` | Finding Player |
| UIText.int | `[Matchmaking]` | `IncomingPlayer` | Incoming Player |
| TAGame.int | `[Team_TA]` | `TeamName0` | Blue |
| TAGame.int | `[Team_TA]` | `TeamName1` | Orange |
| TAGame.int | `[ReplayCameraModes]` | `FlyLabel` | Fly |
| TAGame.int | `[ReplayCameraModes]` | `FlyDescription` | Freely move around the map. |
| TAGame.int | `[ReplayCameraModes]` | `SoftAttachLabel` | Soft Attach |
| TAGame.int | `[ReplayCameraModes]` | `SoftAttachDescription` | Follow the position of a player or ball. |
| TAGame.int | `[ReplayCameraModes]` | `HardAttachLabel` | Hard Attach |
| TAGame.int | `[ReplayCameraModes]` | `HardAttachDescription` | Follow the position and rotation of a player. |
| TAGame.int | `[ReplayCameraModes]` | `PlayerViewLabel` | Player View |
| TAGame.int | `[ReplayCameraModes]` | `PlayerViewDescription` | View from a player's perspective. |
| TAGame.int | `[ReplayCameraModes]` | `AutoCamLabel` | Auto Cam |
| TAGame.int | `[ReplayCameraModes]` | `AutoCamDescription` | Automatically Spectates. |
| TAGame.int | `[ReplayCameraModes]` | `Camera_DirectorLabel` | Director |
| TAGame.int | `[ReplayCameraModes]` | `Camera_DirectorDescription` | Automatically switches between player views. |
| TAGame.int | `[ReplayCameraModes]` | `CameraTrackLabel` | Camera Track |
| TAGame.int | `[ReplayCameraModes]` | `CameraTrackDescription` | Blend between keyframes that are added while viewing the replay. |
| Controls.int | `[ReplayCycleFocus]` | `Label` | Switch Focus |
| Controls.int | `[ReplayFocusMenu]` | `Label` | Focus Menu |
| Controls.int | `[ReplayCycleCamera]` | `Label` | Switch Camera |
| Controls.int | `[ReplayCameraMenu]` | `Label` | Camera Menu |
| Controls.int | `[ReplayCycleHUD]` | `Label` | Toggle UI |
| Controls.int | `[ReplayCycleNameplate]` | `Label` | Toggle Player Shortcuts |
| Controls.int | `[ToggleReplayFXMenu]` | `Label` | Replay FX Menu |
| Controls.int | `[ReplayMoveForward]` | `Label` | Move Forward |
| UserSettings.int | `[InvertSpectatorPitch]` | `Label` | Spectator Invert Pitch |
| UserSettings.int | `[InvertSpectatorPitch]` | `Description` | Invert pitch controls when spectating. |
| UserSettings.int | `[LockSpectatorBallCam]` | `Label` | Spectator Ball Cam |
| UserSettings.int | `[LockSpectatorBallCam]` | `Description` | Always use Ball Cam when spectating players. |
| UserSettings.int | `[DirectorCamAllowBlending]` | `Label` | Spectator Director - Allow Blending |
| UserSettings.int | `[DirectorCamAllowBlending]` | `Description` | Enables a smooth camera blend when switching between player views in the Director camera. |
| UserSettings.int | `[DirectorMinSameTeamFocus]` | `Label` | Spectator Director - Same Team Time |
| UserSettings.int | `[DirectorMinSameTeamFocus]` | `Description` | Controls the minimum amount of time to stay focused on a player before switching to another player on the same team. |
| UserSettings.int | `[DirectorMinChangeTeamFocus]` | `Label` | Spectator Director - Change Team Time |
| UserSettings.int | `[DirectorMinChangeTeamFocus]` | `Description` | Controls the minimum amount of time to stay focused on a team before switching the other team. |
| UserSettings.int | `[AutoCamFOV]` | `Label` | Spectator AutoCam - Field of View |
| UserSettings.int | `[AutoCamFOV]` | `Description` | Controls the size of the camera's field of vision. |
| UserSettings.int | `[AutoCamDistance]` | `Label` | Spectator AutoCam - Distance |
| UserSettings.int | `[AutoCamDistance]` | `Description` | Controls the desired distance from the camera to ball. |
| UserSettings.int | `[AutoCamHeight]` | `Label` | Spectator AutoCam - Height |
| UserSettings.int | `[AutoCamHeight]` | `Description` | Controls the minumum height of the camera above the ground. |
| UserSettings.int | `[AutoCamMoveSpeed]` | `Label` | Spectator AutoCam - Horizontal Speed |
| UserSettings.int | `[AutoCamMoveSpeed]` | `Description` | Controls how quickly the camera moves horizontally. |
| UserSettings.int | `[AutoCamMoveSpeedZ]` | `Label` | Spectator AutoCam - Vertical Speed |
| UserSettings.int | `[AutoCamMoveSpeedZ]` | `Description` | Controls how quickly the camera moves vertically. |
| UserSettings.int | `[AutoCamRotateSpeed]` | `Label` | Spectator AutoCam - Rotation Speed |
| UserSettings.int | `[AutoCamRotateSpeed]` | `Description` | Controls how quickly the camera rotates. |
| UserSettings.int | `[AutoCamPlayerFocusDistance]` | `Label` | Spectator AutoCam - Aerial Focus Distance |
| UserSettings.int | `[AutoCamPlayerFocusDistance]` | `Description` | Controls the distance from camera to car when viewing an aerial hit. |
| UserSettings.int | `[AutoCamPlayerFocusBlendSpeed]` | `Label` | Spectator AutoCam - Aerial Focus Speed |
| UserSettings.int | `[AutoCamPlayerFocusBlendSpeed]` | `Description` | Controls how quickly the camera blends to view aerial hits. |
| UserSettings.int | `[AutoCamAerialPrediction]` | `Label` | Spectator AutoCam - Aerial Focus Threshold |
| UserSettings.int | `[AutoCamAerialPrediction]` | `Description` | Controls the threshold for predicting if a player is going to do an aerial hit. |
| UserSettings.int | `[AutoCamUseReplayCamera]` | `Label` | AutoCam - Use Replay Camera |
| UserSettings.int | `[AutoCamUseReplayCamera]` | `Description` | Enables switching to the standard replay camera when a goal is scored. |
| UserSettings.int | `[AutoCamFocusOnGoals]` | `Label` | Spectator AutoCam - Focus on Goal Zones |
| UserSettings.int | `[AutoCamFocusOnGoals]` | `Description` | Enable this to keep the goals in view when the ball is near a goal. |
| Controls.int | `[ReplayAddKeyframe]` | `Label` | Add Keyframe |
| Controls.int | `[ReplayMoveBackward]` | `Label` | Move Backward |
| Controls.int | `[ReplayMoveDown]` | `Label` | Move Down |
| Controls.int | `[ReplayMoveLeft]` | `Label` | Move Left |
| Controls.int | `[ReplayMoveRight]` | `Label` | Move Right |
| Controls.int | `[ReplayMoveUp]` | `Label` | Move Up |
| Controls.int | `[ReplayNextKeyframe]` | `Label` | Next Keyframe |
| Controls.int | `[ReplayPause]` | `Label` | Pause |
| Controls.int | `[ReplayPrevKeyframe]` | `Label` | Previous Keyframe |
| Controls.int | `[ReplayRemoveKeyframe]` | `Label` | Remove Keyframe |
| Controls.int | `[ReplayResetView]` | `Label` | Reset Roll |
| Controls.int | `[ReplayRollLeft]` | `Label` | Roll Left |
| Controls.int | `[ReplayRollRight]` | `Label` | Roll Right |
| Controls.int | `[ReplayScrubBackward]` | `Label` | Rewind |
| Controls.int | `[ReplayScrubForward]` | `Label` | Fast Forward |
| Controls.int | `[ReplaySpeedMenu]` | `Label` | Speed Menu |
| Controls.int | `[ReplayToggleRoll]` | `Label` | Hold To Roll |
| Controls.int | `[ReplayViewBall]` | `Label` | AutoCam |
| Controls.int | `[ReplayViewNext]` | `Label` | View Next Player |
| Controls.int | `[ReplayViewNone]` | `Label` | Free Fly |
| Controls.int | `[ReplayViewPrev]` | `Label` | View Previous Player |
| Controls.int | `[ReplayViewT0P0]` | `Label` | View Player 1 |
| Controls.int | `[ReplayViewT0P1]` | `Label` | View Player 2 |
| Controls.int | `[ReplayViewT0P2]` | `Label` | View Player 3 |
| Controls.int | `[ReplayViewT0P3]` | `Label` | View Player 4 |
| Controls.int | `[ReplayViewT1P0]` | `Label` | View Player 5 |
| Controls.int | `[ReplayViewT1P1]` | `Label` | View Player 6 |
| Controls.int | `[ReplayViewT1P2]` | `Label` | View Player 7 |
| Controls.int | `[ReplayViewT1P3]` | `Label` | View Player 8 |
| Controls.int | `[ReplayViewer]` | `Label` | Replay Viewer |
| Controls.int | `[ReplayZoomIn]` | `Label` | Zoom In |
| Controls.int | `[ReplayZoomOut]` | `Label` | Zoom Out |
| AS3 (shared HUD library) | `[LOCTEXT]` | `Ball` | Ball |
| AS3 (shared HUD library) | `[LOCTEXT]` | `None` | None |
| AS3 (shared HUD library) | `[LOCTEXT]` | `NumberPercentage` | {0?Number}% |
| AS3 (shared HUD library) | `[NSLOCTEXT Replays]` | `Hold` | hold |
| AS3 (shared HUD library) | `[NSLOCTEXT Replays]` | `Tap` | tap |
| AS3 (shared HUD library) | `[NSLOCTEXT Replays]` | `SpecialFX` | Special FX |

Not included (the features are unused, see the table): SeriesWinner, Home / Away, the pre-match lobby strings. Available
on request. The spectator binding labels cover every `Controls.int [Replay*]` section, not only the ones listed above.

Not needed: the pre-match lobby strings (UIText [PreMatchLobby] MatchStartsIn, ClickToReady, PressToReady; [Global]
VersusAbbreviated), since the feature is off. The countdown digits and "go" (TAGame [Messages] CountdownSeconds,
CountdownGo) are already listed under HUD-8.

---------------------------------------------------------------------------------------------------------------------

## 6. Open questions
**Live checks** (offline exhibition or private match; none need online play):
1. Joining a match shows the side view (CAM-30) for at least 3 s before the car.
2. The podium is at the winners' goal (explosion variant), with the camera looking at the goal from the field side.
3. Whether the right stick swivels the PrePodium and podium cameras (bCanSwivel defaults to True).
4. ~~Podium cars can drive off their spots~~ **settled (PD1, 2026-10-14):** XY-locked by a native 6-DOF constraint; see MIO-13.
5. Whether losers' cameras shake from the winners' explosion (about 3.8 k uu away; Explosion_Large reaches 6000 uu).
6. Offline, Ready or the 60 s timeout on the end screen restarts the same match (UI row MIO-31).

**Spectator / director:**
7. Director: the sideline rail has blue on the left; PlayerView comes no earlier than GO + 3.5 s; free cam tops out
   at 2000 uu/s (vertical 1000). Free-cam Q/E roll rate (per second or per frame).
8. The spectator LiveReplay double ÷TimeDilation (slow-mo zoom 4× fast, CAM-55).
9. PlayerView during a live goal replay: whether PRI.Car resolves to the replay proxy car or the view freezes.
10. Order of RoundNum++ vs the 'Active' state event, which decides AutoCam's snap at the second kickoff's GO.

**Not decompiled or not decoded:**
11. `Ball_TA.PredictPosition` [N 0x140e7ad00] (StadiumSide look-ahead).
12. Which GameObserver goal rating feeds which scorability term (the native names look swapped).
13. StadiumSide's FinalRot/FinalDist (member vs local).
14. The camera dt while paused.
15. `GetFocusPlayerNames` (still fails to decode; behaviour from its closures).
16. `WaitingForPlayers.CheckStart` past 0x12f (decode error). Its warm-up branch is taken from notes/match-rules-audit.md.

**Assumptions:**
17. Highlights cover the whole match (recording continues across goal replays).
18. Countdowns are present in saved replays.
19. **UI:** the shared component sizes (glow bands, end scoreboard, player banner), the Project() units (0–1
   inferred), the GFx state-name case mapping, the end-menu column x, and the WinnerMenu load latency.

---------------------------------------------------------------------------------------------------------------------

## 7. Summary (numbered) with confidence
Pre-match:
1. **MIO-1 Pre-match flow** (high): WaitingForPlayers → 3 s silent warm-up → 4 s countdown → Active. Online waits for
   reserved players (30 s public, 90 s tournament) or cancels. Offline starts at once. Freeplay has a 0 s countdown.
2. **MIO-2 Fade-in at load** (high): 1.0 s from black when the loading movie closes.
3. **MIO-3 No intro sequence** (high): no fly-in, matinee, car showcase or banners in standard play. Stadium_P has no
   camera Kismet; the countdown shots are spectator-only.
4. **MIO-4 Online vs offline** (high): same states and cameras; online adds the wait list, bots and state lag; Season
   has no highlights.
5. **MIO-5..9 UI** (high): the per-state HUD table; the online waiting list; the first countdown (scoreboard intro, no
   warm-up messages); the VS screen and pre-match lobby are honor-duel only (LobbyTime 90, LobbyIntroTime 7).
6. **CAM-30 Waiting view** (high): CameraActor_7 at (3974.73, 0, 342.39), +2° pitch, looking −x, FOV 100; at least
   3 s while WaitingForPlayers; then a cut to the car.
7. **CAM-31..34** (high; optional): SeasonIntro orbit (20°/s, 1000 uu, z 192.5, FOV 90); lobby overview (350/550 uu,
   −8.8°); lobby focus (150 uu, ±30° off the rear); KismetOverride (unused in Stadium).

End of match:
8. **MIO-10 End-game machine** (high): EndGame freezes ball and cars → PrePodium 3.0 s → Podium 5.3 s → Finished 60 s;
   no winner → Finished; no leave penalty from the whistle. The time-up rule matches MR-1 (the ball also stops dead
   at the ground touch).
9. **MIO-11 Podium placement** (high; `<<` confirmed natively): the default is the winners-explosion podium 3000 uu in
   front of the winners' own goal. Blue spots (−40, −1670) 124°, (−200, −1795) 47°, (150, −1820) 148°, (−115, −2020)
   166°, MVP first; orange mirrored.
10. **MIO-12 Winners' explosion** (high; the shake on others [I]): 0.6 s into the podium, the MVP's (or first winner's)
    goal explosion at the winners' goal; the cars are outside the 3000 uu knockback.
11. **MIO-13 Podium cars** (high; XY lock [N], PD1): drivable with unlimited boost, dodges and double jumps, but XY-locked on the spot (Z and rotation free; podium jump force 0.085 s);
    the owner's shake and rumble off; frozen at Finished.
12. **MIO-14 Finished** (high): 60 s, ready-up after 1 s (all ready → next match), casual rematch vote 50 s at
    ceil(0.51·N), highlights from +1 s.
13. **MIO-15 No contest** (medium): straight to Finished; the podium camera shows the empty centre; a "match cancelled"
    prompt for 3 s.
14. **MIO-16 Client timing** (medium-high): camera timers are client-local from the replicated state.
15. **CAM-35 PrePodium camera** (high): holds the last frame; fades to black from 2.5 s over 0.25 s.
16. **CAM-36 Podium camera** (high): a cut plus a 0.25 s fade-in; d = 400 + 200·e^(−1.2t); FOV 70.
    - Explosion variant: aimed at the winners' goal; the pitch truncates −2.5° to −2°; focus z 60.
    - Blue, 3 cars: camera (−30, −1162, 81) → (−30, −1362, 74).
    - Persists into Finished.
17. **MIO-17..32 UI** (high, some layout medium):
    - HUD teardown; winner banner (0.7 s slam, team-tinted); dimming and vignette tweens; WIN/MVP popups moved to y 250.
    - Podium panels at the projection of (car x, car y, −20) with the two titles (closes match-stats open question 6).
    - No MVP marker beyond spot 1; quick actions; no-contest prompt.
    - End screen: scoreboard, then buttons after 1 s; winner stamp; accolades for both teams.
    - Buttons by match type; hide scoreboard / save replay; 60 s next-match countdown; rematch vote UI.

Spectator cameras:
18. **CAM-37 Who spectates** (high): private matches (and tournament/honor-duel auto-spectate); never public, ranked
    or demolished players.
19. **CAM-38..40 Rig and switching** (high): Camera_Replay, overrides first, real-time dt, mode changes cut; starts in
    the Director. Keys 1–8 players, 9 Director, 0 AutoCam, LMB focus, RMB mode, wheel zoom.
20. **CAM-41..43 Free cam** (high; mouse units medium):
    - 2000 uu/s, 4000 uu/s², brake 10/s, vertical half; free 6-DOF.
    - Zoom 5–120 (tap 5° steps, hold 45°/s).
    - Look-at follow with a focus.
21. **CAM-44..46 Attach and PlayerView** (high / medium-high): soft and hard attach (−300, 0, 75), −16.5°, ≤ 1500.
    PlayerView replays the watched player's own camera and settings, with a ball-cam lock option.
22. **CAM-47..57 Director** (high; ratings medium):
    - Selectors per state; "last passing wins".
    - Countdown TailPass / RotateAroundCars (1.6 s per car), then a kickoff pose with a 3 s Cubic blend.
    - StadiumSide rail (−X, z 905, FOV 100 → 50).
    - PlayerView ball cam (FOV 100, height 110, distance 280) chosen by hit probability, 4 s / 5 s minimum holds.
    - GoalScorer 1.5 s; the same LiveReplay for replays (not in PlayerView; a possible 4× zoom quirk).
    - No overhead or goal-line views.
23. **CAM-58..64 AutoCam** (medium-high): overview (900 / +1000 / FOV 120) until the first touch or 3 s (7 s first
    kickoff), then 1200 / 250 behind the ball; aerial focus 300 uu; countdown shots 1.36 s; goal 4000 / FOV 120;
    settings; HUD coupling.

Replay viewer:
24. **CAM-65 Timeline** (high; paused dt [I]): a real-time camera, independent of speed and slow-mo; seeks don't
    reset it unless the focus vanishes; 0.25 s seek debounce.
25. **CAM-66 Highlights** (high; coverage [I]):
    - 1 s into Finished, every goal and save in order.
    - 7 s clips (−4 s / +3 s), looping.
    - LiveReplay camera, a cut per clip; not skippable; behind the end screen.
26. **CAM-67 Cross-reference** (high): the goal-replay camera is CameraState_LiveReplay (GS-10), neither the Director
    nor AutoCam. Saved replays contain no goal replays, podium or ReplayDirector.
27. **CAM-68** (high): CameraTrack and Kismet are dev-only.

**Timing-critical (server):**
- EndGame freeze;
- PrePodium 3.0 s, Podium 5.3 s, Finished 60 s;
- ready-up after 1 s; rematch 50 s;
- the warm-up 3 s;
- online wait 30 s.

All camera rows are presentational.

---------------------------------------------------------------------------------------------------------------------

## 8. Actions outside the brief and method notes
None outside the brief. Within it:
- **Ghidra:** on copies only, under systemd scopes of ≤ 3 GB:
  - MIO1's out/bsim/agents/MIO1/rl-live, once: the vector/rotator operators and two podium-bit sites;
  - SPEC's own copy, three times: the GameObserver natives.
- **Decryption:** the UI fork decrypted GFX_WinnerMenu_SF and GFX_PreMatchLobby_SF from the 20261006 snapshot with
  keys.py (baked key).
- **Logs:** copied 5 of the user's RL logs read-only into out/bsim/agents/MIO1/logs/ (git-ignored). Only the state
  sequence fact is used here.
- **Snapshot config:** read TAGame/Config/DefaultInput.ini.
- **Raw byte search:** of the snapshot exe for the bPodiumMode bit test.
- No permission refusals.
