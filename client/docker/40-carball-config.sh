#!/bin/sh
# Writes the page's config.json at the container's start (nginx's entrypoint runs it): the game servers, one a region,
# from GAME_SERVERS (`id|Name|URL`, comma-separated, in the page's order: notes/matchmaking.md, Regions), else the one of
# GAME_SERVER_URL; each URL a WebTransport one, https and a path (APP-CONTRACT.md). And the Content-Security-Policy,
# whose connect-src is those servers' origins (RV-395), plus EXTRA_CONNECT_SRC's sources if set (testing: e.g. a
# development server's info); Cloudflare Turnstile's script and frame for the sign-up's check (notes/accounts.md §6,
# AC-16, RV-639)
set -euf # (-f: no globbing, a source's * port stays a *)
# (allowlists, not denylists: a newline would add a header line, a tab or $ nginx syntax, RV-410; a value with a control
# character can't pass: grep checks every line, and the line count must be one)
one_line() { [ "$(printf '%s\n' "$1" | wc -l)" -eq 1 ]; }
# (a host is dot-separated labels of letters, digits and inner hyphens; a port 1-65535, no leading zero, RV-430)
label='[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?'
host="$label(\.$label)*"
port_ok() { [ -z "$1" ] || [ "$1" = "*" ] || [ "$1" -le 65535 ]; }
# (a game server's URL: https://HOST[:PORT]/PATH, letters, digits and . - _ ~ / after the host)
url_ok() {
    one_line "$1" && printf '%s\n' "$1" | grep -Eq "^https://$host(:[1-9][0-9]{0,4})?/[A-Za-z0-9._~/-]*\$" \
        && port_ok "$(printf '%s' "$1" | sed -nE 's#^https://[^/:]+:([0-9]+)/.*#\1#p')"
}
# The servers, as `id|name|url` lines. GAME_SERVERS, if set (set but empty: refused, as GAME_SERVER_URL, RV-441): each
# entry `ID|Name|URL`, the id lower-case letters, digits and inner hyphens (32 at most, each once), the name the
# region's as the page shows it (letters, digits, spaces and . - ( ), 40 at most), 8 entries at most. Else
# GAME_SERVER_URL alone (its default the image's ENV alone, RV-441): one server, id "default", no name (no picker)
servers=""
if [ "${GAME_SERVERS+set}" = set ]; then
    # (an empty entry, a comma at either end or two in a row, refused: not dropped quietly, RV-854)
    case ",$GAME_SERVERS," in *,,*) empty_entry=1 ;; *) empty_entry=0 ;; esac
    if [ -z "$GAME_SERVERS" ] || ! one_line "$GAME_SERVERS" || [ "$empty_entry" = 1 ]; then
        echo "40-carball-config: GAME_SERVERS must be one line of ID|Name|URL entries, comma-separated" >&2
        exit 1
    fi
    count=0
    old_ifs=$IFS
    IFS=,
    for entry in $GAME_SERVERS; do
        IFS=$old_ifs
        id=${entry%%|*}
        rest=${entry#*|}
        name=${rest%%|*}
        url=${rest#*|}
        count=$((count + 1))
        if [ "$(printf '%s' "$entry" | tr -cd '|' | wc -c)" -ne 2 ] \
            || ! printf '%s\n' "$id" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$' \
            || ! printf '%s\n' "$name" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9 .()-]{0,38}[A-Za-z0-9.)])?$' \
            || ! url_ok "$url" || printf '%s' "$servers" | grep -q "^$id|" || [ "$count" -gt 8 ]; then
            echo "40-carball-config: GAME_SERVERS' entries must be ID|Name|URL (ids each once, 8 at most), got: $entry" >&2
            exit 1
        fi
        servers="$servers$id|$name|$url
"
        IFS=,
    done
    IFS=$old_ifs
else
    url="${GAME_SERVER_URL-}"
    if ! url_ok "$url"; then
        echo "40-carball-config: GAME_SERVER_URL must be https://HOST[:PORT]/PATH (letters, digits, . - _ ~ /), got: $url" >&2
        exit 1
    fi
    servers="default||$url
"
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
# (config.json: `gameServer` the first, as pages from before the list read it; `gameServers` the list. The CSP: every
# server's origin once, in order. Every value checked above: no quoting needed)
first=$(printf '%s' "$servers" | head -n 1 | cut -d '|' -f 3)
list=""
origins=""
for line in $(printf '%s' "$servers" | tr ' ' '\001'); do
    line=$(printf '%s' "$line" | tr '\001' ' ')
    id=${line%%|*}
    rest=${line#*|}
    name=${rest%%|*}
    url=${rest#*|}
    list="${list:+$list,}{\"id\":\"$id\",\"name\":\"$name\",\"url\":\"$url\"}"
    origin=$(printf '%s' "$url" | sed -E 's#^(https://[^/]+)/.*#\1#')
    case " $origins " in *" $origin "*) ;; *) origins="${origins:+$origins }$origin" ;; esac
    echo "40-carball-config: a game server: $id ${name:+($name) }$url"
done
printf '{"gameServer":"%s","gameServers":[%s]}\n' "$first" "$list" > "${CONFIG_DIR:-/usr/share/nginx/html}/config.json"
turnstile=https://challenges.cloudflare.com
csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' $turnstile; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' data: $origins${extra:+ $extra}; media-src 'self' blob:; worker-src 'self' blob:; frame-src $turnstile; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
printf 'add_header Content-Security-Policy "%s" always;\n' "$csp" > "${CSP_FILE:-/etc/nginx/carball-csp.conf}"
