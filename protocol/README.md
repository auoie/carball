# Game protocol (version 11)

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
| `0x01 Hello` | C→S | `u16 version`, `u8 team` (0 blue, 1 orange, 255 any), `u8 body` (0 Octane … 5 Merc), `f32 dodgeDeadzone`, `f32 steeringSensitivity`, `f32 airControlSensitivity`, `u8 autoSkipReplay` (1: always ready to skip goal replays, `bAutoSkipGoalReplay`), `u32 key` (the client's own random key, the same when it reconnects: who started a forfeit vote), `u8 n`, `n` bytes the player's name (UTF-8, 32 at most; the server drops control characters and trims it, and names a nameless player "Player N") |
| `0x02 ResetInputBuffer` | C→S | nothing: the client had a hitch (over 0.1 s between its frames) 2 s ago; the server resets its jitter buffer to the initial estimate (as the game's `ServerResetInputBuffer`) |
| `0x03 ReadyUp` | C→S | nothing: skip the goal replay (the game's `ReadyUp`, Space / pad A); counts only during one |
| `0x04 AutoSkipReplay` | C→S | `u8 on`: the auto-skip setting changed (turned on during a replay, it readies the player) |
| `0x06 QuickChat` | C→S | `u8 preset` (its index in the 76 `Group1-6MessageN` presets, `notes/quick-chat.md` CHAT-1), `u8 team`: a quick-chat line. The server applies the sender's spam bucket (1.2, ×0.75, 1/s, 4: blocked → `ChatBlocked`), then relays it as `Chat` to the sender and to each player the channel reaches whom neither side's filter keeps it from |
| `0x07 ChatFilter` | C→S | `u8 quickChat` (0 everyone, 1 teammates only, 2 friends only: nobody else here, 3 off), `u8 blockNonTactical` (others' non-tactical presets hidden during the match) |
| `0x05 VoteForfeit` | C→S | nothing: vote to forfeit (`ServerVoteToForfeit`): while votes are allowed, starts the team's vote if none runs (a player who started one can't start another until every teammate has), and counts the player's yes |
| `0x81 Welcome` | S→C | `u16 version`, `u32 carId`, `u8 tickRate` (120), `u32 frame`, `u8 matchType` (0 casual, 1 ranked, 2 private: the forfeit rules and the vote's label), `u8 teamSize` (the playlist's), `u32 n`, `n` bytes engine snapshot |
| `0x82 World` | S→C | `u32 frame`, `u32 n`, `n` bytes engine snapshot (the set of cars changed: load it as the state after `frame`) |
| `0x83 Event` | S→C | `u32 serverTick`, `u8 kind` (0 goal, 1 demo, 2 left), then goal: `u8 team`; demo: `u32 attacker`, `u32 victim`; left: `u32 car`, `u8 lost` (a player left: their car explodes where it is, with no demolition counted, before the `World` without it; `lost`: their connection timed out) |
| `0x84 Match` | S→C | `u32 serverTick`, `u8 phase` (0 kickoff countdown, 1 playing, 2 after a goal, 3 time up: the round ends when the ball touches the ground, 4 ended, 5 goal replay), `u8 flags` (1 overtime, 2 clock running, 4 forfeit: the losing team voted to or left, 8 forfeit votes allowed now, 16 no contest: every team left), `u32 clockTicks` (regulation: ticks left of 36000; overtime: ticks played), `u8 scoreBlue`, `u8 scoreOrange`, `u8 winner` (255 none). Sent after the welcome, and whenever the phase, the scores, the flags or the clock's shown second change (regulation rounds up, overtime down) |

| `0x85 Replay` | S→C | the goal replay starts (`StartReplay` → `ReplayPlayback`): `u32 startTick`, `u32 goalTick`, `u32 endTick` (server ticks: the window shown), `u8 scoringTeam`, `u8 n`, `n` × (`u32 from`, `u32 to`): stretches played at 0.25 speed (exclusive), `u8 m`, `m` × (`u32 carId`, `u32 tick`): whom the replay camera follows with the ball, until when. The client plays its own recording of those ticks |
| `0x86 ReplayReady` | S→C | `u8 ready`, `u8 total`: players ready to skip the replay (sent when it changes during one) |
| `0x88 Roster` | S→C | `u8 n`, `n` × (`u32 carId`, `u8 team`, `u8 m`, `m` bytes name): the players, sent to everyone when it changes (a client's log says who joined and who left) |
| `0x89 Chat` | S→C | `u32 carId` (the sender's), `u8 preset`, `u8 team`, `u16 seconds` (the clock's shown seconds at relay: `[M:SS]`, `+` in overtime, none once the match has ended) |
| `0x8A ChatBlocked` | S→C | `f32 seconds`: the sender's chat is blocked for this long (the log's "Chat disabled for N second(s).") |
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

**Update**: the network state (`engine/net/NetState.h`) is the server's world after `serverTick`; for this client
that is the state after its input frame `ackFrame` (the last frame the server consumed for it; 0 = none yet).
`receivedFrame` is the highest input frame received, so the client stops resending frames up to it.
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
(Hello's name, `0x88 Roster`) and a leave's reason (event kind 2's `lost`).

What an update carries (the game's rates, `notes/netcode.md`): the ball every update (60 Hz); cars within 1000 uu of
the ball every update, other cars and the boost pads every 8 ticks (15 Hz).
