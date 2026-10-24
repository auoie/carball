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
