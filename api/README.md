# carball-api

Carball's accounts service: sign-in with Google or Steam, sessions, accounts (notes/accounts.md is the design, reviewed
as AC1; APP-CONTRACT.md "carball-api" is how it's deployed). Go, Postgres.

```
cmd/carball-api/       the server and the admin's commands (serve, migrate, accounts, ban, unban, bans, healthcheck,
                       ticket-key; the read-only reports stats, matches, account, ratings, queue-bans in reports.go;
                       `carball-api help` lists them, `carball-api COMMAND -h` one's flags)
internal/config/       settings from the environment, secrets from *_FILE
internal/server/       the HTTP side under /api/: sign-in flows, sign-up, sessions, the account page's calls
internal/google/       Google's OpenID Connect (go-oidc, x/oauth2): PKCE, the nonce and azp checks
internal/steam/        Steam's OpenID 2.0: the assertion checked rule by rule, then check_authentication
internal/turnstile/    Cloudflare Turnstile's siteverify
internal/ratelimit/    per address (an IPv6 /64) and per account, in memory
internal/names/        display names: the game server's rules, NFKC, 32 bytes
internal/store/        Postgres (pgx), the migrations (goose, embedded: append-only from the first real deploy on, a
                       change a new numbered file, never an edit of one a database may have run; until then, with no
                       database anywhere, 00001 and 00002 were edited in place)
internal/testdb/       the tests' throwaway Postgres; internal/testoidc/: the tests' stand-in OIDC provider
```

## Checks

```sh
gofmt -l .                      # empty
go vet ./...
golangci-lint run ./...         # golangci-lint 2.15, .golangci.yml: the standard set, gosec, errorlint, bodyclose,
                                # noctx, sqlclosecheck, rowserrcheck, exhaustive, gochecksumtype, revive; gofmt
TMPDIR=<a scratch directory> CARBALL_API_REQUIRE_DB=1 go test ./...
```

The store's and the server's tests start a throwaway Postgres from the installed `initdb` and `pg_ctl` (under
`$TMPDIR`, on 127.0.0.1 only, stopped and removed after); without them those tests skip, or fail with
`CARBALL_API_REQUIRE_DB=1`.

Variants are closed: a sealed interface (an unexported marker method, `//sumtype:decl`) for what a sign-in comes to and
when a ban ends, so gochecksumtype fails a type switch that misses one; the providers are an enum the exhaustive linter
holds every switch to.

Development builds are offline: the modules go.sum pins, from the module cache (`GOPROXY=off`). The image build
(the root `Dockerfile`) downloads them, checked against go.sum and the checksum database, into its own cache.

## Running it locally

Postgres first, then `carball-api migrate --dev` (MIGRATE_DATABASE_URL and DATABASE_URL; `--dev` allows one role for
both), then `carball-api serve --dev`: a localhost `PUBLIC_ORIGIN` only (http allowed), sign-ups without Turnstile, a
role that may create in the schema allowed; it still needs `DATABASE_URL` and a `DELETION_HMAC_KEY_FILE` (random text).
Google sign-in needs a client of its own registered for that origin; Steam's works on any origin. The health check
answers on `HEALTH_ADDR` (127.0.0.1:8081), not under `/api/`.
