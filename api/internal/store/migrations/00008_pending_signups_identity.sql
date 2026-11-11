-- One sign-up waiting per identity (the audit's SEC-API-02): each sign-in of an identity that never finishes its
-- sign-up left another row, so one throwaway provider account could fill the ceiling on the sign-ups waiting and stop
-- every new player's. Its newer sign-in now replaces its row (store.go CreatePending), and the ceiling counts identities.

-- +goose Up
-- (an identity's rows but its latest go: a sign-up under way at the deploy keeps its newest cookie's)
DELETE FROM pending_signups p USING pending_signups q
    WHERE p.provider = q.provider AND p.subject = q.subject
      AND (p.expires_at, p.token_hash) < (q.expires_at, q.token_hash);
CREATE UNIQUE INDEX pending_signups_identity ON pending_signups (provider, subject);

-- +goose Down
DROP INDEX pending_signups_identity;
