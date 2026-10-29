-- Shared training packs (the user's, 2026-10-29; notes/custom-training.md §9): a pack uploaded by an account, found by
-- its share code or browsed; kept until its owner deletes it or an admin hides it, deleted with its account. Pure data:
-- the pack's canonical file (internal/packs), never the bytes as sent. Its creator shown is the owner's display name, read
-- with it. Search is a plain ILIKE on the name (a sequential scan of the visible packs: fine at this size; no pg_trgm,
-- which the service's role couldn't create). No identity columns: the app role's grant covers tables, not sequences.

-- +goose Up
CREATE TABLE training_packs (
    code text PRIMARY KEY CHECK (code ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'),
    owner_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL,
    type text NOT NULL CHECK (type IN ('striker', 'goalie', 'aerial')),
    difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    shots integer NOT NULL CHECK (shots BETWEEN 1 AND 50),
    pack jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    downloads bigint NOT NULL DEFAULT 0,
    -- (an admin's hide: when, why and who; all three or none)
    hidden_at timestamptz,
    hidden_reason text,
    hidden_by text,
    CHECK ((hidden_at IS NULL) = (hidden_reason IS NULL) AND (hidden_at IS NULL) = (hidden_by IS NULL))
);
-- (browse's two orders, the visible packs alone; an owner's packs, newest first)
CREATE INDEX training_packs_new ON training_packs (created_at DESC, code DESC) WHERE hidden_at IS NULL;
CREATE INDEX training_packs_downloads ON training_packs (downloads DESC, created_at DESC, code DESC) WHERE hidden_at IS NULL;
CREATE INDEX training_packs_owner ON training_packs (owner_id, created_at DESC);

-- Each account's uploads, for the day's limit (kept across restarts, and after a pack's deletion: deleting and uploading
-- again doesn't reset it); swept after two days
CREATE TABLE pack_uploads (
    account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    uploaded_at timestamptz NOT NULL
);
CREATE INDEX pack_uploads_account ON pack_uploads (account_id, uploaded_at);
CREATE INDEX pack_uploads_at ON pack_uploads (uploaded_at);

-- A pack's downloads counted once a day per viewer: an account's id, or a signed-out address's keyed hash (HMAC with a
-- server secret: no address kept); swept after two days
CREATE TABLE pack_downloads (
    code text NOT NULL REFERENCES training_packs (code) ON DELETE CASCADE,
    viewer bytea NOT NULL,
    day date NOT NULL,
    PRIMARY KEY (code, viewer, day)
);
CREATE INDEX pack_downloads_day ON pack_downloads (day);

-- Reports, one per account per pack (the admin's packs --reported)
CREATE TABLE pack_reports (
    code text NOT NULL REFERENCES training_packs (code) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    reported_at timestamptz NOT NULL,
    PRIMARY KEY (code, account_id)
);
CREATE INDEX pack_reports_account ON pack_reports (account_id);

-- +goose Down
DROP TABLE pack_reports;
DROP TABLE pack_downloads;
DROP TABLE pack_uploads;
DROP TABLE training_packs;
