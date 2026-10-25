-- The renames' locks ended are cleared by the sweep (store.go purges; RV-1175): a lock isn't kept past its end, nor
-- past the year its rename is. Partial: only the accounts with a lock, few.

-- +goose Up
CREATE INDEX accounts_renames_locked ON accounts (renames_locked_until) WHERE renames_locked_until IS NOT NULL;

-- +goose Down
DROP INDEX accounts_renames_locked;
