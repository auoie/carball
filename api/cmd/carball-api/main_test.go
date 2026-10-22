package main

import (
	"testing"
	"time"

	"carball/api/internal/server"
)

func TestBanEnd(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		length time.Duration
		date   string
		want   string
	}{
		{0, "", "no end"},
		{72 * time.Hour, "", "until 2026-10-21T12:00:00Z"},
		{0, "2026-11-01", "until 2026-11-01T00:00:00Z"},
		{0, "2026-11-01T08:30:00Z", "until 2026-11-01T08:30:00Z"},
		{time.Hour, "2026-11-01", ""},
		{-time.Hour, "", ""},
		{0, "next week", ""},
	} {
		got, err := banEnd(c.length, c.date, now)
		if c.want == "" {
			if err == nil {
				t.Errorf("banEnd(%v, %q) = %v, want an error", c.length, c.date, got)
			}
			continue
		}
		if err != nil || describe(got) != c.want {
			t.Errorf("banEnd(%v, %q) = %v, %v; want %s", c.length, c.date, got, err, c.want)
		}
	}
}

func TestTarget(t *testing.T) {
	for _, c := range []struct {
		t     target
		fails bool
	}{
		{target{account: "a"}, false},
		{target{identity: "steam:76561190000000001"}, false},
		{target{identity: "google:sub"}, false},
		{target{}, true},
		{target{account: "a", identity: "google:sub"}, true},
		{target{identity: "github:x"}, true},
		{target{identity: "steam:"}, true},
		{target{identity: "steam"}, true},
	} {
		if _, err := c.t.parse(); (err != nil) != c.fails {
			t.Errorf("%+v: %v", c.t, err)
		}
	}
}

// The used tickets kept past the acceptance window (a younger one purged could count twice: AC-22), the results a year
func TestRankedCutoffs(t *testing.T) {
	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	results, tickets := rankedCutoffs(now)
	if now.Sub(tickets) <= server.AcceptWindow || now.Sub(tickets) > server.AcceptWindow+2*time.Hour {
		t.Errorf("used tickets purged from %v before now: within the window, or kept far past it", now.Sub(tickets))
	}
	if now.Sub(results) != server.ResultsKept {
		t.Errorf("results purged from %v before now", now.Sub(results))
	}
}

// serve refuses a role that may create in the schema, but in development (AP-4, AP2-10)
func TestRoleRefusal(t *testing.T) {
	if roleRefusal(true, false) == nil {
		t.Error("a schema-creating role accepted outside development")
	}
	if roleRefusal(true, true) != nil || roleRefusal(false, false) != nil {
		t.Error("refused when it may run")
	}
}
