# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# Carball's three images (APP-CONTRACT.md), built from the commit alone: scripts/build_images.sh sends `git archive`'s
# files as the context (with --worktree, the working tree's committed or new files), checks them (`--target checks`),
# then builds each image (`--target web`, `game`, `api`). Every compiler runs here, from official images pinned by digest
# (update a tag and its digest together); the final images are the slim runtimes with the outputs alone.
#
# Caching: each build stage is cached by its inputs' content (Docker's layers), so a release that doesn't touch the
# engine reuses its three C++ builds (the WebAssembly module, the local host's libraries, the server's), and one that
# doesn't touch the server reuses both of its. Cargo's registry and target are cache mounts, the server's own crate
# cleaned and built again each time (the context's file times are the commit's, which make and cargo can't go by);
# npm's and Go's are content-addressed caches.
#
# (KEY_PATH and the `*_FILE` variables name files, not secrets: the check that flags them is skipped above)

# (each compiler's parallel jobs: the three engine builds and two cargo builds can run at once)
ARG JOBS=8

FROM emscripten/emsdk:6.0.13@sha256:fb7864e398acfda863dfcea78b8bc8adad359fa60c6a0bbeb845931de64aa68a AS emsdk
FROM rust:1.91.1-trixie@sha256:867f1d1162913c401378a8504fb17fe2032c760dc316448766f150a130204aad AS rust
FROM node:26.12.0-trixie-slim@sha256:e556a144463cc8dc53afe8de6d2fa0db5c132fd39ffa232c17641bd40df2bf11 AS node
FROM golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4 AS golang

# The engine's WebAssembly module, the client's engine (carball_engine*.mjs/.wasm/.d.mts)
FROM emsdk AS engine-wasm
ARG JOBS
WORKDIR /src
COPY engine/ engine/
RUN emcmake cmake -S engine -B engine/build-wasm -DCMAKE_BUILD_TYPE=Release > /dev/null \
    && emmake make -C engine/build-wasm -j"$JOBS" rlengine rlengine_web \
    && mkdir /out && cd engine/build-wasm \
    && cp carball_engine.mjs carball_engine.wasm carball_engine.d.mts carball_engine_web.mjs carball_engine_web.wasm carball_engine_web.d.mts /out/

# The local host's engine libraries (scripts/build_host.sh's first step)
FROM emsdk AS host-engine
ARG JOBS
WORKDIR /src
COPY engine/ engine/
COPY scripts/build_host.sh scripts/
RUN CARBALL_ENGINE_WASM=/src/engine/build-wasm-host bash scripts/build_host.sh engine

# The local host (the offline match against bots): the server's match for wasm32-unknown-emscripten, linked with them
# (scripts/build_host.sh's second step), Rust beside Emscripten
FROM emsdk AS host
ARG JOBS
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=rust /usr/local/cargo /usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN rustup target add wasm32-unknown-emscripten
WORKDIR /src
COPY server/ server/
COPY scripts/build_host.sh scripts/
COPY --from=host-engine /src/engine/build-wasm-host/ engine/build-wasm-host/
RUN --mount=type=cache,id=carball-cargo-registry-host,target=/usr/local/cargo/registry \
    --mount=type=cache,id=carball-target-host,target=/target,sharing=locked \
    find server -type f -exec touch {} + \
    && CARGO_BUILD_JOBS="$JOBS" CARGO_OFFLINE=0 CARGO_TARGET_DIR=/target CARBALL_ENGINE_WASM=/src/engine/build-wasm-host bash scripts/build_host.sh host \
    && mkdir /out && cp engine/build-wasm-host/carball_host.mjs engine/build-wasm-host/carball_host.wasm /out/

# The engine's libraries for the server, as cargo's CMake build makes them (its flags; server/build.rs)
FROM rust AS server-engine
ARG JOBS
RUN apt-get update && apt-get install -y --no-install-recommends cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY engine/ engine/
RUN flags="-ffunction-sections -fdata-sections -fPIC -m64 -w" \
    && cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="$flags" -DCMAKE_CXX_FLAGS="$flags" > /dev/null \
    && cmake --build engine/build --target rlengine_capi -j"$JOBS" \
    && mkdir -p /out/rocketsim && cp engine/build/*.a /out/ && cp engine/build/rocketsim/libRocketSim.a /out/rocketsim/

# The engine's test programs as the server's and the client's toolchains build them (the libraries above reused, their
# flags): native and WebAssembly must simulate bit-identically, the server and the browsers running the same physics
# (engine/tests/check_native_wasm.sh: a scripted 2v2, the arena smoke test, the network state, rollback)
FROM server-engine AS engine-tests-native
COPY out/arena/collision_meshes/ out/arena/collision_meshes/
RUN cmake --build engine/build --target determinism arena_smoketest netstate rollback -j"$JOBS"
FROM engine-wasm AS engine-tests-wasm
COPY out/arena/collision_meshes/ out/arena/collision_meshes/
RUN emmake make -C engine/build-wasm -j"$JOBS" determinism arena_smoketest netstate rollback
FROM engine-tests-native AS engine-check
COPY --from=emsdk /emsdk/node/ /opt/node/
COPY --from=engine-tests-wasm /src/engine/build-wasm/ engine/build-wasm/
RUN PATH="$(echo /opt/node/*/bin):$PATH" sh engine/tests/check_native_wasm.sh 300 && touch /engine-identical

# The server's release binary: no debug info, the registry's and the home directory's paths remapped, libstdc++ linked in
FROM rust AS server
ARG JOBS
WORKDIR /src
COPY server/ server/
COPY --from=server-engine /out/ /engine/
RUN --mount=type=cache,id=carball-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=carball-target,target=/target,sharing=locked \
    find server -type f -exec touch {} + \
    && CARGO_BUILD_JOBS="$JOBS" CARBALL_ENGINE_NATIVE=/engine CARGO_TARGET_DIR=/target CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=symbols \
       RUSTFLAGS="--remap-path-prefix=/usr/local/cargo=/cargo --remap-path-prefix=/root=/home" \
       cargo build --release --locked --manifest-path server/Cargo.toml \
    && mkdir /out && cp /target/release/carball-server /out/

# The accounts service's release binary: static, no cgo (the image has no C library to match), the paths trimmed, no
# build id; the modules go.sum pins, checked against the checksum database; the image's Go, never a downloaded one
FROM golang AS api-build
WORKDIR /src/api
COPY api/go.mod api/go.sum ./
RUN --mount=type=cache,id=carball-gomod,target=/go/pkg/mod go mod download
COPY api/ ./
RUN --mount=type=cache,id=carball-gomod,target=/go/pkg/mod --mount=type=cache,id=carball-gobuild,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOFLAGS=-mod=readonly GOWORK=off GOTOOLCHAIN=local \
    go build -trimpath -ldflags="-s -w -buildid=" -o /out/carball-api ./cmd/carball-api

# The client's production build, the shipped-data and names checks on what it built
FROM node AS client
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN --mount=type=cache,id=carball-npm,target=/root/.npm npm ci --no-audit --no-fund
WORKDIR /src
COPY protocol/ protocol/
COPY out/arena/ out/arena/
COPY client/ client/
COPY --from=engine-wasm /out/ engine/build-wasm/
COPY --from=host /out/ engine/build-wasm-host/
WORKDIR /src/client
RUN npm run build && node_modules/.bin/vitest run src/render/shippedData.test.ts src/render/shippedNames.test.ts

# The checks (scripts/build_images.sh builds this first): the engine native = WebAssembly (above); the names guard (no game's,
# maker's or mode names, RV-384/423) over each image's files and its stage of this file (what ships of it: its
# instructions, in the image's history; the build stages never ship), and no build paths in either binary (the home,
# registry, target and prebuilt libraries' directories here, unremapped: RV-380, RV-414; the remapped /src and /cargo
# paths of panic messages are the ones the old builds had too)
FROM client AS checks
COPY --from=engine-check /engine-identical /tmp/engine-identical
COPY --from=server /out/carball-server /game/carball-server
COPY out/arena/collision_meshes/ /game/collision_meshes/
COPY --from=api-build /out/carball-api /api/carball-api
COPY Dockerfile /tmp/Dockerfile
RUN awk '/^FROM .* AS game$/ { p = 1 } /^FROM .* AS api$/ { p = 0 } p' /tmp/Dockerfile > /game/Dockerfile \
    && awk '/^FROM .* AS api$/ { p = 1 } p' /tmp/Dockerfile > /api/Dockerfile \
    && grep -q '^ENTRYPOINT \["/app/carball-server"\]' /game/Dockerfile && grep -q '^ENTRYPOINT \["/app/carball-api"\]' /api/Dockerfile \
    && SHIPPED_GAME_DIR=/game node_modules/.bin/vitest run src/render/shippedNames.test.ts \
    && SHIPPED_API_DIR=/api node_modules/.bin/vitest run src/render/shippedNames.test.ts \
    && for f in /game/carball-server /api/carball-api; do \
         n=$(grep -a -c -E '/root/|/usr/local/cargo|/target/|/engine/lib' "$f" || true); \
         echo "build paths in $f: $n"; [ "$n" = 0 ] || exit 1; \
       done

# The web client: its static build, served by unprivileged nginx (uid 101) on :3000. The game server's WebTransport URL
# goes into /config.json when the container starts, from GAME_SERVER_URL. (nginx 1.30.6, the stable line, alpine; RV-371)
FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:782bb89768cc87b7f95c18b95baa1af250e5d451f26794f59363540161147c01 AS web
COPY client/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY client/docker/security-headers.conf /etc/nginx/security-headers.conf
COPY client/docker/40-carball-config.sh /docker-entrypoint.d/40-carball-config.sh
COPY --from=client /src/client/dist/ /usr/share/nginx/html/
# (config.json and the Content-Security-Policy, written at start, the nginx user's: the site and all of /etc/nginx stay
# root's, read-only to it, RV-397, RV-408; nginx keeps /tmp and /var/cache/nginx for its pid and buffers. Both are
# written once here too, for the default GAME_SERVER_URL: a container started without the entrypoint still sends a
# strict policy and the default config, RV-409, RV-431)
ENV GAME_SERVER_URL=https://game.carball.zolt.top:4433/play
USER root
RUN chown -R root:root /etc/nginx && chmod -R go-w /etc/nginx \
    && sh /docker-entrypoint.d/40-carball-config.sh \
    && chown 101:101 /usr/share/nginx/html/config.json /etc/nginx/carball-csp.conf
USER 101
LABEL org.opencontainers.image.title="carball-web" \
      org.opencontainers.image.description="Carball's web client: its static files, served by nginx on :3000" \
      org.opencontainers.image.vendor="" org.opencontainers.image.url="" org.opencontainers.image.source="" \
      org.opencontainers.image.documentation="" org.opencontainers.image.version="" maintainer="" \
      org.opencontainers.image.created="" org.opencontainers.image.licenses=""
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1

# The game server: the release binary (libstdc++ linked in: it needs glibc 2.38 or later) and the arena's collision
# meshes. WebTransport on UDP $GAME_PORT; the certificate from $CERT_PATH and $KEY_PATH (a read-only mount), reloaded
# when they change or on SIGHUP
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS game
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin carball \
    && mkdir -p /var/lib/carball-game/outbox && chown -R 10001:10001 /var/lib/carball-game
COPY --from=server /out/carball-server /app/carball-server
COPY out/arena/collision_meshes/ /app/collision_meshes/
ENV SERVER_MODE=queue \
    GAME_PORT=4433 \
    PUBLIC_HOST=game.carball.zolt.top \
    ALLOWED_ORIGIN=https://carball.zolt.top \
    CERT_PATH=/certs/fullchain.pem \
    KEY_PATH=/certs/privkey.pem \
    HEALTH_PORT=8081 \
    MESHES_DIR=/app/collision_meshes \
    OUTBOX_DIR=/var/lib/carball-game/outbox
# (the ranked calls waiting for the accounts service: a small volume, so a restart sends them later)
VOLUME /var/lib/carball-game
USER carball
LABEL org.opencontainers.image.title="carball-game" \
      org.opencontainers.image.description="Carball's game server: matches over WebTransport (UDP, GAME_PORT)"
EXPOSE 4433/udp
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["/app/carball-server", "--healthcheck"]
ENTRYPOINT ["/app/carball-server"]

# The accounts service (notes/accounts.md): the static binary and nothing else. HTTP on LISTEN_ADDR (:8080), reached only
# by the tunnel (its docker network alone: AC-4); settings from the environment, secrets from files (`*_FILE`, mounted
# read-only)
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS api
RUN useradd --uid 10002 --no-create-home --shell /usr/sbin/nologin carball
COPY --from=api-build /out/carball-api /app/carball-api
ENV LISTEN_ADDR=:8080 \
    HEALTH_ADDR=127.0.0.1:8081 \
    PUBLIC_ORIGIN=https://carball.zolt.top
USER carball
LABEL org.opencontainers.image.title="carball-api" \
      org.opencontainers.image.description="Carball's accounts service: sign-in, sessions and accounts under /api/ (HTTP, LISTEN_ADDR)"
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["/app/carball-api", "healthcheck"]
ENTRYPOINT ["/app/carball-api"]
