# Handoff: how to resume this project

## Next (2026-10-14): a shippable v1 (G1 bandwidth, a simple queue, deployable)
The user (2026-10-14) wants a shippable v1, no more polish; three steps, each its own clean point (the full e2e once
per clean point):
1. **G1 bandwidth** (done, below) with a small loss/latency test.
2. **A simple queue**: Play → 1v1 / 2v2 / 3v3 → searching (Cancel works); the server runs several matches at once; a
   match starts only when full (no backfill, no bots, leavers not replaced, forfeit votes as now); at the end back to
   the menu or search again. No rating or ranks in v1. The static session's v1 checklist (verbatim texts, idle kick,
   "Joining in {n}", reservation timeout, end-menu Play again / Exit) is the first section of `notes/matchmaking.md`.
3. **Deployable**: two images (the client's static build served on :3000 with a `config.json` for the game server's
   URL, env-overridable; the game server: env for the public host, the allowed page origin, the UDP port, the cert and
   key paths, reloaded on a file change or SIGHUP without dropping matches) and a short `APP-CONTRACT.md` (env, ports,
   volumes, reload, health check, resources, logs). The user's own servers repo does hosts, DNS, firewall and certs.
   Names: the page `https://carball.zolt.top`, the game server `game.carball.zolt.top` (DNS-only).

Cut until after launch: ranks/MMR (the ranked-style design: matches only when full, MMR per playlist, the browser key
as identity), G2–G4 (remote cars predicted as the game does, no per-update resim spikes, the Connection Quality
indicator), the full §13 harness, free-play polish.

**G1 (bandwidth), 2026-10-14.** The server sends the game's compact state at the game's rates:
- `engine/net/NetState` compact form (`COMPACT_VERSION` 9; protocol 15): each body as `ReplicatedRBState` (packed int
  vectors, the 56-bit rotation; exact, since every tick rounds the bodies to it; raw for a body placed since its tick)
  plus each car's flags, boost, controls, dodge torque, counters, the physics' timers while active and its XY lock
  (RV-304). The client lays it over its own saved state (a lossy value that sends the same is kept), so a right
  prediction is untouched; its wheels' carried values and contacts stay its own, as the game's client. The exact
  form (version 8) stays for the engine's netstate check.
- `server/src/replication.rs`: the ball at NUF 100, cars at 15, + U(0, 1/57) (≈ 37 and ≈ 12 a second), forced as
  the game forces them; the pads on a change and once a second. Updates still go every other tick (the ack).
- Per client, everyone driving (T6, `server/src/game.rs`): 1v1 22.5 → 3.3 KB/s, 2v2 33.7 → 4.4, 3v3 45.6 → 5.5
  (32–38 B a body; with cars by the ball before: 2v2 67.6, 3v3 97.0).
- The loss/latency check (`client/src/net/session.test.ts`, `client/src/testing/netRun.ts`: the client's network core,
  `src/net/session.ts`, paced as a page, against the server's own match in process: the local host's module, since
  2026-10-23's design 5; a TS port of the input buffer before it) at 80 ms round trip, 20 ms jitter, 2 % loss: the
  buffer rarely dry, at 11, the local car's corrections p95 up to 3 uu, the bot's p95 ≈ 20 uu; the ball's p95 0 but for
  seed 5's ~3 s of ball corrections by whole ticks' travel (a finding of design 5, to investigate). Before G1 (the port's
  replication): 42.9 → 3.9 KB/s, local mispredictions 97 → 32.
- Kept from the first harness step: `server/src/netsim.rs` (seeded paths; `client/src/testing/netsim.ts` its twin,
  checked against the vectors it writes), the input buffer's T2 tests (`server/src/net_tests.rs`).

**G2 (other players' cars), 2026-10-14**, decided with T5 (`client/src/net/remoteInputs.test.ts`): the game's rule
(notes/netcode-live.md §4, its SimulatedProxy), the static session's recommendation. `client/src/net/predictor.ts`
records each other car's controls per frame; a new frame takes its replicated throttle, steer and handbrake in full
(and the boost button, for the vehicle's full throttle while boosting on the ground: GA-1, which the game's server
applies before replicating the throttle), the rest from the frame before; when its state arrives with inputs other
than recorded, the recorded frames from its frame are rewritten, the axes fading out over 0.1 s, and replayed. Its
components don't run on the client (`Car::_componentsOff`, `World.setCarComponents`: jump, double jump, dodge, air
control and its air throttle, auto-flip, boost): those show only in the server's states. T5 (3 models × 50/100/150 ms,
scripted bots and the check sample's replay inputs, local data): "gameComponents" (the components on the server's
jump and boost) never halves the corrections; with real inputs the game's rule beats the earlier fade at p50 and p99.
The v1 order and the security items (SEC-1..11, from the static session's review) are in the memory plan; SEC-1 (a
kickoff with more cars on a team than spots overran RocketSim's respawn table: `% CAR_RESPAWN_LOCATION_AMOUNT`; the
server takes two teams of the playlist's size, a requested team while it has room), SEC-4 (mutes only of players
here), SEC-10 (Hello's preferences clamped) and saturating input counters came with G2. The browser tests that read no
pixels load with `?render=off` (`Renderer.draws`).
The review of G1 (RX8, RV-308..319) came with G2: the compact car carries its respawn selection while demolished
(RV-308: the spot's random start is seeded from the tick count), a placement (the spawn counter moved) starts the
client's car from a fresh state with the last tick's jump bit sent (RV-309), the owner's boost exact when it isn't a
byte's value (RV-310), the compact bodies' vectors initialised (RV-311); the engine's netstate check re-encodes the
client after each update and must send the server's bytes (RV-312); replication.rs's forcing rules unit-tested
(RV-313); the session's wiring tested (`client/src/net/sessionWiring.test.ts`, RV-314); a car's updates 4 or 5 updates
apart, the replays' 13.4 a second (RV-315); the Rust tests check the TypeScript twins' vectors and write them only with
`REGENERATE_VECTORS=1` (RV-317). G1's step (2): the datagrams the connection refuses are counted and logged when the
session ends (`net.rs`, RV-334); no stale-datagram policy (at ≈ 5 KB/s the path never backs up).
**G3, G5, G7, G8, G10, 2026-10-14** (one clean point; gates T7, T8): `Predictor.stage()` writes each update's states
into the history at its frame and `resimulate()` replays once a frame from the oldest (`NetSession.applyUpdates`: one
capture and smoothing around it); the history's snapshots reuse their buffers (`World.saveStateInto`, the binding's
`saveStateView`). States apply at the present without a replay (`stats.direct`) for a frame not reached yet (no more
renumbering: the server's ack comes back to the client's frames; the session keeps the newest update's ack and sends
its newest 10 while the ack is past its frames), with ack 0, and while the local car is demolished (G5, `predicting`);
an ack older than the history replays from its oldest frame. The server stops updates to a client silent 1.5 s (G8)
and counts unsent datagrams; a jump press in the first of two frames consumed together dodges by that frame's axes
(G10: `InputBuffer::press_axes`, `rl_set_press_axes`, `Car::_pressAxes`). T7 (client stalls 0.3/2/10 s) and T8 (a 3 s
two-way outage: the server's buffer takes ≈ 38 s back to 7, the game's rule) in `client/src/net/session.test.ts`.
**FP1, 2026-10-14** (vehicles in the game's order, notes/physics-values.md FP1 G2): the Arena keeps the game's action
array (`Arena::_vehicleOrder`: a car added or respawned goes last, one demolished or removed leaves its place to the
last, every kickoff spawns them again in join order = car IDs; the podium in the MVP order, set by the server) and the
step runs the cars' pre-physics and vehicles in it, after a first pass of the demolished cars' respawns
(`Car::_PreTickRespawn`). Snapshots, clones and the compact net state (when not plain ID order) carry it: protocol 16.
Tests: rl_patch_tests TestVehicleOrder, T1 (TestCarOnCarRoof), T2 (TestCarOnBall); the determinism scenario's physics
hashes are unchanged (its snapshot has the order: 20 B more). The engine README's flip-cancel line: the 5th tick after
the press. A body placed by SetState isn't in the broadphase until the next step (other cars' wheel rays miss it for a
tick; asked the static session what the game does). The review of G2 (RX9, RV-320..331) came with it: the e2e servers'
start and stop in `client/src/testing/serverProcesses.ts` (a server killed by a signal fails the start at once,
RV-320), a remote car's GA-1 folded into its replicated throttle (RV-321), a car placed in the last 16 ticks sends its
wheels and the ticks since (RV-322), the tests RV-323..326, the goal's e2e test draws again (RV-327), `--team-size`
validated and the engine's preference clamp (RV-329, RV-331).
**The queue, 2026-10-14** (step 2; protocol 17): `server/src/queue.rs` decides who plays together (each playlist's
searchers in arrival order; two full teams make a match) and asks `server/src/match_host.rs` for a match
(`MatchHosting::create_match`: the boundary the user asked for, so the queue can move to a central matchmaker later);
the host reserves a slot per player with a one-time random token (getrandom), runs every match on the game thread on
its own clock, holds the warm-up until every slot is claimed (full start, `Game::hold_for`), cancels a match whose
player doesn't claim in 30 s or leaves before the start (`Kicked` 1: the others search again), and lets a match go
when its end screen is over (no rematch) or everyone left. `carball-server --mode queue` serves searches and claims only;
the default `direct` keeps the one open match the browser tests and development use. The idle kick (MM-32..38, the
MM-35a input predicate in `input_buffer.rs` `changed_for_kick`): warned past 25 s of play, kicked past 30 s, idle
carried across rounds; queue matches only. SEC-9 (64-bit keys from getrandom) and SEC-11 (names: spaces, combining
marks, "Player N" lookalikes) came with it. Client: the main menu's Play → Free Play / 1v1 / 2v2 / 3v3 → Find Match
(`src/ui/mainMenu.ts`), the search (`src/game/matchmaking.ts`, `src/net/search.ts`) with the Searching panel and the
banner (`src/ui/searchView.ts`), "Joining in 3, 2, 1", then the match page (`?match`, the claim handed over in
sessionStorage: `src/net/pages.ts`); a queue match's end screen has Play Again (search again) and "Leaving In"; a kick
or a lost connection goes back to the menu with the modal (`src/ui/modal.ts`), the idle warning tip
(`src/ui/idleTip.ts`). The game's texts verbatim per the user's decisions (the connection-lost line without "(Error:
42)"). Tests: `server/src/match_host.rs`, `queue.rs`, the game's idle tests, `tests/end_to_end.rs` (two searches over
WebTransport), `client/src/game/matchmaking.test.ts`, `src/net/pages.test.ts`, `client/e2e/services/queue.spec.ts`
(the services' queue stack since design 4). The review of G3 (RX10, RV-332..339) and of FP1 (RX11, RV-340..352) came with it: a
demolition takes its car out of the vehicles' order at once, and copies write the order as the next sync leaves it
(RV-340, RV-346), a snapshot's order count bounded before anything's allocated (RV-341), a demolished car doesn't
send the wheel block (RV-345); the compact overlay leaves a car's last-tick controls but the jump to the client (in a
kickoff's countdown they're the countdown's zeroed ones: the engine's netstate check's longer run caught the overlay
changing an exact client there, which its 120 s batch run didn't reach). The server's tests aborted about one run in
five (`std::length_error` in an arena's teardown, at the FP1 commit too): RocketSim caches a shape's box in the shape,
and the arena meshes are shared by every arena, so the tests' arenas on several threads tore it; engine patch 106
computes the meshes' box each time (rl_patch_tests TestSharedMeshBoxNotCached). The rest of that flake (RX12's RV-356):
RocketSim's init raced when tests on several threads each called it; `engine::init` now runs it once a process.
**FP2, 2026-10-15** (the wheel rays' candidates, notes/bullet-diff.md AB1; protocol 18): engine patch 107. The rays test
only the bodies whose stored broadphase box overlaps the box around all of a car's rays (`btVehicleCarball::findRayCandidates`,
at most 32), at their current transform; a body teleported since the last step is seen only if its old box overlaps (a
tick later otherwise), as in the game; a new spawn (spawn counter moved) gets its box at once (`Sim/CreatedBox.h`), also
when the network state applies a placement; snapshots carry the ball's and cars' boxes (copies exact). Checks: the
determinism scenario's per-second physics hashes are unchanged over 300 s (the snapshot grew by the boxes); every live
recording validates as before (`live_validate` now gives bodies their boxes after a skipped placement tick, as the game's
step did; without it car_car2's tick 731 lost its wheel contact); rl_patch_tests TestWheelRayCandidates (a car teleported
from 150 uu: the old cell candidates saw it at once, the game's rule a tick later; mutants of the query, the spawn box and
the snapshot boxes each fail it).
**Hardening and the images, 2026-10-15** (the deploy step; `APP-CONTRACT.md`): SEC-2 (QUIC stream and window limits
through wtransport's `quinn` feature, 512 sessions, per address 8 at once and 30 a minute, a 10 s handshake deadline),
SEC-3 (per-session token buckets: inputs 240/s, control 20/s with a flood closing the session; 2048 messages a loop),
SEC-5 (`ALLOWED_ORIGIN`), SEC-6 (`CERT_PATH`/`KEY_PATH` PEM files, reloaded on a change, polled every 5 s, or SIGHUP,
open sessions kept: `Endpoint::reload_config`; the dev info server only without a certificate, on 127.0.0.1, 2 s reads,
64 connections), SEC-7 (`catch_unwind` per match tick: that match let go, an open match restarted; the process exits if
the game thread ends; SIGTERM exits at once), SEC-8 (one World a tick to the others). A health endpoint on 127.0.0.1
(`--healthcheck`, the image's HEALTHCHECK) reports the game thread's heartbeat. The images: `scripts/build_images.sh`
builds the root `Dockerfile`: `client/dist` (nginx on :3000, `config.json` from `GAME_SERVER_URL` at start:
`client/docker/`) and the release binary with the meshes (`debian:trixie-slim`; libstdc++ is linked in, so glibc 2.38+
is enough: `server/build.rs`). The client reads `config.json` for the game server (no certificate hash: a real certificate) unless
`?queue=` names a development server. The images build here (Docker with BuildKit: the root `Dockerfile`,
`scripts/build_images.sh`, APP-CONTRACT.md); the game image's production mode (a PEM certificate, reloads on SIGHUP and
on file changes, the health check, SIGTERM) is checked in a container, and the reload is in `tests/end_to_end.rs`. If a Windows browser can't reach a WSL development server's info endpoint on 127.0.0.1, run it
with `--info-bind 0.0.0.0`.
The review of the queue step (RX12, RV-353..365) came with FP2 and the hardening: a car demolished by a state set leaves
the vehicles' order before the respawn pass (RV-353); the "Joining in" countdown runs on timers, so a hidden tab claims
on time (RV-354); a claim whose match is gone searches again with a line, Cancel during the countdown gives the slot up at
once (the match cancelled now for the others), Find Match while searching keeps the search (RV-355, MM-2); a formed
match builds its arena at its first claim and the queue looks only at full playlists (RV-357; tokens aren't bound to the
searcher: after launch); a claim on a development server is refused as not its (RV-363); netstate's countdown case and
the demolished car's block (RV-358, RV-359); the later-state predictor test (RV-361). RV-362 (what would race with a
thread per match): every match stays on the one game thread.
**RX13 (RV-366..383), 2026-10-15** (protocol 19; engine patches 108, 109): the front end sends an unproven address a
QUIC Retry before it takes a slot, keys IPv6 by /64 (IPv4-mapped addresses as IPv4) and gives the QUIC handshake 4 s
(RV-366); a certificate whose key isn't its pair is an error, not wtransport's panic (`net::load_identity`, RV-368); a
blank `ALLOWED_ORIGIN` fails closed and origins compare without case (RV-372); a queue server needs a certificate or
`--dev` (RV-381; the image's development run is `--dev`); input floods close a session too and overrun counts drain
(RV-373). The queue's no-shows (RV-367, the user's decision): a found match waits 12 s; cancelled for someone, the
players who claimed (or were still loading, refused their claim) search again with their token in the search hello and
go back to the front in their first search's order; whoever stalled it (didn't claim, or left before the start) gets
`SearchCooldown` for 2 minutes by browser key (`carball.browserKey`, local storage; their address only after a second
key's stall there: RX14's RV-385, RX15's RV-407). The wheel ray's hit
point is `setInterpolate3`, its normal never normalized again, the planes tested analytically (patch 108, RV-377); the
candidates come in the game's SAP order, kept by the broadphase and carried by snapshots (patch 109, RV-375; the statics'
keys are the engine's boxes: the remaining difference). The netstate gate counts divergences caused by the client's
stored boxes alone separately, 2 % allowed (RV-369: the game's clients don't get boxes either). The images are built
from the commit (`git archive`; `--worktree` for testing), the WebAssembly in the script, the binary stripped with its
paths remapped (RV-370, RV-380); the web image is nginx-unprivileged 1.30 with security headers and a CSP (the engine
module linked with `-sDYNAMIC_EXECUTION=0`: no eval), both bases pinned by digest (RV-371). Shipped files name no game
(the user's decision): quick chat's two lines say Carball, the hitbox presets are Standard/Flat/Wide/Long/Mid/Tall
(notes/hitboxes.md), the title is Carball, and the web build ships `THIRD_PARTY_NOTICES.txt`. Tests for the mutants
RX13 saw survive (S1, S7, S13, S14, S22, S24; C5, C7, C11, C12, C13, C17; E11-E14; P2, Q4, Q7, Q8); the goal e2e's bound
is the session's own offset movement around the goal (RV-379).
**RX14 (RV-384..405), 2026-10-15** (the last review before the public deploy; protocol 20): a no-show is blocked by
its browser key; its IPv4 address only after two different keys stalled from it within 10 minutes or a keyless search
stalled (an IPv6 /64 at once), the page then told the network's searches are paused, blaming no one (RV-385, the user's
go via tmp-8e); a new cooldown lets the staller's other waiting searches go with it (RV-386). The netstate gate excuses a
divergence with contacts only if splicing in the server's persistent contacts makes it identical, 2 % at most
(RV-387); a guard test (`render/shippedNames.test.ts`) keeps the game's, maker's, cars' and arenas' names out of dist,
the WebAssembly, public/ and our strings, in CI and the image build (RV-388). The web image's CSP has the game server's
origin alone in `connect-src` (written at start from `GAME_SERVER_URL`; `EXTRA_CONNECT_SRC` for tests), relative
redirects, a root-owned configuration, OCI labels with the revision and `carball.source` (commit or worktree); the build
refuses a commit-like tag for `--worktree` and any build path in the binary (RV-395..398); `--healthcheck` reads only
its port and a bad number names its variable (RV-399). Waiting for the user: RV-384's scope (mode names, "RL"
abbreviations). Deferred, no measured effect: RV-389..391 (the kickoff's insertion order, the collision objects'
re-append on spawn, deduplicating a snapshot's order).
**RV-384, the user's names decision widened, 2026-10-15:** shipped files name no game mode and carry no "RL"
abbreviation. The engine's mode table names the arena "arena" (the others "mode 1".."mode 4": unused), its load summary
counts the arena alone, the tiles' errors say "Tiles::"; the arena meshes are `out/arena/collision_meshes/arena/arena_*.cmf`
(the same order: one prefix for all), `out/arena/arena.obj`; the local cooked copies under `out/arena_local/*/` got an
`arena` link to their `soccar` folders. The server is `carball-server` (crate `carball_server`, `SERVER_MODE`), the
engine module `carball_engine(_web).mjs/.wasm` (the targets keep their names), the storage keys `carball.*` (the old
`rl-clone.*` moved once at start: `settings/storageKeys.ts`, the one "rl" that ships, on purpose), the page's hooks and
shader functions `carball*` (`camera/carballCamera.ts`), the scoreboard settings' heading "Columns". RocketSim keeps its
name (its notice). The names guard checks the modes and the abbreviations too.
**RX15 (RV-406..418), 2026-10-15:** IPv4 only (the user's decision, RV-406): the game server's name has an A record and
no AAAA, since Docker's default bridge shows every IPv6 client as one address (`--network host` documented for IPv6
later). An IPv6 /64 is blocked like an IPv4 address, after two keys' stalls or a keyless one (RV-407), the stall records
capped at 100k addresses. The web image's whole /etc/nginx is root's (RV-408), a strict CSP is baked in at build (RV-409)
and the start script allowlists its inputs (RV-410). netstate's excuses need the restored client to reproduce the live
one (RV-412); the names guard splits camelCase and digit compounds (RV-413); the build's path check reads the binary
with `grep -a` (RV-414). Tests: the no-show scenario over IPv4 and IPv6 end to end (network:true on the wire after two
keys), the binary's `--healthcheck`, the queue's C4/C11/C12/C18. Post-launch: RV-411 (griefing a shared address from
inside it).
**RX16 (RV-419..433), 2026-10-15** (the renames reviewed): the last "RL" names in shipped files went (the user's
decision on RV-420): RocketSim's vehicle classes are `btVehicleCarball` and `btWheelInfoCarball` (their files keep
RocketSim's names, `Sim/btVehicleRL/btVehicleRL.h/.cpp`, so the patch diff stays a diff; C++ type names ship in the
WebAssembly and the binary, file names don't), and the `.cmf` body-offset trailer's magic is "CBOF" (RV-419: the 4
goal meshes regenerated, 2 bytes each; the local cooked goal meshes patched alike, the originals in
`out/arena_local/rlof_backup/`), and the client's `RL_DOME` (fog) is `SKY_DOME`. Physics unchanged (det hashes as before). A meshes folder without `arena/*.cmf` (empty, or the old
`soccar/` layout) stops the server at start naming it (`rl_init` returns 0 when no arena mesh loaded; before, the
first match threw across the C boundary and aborted the process: RV-421). The contract lists the renamed interface
(`SERVER_MODE`, `/app/carball-server`, `arena/`: RV-422), publishes the game port on IPv4 alone and says where the
server's flags go (RV-432), and what rolling the web image back past the storage rename does (RV-425; the old dev key
`rl-clone.server` is removed). The names guard (RV-423, RV-424): the modes Rumble, Gridiron, Knockout, Spike Rush; the
abbreviation case-sensitive (rl-…, rl_…, RL_…, "RL …", rlUI, RLOF, window.rl, a type name's btVehicleRL; not a minifier's `rl`, URL, RLIMIT or
RLEDecoder); distinctive names inside any word (OCTANEBODY); file names; binaries by their printable runs; the old
keys' prefix in `settings/storageKeys.ts` alone and once in dist; and the image build runs it on the game image's
files (`SHIPPED_GAME_DIR`; rustls's `hybrid_component` allowed). The web start script checks ports (1–65535) and
host labels and rebuilds the extra sources one space apart (RV-430); the default `config.json` is written at build
(RV-431). The queue's full stall records drop the oldest address from an arrival-ordered list, no scan (RV-428).
netstate: the update must leave the client's persistent contacts as they were, and the verdict checks itself (each
count alone fails it; a client with an F3-style hidden change diverges unexplained: RV-433). The sky noise test
times its thread's CPU (RV-427).
**RX17 (RV-434..441), 2026-10-15** (8f78a1a, deployed): the server's meshes must be the arena's (RV-434): `rl_init`
refuses a folder whose `arena/` doesn't hold 16 whole mesh files, catches what the engine throws (an exception across
the C boundary aborted the process), and counts the goal halves' offsets once loaded (4, else refused); the engine's
mesh reader refuses bytes after the vertices that aren't a CBOF offset (an older RLOF mesh had loaded unplaced, the goals
at the field's centre); the reason comes back through `rl_init_error()`. The names guard (RV-435, RV-436): the rules random
bytes meet (short camel names, properties, a name ending in RL) apply to text only, a C++ type name ending in RL is found
in binaries by its Itanium length prefix, base64 runs (64+) and vite's file hashes are taken out first, RLOF and the
retired class names match anywhere, the old joined names in any case; seeded random data (4 MB of bytes, 1 MB of base64)
gives no hit. Tests pin the stall cap (100k, the 100,001st lets the first go; a full table keeps the oldest address's
record: RV-437); netstate tallies its runs through one function its self-check also uses, and the self-check adds a
client whose change the snapshot misses (F2, RV-438). The dropped dev key is read before it's removed (RV-439); the web
image's default URL is its ENV alone, an empty one refused (RV-441). "Hoops" inside a compound (jumpThroughHoops) stays a
hit: a mode name.
**Maps (protocol 21), 2026-10-15** (superseded 2026-10-17: one map, Night, below) (the user's decisions, after launch): Play → Free Play opens a map select (the 16
themes by their names, `MAP_NAMES`; pad and keyboard; the last pick in `carball.freeplayMap`, checked and focused). Picking
the page's own map starts free play at once; another map loads the page on it, straight into free play (a `freePlay`
menu notice): the theme's scenery, GPU resources and soundscape are built once per page, as the game loads a map. A
search running then goes on in the new page (a new search of its playlist, under the banner: its place in the queue
and clock start over); during "Joining in" the pick keeps the page's map (the match page loads in a moment). Online,
the server picks a map at random per match (`MatchHost::add`; a development server's open match keeps its map through
rematches, its players staying connected) and sends it in `MatchFound` and every `Welcome`; a map on the wire is an index
into `THEMES` (only ever appended to: `protocol::MAP_COUNT` = 16, a client test checks they agree). The menu page downloads
a found match's theme chunk during "Joining in" and hands the map to the match page in its claim, which builds that arena
while the claim connects; the welcome's map decides. `?theme=` still overrides (development), and a map-select pick drops
it. `--map N` fixes every match's map: the e2e servers run on 0 (night), the queue server on 2 (meadow), which the queue
test checks both match pages show.
**The game's net, trim and cage on every map, 2026-10-16** (superseded 2026-10-17: removed with the other maps) (the user's decision: the old hex walls' hexagons warped over
the goals' curves): every theme wears the stadium's cage (the force-field overlay round the ball, the game's additive
beams stopping at the wall's foot, `cageGraph(false)`, with the hex glass beside the goal mouths below them), its net
(the hex glass) and its trim (the frame's metal at the wall's foot, `SideTrimMaterial`, reflecting the arena's capture:
every map captures it now; the team glow sheets behind the walls, which replace our light along the trim), tinted with
the theme's own `walls.blue`/`orange`. Still the stadium's alone (`walls.game`): its field and floor, its goals' metal
floors, underlayers, glows and unlit frame; every other theme keeps its floor, markings, goals' floors and lit goal frame.
`HexWallMaterial` (hexWalls.ts), our beam ribbons and trim light, and `WallStyle`'s `neutral`/`lines`/`ceilingLines` went.
The trim's cap (AV-10: z 256-272 above the r 256 fillet, x 4096-4100; `trimCap`) closes the dark band of bare cage the
user saw between the trim and the glow sheets' foot (z 272). It is part of the trim: along the fillet's whole top edge at
256 (the side walls through midfield, their corners, the diagonal), a solid profile as the game's (a front face on the
wall, sharing the fillet's top points so no seam shows the overlay's hexes, and a top face to 4 uu behind the wall along
each point's outward normal). Its front face lies where our overlay does (the game's is 4 uu behind it), so its own
SideTrimMaterial copy is drawn a little nearer (polygon offset -1, -2). The back corners and back walls (fillet top 160
to 96) get none: AV-10 gives them other pieces (a grate, glass); the static session is identifying what goes there, and in
the other gaps (the glow's ends, the midfield glow gap, the sliver between the goal frame and the glass wing).
**One map, Night (protocol 25), 2026-10-17** (the user's decision): the only map is our glasshouse arena under Night's
sky (`render/themes/night.ts`, `render/greenhouse.ts`, `render/tokenPads.ts`), named "Night". The other 15 themes,
game-style Night, Stadium, the hex cage and its topology (`scripts/cage_*`), the stadium field, the game's wall foot trim,
the game-style pads, the reflection capture, the height fog, the map select, `?theme=` and the dev cage/field-plan loaders
are gone (git history at 3cb78f8). The wire keeps the map byte, always 0 (`MAP_COUNT` 1, `NIGHT_MAP`); the server has no
`--map`. **Play vs Bots** (same day): the server's game core compiled to wasm (`server/src/bin/host.rs`,
`scripts/build_host.sh`) runs the match in a worker (`client/src/local/`), the page its online client; bots are the
built-in chaser or the shipped Nexto/Necto packages (`client/bots/`, CC BY-NC-SA 4.0, onnxruntime-web on one thread;
`CARBALL_BOTS=0` builds without them). RX23 (RV-532..547) fixed in the tree after 3c8622b.
**Custom training, 2026-10-17** (the user's next feature after be5653a; spec notes/custom-training.md, CTR-1..21):
Carball's own JSON pack format (`client/src/training/pack.ts`), the run's rules (`training/run.ts`) wired into free play's
session (`game/freeplay.ts`: the engine's kickoff hold as the countdown's, the ball held frozen, goals scored only when an
entry counts via the WASM binding `setGoalScoring`, `hideBall` for saves and timeouts, a sibling arena predicting the ball's
path), the HUD (`ui/trainingHud.ts`), the Training settings tab with the variance (`training/variance.ts`), Carball's
starter packs (`training/starterPacks.ts`, checked against the engine), the editor (`ui/trainingEditor.ts`: the player's
packs in the browser, export/import, playtest). The user's 20 packs: converted from TP1's dumps by
`out/bsim/assets_local/training/tools/convert_tp1.py` into `out/bsim/assets_local/training/packs/` (git-ignored, other
creators' work, account ids dropped), listed by the dev server alone; a guard check keeps any /local-assets/ path out of
builds.
**The editor's free-camera mode, 2026-10-18** (the user's request; notes/training-editor.md TE1): a Panel / Free
camera toggle (kept in `carball.training.editorMode`); `ui/flyEditor.ts` (shot list, SEQUENCE SETTINGS, the shot editor's
HUD and strength meter, keys and pad per TE1 §2.1) over `training/editorControls.ts` (flight, clamps, look, steps, the
bumpers' repeat, tap/hold, undo); Test Shot / Test Sequence are `TrainingRun` tests (`test`: no variance, no grounding,
nothing kept, the HUD's Edit Shot), free play holding the edited car where placed and predicting its path at most every
0.1 s while it moves. Ctrl (Move Down) with W can close the browser tab: the game's binding kept, a browser limit.
**Car models, 2026-10-18** (the user's: Blender cars as the main look; client/cars/README.md): `render/carGlb.ts`
loads `client/cars/<type>.glb` (bundled by an import.meta.glob where present), the generated car the fallback; Paint
recoloured with the generated cars' Glossy finish; wheels keep the model's x/y, their height (connection point less the
suspension) and steer angle from the WASM binding `carWheels` (bindings-only engine change), spin from the travel;
exhausts at every Exhaust… empty (each along its own −X: the Sport's and Flat's _L/_R pairs, the Tall's
_Top/_Bottom), else the body raycast; the garage shows it; guards: carGlb.test.ts (15k triangles,
parts, no maker/model/game names) and shippedData (only client/cars' files ship). Checked on the user's demo sport.glb in
a scratch mirror; then CB1's sport.glb, flat.glb and tall.glb (approved 2026-10-18) went into client/cars. Their wheels and body are drawn as the game's (SU1, notes/visual-timing.md VT-32:
`render/carGlb.ts` wheelDropTarget/easeWheel, `render/chassisSpring.ts`); replays record each Blender car's wheels.
**RX25 (437863a, RV-561..579) fixed in the tree:**
- RV-561: the pack test's fixture was a user-pack shot; now synthetic numbers, plus a local guard
  (training/localPacks.test.ts). History kept, the user's call.
- RV-562: progress is now under carball.training.progress.<id>; imports take a fresh id.
- RV-563: a beforeunload prompt and Ctrl shortcuts blocked in the fly view; Move Down stays on Left Ctrl, the user's call.
- RV-564: Select Shot, SEQUENCE SETTINGS and the panel editor are pad menus.
- RV-565: the follow camera is clamped (z ≥ 15).
- LOWs:
  - 566: keys held from a menu are no press.
  - 567: a refused save says so.
  - 568: Test Shot's restart keeps the shot, behind the RESTART TRAINING question.
  - 569/570: the training HUD is centred and its controls hidden under menus.
  - 571: slider focus is kept; Tab reaches the fly list's buttons.
  - 572: imports are brought within TE1's limits; the ball is allowed inside a goal.
  - 573: the predictor's events are drained.
  - 574: imports are capped at 1 MB.
- Left as notes: the modal's focus trap, the car box against the rounded corners, variance by the box, the training
  test survivors (575), and the fidelity INFO items (578).
**Custom maps** (Phase 1 and four map modes, built after be5653a on 2026-10-17) were removed before any commit, on the
user's scope cut that night ("just custom training packs for now"): the engine is be5653a's again but for custom
training's three WASM bindings (`setGoalScoring`, `hideBall`, `sibling`). notes/workshop-maps.md stays as research.
**The browser tests' servers** start from `client/e2e/servers.ts` (Playwright's globalSetup), not its webServer: here a
connection to a closed 127.0.0.1 port is dropped, not refused, and Playwright's pre-check of each server's URL waited
2 min 14 s per server (9 of the suite's 12 minutes).
**The specs that search run against the real services** (design 4, 2026-10-23): Playwright's "services" project
(`client/e2e/services/`: queue, queueEdges, regions) against three Docker Compose stacks (`stacks.ts`,
`stack/compose.yaml`), one per spec group, each Postgres (in memory, no port), the one-shot migrate, the accounts
service (`carball-api-e2e`: the `e2e` build tag's `POST /api/e2e/sign-in`, run `serve --dev` for the http localhost
origin and no Turnstile), one or two game servers in real queue mode (`carball-game-e2e`: the cargo feature `e2e`, the
test hooks and a plain-http `API_URL`), the web image, and an nginx edge putting the page and `/api/` on one origin (as
the tunnel does). Its setup builds the images from the working tree (`scripts/build_images.sh --worktree --e2e e2e`;
`CARBALL_E2E_IMAGES=TAG` skips it) and makes the stacks' secrets and a self-signed localhost certificate; Chrome takes
it by `--origin-to-force-quic-on` plus `--ignore-certificate-errors-spki-list` (`services/fixtures.ts`: the Q1 probe
showed WebTransport honours them; no certHash in config.json). Ports 14460..14468 and subnets 10.211.80-82.0/24, all on
127.0.0.1; each stack's logs land in `client/test-results/services/<stack>.log` and its teardown runs `down -v`. The
release images carry no hook: the checks stage greps both release binaries for the e2e markers.

## Earlier (2026-10-08)
- **Where:** the repository is on the data drive, `/mnt/primary/home/arch/rocket-league-reverse-engineering`, the
  same path from Arch and WSL. `engine/build` and `engine/build-wasm` were rebuilt at this path (the old ones are
  renamed `*-old-documents-path`, and `engine/build-wsl`, `engine/build-wasm-wsl` are leftovers: all can be deleted).
  `~/Documents/rocket-league-reverse-engineering` on the Arch NVMe is an old backup.
- **Live game (Windows, WSL) works:** `tools/physlog/run_wsl.sh SCENARIO...` plays scenarios in freeplay over rcon,
  copies the recordings (and their `_bullet.csv`) to `out/live/` and validates them (`tools/physlog/README.md`
  "Driving it from WSL": game windowed on the second monitor, never focused by scripts; rcon whitelist, which
  includes `plugin`, so `plugin unload physlog` / build / `plugin load physlog` works from WSL).
- **PhysLog reads the game's own Bullet objects** (`_bullet.csv`: shapes, body words, every contact manifold of the
  car and the ball each tick) through the static session's pointer chain; `live_validate --contacts A-B` prints the
  game's manifolds under ours. Offsets are for the 2026-10-06 build. Use it first when a contact question comes up.
- **State (findings 27–44, engine patches 45–71):** every live recording is exact or nearly so, per tick: `jumps`,
  `flip_cancel`, `body_drops`, `steer`, `air`, `powerslide`, `ball_roof`, `dodge_fast`, `wheel_ball`, `car_car2`,
  `ga_boost`, `ga_jump`, `ga_throttle` ≤ 0.14 uu/s; `ball_5050` (50/50s, kickoff, pinch) cars 0.028, ball 0.020; `car_car`
  0.00014 / bot 0.010 (patches 97/98, 2026-10-10: the wheel order and the rotators; were 0.43 / 3.0). Earlier: the car components against the static session's audit (GA-1 boost sets the input throttle,
  GA-2 jump re-press, GA-3 auto-flip, GA-4 throttle deadzone, GA-7 dodge direction, GA-8 air throttle timing:
  patches 57–62, replays 1,745 better / 474 worse), car–car demolitions both ways and the strict bump cooldown
  (GA-15/16, patches 65/66), the arena as the game's 16 pieces (56), the GJK wheel-ray cast (55), Bullet 2.82's
  manifold solve order, edge info and tree quantization (69–71), and the current game's respawn spot selection
  (64: steer left/right while demolished, locked 0.5 s before the respawn; deterministic, in snapshots and the
  network state) plus the flip reset counter (68). `live_validate` fixes: the "2.71 uu/s teleport artifact"
  was stale wheel normals after a placement (finding 43).
- **RocketSim's own code against the exe (2026-10-08, engine patches 82–89, validation finding 50):** the static
  session's audit `notes/rocketsim-audit.md` (RS-1 to RS-12) adopted: exact hitbox constants, wall friction 0.707, the
  game's pad heights and the four moved pads, deterministic maths in respawns and the goal explosion, the speed cap in
  the game's read-back, the BVH's stackless walk, the world contact rebuilt from the manifolds, and the inertia
  tensor kept through the rounding and placements (in snapshots and the network state: format 8, protocol 8;
  `CarState::refreshInertia` for placements with no pose before, as the validators'). Validate with the live
  recordings per tick and the replays: continuous wall runs flip at contact thresholds (finding 50). Left: RS-6
  (broadphase: plane AABB sign bug, island/sleep risks), RS-8/RS-9 (edge cases), RS-12's walls_021027 t125
  per-wheel error (needs per-wheel PhysLog columns and a re-recording), and whether the game's own teleports keep the
  stale tensor.
- **The user's "feel" round (2026-10-08), the static session's specs:**
  - **Done:** the client loop (`notes/client-loop-timing.md`: the f32 accumulator, 5 ticks a frame at most, the
    dilated and clamped frame time, the jump latch, lost button taps, released axis keys; LT-2..6, 8); the goal
    sequence (`notes/camera-respawn-goal.md` §3: the slow motion on the server's ticks and every client's clock,
    protocol 9's goal replay with the client playing its own recording through the LiveReplay camera, skip votes,
    auto-skip, the kickoff camera cut, fades; freeplay's 3.0 game s; GS-1..10, 12..14, 16); the respawn cameras
    (CAM-20..29) and free look (CAM-10..18: per-input camera settings, the Modern preset for new profiles, old saved
    settings migrated with free look off, Pointer Lock mouse, the device owner by key and button events).
  - **Left:** GS-11 (the scorer view) and CAM-19 (remote free look, for spectators) not needed yet; the replay's own
    sounds wait for the sound spec.
  - **Specs waiting (not started):** `notes/visual-timing.md` (VT-2..30), `notes/sound-behaviour.md` (SND-1..17),
    `notes/hud-menus.md` (HUD-1..16, MENU-1..11), `notes/arena-visuals.md` (HEX-1..4: the lower glass's hex tiling,
    18 columns per 576 uu panel; AV-1..22, and the shader formulas H-1..11 the user released), `notes/bots.md`
    (BOT-1..32: a behaviour-tree interpreter on the server). Shader-derived values may be used as values and formulas
    only (the user's condition); the unpacked caches, the decoder and exported assets stay local.
  - **Car paint (`notes/car-paint.md`):** done for both models: the game's team paint (linear), the Glossy finish
    (paint × 0.734, clear coat), the rubber trim, the lights' colours; on the dev server the static session's painted
    Fennec per team (`fennec_body_painted_*.glb`). Not done: the windows' environment reflection, the chassis boost
    glow (PNT-12).
  - **Reviews:** the static session reviews committed snapshots only (RV-n findings); tell it "ready for review: <ids>
    @ <commit>" once the user has committed. RV-1..22 committed (354e481, 505b41a); RV-23..25, 27..33, 36, 37 and the
    event-list test gaps in 2f7dd07, with visual timing part 2.
    The final freeplay rule (`notes/camera-respawn-goal.md` "Freeplay after a goal", 2026-10-09) is in 2f7dd07:
    RV-26 (released after 2 ticks), RV-38 (no scored message; either net scores for the player), RV-39 (the session's
    kickoff spots S[k mod 10], engine patch 90; the ball from z 100.49, held one tick, then it bounces (RV-57); pads reset twice),
    RV-40 (no pad pickup at full boost, engine patch 91: matches too), RV-41 (freeplay's nets are TeamNum 1: the
    explosion in the player's colour, the replay camera on a team-1 net's side), Backspace's 1.0 game s cooldown,
    Unlimited boost (freeplay's default), and the goal replay in freeplay unless "Skip goal replays" is on (Q-1: the
    user's in-game setting is on, hence no replay seen; no freeplay special case). Committed in 2f7dd07; its reviews
    (RV-42..70) and the live sitting's follow-ups are in f8b7e2c: RV-54 (the free-look rate reset when the car
    cam ends), RV-55 (engine patch 92: a jump held through a countdown doesn't fire), RV-56 (patch 91 withdrawn:
    BoostPadGrid already skips full cars), RV-57 (the freeplay ball held a tick, then it bounces: validation finding
    51), RV-58 (sky domes inside the far plane, every theme tested), RV-42..53 (particles: local-space exhaust, the
    Fennec's per-socket trail size and spawn rate, the smoke materials' grey fade, unclamped additive intensity, the
    data's own curve knots, cube-biased directions, teleports not filled, a demolished car's puffs killed, dual
    exhausts always, the cone's delay, online demolitions and the goal explosion from the server's events; table tests
    against the local fx JSONs), RV-59..70 (stadium: glow sheets on the wall line, textures decoded from sRGB, the
    glass's ENVPack colour as a radial statistic, crossed beam quads, metal goal floors, the goal-side glass polygon and
    UVs, the net's UV axes, the overlay's charts and extent, FullBright quantised, the sky's sun-side pull). Left:
    RV-52c (spark collision), RV-64's single global tone map (with AV-21's bloom), RV-68's directional fog (nothing in
    the stadium is beyond 10240 uu yet), RV-70g. Left: RV-16
    (the tail lights' brake glow: needs a brake signal), RV-18 (the masks' zero alpha: only off Chrome), RV-34/35 (HUD).
  - **Visual timing part 2 (done, 2f7dd07):** particles (`client/src/render/particles.ts`, `effects.ts`) with the
    game's emitter values: the boost trail by distance and the idle exhaust, the goal explosion (no ribbons), a
    demolition from the static session's export (`client/src/render/demolition.ts`: every emitter's values, the spark
    streams from 8 moving sources, the flipbooks' colour, size and fade measured as values, "BOOM!", the husks as
    Cascade mesh particles: their motion matches the export's simulation, rest distance p50 834 vs 842 uu; colliding
    only within 1000 uu of the camera; the game's husk meshes on the dev server); camera shakes
    (`notes/camera-shakes.md`, `client/src/camera/shake.ts`) off by default (the Modern preset), on with Default. Left:
    the ball-hit sparks (the impact triggers give their moments: no impact particle yet), pickup bursts, wheel dust, the ball
    trail, the explosion's ribbons.
  - **Arena visuals (in progress, committed through 02cf5c4; `notes/arena-visuals.md`):** a `stadium` theme (`?theme=stadium`, not
    the default) with the game's arena materials, switched on by the theme's `walls.game`: cage beams per H-8/H-8b
    (additive, 8 uu, the scan stripes and contracting rings from the measured Curve_Fire/Smoke profiles, the
    shockwave from the goal explosion: `ArenaView.explode()` / `newBall()`), the wall overlay per H-9 (the ball
    tracker is CS_FX Hexagons_Pack_01_T, the static session's answer), the lower glass per H-6 beside the goal mouths
    and as the nets (replacing the cage cells carried down there, for this theme only), glow sheets per H-5, the
    teams' linear primaries and FullBright (AV-2), the sky (H-10), sun and fog (AV-17..19). The hex textures are a
    procedural grid fitted to the game's (offset (0, 0.25), across flats / edge 1.5) with 32-step channel profiles
    measured by `scripts/hex_profile.py` (values only). Next: the floor regions (AV-5), markings (H-2), panels (H-3),
    frames (H-4), generators (H-7), the advert band and grate (AV-10, H-11), goal floors as metal (AV-13), tone mapping
    and bloom (AV-21); then ask the user whether `stadium` becomes the default.
  - **Live sitting 2026-10-09 (validation finding 51):** the per-wheel/per-contact PhysLog columns recorded
    (`walls_goal_wheels`: three nose-contact ticks a facet's point a tick apart: ill-conditioned GJK, flipped by
    ulps), Takumi +5.00 / Scarab +7.00 uu spawn offsets, the freeplay ball bouncing (RV-57). Then (f8b7e2c):
    engine patches 93 (the Octane box's exact floats) and 94 (the GJK distance sum's order), `live_validate`'s
    rotation as the game's write-back, its `--jitter` indeterminate ticks (on by default) and its opt-in `--meshes`
    for a local copy of the game's cooked meshes (the user's decision: exactness checks only, never committed or
    shipped; `out/arena_local/cooked_meshes2` is that copy with the goal halves' body offsets). The 72 live
    recordings: better or the same; the replay validation unchanged. Committed in f8b7e2c (reviewed: all fixed).
  - **In 02cf5c4 (bee7a7c amended by the user to drop RV-99's game data; reviewed: RV-94..99 fixed):** the goal halves' body origins as the game's (README row 95, validation finding
    52: on the cooked meshes, now `out/arena_local/cooked_meshes3`, every walls tick matches); every preset's exact box
    (RV-88); the countdown keeping the real input over a multi-tick Step (RV-93); `live_validate`'s jitter reworked
    (RV-91); PhysLog's bounded lines (RV-94). Client: the stadium's field (`render/stadiumField.ts`); review fixes RV-72..75, 79, 81, 82, 84, 85,
    87, 90, 92.
  - **Field shapes (the user's decision, 2026-10-09):** shapes traced from the game's meshes are local only.
    `scripts/field_plan.py` (committed: reads local data, contains none) writes them to
    `out/bsim/assets_local/arena/field_plan.json` (git-ignored); the dev server serves it at /local-assets/ and the client
    draws it when present (`loadGameFieldPlan`; `?field=rules` to compare). Builds and fresh clones draw the plan built
    from measurements and rules in `render/stadiumFieldRules.ts` (`FIELD_MEASURES`, `shippableFieldPlan`): the regions,
    markings, frame lines, goal glows and the glass beside each goal. Statistics (the lightmap tables, `FIELD_LIGHT`;
    `--light` regenerates them) ship. RV-71: the user chose (c), our own smooth environment (`ENV_GLSL`: each ring's
    mean and spread, one smooth cosine).
  - **Known e2e flake:** `e2e/online.spec.ts` "a goal: the game slows down ..." can miss its 8-frame tolerance between
    the goal's frame and the explosion's under load (seen once at 9 in a full run; 3 of 3 alone pass). Software
    rendering stalls shift the server tick to client frame mapping; it's the default theme, unaffected by the stadium.
    `e2e/freeplay.spec.ts` "freeplay loads, drives and resets" missed its reset once under load (Backspace inside its
    1.0 game s cooldown: the slowed game hadn't run a second since the spawn); it now presses again until it takes.
  - **Also in 02cf5c4:** the arena's reflection capture (`render/grassCube.ts`: GrassCube, once before the first frame,
    `Renderer.beforeNextFrame`); the field's materials as the game's (H-1, H-3, H-4, Reflective_Floor_B; baked light
    only: each piece's lightmap statistics from the static session, `FIELD_LIGHT`; the frame's glowing (E) and
    team-coloured (D) lines traced from FrameTexture_PACK's stripes through the meshes' UVs); the goals' glows (RV-77:
    `GOAL_GLOW` ribbons) and see-through layered floors (RV-76: `render/goalInterior.ts`); RV-83's data and shake
    tests; RV-86's soft particles (the floor as the scene behind). RV-71 since settled ((c), above); the markings' light
    and the surroundings spec (`notes/arena-surroundings.md`, SUR-1..44) have arrived.
  - **Also in 02cf5c4:** the surroundings (`render/themes/stadiumSurroundings.ts`: GrassCube as the game's capture,
    the hotspots, the stands from tier rules, the structures as low-order fits, the crowd, screens, props, the far
    layer), RV-94..98 (wasm smoketest path, the child origin's bits, PhysLog's SafeRead and `origin_bu`,
    `live_validate`'s option values, docs), RV-99 (the shipped-data guard, `render/shippedData.test.ts`).
  - **In a1ab6a0, the static session's RV-100..132:**
    - field and goals: the grass's reflection as H-1's (RV-100) and its light by x and |y| (RV-105a); the centre disc
      and trims to the game's radii (RV-102); RV-103a, c, d (the centre arc's legs, 16.3 hatch bars, the strip's flat
      end; b, e, f wait on extents from the static session); OOBFloor under each goal, a hex slope in its own light
      (RV-104); the tire-mark factors on the frames (RV-105b); the vent baked-only (RV-106); the goal glows (RV-108,
      and `field_plan.py` pairs free edges within a piece); the overlay's corner charts (RV-109); the net's charts
      (RV-110); the goal floor's opaque strips and lower glass chart (RV-111);
    - online: the client predicts no demolitions (`World.setDemolitions(false)`, a new engine binding: the server's
      alone, as the game's), the drawn and recorded demolished state the server's (RV-112);
    - RV-113: the particle constant and comment, the far-plane test over each theme's animation (the city's
      searchlights shortened), BOOM soft against the floor, value tests (envG's rings, the sky's v and q);
    - RV-95: the child origin by the game's chain (x 0.02f x 50f x 0.02f, `Car.cpp`; the same bits);
    - shipped-data guard (RV-114, RV-131): strings and shaders scanned, every number form, transposed pairs and
      triples, the surroundings' meshes (`scripts/reference_vertices.py` exports a local reference to
      `out/arena_local/reference/`), their (r, z) statistics, imported JSON, the bundle; controls built from the local
      data prove each form is caught; it found two copied glow points, now named measures;
    - RV-115..118 (comment, triangle-sampled cage test, `live_validate` value ranges, these notes);
    - surroundings (RV-119..128, 132): the hotspots as the game's ellipses, the +X one unfogged above the horizon, all
      placed inside the dome; the high screens facing down; the crowd's light (HL2 basis, warm); the tiers seated where
      the game's are (per-tier spans, the top tier's rows, the +X ends' cut, the -X corner's section); the -X plaza
      open; the floodlights' bulbs on the middle row; per-placement panel light, the logo at 14 %, two-row TV strips,
      brighter windows, the banners' texture term; ribs to the roof's edge; sunk cards hidden; the bob phase shared.
      The crowd and the screens and props now in `stadiumCrowd.ts` and `stadiumProps.ts`.
  - **In c222307 (since a1ab6a0):**
    - the SUR-35 calibration: the dev arena viewer's `cubeFaces()` (`GrassCube.readCapture`) reads the capture back;
      a script bins it as the game's reflection profile (`reflection_profile.json`, local): RMS luminance 0.148 ->
      0.089 over 180 cells. What moved it: the capture in two passes, the second with a constant cube of the first's
      upper hemisphere's mean (SUR-32's G_env); the apron round the cage and the -X plaza's sidewalk (SUR-4); the +X
      ends' stands starting at their first seated row; the hotspots drawn after the canopy; the +X hotspot's fade
      smoothstep(8, 25). Open with the static session: the corner flags' seen colour, what occludes az 180 below el 7
      (the statue), the grass at grazing (G_env applies or not);
    - `render/themes/stadiumLights.ts`: the team uplight beams and the floodlights' flare sheets (SUR-13), the team
      light bulbs, the canopy's mullions with their light dots, the StadiumFog haze and the near fog sheets (RV-130);
    - the floodlights as the game's 42 fixtures a bank (RV-125: two halves, the v-profile statistic, the lens rows at
      the fixtures);
    - RV-103b, e, f: the goal end's side with its jogs, Goal_Lines' and Field_Side_Lines' open pieces with their hooks,
      stroke rows and clusters, the E trim line's real path (one a quadrant), from the static session's named measures;
    - RV-113: the particle comment (the demolition's draws were right);
    - the -X plaza (RV-133: the plinth, the statue, the poplars as named measures; the roof to az 176, low city beyond)
      and the corner flags (five poles a corner on r 6185, banners with their strips, the static session's measures);
    - the capture in three passes (the game re-captures over its first 2 s), calibrated against CAL1's corrected
      profile: RMS 0.082;
    - RV-141..146: the centre arc's legs and downs with rounded joins (raster IoU 0.928 against Field_Center_Lines,
      local), the advert strip's second bar and Glass_Outer's V, the goal glows as two loops (round the mouth on the back
      wall, and the field side's round the mouth piece's front: lines and fillets, every traced point within 10 uu),
      the low beside-glow's profile, H-4's tire marks inside the saturate, OOBFloor's slope-only light and the bevels'
      own, the grass light's bins on 256's;
    - RV-109/110: the overlays' charts (the 45-degree diagonal the back walls' u, the diagonal corners' top fillet row
      the roof's) within 0.028 UV of FF_Goal/Side/Roof at every vertex, the net side walls within 0.0033 (local tests);
    - RV-138..140: the shipping guard by stride (1-8, every phase), with UV rows and per-azimuth columns matched in
      order, (az, value) pairs, the crowd tiers, decimals without trailing zeros, written integers (index lists), the
      cage topology's own index arrays blanked (it's pinned as topology), JSON through the build's aliases, dist's HTML
      and CSS; controls for every form in the static session's battery (scripts/reference_vertices.py writes the local
      reference);
    - RV-148: the shaders' functions as exported GLSL (overlayUv, netSideUv, underGlassV, grassReflection, envG), run on
      the GPU against their TypeScript twins (`?viewer=shaders`, e2e `shaders.spec.ts`); engine test for RV-95's chain at
      a 10/20 uu offset;
    - the boost pads' taken look: the dim mix tested USE_INSTANCING_COLOR in the fragment shader, which three defines
      only for the vertex shader (the fragment's is USE_COLOR), so taken pads drew lit; now a GPU render check (taken =
      the dim reference, under half the lit). A full car takes no pad (CanPickup: !IsFull), freeplay's Unlimited too;
    - "Unlimited boost in free play" (MENU-9) in the settings' Gameplay tab (RV-169), on by default as the game's: off, the tank
      at a round's 33 (BOOST_SPAWN_AMOUNT), drained by boosting, pads taken (engine setUnlimitedBoost; turning it off
      mid-session sets the tank to 33 at once). e2e: on, a full car leaves the pad; off via the panel, the pad is taken
      (+12) and its pixels go dark.
    - the post-processing (notes/post-processing.md PP-1..20; `render/postProcess.ts`): the scene linear HDR into a
      half-float target, the depth of field's soft layer (0.25 everywhere, to 0.6 far off), the bloom (soft knee from 2,
      the three Gaussian sizes by the game's tap rule), then the tone map and the 16-node remap to display values (no
      three.js tone mapping or sRGB encode; no anti-aliasing, the game's default); a 1 s fade-in from black. The
      per-material 1 - exp(-c) curves are gone (RV-64), the translucent blends linear (RV-107). Video tab: Bloom, Depth
      of Field (on). Tests: the twins against the spec's tables and taps; on the GPU the GLSL against the twins, a
      uniform grey through the whole chain at its display value, bloom only with Bloom on;
    - the sky in full (H-10 detail, `themes/stadiumSky.ts`): the clouds and stars on our own noises (made at load from
      the textures' quantiles, correlations, feature sizes and neighbour correlation; stored 8-bit sRGB, mipmapped, as
      the game's), each elevation band's mean within 15 % of the game's sky (tested). The capture's zenith stays 0.01:
      its 256 mips average the sub-texel stars, where the static session's profile samples them full-res.
    Left: RV-129 (with SUR-24's fog constants), trees (SUR-11), the far fog sheets and the searchlights; motion blur,
    SSAO, sun shafts and lens flares (PP-11..14).
    - the impact triggers' engine half (engine patch 96, notes/impact-triggers.md IT-1..3): per step, each car's
      contacts with each partner averaged as the game's (the solver setup's point velocities kept on btManifoldPoint),
      the line check's normal, speed |dv . n| (50 or more kept); `takeImpacts` (collection on in the browser engine
      only: the server and tools don't take them; capped); each wheel's ray-hit normal in the car state for the landing
      trigger (IT-5). Tests: TestImpacts (native and WASM).
  - **Since c222307 (uncommitted):** the impact triggers' client half (`game/impactTriggers.ts`): the local car's
    Impact_Medium shake (restarted by every hit over 200 uu/s, scaled by the curve), the sparks' and body sound's gate (50
    uu/s, 0.15 s game-time cooldowns per world/actor slot; car–ball sounds the ball's Impact_Ball on its own cooldown;
    car–car one side, the larger index [I]), the landings per wheel per frame (the previous frame's chassis velocity at
    the hard point along the ray-hit normal, over 50; every car, no cooldown); re-simulated ticks skipped online. They
    replace audio/detect.ts's guessed impacts, landings, bumps and car–ball hits (the ball's bounces off the arena stay
    guessed). Sparks aren't drawn yet (no impact particle). The sky's noise is made once (memoised, ~0.5 s).
    The engine's review fixes RV-162..166 (native and WASM 3256/0). The client's review fixes RV-149..161, 167..169:
    hotspots' tilt to the line of sight; banners and corner flags lit per placement (flags as rotations, poles beside
    the cloth, a two-tone cloth so the capture's per-pixel clip matches CAL1); supports onto their ring past 145 (no
    rib at 173); aisles 576 uu wide through all rows; the plaza (wider plinth, the statue as its outline seen from C,
    spindle poplars, the city by rule from az 180.5); 26 team beams at the game's mean alpha; the camera fade folded
    into the remap's nodes before their clip (the replay's fade now drawn there, not by a CSS overlay); the sky's
    noise to the textures' correlations (~0.4 s); the goal floor's trim strip and V offset; the field glow loop from
    its own measures; a Gameplay settings tab. The shipped-data guard: every import form scanned (glob, ?raw, ?url,
    import(), new URL), the arena's .cmf pinned to out/arena, exponent forms, signed UV pairs, strides to 16, small
    integers on longer runs, and a texture check against `out/arena_local/reference/textures.f32`
    (scripts/reference_textures.py: rows along one stream place, bending; ramps are profiles and allowed).
  - **In 674f3ef:** all of the above. **Since 674f3ef (uncommitted):** the plaza statue as a rule (CAL1's bbox, its
    width 220 -> 600 up it, fitted to the coverage statistics; RV-154c: az 181's first open sky only a plausibility
    range, ruled), the large poplar back to 1800 (named measures aren't tuned to tests), the poplars' cover 41.6 %; the
    exe's height fog (notes/arena-surroundings.md FOG-1..15: `client/src/render/heightFog.ts`): three's fog off in the
    stadium, every theme material fogged by `fogAll` (opaque per pixel, translucent/additive per vertex, the sky at
    the game's dome's distance, the far layer's city at 100k and its FogCylinder band at 57.3k, the hotspots at their
    game distances; the capture's faces capped at 31,887 uu of view depth), the GLSL checked against the TS twin on the
    GPU (`?viewer=shaders`: heightFog, heightFogCapture; a series where float32 cancels at level sight lines).
    WIP, untracked: `game/quickChat.ts` and `ui/chatLog.ts` (+ tests): the presets, slots, menu, spam bucket, log format.
    Next: post-processing part 2 (notes/post-processing.md PP-21..32: the render split opaque -> AO -> translucent,
    SSAO, shafts, flares, motion blur; the cube blur after the static session's capture recompute), quick chat's wiring
    (protocol, server bucket and relay, input, settings), match stats (STAT-1..24), custom training, mutators, the
    match intro/outro (its text cleared verbatim) and the car's look (notes/car-paint.md PNT-16..33).
  - **In a620b27:** all of the above but the quick chat WIP. **Since a620b27 (uncommitted):** the capture's chain as the
    exe's (SUR-32 CAP1, `render/cubeChain.ts`): a half-float raw cube, per face a 4x4 box to 64², the 9-tap Gaussian with
    a weight channel, bilinear back to 256², the 8-bit gamma-1/2.2 store decoded; the materials sample its level 0. The
    capture's light layers as the game's: six fog sheets and the hotspots as Circle_Sprite hexagons (vertex fog at their
    true vertices), the fog bowl (FogHemisphere_V2), the haze shell in 500 uu rows, the 24 team beams at their list
    positions; the near fog sheets drawn first among the translucents (they popped with the view's turn, sorted against
    the layers at the origin). The far layer and the three far fog sheets as background: blended in the opaque pass
    right after the sky's dome (renderOrder -0.75, -0.5), so whatever is nearer covers them wherever they're drawn; the
    far sheets placed so their whole hexagon stays inside the camera's far plane from anywhere in the playing volume
    (`fogSheetPlace`; at 29k their corners reached 65k, cut by the far plane). The theme test's playing-volume margin
    takes a mesh's own `clearance` (the corner beams stand at the game's placements, 64 uu past the side walls). The ball's impacts from the engine (`IMPACT_BALL`, the binding's -1; the client's
    `BALL_IMPACT`: its bounce sound, no heuristic left in audio/detect.ts); RocketSim's broadphase re-registering a body
    on every setAabb (an RL PATCH: a car went through a resting ball). Review fixes RV-170..196 (RV-170's solver revert;
    banners with the capture's 0.5 cube term; the flag sleeve; aisles 216/360; nine poplars; the ring band; the sky's
    smoke given its green-blue correlation directly; the GLSL built-in shadowing test; template-literal imports in the
    guard), and the guard's RV-182/183 forms: the static session's cached textures (the logo, the city's, the lightmaps)
    in the reference, 12/24/48 px, reversed rows, hex literals, hex and base64 strings, percent, 4-bit levels, masks
    touching 0 and 255, low-contrast rows to 4 decimals (each with a control the check alone catches:
    `out/arena_local/reference/texture_controls.json`). The dev arena viewer's `recapture(hide)` re-captures with named
    objects hidden (what each part brings to the capture).
  - **In 3314a85:** all of the above. **Since 3314a85 (uncommitted): the arena's finish line** (the user, 2026-10-10:
    no new arena work after it unless asked; post-processing part 2 deferred). The capture calibration (the user: the
    stadium too bright and glossy) against SUR-35 v2, the in-order profile with the painted vertex colours (confirmed by
    the user's screenshot): all 180 ldr cells within 0.1 (`e2e/capture.spec.ts` bins the capture against it). What it
    took: the game's translucent sort (`render/translucentSort.ts`: TranslucencySortPriority as renderOrder, then the
    view-space depth of the bounds origin, every view; the stadium's and the arena's priorities, each goal's pieces their
    own meshes and bounds); every hotspot and fog layer in its painted vertex colour (OverrideVertexColors: the team
    glows were 17.5x too bright); the far city opaque with the depth of its 100k (it hides _13 below el 3); sprites drawn
    nearer given their true depth (`withTrueDepth`); the FogCylinder as the game's 16-triangle mesh with per-vertex fog;
    the far fog sheets and the band re-placed about each view's camera (`drawnNearer`, RV-198); the wall's foot as the
    game's frame (Side_Trim, H-4: `SideTrimMaterial`). The arena's last pieces: the canopy as the game's 8 panels
    (one-sided) and 8 fins (two-sided) a side, an open wedge over each end (`stadiumCanopy.ts`); the roof arch's 49
    flags by the game's rule in our own designs matched to the atlas's statistics, their baked light and wind
    (`stadiumFlags.ts`); the far layer in its own module (`stadiumFarLayer.ts`). Engine: the static session's CCR patch
    (README rows 97/98: the wheel order, the rotators; `car_car` exact), the goal explosion's KNB-5..7, 9 (row 77:
    between ticks, the lagged Location, the ball a tick back, the cylinder box), the broadphase row 99. Server: NET-2
    (a jump tap kept through a double consume; `rl_car_repress_jump`). Review fixes RV-197..205, 208..213, 215 (the impact's
    line check against the static world only: a car partner keeps the averaged normal, a ball the radial one; RV-206
    closed with no change, the game checks no line against a car; RV-207, the goalpost sound switch, queued with the gameplay work; RV-214 a known limit: the dist check
    runs at each batch). The guard: three.js in its own chunk (`three-*`), coarse forms as lists only, 2-decimal
    fractions and unrounded means, the LMP lightmaps and TireMarks in the reference. Note: the user's game runs World
    Detail "Performance" (DetailMode 0), which hides the canopy, the FogCylinder, the haze, most fog sheets, the
    poplars and banners: compare screenshots at "High Quality".
    Next (the user's order): MR-6/7 (post-goal slow motion, replay, forfeits), quick chat, match stats and the
    scoreboard, the match intro and outro, the HUD and menus, mutators, custom training, bots.
  - **In 1352c01:** all of the above. **Since 1352c01 (uncommitted): MR-6/7** (`notes/match-rules-audit.md` §7, its
    status list).
    - Protocol 10:
      - Messages: `0x05 VoteForfeit`; `0x87 ForfeitVote`, each player's view of their team's vote.
      - Match flags: 8 (votes allowed now), 16 (no contest).
      - Hello's `key`: a per-tab random key in sessionStorage, so the vote lockout survives a reconnect.
      - Welcome: the match type and team size. Event kind 2: a leaver's car.
    - Server: per-team forfeit votes (20 game s, unanimous, 5 s linger) with the initiator lockout enforced on the
      server.
      - Forfeits: after a goal one waits for the next round; a team emptied by a leave forfeits 2 ticks later (casual,
        ranked); everyone gone is a no contest.
      - (A game-clock jitter-buffer sizing here was reverted in the next batch, RV-238: the client sends at 60 Hz of real
        time, and the game's buffer is on real time.)
      - Options: `--match-type casual|ranked|private` and `--forfeit-vote-wait SECONDS`.
    - Client:
      - The Escape menu's match buttons (`ui/matchMenu.ts`, `game/forfeitVote.ts`): vote or forfeit, and leave (back
        to freeplay), with the game's verbatim text and confirms.
      - The HUD's vote widget; the leaver's explosion (effect, shake, sound).
      - The replay prompt is now "Press Space to Skip" (the names list waits for player names); the auto-skip setting
        uses the game's text.
    - e2e: `forfeit.spec.ts` runs on a fourth server (14437/14438: 2v2, votes once the clock runs).
    - Also in this batch: RV-211a's sliding test (an accepted limit) and the banner taper (FLG1 follow-up).
    - The 1352c01 engine/server review, RV-216..224:
      - RV-216: the buffer's jump edges are the car's. After a tap's jump, a press the next tick is fresh.
      - RV-217: a car respawning during the goal's wave refreshes its start-of-tick state (`Car::_CaptureOldState`).
      - RV-218, RV-220, RV-224: tightened tests and comments.
      - RV-219: the repress's tests, engine- and game-level.
      - RV-221: `TestImpactSurfaceNormal`, the line check on the goal's faceted ramp.
      - RV-222: README row 96.
      - RV-223: determinism, rollback and netstate let each goal's wave play 0.5 s before the reset. That found a
        snapshot bug: a restore didn't recreate a disabled body's manifold (the exploded ball, a demolished car);
        fixed in `_DeserializeContacts`.
      - Determinism (end-of-run snapshot hash, native = WASM): 300 s 503626639f483e87, 600 s 8af19f76ef2906dd (were
        9f0d343981fca7d3 / 9dc05285014113cb before the wave played).
    - The 1352c01 client review, RV-225..230, and RV-231:
      - RV-225: the guard exempts three.js's chunk by its modules, not its name. The build records each output
        file's modules in `client/node_modules/.cache/rl-chunk-modules.json` (vite.config.ts `chunkModules`, outside
        dist); `public/` is scanned too.
      - RV-226: the corner flags' ray sweep gets a 30 s timeout.
      - RV-227: tests for the fog's `world` place and the place in the program key.
      - RV-228: a tie control, .5 box means rounded half up (`reference_textures.py` `tie_row`, the local
        texture_controls.json's `ties`).
      - RV-229: the arena module list is built from names.
      - RV-230: `codeSplitting` replaces the deprecated `advancedChunks`.
      - RV-231 (engine): a goal push's velocities are read back at once, capped and quantised
        (`Quantize::QuantizeVelocities`).
    - Connection: control messages before the game listens are queued (`Connection.listen`). The initial match
      state and vote state were being dropped. A closed tab closes its session (`pagehide`).
  - **In 5acdfe3:** all of the above. **Since 5acdfe3 (uncommitted): the demolition sweep as the game's (static
    analysis DSW1, RV-232..234; README row 33).**
    - The start-of-tick state is the game's read-back (`Car::_CaptureOldState`): the location rounded to 0.01 uu and the
      velocities quantised, in uu; the quantised quaternion (`_oldQuat`); for the rotators, UE's matrix of it.
    - The sweep (`Arena::SweepToImpact`, public with `DemoConeAtImpact`) uses the game's arithmetic: the inputs as L and
      V × 0.02 and the quaternion, the location lerp, UE3 `SlerpQuat` and `FQuatRotationTranslationMatrix`
      (`GameRotator.h`). The penetration solver is Bullet 2.82's (`SweepGjkEpa282.h/.cpp`: a namespaced copy of 3.24's
      btGjkEpa2 with 2.82's 64 EPA vertices and single-guess `calcPenDepth`; the sweep only).
    - Tests: `TestDemoSweep` (six DSW1 cases, bit for bit; case 4828 pins the impact's UE matrix),
      `TestOldStateReadBack`, `TestUEQuatRotMat`.
    - Replays (5acdfe3 vs this): neutral. The main summary is identical, car–car 0 flips in 5,012 cases (37 differ in
      the last printed digit).
    - Determinism: the 300 s snapshot hash is unchanged (503626639f483e87); the 600 s one is now bc8e55a507fb5c58, with
      the per-second state hashes unchanged but seconds 81 and 349 (mid goal-wave: the push's lever now uses the quantised
      location; each kickoff reset erases the difference), native = WASM. The snapshot carries each car's ball-hit record, whose
      `extraHitVel` comes from the start-of-tick velocity and forward, now the exact read-back values: its low bits
      moved, while the ball's velocity, quantised each tick, didn't. (`_oldQuat` isn't serialized: each tick recaptures
      it.)
    - README: the stale Quantization note is gone, the demo sweep note updated, row 33 has the live addresses.
  - **In f9a553d:** all of the above. **Since f9a553d (uncommitted): quick chat** (`notes/quick-chat.md`, its status).
    - Protocol 11: Hello's name; `QuickChat`, `ChatFilter`, `Roster`, `Chat`, `ChatBlocked`; a leave's `lost`.
    - Server: names (tidied; "Player N"), the roster, the spam bucket and both sides' filters, the relay with the
      clock's shown seconds; a timed-out session is "lost connection".
    - Client:
      - `game/quickChat.ts` (presets, slots, the menu, the bucket's twin) and `ui/chatLog.ts` (the log and the panel)
        wired into `online.ts`.
      - Settings: a Chat tab (name, filter, non-tactical block, slots) and the four quick-chat bindings.
      - Audio: the chat line's sound.
  - **In 7160837:** all of the above. **In 0e3f857: the 5acdfe3/f9a553d review, RV-235..246, protocol 12.**
    - RV-235: a leaver's car explodes only when it's there (`Left`'s `explode`: not demolished, not in the replay).
    - RV-236: the menu's one match button (the vote or leaving; red while a vote runs; labels upper-case).
    - RV-237: the vote widget's bar is yes/required with a flash; it stays through the linger, with no fade-in.
    - RV-238: the jitter buffer back on real time.
    - RV-239: keys are the server's (Welcome's `key`, Hello's back on reconnect; a duplicated tab gets a new one). The
      initiators are match-wide and only grow; a re-enable clears the per-player flag.
    - RV-240: the guard finds three.js by its package path segment.
    - RV-241: tests for the surviving vote mutants, the control queue and the stored key.
    - RV-242: 16 players a match at most (`Refused`).
    - RV-243: versions are checked before decoding; the vote no longer logs refusals.
    - RV-244: the ball's start-of-tick velocity is its read-back.
    - RV-245: five more sweep cases and the packed-rotation read-back test.
    - RV-246: wording fixes.
    - The leave e2e moved to `online.spec.ts` (that server's votes wait a minute, so its menu shows leaving);
      `e2e/players.ts` holds the shared helpers.
  - **Since 0e3f857 (uncommitted): match stats and the scoreboard (protocol 13), the 7160837 review RV-247..260.**
    - Engine: `engine/stats/StatFactory` (the game's StatFactory_TA, `notes/match-stats.md`): the ball's touch history
      (the 2-frame contact rule, wheel touches every 0.15 s, the merge rule, AttackerPRI for pool shots), first touch,
      ball hits, aerial/bicycle/juggle hits, shots and saves (epic), clears and centres, goals with the scorer, assist,
      own goal, pool shot and the goal modifiers, hat trick/playmaker/savior, demolitions and exterminations, low and
      high fives, post and crossbar hits; PRI counters per car. RocketSim hooks: a tick-end callback, the ball's world
      contacts and start-of-tick location, the car's ball contact point. C API `rl_stats_*`, `rl_take_stat_awards`,
      `rl_car_stats`. Tests: `engine/tests/stats_tests.cpp` (57 checks; 14 mutants caught). Replay check:
      `engine/tools/stats_validate.cpp` with `replay_extract --pri` (notes/validation.md "Match stats against replays").
    - Server: the stats state per phase, awards to `StatEvent` (the receiver) and `Ticker` (everyone), the goal event's
      scorer and assister, `Scoreboard` (counters, pings from the connection's RTT, MVP), Win/Loss and the MVP at the
      match's end (the winning team's best, former members included; none in 1v1), counters reset per match. Mute
      (`0x08`): the server stops relaying the muted player's chat.
    - Client: `game/matchStats.ts` (the stat names verbatim, the popup and feed rules at the Primary level, columns,
      MVPSort, ping bands, the goal banner "{Player} scored!"), `ui/scoreboard.ts` (held Tab / LB, SB-1..11 geometry on
      the 1120 x 720 stage, 0.35 s minimum, fades, the MVP badge's slam), `ui/statFeed.ts` (popups 2.633 s each, the
      feed 6 x 4 s), `ui/statIcons.ts` (our own vector icons after SB-16), `ui/playersMenu.ts` (the menu's player list:
      Mute/Unmute, Block/Unblock and the block's toast; Report left out), the Scoreboard settings tab (4 columns, sorted
      by label, reset).
    - Review RV-247..260: the non-tactical block has no phase; spam notices once a second at most, bounded queues (a
      player not reading is dropped); names lose format/invisible characters, "Player N" is reserved, names render in
      `<bdi>`; "lost connection" from the connection's close reason; the chat log's 8 lines, fade from its alpha, kept
      up in the menu, after the match and with the scoreboard; short pad glyphs in the quick-chat keys; a quick-chat
      slots reset and sorted options; the chat filters in Hello; vectors tied to the version.
    - e2e: the held scoreboard (Tab) and the goal banner in `online.spec.ts`; block, mute and RV-258 in the quick-chat
      test. The multi-page online tests have explicit timeouts and draw their extra players at 640 x 360 (software
      WebGL under the 4-worker load starved a third page); `online.spec.ts` leaves its pages explicitly between tests.
      The menu's header wraps: the match's question and buttons get a row of their own (the Scoreboard tab had pushed
      them off the panel).
    - Not yet: the podium titles (§5.4, with the outro), the stat display level setting (Primary for now), flip resets
      as a stat, the equaliser events (0 points, hidden), CarTouches/BoostPickups/Dodges columns, the private-match
      score mutators.
    - Next (the user's order): the intro and outro, HUD and menus, mutators, custom training, bots.
  - **Since 3645f4c (uncommitted): the match's intro and outro (protocol 14), the podium titles, the 0e3f857 review
    RV-261..272.** Specs: `notes/match-intro-outro.md` (MIO-n, CAM-30/35/36), `notes/match-stats.md` §5.4a (PT1).
    - Server phases: Waiting (a new match's 3 s warm-up, then the countdown), PrePodium (EndGame: 3 s, the world frozen),
      Podium (5.3 s: the winners by MVPSort at the four spots, unlimited boost, the ball hidden, everyone else demolished
      with respawns held), Finished (60 s, frozen; ready-up from 1 s in; everyone ready or the timeout starts the next
      match). A no contest goes straight to Finished. `Match.secondsLeft`, the scoreboard's ready flag. Engine: the
      arena's `frozen` mode (not serialized; ticks still count), `rl_car_place`, `rl_set_unlimited_boost`, `rl_ball_hide`.
    - Podium titles: `engine/stats/PodiumTitles` (the 30 archetypes, GetNumPoints with tracking ⌊base/100⌋, the UCRT
      qsort port, the two greedy passes), `StatFactory::OnMatchEnded` (most/fewest pickups with the 10× rule, ball and
      car touches, the goal records; own goals out), new counters CarTouches (both cars per bump) and BoostPickups
      (the arena's `boostPickups`, not at full boost), the scoring speed (`goalBallSpeed`). The server assigns them at
      EndGame for both teams (join order, blue first), clears them from 4th place on at the podium and sends them in
      the scoreboard entries. Tests: PT1's three examples and the qsort orders in `stats_tests`.
    - Client: `game/matchSequence.ts` (the views and timings, the banner's words, the dimming, the HUD's parts),
      `ui/endOfMatch.ts` (winner banner and its slam, dimming and vignette, podium panels with the titles, the end
      screen's menu: Ready / Exit to Main Menu with its question / Options, the countdown, My Accolades),
      `game/podiumTitles.ts` (the titles verbatim, "N label", ft/s and ft by default), the scoreboard pinned on the end
      screen with the winner stamp and ready checks. Cameras: the joining side view (CAM-30), the held last view and
      the fade to black (CAM-35), the podium dolly (CAM-36), the winners' explosion 0.6 s in; the arena fades in at
      load (MIO-2).
    - Review RV-261..272: the guard exempts three.js by its installed package's real path; the version peeks factored
      and tested with version-11 bytes, `Refused` reason 1; a real-time jitter test with irregular gaps through the
      slow motion; a leaver's car explodes when it's live (not demolished, not a podium loser, not in the goal replay,
      whose start destroys the cars; the client's playback skip is a guard); left
      vectors for flags 1 and 2; a reconnect beside its old session keeps the lockout under a new key; keys of leavers
      pruned at a new match; the vote log once per change; the vote widget's flash (a new vote's first yes too),
      no fade-in and upper-case checked in e2e; match-rules-audit D-2, D-4 and MRL-16 brought up to date; a log line
      and a debug assert for refused joins.
    - Not yet: the waiting-for-players list (MIO-6), the rematch vote (MIO-32), quick actions (MIO-24), the end
      screen's hide-scoreboard toggle (MIO-30), a metric units setting (titles are imperial, the game's default), the
      highlights replay behind the end screen.
  - **In 150e1e6: the in-match HUD and the menus (notes/hud-menus.md), the 3645f4c + b22dc21 review
    RV-273..278.** Text verbatim per the user's decision of 2026-10-14 (HUD messages, menus, Interface and Gameplay
    settings), the strings and their case from the static session's table (notes/hud-menus.md HT-1..HT-10).
    - Stage (HUD-1): `ui/stage.ts`, the content stage with Interface Scale and Display Scale; every HUD layer uses it.
    - Scoreboard (HUD-2/3/4): the clock's black notched box between the team boxes (dark plus the team's colour),
      your team on the left, perspective and tilt, the intro (1 s in: drop, tilt and turn), a team's glow on its goal,
      "OVERTIME" in the clock's slot during overtime's kickoff; hidden in freeplay (training).
    - Boost meter (HUD-5/6/7): 225 degrees clockwise from 6 o'clock, the last 45 white past 80 %, 2.25 degrees a point
      past the first, the number tweened over 0.2 s, the pickup flash, team-coloured or plain, the max look past 80
      (white, full glow, BOOST blinking); hidden in menus, replays and after the match (HUD-16), our flip ring with it.
    - Centre messages (HUD-8/9/10): the kickoff's 3/2/1/GO!, the goal's "{Player} scored!", Overtime!, One Minute
      Remaining!, 30 Seconds Remaining!, the last ten seconds (with a beep); each pops in from 1.4x, lives 4 s and fades
      in 0.3 s; Match Notifications filters them by the game's levels (HT-7: the countdown and the goal essential, the
      clock's and overtime's time updates; their sounds play regardless).
    - Replay banner (HUD-11, HT-6): letterbox bars, the blinking REPLAY, SCORED BY and the scorer (none for an own
      goal), the assist, the round's age at the goal and the ball's speed (KPH/MPH by Metric, on by default) with icons
      of our own, the skip prompt bottom right. Ball-cam indicator (HUD-12) bottom left, its hint empty when held.
    - Nameplates (HUD-13, `ui/nameplates.ts`): over the other cars, the distance and FOV curves times Nameplate Scale
      (the 64 uu tall plate, its bottom 60 uu up: HT-8; the curves' product is [I]), Nearby Only (far) and Simplified
      show the arrow only. Not yet: teammates' plates with their boost.
    - Menus: the pause menu (MENU-4, HT-4, `ui/pauseMenu.ts`: Resume Game, Settings, online the match's buttons and
      the player list, freeplay Exit to Main Menu with its question; Show Controls is the editor's only); the main menu (MENU-1/2, `ui/mainMenu.ts`: Play → Free Play or
      a server to join, Settings) over the arena as freeplay's page opens; Escape handled in one place (main.ts).
      Settings: the Interface tab (scales, nameplates, Match Notifications, Team-Colored Boost Meter, Metric, Ball Cam
      Indicator, Hide In-Game HUD) and the Gameplay tab's Game Stat Display Level and Flip Reset Indicator (Off, Audio,
      Visual, On; the old checkbox migrates).
    - Review RV-273..278: the podium camera frames the spots (not the cars as last seen); a test for the 4th winner's
      titles; leavers' counters out of most/fewest tested; the libraryFiles test runs in CI; the server's hidden
      characters are every Cf; stats_validate resumes the round when the replay is still in play a second after an
      engine-only goal (`ResumeRound`; 60 1v1 replays: goals 100.0 / 99.7, notes/validation.md).
    - Not yet: the centre dot, the ball arrow, the chat input box, the waiting-for-players list, a garage (car choice).
  - **In 6e56234: the 150e1e6 review RV-279..286.** Mutators are dropped (user decision,
    2026-10-14); their spec, notes/mutators.md, is in git history at 674f3ef.
    - RV-279: nameplates follow the goal replay's cars (`ReplayPlayback.cars`), every car's plate.
    - RV-280: the plate's pivot (bottom centre on its point) holds at any scale (`plateTransform`).
    - RV-281: the Interface and Gameplay row labels upper-cased; Gameplay in the game's order (free play's unlimited
      boost first, Skip Goal Replay last).
    - RV-282: the {key} token's own icons for mouse and pad buttons (`ui/keyGlyph.ts`); the replay skip is a binding of
      its own (Skip Replay, Space / A, shares any key: no car drives in a replay).
    - RV-283: the clock's announcements their own sounds (the last ten's tick, the minute's and 30 seconds' calls,
      Overtime!'s).
    - RV-284: Exit to Main Menu in free play stops a goal replay and restarts the session, as does Free Play.
    - RV-285: "Free Play" on the main menu stays as it is (the user, 2026-10-14); RV-286 info, no change.
    - Scope (the user, 2026-10-14): free play and online matches. Custom training, bots and mutators are dropped;
      netcode, hosting and joining come later, after the user has evaluated the game.
  - **Since f6d9a24 (uncommitted): the car's arches flush in its paint, the 9b99b97/f6d9a24 review RV-294..302.**
    - The generated car without its black flares and sill cladding (the user's choice; the side vent stays), its lower
      body the Fennec's full width.
    - RV-294: the guard's local block reads its references when a test asks (`refs()`), not at collection: a checkout
      without out/bsim/assets_local (CI) passes. RV-302: it also catches a bitmap's pixels as RGBA, RGB or alpha alone
      from any pixel of a row (a crop), and decodes shipped images (a crop, a downscale, a re-encoding): any image it
      can't decode fails it.
    - RV-295: a placed car (SetState: a spawn, a kickoff, a respawn, a load) takes its XY lock again where it is
      (`Car::_xyLockMoved`); RV-296: the podium clears a kickoff countdown a forfeit cut short; RV-297: snapshots
      carry pending pins; RV-298: each arena's own anchor body for the locks (`Arena::_xyAnchor`); RV-299: the
      countdown lock's tests; RV-300: the gimbal guard noted (inert: every angular limit free); RV-301: the plate
      texture's test.
  - **In f6d9a24: the generated car in the Fennec's proportions (the user's item 30).** The model
    (`render/carModel.ts`) takes the Fennec's measured scalars (FENNEC: length, width at the fenders, belt, roof, nose
    and tail, heights of the sills, nose, hood, belt and roof, the windscreen's base and rake, the roof's ends, the rear
    window's base, the bumper, the wheels' places and sizes), measured from the local export, set on the hitbox
    (`fennecFrame`: other presets scaled to theirs): narrower and lower than the hitbox (71 by 52 where the hitbox is
    87 by 57 over the ground), tapered at the nose and tail, the cabin narrowing to the roof, the roof to the tail with
    a spoiler's lip, the rear window near upright. Scalars only (the user's 2026-10-09 rule); the styling ours.
  - **In 9b99b97: the HUD's fonts bundled (the user's pick, set B).** Rajdhani SemiBold / Light for
    the header and thin text (the Latin woff2), Orbitron at 500 for the numbers (since RV-489 the upstream static Medium
    OTF, theleagueof/orbitron, as it is: its licence reserves the name, so no subset or conversion), each in
    `client/public/fonts/` with its licence ("Open Font License.markdown" for Orbitron, OFL.txt for Rajdhani); the
    guard pins them by content (`shippedData.test.ts` FONTS). They're loaded, then measured (`loadHudFonts`): sizes
    scaled to the game's capitals and digits as before, and each number glyph's ink stretched to Dashboard Numbers
    Wide's and started where its does in the cell (HT-12's per-glyph ink: the user's "10 0").
    - More of the user's findings: BOOST fades in and out past 80 % (0.2 s each way, GSAP's Power1 out, the tween played
      back; HUD.updateBoost) in its own colour (#666666 + the team tint; without team colours COLOR_BOOST_MAX's salmon),
      only the number turning white (24, 25, 29); the sounds fed through the match's end, frozen cars heard halted (24);
      OVERTIME one 30 px line centred in its field, its baseline at y 37.4 (27); the red dot centred on the label's
      capitals as drawn (the user's decision over HT-12's Flash baseline: 26), `--hud-header-cap` from `fitHudFonts`.
    - The flip reset's sign is the game's effect under the car, ours built to FR1's description (HUD-19,
      `render/flipResetFx.ts`): a glow disc, a ring, a shallow dome and 25 sparks in one pale blue, attached to the car
      12 uu under its origin, gone in about 0.2 s; the "FLIP RESET" text is gone (23).
    - The 85b2463 review: RV-289 (a menu's presses masked from the game only, each until released: `padNav.mask`),
      RV-290 (a nameplate's redraw a new texture), RV-291 (the wall curve's contact isn't the floor's: engine and 0:00
      tests), RV-292 (the replay's YOU plate in the e2e), RV-293 (the guard against the game's Ball Arrow mesh and boost
      meter bitmaps, local references in out/bsim/assets_local/hud: the profile's numbers close together, a run of the
      mesh's arrays in their order, the bitmaps' files, pixels and rows at 1, 1/2, 1/4 their size, as text, base64,
      data URIs or floats; its controls built from them); the score digits' boxes not mirrored (x -136...-66 and
      68...138).
    - The podium's and the kickoff countdown's XY lock (28; PD1, MIO-13): Car_TA's SetConstrained2D(!bDriving ||
      bPodiumMode) every tick, Bullet 2.82's btGeneric6DofConstraint added to the engine's Bullet as it is (include
      paths relative, no serialization) and pinned at the car's centre of mass as it takes hold: X and Y held, Z and
      rotation free; RocketSim had left joints out of its solver (`convertJoints`), back when there are any. Arena
      `podiumMode` (rl_set_podium / setPodium, from the phase on both sides) and the countdown; podium jumps end their
      force at PodiumJumpForceTime 0.085 s. Snapshots (Serialize, in-place loads, clones) carry each held lock's pin, so
      a restore takes it back where it was (the rollback test: all identical). The end's frozen world still doesn't
      step (the game's frozen cars would be held at X/Y and fall: the screen is black then).
    - No boost cone: the trail alone (the user's decision, 31).
  - **In 85b2463: the user's first evaluation findings, the 6e56234 review RV-287/288.**
    - The red dot (REPLAY, BALL CAM): the game's 32 px bitmap is mostly halo: a 13 px #FF7752 disc and a soft #FF4141
      glow to r 16; the label's text 12 px right of its centre.
    - The header fonts ($HeaderFont, $HeaderThinFont: Bourgeois Medium and Thin, cap height 0.5679 em): every size
      scaled by Bourgeois' cap height over the local substitute's, measured on the font the browser draws the stack
      with (`ui/hudFont.ts`, CSS `--hud-header-scale`, `--hud-thin-scale`).
    - The top scoreboard's fills at the textures' 0.8 (team boxes, the clock box); its 100 px perspective stays (the
      static session: focalLength wins); the boost meter's is 500 px (focalLength 500, centre 50 left and 100 above).
    - Menus with a pad (`ui/padNav.ts`): the D-pad and left stick move a highlighted focus (the nearest control that
      way), A presses (a list steps on), left/right change a list or slider, B backs out, Start opens and closes the
      pause menu; a menu's press still held after it closes isn't the car's. The end screen, pause, main menu, settings.
    - Online from a Windows browser: `localhost` is reached at 127.0.0.1 (Windows tries ::1 first, which a WSL server's
      UDP never sees, and WebTransport doesn't fall back).
    - The goal replay's car sounds follow the replayed cars (engine, boost, supersonic), heard from the replay camera;
      the live voices come back after it (`GameAudio.replayFrame`).
    - The flip circle on the HUD's stage, left of the boost meter (no overlap at any size).
    - The ball arrow (HUD-17, `render/ballArrow.ts`; Interface "Ball Arrow", on): the round arrow 75–120 uu from the car
      toward the ball, 20 up, over everything; with the ball cam off, the car alive, in the round. Its materials from
      the compiled shaders (ARW1): the r 12 sphere a black haze ((N·V)⁴ on its far inner side: a soft dark disc), the
      arrow neutral grey (0.25 linear) with a 125 ms flash to 3.25 twice a second sweeping tail to tip; it freezes
      while the ball is exploded (a goal).
    - The 0:00 rule (`rl_ball_on_ground`): the ball's world contact counts its persisted points too, their merged
      normal z > 0.96, so a ball rolling on the floor ends the round at once (it rides 0.038 over the mesh, never under
      the 0.02 the check used to ask).
    - The red dot's labels laid out on their baselines (REPLAY, BALL CAM and its hint: the dot's centre 11 above the
      label's baseline, the hint's 27, both texts from 14 right of it, HUD-12), so they line up in any font; the stat
      popup's name and "+N" and the centre message on their measured baselines (HT-12: no overlap).
    - The scoreboard drawn to the bitmaps' visible shapes (HUD-2a: the clock box 135 × 56 with its notch, the score
      boxes 67.5 × 56, rounded outside, a grey ramp to the inner edge under the team tint; the board's origin at y 0:
      MatchInfoView sets it at run time, 26 while searching for a match, later), the score views turned about their
      origins; the numbers' stand-in scaled to Dashboard Numbers Wide's digit height (`--hud-numbers-scale`), each
      character in a cell its advance wide (`ui/numberCells.ts`: digits 0.796 em, '1' 0.31, ':' 0.14, as the game's:
      the clock holds still but for a 1), each field on its baseline.
    - Nameplates drawn in the world (sprites, alpha-tested 0.667, depth-tested: what's in front covers them; HT-12).
    - A PlayStation pad (Gamepad.id: 054c, DualShock/DualSense, "Wireless Controller") gets PlayStation glyphs and
      names (✕ ○ □ △, L1/R1/L2/R2, Options, Share); a menu's first control is highlighted at once. The user's "Cross
      does nothing" was the pad's press edge read against itself (`PadMenuNav.frame` kept the new buttons as the last
      frame's before reading them): A, B and Start never pressed, only the stick and D-pad moved. `?pad` in the address
      shows what the browser reports for each pad (id, mapping, held buttons, axes).
    - The clock pads a trailing '1' with a no-break space (HT-12, onTimeRemainingChanged), its letterSpacing not on
      that pair: 1:10 to 1:11 holds still, as the game's.
    - RV-287: Exit to Main Menu, then Free Play: the goals back to 0-0. RV-288: in the goal replay the player's own
      plate says YOU (`platesAt`); RV-279's test (`replayCarPositions`).
    - Every check batch: `scripts/replay_check.py`, the physics against a fixed sample of 16 local replays (median per
      group, WORSE against the previous run; notes/validation.md).
  - **Decided (user, 2026-10-10): no controller rumble.** notes/rumble.md stays as a reference spec only. The contact
    detection it asked about (the static session's Q-RMB-a: HandleCollision's cadence, the contact's point and normal,
    the landing speed) is still wanted, for the Impact_Medium camera shake and the impact and landing sounds; don't
    assume per-step firing until the answer comes.
  - **Local assets from the static session** (dev-only, git-ignored, load when present like the Fennec; each with a
    README and manifest): `out/bsim/assets_local/fx/` (ball GLB and material formula, the boost trail and the goal
    explosion as emitter JSON, schema rl-fx/1), `cars/` (six cars painted per team with their hitbox presets and
    wheels), `sound/` (1098 Ogg files and a Wwise manifest: events, containers, curves). Not used yet. `notes/wheel-kick-t125.md` (walls_021027
    t125: a hitbox nose contact, not a wheel) needs per-wheel and per-manifold PhysLog columns and a recording of
    `walls_goal_wheels.txt`, with the user in freeplay.
  - **Settled with the static session:** the game's jitter buffer measures in real time too (it widens after a goal,
    as ours); `bSlomoForDefender` stays set for the match (one replay director per game event); the replay's earliest
    start is the round's countdown, when the ball spawns.
  - **Browser tests:** under 24 fps (software WebGL here: about 11 fps at 1280×720) the game's 5-tick cap runs the
    simulation slower than real time, so tests wait for outcomes instead of timing them; the goal test uses a second
    server (`--test-goal-after 1`, ports 14435/14436).
- **Netcode (today, from the static session's audit `notes/netcode-audit.md`):** corrections smoothed for drawing
  (`client/src/game/syncError.ts`), hitch reset of the server's jitter buffer (protocol `ResetInputBuffer`), lost
  update parts no longer drop the whole update, remote cars' input basis only from the cars in an update; then the
  static session's review of those (NR-1 to NR-9, all done): rotation corrections shift the previous tick and compose
  as the game's, a spawn counter per body (engine patch 74, network state format 6, protocol 6) replaces the 500 uu
  teleport guess, the camera follows the smoothed rotation, resyncs and reloads are smoothed, older and late update
  parts apply (the predictor keeps applied server states in its history), hidden-tab queue capped, server reset rate
  limit; see `notes/netcode.md` (end). Client: boost pad warm-up (last second pulsing), respawn picker in the HUD, flip reset
  toast from the engine's counter, gamepad camera swivel direction fixed (C-1).
- **Driving the game:** `tools/physlog/check_game.sh` (heartbeat + read-only screenshot to `out/live/screens/`; look
  at the screenshot when the game doesn't answer or isn't in freeplay). Never load maps from scripts (the game drops
  to the menu and asks to reconnect online): starting freeplay is the user's job. Bots: `physlog_spawn 23 bot`,
  `physlog_removebots`, `physlog_cars`. Other car bodies can't be switched from a script (item mod is visual; a bot's
  hitbox ignores the body asked for): they need the user's loadout.
- **Static analysis runs in a second session** (Ghidra BSim, stock Bullet vs the exe; it writes only `out/bsim/` and
  `notes/bullet-diff.md` and sends numbered hypotheses to test live). This session owns the game, PhysLog, `engine/`,
  scenarios, tests, client and server. Batch 2: B6, B7, B9, B10 adopted; B11 (car–car through an AABB tree) worse as
  tried: the static session says the body order is probably the issue (2.82: body0 = the car added to the world
  first, by broadphase handle; try both orders); B8 (internal-edge choice) after the arena rework below.
- **Arena (findings 41, 44, 45):** the generated arena is now the game's 16 meshes triangle for triangle: our own
  vertices (`scripts/arena_layout.py`: rules plus a few constants measured on the game's mesh) and the game's
  triangles in its cooked order (`scripts/arena_topology.json`, indices only; re-derive with
  `scripts/arena_topology_derive.py out/arena_local/cooked` after changing a pool: it needs the local extraction,
  `out/bsim/agents/S1/tools/cooked.py out/arena_local/cooked --local`). The goal halves are written in their own
  frame with a body offset (`.cmf` trailer, engine patch 73). `ball_curves` and `walls` now match (0.04 / 0.20 uu/s).
  Left approximate: the skirts below the floor and above the ceiling (hidden), the post-base ring and mouth-arc ends
  (≤ 0.40 uu). A Python venv with numpy and scipy is at `.venv` (git-ignored) for fitting.
- **Open:**
  - (the live sitting is done: finding 48; respawn spot choice, held respawns, kickoff order, uneven teams, the clock
    and 0:00, per-body spawn heights, all six presets' steering confirmed or fixed)
  - (GA-5, the pitch lock after a wavedash: patch 79, confirmed live, finding 47; GA-6, spawn height and offset per
    body: patch 80, measured live, finding 48)
  - controls audit (`notes/controls-audit.md`): C-6 sub-frame taps; the default pad layout's air roll (the audit:
    Standard/Modern pads put it on LT; ours on X) (done: C-2 DodgeForward as its own byte, patch 78; C-3 the Modern
    keyboard layout, the user's choice; C-4 several inputs per action; C-5 the trigger deadzone 0.1, measured live, and
    the digital press threshold 30/255);
  - netcode N-4 (server-confirmed demos), N-9, N-10; the car state's size on the wire;
  - match rules (`notes/match-rules-audit.md`): done MR-1 (clock, 0:00 ball-on-ground, overtime, end and a new
    match: `server/README.md`), MR-2 (one goal per round: patch 72), MR-4 and MR-5 (the kickoff order per match and
    uneven teams: patch 75; the live uneven-teams check is in the user's sitting, `notes/live-sitting.md`), MR-3 (the
    3 s warm-up before a match's first countdown, a joiner in a countdown on a kickoff spot), MR-6 (the
    demolished wait for the kickoff after a goal: patch 76; the goal explosion's knockback: patch 77, direction and
    timing confirmed by replays, its size not settled by them: finding 46), MR-7 in part (a team left empty
    forfeits); open: slow motion and the goal replay, forfeit votes;
  - camera (`notes/camera-update-audit.md`): free look (CAM-1) and the live Modern camera preset (CAM-3/4: a
    decision like the keyboard layout), respawn cameras (CAM-6); CAM-2/7/8 are fixed;
  - `steer` once per other car body (finding 21), `HandlingPresetXOffset`.
  - **Cage pattern (done 2026-10-08):** builds draw the game's lattice laid out from the shippable topology
    (`client/src/render/cageLayout.ts`, a port of `scripts/cage_layout.py`; `scripts/cage_topology.json`, user-approved
    derived data); the dev server prefers the static session's local export (`out/bsim/assets_local/cage/`;
    `?cage=topology` skips it). Left: the lower glass. Ours carries the cage's wall cells down to the trim beside the
    goals (the user's ask); the game's is a separate, smaller hex texture on a few panels (UV mappings in the static
    session's message of 2026-10-08; the tiling factor needs a screenshot count of hex columns across a 576 uu panel).
- **The live game updated on 2026-10-06; decompile the live build** (the user's standing rule, for this and any later
  update). Static reads (exe, packages, texture caches) use the user's snapshot of it,
  `/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague-20261006/` (identical to the Steam folder;
  exe sha256 bfeba09f0e82db0b…); the Steam install (`/mnt/c/Program Files (x86)/Steam/steamapps/common/rocketleague`)
  only for live recordings, since the game runs from it. Each update gets its own snapshot folder
  (`rocketleague-YYYYMMDD`), made before analysing it; the old build stays at `rocketleague/`. Its Ghidra project is
  `out/bsim/rl-20261006` (project RocketLeague, fully analysed, natives named from the live exe), its dumps
  `out/bsim/live-20261006/` (natives.csv, gnatives.csv, classes.csv), the old→live function map
  `out/bsim/bindiff/function_map.tsv`. The old 2026-06-16 project (`ghidra/RocketLeague`, `out/bsim/rl-20260616`,
  `out/decomp`) is older evidence only; leave `out/bsim/rl-20260616` untouched (shared with the Arch desktop). Physics
  functions look unchanged (finding 25), but trust the live recordings over the decompile where they disagree.
- **Done by the static session (2026-10-08):** stock Bullet 2.82 diffed against the executable function by function
  (BSim); its findings are in `notes/bullet-diff.md` and `out/bsim/reports/`, adopted ones in engine patches 46–53.

**Goal:** a web game cloning Rocket League's physics, camera, controls and competitive multiplayer.
**Plan:** forked RocketSim (`engine/`) with verified patches → native game server + WebAssembly clients
(bit-identical); own arena mesh; Three.js browser client (`client/`).
**Status (2026-10-06):** physics reverse engineering complete; our arena mesh is generated and validated
(`out/arena/`); RocketSim is forked into `engine/` with every verified patch and tests (`engine/README.md`).
The engine also builds to WebAssembly with a JS API (`engine/build-wasm/carball_engine.mjs`). Native and WebAssembly
builds simulate bit-identically (the game server will be native, the clients WebAssembly).
Browser freeplay works (`client/`, TypeScript + Vite + Three.js; see `client/README.md`). The camera is the
game's own: decompiled from UnrealScript and ported (`client/src/camera/carballCamera.ts`, algorithm in `notes/camera.md`).
**Last state (2026-10-06):** multiplayer step 1 done: snapshot restore is exact (engine patches 23–26,
`engine/tests/rollback.cpp`; in-place load ~5 µs). Step 2 done: the game's netcode is decoded (`notes/netcode.md`).
Step 3 done: native server (`server/`, Rust, WebTransport; `server/README.md`), protocol v1 (`protocol/`), browser
online mode with prediction and rollback (`client/src/game/online.ts`, `client/src/net/`); step 4's core (the
predictor) is in and exact for the local car. Next: step 5.
Replay validation (§7) done (`notes/validation.md`, `engine/build/replay_validate`): ball physics exact, driving within
~1%; fixed the car–ball hit impulse (start-of-tick velocities, patch 28: the ball was bouncy on the car) and added the
game's input bytes (patch 29). Then: the ball sleeps like in the game (patch 30); car wobble at goal walls traced to
the vehicle model (same on the game's mesh); the client predictor resyncs when the server is ahead (stalled tab). Then the vehicle update decompiled
and matched to the game's Bullet vehicle (patch 31; replays: wall/curve error 3× lower). Then: powerslide,
jumps, flips and pinches checked (all match; their errors were replay timing, now reconstructed or fitted by the
validator); steering reverted to the game's average angle (patch 8 revised: the earlier replay test was confounded);
wall-grip condition (patch 32). Car–car checked with a new validator pass (`--carcar`, extractor `--demos`): bumps
match; the demo cone is now tested at the time of impact (patch 33) and supersonic lasts 1 s below 2200 (patch 34),
both from the code and confirmed by replay demos. The arena mesh now uses the game's tessellation (Bézier arcs;
`notes/arena.md`), which brought walls/curves to 0.046 uu, as on the game's own mesh. Then: double jumps (start
timing), boost pad pickup radius (patch 35), kickoff ball height and the 4 s kickoff countdown (patches 36, 37;
server waits 3.0 s after a goal; protocol version 2), other bodies (`--bodies`) and input changes checked.
Open points: `notes/roadmap.md` §7 "Open". Car position error vs replays
now ~0.010 uu flat, 0.046 walls/curves, 0.020 goals (median after ~4 ticks; `notes/validation.md`). A second Claude
session did client visuals (ball spin, hex walls, placeholder car models) in client/src.
Agreed multiplayer plan: (1) exact restore ✓, (2) decode the
game's netcode (input buffer, client sim-time adjustment, remote car/ball correction), (3) native authoritative
server + browser transport, (4) client prediction + rollback, (5) in-process network tests with scripted
latency/jitter/loss. Then replay validation (§7) with numbers, then the competitive layer (§9). The user wants
accuracy settled by deterministic, verifiable tests, not by their perception.

Read in this order: `notes/roadmap.md` (what's left) → `notes/physics-values.md` (all values, formulas,
RocketSim comparison) → `notes/arena.md` → `notes/camera.md` → `notes/findings.md` (binary/package internals, addresses)
→ `notes/input.md` → `notes/netcode.md` → `notes/validation.md` → `engine/README.md` → `client/README.md`.

## Locations
| What | Where |
|---|---|
| Live build snapshot (2026-10-06): static reads | `/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague-20261006` |
| Live game (Steam): recordings only | `/mnt/c/Program Files (x86)/Steam/steamapps/common/rocketleague` |
| Old build (2026-06-16) | `/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague` |
| Exe | `<build>/Binaries/Win64/RocketLeague.exe` (image base 0x140000000) |
| Packages | `<build>/TAGame/CookedPCConsole/*.upk` (decrypt from the live snapshot) |
| Replay dataset (116 GB zip, ~120k replays 2021–Sep 2025, `1v1/ 2v2/ 3v3/` + `metadata.jsonl`) | `/mnt/primary/home/arch/documents/rocket_league_replays/high-level-rocket-league-replay-dataset.zip` |
| Ghidra project, live build 2026-10-06 (fully analysed, natives named): use this one | `out/bsim/rl-20261006` (git-ignored) |
| Ghidra project, old build 2026-06-16 | `ghidra/RocketLeague` (git-ignored) |
| Decrypted packages | `out/decrypted/` (git-ignored): TAGame, GameInfo_Soccar_SF, GameInfo_Default_SF, Body_Octane_SF, Stadium_P, Engine, Core, ProjectX, Mutators_SF, Startup |
| Package AES key | `out/rlupktool_key.bin` (public RLUPKTool key; git-ignored) |
| Decompiled C | `out/decomp/<name>@<addr>.c` (git-ignored) |
| Extracted arena meshes (measurement only, never ship) | `out/arena_local/*.obj` (git-ignored) |

Scratchpad copies (RocketSim and RLUPKTool clones, extracted replays, `states.csv`) are temporary.
Regenerate: `git clone --depth 1 https://github.com/ZealanL/RocketSim`; replays via Python `zipfile`
from the dataset zip (newest by `metadata.jsonl` `data.date`).

## Tools (run Python scripts from `scripts/`; plain `python3`, not `-I`)
```sh
# Ghidra on the live build. -readOnly still locks the project: work on a copy per job, and cap its memory.
# DecompAt decompiles the functions containing the addresses, plus their callers to DEPTH, into OUTDIR.
cp -r out/bsim/rl-20261006 JOB/rl-live
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=1G env MAXMEM=8G \
  /opt/ghidra/support/analyzeHeadless JOB/rl-live RocketLeague -process RocketLeague.exe -noanalysis -readOnly \
  -scriptPath out/bsim/work/ghidra_scripts -postScript DecompAt.java OUTDIR DEPTH 0x140f54bd0
# Old build (older evidence): the same with project ghidra/RocketLeague and -scriptPath scripts -postScript Decomp.java
# ADDR.. (-> out/decomp/).
# other Ghidra scripts (same invocation): FindDisp.java <disp..> [min=N]  (functions using offsets)
#   FindStore.java <disp..> [lo= hi=] (stores to [reg+disp]); FindCallArg.java <target> <disp..>
#   (calls whose RCX = lea [reg+disp]); Refs.java <addr..> (all xrefs); ApplyNatives.java (names)
# zsh does not word-split $VAR: use ${=VAR} when passing address lists.

python3 decrypt_upk.py ../out/rlupktool_key.bin ../out/decrypted <pkg.upk...>   # decrypt+decompress
python3 props.py <pkg> <export path suffix...>       # tagged properties (defaults/archetypes)
python3 layout.py <pkg> <Class...>                   # native field offsets (checks vs exe sizeof)
python3 ubytecode.py <pkg> <Class.Function...>       # UnrealScript -> pseudo-code (RL token map)
python3 search_props.py '<regex>' <pkg...>           # grep property names across all objects
python3 scan_exports.py ../out/rlupktool_key.bin <CookedPCConsole dir> <Name...>  # which pkg exports X
python3 staticmesh.py <pkg> <mesh path> --obj out.obj  # mesh verts/tris (measurement only)
python3 export_constants.py ../out/decrypted ../out/rl_physics_constants.json
python3 dump_natives.py / dump_classes.py / dump_tokens.py   # regenerate out/*.csv from the exe
cargo build --release --manifest-path replay_extract/Cargo.toml
replay_extract/target/release/replay_extract states.csv replays/*.replay   # ball/car states + inputs
python3 replay_measure.py states.csv                 # ball rest/wall gaps, throttle accel curve
python3 arena_gen.py ../out/arena                    # our arena mesh (.obj + RocketSim .cmf), no Psyonix data
python3 arena_check.py ../out/arena/arena.obj ../out/arena_local   # deviation vs game meshes (local only)
cmake -S ../engine -B ../engine/build -DCMAKE_BUILD_TYPE=Release && make -C ../engine/build -j
../engine/build/rl_patch_tests && ../engine/build/arena_smoketest ../out/arena/collision_meshes
# WebAssembly: Emscripten is at /usr/lib/emscripten (not on PATH in non-login shells)
PATH=/usr/lib/emscripten:$PATH emcmake cmake -S ../engine -B ../engine/build-wasm -DCMAKE_BUILD_TYPE=Release
PATH=/usr/lib/emscripten:$PATH emmake make -C ../engine/build-wasm -j && node ../engine/wasm/test_node.mjs
../engine/tests/check_native_wasm.sh 600     # native == WebAssembly, bit for bit (must stay identical)
../engine/build/rollback ../out/arena/collision_meshes 300   # restored snapshots continue bit for bit
cd ../client && npm run check && npm run build && npm run e2e   # web client: types, lint, tests, browser tests
cd ../server && cargo test && cargo clippy --all-targets -- -D warnings   # game server (cargo run --release to play)
cargo clippy --no-default-features --features host --lib --bins -- -D warnings   # the local host's configuration (RV-552)
python3 replay_pull.py ../out/replays && replay_extract/target/release/replay_extract ../out/replays/states.csv ../out/replays/*.replay
../engine/build/replay_validate ../out/replays/states.csv --cases ../out/replays/cases.csv && python3 validation_report.py ../out/replays/cases.csv
```

## Session conventions and decisions
- The user commits work themselves. Don't commit, and don't touch the git index (no `git rm --cached`, no staging).
- RocketSim was forked knowingly, despite its README's request. The server will be native, the clients WebAssembly,
  and they must stay bit-identical: run `engine/tests/check_native_wasm.sh` after engine changes.
- The user values strict static analysis and tests: keep `cd client && npm run check` and `npm run e2e` green.
- Decompiled game code stays local (`out/decomp/`, git-ignored): camera script in `out/decomp/camera_script.txt`
  and `camera_base_script.txt`.

## Gotchas
- Units: uu; Bullet = uu × 0.02. Forces/impulses in data are uu × mass (car 180, ball 30).
- UE3 shapes get PhysX skin +0.025 BT (+1.25 uu/side); spheres then −0.04 in Psyonix's converter.
- Package quirks: UProperty has an extra FString name; Context/ClassContext tokens have an extra flag
  byte; bytecode tokens are shuffled (map in findings.md); imported structs live in ProjectX/Core.
- KSphereElem `TM` matrix reads as a permutation = identity (FPlane stored W-first).
- Replays: angular velocity is rad/s × 100; car states replicate every ~0.067–0.1 s (not every frame);
  high-speed bounce samples can be extrapolated past walls; use slow/sustained contact.
- Level actors with `RF_HasStack` have an FStateFrame before NetIndex (props.py handles it).
- Addresses are valid for this exe build only.
- Keep Psyonix material local: decrypted packages, key, meshes, decompiled code are git-ignored.
- The user commits work themselves; leave changes uncommitted unless asked.
- `pkill -f PATTERN` kills its own shell if PATTERN appears anywhere in the same command line. Use a bracket
  trick (`pkill -f 'vite previe[w]'`) and don't start the process in the same command.
- Never wait for a run to finish with `pgrep -f` on command names (`while pgrep -f "npm run chec[k]"; do sleep`):
  the bracket only keeps the pattern from matching its own text. A waiting shell whose command line also holds the
  real command it launches next (`...; npm run check ...`) matches itself forever, and so do other waiting shells
  (2026-10-08: three such loops deadlocked, so client runs 28–30 never started). Wait on the job instead: a single
  background job (`run_in_background`, notified when it exits) or `$!` / `wait`, or poll a status file the job writes.
  Type check and unit tests after each change; the full build and e2e (5–8 min) once at the end of a batch.
- Emscripten: `PATH=/usr/lib/emscripten:$PATH` (not on PATH in non-login shells). Bindings generate TS types
  (`--emit-tsd *.d.mts`; typed arrays via `EMSCRIPTEN_DECLARE_VAL_TYPE`). After changing `engine/wasm/bindings.cpp`,
  rebuild `engine/build-wasm` (targets `rlengine`, `rlengine_web`: outputs `carball_engine*`) before running the client.
- Determinism pitfalls (native vs WebAssembly): platform libm (fixed: `engine/detmath`), Bullet SSE paths (fixed:
  `BT_DISABLE_SIMD`), `std::` random distributions/shuffle/`default_random_engine`, function-argument evaluation
  order, uninitialized fields. Never `-ffast-math`.
- UnrealScript disassembly: Rocket League's extended-native tokens are 0x70–0x7F (fixed in `ubytecode.py`).
  Unknown tokens `0x52`, `0x5b` remain. Most game-feel logic (camera, car impacts) is script, not native.
- Playwright's system Chrome reads real gamepads plugged into the machine (the user's controller once reset the
  car mid-test). `client/e2e/fixtures.ts` stubs `navigator.getGamepads`; import `test` from there.
- Playwright uses the system Chrome (`channel: "chrome"`, swiftshader). Screenshots via a temporary spec file in
  `client/e2e/` (delete after). Headless Chrome CLI screenshots also work (`--use-angle=swiftshader`).
- The user chose to fork RocketSim despite its README's request (2026-10-06); don't re-ask.
- Engine changes are marked `RL PATCH`; regenerate `engine/rocketsim-rl-patches.diff` after changing them.
