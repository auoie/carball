# The web client (APP-CONTRACT.md): its static build, served by nginx on :3000. The game server's WebTransport URL goes
# into /config.json when the container starts, from GAME_SERVER_URL. Built from the staging directory
# scripts/build_images.sh fills (client/dist and these files only): `docker build -t carball-web:TAG <staging>/web`
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY 40-carball-config.sh /docker-entrypoint.d/40-carball-config.sh
COPY dist/ /usr/share/nginx/html/
ENV GAME_SERVER_URL=https://game.carball.zolt.top:4433/play
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
