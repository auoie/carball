#!/bin/sh
# Writes the page's config.json from GAME_SERVER_URL at the container's start (nginx's entrypoint runs it): the game
# server's WebTransport URL, https and a path (APP-CONTRACT.md); and the Content-Security-Policy, whose connect-src is
# that server's origin (RV-395), plus EXTRA_CONNECT_SRC's sources if set (testing: e.g. a development server's info)
set -euf # (-f: no globbing, a source's * port stays a *)
# (allowlists, not denylists: a newline would add a header line, a tab or $ nginx syntax, RV-410; a value with a control
# character can't pass: grep checks every line, and the line count must be one)
one_line() { [ "$(printf '%s\n' "$1" | wc -l)" -eq 1 ]; }
# (a host is dot-separated labels of letters, digits and inner hyphens; a port 1-65535, no leading zero, RV-430)
label='[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?'
host="$label(\.$label)*"
port_ok() { [ -z "$1" ] || [ "$1" = "*" ] || [ "$1" -le 65535 ]; }
url="${GAME_SERVER_URL:-https://game.carball.zolt.top:4433/play}"
if ! one_line "$url" || ! printf '%s\n' "$url" | grep -Eq "^https://$host(:[1-9][0-9]{0,4})?/[A-Za-z0-9._~/-]*\$" \
    || ! port_ok "$(printf '%s' "$url" | sed -nE 's#^https://[^/:]+:([0-9]+)/.*#\1#p')"; then
    echo "40-carball-config: GAME_SERVER_URL must be https://HOST[:PORT]/PATH (letters, digits, . - _ ~ /), got: $url" >&2
    exit 1
fi
if ! one_line "${EXTRA_CONNECT_SRC:-}"; then
    echo "40-carball-config: EXTRA_CONNECT_SRC must be one line of sources" >&2
    exit 1
fi
# (each source checked, then the list rebuilt from them, one space apart: a tab between two never reaches the header)
extra=""
for source in ${EXTRA_CONNECT_SRC:-}; do
    if ! printf '%s\n' "$source" | grep -Eq "^(https?|wss?)://$host(:([1-9][0-9]{0,4}|\*))?\$" \
        || ! port_ok "$(printf '%s' "$source" | sed -nE 's#^[a-z]+://[^:]+:([0-9]+|\*)$#\1#p')"; then
        echo "40-carball-config: EXTRA_CONNECT_SRC's sources must be SCHEME://HOST[:PORT], got: $source" >&2
        exit 1
    fi
    extra="${extra:+$extra }$source"
done
origin=$(printf '%s' "$url" | sed -E 's#^(https://[^/]+)/.*#\1#')
printf '{"gameServer":"%s"}\n' "$url" > "${CONFIG_DIR:-/usr/share/nginx/html}/config.json"
csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' data: $origin${extra:+ $extra}; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
printf 'add_header Content-Security-Policy "%s" always;\n' "$csp" > "${CSP_FILE:-/etc/nginx/carball-csp.conf}"
echo "40-carball-config: the game server is $url"
