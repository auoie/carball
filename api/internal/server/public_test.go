package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"carball/api/internal/matchmaker"
	"carball/api/internal/server"
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
	if p := one.Players[0]; p.Rank != 1 || p.Name != "P ann" || p.Rating != 1700 || p.Games != 30 {
		t.Fatalf("first: %+v", p)
	}
	if p := one.Players[1]; p.Rank != 2 || p.Name != "P cat" || p.Rating != 1650 || p.Games != 10 {
		t.Fatalf("second: %+v", p)
	}
	if body := string(e.get(b, "/api/leaderboard?playlist=1v1").Body); strings.Contains(body, ann) || strings.Contains(body, bob) || strings.Contains(body, cat) {
		t.Fatalf("an account id in the board: %s", body)
	}
	if two := e.board(b, "2v2"); len(two.Players) != 1 || two.Players[0].Name != "P cat" {
		t.Fatalf("2v2: %+v", two)
	}
	if three := e.board(b, "3v3"); len(three.Players) != 0 {
		t.Fatalf("3v3: %+v", three)
	}
	// (a rating changed: the board kept till BoardKept, then read again)
	e.exec(`UPDATE ratings SET rating = 1800 WHERE account_id = $1 AND playlist = 1`, cat)
	if kept := e.board(b, "1v1"); kept.Players[0].Name != "P ann" {
		t.Fatalf("within BoardKept: %+v", kept)
	}
	e.clock.Add(server.BoardKept)
	if again := e.board(b, "1v1"); again.Players[0].Name != "P cat" || again.Players[0].Rating != 1800 {
		t.Fatalf("after BoardKept: %+v", again)
	}
	for _, q := range []string{"", "?playlist=4v4", "?playlist=1"} {
		if r := e.get(b, "/api/leaderboard"+q); r.StatusCode != http.StatusBadRequest {
			t.Fatalf("GET /api/leaderboard%s: %d", q, r.StatusCode)
		}
	}
}
