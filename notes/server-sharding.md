# Game servers on bigger machines: shards

**Status:** design only, written 2026-10-24 at the user's request. Nothing here is built. Today each game server is
a 1-vCPU host running one server process.

## What one server process is today

- **One game thread** runs every match in turn, each on its own clock: 120 Hz, slower in the goal slow motion. It sleeps
  until the next tick (`server/src/game_loop.rs`).
- **One tokio runtime** for the network, with `CPUs − 1` workers and at least one (`server/src/main.rs:583`). It runs the
  accept loop, each player's session, writer and control tasks, QUIC and TLS (quinn 0.11, wtransport 0.7), the health
  check, info and metrics, the outbox and the reloads.
- **One logging thread.**
- **Between them:** a small per-player input queue (at most 8 datagrams a pass, RV-1151) and a bounded message queue
  (65,536, at most 2,048 read a pass). Each player's updates go to their writer task.

## What it costs (PERF2, 2026-10-24)

Measured on the user's Ryzen 3700X over loopback, on the existing browser specs, with kernel samples.

| | % of one core |
|---|---|
| 3-player match, the whole process | ~4.7 (the game thread ~1.4, the network workers ~3.3) |
| idle open match | ~0.23 |

So per 3v3 the network side costs about twice the game side. A 2-vCPU host runs one game thread and one network worker
(CPUs − 1), each capped at one core: the worker fills at roughly 30 3v3s (3.3 % each), the game thread at roughly 55–70,
so the network runs out first, at about 30. These figures are from a desktop over loopback, which
inflates sending (`sendmsg` includes the delivery into Chrome) and thread switching (15 workers): measure on the real host
before relying on them.

## The design: shared-nothing shards

On a host with T hardware threads, run T/2 copies of today's server process, each pinned to 2 threads and each on its own
UDP port.

```
 8-thread host
 ┌───────────────┬───────────────┬───────────────┬───────────────┐
 │ shard :4433   │ shard :4434   │ shard :4435   │ shard :4436   │
 │ game + net    │ game + net    │ game + net    │ game + net    │
 │ CPUs 0-1      │ CPUs 2-3      │ CPUs 4-5      │ CPUs 6-7      │
 └───────────────┴───────────────┴───────────────┴───────────────┘
        the matchmaker assigns each match to one shard
```

- **Each shard is exactly today's server:** one game thread and one network worker (2 CPUs − 1: the runtime counts the
  CPUs the process may use, a cpuset or a quota). It has its own UDP port, its own health and info ports, and its own
  outbox directory.
- **The matchmaker sees one server per shard.** A server's name is already `PUBLIC_HOST:port` (`server/src/main.rs:341`),
  so four shards on one host are four names.
- **Pinning:** Docker's `--cpuset-cpus` per shard. With hyper-threading, pin both threads of one core to the same shard,
  so its game thread and network worker share a core's caches and don't contend with another shard.

### Why shards rather than one multi-threaded process

- **Matches never interact.** Nothing needs sharing between shards: no locks, no routing a player's messages to whichever
  game thread owns their match. The C++ engine never runs on two threads in one process, so its thread safety (RocketSim's
  shared collision data, loaded once at start) never comes up.
- **The network spreads by socket.** In quinn 0.11 (0.11.12, `EndpointDriver::drive_recv`), one endpoint (one UDP
  socket) receives and dispatches all its packets on a single driver task, routing each by connection ID to its
  connection's channel, while each connection's own work (decryption, frames, acks, its sends) runs on its connection's
  task, on any worker. A shard per socket gives every shard its own receive path. In one big process, receive and dispatch would
  stay on one task however many workers it had.
- **Isolation:** a crash or a stalled game thread takes down one shard's matches, not the host's.
- **Gentler deploys:** restart the shards one after another, so a deploy never ends every match on the host at once.
- **No server code changes:** the ports and the outbox's directory are already settings.

### Alternatives considered

- **One process, several game threads, one shared network pool.** Matches would be assigned to game threads, and every
  message routed to the owning one. It's more code and more coordination, the single endpoint's receive task stays the
  limit, and one crash still takes every match.
- **One port for every shard with SO_REUSEPORT.** The kernel spreads packets by address hash, not by match, so a player
  could land on a shard that doesn't host their match. Fixing that needs an eBPF program routing by QUIC connection ID.
  Separate ports are simpler.

## What would change

**Carball (small):**
- The matchmaker counts each shard as a server (it already handles several per region). Check the limits that scale
  with server count: the fleet-wide ceiling covers 8 servers at 300/min (`api/internal/server/server.go`: GameServer
  300/min each, GameServerFleet 2,400/min; RV-1024, RV-1077), so raise it with the fleet.
- Nothing in the server: each shard's UDP, health and info ports are settings already (`--port`/`GAME_PORT`,
  `--health-port`/`HEALTH_PORT`, `--info-port`: a flag alone, no environment variable), and so is its outbox's directory
  (`OUTBOX_DIR`).

**The servers repo:**
- **Terraform:** firewall rules for a UDP port range (IPv4 and IPv6) instead of 4433 alone.
- **nftables** (`deploy/game/setup-once.sh`): the per-source limit applies per shard port, or to the range.
- **`deploy/game/run-carball-game.sh`:** one container per shard, named by port, with `--port`, its health and info ports,
  `--cpuset-cpus`, and **its own `OUTBOX_DIR` volume** (the outbox keeps a queue server's ranked calls on disk and takes no
  file lock: two shards sharing one would collide).
- **`deploy/rollout.sh`:** restart a host's shards one at a time.
- **DNS and certificates:** unchanged. The shards share the host's name and certificate.

## Capacity, roughly

At ~3.3 % of its one network worker per 3v3, a 2-thread shard fits about 30 3v3s, so about 120 on an 8-thread host,
nearly linear in shards.
With hyper-threading, "8 threads" is usually 4 cores, and a core's second thread adds well under a full core, so plan by
cores. Measure one shard under real matches on the host first (no load generator: the project doesn't build one).

## When to do it

Only when hosts with 4+ cores become cheaper per match than several small 1–2 vCPU hosts, and there are players enough to
fill them. Until then, small hosts per region give more matches per euro and need none of this.
