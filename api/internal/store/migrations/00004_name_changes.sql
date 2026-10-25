-- Name moderation (the user's, 2026-10-25): every rename kept a year (the player's own, or an admin's with who and why),
-- deleted with its account; an admin's lock on an account's renames, kept across restarts (the 5 a day limit is the
-- service's memory alone). No identity column: the app role's grant covers tables, not sequences.

-- +goose Up
CREATE TABLE name_changes (
    account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    old_name text NOT NULL,
    new_name text NOT NULL,
    changed_at timestamptz NOT NULL,
    -- (an admin's rename: who and why; the player's own: neither)
    changed_by text,
    reason text,
    CHECK ((changed_by IS NULL) = (reason IS NULL))
);
-- (one account's history, newest first; the recent list and the sweep's year, by time)
CREATE INDEX name_changes_account ON name_changes (account_id, changed_at DESC);
CREATE INDEX name_changes_changed ON name_changes (changed_at);

-- (an admin's lock: PUT /api/me/name refused until then; NULL: none)
ALTER TABLE accounts ADD COLUMN renames_locked_until timestamptz;

-- +goose Down
ALTER TABLE accounts DROP COLUMN renames_locked_until;
DROP TABLE name_changes;
