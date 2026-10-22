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
	for setting, want := range map[string]string{"default_transaction_read_only": "on", "statement_timeout": "15s", "lock_timeout": "2s", "application_name": "carball-admin"} {
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
}
