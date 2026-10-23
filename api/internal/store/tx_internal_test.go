package store

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"carball/api/internal/testdb"
)

// A transaction Postgres broke off for another one's sake is tried again; any other error isn't (RX31)
func TestConflictedIsADeadlockOrASerializationFailure(t *testing.T) {
	for code, want := range map[string]bool{"40P01": true, "40001": true, "23505": false, "23514": false, "57014": false} {
		err := fmt.Errorf("recording: %w", &pgconn.PgError{Code: code})
		if got := conflicted(err); got != want {
			t.Errorf("%s: %v, want %v", code, got, want)
		}
	}
	if conflicted(nil) || conflicted(errors.New("connection reset")) {
		t.Error("not conflicts")
	}
}

// A conflict's try is run again, 3 tries at most, an answer the last try's; another error ends it at once (RX32)
func TestInTxTriesAConflictAgainThreeTimesAtMost(t *testing.T) {
	owner, _ := testdb.New(t)
	ctx := context.Background()
	s, err := Open(ctx, owner, "")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	tries := 0
	answer, err := inTxValue(ctx, s, func(pgx.Tx) (int, error) {
		tries++
		if tries == 1 {
			return 1, &pgconn.PgError{Code: "40P01"}
		}
		return 2, nil
	})
	if err != nil || tries != 2 || answer != 2 {
		t.Errorf("a deadlock, then through: %d tries, answer %d, %v", tries, answer, err)
	}
	tries = 0
	err = s.inTx(ctx, func(pgx.Tx) error { tries++; return &pgconn.PgError{Code: "40001"} })
	if !conflicted(err) || tries != 3 {
		t.Errorf("conflicts every time: %d tries, %v", tries, err)
	}
	tries = 0
	err = s.inTx(ctx, func(pgx.Tx) error { tries++; return &pgconn.PgError{Code: "23514"} })
	if !IsDataError(err) || tries != 1 {
		t.Errorf("a data error: %d tries, %v", tries, err)
	}
}

// The admin's connections (RX35): named, a statement 15 s and a lock 2 s at most; read-only for the reports, a write
// refused by the server itself (25006)
func TestAdminConnections(t *testing.T) {
	owner, app := testdb.New(t)
	ctx := context.Background()
	if err := Migrate(ctx, owner, "", testdb.AppRole, false); err != nil {
		t.Fatal(err)
	}
	show := func(s *Store, setting string) string {
		t.Helper()
		var v string
		if err := s.pool.QueryRow(ctx, "SHOW "+setting).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	ro, err := OpenAdmin(ctx, app, "", true)
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	for setting, want := range map[string]string{"default_transaction_read_only": "on", "statement_timeout": "15s", "lock_timeout": "2s",
		"application_name": "carball-admin", "idle_in_transaction_session_timeout": "5s"} {
		if got := show(ro, setting); got != want {
			t.Errorf("read-only %s = %q, want %q", setting, got, want)
		}
	}
	_, err = ro.BanAccount(ctx, "00000000-0000-4000-8000-000000000009", "x", "admin", Permanent{}, false, time.Now())
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "25006" {
		t.Errorf("a write on the read-only connection: %v, want 25006", err)
	}
	rw, err := OpenAdmin(ctx, app, "", false)
	if err != nil {
		t.Fatal(err)
	}
	defer rw.Close()
	if got := show(rw, "default_transaction_read_only"); got != "off" {
		t.Errorf("the ban's connection read-only: %q", got)
	}
	if got := show(rw, "lock_timeout"); got != "2s" {
		t.Errorf("the ban's connection's lock timeout: %q", got)
	}
	if got := show(rw, "idle_in_transaction_session_timeout"); got != "5s" {
		t.Errorf("the ban's connection's idle transaction limit: %q", got)
	}
}

// A ban on an identity with no account and that identity's sign-up take turns (RV-807, RV-808): behind another admin's
// uncommitted permanent ban (held as BanNoAccount holds it), a 2 h ban waits, then is refused, nothing written over
// it; with replace it waits, then replaces it and returns it; a sign-up waits, then is refused for the ban; and a ban
// with no account ends no one's sessions (RV-811)
func TestBanNoAccountTakesTurns(t *testing.T) {
	owner, app := testdb.New(t)
	ctx := context.Background()
	if err := Migrate(ctx, owner, "", testdb.AppRole, false); err != nil {
		t.Fatal(err)
	}
	s, err := Open(ctx, app, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close) // (after a held transaction's rollback: cleanups run last first)
	now := time.Now()
	i := Identity{Provider: Steam, Subject: "76561190000000007"}
	// another admin's ban in progress: the identity's lock held, its row written, not committed
	inProgress := func(sql string) pgx.Tx {
		t.Helper()
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		// (ended if the test stops before its commit, so the pool can close)
		t.Cleanup(func() { _ = tx.Rollback(ctx) })
		if err := lockIdentity(ctx, tx, i); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, sql, string(i.Provider), i.Subject, now); err != nil {
			t.Fatal(err)
		}
		return tx
	}
	waits := func(done <-chan struct{}, what string) {
		t.Helper()
		select {
		case <-done:
			t.Fatalf("%s didn't wait for the ban in progress", what)
		case <-time.After(300 * time.Millisecond):
		}
	}
	tx := inProgress(`INSERT INTO bans (provider, subject, reason, until, banned_by, created_at) VALUES ($1, $2, 'first', NULL, 'admin-a', $3)`)
	done := make(chan struct{})
	var second error
	go func() {
		_, second = s.BanNoAccount(ctx, i, "second", "admin-b", Until{At: now.Add(2 * time.Hour)}, false, now)
		close(done)
	}()
	waits(done, "a ban with no account")
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	<-done
	var held AlreadyBannedError
	if !errors.As(second, &held) || len(held.Bans) != 1 || held.Bans[0].Reason != "first" {
		t.Errorf("behind a permanent ban in progress: %v, want it refused naming that ban", second)
	}
	if b, _, _ := s.BanOn(ctx, i.Provider, i.Subject, now); b.Reason != "first" || b.End != (Permanent{}) {
		t.Errorf("the permanent ban written over: %+v", b)
	}
	// (with replace: it waits, then replaces the ban committed meanwhile, and returns it)
	tx = inProgress(`UPDATE bans SET reason = 'third' WHERE provider = $1 AND subject = $2 AND created_at <= $3`)
	done = make(chan struct{})
	var replaced Banned
	go func() {
		replaced, second = s.BanNoAccount(ctx, i, "fourth", "admin-b", Until{At: now.Add(2 * time.Hour)}, true, now)
		close(done)
	}()
	waits(done, "a replacing ban with no account")
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	<-done
	if second != nil || len(replaced.Replaced) != 1 || replaced.Replaced[0].Reason != "third" {
		t.Errorf("a replacing ban behind one in progress = %+v, %v; want the committed ban replaced and returned", replaced, second)
	}
	// (a sign-up of an identity whose ban is in progress: it waits, then is refused for it)
	j := Identity{Provider: Steam, Subject: "76561190000000008"}
	p := Pending{TokenHash: []byte("p-j"), Provider: j.Provider, Subject: j.Subject, Suggestion: "J", ExpiresAt: now.Add(time.Hour)}
	if err := s.CreatePending(ctx, p); err != nil {
		t.Fatal(err)
	}
	i = j
	tx = inProgress(`INSERT INTO bans (provider, subject, reason, until, banned_by, created_at) VALUES ($1, $2, 'throwaway', NULL, 'admin-a', $3)`)
	done = make(chan struct{})
	var signup error
	go func() {
		_, signup = s.CreateAccount(ctx, p, "J", []byte("h-j"), now, now.Add(-time.Hour))
		close(done)
	}()
	waits(done, "a sign-up")
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	<-done
	var banned BannedError
	if !errors.As(signup, &banned) || banned.Ban.Reason != "throwaway" {
		t.Errorf("a sign-up behind its ban in progress: %v, want refused for the ban", signup)
	}
	// (a ban with no account: an account's session elsewhere stays)
	k := Pending{TokenHash: []byte("p-k"), Provider: Google, Subject: "sub-k", Suggestion: "K", ExpiresAt: now.Add(time.Hour)}
	if err := s.CreatePending(ctx, k); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateAccount(ctx, k, "K", []byte("h-k"), now, now.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession(ctx, []byte("s-k"), id, now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.BanNoAccount(ctx, Identity{Provider: Google, Subject: "sub-nobody-k"}, "x", "admin", Permanent{}, false, now); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("s-k"), now); !found {
		t.Error("a ban with no account ended another account's session")
	}
}

// An admin's transaction left open and idle (a ban stopped mid-way, Ctrl-Z) holding an identity's lock is ended by the
// server within its 5 s, and the sign-up waiting on that lock goes through (RV-823)
func TestAdminIdleTransactionEnded(t *testing.T) {
	owner, app := testdb.New(t)
	ctx := context.Background()
	if err := Migrate(ctx, owner, "", testdb.AppRole, false); err != nil {
		t.Fatal(err)
	}
	s, err := Open(ctx, app, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	admin, err := OpenAdmin(ctx, app, "", false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	now := time.Now()
	p := Pending{TokenHash: []byte("p-idle"), Provider: Steam, Subject: "76561190000000009", Suggestion: "I", ExpiresAt: now.Add(time.Hour)}
	if err := s.CreatePending(ctx, p); err != nil {
		t.Fatal(err)
	}
	tx, err := admin.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	if err := lockIdentity(ctx, tx, Identity{Provider: p.Provider, Subject: p.Subject}); err != nil {
		t.Fatal(err)
	}
	// (then nothing: the admin's command stopped with its transaction open)
	start := time.Now()
	if _, err := s.CreateAccount(ctx, p, "I", []byte("h-idle"), now, now.Add(-time.Hour)); err != nil {
		t.Fatalf("the sign-up behind an idle admin transaction: %v", err)
	}
	if waited := time.Since(start); waited < 3*time.Second || waited > 10*time.Second {
		t.Errorf("the sign-up waited %v, want about the 5 s limit", waited)
	}
}
