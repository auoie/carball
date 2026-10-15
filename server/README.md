# Game server (`rl-server`)

The authoritative native game server: runs the engine (`engine/`, via its C API `engine/capi/rlengine.h`) at 120 Hz
and talks to browser clients over WebTransport (`wtransport`). Protocol: `protocol/README.md`. The netcode follows
the game's as decoded in `notes/netcode.md`.

## Run
```sh
cd server
cargo run --release                    # WebTransport on :4433, dev info on http://localhost:4434/info
cargo run --release -- --port 4433 --info-port 4434 --meshes ../out/arena/collision_meshes
cargo run --release -- --mode queue    # the queue's 1v1, 2v2 and 3v3 matches (searches and claims only)
```
The server has no web page of its own: the game connects to it over UDP. To play, also run the web client
(`cd client && npm run dev`) and open `http://localhost:5173/?server` (or `?server=host:infoPort` for another
machine or info port): a development server's one open match, which anyone joins. With `--mode queue`, the main
menu's Play → 1v1 / 2v2 / 3v3 → Find Match searches it (`?queue=host:infoPort` names it; default this page's host,
info port 4434). The build compiles the engine with CMake (`build.rs`).

Development identity: a self-signed certificate (valid 14 days, the WebTransport limit for certificate hashes) made at
start-up. The info endpoint (127.0.0.1 unless `--info-bind`, e.g. 0.0.0.0 for another machine) publishes its SHA-256 so
the browser can connect with `serverCertificateHashes`. A public server runs with a real certificate (`CERT_PATH` and
`KEY_PATH`, or `--cert` and `--key`): no info endpoint, reloaded when its files change or on SIGHUP. The deployment's
interface (its environment variables, ports, health check, limits; an empty variable counts as unset) is
`APP-CONTRACT.md`; its images come from `scripts/build_images.sh` (`client/docker/`, `server/docker/`).

What a session may do (the security review's SEC-2/3/5/7/8): 512 sessions at once, 8 at once and 30 new a minute per
address (`--max-sessions`, `--max-per-address`, `--max-per-address-per-minute`: the browser tests raise them), 10 s
from the first packet to the hello, pages only from `ALLOWED_ORIGIN` when it's set (any origin without: development), 240
input packets and 20 control messages a second (excess dropped; a flood closes the session), QUIC's 4 streams each way
and small receive windows; the game thread reads at most 2048 messages between ticks; a panic in a match's tick lets
that match go (the others play on), and the process exits if the game thread ends; join and leave send the other
players the world once a tick at most.

## Checks
```sh
cargo test                              # protocol vectors, input buffer, game logic, a real WebTransport client
cargo clippy --all-targets -- -D warnings
```

## Layout
| Path | |
|---|---|
| `src/engine.rs` | safe wrapper around the engine's C API |
| `src/protocol.rs` | messages; byte vectors shared with the client (`protocol/vectors.json`) |
| `src/input_buffer.rs` | per-player input buffer (`ServerConsume`) and jitter buffer, as the game does them |
| `src/game.rs` | the match: joins and leaves, inputs, the match flow (below), updates (rates, splitting into datagrams) |
| `src/game_loop.rs` | the game thread: the sessions' messages, the queue, every match at 120 Hz on its own clock |
| `src/queue.rs` | who plays together: each playlist's searchers, oldest first, two full teams make a match |
| `src/match_host.rs` | the matches: reserved slots with one-time tokens, full start, cancelled on a no-show, let go when over |
| `src/net.rs` | WebTransport sessions, development identity and info endpoint |
| `tests/end_to_end.rs` | a client connects over WebTransport, drives, and checks acks, ping and the updates; two searches make a match |

When a player leaves, the server logs how many of their input frames it had to repeat (buffer empty) or skip
(catching up). Each such event shifts the server's timeline for that player by a tick, which the client sees as one
misprediction.

## The match
As the game's competitive match (`notes/match-rules-audit.md`, from the live scripts):
- The first player starts a match: scores 0, the clock at 5:00, a new random order of the five kickoff spots (one per
  match, stepped by one each kickoff; uneven teams get the game's adjustment: engine patch 75).
- Kickoff: a 4 s countdown (cars frozen; the match's first kickoff waits 3 s more, `WarmupTime`), then play. A
  player joining in a countdown takes a kickoff spot (the others stay on theirs); later joiners start at a respawn
  spot. The clock runs from the first touch on the ball, or 5 s after
  "go" (`BallHasBeenHitStartDelay`), and stops after a goal.
- A goal (one per round: the ball explodes; demolished cars wait for the kickoff): 360 ticks (`PostGoalTime` 3.0 game
  s) of which the first slow down along the game's `ScoreSlomoCurve`, so they last 3.53 s of real time
  (`Game::next_tick_seconds`; the clients slow down with it, keyed to the goal's tick). Then the goal replay
  (`0x85 Replay`: the window and slow-motion stretches from `GetReplayStartTime`/`ShouldSlomo`, whom the camera
  follows), the cars frozen out of sight, unless every player skips replays (`Hello`'s auto-skip). It ends after its
  real length, or as soon as every player is ready (`0x03 ReadyUp`: Space / pad A); then the next kickoff.
  `notes/camera-respawn-goal.md` §3.
- 0:00: the round ends when the ball touches the ground (a world contact facing up, or the ball asleep); goals
  still count until then. Then a different score ends the match; a tie goes to overtime: a kickoff, the clock counting
  up, the first goal wins.
- The end: the winner shown, the cars frozen for the podium (8.3 s), then a new match. A team left without
  players forfeits: the other team wins at once. When everyone has left, the next player starts a new match.
- The clients get the match state (`0x84 Match`: phase, clock, scores, winner) on each change.
The goal explosion pushes the cars near the goal away (engine patch 77).

**The queue** (`--mode queue`, `notes/matchmaking.md` v1 queue): a search session names a playlist; when two full
teams wait, the match host reserves their slots (teams alternating) and each gets a one-time random token
(`MatchFound`), which their client claims in a new session. The match's warm-up waits for every reserved player (full
start); a player who doesn't claim within 30 s, or leaves before the start, cancels it (the others are told,
`Kicked` reason 1, and search again). No backfill, no bots: a leaver's slot stays empty. A player idle for 30 s of play
is kicked (warned past 25 s: the game's `IdleKick`, MM-32..38). A queue match doesn't rematch: when the end screen's
60 s are up the host lets it go and its sessions end.
`--team-size N` (default 3) is the open match's team size (1 to 8): the uneven-teams kickoff adjustment uses it.
`--test-goal-after SECONDS` (browser tests only): each round, the ball is knocked into a goal that long after "go".

