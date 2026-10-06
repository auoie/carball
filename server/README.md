# Game server (`rl-server`)

The authoritative native game server: runs the engine (`engine/`, via its C API `engine/capi/rlengine.h`) at 120 Hz
and talks to browser clients over WebTransport (`wtransport`). Protocol: `protocol/README.md`. The netcode follows
the game's as decoded in `notes/netcode.md`.

## Run
```sh
cd server
cargo run --release                    # WebTransport on :4433, dev info on http://localhost:4434/info
cargo run --release -- --port 4433 --info-port 4434 --meshes ../out/arena/collision_meshes
```
The server has no web page of its own: the game connects to it over UDP. To play, also run the web client
(`cd client && npm run dev`) and open `http://localhost:5173/?server` (or `?server=host:infoPort` for another
machine or info port). The build compiles the engine with CMake (`build.rs`).

Development identity: a self-signed certificate (valid 14 days, the WebTransport limit for certificate hashes) made at
start-up. The info endpoint publishes its SHA-256 so the browser can connect with `serverCertificateHashes`. A public
server needs a real certificate instead.

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
| `src/game.rs` | the match: joins and leaves, inputs, goals and kickoffs, updates (rates, splitting into datagrams) |
| `src/game_loop.rs` | the 120 Hz game thread |
| `src/net.rs` | WebTransport sessions, development identity and info endpoint |
| `tests/end_to_end.rs` | a client connects over WebTransport, drives, and checks acks, ping and the updates |

When a player leaves, the server logs how many of their input frames it had to repeat (buffer empty) or skip
(catching up). Each such event shifts the server's timeline for that player by a tick, which the client sees as one
misprediction.
