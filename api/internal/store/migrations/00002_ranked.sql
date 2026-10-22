-- The ranked rules (notes/accounts.md §2, §3; notes/matchmaking.md LV1): each account's rating per playlist, the matches'
-- results as the game server posts them, the tickets counted in them, and the leavers' queue bans.

-- +goose Up
-- Glicko-2 per account and playlist (1v1, 2v2, 3v3); none until the account's first match there (the defaults then)
CREATE TABLE ratings (
    account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    playlist smallint NOT NULL CHECK (playlist BETWEEN 1 AND 3),
    rating double precision NOT NULL,
    deviation double precision NOT NULL CHECK (deviation > 0),
    volatility double precision NOT NULL CHECK (volatility > 0),
    games integer NOT NULL CHECK (games >= 0),
    last_played timestamptz NOT NULL,
    PRIMARY KEY (account_id, playlist)
);

-- A match's result, once (its id: a retried post changes nothing); kept a year
CREATE TABLE ranked_results (
    match_id text PRIMARY KEY CHECK (octet_length(match_id) BETWEEN 1 AND 64),
    server text NOT NULL CHECK (octet_length(server) BETWEEN 1 AND 255),
    playlist smallint NOT NULL CHECK (playlist BETWEEN 1 AND 3),
    winning_team smallint NOT NULL CHECK (winning_team IN (0, 1)),
    received_at timestamptz NOT NULL
);
CREATE INDEX ranked_results_received ON ranked_results (received_at);

-- Its players: the account (a placeholder, NULL, once deleted: AC-10), team, whether they quit, time played, the
-- ticket's nonce, and the rating before and after
CREATE TABLE ranked_result_players (
    match_id text NOT NULL REFERENCES ranked_results (match_id) ON DELETE CASCADE,
    account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
    team smallint NOT NULL CHECK (team IN (0, 1)),
    quitter boolean NOT NULL,
    seconds integer NOT NULL CHECK (seconds >= 0),
    nonce bytea NOT NULL,
    rating_before double precision NOT NULL,
    rating_after double precision NOT NULL
);
CREATE INDEX ranked_result_players_match ON ranked_result_players (match_id);
CREATE INDEX ranked_result_players_account ON ranked_result_players (account_id);

-- Each ticket counts in one match (AC-5): its result, its quitter report, a refill's rejoin (AP3); kept for the
-- acceptance window at least (AC-22)
CREATE TABLE used_tickets (
    nonce bytea PRIMARY KEY CHECK (octet_length(nonce) = 16),
    issued_at timestamptz NOT NULL,
    used_at timestamptz NOT NULL,
    match_id text NOT NULL CHECK (octet_length(match_id) BETWEEN 1 AND 64)
);
CREATE INDEX used_tickets_issued ON used_tickets (issued_at);

-- The leavers' queue ban (LV1; the ladder ours): the account's step on the ladder, until when, its last leave and the
-- match it came from; the state before that leave, so a rejoin that refills the lobby undoes it
CREATE TABLE queue_bans (
    account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    step smallint NOT NULL CHECK (step BETWEEN 1 AND 5),
    until timestamptz NOT NULL,
    last_leave timestamptz NOT NULL,
    match_id text NOT NULL,
    previous_step smallint NOT NULL CHECK (previous_step BETWEEN 0 AND 5),
    previous_until timestamptz,
    previous_leave timestamptz
);

-- +goose Down
DROP TABLE queue_bans;
DROP TABLE used_tickets;
DROP TABLE ranked_result_players;
DROP TABLE ranked_results;
DROP TABLE ratings;
