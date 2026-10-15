# App contract

What the two images need from the host and what they give it. Provisioning, DNS, firewalls and certificate renewal are
the hosting side's (not here).

| Image | What | Port | Reached at |
|---|---|---|---|
| `carball-web` | the web client: static files (nginx) | **3000/tcp** (plain HTTP; TLS in front, e.g. the tunnel) | `https://carball.zolt.top` |
| `carball-game` | the game server: matches over WebTransport (HTTP/3, QUIC) | **4433/udp** (`GAME_PORT`), public, nothing else published | `game.carball.zolt.top` (DNS only, no proxy: it's UDP) |

## Build, export, push

```sh
scripts/build_images.sh [TAG]          # TAG defaults to the commit's short hash
```
It builds the client (`npm run build`, then the shipped-data check) and the server (`cargo build --release`) on this
machine, stages each image's files alone under `out/images/<TAG>-<time>/{web,game}` (the repo's `out/` holds local-only
data and is never a build context), and runs `docker build -t carball-web:TAG …/web` and `docker build -t
carball-game:TAG …/game`. Then:
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
  `no-store`; unknown paths serve `index.html`.
- **Volumes:** none.
- **Health:** `GET /healthz` → `200 ok` (the image's `HEALTHCHECK` uses it).
- **Resources:** ~10 MB RAM, negligible CPU; a first visit loads ~2.5 MB of files (~0.9 MB gzipped).
- **Logs:** nginx's access and error logs on stdout/stderr.
- **Start/stop:** nginx's; SIGTERM stops it gracefully.

## carball-game

| Env | Default in the image | |
|---|---|---|
| `GAME_PORT` | `4433` | the UDP port (publish the same port: `-p 4433:4433/udp`) |
| `PUBLIC_HOST` | `game.carball.zolt.top` | the name clients reach it at (logged; the certificate must be for it) |
| `ALLOWED_ORIGIN` | `https://carball.zolt.top` | the page origin(s) allowed to open sessions, comma-separated; others (and none) get 403 |
| `CERT_PATH` | `/certs/fullchain.pem` | the certificate chain (PEM) for `PUBLIC_HOST`, publicly trusted (browsers refuse a self-signed one) |
| `KEY_PATH` | `/certs/privkey.pem` | its private key (PEM) |
| `RL_MODE` | `queue` | `queue`: the 1v1 / 2v2 / 3v3 queue (searches and claims only); `direct`: one open match (development) |
| `HEALTH_PORT` | `8081` | the health endpoint, on 127.0.0.1 inside the container only |
| `MESHES_DIR` | `/app/collision_meshes` | the arena's collision meshes (in the image) |

- **Ports:** 4433/udp only. Nothing listens on TCP outside the container (the health endpoint is 127.0.0.1; the
  development info server is off with a certificate).
- **Volumes:** the certificate directory, read-only, at `/certs` (e.g. `-v /etc/letsencrypt/live/game.carball.zolt.top:/certs:ro`
  with the archive files it links to reachable). The process runs as **uid 10001**: the key must be readable by it (a
  copy owned by or readable to 10001, or `--user` set to the files' owner).
- **Certificate reload:** the files are checked every 5 s (modification times) and read again when either changes, or at
  once on **SIGHUP** (`docker kill --signal=HUP carball-game`). New sessions get the new certificate; sessions open at the
  time keep theirs, so no match is dropped. A file that can't be read (half-written) keeps the old certificate and is
  tried again at the next check; each reload, or failure, is one log line.
- **Health:** `rl-server --healthcheck` (the image's `HEALTHCHECK`, every 15 s): `GET http://127.0.0.1:$HEALTH_PORT/healthz`
  answers 200 while the game thread runs (its heartbeat within 2 s), else 503.
- **Restart policy:** `unless-stopped` (or `always`). The process exits if its game thread ends (a panic outside a
  match: a panic inside one ends only that match) or the engine aborts.
- **Stop:** SIGTERM or SIGINT ends it at once; the matches in progress end with it.
- **Limits it enforces:** 512 sessions at once; per client address 8 at once and 30 new a minute; 10 s for a handshake
  through the hello; 240 input packets and 20 control messages a second per session (more are dropped; a session that
  keeps flooding is closed); QUIC: 4 streams each way, small receive windows.
- **Resources:** one game thread runs every match (120 Hz each); the physics is ~13 µs a tick for 4 cars, so a 3v3
  match costs ~1 % of a core with the server's own work; plan 1 core for ~50 matches. Memory ~10 MB idle, a few MB a
  match. Bandwidth per player: 3.5 / 4.7 / 6.1 KB/s down in a 1v1 / 2v2 / 3v3, ~5–13 KB/s up (inputs).
- **Logs:** stdout (start-up) and stderr (joins, leaves, matches, refusals, reloads), one line each.

## Example (docker run)

```sh
docker run -d --name carball-web --restart unless-stopped -p 127.0.0.1:3000:3000 \
  -e GAME_SERVER_URL=https://game.carball.zolt.top:4433/play carball-web:TAG
docker run -d --name carball-game --restart unless-stopped -p 4433:4433/udp \
  -v /path/to/certs:/certs:ro carball-game:TAG
```
