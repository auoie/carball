package store

import (
	"context"
	"io/fs"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"carball/api/internal/testdb"
)

// The leaderboard's read: its query planned on its partial index (ratings_board), the first page and a later one's, with
// enough rows that the planner chooses (made-up accounts, ANALYZEd); paged through, every settled rating of the playlist in
// its order (the rating, highest first, then the account id: ties across pages), the provisional as stored and the
// banned left out (a ban past its end not)
func TestBoardRatingsUsesItsIndex(t *testing.T) {
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
	conn, err := pgx.Connect(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	for _, q := range []string{
		// (4000 accounts: their ratings 1000-1999, about four to a value; one in four provisional as stored)
		`INSERT INTO accounts (id, created_at, name) SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, $1, 'P' || g
			FROM generate_series(1, 4000) g`,
		`INSERT INTO ratings (account_id, playlist, rating, deviation, volatility, games, last_played)
			SELECT id, 1, 1000 + (substr(id::text, 25)::int * 7919) % 1000, CASE WHEN substr(id::text, 25)::int % 4 = 0 THEN 300 ELSE 60 END,
			0.06, 10, $1 FROM accounts`,
		// (account 1 banned now, account 2 banned once (ended): each by its Google sign-in)
		`INSERT INTO identities (provider, subject, account_id, linked_at) VALUES
			('google', 'sub-1', '00000000-0000-4000-8000-000000000001', $1), ('google', 'sub-2', '00000000-0000-4000-8000-000000000002', $1)`,
		`INSERT INTO bans (provider, subject, reason, until, banned_by, created_at) VALUES
			('google', 'sub-1', 'made up', NULL, 'test', $1), ('google', 'sub-2', 'made up', $1::timestamptz - interval '1 day', 'test', $1)`,
		`ANALYZE`,
	} {
		args := []any{now}
		if q == `ANALYZE` {
			args = nil
		}
		if _, err := conn.Exec(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q[:40], err)
		}
	}

	plan := func(sql string, args ...any) string {
		rows, err := conn.Query(ctx, "EXPLAIN "+sql, args...)
		if err != nil {
			t.Fatal(err)
		}
		lines, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return strings.Join(lines, "\n")
	}
	first := plan(boardHead+boardTail, 1, now, 128)
	later := plan(boardHead+boardAfter+boardTail, 1, now, 128, 1500.0, "00000000-0000-4000-8000-000000002000")
	t.Logf("the first page's plan:\n%s\na later page's plan:\n%s", first, later)
	for name, p := range map[string]string{"first page": first, "later page": later} {
		if !strings.Contains(p, "ratings_board") || strings.Contains(p, "Seq Scan on ratings") {
			t.Errorf("the %s isn't read through ratings_board:\n%s", name, p)
		}
	}

	// (paged through 300 at a time: the settled, not the banned, in order)
	var all []Rated
	var after *Rated
	for {
		page, err := s.BoardRatings(ctx, 1, after, 300, now)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, page...)
		if len(page) < 300 {
			break
		}
		after = &all[len(all)-1]
	}
	if want := 4000 - 1000 - 1; len(all) != want {
		t.Fatalf("%d read, want %d (the settled, one banned)", len(all), want)
	}
	seen := map[string]bool{}
	for i, r := range all {
		if r.Rating.Deviation >= BoardDeviation || r.Account == "00000000-0000-4000-8000-000000000001" || seen[r.Account] {
			t.Fatalf("row %d: %+v", i, r)
		}
		seen[r.Account] = true
		if i > 0 {
			p := all[i-1]
			if p.Rating.Rating < r.Rating.Rating || (p.Rating.Rating == r.Rating.Rating && p.Account >= r.Account) {
				t.Fatalf("rows %d, %d out of order: %+v, %+v", i-1, i, p, r)
			}
		}
	}
	if !seen["00000000-0000-4000-8000-000000000002"] {
		t.Fatal("the account whose ban ended left out")
	}
}

// The sweep's statements (purges) and the admin's reads planned on their indexes (00003_indexes.sql), with enough rows
// that the planner chooses: a few rows past their time among many that aren't (the usual state between sweeps)
func TestPurgesAndAdminReadsUseTheirIndexes(t *testing.T) {
	owner, _ := testdb.New(t)
	ctx := context.Background()
	if err := Migrate(ctx, owner, "", testdb.AppRole, false); err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.Connect(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	// (5000 of each, made up: every 500th past its time, the rest days ahead; the accounts made over a year, one in ten
	// with a queue ban, most ended; bans mostly ended)
	for _, q := range []string{
		`INSERT INTO accounts (id, created_at, name) SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
			$1::timestamptz - g * interval '105 minutes', 'P' || g FROM generate_series(1, 5000) g`,
		`INSERT INTO sessions (token_hash, account_id, created_at, rotated_at, expires_at, previous_hash, previous_until)
			SELECT sha256(g::text::bytea), (SELECT id FROM accounts LIMIT 1), $1, $1,
			$1::timestamptz + CASE WHEN g % 500 = 0 THEN interval '-1 hour' ELSE interval '30 days' END,
			CASE WHEN g % 100 = 0 THEN sha256(('p' || g)::bytea) END, CASE WHEN g % 100 = 0 THEN $1::timestamptz - interval '1 minute' END
			FROM generate_series(1, 5000) g`,
		`INSERT INTO auth_flows (id_hash, provider, state, nonce, verifier, expires_at) SELECT sha256(g::text::bytea), 'google',
			's', 'n', 'v', $1::timestamptz + CASE WHEN g % 500 = 0 THEN interval '-1 hour' ELSE interval '1 day' END FROM generate_series(1, 5000) g`,
		`INSERT INTO pending_signups (token_hash, provider, subject, suggestion, expires_at) SELECT sha256(g::text::bytea), 'google',
			'sub-' || g, 'P', $1::timestamptz + CASE WHEN g % 500 = 0 THEN interval '-1 hour' ELSE interval '1 day' END FROM generate_series(1, 5000) g`,
		`INSERT INTO steam_nonces (nonce, expires_at) SELECT 'n' || g,
			$1::timestamptz + CASE WHEN g % 500 = 0 THEN interval '-1 hour' ELSE interval '1 day' END FROM generate_series(1, 5000) g`,
		`INSERT INTO deletions (subject_hmac, deleted_at) SELECT sha256(g::text::bytea), $1::timestamptz - (g % 30) * interval '1 day' + interval '1 hour'
			- CASE WHEN g % 500 = 0 THEN interval '40 days' ELSE interval '0' END FROM generate_series(1, 5000) g`,
		`INSERT INTO queue_bans (account_id, step, until, last_leave, match_id, previous_step) SELECT id, 1,
			created_at + CASE WHEN substr(id::text, 25)::int % 500 = 0 THEN interval '1 year' ELSE interval '1 hour' END, created_at, 'm', 0 FROM accounts`,
		`INSERT INTO bans (provider, subject, reason, until, banned_by, created_at) SELECT 'steam', 'sub-' || g, 'made up',
			CASE WHEN g % 500 = 0 THEN NULL ELSE $1::timestamptz - interval '1 day' END, 'test', $1 FROM generate_series(1, 5000) g`,
		`ANALYZE`,
	} {
		args := []any{now}
		if !strings.Contains(q, "$1") {
			args = nil
		}
		if _, err := conn.Exec(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q[:50], err)
		}
	}
	plan := func(sql string, args ...any) string {
		rows, err := conn.Query(ctx, "EXPLAIN "+sql, args...)
		if err != nil {
			t.Fatal(err)
		}
		lines, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return strings.Join(lines, "\n")
	}
	indexes := []string{"sessions_expires", "sessions_previous_until", "auth_flows_expires", "pending_signups_expires", "steam_nonces_expires", "deletions_deleted"}
	for i, q := range purges {
		at := now
		if q.deletions {
			at = now.Add(-30 * 24 * time.Hour)
		}
		p := plan(q.sql, at)
		t.Logf("%s\n%s", q.sql, p)
		if !strings.Contains(p, indexes[i]) {
			t.Errorf("%s: not on %s:\n%s", q.sql, indexes[i], p)
		}
	}
	for _, c := range []struct {
		name, sql, index string
		args             []any
	}{
		{"new accounts (stats)", `SELECT count(*) FROM accounts WHERE created_at >= $1`, "accounts_created", []any{now.Add(-7 * 24 * time.Hour)}},
		{"queue bans in force (stats)", `SELECT count(*) FROM queue_bans WHERE until > $1`, "queue_bans_until", []any{now}},
		{"queue bans in force (queue-bans)", `SELECT q.account_id::text, a.name, q.step, q.until, q.last_leave FROM queue_bans q
			JOIN accounts a ON a.id = q.account_id WHERE q.until > $1 ORDER BY q.until DESC`, "queue_bans_until", []any{now}},
		{"bans in force (stats)", `SELECT count(*) FROM bans WHERE until IS NULL OR until > $1`, "bans_until", []any{now}},
		{"bans in force (bans)", `SELECT provider, subject, reason, until, banned_by, created_at FROM bans
			WHERE until IS NULL OR until > $1 ORDER BY created_at DESC`, "bans_until", []any{now}},
		{"open sign-ins (count)", `SELECT count(*) FROM auth_flows WHERE expires_at > $1`, "", []any{now}},
	} {
		p := plan(c.sql, c.args...)
		t.Logf("%s\n%s", c.name, p)
		if c.index != "" && !strings.Contains(p, c.index) {
			t.Errorf("%s: not on %s:\n%s", c.name, c.index, p)
		}
	}
}

// The provisional line is in three places (BoardDeviation, which ranked's test ties to ranked.Provisional; the board's
// SQL; the index's predicate in 00003_indexes.sql): the SQL and the migration each say it, so changing the constant
// alone fails here, never a board that silently drops the settled between the old line and the new (RV-1164)
func TestBoardLineInItsSQLAndIndex(t *testing.T) {
	line := "deviation < " + strconv.FormatFloat(BoardDeviation, 'f', -1, 64)
	if !strings.Contains(boardHead, "r."+line) {
		t.Errorf("the board's query doesn't say %q:\n%s", line, boardHead)
	}
	migration, err := fs.ReadFile(migrations, "migrations/00003_indexes.sql")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(migration), "ON ratings (playlist, rating DESC, account_id) WHERE "+line+";") {
		t.Errorf("ratings_board's predicate isn't %q", line)
	}
}
