#!/bin/sh
# Writes the page's config.json from GAME_SERVER_URL at the container's start (nginx's entrypoint runs it): the game
# server's WebTransport URL, https and a path (APP-CONTRACT.md); and the Content-Security-Policy, whose connect-src is
# that server's origin (RV-395), plus EXTRA_CONNECT_SRC's sources if set (testing: e.g. a development server's info)
set -eu
url="${GAME_SERVER_URL:-https://game.carball.zolt.top:4433/play}"
case "$url" in
    *[\"\\\ \;\']*) echo "40-carball-config: GAME_SERVER_URL has a quote, a backslash, a semicolon or a space: $url" >&2; exit 1 ;;
    https://*/*) ;;
    *) echo "40-carball-config: GAME_SERVER_URL must be https://HOST[:PORT]/PATH, got: $url" >&2; exit 1 ;;
esac
extra="${EXTRA_CONNECT_SRC:-}"
case "$extra" in
    *[!A-Za-z0-9:/.\*\ _-]*) echo "40-carball-config: EXTRA_CONNECT_SRC may hold only sources (letters, digits, : / . * - _ and spaces): $extra" >&2; exit 1 ;;
esac
origin=$(printf '%s' "$url" | sed -E 's#^(https://[^/]+)/.*#\1#')
printf '{"gameServer":"%s"}\n' "$url" > "${CONFIG_DIR:-/usr/share/nginx/html}/config.json"
csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' data: $origin${extra:+ $extra}; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
printf 'add_header Content-Security-Policy "%s" always;\n' "$csp" > "${CSP_FILE:-/etc/nginx/carball-csp.conf}"
echo "40-carball-config: the game server is $url"
