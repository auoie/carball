#!/bin/sh
# Writes the page's config.json from GAME_SERVER_URL at the container's start (nginx's entrypoint runs it): the game
# server's WebTransport URL, https and a path (APP-CONTRACT.md); and the Content-Security-Policy, whose connect-src is
# that server's origin (RV-395), plus EXTRA_CONNECT_SRC's sources if set (testing: e.g. a development server's info)
set -eu
# (allowlists, not denylists: a newline would add a header line, a tab or $ nginx syntax, RV-410; a value with a control
# character can't pass: grep checks every line, and the line count must be one)
one_line() { [ "$(printf '%s\n' "$1" | wc -l)" -eq 1 ]; }
url="${GAME_SERVER_URL:-https://game.carball.zolt.top:4433/play}"
if ! one_line "$url" || ! printf '%s\n' "$url" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[A-Za-z0-9._~/-]*$'; then
    echo "40-carball-config: GAME_SERVER_URL must be https://HOST[:PORT]/PATH (letters, digits, . - _ ~ /), got: $url" >&2
    exit 1
fi
extra="${EXTRA_CONNECT_SRC:-}"
if ! one_line "$extra"; then
    echo "40-carball-config: EXTRA_CONNECT_SRC must be one line of sources" >&2
    exit 1
fi
for source in $extra; do
    if ! printf '%s\n' "$source" | grep -Eq '^(https?|wss?)://[A-Za-z0-9.-]+(:([0-9]{1,5}|\*))?$'; then
        echo "40-carball-config: EXTRA_CONNECT_SRC's sources must be SCHEME://HOST[:PORT], got: $source" >&2
        exit 1
    fi
done
origin=$(printf '%s' "$url" | sed -E 's#^(https://[^/]+)/.*#\1#')
printf '{"gameServer":"%s"}\n' "$url" > "${CONFIG_DIR:-/usr/share/nginx/html}/config.json"
csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' data: $origin${extra:+ $extra}; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
printf 'add_header Content-Security-Policy "%s" always;\n' "$csp" > "${CSP_FILE:-/etc/nginx/carball-csp.conf}"
echo "40-carball-config: the game server is $url"
