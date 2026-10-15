# App contract

What the two images need from the host and what they give it. Provisioning, DNS, firewalls and certificate renewal are
the hosting side's (not here).

| Image | What | Port | Reached at |
|---|---|---|---|
| `carball-web` | the web client: static files (nginx) | **3000/tcp** (plain HTTP; TLS in front, e.g. the tunnel) | `https://carball.zolt.top` |
| `carball-game` | the game server: matches over WebTransport (HTTP/3, QUIC) | **4433/udp** (`GAME_PORT`), public, nothing else published | `game.carball.zolt.top` (DNS only, no proxy: it's UDP; **an A record only, no AAAA**: see below) |

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
scripts/build_images.sh [TAG]              # from the commit (HEAD); TAG defaults to its short hash
scripts/build_images.sh --worktree TAG     # testing a change before its commit
```
It builds from the commit only: `git archive` stages its sources under `out/images/<TAG>-<time>/src` (nothing uncommitted
or git-ignored gets in; with `--worktree`, the working tree's files that are committed or would be, never ignored ones).
There it builds the engine's WebAssembly (Emscripten), the client (`npm run build`, then the shipped-data check on what it
built) and the server (`cargo build --release --offline` in `out/images/target`, whatever `CARGO_TARGET_DIR` says: a
development server's binary is left alone; no debug info, symbols stripped, the build machine's paths remapped), stages
each image's files alone under `out/images/<TAG>-<time>/{web,game}` (the repo's `out/` holds local-only data and is never
a build context), and runs `docker build -t carball-web:TAG …/web` and `docker build -t carball-game:TAG …/game`. Both
bases are pinned by digest (update a base's tag and digest together). Then:
```sh
docker save carball-web:TAG | gzip > carball-web-TAG.tar.gz       # on the host: docker load < carball-web-TAG.tar.gz
docker save carball-game:TAG | gzip > carball-game-TAG.tar.gz
docker tag carball-web:TAG REGISTRY/carball-web:TAG && docker push REGISTRY/carball-web:TAG    # or a registry
docker tag carball-game:TAG REGISTRY/carball-game:TAG && docker push REGISTRY/carball-game:TAG
```
Client and server must come from the same commit (the protocol version is checked at the handshake: an older page is
refused with a message). Rolling the web image back to before 48388aa (the browser storage's keys renamed, moved over
once by the newer page) shows players the default settings and gives them a new browser key on the older page, and what
they change there is lost when the newer page returns (RV-425; `client/src/settings/storageKeys.ts`).

## carball-web

| Env | Default | |
|---|---|---|
| `GAME_SERVER_URL` | `https://game.carball.zolt.top:4433/play` | the game server's WebTransport URL; written into `/config.json` at start (`https://HOST[:PORT]/PATH`, else the container exits: set but empty too, RV-441), and its origin is the page's only `connect-src` besides its own |
| `EXTRA_CONNECT_SRC` | (none) | testing only: more `connect-src` sources (e.g. `http://127.0.0.1:14503 https://127.0.0.1:14502` for a development server's info and port); space-separated `SCHEME://HOST[:PORT]` (http, https, ws, wss; the port 1–65535 or `*`), else the container exits. `GAME_SERVER_URL` likewise allows only letters, digits and `. - _ ~ /` after `https://`, one line |

- **Port:** 3000/tcp, plain HTTP. `/assets/*` (hashed names) cached for a year, the rest `no-cache`, `/config.json`
  `no-store`; unknown paths serve `index.html`. Every response carries `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a Content-Security-Policy (this origin only, but the game
  server's origin from `GAME_SERVER_URL`; `frame-ancestors 'none'`; no eval). Redirects are relative (a directory's
  trailing slash), so nothing names the container's port behind the tunnel. The third-party notices are at
  `/THIRD_PARTY_NOTICES.txt`.
- **User:** nginx runs unprivileged (uid 101, nginx 1.30, the stable line). The site and all of `/etc/nginx` are root's,
  read-only to it; it writes `/config.json` and the policy (`/etc/nginx/carball-csp.conf`; both baked in at build for the
  default `GAME_SERVER_URL`, so a container started without the entrypoint still has them) at start, and its pid and
  buffers under `/tmp` and `/var/cache/nginx`. The root filesystem must be writable (`--read-only` stops it: the start
  can't write those two files). (The base image's `EXPOSE 8080` stays in its metadata: the server listens on 3000 only.)
- **Labels:** `org.opencontainers.image.title`, `.revision` (the commit) and `.version` (the tag), and `carball.source`:
  `commit`, or `worktree` for an image built with `--worktree` (both images).
- **Volumes:** none.
- **Health:** `GET /healthz` → `200 ok` (the image's `HEALTHCHECK` uses it).
- **Resources:** ~10 MB RAM, negligible CPU; a first visit loads ~2.5 MB of files (~0.9 MB gzipped).
- **Logs:** nginx's access and error logs on stdout/stderr.
- **Start/stop:** nginx's. The image's stop signal is SIGQUIT (a graceful stop: requests in flight finish), which
  `docker stop` sends.

## carball-game

| Env | Default in the image | |
|---|---|---|
| `GAME_PORT` | `4433` | the UDP port (publish the same port: `-p 4433:4433/udp`) |
| `PUBLIC_HOST` | `game.carball.zolt.top` | the name clients reach it at (logged; the certificate must be for it) |
| `ALLOWED_ORIGIN` | `https://carball.zolt.top` | the page origin(s) allowed to open sessions, comma-separated (case doesn't matter); others (and none) get 403. Required with a certificate: empty or blank, the server refuses to start |
| `CERT_PATH` | `/certs/fullchain.pem` | the certificate chain (PEM) for `PUBLIC_HOST`, publicly trusted (browsers refuse a self-signed one; in a test, Chrome's WebTransport refused a locally trusted test CA and ignored `--ignore-certificate-errors*` too). Required in queue mode (an empty one is an error: no silent self-signed server) |
| `KEY_PATH` | `/certs/privkey.pem` | its private key (PEM); a key that isn't the certificate's is refused (the old pair stays, tried again) |
| `SERVER_MODE` | `queue` | `queue`: the 1v1 / 2v2 / 3v3 queue (searches and claims only); `direct`: one open match (development) |
| `HEALTH_PORT` | `8081` | the health endpoint, on 127.0.0.1 inside the container only |
| `MESHES_DIR` | `/app/collision_meshes` | the arena's collision meshes (in the image; keep the default: the image's own): a folder whose `arena/` holds the arena's 16 meshes in this image's format, the 4 goal halves placed by their offset. Anything else (empty, the old `soccar/` layout, a partial copy, meshes from before 8f78a1a, a truncated file) stops the server at start, saying what's wrong (RV-421, RV-434) |

A development run of the image takes `--dev`: a self-signed certificate made at start whatever `CERT_PATH` and `KEY_PATH`
say, pinned by the page through the info endpoint (the info reports the game port inside the container, so publish it as
the same port): `docker run --rm -e GAME_PORT=14502 -p 127.0.0.1:14502:14502/udp -p 127.0.0.1:14503:4434
-e ALLOWED_ORIGIN=http://localhost:13000 carball-game:TAG --dev --info-bind 0.0.0.0`, the page opened with
`?queue=localhost:14503` (a web container for it run with `-e GAME_SERVER_URL=https://localhost:14502/play
-e "EXTRA_CONNECT_SRC=http://127.0.0.1:14503 https://127.0.0.1:14502"`: the page reaches a development server on
`localhost` at 127.0.0.1).

- **Ports:** 4433/udp only. Nothing listens on TCP outside the container (the health endpoint is 127.0.0.1; the
  development info server is off with a certificate).
- **Volumes:** the certificate directory, read-only, at `/certs` (e.g. `-v /etc/letsencrypt/live/game.carball.zolt.top:/certs:ro`
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
- **Stop:** SIGTERM or SIGINT ends it at once; the matches in progress end with it.
- **Limits it enforces:** a client proves its address (a QUIC Retry) before it takes a slot; 512 sessions at once; per
  client address (an IPv6 one by its /64) 8 at once and 30 new a minute (a large carrier NAT or NAT64 exit can hold more players than that: RV-418, raise `--max-per-address` if they're refused; it is a flag, given after the image name in `docker run`); 4 s for the QUIC handshake, 10 s through the
  hello; 240 input packets and 20 control messages a second per session (more are dropped; a session that keeps
  flooding either is closed); QUIC: 4 streams each way, small receive windows.
- **The queue's no-shows:** a found match waits 12 s for its players to claim their slots; cancelled for someone (a
  slot not claimed, or a player leaving before the start), the others search again at the front of the queue, and whoever
  stalled it can't search for 2 minutes by their browser's key, their other waiting searches let go too. Their address
  (IPv4, or an IPv6 /64) is blocked as well after two different keys stalled from it within 10 minutes, or at once for a
  search without a key (either is often shared: a carrier's NAT, a dorm, a household, public Wi-Fi: RV-385, RV-407), and
  then the page says the network's searches are paused, blaming no one.
- **Resources** (measured, RX13): one game thread runs every match (120 Hz each): ~0.7 % of a core a 1v1, ~1.8 % a 3v3
  (all threads ~2.1 % / ~5.5 %), so the game thread caps a server near 55 3v3 matches. Memory ~8 MB idle, ~1.4 MB a 1v1
  and ~1.8 MB a 3v3. Bandwidth per player: ~3.4 KB/s down in a 1v1, ~5.6 KB/s in a 3v3; ~5–13 KB/s up (inputs).
- **Logs:** stdout (start-up) and stderr (joins, leaves, matches, refusals, reloads), one line each.

## Checked (2026-10-15, Docker 29.9 on the development VM; again for every change to the images or this contract)

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
docker run -d --name carball-game --restart unless-stopped -p 0.0.0.0:4433:4433/udp \
  -v /path/to/certs:/certs:ro carball-game:TAG
# the server's flags go after the image name, e.g. carball-game:TAG --max-per-address 16
```
