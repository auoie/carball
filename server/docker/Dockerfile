# check=skip=SecretsUsedInArgOrEnv
# The game server (APP-CONTRACT.md): the release binary (built on the host by scripts/build_images.sh, libstdc++ linked
# in: it needs glibc 2.38 or later) and the arena's collision meshes. WebTransport on UDP $GAME_PORT; the certificate from
# $CERT_PATH and $KEY_PATH (a read-only mount), reloaded when they change or on SIGHUP. Built from the staging directory
# (the binary, the meshes and this file only): `docker build -t carball-game:TAG <staging>/game`. (KEY_PATH is the key's
# path, not a secret: the check that flags it is skipped above)
# (the base pinned by digest, RV-371: update the tag and digest together)
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin carball
COPY carball-server /app/carball-server
COPY collision_meshes /app/collision_meshes
ENV SERVER_MODE=queue \
    GAME_PORT=4433 \
    PUBLIC_HOST=game.carball.zolt.top \
    ALLOWED_ORIGIN=https://carball.zolt.top \
    CERT_PATH=/certs/fullchain.pem \
    KEY_PATH=/certs/privkey.pem \
    HEALTH_PORT=8081 \
    MESHES_DIR=/app/collision_meshes
USER carball
LABEL org.opencontainers.image.title="carball-game" \
      org.opencontainers.image.description="Carball's game server: matches over WebTransport (UDP, GAME_PORT)"
EXPOSE 4433/udp
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["/app/carball-server", "--healthcheck"]
ENTRYPOINT ["/app/carball-server"]
