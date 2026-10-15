# The game server (APP-CONTRACT.md): the release binary (built on the host by scripts/build_images.sh, libstdc++ linked
# in: it needs glibc 2.38 or later) and the arena's collision meshes. WebTransport on UDP $GAME_PORT; the certificate from
# $CERT_PATH and $KEY_PATH (a read-only mount), reloaded when they change or on SIGHUP. Built from the staging directory
# (the binary, the meshes and this file only): `docker build -t carball-game:TAG <staging>/game`
FROM debian:trixie-slim
RUN useradd --system --uid 10001 --no-create-home carball
COPY rl-server /app/rl-server
COPY collision_meshes /app/collision_meshes
ENV RL_MODE=queue \
    GAME_PORT=4433 \
    PUBLIC_HOST=game.carball.zolt.top \
    ALLOWED_ORIGIN=https://carball.zolt.top \
    CERT_PATH=/certs/fullchain.pem \
    KEY_PATH=/certs/privkey.pem \
    HEALTH_PORT=8081 \
    MESHES_DIR=/app/collision_meshes
USER carball
EXPOSE 4433/udp
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["/app/rl-server", "--healthcheck"]
ENTRYPOINT ["/app/rl-server"]
