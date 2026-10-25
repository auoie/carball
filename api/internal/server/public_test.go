package server_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"carball/api/internal/matchmaker"
	"carball/api/internal/server"
	"carball/api/internal/store"
)

// exec: a statement run as the database's owner (the tests' own rows)
func (e *env) exec(query string, args ...any) {
	e.t.Helper()
	conn, err := pgx.Connect(context.Background(), e.owner)
	if err != nil {
		e.t.Fatal(err)
	}
	defer func() { _ = conn.Close(context.Background()) }()
	if _, err := conn.Exec(context.Background(), query, args...); err != nil {
		e.t.Fatal(err)
	}
}

type statsReply struct {
	Playlists []struct{ Playlist, Matches, Players, Searching int } `json:"playlists"`
	Servers   map[string]struct{ Matches, Players int }             `json:"servers"`
	Playing   int                                                   `json:"playing"`
	Matches   int                                                   `json:"matches"`
}

func (e *env) stats(b *http.Client) statsReply {
	e.t.Helper()
	r := e.get(b, "/api/stats")
	var out statsReply
	if r.StatusCode != http.StatusOK || json.Unmarshal(r.Body, &out) != nil {
		e.t.Fatalf("GET /api/stats: %d %s", r.StatusCode, r.Body)
	}
	return out
}

// GET /api/stats: no sign-in; each playlist's counts and the totals from the matchmaker, the count kept StatsKept (a
// search started meanwhile counted after)
func TestPublicStats(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	empty := e.stats(b)
	if len(empty.Playlists) != 3 || empty.Playing != 0 || empty.Matches != 0 || len(empty.Servers) != 0 {
		t.Fatalf("no one playing: %+v", empty)
	}
	for i, p := range empty.Playlists {
		if p.Playlist != i+1 || p.Matches != 0 || p.Players != 0 || p.Searching != 0 {
			t.Fatalf("playlist %d: %+v", i+1, p)
		}
	}
	mm := e.s.Matchmaker
	search := func() {
		id, _, err := mm.Start(matchmaker.Player{Account: "acc-1", Name: "One"},
			matchmaker.Request{Playlists: []byte{2, 3}, Pings: map[string]int{"game.example:4433": 20}, Ticked: []string{"game.example:4433"}}, e.clock.Now())
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := mm.Poll(context.Background(), id, "acc-1", 0, 0); !ok {
			t.Fatal("the search unknown")
		}
	}
	search()
	if kept := e.stats(b); !reflect.DeepEqual(kept, empty) {
		t.Fatalf("within StatsKept the count kept: %+v", kept)
	}
	e.clock.Add(server.StatsKept)
	search() // (its page polling: a search it'd match)
	got := e.stats(b)
	if got.Playing != 1 || got.Playlists[0].Searching != 0 || got.Playlists[1].Searching != 1 || got.Playlists[2].Searching != 1 {
		t.Fatalf("one searching 2v2 and 3v3: %+v", got)
	}
	if r := e.get(b, "/api/stats"); r.Header.Get("Cache-Control") == "" || r.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("headers %v", r.Header)
	}
}

type boardReply struct {
	Playlist string `json:"playlist"`
	Players  []struct {
		Rank   int    `json:"rank"`
		Name   string `json:"name"`
		Rating int    `json:"rating"`
		Games  int    `json:"games"`
	} `json:"players"`
}

func (e *env) board(b *http.Client, playlist string) boardReply {
	e.t.Helper()
	r := e.get(b, "/api/leaderboard?playlist="+playlist)
	var out boardReply
	if r.StatusCode != http.StatusOK || json.Unmarshal(r.Body, &out) != nil {
		e.t.Fatalf("GET /api/leaderboard?playlist=%s: %d %s", playlist, r.StatusCode, r.Body)
	}
	return out
}

// GET /api/leaderboard: no sign-in; a playlist's ratings by the rating as shown, the provisional left out, rank, name,
// rating and games (no account id); read again after BoardKept; a playlist it doesn't know refused
func TestPublicLeaderboard(t *testing.T) {
	e := setup(t, nil)
	_, ann, _ := e.player("ann")
	_, bob, _ := e.player("bob")
	_, cat, _ := e.player("cat")
	now := e.clock.Now()
	e.exec(`INSERT INTO ratings (account_id, playlist, rating, deviation, volatility, games, last_played) VALUES
		($1, 1, 1700, 60, 0.06, 30, $4), ($2, 1, 1900, 300, 0.06, 2, $4), ($3, 1, 1650.4, 60, 0.06, 10, $4),
		($3, 2, 1550, 70, 0.06, 8, $4)`, ann, bob, cat, now)
	b := e.browser()
	one := e.board(b, "1v1")
	if one.Playlist != "1v1" || len(one.Players) != 2 {
		t.Fatalf("1v1: %+v", one)
	}
	if p := one.Players[0]; p.Rank != 1 || p.Name != "P_ann" || p.Rating != 1700 || p.Games != 30 {
		t.Fatalf("first: %+v", p)
	}
	if p := one.Players[1]; p.Rank != 2 || p.Name != "P_cat" || p.Rating != 1650 || p.Games != 10 {
		t.Fatalf("second: %+v", p)
	}
	if body := string(e.get(b, "/api/leaderboard?playlist=1v1").Body); strings.Contains(body, ann) || strings.Contains(body, bob) || strings.Contains(body, cat) {
		t.Fatalf("an account id in the board: %s", body)
	}
	if two := e.board(b, "2v2"); len(two.Players) != 1 || two.Players[0].Name != "P_cat" {
		t.Fatalf("2v2: %+v", two)
	}
	if three := e.board(b, "3v3"); len(three.Players) != 0 {
		t.Fatalf("3v3: %+v", three)
	}
	// (a rating changed: the board kept till BoardKept, then read again)
	e.exec(`UPDATE ratings SET rating = 1800 WHERE account_id = $1 AND playlist = 1`, cat)
	if kept := e.board(b, "1v1"); kept.Players[0].Name != "P_ann" {
		t.Fatalf("within BoardKept: %+v", kept)
	}
	e.clock.Add(server.BoardKept)
	if again := e.board(b, "1v1"); again.Players[0].Name != "P_cat" || again.Players[0].Rating != 1800 {
		t.Fatalf("after BoardKept: %+v", again)
	}
	// (a ban in force on an account's sign-in: off the board at its next read; one that ended, on it: RV-1155)
	e.exec(`INSERT INTO bans (provider, subject, reason, until, banned_by, created_at)
		SELECT provider, subject, 'made up', NULL, 'test', $2 FROM identities WHERE account_id = $1`, cat, now)
	e.exec(`INSERT INTO bans (provider, subject, reason, until, banned_by, created_at)
		SELECT provider, subject, 'made up', $2::timestamptz, 'test', $2 FROM identities WHERE account_id = $1`, ann, now)
	e.clock.Add(server.BoardKept)
	if banned := e.board(b, "1v1"); len(banned.Players) != 1 || banned.Players[0].Name != "P_ann" {
		t.Fatalf("with cat banned: %+v", banned)
	}
	if two := e.board(b, "2v2"); len(two.Players) != 0 {
		t.Fatalf("2v2 with cat banned: %+v", two)
	}
	for _, q := range []string{"", "?playlist=4v4", "?playlist=1"} {
		if r := e.get(b, "/api/leaderboard"+q); r.StatusCode != http.StatusBadRequest {
			t.Fatalf("GET /api/leaderboard%s: %d", q, r.StatusCode)
		}
	}
}

// A successful public read writes no access line (every open menu polls the counts: they'd take the log's ceiling from
// every other request's, RV-1159); a refused one still does
func TestPublicReadsQuietInTheLog(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.stats(b)
	e.board(b, "1v1")
	if logs := e.logs.String(); strings.Contains(logs, `route="GET /api/stats"`) || strings.Contains(logs, `route="GET /api/leaderboard"`) {
		t.Fatalf("a public read's line:\n%s", logs)
	}
	if r := e.get(b, "/api/leaderboard?playlist=9v9"); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("9v9: %d", r.StatusCode)
	}
	if logs := e.logs.String(); !strings.Contains(logs, `route="GET /api/leaderboard" status=400`) {
		t.Fatalf("a refused read's line missing:\n%s", logs)
	}
}

// blockingStore: the board's read held until `release` (or its own context's end), each call counted; `fail` its error
type blockingStore struct {
	server.Store
	calls   *atomic.Int32
	release chan struct{}
	fail    error
}

func (s blockingStore) BoardRatings(ctx context.Context, _ int, _ *store.Rated, _ int, _ time.Time) ([]store.Rated, error) {
	s.calls.Add(1)
	select {
	case <-s.release:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return nil, s.fail
}

// The leaderboard's read is one for everyone asking meanwhile (one database call), each request waiting only as long as
// it lasts itself (one cancelled returns at once, the read going on for the others); a failed read is kept a few seconds
// (the database not asked again by each request), then tried again (RV-1158)
func TestPublicBoardOneReadEachWaitsAlone(t *testing.T) {
	e := setup(t, nil)
	calls := &atomic.Int32{}
	release := make(chan struct{})
	e.s.Store = blockingStore{Store: e.db, calls: calls, release: release}
	h := e.s.Handler()
	ask := func(ctx context.Context) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/leaderboard?playlist=1v1", nil))
		return w
	}
	var waiting sync.WaitGroup
	answers := make(chan int, 4)
	for range 4 {
		waiting.Go(func() { answers <- ask(context.Background()).Code })
	}
	// (one more, given up while the read goes on: back at once)
	gone, cancel := context.WithCancel(context.Background())
	back := make(chan struct{})
	go func() {
		ask(gone)
		close(back)
	}()
	for calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case <-back:
	case <-time.After(2 * time.Second):
		t.Fatal("a cancelled request still waiting for the read")
	}
	close(release)
	waiting.Wait()
	close(answers)
	for code := range answers {
		if code != http.StatusOK {
			t.Fatalf("a waiter's answer: %d", code)
		}
	}
	if n := calls.Load(); n != 1 {
		t.Fatalf("%d database reads for 5 requests", n)
	}

	// (a failing read: kept errorKept, then read again)
	failCalls := &atomic.Int32{}
	open := make(chan struct{})
	close(open)
	e.s.Store = blockingStore{Store: e.db, calls: failCalls, release: open, fail: errors.New("the database is down")}
	h = e.s.Handler()
	e.clock.Add(server.BoardKept)
	for range 3 {
		if code := ask(context.Background()).Code; code != http.StatusServiceUnavailable {
			t.Fatalf("a failed read: %d", code)
		}
	}
	if n := failCalls.Load(); n != 1 {
		t.Fatalf("%d reads while the failure is kept", n)
	}
	e.clock.Add(5 * time.Second)
	ask(context.Background())
	if n := failCalls.Load(); n != 2 {
		t.Fatalf("%d reads after the failure's keep", n)
	}
}

// panickingStore: the 1v1 board's read panics (a bug's stand-in); the others read as the database has them
type panickingStore struct{ server.Store }

func (s panickingStore) BoardRatings(ctx context.Context, playlist int, after *store.Rated, n int, now time.Time) ([]store.Rated, error) {
	if playlist == 1 {
		time.Sleep(50 * time.Millisecond) // (both requests waiting on the one read: singleflight's re-raise path)
		panic("a bug in the board's read")
	}
	return s.Store.BoardRatings(ctx, playlist, after, n, now)
}

// A panic in a public read is that read's failure (503, logged once with its stack), never the service's: singleflight
// would re-raise it in a goroutine of its own, where nothing recovers it (RV-1163)
func TestPublicReadPanicIsAFailure(t *testing.T) {
	e := setup(t, nil)
	e.s.Store = panickingStore{Store: e.db}
	h := e.s.Handler()
	ask := func(playlist string) int {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/leaderboard?playlist="+playlist, nil))
		return w.Code
	}
	var both sync.WaitGroup
	codes := make(chan int, 2)
	for range 2 {
		both.Go(func() { codes <- ask("1v1") })
	}
	both.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusServiceUnavailable {
			t.Fatalf("a panicking read: %d", code)
		}
	}
	if code := ask("2v2"); code != http.StatusOK {
		t.Fatalf("the service after a panic: %d", code)
	}
	logs := e.logs.String()
	if n := strings.Count(logs, `msg="a public read failed"`); n != 1 || !strings.Contains(logs, "a bug in the board's read") || !strings.Contains(logs, "goroutine") {
		t.Fatalf("the panic's log (%d lines):\n%s", n, logs)
	}
}
