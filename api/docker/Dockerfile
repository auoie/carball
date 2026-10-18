# check=skip=SecretsUsedInArgOrEnv
# The accounts service (APP-CONTRACT.md "carball-api", notes/accounts.md): the static release binary (built on the host by
# scripts/build_images.sh: Go, no cgo, its root certificates built in) and nothing else. HTTP on LISTEN_ADDR (:8080),
# reached only by the tunnel (its docker network alone: AC-4); settings from the environment, secrets from files
# (`*_FILE`, mounted read-only). Built from the staging directory (the binary and this file only):
# `docker build -t carball-api:TAG <staging>/api`. (The `*_FILE` variables name files, not secrets: the check that flags
# them is skipped above)
# (the base pinned by digest, the game image's, RV-371: update the tag and digest together)
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
RUN useradd --uid 10002 --no-create-home --shell /usr/sbin/nologin carball
COPY carball-api /app/carball-api
ENV LISTEN_ADDR=:8080 \
    HEALTH_ADDR=127.0.0.1:8081 \
    PUBLIC_ORIGIN=https://carball.zolt.top
USER carball
LABEL org.opencontainers.image.title="carball-api" \
      org.opencontainers.image.description="Carball's accounts service: sign-in, sessions and accounts under /api/ (HTTP, LISTEN_ADDR)"
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["/app/carball-api", "healthcheck"]
ENTRYPOINT ["/app/carball-api"]
