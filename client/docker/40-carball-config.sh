#!/bin/sh
# Writes the page's config.json from GAME_SERVER_URL at the container's start (nginx's entrypoint runs it): the game
# server's WebTransport URL, https and a path (APP-CONTRACT.md)
set -eu
url="${GAME_SERVER_URL:-https://game.carball.zolt.top:4433/play}"
case "$url" in
    *[\"\\\ ]*) echo "40-carball-config: GAME_SERVER_URL has a quote, a backslash or a space: $url" >&2; exit 1 ;;
    https://*/*) ;;
    *) echo "40-carball-config: GAME_SERVER_URL must be https://HOST[:PORT]/PATH, got: $url" >&2; exit 1 ;;
esac
printf '{"gameServer":"%s"}\n' "$url" > "${CONFIG_DIR:-/usr/share/nginx/html}/config.json"
echo "40-carball-config: the game server is $url"
