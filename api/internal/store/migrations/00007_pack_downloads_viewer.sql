-- An account's download records found by their viewer (store.go DeleteAccount, deleteAccountDownloads; RV-1205): the
-- account deleted, the records counted for it go too, without reading every record. Partial: the accounts' (16 bytes,
-- an id), never the addresses' keyed hashes (32). Plain CREATE INDEX in the migration's own transaction, as 00003 and
-- 00005: the table holds two days of records (swept hourly), so its lock is brief.

-- +goose Up
CREATE INDEX pack_downloads_viewer ON pack_downloads (viewer) WHERE length(viewer) = 16;

-- +goose Down
DROP INDEX pack_downloads_viewer;
