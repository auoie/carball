-- Accounts, their sign-in identities and sessions, the sign-in flows in progress, bans and the delete/re-create rule
-- (notes/accounts.md §2). Ratings, results, queue bans and used tickets come with the ranked rules (LV1).

-- +goose Up
CREATE TABLE accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL,
    name text NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 32)
);

-- One account per (provider, subject): Google's `sub`, Steam's SteamID64
CREATE TABLE identities (
    provider text NOT NULL CHECK (provider IN ('google', 'steam')),
    subject text NOT NULL CHECK (subject <> ''),
    account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    linked_at timestamptz NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_account ON identities (account_id);

-- A session's token is the cookie's; only its SHA-256 is kept. Rotated about daily, the previous token honoured for a
-- short grace; expires_at is the absolute end (AC-8)
CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    rotated_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    previous_hash bytea UNIQUE,
    previous_until timestamptz
);
CREATE INDEX sessions_account ON sessions (account_id);

-- A sign-in in progress, bound to the browser that started it by the pre-auth cookie (its id's SHA-256 kept), taken once
-- (AC-1)
CREATE TABLE auth_flows (
    id_hash bytea PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('google', 'steam')),
    state text NOT NULL,
    nonce text NOT NULL,
    verifier text NOT NULL,
    expires_at timestamptz NOT NULL
);

-- A new identity's sign-up waiting for its name and the Turnstile check (its cookie's SHA-256 kept)
CREATE TABLE pending_signups (
    token_hash bytea PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('google', 'steam')),
    subject text NOT NULL,
    suggestion text NOT NULL,
    expires_at timestamptz NOT NULL
);

-- Steam's response nonces, kept while they could still pass (no replay: AC-2)
CREATE TABLE steam_nonces (
    nonce text PRIMARY KEY,
    expires_at timestamptz NOT NULL
);

-- The delete/re-create rule (30 days): an identity's keyed hash, HMAC with a server secret (a SteamID64 is enumerable:
-- AC-24)
CREATE TABLE deletions (
    subject_hmac bytea PRIMARY KEY,
    deleted_at timestamptz NOT NULL
);

-- Bans on identities, every identity of an account at once (AC-9); until NULL: no end
CREATE TABLE bans (
    provider text NOT NULL CHECK (provider IN ('google', 'steam')),
    subject text NOT NULL,
    reason text NOT NULL,
    until timestamptz,
    banned_by text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (provider, subject)
);

-- +goose Down
DROP TABLE bans;
DROP TABLE deletions;
DROP TABLE steam_nonces;
DROP TABLE pending_signups;
DROP TABLE auth_flows;
DROP TABLE sessions;
DROP TABLE identities;
DROP TABLE accounts;
