package matchmaker

import (
	"bytes"
	"errors"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"carball/api/internal/ticket"
)

// The public counts from the matchmaker's state: a match counted by its playlist (its seats over two) and its server, its
// players those it holds before its start (one who searched again since is searching) and those present after it (a
// leaver out); a search counted in each playlist it ticked, once in the players playing; a search no page polls now not
// counted
func TestStatsCounts(t *testing.T) {
	h := newHarness()
	// (a search whose page stopped polling: neither matched nor counted)
	h.search(t, player("z", 1500), []byte{3}, near)
	h.now = h.now.Add(PollGap + time.Second)
	for _, a := range []string{"a", "b"} {
		h.search(t, player(a, 1500), []byte{1}, near)
	}
	for _, a := range []string{"d", "e", "f", "g"} {
		h.search(t, player(a, 1500), []byte{2}, near)
	}
	h.m.Tick(h.now)
	one, two := h.found(t, "a"), h.found(t, "d")
	if one == nil || two == nil || one.Playlist != 1 || two.Playlist != 2 {
		t.Fatalf("the matches: %+v, %+v", one, two)
	}
	// (the 1v1 started, a seat left; the 2v2 not started, one of its players searching again, with a player of both)
	h.m.Started("eu:4433", one.ID, h.now)
	h.m.Left("eu:4433", one.ID, 0)
	h.search(t, player("g", 1500), []byte{2}, near)
	h.search(t, player("c", 1500), []byte{1, 2}, near)

	got := h.m.Stats(h.now)
	want := Stats{
		Playlists: [3]PlaylistStats{{Matches: 1, Players: 1, Searching: 1}, {Matches: 1, Players: 3, Searching: 2}, {}},
		Servers:   map[string]ServerStats{"eu:4433": {Matches: 2, Players: 4}},
		Playing:   6,
		Matches:   2,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("the stats: %+v, want %+v", got, want)
	}

	// (the 2v2's start word never came: let go after StartWait, its players no longer counted)
	h.now = h.now.Add(StartWait)
	if got := h.m.Stats(h.now); got.Matches != 1 || got.Playlists[1].Matches != 0 {
		t.Fatalf("after the 2v2 was let go: %+v", got)
	}
}

// An empty matchmaker counts nothing
func TestStatsEmpty(t *testing.T) {
	h := newHarness()
	if got := h.m.Stats(h.now); !reflect.DeepEqual(got, Stats{Servers: map[string]ServerStats{}}) {
		t.Fatalf("empty: %+v", got)
	}
}

// A player who searched again between a match's assignment and its start (another tab: allowed before the start) is
// out of it at the start and counted once, as searching (RV-1156, RX67's probe)
func TestStatsSearchedAgainBeforeStart(t *testing.T) {
	h := newHarness()
	for _, a := range []string{"a", "b"} {
		h.search(t, player(a, 1500), []byte{1}, near)
	}
	h.m.Tick(h.now)
	one := h.found(t, "a")
	if one == nil {
		t.Fatal("no match")
	}
	h.search(t, player("b", 1500), []byte{2}, near)
	for _, when := range []string{"before the start", "after it"} {
		got := h.m.Stats(h.now)
		if got.Playing != 2 || got.Playlists[0].Players != 1 || got.Playlists[1].Searching != 1 || got.Servers["eu:4433"].Players != 1 {
			t.Fatalf("%s: %+v", when, got)
		}
		h.m.Started("eu:4433", one.ID, h.now)
	}
}

// With a list of game servers (GAME_SERVERS), a server name a page made up (any host:port it ticks and says it pinged)
// is dropped before matching: a search naming none of the list accepts none (no-server), one naming both is matched only
// at a listed one, so the stats only ever count listed servers (RV-1157). The names compared without case
func TestStartOnlyListedServers(t *testing.T) {
	h := newHarness()
	h.m.AllowServers([]string{"eu:4433"})
	made := map[string]int{"any-text-here.example:1": 1}
	if _, _, err := h.m.Start(player("x", 1500), req([]byte{1}, made), h.now); !errors.Is(err, ErrNoServer) {
		t.Fatalf("a search of made-up servers alone: %v", err)
	}
	both := map[string]int{"any-text-here.example:1": 1, "EU:4433": 40}
	for _, a := range []string{"x", "y"} {
		h.search(t, player(a, 1500), []byte{1}, both)
	}
	h.m.Tick(h.now)
	found := h.found(t, "x")
	if found == nil || found.Server != "EU:4433" {
		t.Fatalf("matched at %+v, want the listed server", found)
	}
	got := h.m.Stats(h.now)
	if _, listed := got.Servers["EU:4433"]; !listed || len(got.Servers) != 1 {
		t.Fatalf("the stats' servers: %v", got.Servers)
	}
	// (no list: every server, as in development)
	h.m.AllowServers(nil)
	if _, _, err := h.m.Start(player("z", 1500), req([]byte{1}, made), h.now); err != nil {
		t.Fatalf("no list: %v", err)
	}
}

// A game server whose own name isn't on the list (its PUBLIC_HOST:port and GAME_SERVERS' URL apart) is warned of once,
// at its restart word: otherwise it would only be dropped from every search, silently (RV-1162)
func TestUnlistedServerWarnedOnce(t *testing.T) {
	var logs bytes.Buffer
	m := New(func(Player, ticket.Seat, time.Time) (string, error) { return "", nil }, func() time.Time { return t0 },
		slog.New(slog.NewTextHandler(&logs, nil)))
	m.AllowServers([]string{"eu:4433"})
	for range 2 {
		m.Restarted("eu-alias:4433", t0)
		m.Restarted("EU:4433", t0)
	}
	if n := strings.Count(logs.String(), "level=WARN"); n != 1 || !strings.Contains(logs.String(), "server=eu-alias:4433") {
		t.Fatalf("%d warnings:\n%s", n, logs.String())
	}
	// (no list, development: no warning)
	logs.Reset()
	m.AllowServers(nil)
	m.Restarted("anything:1", t0)
	if logs.Len() != 0 {
		t.Fatalf("development warned:\n%s", logs.String())
	}
}
