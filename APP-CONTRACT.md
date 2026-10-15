# App contract

What the two images need from the host and what they give it. Provisioning, DNS, firewalls and certificate renewal are
the hosting side's (not here).

| Image | What | Port | Reached at |
|---|---|---|---|
| `carball-web` | the web client: static files (nginx) | **3000/tcp** (plain HTTP; TLS in front, e.g. the tunnel) | `https://carball.zolt.top` |
| `carball-game` | the game server: matches over WebTransport (HTTP/3, QUIC) | **4433/udp** (`GAME_PORT`), public, nothing else published | `game.carball.zolt.top` (DNS only, no proxy: it's UDP) |

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
refused with a message).

## carball-web

| Env | Default | |
|---|---|---|
| `GAME_SERVER_URL` | `https://game.carball.zolt.top:4433/play` | the game server's WebTransport URL; written into `/config.json` at start (`https://HOST[:PORT]/PATH`, else the container exits) |

- **Port:** 3000/tcp, plain HTTP. `/assets/*` (hashed names) cached for a year, the rest `no-cache`, `/config.json`
  `no-store`; unknown paths serve `index.html`. Every response carries `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a Content-Security-Policy (this origin only, but the game
  server over https and a development server's info on localhost; `frame-ancestors 'none'`; no eval). The third-party
  notices are at `/THIRD_PARTY_NOTICES.txt`.
- **User:** nginx runs unprivileged (uid 101, nginx 1.30, the stable line); only `/config.json` is writable to it.
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
| `RL_MODE` | `queue` | `queue`: the 1v1 / 2v2 / 3v3 queue (searches and claims only); `direct`: one open match (development) |
| `HEALTH_PORT` | `8081` | the health endpoint, on 127.0.0.1 inside the container only |
| `MESHES_DIR` | `/app/collision_meshes` | the arena's collision meshes (in the image) |

A development run of the image takes `--dev`: a self-signed certificate made at start whatever `CERT_PATH` and `KEY_PATH`
say, pinned by the page through the info endpoint (the info reports the game port inside the container, so publish it as
the same port): `docker run --rm -e GAME_PORT=14502 -p 14502:14502/udp -p 127.0.0.1:14503:4434
-e ALLOWED_ORIGIN=http://localhost:13000 carball-game:TAG --dev --info-bind 0.0.0.0`, the page opened with
`?queue=localhost:14503`.

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
- **Health:** `rl-server --healthcheck` (the image's `HEALTHCHECK`, every 15 s): `GET http://127.0.0.1:$HEALTH_PORT/healthz`
  answers 200 while the game thread runs (its heartbeat within 2 s), else 503.
- **Restart policy:** `unless-stopped` (or `always`). The process exits if its game thread ends (a panic outside a
  match: a panic inside one ends only that match) or the engine aborts.
- **Stop:** SIGTERM or SIGINT ends it at once; the matches in progress end with it.
- **Limits it enforces:** a client proves its address (a QUIC Retry) before it takes a slot; 512 sessions at once; per
  client address (an IPv6 one by its /64) 8 at once and 30 new a minute; 4 s for the QUIC handshake, 10 s through the
  hello; 240 input packets and 20 control messages a second per session (more are dropped; a session that keeps
  flooding either is closed); QUIC: 4 streams each way, small receive windows.
- **The queue's no-shows:** a found match waits 12 s for its players to claim their slots; cancelled for someone (a
  slot not claimed, or a player leaving before the start), the others search again at the front of the queue, and whoever
  stalled it can't search for 2 minutes (by the browser's key and by address).
- **Resources** (measured, RX13): one game thread runs every match (120 Hz each): ~0.7 % of a core a 1v1, ~1.8 % a 3v3
  (all threads ~2.1 % / ~5.5 %), so the game thread caps a server near 55 3v3 matches. Memory ~8 MB idle, ~1.4 MB a 1v1
  and ~1.8 MB a 3v3. Bandwidth per player: ~3.4 KB/s down in a 1v1, ~5.6 KB/s in a 3v3; ~5–13 KB/s up (inputs).
- **Logs:** stdout (start-up) and stderr (joins, leaves, matches, refusals, reloads), one line each.

## Checked (2026-10-15, Docker 29.9 on the development VM; again for every change to the images or this contract)

Both images built from `scripts/build_images.sh`. Web: `/healthz` 200, `/config.json` from `GAME_SERVER_URL` (no-store),
the hashed assets cached and gzipped, the engine served as `application/wasm`, unknown paths `index.html`, a non-https
`GAME_SERVER_URL` exits the container (status 1), HEALTHCHECK healthy. Game: starts with a certificate mounted read-only at
`/certs` as uid 10001, `--healthcheck` exits 0, HEALTHCHECK healthy, replacing the mounted files and SIGHUP each reload
the certificate with the server running, `docker stop` ends it in ~0.65 s (SIGTERM). Two pages from the web image on the
host found a 1v1 through a game container over UDP (development mode: a publicly trusted certificate can't be made
locally, see `CERT_PATH`).

## Example (docker run)

```sh
docker run -d --name carball-web --restart unless-stopped -p 127.0.0.1:3000:3000 \
  -e GAME_SERVER_URL=https://game.carball.zolt.top:4433/play carball-web:TAG
docker run -d --name carball-game --restart unless-stopped -p 4433:4433/udp \
  -v /path/to/certs:/certs:ro carball-game:TAG
```
