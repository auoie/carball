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
that and not counted as lost).

