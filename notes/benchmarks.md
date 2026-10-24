# The game server's counters (`/metrics`)

The game server counts what it spends on its matches and serves the counts at `GET /metrics` on its development info
server, as Prometheus text (OpenMetrics, from the `prometheus-client` crate; `server/src/metrics.rs`). They are for
measuring the server while it plays: before and after an optimization, a Docker bridge against host networking, one
machine against another.

## Turning them on
- **A development server** (`--dev`, or no certificate) serves them by default beside `/info`:
  `curl -s http://127.0.0.1:4434/metrics`.
- **A server with a real certificate** serves them only when asked, `--dev-info on`, and then `/metrics` alone (no
  `/info`). The info server listens on `--info-bind` (127.0.0.1 unless given) and `--info-port` (4434). With host
  networking (the deployment's), keep it on 127.0.0.1 and read it on the machine itself; never bind it to a public
  address. In a bridged container, `--info-bind 0.0.0.0` with the port published on the host's 127.0.0.1 alone
  (`-p 127.0.0.1:4434:4434`). A server with a certificate whose info server isn't on loopback says so in a warning at
  its start (RV-1085).
- **Off** (the default with a certificate): nothing is counted, and every counting site is a check of an empty cell.

## What they report
| Series | Kind | Meaning |
|---|---|---|
| `carball_game_pass_seconds` | histogram | The game loop's passes that ran at least one match tick: each pass's busy time (the sessions' messages read, every match's due ticks, the ranked reports). Buckets from 0.05 ms to 50 ms, finest around the tick's 8.33 ms |
| `carball_game_pass_max_seconds` | gauge | The longest such pass since the last scrape (each scrape takes it, so one reader at a time) |
| `carball_ticks_total` | counter | Match ticks run (120 a second per match, slower in a goal's slow motion) |
| `carball_ticks_slipped_total` | counter | Match ticks run a period or more late (a match caught up in a pass: it fell a whole tick behind) or skipped (more than five behind: its clock moved on). Should stay 0 |
| `carball_matches`, `carball_players` | gauge | Matches hosted and the players in them, after the last pass |
| `carball_datagrams_received_total`, `carball_datagram_bytes_received_total` | counter | Datagrams from the clients (before the input rate's check) and their bytes |
| `carball_datagrams_sent_total`, `carball_datagram_bytes_sent_total` | counter | Datagrams handed to the connections (the updates) and their bytes |
| `carball_thread_cpu_seconds_total{thread}` | counter | CPU time by thread, from /proc: `game` (every match's ticks), `log` (the log's writer), `network` (every other: the WebTransport runtime's) |
| `carball_resident_memory_bytes` | gauge | Resident memory (/proc/self/status's VmRSS) |

## Reading them
Scrape at the start and the end of an interval and take the differences over its length:
- **The game thread's load:** Δ`carball_thread_cpu_seconds_total{thread="game"}` / Δt, as a share of one core. Every
  match shares that one thread, so this is what runs out first.
- **Headroom:** the passes' p99 (from the histogram's bucket differences) and `carball_game_pass_max_seconds` against
  the 8.33 ms tick, and `carball_ticks_slipped_total` staying unchanged.
- **The network's cost:** Δ`{thread="network"}` / Δt, and the datagrams and bytes each way per second.

Note with each set of numbers the machine (CPU, cores), the commit, and how the server ran (native or its image, bridge
or host networking).

## The game thread's sleep (2026-10-24, after PERF1)
The game loop sleeps once to the next tick (`game_loop::sleep_until`: an absolute CLOCK_MONOTONIC deadline, the thread's
timer slack 1 ns), not in sleeps of at most 1 ms; the messages that came meanwhile are read on waking, before that tick.
Measured with no load (a scratch program, 1200 ticks a strategy; and an idle open match's game thread, its voluntary
context switches over 10 s):

| | tick lateness p50 / p99 / max | wakeups a second (idle match) |
|---|---|---|
| sleeps of at most 1 ms (before) | 57 / 92 / 388 us | 960 |
| one deadline sleep, default slack (50 us) | 57 / 78 / 133 us | 120 |
| one deadline sleep, slack 1 ns (now) | 7 / 17 / 23 us | 120 |

On the browser tests' online and forfeit specs under perf (the static session's PERF2, a2af2a3 against a58a37a; the
machine about twice as loaded for the second): the game thread's voluntary switches 938–955 → 120 a second in every
window; an idle open match's process 0.74 → 0.28 % of a core (the game thread 0.71 → 0.24); two players' game thread
1.57 → 1.02–1.17 %, three players' 1.73 → 1.49 % (its system time 0.55 → 0.18); the network threads within noise; the
ticks 120 a second, none slipped.

A pass a tick holds a session's input datagrams for up to a tick (8.33 ms; 44 ms in a goal's slow motion): its slot
keeps every one that came, in order, each with its arrival time, all of them into the jitter buffer at the pass, as
the game dispatches every packet before its world's tick (RV-1151; at most eight a pass, a flood's oldest let go past
that and not counted as lost). PERF2 (40b443d against a2af2a3): no measurable difference to either side's cost; the
queue's own on the network threads about 0.06 % of a core; three players' process 4.67 % of a core, the game thread
1.38 % (an idle open match 0.23 %).

## Link-time optimisation (2026-10-24, after PERF1)
The server's release profile: thin LTO, one codegen unit (`server/Cargo.toml`). Measured in a scratch copy (this
machine, its usual background load; the game-thread benchmark run quiet, the three interleaved, 3 rounds: a 3v3's 7200
ticks, six players driving, steering, boosting and jumping, their updates encoded):

| release profile | clean build | one-file rebuild | binary | 3v3 tick |
|---|---|---|---|---|
| as before (no LTO, 16 units) | 58.8 s | 9.0 s | 67.9 MB | 25.7 us |
| thin LTO, 1 unit (now) | 73.3 s | 33.6 s | 45.0 MB | 25.3 us |
| fat LTO, 1 unit | 94.3 s | 59.0 s | 42.0 MB | 25.3 us |

The game thread's tick is mostly the C++ engine's physics, which Rust's LTO doesn't reach (about 1.6 % faster, inside
the spread); on the network threads (quinn, tokio, wtransport) PERF2 found no gain either (below). Fat measured no
better than thin for nearly twice the link. The engine's
C++ IPO (CMake's INTERPROCEDURAL_OPTIMIZATION, GCC `-flto`): its test programs' output bit-identical (the determinism
hash dd0f56c02d85870e, the smoke test, rollback, net state, the patches, the stats), its physics within noise (300 s of
the scripted 2v2: 0.42–0.44 s against 0.43–0.49 s), and the server's link failing under rust-lld (GCC's slim LTO
objects unread: undefined engine symbols); not used.

## The three changes measured together (PERF1/PERF2, 2026-10-24)
The static session's profile of the browser tests' specs under perf (kernel samples; this machine, a Ryzen 7 3700X, over
loopback), each commit against the one before; forfeit.spec's 3-player 34 s window, % of a core unless marked:

| | before a58a37a | sleep a2af2a3 | queue 40b443d | thin LTO aeabad6 |
|---|---|---|---|---|
| process | 4.99 | 5.81 | 4.67 | 5.05 |
| game thread (user / sys) | 1.73 (1.18 / 0.55) | 1.49 (1.31 / 0.18) | 1.38 (1.20 / 0.18) | 1.36 (1.22 / 0.14) |
| network workers (user / sys) | 3.26 (1.92 / 1.34) | 4.32 (2.51 / 1.81) | 3.29 (1.93 / 1.36) | 3.69 (2.04 / 1.65) |
| game thread switches a second (voluntary / not) | 943 / 22 | 120 / 18 | 120 / 21 | 120 / 6 |
| idle open match (its game thread) | 0.73–0.74 (0.70) | 0.27–0.29 (0.23–0.25) | 0.23 (0.20) | 0.23–0.25 (0.19–0.22) |
| longest pass in 2 s, median / max (ms) | 0.91 / 2.31 | 0.91 / 2.28 | 0.83 / 4.48 | 0.56 / 2.48 |
| ticks a second, slipped | 120, 0 | 120, 0 | 120, 0 | 120, 0 |
| a player's datagrams a second, down / up | 60.0 / 59.6 | 59.8 / 59.4 | 59.9 / 59.6 | 59.9 / 59.6 |

- **The sleep to the next tick is the one real gain:** the game thread's wakeups 943 → 120 a second, its own sleep's cost
  −80 %, its system time −67–83 %, an idle match −66–68 %.
- **The per-pass input queue is neutral** (about 0.06 % of a core on the network threads).
- **Thin LTO is neutral on average:** each network crate within noise, the game thread −1 % (the C++ engine isn't in
  it); its only plausible gains a shorter worst pass (median 0.83 → 0.56 ms) and a third smaller binary.
- **The network workers' kernel side** (loopback's delivery into Chrome) swings ±30 % with the machine's load: their
  differences under about 15 % are noise.
- **What a 3-player match costs now:** the network threads 65–75 % of it, 40–45 % of that the kernel's (sendmsg, futex,
  epoll, the scheduler); quinn-proto, tokio, wtransport and the cipher the rest; the game thread 25–30 %, mostly the
  physics.

