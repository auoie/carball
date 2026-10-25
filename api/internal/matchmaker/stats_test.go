package matchmaker

import (
	"reflect"
	"testing"
	"time"
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
