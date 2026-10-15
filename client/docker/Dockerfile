# The web client (APP-CONTRACT.md): its static build, served by unprivileged nginx (uid 101) on :3000. The game server's
# WebTransport URL goes into /config.json when the container starts, from GAME_SERVER_URL. Built from the staging
# directory scripts/build_images.sh fills (client/dist and these files only): `docker build -t carball-web:TAG <staging>/web`.
# The base pinned by digest (nginx 1.30.6, the stable line, alpine; RV-371): update the tag and digest together
FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:782bb89768cc87b7f95c18b95baa1af250e5d451f26794f59363540161147c01
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY 40-carball-config.sh /docker-entrypoint.d/40-carball-config.sh
COPY dist/ /usr/share/nginx/html/
# (config.json and the Content-Security-Policy, written at start, the nginx user's: the site and the configuration stay
# root's, read-only to it, RV-397; nginx keeps /tmp and /var/cache/nginx for its pid and buffers)
USER root
RUN touch /usr/share/nginx/html/config.json /etc/nginx/carball-csp.conf \
    && chown 101:101 /usr/share/nginx/html/config.json /etc/nginx/carball-csp.conf \
    && chown -R root:root /etc/nginx/conf.d && chmod 755 /etc/nginx/conf.d && chmod 644 /etc/nginx/conf.d/default.conf
USER 101
LABEL org.opencontainers.image.title="carball-web" \
      org.opencontainers.image.description="Carball's web client: its static files, served by nginx on :3000" \
      org.opencontainers.image.vendor="" org.opencontainers.image.url="" org.opencontainers.image.source="" \
      org.opencontainers.image.documentation="" org.opencontainers.image.version="" maintainer=""
ENV GAME_SERVER_URL=https://game.carball.zolt.top:4433/play
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
