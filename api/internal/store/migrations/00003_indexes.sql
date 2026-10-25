-- Indexes for the reads that would scan their whole table as it grows (the user's, 2026-10-25): the public leaderboard's,
-- the sweep's (Purge: each periodic delete by its time), the admin's (stats, queue bans, bans in force). Plain CREATE
-- INDEX in the migration's own transaction (the tables are small: a brief lock each); CONCURRENTLY would need goose's
-- NO TRANSACTION and leaves an invalid index behind a failure.

-- +goose Up
-- The leaderboard (store/board.go BoardRatings; api/internal/server/public.go): a playlist's ratings whose stored deviation
-- is under the provisional line (110: ranked.Provisional), highest first, the account id the tie-break. Partial: a
-- provisional rating is never on the board (idling only raises a deviation, so one at 110 or past it as stored is
-- provisional at any later read)
CREATE INDEX ratings_board ON ratings (playlist, rating DESC, account_id) WHERE deviation < 110;
-- The sweep (store.go purges): expired sessions; a rotated token's grace ended (the rotated ones alone: partial); expired
-- sign-ins, sign-ups and Steam nonces (the open sign-ins' and sign-ups' counts too); the delete/re-create rule's old
-- records
CREATE INDEX sessions_expires ON sessions (expires_at);
CREATE INDEX sessions_previous_until ON sessions (previous_until) WHERE previous_until IS NOT NULL;
CREATE INDEX auth_flows_expires ON auth_flows (expires_at);
CREATE INDEX pending_signups_expires ON pending_signups (expires_at);
CREATE INDEX steam_nonces_expires ON steam_nonces (expires_at);
CREATE INDEX deletions_deleted ON deletions (deleted_at);
-- The admin's reads (store/admin.go, store.go Bans): the new accounts today and this week (stats); the queue bans in force
-- (queue-bans, stats); the bans in force (bans, stats: a ban that ended is kept, so they'd scan every ban ever)
CREATE INDEX accounts_created ON accounts (created_at);
CREATE INDEX queue_bans_until ON queue_bans (until);
CREATE INDEX bans_until ON bans (until);

-- +goose Down
DROP INDEX bans_until;
DROP INDEX queue_bans_until;
DROP INDEX accounts_created;
DROP INDEX deletions_deleted;
DROP INDEX steam_nonces_expires;
DROP INDEX pending_signups_expires;
DROP INDEX auth_flows_expires;
DROP INDEX sessions_previous_until;
DROP INDEX sessions_expires;
DROP INDEX ratings_board;
