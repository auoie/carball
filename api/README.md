# carball-api

Carball's accounts service: sign-in with Google or Steam, sessions, accounts (notes/accounts.md is the design, reviewed
as AC1; APP-CONTRACT.md "carball-api" is how it's deployed). Go, Postgres.

```
cmd/carball-api/       the server and the admin's commands (serve, migrate, accounts, ban, unban, bans, rename,
                       unlock-renames, healthcheck, ticket-key; the read-only reports stats, matches, account, ratings, queue-bans,
                       names in reports.go; the shared training packs' packs, pack, pack-hide, pack-unhide in packs.go;
                       `carball-api help` lists them, `carball-api COMMAND -h` one's flags)
internal/config/       settings from the environment, secrets from *_FILE
internal/server/       the HTTP side under /api/: sign-in flows, sign-up, sessions, the account page's calls
internal/google/       Google's OpenID Connect (go-oidc, x/oauth2): PKCE, the nonce and azp checks
internal/steam/        Steam's OpenID 2.0: the assertion checked rule by rule, then check_authentication
internal/turnstile/    Cloudflare Turnstile's siteverify
internal/ratelimit/    per address (an IPv6 /64) and per account, in memory
internal/names/        display names: Twitch's rules (4-25 letters, digits, underscores), the word filter
internal/packs/        shared training packs checked strictly (the page's format 1: no unknown field, 1-50 shots, every
                       number within the arena and the speeds, the name and description printable ASCII and filtered),
                       kept in canonical form; share codes (XXXX-XXXX-XXXX-XXXX, crypto/rand)
internal/store/        Postgres (pgx), the migrations (goose, embedded: append-only from the first real deploy on, a
                       change a new numbered file, never an edit of one a database may have run; until then, with no
                       database anywhere, 00001 and 00002 were edited in place). An index on a big table gets a
                       file of its own: `-- +goose NO TRANSACTION`, `CREATE INDEX CONCURRENTLY`, a `lock_timeout`
                       (00003_indexes.sql is plain CREATE INDEX in one transaction: small tables then, RV-1165). A
                       CONCURRENTLY build that fails leaves an INVALID index behind: drop it before running the
                       migration again (`IF NOT EXISTS` would keep the broken one, RV-1172)
internal/testdb/       the tests' throwaway Postgres; internal/testoidc/: the tests' stand-in OIDC provider
```

## Checks

```sh
gofmt -l .                      # empty
go vet ./...
golangci-lint run ./...         # golangci-lint 2.15, .golangci.yml: the standard set, gosec, errorlint, bodyclose,
                                # noctx, sqlclosecheck, rowserrcheck, exhaustive, gochecksumtype, revive; gofmt
TMPDIR=<a scratch directory> CARBALL_API_REQUIRE_DB=1 go test ./...
golangci-lint run --build-tags e2e ./... && go test -tags e2e ./internal/server -run E2E   # the e2e build's too
```

The `e2e` build tag adds the browser tests' sign-in (`internal/server/e2e.go`: `POST /api/e2e/sign-in`, a session for
the identity's account, made as a sign-up makes one if it has none; `POST /api/e2e/sign-up`, a pending sign-up as a
provider's callback leaves it) for the Dockerfile's `api-e2e` image, which the browser tests' stacks run
(`client/e2e/services`, `serve --dev`) and which is never deployed. Even there the routes answer only under `--dev` (a
localhost origin), else 404 (RV-1043). The release build has no such route (a test says it's a 404, and the image checks
look for its markers in the release binary).

The store's and the server's tests start a throwaway Postgres from the installed `initdb` and `pg_ctl` (under
`$TMPDIR`, on 127.0.0.1 only, stopped and removed after); without them those tests skip, or fail with
`CARBALL_API_REQUIRE_DB=1`.

Variants are closed: a sealed interface (an unexported marker method, `//sumtype:decl`) for what a sign-in comes to and
when a ban ends, so gochecksumtype fails a type switch that misses one; the providers are an enum the exhaustive linter
holds every switch to.

The sign-in's security cases are named tests, each failing if its check goes: a flow taken once
(`TestFlowIsTakenOnce`), a flow's expiry (`TestFlowExpires`), a flow answering its own provider's callback alone
(`TestFlowProviderIsChecked`), beside the nonce, state and cookie tests. Now and then, a mutation run looks for tests
that miss a change: [Gremlins](https://github.com/go-gremlins/gremlins) (`gremlins unleash ./...` with the throwaway
database's variables above), its survivors read by hand (some are equivalent).

Development builds are offline: the modules go.sum pins, from the module cache (`GOPROXY=off`). The image build
(the root `Dockerfile`) downloads them, checked against go.sum and the checksum database, into its own cache.

## Running it locally

Postgres first, then `carball-api migrate --dev` (MIGRATE_DATABASE_URL and DATABASE_URL; `--dev` allows one role for
both), then `carball-api serve --dev`: a localhost `PUBLIC_ORIGIN` only (http allowed), sign-ups without Turnstile, a
role that may create in the schema allowed; it still needs `DATABASE_URL` and a `DELETION_HMAC_KEY_FILE` (random text).
Google sign-in needs a client of its own registered for that origin; Steam's works on any origin. The health check
answers on `HEALTH_ADDR` (127.0.0.1:8081), not under `/api/`.
