# Accounts and the API (design note)

Status: **step 1 built (2026-10-18): `api/`**, the service itself (schema and migrations, Google and Steam sign-in, the
pre-auth cookie, sign-up with Turnstile, sessions, rate limits, names, deletion with the 30-day block, the admin's ban
commands, its image); **step 2 built (2026-10-18)**: the tickets (`POST /api/ticket`, `api/internal/ticket`), the game
server's check (`server/src/ticket.rs`: protocol 26's Hello ticket, `TICKET_PUBLIC_KEYS`, `--dev`'s own key and
`/dev-ticket`, a claim bound to the searching account), the client's ticket sources (`client/src/net/tickets.ts`) and
its account page (`client/src/ui/accountPages.ts`: sign in with Google or Steam, the sign-up with Turnstile, rename,
sign out, sign out everywhere, delete; Find Match signed out asks to sign in; the deployment's page only), the CSP for
Turnstile and the privacy page (`client/public/privacy.html`). Next: ratings, results, queue bans and rejoin with the
ranked rules. Reviewed by the static session as AC1, findings AC-1..27, all folded in below;
its full review is out/bsim/review/AC1-accounts-review.md, local. Written 2026-10-18 for the user's request: ranked play
(and later shared custom maps) behind accounts, mass account creation made hard.

**Nothing (web or game) has been deployed yet, and the first deploy waits for this layer.** It ships with sign-in in
place, so nothing below needs to stay compatible with older clients, servers or protocol versions; §8 plans that deploy.

Ranked matchmaking itself (pairing searchers by rating in the queue, placements, ranks shown) is its own design, after
this one. This note covers who a player is, how the game server knows it, and keeping fake accounts out.

Decided by the user:
- sign-in with **Google or Steam only**, no passwords;
- a new **carball-api** service (Go + Postgres) on the main box behind the Cloudflare tunnel;
- the queue moving behind it, as `MatchHosting::create_match` was cut for (notes/HANDOFF.md "The queue, 2026-10-14");
- **(2026-10-18, scope kept small)** online play is **ranked only**: 1v1, 2v2 and 3v3, every match rated, no casual
  playlist;
- **sign-in required for any online match**: no anonymous online play, no guest names, and the browser key is no
  longer an identity online;
- **no ranked gate**: anyone signed in plays ranked at once (as on lichess). A new account gets a provisional Glicko-2
  rating (high deviation), and matchmaking accounts for the uncertainty;
- the offline modes (free play, custom training, Play vs Bots) need no sign-in: they run in the page (§5);
- **the user's answers to this note's questions (2026-10-18)** are folded in below and listed at the end.

## 1. Sign-in flows

**Every flow is bound to the browser that started it (AC-1).**
- Starting a sign-in or link sets a pre-auth cookie: `__Host-cb_auth`, HttpOnly, Secure, SameSite=Lax, about 10
  minutes, single use.
- It holds Google's `state`, `nonce` and PKCE verifier, or the random value Steam's `return_to` carries.
- The callback checks it and deletes it. Otherwise:
  - login CSRF: the victim signed in as the attacker;
  - a forced link: the attacker's identity attached to the victim's account.
- Linking also needs a signed-in session, and the callback checks that the same account started it.

**Google: OpenID Connect** (`golang.org/x/oauth2` + `github.com/coreos/go-oidc/v3`).
- Authorization-code flow with PKCE, scope `openid` only (no `email` or `profile`): no address ever reaches us.
- go-oidc's `Verify` checks the signature, issuer, audience and expiry.
- We also check (AC-3):
  - `idToken.Nonce` equals the stored nonce;
  - if `aud` has more than our client id, `azp` is our client id.
- We keep `sub`.

**Steam: OpenID 2.0** (Steam offers nothing newer). The callback requires every one of these, each with its own test
(AC-2):
- `openid.mode=id_res`;
- `openid.op_endpoint` equals `https://steamcommunity.com/openid/login`;
- `openid.return_to` equals our exact callback URL, with the AC-1 value;
- `openid.claimed_id` equals `openid.identity` and matches `^https://steamcommunity\.com/openid/id/(\d{17})$`;
- `openid.signed` covers at least `claimed_id`, `identity`, `return_to`, `response_nonce`, `assoc_handle` and
  `op_endpoint`;
- `check_authentication` is built from the same parsed parameters (any duplicate key refused) and answers
  `is_valid:true`;
- `response_nonce`'s time is within 5 minutes, and the nonce is stored until then (no replay).

A maintained OpenID 2.0 package may do the protocol, but only with its nonce store and discovery cache configured; the
list above is what the tests hold it to.

With our Steam Web API key, `ISteamUser/GetPlayerSummaries` gives the persona name, a display-name suggestion.

**Accounts and identities.**
- One Carball account per (provider, subject).
- An unknown identity creates an account, after §4's checks.
- Linking the other provider comes **later** (question 4), with these rules then:
  - it needs a fresh provider sign-in (AC-1);
  - an identity belongs to one account at most;
  - linking an identity that already owns an account with games or ratings: refused, or merged only if that account is
    empty (question 11, decided when linking comes, AC-12);
  - a banned identity can't be linked;
  - the last identity can't be unlinked.

## 2. Data (Postgres)

| Table | Holds |
|---|---|
| `accounts` | id (random), created_at, display name (§5) |
| `identities` | provider (`google` / `steam`), subject (Google `sub` / SteamID64), account_id, linked_at; unique (provider, subject) |
| `sessions` | the token's hash, account_id, created_at, rotated_at, expires_at (absolute), the previous token's hash and its grace end |
| `ratings` | account_id, playlist (1v1 / 2v2 / 3v3), Glicko-2 rating, deviation, volatility, games, last_played. Shown as numbers, lichess-style, with "?" while provisional: deviation above **110**, lichess's (question 5) |
| `ranked_results` | match id (unique: idempotent), game server id, playlist, winning team, and per player: account, team, tickets' nonce, quitter or not, time played; received_at. Kept **1 year** (question 7) |
| `queue_bans` | account_id, the ladder's step, banned until, the last leave's time, the match it came from: the leavers' growing queue ban (§3; the ladder ours, LV1) |
| `used_tickets` | ticket nonce, its `iat`, used_at: a ticket counts in one result only (AC-5). Kept for the results' acceptance window W, at least (AC-22, §3), not the ticket's own 2 minutes |
| `deletions` | the identity subject's keyed hash (HMAC with a server secret, a `*_FILE`: SteamID64s are enumerable, so a plain hash would be reversible, AC-24) and deleted_at. With no ranked gate it serves the delete/re-create rule: an identity can't make a new account for **30 days** after deleting one, so deleting can't throw off a bad rating at will (question 10, AC-10) |
| `bans` | provider, subject, reason, until, banned_by. Every identity of the account is banned at once (AC-9) |

**Not stored:**
- e-mail addresses;
- provider access tokens (used once at sign-in, then dropped);
- IP addresses: the rate limiter keeps them in memory only, each forgotten once idle for its limit's window (10 minutes
  to an hour; at most 200,000 at once, the longest idle forgotten past that: AP-2). That covers the logs too (AC-15):
  - the API's access log drops the address;
  - nginx and cloudflared logs are configured without it, or kept briefly (§8).

**Deletion** is a hard delete, effective at once (AC-10):
- the account, its identities, sessions and ratings go;
- its rows in `ranked_results` keep a placeholder instead of the account;
- a `deletions` row (the subject's hash) and any ban on its identities stay.

**Retention** (question 7): expired sessions purged daily; `ranked_results` kept 1 year; `used_tickets` for W at least.

**Database access** (AC-18):
- the API connects with a least-privilege role (rows only);
- migrations run with a separate role, a one-shot `carball-api migrate` (the serving container never holds the owner's
  password; the same role for both refused; `serve` refuses a role that may create in the schema: AP-4); Postgres 15 or
  later (the grant step also revokes CREATE on `public` from everyone, Postgres 15's default: AP-5);
- the database is never exposed off its docker network;
- backups are encrypted and kept off the box.

## 3. Sessions, tickets and results

**The page and the API (AC-7, AC-8).**
- The API is same-origin, at `/api/` on carball.zolt.top (question 1), reached through the tunnel (AC-21: a cloudflared
  path rule, or the web container proxying `/api/` to it).
- The session cookie is `__Host-cb_session`: HttpOnly, Secure, SameSite=Lax, Path=/, no Domain.
- Sessions rotate on a timer, about daily, with the previous token valid for a short grace period: rotating on every use
  would let two tabs sign each other out. They have an absolute lifetime of about 90 days.
- Every session is revoked on deletion, a ban and "sign out everywhere".
- `SameSite=Lax` counts every `*.zolt.top` site as the same site. So every POST, PUT and DELETE (sign-out, link, unlink,
  rename, delete, ticket) also requires `Origin` to equal `PUBLIC_ORIGIN`, the custom header, and JSON when there's a
  body (16 KiB at most, one value and nothing after it).

**Tickets: how the game server knows a player (AC-6).** Before a search, a signed-in page asks for a ticket.

A ticket is Ed25519-signed and holds:
- `aud` (`carball-search`);
- the account id and display name (the name other players see: no guest names online);
- `iat` and `exp` (about 2 minutes);
- a nonce;
- a `kid`;
- the protocol version.

The game server checks it offline, with `TICKET_PUBLIC_KEYS` (a list, so keys can rotate), so a match never waits on the
API. It:
- allows ±30 s of clock skew (both boxes on NTP);
- caps the ticket's size in `Hello`;
- keeps used nonces until `exp`, so a ticket is used once; refuses a ticket issued before the process started (its
  nonce may have been used with the one before), one longer than the API's lifetime or ending before it began (AP2-3,
  AP2-4);
- takes its keys from `TICKET_PUBLIC_KEYS` or `TICKET_PUBLIC_KEYS_FILE`, the file read again on SIGHUP (a rotation
  without a restart), refusing a list with no key, a key id twice, a key of small order or the id `dev` (AP2-5);
- allows one active search or match per account (two tabs, two devices). That holds per game server: with regions
  (2026-10-22, notes/matchmaking.md, Regions) an account searches every region it ticks at once, on purpose, and the page
  takes the first match found, ending or declining the rest; it can't play two matches at once from one page. The API
  holding it across servers (AC-27) stays open, not needed for that.

A seat belongs to the account: a reconnect needs a fresh ticket for that account, not the browser key.

The ticket rides in the search's `Hello`, and the game server refuses any online `Hello` without a valid one. The
protocol simply changes, since no older client exists. The `u64` key stays in the `Hello` for development servers
(no tickets), but a page sends 0 beside a ticket and the game server keys a ticketed player by the account (RX29C).

**Results: server to server (AC-5, AC-22, AC-25).**
- At every match's end (every online match is rated) the game server posts the result to `POST /api/results`.
- Each result carries one ticket per player: the one from that player's first `Hello` in the match (a reconnect's fresh
  ticket is checked by the game server but not sent on).
- The API accepts a result only for players whose tickets it issued, each ticket spent on one match (`used_tickets`,
  its match id: the same match's quitter report and result may both carry it, another match's may not; AP3). A leaked
  server credential then can't rate players who never played, nor ban an account more than once per ticket.
- **The acceptance window W** (about 24 hours): a result's tickets must have `iat` within W of when the result arrives.
  That spans the match, overtime and the retry queue. `used_tickets` keeps every nonce for at least W, so no pruned
  ticket can count twice; a ticket older than W is refused.
- Transport (question 6, decided): a **Cloudflare Access service token** on `/api/results` (it also exempts the route
  from bot challenges), plus the game server's own token compared in constant time, plus the players' tickets above;
  the game server's calls rate-limited together (300 a minute, AC-26: 429, which its outbox retries). The game server
  sends them to `API_URL` alone: no redirect followed, no proxy, https only, a User-Agent of its own; an answer that
  isn't the service's (a redirect, 401 or 403 from Access or a challenge, 404 or 405 from a wrong route) is retried and
  logged loudly, not dropped (AP3). The service answers a call's own fault with a 4xx the outbox drops, so one bad call
  never holds the in-order queue for a day (RX31): a refused ticket is its JSON 403 `{"error":"ticket"}` (told apart from
  an edge's 403 by that body), and data the handler's checks let through but the database's constraints refuse
  (SQLSTATE class 23) is 400, not 503.
- **Leavers, as the game rates them** (LV1; notes/matchmaking.md "Leavers, rejoining and ratings"): a result comes only
  with a winner. Every player whose last team won is a winner, the rest losers, a leaver (an idle kick counts) flagged a
  quitter but rated by their team's result, with no dampening (ours). Forfeiters are ordinary losers. A match that
  ends with no winner (everyone left, cancelled before the start, ended by the server) is a no contest: no result, no
  rating changes.
- **The leavers' queue ban** (LV1): the game server reports a quitter to the API **when they leave**, if the penalty
  was armed (the lobby full of humans, no winner yet; the first leaver only; none in a server outage), with that
  player's ticket (spent on that match): `POST /api/quitters`. A leave by a lost connection waits 5 s first: if most of
  the match's seats lose theirs within 5 s of it, it's the server's network outage and no one is banned (AP3). The report
  carries the leave's time, and the ban runs from it (held within the acceptance window: a report that gets through late
  bans for what's left). The API raises the account's `queue_bans` row by the ladder (ours, the user's choice of LV1's: 5 min → 15 min → 1 h → 6 h →
  24 h cap, one step forgiven for every 24 h without a leave); the ticket endpoint refuses a search ticket while it runs,
  and the page shows until when. A rejoin needs no search, so the ban never blocks it: its ticket is a **rejoin's**
  (`POST /api/ticket?rejoin=MATCH`, the ticket's purpose 1 and that match's id), which the ban doesn't stop when it came
  from that same match, and which the game server takes for that match's rejoin alone (a search's ticket only for a
  search or a claim). A rejoin that fills the lobby again removes the ban: `POST /api/refills` with the match and the
  rejoin's own ticket (spent, and once only: a replayed refill can't lift a later ban from the same match, RX31), so the
  game server's token alone lifts no ban (AP3). Both calls go through the same credential and retry queue as results.

**Ratings: Glicko-2 (built 2026-10-18, `api/internal/ranked`).** Implemented from Glickman's paper ("Example of the
Glicko-2 system", revised 2022-03-22; its worked example is a test), with lichess's choices where they fit (the user's direction:
lichess's lila, `modules/rating` Glicko settings, and scalachess's `rating/glicko`, read for the approach and the numbers
only: lila is AGPL-3.0, none of its code is ours; and lichess's rating FAQ):
- **Taken from lichess:** a new rating 1500, deviation 500 (also the ceiling: lichess's "1500 ± 1000"), volatility 0.09
  (capped at 0.1), τ 0.75; the deviation's floor 45; **provisional ("?") from a deviation of 110** (scalachess's
  `provisionalDeviation`, "at least"; the FAQ says "greater than"); **each game its own rating period, the deviation
  first grown by the time since the account's last game in that playlist**, 0.21436 rating periods a day (lila's
  `periodsPerDay`, "chosen so a typical player's RD goes from 60 → 110 in 1 year"; a test checks ours does that, and
  the FAQ's "around a year of inactivity" to be provisional again); a first game grows nothing; at most 700 points a
  game (lila's `maxRatingDelta`); ratings held within 400-4000. The page and the ticket show the deviation grown to now.
- **Not taken:** lila's `RatingRegulator` (small per-variant boosts on gains, its correction for deflation measured on
  its own players: we have none to measure); colour advantage (no colours); a bot game's halved change (no rated bot
  games); the virtual 1450 for a first pairing (our pairing uses the stored rating); the rankable thresholds (no
  leaderboards yet).
- **Ours (lichess has no team games):** in 2v2 and 3v3 each player is rated against the other team as one composite
  opponent: its players' mean rating, their deviations' root mean square; the team's result for everyone, a quitter
  too (LV1), a deleted player counted as a new rating in its team and not rated.
- Because tickets are checked offline, a match can start and end while the API is down. So the game server keeps unsent
  results in a small file queue and retries with backoff; the match id makes retries safe.

## 4. Anti-spam

With no ranked gate, it rests on:
- **Google or Steam sign-in**, and **one account per identity**.
- **Cloudflare Turnstile** on account creation (the first sign-in of an identity). Siteverify checks the token, the
  `hostname` and the `action`, and each token is used once (AC-16).
- **Rate limits:**
  - on sign-in and account creation, per IPv4 address and per IPv6 /64, as the queue's own (RV-385, RV-407);
  - on the ticket endpoint (per account) and the results endpoint (per game server) (AC-26);
  - in memory, each key forgotten once idle for its window, generous enough for a household or a NAT;
  - a wider limit per network too (an IPv6 /48, an IPv4 /24), so a block of addresses can't take a fresh key each; and
    ceilings on the sign-ins in progress and the sign-ups waiting, everyone's (AP-2);
  - applied before any outbound call (no amplification);
  - the address is `CF-Connecting-IP` only from `TRUSTED_PROXIES` (cloudflared's: AC-4, AP-1); from anything else the
    header is ignored and the connection's address counts. `TRUSTED_PROXIES` is required outside `--dev`, logged at
    start, and a header ignored from an untrusted peer is warned of (its kind, never its address), so a wrong value
    behind the tunnel shows instead of every user sharing the connector's key. The API also listens on its docker
    network alone.
  Every outbound call has a timeout: Google's token endpoint, Steam's `check_authentication` and GetPlayerSummaries,
  Turnstile.
- **Provisional ratings (Glicko-2, AC-13):**
  - a new account starts at the default rating with a high deviation, so its first matches move it far and it neither
    gains nor costs others much; matchmaking accounts for the uncertainty (the ranked design);
  - the rating period is one match;
  - each player is rated against the opposing team's composite rating and deviation (Glicko-2 itself is pairwise);
  - deviation grows with inactivity, with a time constant;
  - τ is fixed in the code, with a test;
  - per-account row locks in one transaction;
  - leavers and forfeits by question 14.
- **Bans:**
  - on every identity of the account (AC-9), with an expiry or none;
  - issued with an admin command on the box against the database, nothing exposed (question 13);
  - an identity's ban needs an account that signed in with it, unless `--no-account` (a deleted account's identity, a
    throwaway's: it can't make an account while banned); a ban in force is replaced only with `--replace`, and the
    replaced ban is printed (RV-781, RV-787, RV-788).
- **The delete/re-create rule** (`deletions`: 30 days, question 10).
- **The leavers' queue ban** (§3), and the no-show search ban (2 minutes, the queue's own: MM, RV-367), now by account.

## 5. Display names, online and offline

**Display names cross to other players** (AC-14; question 3).
- Free choice under the name rules; **not unique**.
- Validated by the API: the existing name rules, plus:
  - no control, bidi or zero-width characters;
  - NFKC;
  - a length cap.
- Renames are rate-limited.
- The suggestion at account creation: the Steam persona for a Steam sign-in (untrusted input like any other name); for
  Google, a guest-style name (e.g. "Player 4821"), never the person's real name, which we never ask Google for anyway.

**Online and offline.**
- No migration: nothing is deployed, so there are no players, ratings or keys to carry over.
- **Online needs an account:** every search carries a ticket; the queue's no-show penalty and reconnects follow the
  account; the name in the match is the account's. The browser key (`carball.browserKey`) is no identity online.
- **Rejoining** (LV1, as the game's): ranked 2v2 and 3v3 only, not 1v1. The slot is held until the match ends. A player
  who dropped or was kicked (not one who chose Exit to Main Menu) is asked "Would you like to rejoin?" when the menu
  opens, within 900 s of joining the match, and goes back with a fresh ticket for the same account. That's
  join-in-progress for the match's own players only; there is still no backfill with strangers.
- **Offline needs nothing:** free play, custom training and Play vs Bots run in the page and stay without sign-in.
  Play vs Bots runs the game server's own match code in the page's worker (`client/src/local/`, the host feature), so
  the ticket checks go in the network server's `Hello` handling, not in the shared match code; the local host takes no
  ticket. Flagged for the build.
- **Development and tests:** with sign-in required online, the browser tests and a development server need a way in
  without Google or Steam. That is a development signer: the game server's `--dev` mode accepting tickets from a local
  test key, and the e2e servers handing pages such tickets. It can't be enabled in a production image: refused without
  `--dev`, which the image never passes. Flagged for the build.
- The shared custom maps, later, need an account too.

## 6. What this repository ships

**`api/`:** the Go service, its migrations and its tests.
- It builds offline like the rest: the modules `go.sum` pins, from the module cache (`GOPROXY=off`), as cargo builds
  from its registry cache (not vendored: the user commits the tree whole, and a vendor/ directory would put third-party
  code in it). govulncheck isn't installed and needs the vulnerability database online: run it where the network is
  allowed, before a deploy (AC-19).
- Checks: `gofmt -l`, `go vet`, golangci-lint (.golangci.yml: gosec, errorlint, bodyclose, noctx, sqlclosecheck,
  rowserrcheck, exhaustive, gochecksumtype, revive and the standard set), `go test` with a throwaway Postgres.
- It ships as a `carball-api` image built by `scripts/build_images.sh` beside the other two.
- APP-CONTRACT.md gets its section:
  - port, health check and log policy;
  - secrets as files, e.g. `TICKET_SIGNING_KEY_FILE`, `GOOGLE_CLIENT_SECRET_FILE`, `STEAM_WEB_API_KEY_FILE`,
    `TURNSTILE_SECRET_FILE`, `GAME_SERVER_TOKEN_FILE`, `DELETION_HMAC_KEY_FILE`, not env (env shows in `docker
    inspect`, AC-17);
  - plain settings: `DATABASE_URL` (no password in it), `PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID`;
  - the ticket key's rotation steps.

**The game image:**
- `TICKET_PUBLIC_KEYS`, `API_URL` and its credential (§3), as files;
- every online search refused without a valid ticket (`--dev` alone accepting the development signer's);
- the results queue on a small volume.

**The web image:**
- sign-in and sign-out (required before Play's online playlists; the offline modes untouched);
- the account page: name, linked providers, sign out everywhere, delete;
- the playlists (1v1 / 2v2 / 3v3, all ranked) behind the ticket;
- the CSP gains `challenges.cloudflare.com` in `script-src` and `frame-src` (Turnstile, AC-16).
- a privacy page (question 12: yes; AC-20, Google's consent screen links it): what's stored (provider subject ids,
  display name, ratings, match results for a year, the session cookie) and how deletion works.

**Not here:** DNS, the tunnel's routes, the secrets, and the Google / Steam / Turnstile registrations (Steam's realm
`https://carball.zolt.top`). They live in the user's servers repository, which this one doesn't touch.

## 7. Threats this design answers

- **Fake accounts in bulk:** each needs a Google or Steam identity, a Turnstile pass and the rate limits.
- **Smurfs or throwaways:** one account per identity, provisional ratings, identity bans, the delete/re-create rule.
- **Forged or replayed sign-ins:** AC-1 flow binding, the Steam checks, the OIDC nonce.
- **Forged results:** the server's credential plus fresh, single-use player tickets.
- **CSRF from a sibling *.zolt.top site:** `__Host-` cookies, the Origin check, JSON with a custom header.
- **A stolen ticket:** 2 minutes, single use, one active search per account.

## 8. The first deploy (auth in place)

Order: each step's image comes from this repository, its configuration from the user's servers repository.
1. **Postgres** on the main box: a volume, both roles (§2), encrypted off-box backups, one restore tried.
2. **carball-api:** `carball-api migrate` as a one-shot run (the owner's password there only), then the service; on
   its docker network, reachable only by cloudflared (`TRUSTED_PROXIES` its address), the tunnel routing
   `https://carball.zolt.top/api/*` to it and the rest to the web container (APP-CONTRACT.md); access
   logs without addresses; its health check on loopback, not routed. Before going live, govulncheck over `api/` where
   the network is allowed (AC-19, AP-12).
3. **Registrations and secrets:**
   - the Google OAuth client, with its redirect URI on `/api/` and the consent screen's home and privacy links;
   - Steam's realm and return URL, and a Web API key;
   - Turnstile's site key and secret;
   - the ticket key pair and the game server's credential;
   - a Cloudflare Access service token, if chosen.
4. **The game image** with the ticket public keys, the API's URL and its credential:
   - every online search needs a ticket;
   - the results queue on its volume.
5. **The web image** with sign-in, the account page, the playlists and the CSP's Turnstile sources.

**Before going live**, on a staging copy (question 9: yes; its own OAuth clients, keys and database):
- each provider: sign in and out, link both, unlink refused for the last identity, delete;
- the AC-1 and AC-2 attacks refused: a callback without the pre-auth cookie, a wrong `return_to`, a replayed nonce;
- a ranked match end to end (ticket → match → result → rating);
- tickets expired, forged, replayed or reused across searches refused;
- results with a foreign or used ticket refused, including a ticket replayed after the ticket's own lifetime but inside W,
  and one older than W (AC-22);
- the rate limits and Turnstile hit;
- with the API down: new searches refused cleanly (no ticket can be had), a running match's result queued and delivered
  later, the offline modes unaffected.

## The user's answers (2026-10-18), and what's open

1. The API: **`carball.zolt.top/api/`**, same origin.
2. The ranked gate: **none**; provisional ratings instead.
3. Display names: **free choice under the name rules, not unique**; the Steam persona as the suggestion, a guest-style
   one for Google (never the real name).
4. Linking a second provider: **later**.
5. Ratings: **numbers, lichess-style, "?" while provisional**.
6. Results: **a Cloudflare Access service token plus the players' tickets** in each result.
7. Retention: **expired sessions purged daily, match results kept 1 year**.
8. Casual online: **none**; every online match is ranked and needs sign-in.
9. Staging: **yes**, with its own OAuth clients, keys and database.
10. After deleting an account: **the identity can't make a new one for 30 days**.
11. Linking an identity that already owns an account: **waits until linking comes** (question 4).
12. A privacy page: **yes**.
13. Bans: **an admin command on the box**.
14. Leavers:
    - **their team's result**, the teammates' as normal;
    - **a growing queue ban by the game's ladder**, its steps and resets from the static session's lookup;
    - **rejoining their running match**, the match's own players only;
    - an idle kick counts as leaving;
    - the no-contest rule stays (LV1: the game's, a match ending with no winner).

**LV1 (2026-10-18), the game's leaver rules, now in §3, §5 and notes/matchmaking.md:** results only with a winner,
leavers and idle kicks rated by their team's result, forfeiters ordinary losers, no contest = no winner; the leave ban
issued at the leave (first leaver while the lobby is full), cleared by a rejoin that fills it again; rejoin by a prompt
within 900 s of the join, 2v2 and 3v3 only, not after Exit to Main Menu. The ladder and whether a quitter's rating is
dampened are Carball's own (no dampening; the ladder 5 min → 15 min → 1 h → 6 h → 24 h cap, a step forgiven per 24 h
without a leave: the user's choice).

Settled since:
- **no activity condition**: when the other team leaves, everyone on the winning team gains (the game's too, LV1);
- ~~the queue ban starts when the match's result arrives~~ superseded by LV1: issued at the leave, cleared by a rejoin
  that fills the lobby again (a rejoin needs no search);
- **the provisional "?" at deviation 110**, lichess's;
- **idle-kicked players count as leavers** and can rejoin.

**The user's guiding rule for ranked (2026-10-18): the rules follow the game** ("if a team wins, everyone gains mmr
regardless of everything"). The static session's LV1 covers the game's rating rules for leavers, idle kicks, no-contest
and void cases, teammates left behind and forfeits; where it differs from the answers here, the game's rule wins,
the no-contest rule included.

Open:
- question 11, when linking comes.
