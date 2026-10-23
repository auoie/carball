# App contract

What the three images need from the host and what they give it. Provisioning, DNS, firewalls and certificate renewal are
the hosting side's (not here).

| Image | What | Port | Reached at |
|---|---|---|---|
| `carball-web` | the web client: static files (nginx) | **3000/tcp** (plain HTTP; TLS in front, e.g. the tunnel) | `https://carball.zolt.top` |
| `carball-game` | the game server: matches over WebTransport (HTTP/3, QUIC) | **4433/udp** (`GAME_PORT`), public, nothing else published | `game.carball.zolt.top` (DNS only, no proxy: it's UDP; **an A record only, no AAAA**: see below) |
| `carball-api` | the accounts service: sign-in (Google, Steam), sessions, accounts (Go; Postgres beside it) | **8080/tcp** (`LISTEN_ADDR`, plain HTTP), on its docker network only: **never published** | `https://carball.zolt.top/api/` (the tunnel routes `/api/` to it, the rest to `carball-web`: same origin) |

**IPv4 only (the user's decision, RV-406).** `game.carball.zolt.top` has an A record and **no AAAA record**. Behind
Docker's default bridge (`-p 4433:4433/udp`), IPv6 clients reach the server through Docker's userland proxy, so the
server would see every IPv6 player as one address (the bridge's gateway): one address's limits (8 at once, 30 a minute)
for all of them, and two no-shows anywhere on IPv6 blocking them all. IPv4 keeps each client's real address. Deploy
check: `dig AAAA game.carball.zolt.top` returns nothing. The example below publishes the port on IPv4 alone
(`-p 0.0.0.0:4433:4433/udp`), so nothing reaches it over IPv6 even by mistake. To serve IPv6 later, run the game
container with `--network host` (it then sees real addresses; no `-p` mapping or network isolation: it shares the host's
loopback too, so its health endpoint is the host's 127.0.0.1:8081 and it can reach the host's loopback services; UDP 4433
and 127.0.0.1:8081 must be free on the host), then add the AAAA record.

**Renamed in 48388aa** (a deployment set up before it: check its files, RV-422). The mode variable `RL_MODE` is now
`SERVER_MODE`, and the old name is ignored: `RL_MODE=direct` starts the queue. The binary `/app/rl-server` is
`/app/carball-server` (an `--entrypoint` or health check naming the old path fails). The meshes folder is
`collision_meshes/arena/` (was `soccar/`): a `MESHES_DIR` of one's own without `arena/*.cmf` stops the server at start,
naming the folder (RV-421).

## Build, export, push

```sh
scripts/build_images.sh [TAG]              # from the commit (HEAD); TAG defaults to scripts/image_tag.sh's
scripts/image_tag.sh [COMMIT]              # the commit's tag: its UTC date and hash's first 7, e.g. 20261023-1412-619e7e8
scripts/build_images.sh --worktree TAG     # testing a change before its commit
```
The default tag is the commit's own date in UTC and the first 7 characters of its hash, `YYYYMMDD-HHMM-hash` (the
committer date and a fixed-length hash: the same commit always gets the same tag, a rebuild changes nothing; tags sort
by that date); the build prints it last (`tag: …`), and `TAG=$(scripts/image_tag.sh)` gives it beforehand. It builds from the commit only: `git archive`'s files are the build's context (nothing uncommitted
or git-ignored gets in; with `--worktree`, the working tree's files that are committed or would be, never ignored ones).
Everything compiles in the root `Dockerfile`'s stages (BuildKit), from official toolchain images pinned by digest:
the engine's WebAssembly and the local host's (`emscripten/emsdk`, the host with Rust beside it), the server
(`rust`: the engine's libraries in their own stage, then `cargo build --release`; no debug info, symbols stripped, the
registry's and home directory's paths remapped), the client (`node`: `npm ci`, `npm run build`, then the shipped-data and
names checks on what it built) and the accounts service (`golang`: static, `-trimpath`, stripped). The script first
builds `--target checks` (the names check over the game and API images' files too, and no build paths in either binary),
then `--target web`, `game` and `api` as `carball-web:TAG`, `carball-game:TAG` and `carball-api:TAG`. Each stage is
cached by its inputs, so a release that doesn't touch the engine builds no C++; cargo's registry and target, npm's and
Go's caches are BuildKit cache mounts (the server's own crate always built again). The first build downloads the
toolchain images and the crates, npm packages and Go modules (`--locked`, `npm ci`, the Go checksum database), CMake for
the server's engine from a dated snapshot of Debian's archive (snapshot.debian.org, its version pinned) and Rust's wasm32-unknown-emscripten target from static.rust-lang.org
(the toolchain's own, checked against its manifest: RV-916); later builds only what changed. Every base is pinned by digest (update a tag and its digest together). Then:
```sh
docker save carball-web:TAG | gzip > carball-web-TAG.tar.gz       # on the host: docker load < carball-web-TAG.tar.gz
docker save carball-game:TAG | gzip > carball-game-TAG.tar.gz
docker save carball-api:TAG | gzip > carball-api-TAG.tar.gz
docker tag carball-web:TAG REGISTRY/carball-web:TAG && docker push REGISTRY/carball-web:TAG    # or a registry
docker tag carball-game:TAG REGISTRY/carball-game:TAG && docker push REGISTRY/carball-game:TAG
docker tag carball-api:TAG REGISTRY/carball-api:TAG && docker push REGISTRY/carball-api:TAG
```
Client and server must come from the same commit (the protocol version is checked at the handshake: an older page is
refused with a message to reload). **Deploy in this order (notes/accounts.md §8): the database, the API (its migrations,
then the service: the game server's `TICKET_PUBLIC_KEYS` names its ticket key), the game image, then the web image right
after.** For the last two: with the web image
first, an open page from before whose search finds a match in the gap loads the newer match page, which the older server
refuses, recording a no-show and cancelling its players' match; with the game image first, the older pages' searches and
claims are refused cleanly with the reload message until they reload (RV-442). Rolling the web image back to before 48388aa (the browser storage's keys renamed, moved over
once by the newer page) shows players the default settings and gives them a new browser key on the older page, and what
they change there is lost when the newer page returns (RV-425; `client/src/settings/storageKeys.ts`).

## carball-web

| Env | Default | |
|---|---|---|
| `GAME_SERVER_URL` | `https://game.carball.zolt.top:4433/play` | the game server's WebTransport URL; written into `/config.json` at start (`https://HOST[:PORT]/PATH`, else the container exits: set but empty too, RV-441), and its origin is the page's only `connect-src` besides its own |
| `GAME_SERVERS` | (none) | the game servers, one a region (notes/matchmaking.md, Regions), in the order the page lists them: `ID\|Name\|URL` entries, comma-separated, e.g. `us-east\|US-East\|https://game.carball.zolt.top:4433/play,eu\|Europe\|https://game-eu.carball.zolt.top:4433/play,asia\|Asia\|https://game-asia.carball.zolt.top:4433/play`. The id lower-case letters, digits and inner hyphens (32 at most, each id once); the name the region's as the Play page's picker shows it (letters, digits, spaces and `. - ( )`, 40 at most); the URL as `GAME_SERVER_URL`'s; 8 entries at most; one line. Set, it takes `GAME_SERVER_URL`'s place: `/config.json` carries them as `gameServers` and the first as `gameServer` (what pages from before the regions read), and `connect-src` names each server's origin. Set but empty, or with a bad entry, the container exits. Unset: `GAME_SERVER_URL` alone, one server and no picker |
| `EXTRA_CONNECT_SRC` | (none) | testing only: more `connect-src` sources (e.g. `http://127.0.0.1:14503 https://127.0.0.1:14502` for a development server's info and port); space-separated `SCHEME://HOST[:PORT]` (http, https, ws, wss; the port 1–65535 or `*`), else the container exits. `GAME_SERVER_URL` likewise allows only letters, digits and `. - _ ~ /` after `https://`, one line |

- **Port:** 3000/tcp, plain HTTP. `/assets/*` (hashed names) cached for a year, the rest `no-cache` (`/bots/*`, Play vs
  Bots' packages under their own names, among them), `/config.json` `no-store`. A missing file under `/assets/`, `/bots/`
  or `/config.json` is a 404 (one under `/bots/` `no-cache` too, RV-553); any other unknown path serves `index.html`
  (RV-537). A page off localhost whose `/config.json` can't be read (missing, an error, not a config) offers no online
  play ("can't be reached"): it never falls back to a development server (RX29C). Every response carries
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a
  Content-Security-Policy (this origin only, but the game servers' origins from `GAME_SERVERS` or `GAME_SERVER_URL` and Cloudflare
  Turnstile's `https://challenges.cloudflare.com` in `script-src` and `frame-src`, the sign-up's check; `frame-ancestors
  'none'`; no eval; WebAssembly compiled, `'wasm-unsafe-eval'`: the engine, the bots' match host and onnxruntime; workers
  from this origin: a match against bots runs in one, onnxruntime on one thread, so no cross-origin isolation is needed).
  Redirects are relative (a directory's trailing slash), so nothing names the container's port behind the tunnel. The
  third-party notices are at `/THIRD_PARTY_NOTICES.txt` (the bots' section included) and
  `/THIRD_PARTY_NOTICES-onnxruntime.txt`; each bot's licence at `/bots/<bot>/LICENSE.txt` (or the file its bot.json
  names, `licenceFile`).
- **User:** nginx runs unprivileged (uid 101, nginx 1.30, the stable line). The site and all of `/etc/nginx` are root's,
  read-only to it; it writes `/config.json` and the policy (`/etc/nginx/carball-csp.conf`; both baked in at build for the
  default `GAME_SERVER_URL`, so a container started without the entrypoint still has them) at start, and its pid and
  buffers under `/tmp` and `/var/cache/nginx`. The root filesystem must be writable (`--read-only` stops it: the start
  can't write those two files). (The base image's `EXPOSE 8080` stays in its metadata: the server listens on 3000 only.)
- **Labels:** `org.opencontainers.image.title`, `.revision` (the commit) and `.version` (the tag), and `carball.source`:
  `commit`, or `worktree` for an image built with `--worktree` (every image).
- **Volumes:** none.
- **Health:** `GET /healthz` → `200 ok` (the image's `HEALTHCHECK` uses it).
- **Resources:** ~14 MB RAM (13.9 MiB measured, RX31), negligible CPU; a first visit loads ~3.4 MB of files (~1.2 MB gzipped: the page, its script
  and three's, the engine's WebAssembly, the arena's meshes, the three cars' models and the HUD's fonts; measured
  2026-10-22). The site is ~27 MB:
  Play vs Bots alone fetches its part, the match host (1.2 MB), onnxruntime (14.2 MB of WebAssembly, 3.7 MB gzipped) and
  a bot's package for the team size (its policy 1–2 MB), cached by the browser after.
- **Logs:** nginx's access and error logs on stdout/stderr.
- **Start/stop:** nginx's. The image's stop signal is SIGQUIT (a graceful stop: requests in flight finish), which
  `docker stop` sends.

## carball-game

| Env | Default in the image | |
|---|---|---|
| `GAME_PORT` | `4433` | the UDP port (publish the same port: `-p 4433:4433/udp`) |
| `PUBLIC_HOST` | `game.carball.zolt.top` | the name clients reach it at (logged; the certificate must be for it). With the port, this server's name for the matchmaker: `PUBLIC_HOST:GAME_PORT`, which its `Pong` tells the page and the page sends with its ping, so its match tickets name it exactly as it does (RV-863); a claim of another server's ticket is refused, both names logged |
| `PUBLIC_PORT` | (none) | the port clients reach it at when it's published as another than `GAME_PORT` (the server's name then `PUBLIC_HOST:PUBLIC_PORT`: tidier logs; the name only has to be this server's own and unique). A queue server whose `PUBLIC_HOST` isn't letters, digits, dots and hyphens (58 at most) refuses to start: the matchmaker would drop its name (RV-868) |
| `ALLOWED_ORIGIN` | `https://carball.zolt.top` | the page origin(s) allowed to open sessions, comma-separated (case doesn't matter); others (and none) get 403. Required with a certificate: empty or blank, the server refuses to start |
| `CERT_PATH` | `/certs/fullchain.pem` | the certificate chain (PEM) for `PUBLIC_HOST`, publicly trusted (browsers refuse a self-signed one; in a test, Chrome's WebTransport refused a locally trusted test CA and ignored `--ignore-certificate-errors*` too). Required in queue mode (an empty one is an error: no silent self-signed server) |
| `KEY_PATH` | `/certs/privkey.pem` | its private key (PEM); a key that isn't the certificate's is refused (the old pair stays, tried again) |
| `SERVER_MODE` | `queue` | `queue`: the accounts service's matchmaker's 1v1 / 2v2 / 3v3 matches (claims and rejoins only: a search or a decline is refused, `Refused` 3); `direct`: one open match, development only (with a certificate it's refused: anyone would join without a ticket) |
| `HEALTH_PORT` | `8081` | the health endpoint, on 127.0.0.1 inside the container only |
| `TICKET_PUBLIC_KEYS` | (none) | the tickets' public keys (notes/accounts.md §3): `KID BASE64` each (the line `carball-api ticket-key KID` prints), comma- or newline-separated, the API's current key among them (two while it rotates). Required in queue mode, or `TICKET_PUBLIC_KEYS_FILE` (empty, blank or naming no key, the server refuses to start; so does a key of small order, a key id twice, or the id `dev`; the key ids are logged at start); a claim without a match ticket (format 4) signed by one of them for this server, or a rejoin without a rejoin ticket for that match, in its time (a match ticket's 30 s, a rejoin's two minutes; issued since the server started) and not used before, is refused (`Refused` 4) |
| `TICKET_PUBLIC_KEYS_FILE` | (none) | the same list in a file (not both): read at start and again on **SIGHUP**, so a rotation needs no restart (a bad file keeps the keys there were; the new ids logged) |
| `API_URL` | (none) | the accounts service's origin, `https://HOST[:PORT]` (e.g. `https://carball.zolt.top`, through the tunnel): each queue match's result, each armed leave and each refill are posted to it (notes/accounts.md §3), and the matchmaker's events (`POST /api/fleet/events`: a match started, a seat left or rejoined, a match cancelled before its start with its no-shows' seats, a match over with no result, this server restarted; notes/matchmaking.md, the central matchmaker). Required in queue mode (with `GAME_SERVER_TOKEN_FILE`; refused at start without, unless `--dev`, which logs the calls only, or sends them to a development matchmaker with `--api-url http://127.0.0.1:PORT`) |
| `GAME_SERVER_TOKEN_FILE` | (none) | the game server's token for those calls (a file: the API's `GAME_SERVER_TOKEN_FILE` holds the same, 32 characters or more of random text), sent as a bearer token |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET_FILE` | (none) | the tunnel's Access service token on `/api/results`, `/api/quitters`, `/api/refills` and `/api/fleet/*` (its id; its secret as a file), both or neither (without: a warning, the calls go without it) |
| `OUTBOX_DIR` | `/var/lib/carball-game/outbox` | where the calls wait until the service takes them (the image's volume `/var/lib/carball-game`, uid 10001's): a call that fails for a reason that may pass is tried again, in order, with a growing wait (5 s to 5 min), for up to 24 h (the service's acceptance window), and a restart sends what's left: no answer, a 5xx, 429, and an answer that isn't the service's own (a redirect, 401 or 403 from Access or a challenge, 404 or 405 from a wrong route: logged loudly, check `API_URL`, the token and the Access token); a call refused otherwise (another 4xx, or the service's own 403 `{"error":"ticket"}` for a call's ticket: RX31) is logged and dropped. Required for a queue server outside `--dev`: without it, or with a blank one, the server won't start (RX31) |
| `MESHES_DIR` | `/app/collision_meshes` | the arena's collision meshes (in the image; keep the default: the image's own): a folder whose `arena/` holds the arena's 16 meshes in this image's format, the 4 goal halves placed by their offset. Anything else (empty, the old `soccar/` layout, a partial copy, meshes from before 8f78a1a, a truncated file) stops the server at start, saying what's wrong (RV-421, RV-434) |

A development run of the image takes `--dev` (refused beside production keys, `TICKET_PUBLIC_KEYS` or its file, and when a
certificate file is there at `CERT_PATH` or `KEY_PATH`: a public server's; it warns that it signs tickets for anyone): a
self-signed certificate made at start whatever `CERT_PATH` and `KEY_PATH`
say, pinned by the page through the info endpoint (the info reports the game port inside the container, so publish it as
the same port): `docker run --rm -e GAME_PORT=14502 -p 127.0.0.1:14502:14502/udp -p 127.0.0.1:14503:4434
-e ALLOWED_ORIGIN=http://localhost:13000 carball-game:TAG --dev --info-bind 0.0.0.0`, the page opened with
`?queue=localhost:14503` (a web container for it run with `-e GAME_SERVER_URL=https://localhost:14502/play
-e "EXTRA_CONNECT_SRC=http://127.0.0.1:14503 https://127.0.0.1:14502"`: the page reaches a development server on
`localhost` at 127.0.0.1). Its tickets are the development key's (id `dev`, a fixed key, published: only `--dev` takes
it): a development matchmaker's match tickets (`carball-api matchmaker --dev`, the page's `?matchmaker=host:port`, the
server's `--api-url http://127.0.0.1:PORT` for its events), and the rejoin tickets its info endpoint signs for a page that
asks (`/dev-ticket`), with no sign-in.

- **Ports:** 4433/udp only. Nothing listens on TCP outside the container (the health endpoint is 127.0.0.1; the
  development info server is off with a certificate).
- **Outbound:** https to `API_URL` only (reqwest over rustls; the root certificates are Mozilla's, built into the binary
  through the `webpki-roots` crate, so the image needs no CA bundle: they update when the crate does, with a rebuild).
  No redirect is followed and no proxy used (`HTTPS_PROXY` and the like are ignored); the calls' User-Agent is
  `carball-server/VERSION` (allow it through any bot rule on `/api/`).
- **The ranked rules** (notes/accounts.md §3, notes/matchmaking.md LV1): every queue match is rated: its result (the
  winning team; each seat's first ticket, team, quitter flag and time played) goes to `POST /api/results` when it ends
  with a winner; a match with none (everyone left, cancelled before the start) is a no contest and sends nothing. The
  first player to leave while the lobby is full and there's no winner yet is reported at the leave (`POST
  /api/quitters`, their queue ban; a lost connection after 5 s); a rejoin that fills the lobby again undoes it (`POST
  /api/refills`, with the rejoin's ticket). No ban when the match hadn't ticked for 20 s, or when most of its seats lost
  their connection within 5 s of each other (the server's own outage). A ranked 2v2 or 3v3 seat left by accident is
  held for a rejoin until the match ends (a rejoin's ticket, for that match; a rejoin before the old session timed out
  takes the seat over). The matches are the accounts service's matchmaker's (notes/matchmaking.md, the central
  matchmaker): it pairs by rating (ours: ±100, wider by 50 every 10 s the oldest searcher has waited, uncapped; teams by
  a snake draft), at a server every player ticked (the lowest worst ping of those), and holds one search or match per
  account. A match opens here at its first claim; an account with a player in a match here can't claim another.
- **Regions** (notes/matchmaking.md, Regions): one server per region; each is this image with its own `PUBLIC_HOST` and
  certificate (`game`, `game-eu`, `game-asia` .carball.zolt.top), everything else the same (`ALLOWED_ORIGIN`, the ticket
  keys, `API_URL`, the token). The page sends the matchmaker its ticked regions with each server's ping and name; a
  region's ping is a hello of intent 4, answered with `Pong` (the server's name) and the session closed at once
  (RV-856), no ticket; only a `Pong` counts as an answer (a server of another protocol version is unreached, RV-864).
- **Protocol 28** (the central matchmaker): a page from before gets `Refused` 1 ("reload the page") on every intent,
  its ping and its rejoin too. Deploy the API, then the game servers, then the page, back to back.
- **Volumes:** `/var/lib/carball-game` (the outbox: a few KB, keep it across restarts). The certificate directory, read-only, at `/certs` (e.g. `-v /etc/letsencrypt/live/game.carball.zolt.top:/certs:ro`
  with the archive files it links to reachable). The process runs as **uid 10001**: the key must be readable by it (a
  copy owned by or readable to 10001, or `--user` set to the files' owner).
- **Certificate reload:** the files are checked every 5 s (modification times) and read again when either changes, or at
  once on **SIGHUP** (`docker kill --signal=HUP carball-game`). New sessions get the new certificate; sessions open at the
  time keep theirs, so no match is dropped. A file that can't be read (half-written), or a key that isn't the
  certificate's (a renewal read between its two writes), keeps the old certificate and is tried again at the next check;
  each reload, or failure, is one log line.
- **Health:** `carball-server --healthcheck` (the image's `HEALTHCHECK`, every 15 s): `GET http://127.0.0.1:$HEALTH_PORT/healthz`
  answers 200 while the game thread runs (its heartbeat within 2 s), else 503. The check reads `HEALTH_PORT` (or
  `--health-port`) alone. A variable that isn't a number stops the server with its name in the error.
- **Restart policy:** `unless-stopped` (or `always`). The process exits if its game thread ends (a panic outside a
  match: a panic inside one ends only that match) or the engine aborts.
- **Stop:** SIGTERM or SIGINT ends it at once (`docker stop`: about 0.1 s); the matches in progress end with it.
- **Limits it enforces:** a client proves its address (a QUIC Retry) before it takes a slot; 512 sessions at once; per
  client address (an IPv6 one by its /64) 8 at once and 30 new a minute (a region's ping gives its start back, RV-870, up to 120 a minute, RV-900) (a large carrier NAT or NAT64 exit can hold more players than that: RV-418, raise `--max-per-address` if they're refused; it is a flag, given after the image name in `docker run`); 4 s for the QUIC handshake, 10 s through the
  hello; 240 input packets and 20 control messages a second per session (more are dropped; a session that keeps
  flooding either is closed); QUIC: 4 streams each way, small receive windows.
- **No-shows:** a match waits 10 s from its first claim for the rest (about the user's 12 s from the match found, after
  the 3 s countdown); cancelled for someone (a seat not claimed, or a player leaving before the start), its claimed
  players are told and search again, and the cancel goes to the matchmaker with the stalled seats: those accounts can't
  search for 2 minutes, the others keep their wait (first in line). A cancelled or finished match's id is remembered a
  minute, so a late claim can't open it again.
- **Resources** (measured, RX13): one game thread runs every match (120 Hz each): ~0.7 % of a core a 1v1, ~1.8 % a 3v3
  (all threads ~2.1 % / ~5.5 %), so the game thread caps a server near 55 3v3 matches. Memory ~8 MB idle, ~1.4 MB a 1v1
  and ~1.8 MB a 3v3. Bandwidth per player: ~3.4 KB/s down in a 1v1, ~5.6 KB/s in a 3v3; ~5–13 KB/s up (inputs).
- **Logs:** stderr, one line an event (start-up, joins, leaves, matches, refusals, reloads, the outbox's calls): its UTC
  time, its level (`INFO`, `WARN` for a refusal or a call kept for later, `ERROR` for a failed reload or a match's
  panic) and the message.
- **Development info:** a development server's `GET /info` and `GET /dev-ticket` (on `--info-port`, 127.0.0.1 unless
  `--info-bind`): HTTP/1, 64 connections at once, 2 s for a request's headers; another path a 404, another method a 405.

## carball-api

The accounts service (notes/accounts.md). **Nothing is deployed yet: the first deploy ships with it** (notes/accounts.md
§8). Settings are variables; **secrets are files** (`*_FILE`, a read-only mount: a variable shows in `docker inspect`).

| Env | Default in the image | |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | the HTTP listener (plain HTTP: TLS is the tunnel's); `--dev`'s default `127.0.0.1:8080` |
| `HEALTH_ADDR` | `127.0.0.1:8081` | the health check's own listener, loopback only (a non-loopback one is refused): never reachable through the tunnel |
| `TRUSTED_PROXIES` | (required; `--dev`: optional) | the tunnel connector's address as the API sees it (CIDRs or single addresses, comma-separated), whose `CF-Connecting-IP` is believed (loopback, private or link-local only: a public address or a /0 is refused; an IPv4-mapped entry read as IPv4): `127.0.0.1/32,::1/128` when cloudflared and the API share the host's network (`--network host`); the Docker network's subnet, e.g. `172.18.0.0/16`, when cloudflared is a container on the API's network. (cloudflared on the host and the API's port published on `127.0.0.1`: the API sees the Docker network's gateway, e.g. `172.18.0.1/32`, `docker network inspect` shows it.) From anyone else the header is ignored and the connection's address is the rate limits' key. Unset, the service refuses to start (behind the tunnel every user would share the connector's key); it logs the list at start, and a header ignored from an untrusted peer is warned of once per kind of peer (loopback, private, public; never the address): that warning behind the tunnel means the value is wrong |
| `PUBLIC_ORIGIN` | `https://carball.zolt.top` | the site's origin: every write's `Origin` must be it; the redirect URIs and Steam's realm are under it. https only; `--dev` takes a localhost origin and no other (http allowed) |
| `DATABASE_URL` | (required) | the service's role, rows only (e.g. `postgres://carball_app@db:5432/carball`); **no password in it** (refused) |
| `DATABASE_PASSWORD_FILE` | | that role's password |
| `MIGRATE_DATABASE_URL` | (none) | `carball-api migrate` alone: the schema owner's role, the migrations run as it (one process at a time), then `DATABASE_URL`'s role granted its tables' rows and nothing else (the same role for both refused). `serve` never migrates: the serving container never holds the owner's password. No password in it |
| `MIGRATE_DATABASE_PASSWORD_FILE` | | the owner's password (`migrate`'s run only) |
| `GOOGLE_CLIENT_ID` | (none) | Google sign-in, with `GOOGLE_CLIENT_SECRET_FILE`; neither: Google sign-in off (logged). Redirect URI to register: `PUBLIC_ORIGIN/api/auth/google/callback` |
| `GOOGLE_CLIENT_SECRET_FILE` | | its secret |
| `STEAM_WEB_API_KEY_FILE` | (none) | optional: a Steam sign-up's suggested name from the persona (else a guest-style one). Steam sign-in itself needs no key: realm `PUBLIC_ORIGIN`, return URL `PUBLIC_ORIGIN/api/auth/steam/callback` |
| `TURNSTILE_SITE_KEY` | (required) | Turnstile's site key (public: the page's sign-up widget gets it from `GET /api/signup`) |
| `TURNSTILE_SECRET_FILE` | (required) | its secret (sign-up's siteverify, its hostname `PUBLIC_ORIGIN`'s, action `signup`) |
| `TICKET_KEY_ID` | (required) | the search tickets' key's id (1-32 characters, no spaces): the game server finds the public key by it |
| `TICKET_SIGNING_KEY_FILE` | (required) | that key's seed (32 bytes, base64: `carball-api ticket-key KID` prints a new one, its public line for the game server's `TICKET_PUBLIC_KEYS` on stderr) |
| `TICKET_PREVIOUS_KEYS` | (none) | earlier ticket keys' public lines (`KID BASE64`, comma-separated) after a rotation: a result's or a quitter's tickets signed before it still check, for the acceptance window (24 h) |
| `GAME_SERVER_TOKEN_FILE` | (none) | the game server's token on `POST /api/results`, `POST /api/quitters`, `POST /api/refills` and `POST /api/fleet/events` (bearer, compared in constant time; 32 characters or more), behind the tunnel's Access service token on those paths (Access must cover `/api/fleet/*`); 300 calls a minute at most, all together (429 past it). Unset: those calls answer 503 (a deployment needs it) |
| `DELETION_HMAC_KEY_FILE` | (required) | 32 characters or more of random text (e.g. `openssl rand -base64 48`: a trailing newline is dropped, so not raw bytes): keys the delete/re-create rule's records (30 days). Changing it forgets them |

- **Ports:** 8080/tcp, plain HTTP, **never published to the internet**: only cloudflared reaches it (with cloudflared a
  container on the API's network, not published at all; with cloudflared on the host, published on loopback only,
  `-p 127.0.0.1:8080:8080`). `CF-Connecting-IP` counts only from `TRUSTED_PROXIES`; the health check listens on
  `HEALTH_ADDR`, loopback inside the container.
- **Routes:** the tunnel routes `https://carball.zolt.top/api/*` to the API (its path rule `^/api/` to
  `http://carball-api:8080`, or `http://127.0.0.1:8080` from the host; the path kept as it is) and everything else to
  the web container. Not through the web container's nginx: it stays static, and the API trusts one hop (cloudflared's)
  for the client's address instead of two. The web image answers `/api/` with a 404 (`no-store`), so a missing tunnel
  rule shows as a 404 there, never the page as JSON. Same origin as the page: its cookies are `__Host-` (Secure, Path=/,
  no Domain), so the page must be https (http on localhost in development).
- **Database:** Postgres 15 or later (tested with 18), on the same private network, never exposed. Two roles: the
  schema's owner (`carball-api migrate`, a one-shot run before each new image) and the service's (rows only: `serve`
  refuses to start if its role may create in the schema). Encrypted backups off the box (notes/accounts.md §2). Start
  the database first: `serve` waits up to a minute for it, then exits (restarted by the policy).
- **Outbound:** https to Google (`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`), Steam
  (`steamcommunity.com`, `api.steampowered.com`) and Cloudflare (`challenges.cloudflare.com`), each call with a 10 s
  limit. The root certificates are built into the binary (the image has no bundle).
- **User:** uid 10002. **Volumes:** none (the secrets' files mounted read-only). Its root filesystem can be read-only
  (`--read-only`: it writes nothing).
- **Health:** `carball-api healthcheck` (the image's `HEALTHCHECK`, every 15 s): `GET /healthz` on `HEALTH_ADDR` (loopback,
  not under `/api/`), 200 while the database answers, else 503.
- **Logs:** stderr, one line a request: method, path, status, time. **Never the query string** (a sign-in's callback
  carries its code and assertion) **nor the client's address** (notes/accounts.md AC-15). Configure cloudflared's and any
  proxy's access logs likewise.
- **Housekeeping:** in the process: hourly, expired sessions, sign-in flows, sign-ups and Steam nonces purged, the
  delete/re-create rule's records after their 30 days; every minute, the rate limits' idle keys forgotten (each limit
  holds 200,000 keys at most, the longest idle forgotten past that). Open sign-ins and sign-ups have ceilings (20,000 and
  5,000, everyone's): past them new ones are refused as busy.
- **The admin's commands** (bans: notes/accounts.md §4), with the same `DATABASE_URL` and password file:
  `docker exec carball-api /app/carball-api accounts NAME` (accounts whose name holds NAME, with their identities and when
  last seen: their latest session's sign-in or daily renewal, so to a day), `… accounts --recent [N]` (the N newest, 20
  by default, the same table),
  `… ban --account ID --reason TEXT --by NAME [--for 72h | --until 2026-12-01]` (or `--identity steam:<SteamID64>`;
  every identity of the account, signed out everywhere), `… unban --account ID`, `… bans`; `… help` lists the commands,
  `… COMMAND -h` one's flags. The live app's reports, read-only from what the service keeps (times in UTC): `… stats`
  (accounts new today, in the week and in all; ranked matches today and in the week by playlist; the bans and leave bans
  in force), `… matches --recent [N]`, `… account ID` (its ratings as the page shows them, bans, leave ban, last 10
  matches), `… ratings --top [N] [--playlist 2v2]`, `… queue-bans`. Each command refuses what it can't be sure of before it runs
  (RX34): a leftover word (quote a value with spaces: `--reason "cheating and smurfing"`), a flag's value that looks like a
  flag (`--by -h`), a first argument that's a flag (no arguments alone starts the service, as the image does); a help word
  anywhere prints its usage and runs nothing; `ban` prints the ban it made (its end, or permanent). RX35: a flag given
  twice is refused, and so is a ban's `--for` that's zero or negative, an empty `--until`, or an end less than a minute
  ahead (neither: permanent); a value starting with "-" goes as `--flag=value`. The admin's connections are named
  `carball-admin`, a statement 15 s and a lock 2 s at most; the reports', `accounts`' and `bans`' are read-only. A ban
  on an identity no account has signed in with is refused (a Steam subject is 17 digits; no spaces or control
  characters), and so is a ban in force on any of its identities unless `--replace`, which prints each ban it replaced
  (RV-781, RV-787). `--no-account` bans such an identity on purpose (a deleted account's, a throwaway's; one with an
  account refused), its line saying "no account" (RV-788). `unban --identity` shares the checks, but a subject an older
  version stored without them is lifted exactly as given (RV-790). A subject is printable ASCII with no spaces (both
  providers'); the commands print any other stored one quoted, typed back as the shell's `$'...'` (RV-809, RV-810).
  Such a ban and its identity's sign-up take turns on the identity, so neither misses the other (RV-807).
- **Stop:** SIGTERM or SIGINT: requests in flight finish (10 s at most).
- **The search** (notes/matchmaking.md, the central matchmaker; in memory, one instance): `POST /api/search
  {playlists, pings, regions}` (a signed-in account's; 30 an account in 10 minutes) starts it: refused 401 signed out,
  403 `queue-banned` (until when) or `in-match`, 429 `cooldown` (seconds) or `busy`, 503 `no-server` (no ticked region
  answered the page's ping; a server name that isn't host:port, one given twice or a ping out of range is dropped, not
  the search: RV-868); else `{search, version, state}`. `GET /api/search/{id}?after=N` (the searcher's own session:
  401 without, 404 for another account's, RV-871; read with no rotation, so a poll aborted before it answers never
  loses a renewed cookie, RV-889; each poll reads the database, so a database blip answers 503, which the page retries
  for about 23 s, RV-890) answers at its next change or after 25 s (a newer poll answers the one before at once):
  `searching`, `found` (the match's id, its server, the player's match ticket, the playlist), or `ended` (`replaced`,
  `queue-banned`, `cooldown`); 404 for one it doesn't know (a restart: the page searches again once). A search is
  matched only after its first poll (RV-892). `DELETE /api/search/{id}` is Cancel Search (the page sends it too as it
  closes, RV-866; the searcher's own session, read with no rotation: RV-896, RV-889). The access log names
  each request's route pattern, never its path (a search's id: RV-871). A match ticket (format 4)
  is one seat of one match at one server, 30 s, taken once there (RV-850).
- **Rejoin tickets** (`POST /api/ticket?rejoin=MATCH`, 16 hex digits; 60 an account in 10 minutes): two minutes long,
  for that match's rejoin alone, refused (409 `in-match`) while the account searches, for a match other than its latest,
  or once a later search gave that match up, whether or not it found a match (RV-869); a queue ban from that match
  doesn't refuse it. `POST /api/ticket` with no match (a search ticket, format 3)
  stays one release, for pages from before the switch.
- **The game server's calls** (behind the Access service token and `GAME_SERVER_TOKEN_FILE`): the matchmaker's events
  (`POST /api/fleet/events {event, server, match, seat, noShows, at}`: one about a match it didn't assign to that server,
  or doesn't know, answered 204 and ignored, so it never holds the outbox's later calls); results (recorded once by
  their match id; each ticket ours, a match ticket for that match or a search ticket from before the switch, issued
  within 24 h and spent on that match alone; the ratings changed: Glicko-2),
  quitters (the seat's ticket, spent on its match; the account's queue ban up the ladder 5 min, 15 min, 1 h, 6 h, 24 h,
  a step forgiven per 24 h without a leave) and refills (the rejoin's ticket for that match, spent: that ban undone). Results are kept a year; used tickets past the window are purged hourly. **Rotating the key:** make a new one
  (`carball-api ticket-key k2`), add its public line to the game server's `TICKET_PUBLIC_KEYS` beside the old and
  restart it, then switch the API to the new id and seed, and drop the old line once its last tickets have run out (two
  minutes on).

```sh
# the migrations, once per new image, as the schema's owner (its password in this run only)
docker run --rm --network carball \
  -e MIGRATE_DATABASE_URL=postgres://carball_owner@carball-db:5432/carball \
  -e MIGRATE_DATABASE_PASSWORD_FILE=/run/secrets/db_owner_password -e DATABASE_URL=postgres://carball_app@carball-db:5432/carball \
  -v /path/to/owner-secret:/run/secrets:ro carball-api:TAG migrate
# the service, as its rows-only role; cloudflared a container on the carball network (172.18.0.0/16 here), so no port
# published (cloudflared on the host instead: -p 127.0.0.1:8080:8080 and TRUSTED_PROXIES the network's gateway, /32)
docker run -d --name carball-api --restart unless-stopped --network carball --read-only \
  -e DATABASE_URL=postgres://carball_app@carball-db:5432/carball -e DATABASE_PASSWORD_FILE=/run/secrets/db_password \
  -e TRUSTED_PROXIES=172.18.0.0/16 \
  -e GOOGLE_CLIENT_ID=… -e GOOGLE_CLIENT_SECRET_FILE=/run/secrets/google_client_secret \
  -e TURNSTILE_SITE_KEY=… -e TURNSTILE_SECRET_FILE=/run/secrets/turnstile_secret \
  -e TICKET_KEY_ID=k1 -e TICKET_SIGNING_KEY_FILE=/run/secrets/ticket_key \
  -e GAME_SERVER_TOKEN_FILE=/run/secrets/game_server_token \
  -e DELETION_HMAC_KEY_FILE=/run/secrets/deletion_key -v /path/to/secrets:/run/secrets:ro carball-api:TAG
```

## Checked (2026-10-15, Docker 29.9 on the development VM; again for every change to the images or this contract)

2026-10-23 (the working tree on b524503, the build moved into the root `Dockerfile`: `scripts/build_images.sh --worktree
dockertest`): the checks stage passed (the engine's native and WebAssembly builds simulating bit-identically, the
same 300 s determinism hash as the previous toolchains' builds; the names guards; no build paths in either binary). The
web image's files equal the previous build's (b524503's) except the two WebAssembly modules (the official Emscripten
image's LLVM, not the development machine's: the same physics, above) and the chunk names that follow them. On
127.0.0.1, 16 container checks: web `/healthz`, `config.json` from `GAME_SERVER_URL` with `no-store`, the engine as
`application/wasm`, the policy naming the game server, an unknown route the page, uid 101, a non-https URL exiting it;
game uid 10001, a `MESHES_DIR` without the arena's meshes exiting it (the folder named), `--dev` starting and
`--healthcheck` 0; api uid 10002, refused without its settings (the development matchmaker listens on loopback only,
so it ran in the browser tests instead). The browser tests against the images, 80/80: the web image's files as the
page, the game image's binary as every game server and the API image's as every development matchmaker
(`CARBALL_E2E_GAME_BIN`, `CARBALL_E2E_API_BIN`).

2026-10-22 (the working tree on 0297a88, regions: `scripts/build_images.sh --worktree ranked3b`): the checks below again,
and five more for the web image's `GAME_SERVERS`, 49 in all: three servers in `/config.json` in order (the first its
`gameServer`) and each one's origin in `connect-src`; set but empty, an entry with a bad name, and an id given twice,
each refused at start.

2026-10-22 (the working tree on a88691e, protocol 27 and ticket format 3, ranked step 3 with the AP3, RX29C and RX30C
fixes: `scripts/build_images.sh --worktree ranked3`; the database a host Postgres from initdb/pg_ctl on the throwaway
network's gateway, no Postgres container): the three images built, no build machine's paths in either binary, the
names guard over each image's files. Run on a throwaway network, 44 checks passed:
- web: the policy's Turnstile sources and `frame-ancestors 'none'`; `/api/me`, `/api/results`, `/api/auth/google/start`
  a 404 with `no-store` and the security headers; `/privacy.html` naming the game server's addresses; `/config.json`.
- game: refused without ticket keys, with a list naming no key, with both a list and a file, without `API_URL`, with
  an http `API_URL`, with `--dev` beside production keys or a certificate, for the open match with a certificate, and
  with an `OUTBOX_DIR` it can't write or a blank one; healthy with a keys file, `API_URL` and a certificate, naming its outbox, which
  its user can write; the keys file reloaded on SIGHUP (a second key added), kept when the new file names none;
  `--dev` starting alone, its calls logged only.
- api: `migrate` as the owner's role, the ranked tables made; refused without `TRUSTED_PROXIES`, with a short game
  server token, or without one; healthy with the network's subnet, its list logged; `/api/me` 401;
  `/api/results` 401 without or with a wrong token, 400 for an empty result; `/api/quitters` and `/api/refills` 400 for
  an empty report; with a wrong list, the one warning naming the peer's kind, no address in the log; `healthcheck` 0.

2026-10-18 (the working tree on ee08521, protocol 26, accounts step 2: `scripts/build_images.sh --worktree step2c`):
the three images built, no build machine's paths in either binary, the names guard over each image's files. Run on a
throwaway network, 27 checks passed:
- web: the policy's `script-src` and `frame-src` with Turnstile's origin, `connect-src` the game server's;
  `/api/me`, `/api/healthz`, `/api/auth/google/start` a 404 with `no-store` and the security headers; `/privacy.html`,
  `/config.json` and a route the page's.
- game: refused without `TICKET_PUBLIC_KEYS` or with it blank (queue mode, no `--dev`); healthy with it and a
  certificate mounted; `--dev` starting without keys.
- api:
  - `migrate` as the owner's role; refused without `TRUSTED_PROXIES`;
  - healthy with the network's subnet, its list logged; `/api/me` a 401 from a container on the network, no warning;
  - with a wrong list, the one warning naming the peer's kind (private), no address in the log; `healthcheck` exit 0.

2026-10-17 (3c8622b, protocol 25; the static session's review RX23): both images built from `scripts/build_images.sh`
(the pinned base images by digest, built offline) and run on 127.0.0.1: the game container healthy, a 1v1 through it
(map 0), the web container serving the bots with no Content-Security-Policy violation, onnxruntime on one thread
without cross-origin isolation. The `/bots/` 404 (RV-537) came after it, checked from the configuration
(`client/src/testing/webImage.test.ts`), then in a container by the review RX24 (be5653a's images: 40 paths against
RX23's, only `/bots/*` changed).

2026-10-15:

Both images built from `scripts/build_images.sh`. Web: `/healthz` 200, `/config.json` from `GAME_SERVER_URL` (no-store),
the hashed assets cached and gzipped, the engine served as `application/wasm`, unknown paths `index.html`, a non-https
`GAME_SERVER_URL` exits the container (status 1), as do a port outside 1–65535 or a malformed host (RV-430); started
without the entrypoint it still has the default `config.json` and policy (RV-431); HEALTHCHECK healthy. Game: a
`MESHES_DIR` without `arena/*.cmf` exits it (status 1, the folder named: RV-421); starts with a certificate mounted read-only at
`/certs` as uid 10001, `--healthcheck` exits 0, HEALTHCHECK healthy, replacing the mounted files and SIGHUP each reload
the certificate with the server running, `docker stop` ends it in ~0.65 s (SIGTERM). Two pages from the web image on the
host found a 1v1 through a game container over UDP (development mode: a publicly trusted certificate can't be made
locally, see `CERT_PATH`).

## Example (docker run)

```sh
docker run -d --name carball-web --restart unless-stopped -p 127.0.0.1:3000:3000 \
  -e GAME_SERVER_URL=https://game.carball.zolt.top:4433/play carball-web:TAG
# (the outbox on a named volume: an anonymous one is lost when the container is made anew, and the calls waiting in it)
docker run -d --name carball-game --restart unless-stopped -p 0.0.0.0:4433:4433/udp \
  -e "TICKET_PUBLIC_KEYS=k1 BASE64PUBLICKEY" -e API_URL=https://carball.zolt.top \
  -e GAME_SERVER_TOKEN_FILE=/run/secrets/game_server_token \
  -e CF_ACCESS_CLIENT_ID=… -e CF_ACCESS_CLIENT_SECRET_FILE=/run/secrets/access_secret \
  -v /path/to/game-secrets:/run/secrets:ro -v carball-game-outbox:/var/lib/carball-game \
  -v /path/to/certs:/certs:ro carball-game:TAG
# the server's flags go after the image name, e.g. carball-game:TAG --max-per-address 16
```
