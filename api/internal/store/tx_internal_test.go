package store

import (
	"context"
	"errors"
	"fmt"
	"testing"

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
