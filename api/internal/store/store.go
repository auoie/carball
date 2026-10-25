// Package store keeps the accounts in Postgres (notes/accounts.md §2): the service connects as a role that reads and
// writes rows only, and the migrations run as the schema's owner, who grants that role its rows (AC-18). Every time is
// the caller's (a test moves its clock), never the database's now().
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	"carball/api/internal/config"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store is the service's connection pool
type Store struct {
	pool *pgxpool.Pool
}

// Open connects the service's role (DATABASE_URL, its password from a file)
func Open(ctx context.Context, dsn, passwordFile string) (*Store, error) {
	return open(ctx, dsn, passwordFile, func(cfg *pgxpool.Config) { cfg.MaxConns = 10 })
}

// OpenAdmin connects the admin's commands (the same role and database, on the live one): named carball-admin among the
// server's sessions, a statement given 15 s and a lock 2 s at most (a report never waits for ever, nor holds the
// service's queries behind a migration's lock it queued for), and with `readOnly` (the reports, accounts, bans) every
// transaction read-only, a write refused by the server itself (RX35). A transaction left open and idle 5 s (a command
// stopped mid-ban: Ctrl-Z) is ended by the server, so it can't hold a sign-up's identity lock or the service's
// connections behind it (RV-823)
func OpenAdmin(ctx context.Context, dsn, passwordFile string, readOnly bool) (*Store, error) {
	return open(ctx, dsn, passwordFile, func(cfg *pgxpool.Config) {
		cfg.MaxConns = 2
		params := cfg.ConnConfig.RuntimeParams
		params["application_name"] = "carball-admin"
		params["statement_timeout"] = "15000"
		params["lock_timeout"] = "2000"
		params["idle_in_transaction_session_timeout"] = "5000"
		if readOnly {
			params["default_transaction_read_only"] = "on"
		}
	})
}

func open(ctx context.Context, dsn, passwordFile string, tune func(*pgxpool.Config)) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	if passwordFile != "" {
		if cfg.ConnConfig.Password, err = config.ReadSecret(passwordFile); err != nil {
			return nil, fmt.Errorf("DATABASE_PASSWORD_FILE: %w", err)
		}
	}
	tune(cfg)
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("the database: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Provider is a sign-in provider (the identities' `provider` column): an enum, every switch over it whole (the
// exhaustive linter)
type Provider string

// The providers (notes/accounts.md §1)
const (
	Google Provider = "google"
	Steam  Provider = "steam"
)

// ParseProvider is the provider by its name, if it is one
func ParseProvider(name string) (Provider, bool) {
	switch p := Provider(name); p {
	case Google, Steam:
		return p, true
	}
	return "", false
}

// BanEnd is when a ban ends: Permanent or Until (sealed: gochecksumtype keeps every type switch over it whole)
//
//sumtype:decl
type BanEnd interface{ banEnd() }

// Permanent is a ban with no end
type Permanent struct{}

// Until is a ban that ends at a time
type Until struct{ At time.Time }

func (Permanent) banEnd() {}
func (Until) banEnd()     {}

// endColumn is the bans' `until` column for an end (NULL: none)
func endColumn(e BanEnd) *time.Time {
	switch e := e.(type) {
	case Permanent:
		return nil
	case Until:
		return &e.At
	}
	panic(fmt.Sprintf("a ban's end %T", e))
}

// endOf is the end the bans' `until` column holds
func endOf(until *time.Time) BanEnd {
	if until == nil {
		return Permanent{}
	}
	return Until{At: *until}
}

// Close ends the pool
func (s *Store) Close() { s.pool.Close() }

// Ping checks the database answers (the health check)
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// CanCreate: the connected role may create in the schema (the service's must not: rows only, AP-4)
func (s *Store) CanCreate(ctx context.Context) (bool, error) {
	var can bool
	err := s.pool.QueryRow(ctx, `SELECT has_schema_privilege('public', 'CREATE')`).Scan(&can)
	return can, err
}

// ErrSameRole: the migrations' role and the service's are one (the service's would own the schema: AP-4)
var ErrSameRole = errors.New("MIGRATE_DATABASE_URL and DATABASE_URL name the same role: the service's must be its own, rows only")

// Migrate brings the schema up to date as its owner (dsn, its password from a file), one process at a time (an advisory
// lock), then grants appRole (the service's: DATABASE_URL's user) its tables' rows and nothing else. A role of its own:
// the same one is refused, unless `sameRole` allows it (development's single role)
func Migrate(ctx context.Context, dsn, passwordFile, appRole string, sameRole bool) error {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("MIGRATE_DATABASE_URL: %w", err)
	}
	if appRole == cfg.User && !sameRole {
		return ErrSameRole
	}
	if passwordFile != "" {
		if cfg.Password, err = config.ReadSecret(passwordFile); err != nil {
			return fmt.Errorf("MIGRATE_DATABASE_PASSWORD_FILE: %w", err)
		}
	}
	db := stdlib.OpenDB(*cfg)
	defer func() { _ = db.Close() }()
	dir, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return err
	}
	p, err := goose.NewProvider(goose.DialectPostgres, db, dir, goose.WithSessionLocker(locker))
	if err != nil {
		return err
	}
	if _, err := p.Up(ctx); err != nil {
		return fmt.Errorf("the migrations: %w", err)
	}
	if appRole == "" || appRole == cfg.User {
		return nil
	}
	return grant(ctx, db, appRole)
}

// (rows of every table but the migrations' own record; the schema used, never changed: no CREATE for anyone but its
// owner, as Postgres 15's default, said for 13 and 14 too: AP-5)
func grant(ctx context.Context, db *sql.DB, role string) error {
	r := pgx.Identifier{role}.Sanitize()
	for _, q := range []string{
		"REVOKE CREATE ON SCHEMA public FROM PUBLIC",
		"GRANT USAGE ON SCHEMA public TO " + r,
		"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO " + r,
		"REVOKE ALL ON goose_db_version FROM " + r,
	} {
		if _, err := db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("granting %s its rows: %w", role, err)
		}
	}
	return nil
}

// AppRole is DATABASE_URL's user: the role the migrations grant
func AppRole(dsn string) (string, error) {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return "", err
	}
	return cfg.User, nil
}

// --- Sign-in flows ---

// Flow is a sign-in in progress
type Flow struct {
	IDHash    []byte
	Provider  Provider
	State     string
	Nonce     string
	Verifier  string
	ExpiresAt time.Time
}

func (s *Store) CreateFlow(ctx context.Context, f Flow) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO auth_flows (id_hash, provider, state, nonce, verifier, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)`, f.IDHash, f.Provider, f.State, f.Nonce, f.Verifier, f.ExpiresAt)
	return err
}

// OpenFlows counts the sign-ins in progress at now (a ceiling on them: AP-2)
func (s *Store) OpenFlows(ctx context.Context, now time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM auth_flows WHERE expires_at > $1`, now).Scan(&n)
	return n, err
}

// OpenSignups counts the sign-ups waiting at now (a ceiling on them: AP-2)
func (s *Store) OpenSignups(ctx context.Context, now time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM pending_signups WHERE expires_at > $1`, now).Scan(&n)
	return n, err
}

// TakeFlow removes the flow and returns it, if it's there and not expired: a flow is used once
func (s *Store) TakeFlow(ctx context.Context, idHash []byte, now time.Time) (Flow, bool, error) {
	f := Flow{IDHash: idHash}
	err := s.pool.QueryRow(ctx, `DELETE FROM auth_flows WHERE id_hash = $1
		RETURNING provider, state, nonce, verifier, expires_at`, idHash).
		Scan(&f.Provider, &f.State, &f.Nonce, &f.Verifier, &f.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Flow{}, false, nil
	}
	if err != nil {
		return Flow{}, false, err
	}
	return f, f.ExpiresAt.After(now), nil
}

// UseNonce records a Steam response nonce (steam.NonceStore)
func (s *Store) UseNonce(ctx context.Context, nonce string, until time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `INSERT INTO steam_nonces (nonce, expires_at) VALUES ($1, $2)
		ON CONFLICT (nonce) DO NOTHING`, nonce, until)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// --- Identities, bans, the delete/re-create rule ---

// AccountByIdentity is the account an identity signs in to, if any
func (s *Store) AccountByIdentity(ctx context.Context, provider Provider, subject string) (string, bool, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT account_id::text FROM identities WHERE provider = $1 AND subject = $2`,
		provider, subject).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

// Ban is a ban in force on an identity
type Ban struct {
	Provider   Provider
	Subject    string
	Reason, By string
	End        BanEnd
	Created    time.Time
}

// BanOn is the ban in force on an identity at now, if any
func (s *Store) BanOn(ctx context.Context, provider Provider, subject string, now time.Time) (Ban, bool, error) {
	return banOn(ctx, s.pool, provider, subject, now)
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func banOn(ctx context.Context, q querier, provider Provider, subject string, now time.Time) (Ban, bool, error) {
	b := Ban{Provider: provider, Subject: subject}
	var until *time.Time
	err := q.QueryRow(ctx, `SELECT reason, until, banned_by, created_at FROM bans
		WHERE provider = $1 AND subject = $2 AND (until IS NULL OR until > $3)`, provider, subject, now).
		Scan(&b.Reason, &until, &b.By, &b.Created)
	if errors.Is(err, pgx.ErrNoRows) {
		return Ban{}, false, nil
	}
	if err != nil {
		return Ban{}, false, err
	}
	b.End = endOf(until)
	return b, true, nil
}

// DeletedAfter: when an identity (its keyed hash) last deleted an account, if after `after`
func (s *Store) DeletedAfter(ctx context.Context, subjectHMAC []byte, after time.Time) (time.Time, bool, error) {
	return deletedAfter(ctx, s.pool, subjectHMAC, after)
}

func deletedAfter(ctx context.Context, q querier, subjectHMAC []byte, after time.Time) (time.Time, bool, error) {
	var at time.Time
	err := q.QueryRow(ctx, `SELECT deleted_at FROM deletions WHERE subject_hmac = $1 AND deleted_at > $2`,
		subjectHMAC, after).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, nil
	}
	return at, err == nil, err
}

// --- Sign-ups ---

// Pending is a new identity's sign-up waiting for its name and the Turnstile check
type Pending struct {
	TokenHash  []byte
	Provider   Provider
	Subject    string
	Suggestion string
	ExpiresAt  time.Time
}

func (s *Store) CreatePending(ctx context.Context, p Pending) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO pending_signups (token_hash, provider, subject, suggestion, expires_at)
		VALUES ($1, $2, $3, $4, $5)`, p.TokenHash, p.Provider, p.Subject, p.Suggestion, p.ExpiresAt)
	return err
}

// PendingSignup is the sign-up a cookie names, if it's there and not expired
func (s *Store) PendingSignup(ctx context.Context, tokenHash []byte, now time.Time) (Pending, bool, error) {
	p := Pending{TokenHash: tokenHash}
	err := s.pool.QueryRow(ctx, `SELECT provider, subject, suggestion, expires_at FROM pending_signups
		WHERE token_hash = $1 AND expires_at > $2`, tokenHash, now).
		Scan(&p.Provider, &p.Subject, &p.Suggestion, &p.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Pending{}, false, nil
	}
	return p, err == nil, err
}

// Sign-up refusals (CreateAccount)
var (
	ErrPendingGone   = errors.New("the sign-up is gone or expired")
	ErrIdentityTaken = errors.New("the identity has an account already")
)

// BannedError: the identity is banned
type BannedError struct{ Ban Ban }

func (e BannedError) Error() string { return "the identity is banned" }

// RecreateError: the identity deleted an account within the block
type RecreateError struct{ DeletedAt time.Time }

func (e RecreateError) Error() string { return "the identity deleted an account recently" }

// CreateAccount turns a pending sign-up into an account, in one transaction that checks again what may have changed
// since the sign-in: the sign-up still there (and taken), no ban, no deletion after blockAfter, the identity free
func (s *Store) CreateAccount(ctx context.Context, p Pending, name string, subjectHMAC []byte, now, blockAfter time.Time) (string, error) {
	var id string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockIdentity(ctx, tx, Identity{Provider: p.Provider, Subject: p.Subject}); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM pending_signups WHERE token_hash = $1 AND provider = $2 AND subject = $3
			AND expires_at > $4`, p.TokenHash, p.Provider, p.Subject, now)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return ErrPendingGone
		}
		if ban, banned, err := banOn(ctx, tx, p.Provider, p.Subject, now); err != nil {
			return err
		} else if banned {
			return BannedError{ban}
		}
		if at, blocked, err := deletedAfter(ctx, tx, subjectHMAC, blockAfter); err != nil {
			return err
		} else if blocked {
			return RecreateError{at}
		}
		if err := tx.QueryRow(ctx, `INSERT INTO accounts (created_at, name) VALUES ($1, $2) RETURNING id::text`,
			now, name).Scan(&id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO identities (provider, subject, account_id, linked_at) VALUES ($1, $2, $3, $4)`,
			p.Provider, p.Subject, id, now)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // (unique_violation: signed up meanwhile)
			return ErrIdentityTaken
		}
		return err
	})
	return id, err
}

// --- Sessions ---

// Session is a signed-in browser's; Previous: the token given was the one rotated out (in its grace)
type Session struct {
	TokenHash []byte
	AccountID string
	// AccountName: its account's display name (the log's)
	AccountName string
	RotatedAt   time.Time
	ExpiresAt   time.Time
	Previous    bool
}

func (s *Store) CreateSession(ctx context.Context, tokenHash []byte, accountID string, now, expires time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO sessions (token_hash, account_id, created_at, rotated_at, expires_at)
		VALUES ($1, $2, $3, $3, $4)`, tokenHash, accountID, now, expires)
	return err
}

// SessionByToken is the session a token opens at now: its current token, or the previous one within its grace; none for
// an account with a ban in force on any of its identities (a ban racing a sign-in still shuts it: AP-3)
func (s *Store) SessionByToken(ctx context.Context, tokenHash []byte, now time.Time) (Session, bool, error) {
	var ss Session
	err := s.pool.QueryRow(ctx, `SELECT s.token_hash, s.account_id::text, a.name, s.rotated_at, s.expires_at, s.token_hash <> $1
		FROM sessions s JOIN accounts a ON a.id = s.account_id
		WHERE (s.token_hash = $1 OR (s.previous_hash = $1 AND s.previous_until > $2)) AND s.expires_at > $2
		AND NOT EXISTS (SELECT 1 FROM identities i JOIN bans b ON b.provider = i.provider AND b.subject = i.subject
			WHERE i.account_id = s.account_id AND (b.until IS NULL OR b.until > $2))`,
		tokenHash, now).Scan(&ss.TokenHash, &ss.AccountID, &ss.AccountName, &ss.RotatedAt, &ss.ExpiresAt, &ss.Previous)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, nil
	}
	return ss, err == nil, err
}

// RotateSession replaces a session's token, the old one honoured until graceUntil; false if another request rotated
// it first
func (s *Store) RotateSession(ctx context.Context, oldHash, newHash []byte, now, graceUntil time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE sessions SET token_hash = $2, previous_hash = $1, previous_until = $4,
		rotated_at = $3 WHERE token_hash = $1`, oldHash, newHash, now, graceUntil)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// DeleteSession signs a browser out (by either of its tokens)
func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1 OR previous_hash = $1`, tokenHash)
	return err
}

// DeleteSessions signs an account out everywhere
func (s *Store) DeleteSessions(ctx context.Context, accountID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE account_id = $1`, accountID)
	return err
}

// --- Accounts ---

// Account is what the account page shows
type Account struct {
	ID        string
	Name      string
	CreatedAt time.Time
	Providers []Provider
}

// ErrNoAccount: no account by that id
var ErrNoAccount = errors.New("no such account")

func (s *Store) Account(ctx context.Context, id string) (Account, error) {
	a := Account{ID: id}
	err := s.pool.QueryRow(ctx, `SELECT a.name, a.created_at,
		coalesce(array_agg(i.provider ORDER BY i.provider) FILTER (WHERE i.provider IS NOT NULL), '{}')
		FROM accounts a LEFT JOIN identities i ON i.account_id = a.id WHERE a.id = $1 GROUP BY a.id`, id).
		Scan(&a.Name, &a.CreatedAt, &a.Providers)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrNoAccount
	}
	return a, err
}

// RenameLockedError refuses a player's rename of an account an admin locked, until Until
type RenameLockedError struct{ Until time.Time }

func (e RenameLockedError) Error() string { return "the account's renames are locked" }

// Rename is the player's own rename at now: refused while an admin's lock holds (RenameLockedError), recorded in the
// account's name changes in the same transaction (none when the name is the same)
func (s *Store) Rename(ctx context.Context, id, name string, now time.Time) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		old, locked, err := nameForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if locked != nil && locked.After(now) {
			return RenameLockedError{Until: *locked}
		}
		return rename(ctx, tx, id, old, name, nil, nil, now)
	})
}

// AdminRename is an admin's rename at now to a name `draw` gives (drawn again while it's the account's name now, so the
// change and its by and reason are always recorded: RV-1176), the account's renames locked until `lockUntil` if that's
// later than a lock it has (zero: its lock as it was; a lock is only shortened by UnlockRenames, RV-1174); the old name,
// the new, and the lock's end as it is now (the later of the two; zero: no lockUntil asked, RV-1180)
func (s *Store) AdminRename(ctx context.Context, id string, draw func() string, by, reason string, lockUntil, now time.Time) (old, name string, locked time.Time, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		if old, _, err = nameForUpdate(ctx, tx, id); err != nil {
			return err
		}
		for range 100 {
			if name = draw(); name != old {
				break
			}
		}
		if name == old {
			return errors.New("no name drawn but the account's own")
		}
		if !lockUntil.IsZero() {
			if err := tx.QueryRow(ctx, `UPDATE accounts SET renames_locked_until = GREATEST(renames_locked_until, $2) WHERE id = $1
				RETURNING renames_locked_until`, id, lockUntil).Scan(&locked); err != nil {
				return err
			}
		}
		return rename(ctx, tx, id, old, name, &by, &reason, now)
	})
	return old, name, locked, err
}

// UnlockRenames lifts an admin's lock on an account's renames at now, recorded in its name changes (its name kept, by
// and why: "renames unlocked: " and the reason); when the lock would have ended (nil: none in force, nothing recorded:
// one that has ended, the sweep not yet past it, is none, RV-1180)
func (s *Store) UnlockRenames(ctx context.Context, id, by, reason string, now time.Time) (*time.Time, error) {
	var was *time.Time
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		name, locked, err := nameForUpdate(ctx, tx, id)
		if err != nil || locked == nil || !locked.After(now) {
			return err
		}
		was = locked
		if _, err := tx.Exec(ctx, `UPDATE accounts SET renames_locked_until = NULL WHERE id = $1`, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO name_changes (account_id, old_name, new_name, changed_at, changed_by, reason)
			VALUES ($1, $2, $2, $3, $4, $5)`, id, name, now, by, "renames unlocked: "+reason)
		return err
	})
	return was, err
}

// RenameLockedUntil is the end of an admin's lock on an account's renames (ok false: none, or it has ended by now): the
// rename's check before its limit is charged (a locked player's tries never use it up, RV-1173; Rename checks again)
func (s *Store) RenameLockedUntil(ctx context.Context, id string, now time.Time) (time.Time, bool, error) {
	var until *time.Time
	err := s.pool.QueryRow(ctx, `SELECT renames_locked_until FROM accounts WHERE id = $1`, id).Scan(&until)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, ErrNoAccount
	}
	if err != nil || until == nil || !until.After(now) {
		return time.Time{}, false, err
	}
	return *until, true, nil
}

// nameForUpdate: an account's name and its renames' lock (nil: none), its row held till the transaction ends
func nameForUpdate(ctx context.Context, tx pgx.Tx, id string) (string, *time.Time, error) {
	var name string
	var locked *time.Time
	err := tx.QueryRow(ctx, `SELECT name, renames_locked_until FROM accounts WHERE id = $1 FOR UPDATE`, id).Scan(&name, &locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, ErrNoAccount
	}
	return name, locked, err
}

// rename: the account's name set and the change recorded (by and reason an admin's; nil, the player's), unless it's
// the same
func rename(ctx context.Context, tx pgx.Tx, id, old, name string, by, reason *string, now time.Time) error {
	if name == old {
		return nil
	}
	if _, err := tx.Exec(ctx, `UPDATE accounts SET name = $2 WHERE id = $1`, id, name); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO name_changes (account_id, old_name, new_name, changed_at, changed_by, reason)
		VALUES ($1, $2, $3, $4, $5, $6)`, id, old, name, now, by, reason)
	return err
}

// Identity is one sign-in of an account
type Identity struct {
	Provider Provider
	Subject  string
}

// DeleteAccount deletes an account at once (AC-10): each identity's keyed hash recorded for the delete/re-create rule,
// then the account, its identities and sessions; bans on its identities stay
func (s *Store) DeleteAccount(ctx context.Context, id string, hmacOf func(Identity) []byte, now time.Time) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		ids, err := identitiesOf(ctx, tx, id, true)
		if err != nil {
			return err
		}
		for _, i := range ids {
			if _, err := tx.Exec(ctx, `INSERT INTO deletions (subject_hmac, deleted_at) VALUES ($1, $2)
				ON CONFLICT (subject_hmac) DO UPDATE SET deleted_at = excluded.deleted_at`, hmacOf(i), now); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `DELETE FROM accounts WHERE id = $1`, id)
		if err == nil && tag.RowsAffected() != 1 {
			return ErrNoAccount
		}
		return err
	})
}

func identitiesOf(ctx context.Context, tx pgx.Tx, accountID string, lock bool) ([]Identity, error) {
	q := `SELECT provider, subject FROM identities WHERE account_id = $1 ORDER BY provider`
	if lock {
		q += ` FOR UPDATE`
	}
	rows, err := tx.Query(ctx, q, accountID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Identity, error) {
		var i Identity
		err := r.Scan(&i.Provider, &i.Subject)
		return i, err
	})
}

// --- Bans (the admin command: notes/accounts.md §4) ---

// ErrNoIdentity: no account has signed in with that identity, so a ban on it is refused (a mistyped one would ban no
// one: RV-781)
var ErrNoIdentity = errors.New("no account has signed in with that identity")

// HasAccountError: a ban asked for an identity with no account (BanNoAccount) refused, an account has signed in with it
type HasAccountError struct{ Account string }

func (e HasAccountError) Error() string { return "an account has signed in with that identity" }

// AlreadyBannedError: a ban refused, nothing changed, because some of its identities are banned already and it wasn't
// asked to replace their bans (RV-787): those bans
type AlreadyBannedError struct{ Bans []Ban }

func (e AlreadyBannedError) Error() string { return "already banned" }

// Banned is what a ban did: the identities banned, their account (signed out everywhere), and the bans in force it
// replaced
type Banned struct {
	Identities []Identity
	Account    string
	Replaced   []Ban
}

// BanAccount bans every identity of an account and signs it out everywhere; a ban in force on any of them is
// replaced only with `replace` (else AlreadyBannedError)
func (s *Store) BanAccount(ctx context.Context, accountID, reason, by string, end BanEnd, replace bool, now time.Time) (Banned, error) {
	b := Banned{Account: accountID}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		if b.Identities, err = identitiesOf(ctx, tx, accountID, true); err != nil {
			return err
		}
		if len(b.Identities) == 0 {
			return ErrNoAccount
		}
		b.Replaced, err = banIdentities(ctx, tx, b.Identities, accountID, reason, by, end, replace, now)
		return err
	})
	return b, err
}

// BanIdentity bans an identity's account, every identity of it, as BanAccount; an identity no account has is refused
// (ErrNoIdentity)
func (s *Store) BanIdentity(ctx context.Context, i Identity, reason, by string, end BanEnd, replace bool, now time.Time) (Banned, error) {
	var b Banned
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT account_id::text FROM identities WHERE provider = $1 AND subject = $2`,
			i.Provider, i.Subject).Scan(&b.Account)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoIdentity
		}
		if err != nil {
			return err
		}
		if b.Identities, err = identitiesOf(ctx, tx, b.Account, true); err != nil {
			return err
		}
		b.Replaced, err = banIdentities(ctx, tx, b.Identities, b.Account, reason, by, end, replace, now)
		return err
	})
	return b, err
}

// BanNoAccount bans an identity no account has signed in with: the admin's deliberate choice (a deleted account's, a
// known throwaway's: RV-788), which keeps it from making one; refused if an account has it (HasAccountError), and a ban
// in force on it replaced only with `replace` (else AlreadyBannedError)
func (s *Store) BanNoAccount(ctx context.Context, i Identity, reason, by string, end BanEnd, replace bool, now time.Time) (Banned, error) {
	b := Banned{Identities: []Identity{i}}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockIdentity(ctx, tx, i); err != nil {
			return err
		}
		var account string
		err := tx.QueryRow(ctx, `SELECT account_id::text FROM identities WHERE provider = $1 AND subject = $2`,
			i.Provider, i.Subject).Scan(&account)
		if err == nil {
			return HasAccountError{Account: account}
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		b.Replaced, err = banIdentities(ctx, tx, b.Identities, "", reason, by, end, replace, now)
		return err
	})
	return b, err
}

// lockIdentity: the transaction holds an identity's lock until it ends, so a ban on an identity with no account and its
// sign-up, or two such bans, take turns: each sees what the other committed (no row exists to lock: RV-807, RV-808)
func lockIdentity(ctx context.Context, tx pgx.Tx, i Identity) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, string(i.Provider), i.Subject)
	return err
}

// banIdentities: the identities banned and their account's sessions ended (none: no account); the bans in force it replaced, none
// replaced without `replace`
func banIdentities(ctx context.Context, tx pgx.Tx, ids []Identity, accountID, reason, by string, end BanEnd, replace bool, now time.Time) ([]Ban, error) {
	var held []Ban
	for _, i := range ids {
		b, banned, err := banOn(ctx, tx, i.Provider, i.Subject, now)
		if err != nil {
			return nil, err
		}
		if banned {
			held = append(held, b)
		}
	}
	if len(held) > 0 && !replace {
		return nil, AlreadyBannedError{Bans: held}
	}
	until := endColumn(end)
	for _, i := range ids {
		if _, err := tx.Exec(ctx, `INSERT INTO bans (provider, subject, reason, until, banned_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (provider, subject) DO UPDATE
			SET reason = excluded.reason, until = excluded.until, banned_by = excluded.banned_by,
			created_at = excluded.created_at`, i.Provider, i.Subject, reason, until, by, now); err != nil {
			return nil, err
		}
	}
	if accountID == "" {
		return held, nil
	}
	_, err := tx.Exec(ctx, `DELETE FROM sessions WHERE account_id = $1`, accountID)
	return held, err
}

// Unban lifts the bans on an identity and on every identity of its account; how many were lifted
func (s *Store) Unban(ctx context.Context, i Identity) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM bans b WHERE (b.provider = $1 AND b.subject = $2)
		OR (b.provider, b.subject) IN (SELECT o.provider, o.subject FROM identities o JOIN identities m
			ON m.account_id = o.account_id WHERE m.provider = $1 AND m.subject = $2)`, i.Provider, i.Subject)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// UnbanAccount lifts the bans on every identity of an account
func (s *Store) UnbanAccount(ctx context.Context, accountID string) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM bans b USING identities i
		WHERE i.account_id = $1 AND b.provider = i.provider AND b.subject = i.subject`, accountID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// Bans lists the bans in force at now, newest first
func (s *Store) Bans(ctx context.Context, now time.Time) ([]Ban, error) {
	rows, err := s.pool.Query(ctx, `SELECT provider, subject, reason, until, banned_by, created_at FROM bans
		WHERE until IS NULL OR until > $1 ORDER BY created_at DESC`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Ban, error) {
		var b Ban
		var until *time.Time
		err := r.Scan(&b.Provider, &b.Subject, &b.Reason, &until, &b.By, &b.Created)
		b.End = endOf(until)
		return b, err
	})
}

// Found is an account the admin command lists
type Found struct {
	Account
	Identities []Identity
	// LastSeen: the account's latest session sign-in or daily token renewal, so when it last used the site to within a
	// day; none when it has no session kept (they end after 90 days). Nothing tracked for it: the sessions' own times
	LastSeen *time.Time
}

// foundAccounts: the accounts, their identities and their latest session's time, for a WHERE / ORDER / LIMIT after it
const foundAccounts = `SELECT a.id::text, a.name, a.created_at,
		coalesce(array_agg(i.provider || ':' || i.subject ORDER BY i.provider)
			FILTER (WHERE i.provider IS NOT NULL), '{}'),
		(SELECT max(s.rotated_at) FROM sessions s WHERE s.account_id = a.id)
		FROM accounts a LEFT JOIN identities i ON i.account_id = a.id`

// FindAccounts lists the accounts whose name contains `name` (any case), newest first, at most 50
func (s *Store) FindAccounts(ctx context.Context, name string) ([]Found, error) {
	rows, err := s.pool.Query(ctx, foundAccounts+`
		WHERE strpos(lower(a.name), lower($1)) > 0 GROUP BY a.id ORDER BY a.created_at DESC LIMIT 50`, name)
	if err != nil {
		return nil, err
	}
	return collectFound(rows)
}

// RecentAccounts lists the newest `n` accounts, newest first
func (s *Store) RecentAccounts(ctx context.Context, n int) ([]Found, error) {
	rows, err := s.pool.Query(ctx, foundAccounts+` GROUP BY a.id ORDER BY a.created_at DESC LIMIT $1`, n)
	if err != nil {
		return nil, err
	}
	return collectFound(rows)
}

func collectFound(rows pgx.Rows) ([]Found, error) {
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Found, error) {
		var f Found
		var ids []string
		if err := r.Scan(&f.ID, &f.Name, &f.CreatedAt, &ids, &f.LastSeen); err != nil {
			return f, err
		}
		for _, id := range ids {
			provider, subject, _ := cutColon(id)
			f.Identities = append(f.Identities, Identity{Provider(provider), subject})
			f.Providers = append(f.Providers, Provider(provider))
		}
		return f, nil
	})
}

func cutColon(s string) (string, string, bool) {
	for i := range len(s) {
		if s[i] == ':' {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}

// --- Retention (notes/accounts.md §2) ---

// NameChangesKept is how long a rename is kept (moderation's year: the privacy page's)
const NameChangesKept = 365 * 24 * time.Hour

// purges are Purge's statements, each by its time ($1: `at`'s of now and the deletions' cut), each on its index
// (migrations 00003, 00004, 00005)
var purges = []struct {
	sql string
	at  func(now, deletionsBefore time.Time) time.Time
}{
	{`DELETE FROM sessions WHERE expires_at <= $1`, atNow},
	{`UPDATE sessions SET previous_hash = NULL, previous_until = NULL WHERE previous_until <= $1`, atNow},
	{`DELETE FROM auth_flows WHERE expires_at <= $1`, atNow},
	{`DELETE FROM pending_signups WHERE expires_at <= $1`, atNow},
	{`DELETE FROM steam_nonces WHERE expires_at <= $1`, atNow},
	{`DELETE FROM deletions WHERE deleted_at <= $1`, func(_, deletionsBefore time.Time) time.Time { return deletionsBefore }},
	{`DELETE FROM name_changes WHERE changed_at <= $1`, func(now, _ time.Time) time.Time { return now.Add(-NameChangesKept) }},
	{`UPDATE accounts SET renames_locked_until = NULL WHERE renames_locked_until <= $1`, atNow},
}

func atNow(now, _ time.Time) time.Time { return now }

// Purge removes what has run out by now: sessions past their end, flows, sign-ups and Steam nonces past theirs, the
// delete/re-create rule's records from before deletionsBefore (their 30 days over), renames older than NameChangesKept,
// renames' locks ended
func (s *Store) Purge(ctx context.Context, now, deletionsBefore time.Time) error {
	for _, q := range purges {
		if _, err := s.pool.Exec(ctx, q.sql, q.at(now, deletionsBefore)); err != nil {
			return err
		}
	}
	return nil
}

// --- The ranked rules (notes/accounts.md §2, §3; LV1) ---

// Rating is an account's Glicko-2 rating in a playlist
type Rating struct {
	Rating, Deviation, Volatility float64
	Games                         int
	LastPlayed                    time.Time
}

// RatingsOf is an account's ratings by playlist (1, 2, 3): none where it hasn't played
func (s *Store) RatingsOf(ctx context.Context, accountID string) (map[int]Rating, error) {
	return ratingsOf(ctx, s.pool, `SELECT playlist, rating, deviation, volatility, games, last_played FROM ratings
		WHERE account_id = $1`, accountID)
}

func ratingsOf(ctx context.Context, q querier, sql string, args ...any) (map[int]Rating, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out := map[int]Rating{}
	var key int
	var r Rating
	_, err = pgx.ForEachRow(rows, []any{&key, &r.Rating, &r.Deviation, &r.Volatility, &r.Games, &r.LastPlayed}, func() error {
		out[key] = r
		return nil
	})
	return out, err
}

// QueueBan is an account's leavers' queue ban (LV1): its step on the ladder (1-5), until when, its last leave and the
// match it came from; and the state before that leave (step 0 and no times: none), for a rejoin that refills the lobby
type QueueBan struct {
	Step          int
	Until         time.Time
	LastLeave     time.Time
	Match         string
	PreviousStep  int
	PreviousUntil *time.Time
	PreviousLeave *time.Time
}

// QueueBanOf is an account's queue ban row, if it has one (in force or not: Until says)
func (s *Store) QueueBanOf(ctx context.Context, accountID string) (QueueBan, bool, error) {
	return queueBanOf(ctx, s.pool, accountID, false)
}

func queueBanOf(ctx context.Context, q querier, accountID string, lock bool) (QueueBan, bool, error) {
	sql := `SELECT step, until, last_leave, match_id, previous_step, previous_until, previous_leave FROM queue_bans
		WHERE account_id = $1`
	if lock {
		sql += ` FOR UPDATE`
	}
	var b QueueBan
	err := q.QueryRow(ctx, sql, accountID).Scan(&b.Step, &b.Until, &b.LastLeave, &b.Match, &b.PreviousStep, &b.PreviousUntil, &b.PreviousLeave)
	if errors.Is(err, pgx.ErrNoRows) {
		return QueueBan{}, false, nil
	}
	return b, err == nil, err
}

// SpentTicket is a ticket spent on a match: its nonce, its issue time (kept as long as the acceptance window) and the
// match (one ticket counts in one match alone: a result's, a quitter's and a refill's, AC-5, AP3)
type SpentTicket struct {
	Nonce    [16]byte
	IssuedAt time.Time
	Match    string
	// Once: spent once only, its own match again too (a refill's rejoin ticket: one refill each, RX31)
	Once bool
}

// spendTicket spends a ticket on its match: again on the same match, fine (a quitter's ticket then its result's), unless
// it's spent once only; on another, ErrTicketUsed
func spendTicket(ctx context.Context, tx pgx.Tx, t SpentTicket, now time.Time) error {
	conflict := `ON CONFLICT (nonce) DO UPDATE SET used_at = used_tickets.used_at WHERE used_tickets.match_id = excluded.match_id`
	if t.Once {
		conflict = `ON CONFLICT (nonce) DO NOTHING`
	}
	tag, err := tx.Exec(ctx, `INSERT INTO used_tickets (nonce, issued_at, used_at, match_id) VALUES ($1, $2, $3, $4) `+conflict,
		t.Nonce[:], t.IssuedAt, now, t.Match)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTicketUsed
	}
	return nil
}

// ChangeQueueBan changes an account's queue ban in one transaction: `spend` (if any) spent first (ErrTicketUsed), then
// `change` gets its row (and whether there is one) and returns the new one (nil: none), or write false to leave it. No
// such account: ErrNoAccount
func (s *Store) ChangeQueueBan(ctx context.Context, accountID string, spend *SpentTicket, now time.Time, change func(cur QueueBan, exists bool) (next *QueueBan, write bool)) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		var one int
		if err := tx.QueryRow(ctx, `SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&one); errors.Is(err, pgx.ErrNoRows) {
			return ErrNoAccount
		} else if err != nil {
			return err
		}
		if spend != nil {
			if err := spendTicket(ctx, tx, *spend, now); err != nil {
				return err
			}
		}
		cur, exists, err := queueBanOf(ctx, tx, accountID, true)
		if err != nil {
			return err
		}
		next, write := change(cur, exists)
		switch {
		case !write:
			return nil
		case next == nil:
			_, err = tx.Exec(ctx, `DELETE FROM queue_bans WHERE account_id = $1`, accountID)
		default:
			_, err = tx.Exec(ctx, `INSERT INTO queue_bans (account_id, step, until, last_leave, match_id, previous_step,
				previous_until, previous_leave) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (account_id) DO UPDATE SET step = excluded.step, until = excluded.until,
				last_leave = excluded.last_leave, match_id = excluded.match_id, previous_step = excluded.previous_step,
				previous_until = excluded.previous_until, previous_leave = excluded.previous_leave`,
				accountID, next.Step, next.Until, next.LastLeave, next.Match, next.PreviousStep, next.PreviousUntil, next.PreviousLeave)
		}
		return err
	})
}

// Result is a match's result as recorded: its id, the game server's, the playlist (its team size), the winning team, the
// players
type Result struct {
	Match       string
	Server      string
	Playlist    int
	WinningTeam int
	Players     []ResultPlayer
}

// ResultPlayer is one player of a result: their account, team, whether they quit, time played, and their ticket's nonce
// and issue time
type ResultPlayer struct {
	Account  string
	Team     int
	Quitter  bool
	Seconds  int
	Nonce    [16]byte
	IssuedAt time.Time
}

// ErrTicketUsed: a ticket spent on another match already (AC-5)
var ErrTicketUsed = errors.New("a ticket spent on another match")

// inTx runs fn in a transaction, again (3 tries in all) when Postgres broke it off for a conflict with another one
// (SQLSTATE 40P01 a deadlock, 40001 a serialization failure: a quitter's report and a result spending one ticket at the
// same moment, RX31): the request's fault it isn't, and a second try goes through, where a 503 would wait on the game
// server's outbox
func (s *Store) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	var err error
	for range 3 {
		if err = pgx.BeginFunc(ctx, s.pool, fn); !conflicted(err) {
			return err
		}
	}
	return err
}

// inTxValue is inTx for a transaction with an answer: the last try's (RX32)
func inTxValue[T any](ctx context.Context, s *Store, fn func(pgx.Tx) (T, error)) (T, error) {
	var out T
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = fn(tx)
		return err
	})
	return out, err
}

// conflicted: a transaction Postgres broke off for another one's sake (a deadlock, a serialization failure)
func conflicted(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "40P01" || pgErr.Code == "40001")
}

// IsDataError: the database refused the data itself (SQLSTATE class 23: a check, unique, not-null or foreign key
// constraint), not a fault that may pass: the caller's request is wrong, and trying it again changes nothing (the game
// server's outbox drops a 400, where it retries a 503 for a day: RX31)
func IsDataError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && strings.HasPrefix(pgErr.Code, "23")
}

// RecordResult records a result once, in one transaction: false if its match is recorded already (a retry: nothing
// changes). Its tickets spent on its match (ErrTicketUsed: one spent on another); the players' accounts that still
// exist and their ratings in the playlist locked, `rate` given them (an account without one: absent) to return each
// one's new rating; written, with the players' rows (a deleted account's: a placeholder, not rated)
func (s *Store) RecordResult(ctx context.Context, r Result, rate func(current map[string]*Rating) map[string]Rating, now time.Time) (bool, error) {
	// (each try's own answer: one broken off by a conflict leaves none behind, RX32)
	return inTxValue(ctx, s, func(tx pgx.Tx) (bool, error) {
		tag, err := tx.Exec(ctx, `INSERT INTO ranked_results (match_id, server, playlist, winning_team, received_at)
			VALUES ($1, $2, $3, $4, $5) ON CONFLICT (match_id) DO NOTHING`, r.Match, r.Server, r.Playlist, r.WinningTeam, now)
		if err != nil || tag.RowsAffected() == 0 {
			return false, err
		}
		accounts := make([]string, len(r.Players))
		for i, p := range r.Players {
			accounts[i] = p.Account
			if err := spendTicket(ctx, tx, SpentTicket{Nonce: p.Nonce, IssuedAt: p.IssuedAt, Match: r.Match}, now); err != nil {
				return false, err
			}
		}
		rows, err := tx.Query(ctx, `SELECT id::text FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, accounts)
		if err != nil {
			return false, err
		}
		existing, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return false, err
		}
		current := map[string]*Rating{}
		for _, a := range existing {
			current[a] = nil
		}
		held, err := ratingsByAccount(ctx, tx, existing, r.Playlist)
		if err != nil {
			return false, err
		}
		for a, rt := range held {
			current[a] = &rt
		}
		next := rate(current)
		for _, p := range r.Players {
			before, after := 0.0, 0.0
			var account *string
			if n, ok := next[p.Account]; ok {
				account = &p.Account
				if c := current[p.Account]; c != nil {
					before = c.Rating
				}
				after = n.Rating
				if _, err := tx.Exec(ctx, `INSERT INTO ratings (account_id, playlist, rating, deviation, volatility, games,
					last_played) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (account_id, playlist) DO UPDATE SET
					rating = excluded.rating, deviation = excluded.deviation, volatility = excluded.volatility,
					games = excluded.games, last_played = excluded.last_played`,
					p.Account, r.Playlist, n.Rating, n.Deviation, n.Volatility, n.Games, n.LastPlayed); err != nil {
					return false, err
				}
			}
			if _, err := tx.Exec(ctx, `INSERT INTO ranked_result_players (match_id, account_id, team, quitter, seconds, nonce,
				rating_before, rating_after) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				r.Match, account, p.Team, p.Quitter, p.Seconds, p.Nonce[:], before, after); err != nil {
				return false, err
			}
		}
		return true, nil
	})
}

func ratingsByAccount(ctx context.Context, tx pgx.Tx, accounts []string, playlist int) (map[string]Rating, error) {
	rows, err := tx.Query(ctx, `SELECT account_id::text, rating, deviation, volatility, games, last_played FROM ratings
		WHERE account_id = ANY($1::uuid[]) AND playlist = $2 ORDER BY account_id FOR UPDATE`, accounts, playlist)
	if err != nil {
		return nil, err
	}
	out := map[string]Rating{}
	var a string
	var r Rating
	_, err = pgx.ForEachRow(rows, []any{&a, &r.Rating, &r.Deviation, &r.Volatility, &r.Games, &r.LastPlayed}, func() error {
		out[a] = r
		return nil
	})
	return out, err
}

// PurgeRanked removes the results received before resultsBefore (their year over) and the used tickets issued before
// ticketsBefore (past the acceptance window: a ticket that old is refused anyway, AC-22)
func (s *Store) PurgeRanked(ctx context.Context, resultsBefore, ticketsBefore time.Time) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM ranked_results WHERE received_at < $1`, resultsBefore); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM used_tickets WHERE issued_at < $1`, ticketsBefore)
	return err
}
