package store

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
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
