# Game protocol (version 16)

Client ↔ server over **WebTransport** (HTTP/3, QUIC). All integers little-endian. Implemented in
`server/src/protocol.rs` (Rust) and `client/src/net/protocol.ts` (TypeScript); `vectors.json` holds byte-exact
samples both test suites check. Design follows the game's netcode (`notes/netcode.md`).

## Connection
1. The client opens a WebTransport session to `https://HOST:PORT/play`. In development the server uses a
   self-signed certificate (valid 14 days, regenerated at start) and the client passes its SHA-256 hash
   (`serverCertificateHashes`); the dev server publishes it at `http://HOST:INFO_PORT/info`.
2. The client opens one bidirectional stream, the **control stream** (reliable, ordered), and sends `Hello`.
3. The server answers `Welcome`, then sends `Update` datagrams; the client sends `Inputs` datagrams.

## Control stream messages
Framed as `u16 length` + message (`length` counts the message, which starts with its type byte).

| Type | Direction | Fields |
|---|---|---|
| `0x01 Hello` | C→S | `u16 version`, `u8 team` (0 blue, 1 orange, 255 any), `u8 body` (0 Octane … 5 Merc), `f32 dodgeDeadzone`, `f32 steeringSensitivity`, `f32 airControlSensitivity`, `u8 autoSkipReplay` (1: always ready to skip goal replays, `bAutoSkipGoalReplay`), `u32 key` (the key the server gave this client before, in its `Welcome`, kept for reconnects; 0 for none), `u8 n`, `n` bytes the player's name (UTF-8, 32 at most; the server drops control, format and invisible characters and trims it, and names a nameless player, or one asking for another's automatic name, "Player N"), `u8 quickChat`, `u8 blockNonTactical` (the chat filters from the start, as `ChatFilter`) |
| `0x08 Mute` | C→S | `u32 car`, `u8 on`: mute or unmute that player's chat for this player (`ClientMutePlayer`: the server stops relaying their lines here; a block is the client's own) |
| `0x02 ResetInputBuffer` | C→S | nothing: the client had a hitch (over 0.1 s between its frames) 2 s ago; the server resets its jitter buffer to the initial estimate (as the game's `ServerResetInputBuffer`) |
| `0x03 ReadyUp` | C→S | nothing: skip the goal replay (the game's `ReadyUp`, Space / pad A); counts only during one |
| `0x04 AutoSkipReplay` | C→S | `u8 on`: the auto-skip setting changed (turned on during a replay, it readies the player) |
| `0x06 QuickChat` | C→S | `u8 preset` (its index in the 76 `Group1-6MessageN` presets, `notes/quick-chat.md` CHAT-1), `u8 team`: a quick-chat line. The server applies the sender's spam bucket (1.2, ×0.75, 1/s, 4: blocked → `ChatBlocked`), then relays it as `Chat` to the sender and to each player the channel reaches whom neither side's filter keeps it from |
| `0x07 ChatFilter` | C→S | `u8 quickChat` (0 everyone, 1 teammates only, 2 friends only: nobody else here, 3 off), `u8 blockNonTactical` (others' non-tactical presets hidden during the match) |
| `0x05 VoteForfeit` | C→S | nothing: vote to forfeit (`ServerVoteToForfeit`): while votes are allowed, starts the team's vote if none runs (a player who started one can't start another until every teammate has), and counts the player's yes |
| `0x81 Welcome` | S→C | `u16 version`, `u32 carId`, `u8 tickRate` (120), `u32 frame`, `u8 matchType` (0 casual, 1 ranked, 2 private: the forfeit rules and the vote's label), `u8 teamSize` (the playlist's), `u32 key` (the player's: Hello's again if this server gave it and no one here has it, else a new one; who started a forfeit vote), `u32 n`, `n` bytes engine snapshot |
| `0x82 World` | S→C | `u32 frame`, `u32 n`, `n` bytes engine snapshot (the set of cars changed: load it as the state after `frame`) |
| `0x83 Event` | S→C | `u32 serverTick`, `u8 kind` (0 goal, 1 demo, 2 left), then goal: `u8 team` (that scored), `u32 scorer`, `u32 assister` (the cars credited with the goal and the assist, 0: none; no scorer when only defenders touched the ball); demo: `u32 attacker`, `u32 victim`; left: `u32 car`, `u8 flags` (a player left, before the `World` without them: 1 their connection timed out, 2 their car explodes where it is, with no demolition counted: it was live, i.e. not already demolished, not a podium's loser and not in the goal replay, whose start destroys the cars) |
| `0x84 Match` | S→C | `u32 serverTick`, `u8 phase` (0 kickoff countdown, 1 playing, 2 after a goal, 3 time up: the round ends when the ball touches the ground, 4 the match's end (EndGame, 3 s, the world frozen), 5 goal replay, 6 a new match's warm-up (WaitingForPlayers' 3 s), 7 the podium (5.3 s: the winners drivable at its spots, the ball gone), 8 the end screen (Finished: 60 s, frozen; ready-up from 1 s in, every player ready starts the next match)), `u8 flags` (1 overtime, 2 clock running, 4 forfeit: the losing team voted to or left, 8 forfeit votes allowed now, 16 no contest: every team left), `u32 clockTicks` (regulation: ticks left of 36000; overtime: ticks played), `u8 scoreBlue`, `u8 scoreOrange`, `u8 winner` (255 none), `u8 secondsLeft` (the end screen's countdown to the next match, whole seconds rounded up; 0 otherwise). Sent after the welcome, and whenever the phase, the scores, the flags or the clock's shown second change (regulation rounds up, overtime down) |

| `0x85 Replay` | S→C | the goal replay starts (`StartReplay` → `ReplayPlayback`): `u32 startTick`, `u32 goalTick`, `u32 endTick` (server ticks: the window shown), `u8 scoringTeam`, `u8 n`, `n` × (`u32 from`, `u32 to`): stretches played at 0.25 speed (exclusive), `u8 m`, `m` × (`u32 carId`, `u32 tick`): whom the replay camera follows with the ball, until when. The client plays its own recording of those ticks |
| `0x86 ReplayReady` | S→C | `u8 ready`, `u8 total`: players ready to skip the replay (sent when it changes during one) |
| `0x88 Roster` | S→C | `u8 n`, `n` × (`u32 carId`, `u8 team`, `u8 m`, `m` bytes name): the players, sent to everyone when it changes (a client's log says who joined and who left) |
| `0x89 Chat` | S→C | `u32 carId` (the sender's), `u8 preset`, `u8 team`, `u16 seconds` (the clock's shown seconds at relay: `[M:SS]`, `+` in overtime, none once the match has ended) |
| `0x8A ChatBlocked` | S→C | `f32 seconds`: the sender's chat is blocked for this long (the log's "Chat disabled for N second(s).") |
| `0x8B Refused` | S→C | `u8 reason` (0: the match has its most players, 16; 1: the client's `Hello` has another protocol version, read before its fields): instead of a `Welcome`; the session ends |
| `0x8C Scoreboard` | S→C | `u8 n`, `n` × (`u32 car`, `u16 ping` (ms, 999 at most), `u8 flags` (1 the match's MVP, 2 ready for the next match on the end screen), `u8 k`, `k` × `u16` the match counters, 2 × (`u8 title`, `u16 count`) the podium titles, primary then secondary (title 255: none; the ids are `engine/stats/PodiumTitles.cpp` `STAT_TITLES`'s, the count is the stat shown under it: `notes/match-stats.md` §5.4a)): every player's scoreboard line, when one changes and every 2 s (the pings). Counters, in order: MatchScore, Goals, Assists, Saves, Shots, Demolishes, EpicSaves, Centers, Clears, AerialHits, BicycleHits, JuggleHits, FirstTouches, PoolShots, LowFives, HighFives, TimesDemolished, CrossbarHits, OwnGoals, BallTouches (`engine/stats/StatFactory.h`) |
| `0x8D StatEvent` | S→C | `u8 event`, `u16 points`: a stat this player gained (`ClientNotifyGainedStat`: their popup); not BallHit or CrossbarHits (`bSkipReplication`) |
| `0x8E Ticker` | S→C | `u8 event`, `u32 receiver`, `u32 victim` (cars; victim 0: none): a stat someone gained, to every player for their feed (`bNotifyTicker` events) |
| `0x87 ForfeitVote` | S→C | the player's team's forfeit vote, sent to each player when it changes: `u8 state` (0 running, 1 passed, 2 failed: a finished vote stays 5 game s, 3 none), `u8 yes`, `u8 required` (the team's players: unanimous), `u8 secondsLeft` (of its 20 game s), `u8 flags` (1 this player voted, 2 this player may start a vote) |

Phase 5 (version 9) is the goal replay: the cars are frozen out of sight (the client predicts them with no input) until
it ends, after its real length (its length, each slowed stretch four times over), or every player is ready.
**Time after a goal:** the server's ticks keep their count (120 per game second) but the n-th of the 360 after a goal
lasts (1/120) / D((n − 1)/120) real seconds, D the game's `ScoreSlomoCurve` (1 until 0.125 s, 0.1875 at 0.225 s, 1 again
at 0.625 s): 3.53 s in all. Clients slow their own clock the same way from the goal event's `serverTick` (mapped to
their frame by the updates' `serverTick − ackFrame`), so their input frames keep pace.

`frame` is in the **client's** frame numbering: the snapshot is the world after the server applied that client's
input frame `frame` (0 before any). Engine snapshots: `Arena::Serialize` (exact, `engine/README.md`).

## Datagrams
| Type | Direction | Fields |
|---|---|---|
| `0x01 Inputs` | C→S | `u32 timestamp` (client ms), `u32 firstFrame`, `u8 count` (≤ 10), `count` × input frame |
| `0x81 Update` | S→C | `u32 serverTick`, `u32 ackFrame`, `u32 receivedFrame`, `u32 echoTimestamp`, `u16 echoDelay` (ms), `u8 bufferTarget`, `u8 bufferSize`, `u8 part`, `u8 parts`, then network state bytes |

**Input frame** (7 bytes, consecutive frames from `firstFrame`): `i8 throttle, steer, pitch, yaw, roll,
dodgeForward` as the game's input byte (`Vehicle_TA.SetVehicleInput`): q = round(value × 127) for value ≥ 0 and
round(value × 128) below, halves up, −128..127 (dodgeForward: the dodge's forward input, −pitch made a byte on its own
as the game's DodgeForward, so q(−p) and not −q(p); version 6); then `u8` bits: 1 jump, 2 boost, 4 handbrake, 8 air pitch safety. Decoded as `q / 127` or
`q × (1/128)` (32-bit float). The engine quantizes every axis the same way each tick, so decoded values pass through
unchanged and the client predicts with exactly what the server applies.
The client sends its unacknowledged frames (the newest 10) at its input rate (60 Hz).

**Update**: the network state (`engine/net/NetState.h`, its compact form since version 15) is the server's world after
`serverTick` for the bodies it holds; for this client that is the state after its input frame `ackFrame` (the last
frame the server consumed for it; 0 = none yet). Updates go out every other tick (60 a second) with the actors due, at
the game's rates (`server/src/replication.rs`): the ball about 35 times a second, each car about 12, and forced into
the next update as the game forces them (the ball after a car hits it; a car on a placement, a flip reset, a
demolition, the countdown's end, and its jump, double jump or dodge within 1000 uu of the ball); the pads when one
changes and once a second. The compact form carries each body as the game's `ReplicatedRBState` (the location ×100
and the velocities ×100 and ×10000 as packed int vectors, the rotation's 2 + 3 × 18 bits; exact, since the bodies were
rounded to it at their last tick; raw floats for a body placed since its tick), each car's flags, boost (a byte),
controls (bytes), the dodge's torque (bytes, while dodging), spawn and flip-reset counters (low bytes), the timers the
physics reads (only while active) and its XY lock (held, and its pin); the client lays it over its own state at that
frame (a lossy value it holds that sends the same is kept), so a right prediction is left exactly as it was.
`receivedFrame` is the highest input frame received (informational: the client resends its frames after `ackFrame`, the
newest 10, until the server consumes them; after a stall the server's `ackFrame` can run past the client's frames,
then come back to them as it consumes them: notes/netcode-live.md §6, §7).
`echoTimestamp` is the newest `Inputs.timestamp` received and `echoDelay` how long the server held it, so
ping = now − echoTimestamp − echoDelay. A large update is split into `parts`, each a complete network state for
some of the bodies; parts apply independently. Every network state also carries the kickoff countdown (ticks left;
cars get no input while it runs; version 2), and each car's wheel contacts from its previous tick with their normals
(the car's next tick uses them; version 3), and whether the jump button was released during the car's current jump
(the jump then ends at its minimum time; version 4), and a demolished car's respawn spot selection (the steer input
past ±0.3 picks the next spot on that side for the first 2.5 s of the 3 s, then the spot locks) and its flip reset
count (version 5), and each car's and the ball's spawn counter (placements by a kickoff reset, a respawn or a ball
reset: a client draws a correction that changes it at once and smooths every other), and whether demolished cars'
respawns are held (after a goal, until the kickoff), with the match message (version 6). Version 7: the engine turns
the ball (its orientation, already in every network state and snapshot, is now simulated), so the client draws it.
Version 8: each body's world inverse inertia tensor (9 floats), which the game doesn't recompute after the tick's
rounding or a placement, so it isn't a function of the state's rotation. Version 9: the goal replay (phase 5, `0x85 Replay`,
`0x86 ReplayReady`, `0x03 ReadyUp`, `0x04 AutoSkipReplay`, Hello's auto-skip) and the slowed ticks after a goal.
Version 10: forfeit votes (`0x05 VoteForfeit`, `0x87 ForfeitVote`, the match flags 8 and 16, Hello's key, Welcome's
match type and team size) and the leaver's car (event kind 2). Forfeit rules (`notes/match-rules-audit.md` MR-7): votes
are allowed after 60 s (casual) or 90 s (ranked, private) of the clock, or in overtime, until a team has won; private
matches allow them in 1v1s only. In casual and ranked a team left without players forfeits 2 ticks (0.01 game s) after
the leave; a forfeit after a goal ends the match at the next round, after the replay.
Version 11: quick chat (`0x06 QuickChat`, `0x07 ChatFilter`, `0x89 Chat`, `0x8A ChatBlocked`), the players' names
(Hello's name, `0x88 Roster`) and a leave's reason (event kind 2's `lost`). Version 12: the server's keys (Welcome's
`key`), whether a leaver's car explodes (event kind 2's flags), `0x8B Refused`. Version 13: match stats (`0x8C
Scoreboard`, `0x8D StatEvent`, `0x8E Ticker`, the goal event's scorer and assister), `0x08 Mute`, the chat filters in
`Hello`. Version 14: the match's intro and end (phases 6 to 8, phase 4 now only the 3 s before the podium; `Match`'s
`secondsLeft`), the scoreboard's ready flag and podium titles, `Refused` reason 1. Version 15: the compact network
state and the game's replication rates (above): ≈ 3.3 / 4.4 / 5.5 KB/s per client in a 1v1 / 2v2 / 3v3, from 22–100.
Version 16: the vehicles' order in the physics step (the game's action array: notes/physics-values.md FP1 G2) in the
engine snapshot (Welcome, World) and, when it isn't the cars' ID order, in the network state.

Podium title ids (`notes/match-stats.md` §5.4a; the client's `game/podiumTitles.ts`): 0 OvertimeGoal, 1 Goals_10,
2 Goals_6_9, 3 Goals_3_5, 4 Saves_10, 5 Saves_6_9, 6 Saves_3_5, 7 EpicSaves, 8 PoolShots, 9 BackwardsGoal, 10 BicycleGoal,
11 AerialGoal, 12 TurtleGoal, 13 OwnGoal, 14 Juggles, 15 Goals, 16 Saves, 17 Assists, 18 Centers, 19 Shots,
20 FirstTouches, 21 Demolitions, 22 MostBoostPickups, 23 FewestBoostPickups, 24 MostBallTouches, 25 FewestBallTouches,
26 CarTouches, 27 FurthestGoal, 28 FastestGoal, 29 SlowestGoal.

Stat event ids (`StatEvent_TA`, `notes/match-stats.md` §2; the server's `protocol::stat`, the client's `STAT_EVENTS`):
0 Goal, 1 AerialGoal, 2 BackwardsGoal, 3 BicycleGoal, 4 TurtleGoal, 5 LongGoal, 6 OvertimeGoal, 7 HatTrick, 8 Assist,
9 Playmaker, 10 PoolShot, 11 Shot, 12 Save, 13 EpicSave, 14 Savior, 15 Clear, 16 Center, 17 FirstTouch, 18 BallHit,
19 CrossbarHits, 20 AerialHit, 21 BicycleHit, 22 JuggleHit, 23 Demolish, 24 Demolished, 25 Extermination (the game's
"Demolition" object), 26 LowFive, 27 HighFive, 28 OwnGoal, 29 MVP, 30 Win, 31 Loss, 32 DemolitionRespawn.

What an update carries (the game's rates, `notes/netcode.md`): the ball every update (60 Hz); cars within 1000 uu of
the ball every update, other cars and the boost pads every 8 ticks (15 Hz).
