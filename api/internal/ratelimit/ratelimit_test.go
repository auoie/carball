package ratelimit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

func TestAllow(t *testing.T) {
	l := New(3, time.Minute)
	at := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	for i := range 3 {
		if !l.Allow("a", at) {
			t.Fatalf("request %d refused within the burst", i+1)
		}
	}
	if l.Allow("a", at) {
		t.Fatal("a 4th request at once allowed")
	}
	if !l.Allow("b", at) {
		t.Fatal("another key refused")
	}
	// (a third of the window: one more)
	if !l.Allow("a", at.Add(20*time.Second)) || l.Allow("a", at.Add(20*time.Second)) {
		t.Fatal("the refill isn't one per 20 s")
	}
	l.Sweep(at.Add(time.Hour))
	if len(l.keys) != 0 {
		t.Fatalf("%d keys left after the sweep", len(l.keys))
	}
}

// RV-1077: a reserved request given back is as if never made; a refused one takes nothing
func TestReserveAndGiveBack(t *testing.T) {
	l := New(2, time.Minute)
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	ok, giveBack := l.Reserve("a", at)
	if !ok {
		t.Fatal("the first request refused")
	}
	giveBack()
	for i := range 2 {
		if ok, _ := l.Reserve("a", at); !ok {
			t.Fatalf("request %d refused: the given-back token not restored", i+1)
		}
	}
	ok, giveBack = l.Reserve("a", at)
	if ok {
		t.Fatal("a 3rd request at once allowed")
	}
	giveBack() // (a refused one's: nothing to give back)
	// (half the window: one token back, and the refused reservation took nothing from it)
	if !l.Allow("a", at.Add(30*time.Second)) || l.Allow("a", at.Add(30*time.Second)) {
		t.Fatal("the refill after a refused reservation isn't one per 30 s")
	}
}

func TestEvictionAndSweep(t *testing.T) {
	// (two keys at most: a third forgets the longest idle, never refused for room: AP-2)
	l := NewSized(1, time.Minute, 2)
	at := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	if !l.Allow("a", at) || !l.Allow("b", at.Add(time.Second)) {
		t.Fatal("fresh keys refused")
	}
	if l.Allow("a", at.Add(2*time.Second)) {
		t.Fatal("a's second request at once allowed")
	}
	if !l.Allow("c", at.Add(3*time.Second)) {
		t.Fatal("a new key refused when the limiter was full")
	}
	if l.Len() != 2 {
		t.Fatalf("%d keys, want 2", l.Len())
	}
	// (a, touched since, kept and still empty; b, the longest idle, forgotten: back with a full bucket)
	if l.Allow("a", at.Add(4*time.Second)) {
		t.Fatal("a forgotten instead of the longest idle")
	}
	if !l.Allow("b", at.Add(4*time.Second)) {
		t.Fatal("b's bucket kept")
	}
	// (a sweep forgets what's idle a whole window, keeps the rest)
	l.Sweep(at.Add(4*time.Second + 30*time.Second))
	if l.Len() != 2 {
		t.Fatalf("swept early: %d keys", l.Len())
	}
	l.Sweep(at.Add(4*time.Second + time.Minute))
	if l.Len() != 0 {
		t.Fatalf("%d keys after a window's sweep", l.Len())
	}
}

func TestClientKey(t *testing.T) {
	cloudflared := []netip.Prefix{netip.MustParsePrefix("172.18.0.0/16")}
	for _, c := range []struct{ cf, remote, want string }{
		{"203.0.113.7", "172.18.0.5:41000", "203.0.113.7"},
		// (an IPv6 address by its /64)
		{"2001:db8:1:2:3:4:5:6", "172.18.0.5:41000", "2001:db8:1:2::/64"},
		{"2001:db8:1:2:ffff::1", "172.18.0.5:41000", "2001:db8:1:2::/64"},
		// (an IPv4-mapped one as IPv4)
		{"::ffff:203.0.113.7", "172.18.0.5:41000", "203.0.113.7"},
		// (no header, or garbage in it: the connection's)
		{"", "198.51.100.9:5000", "198.51.100.9"},
		{"not an address", "172.18.0.5:5000", "172.18.0.5"},
		// (a zoned address: no client's, ignored, RV-974)
		{"fe80::1%eth0", "172.18.0.5:5000", "172.18.0.5"},
		// (the header from a connection not trusted: ignored, its own address taken, AP-1)
		{"203.0.113.7", "198.51.100.9:5000", "198.51.100.9"},
		{"203.0.113.7", "[2001:db8::1]:5000", "2001:db8::/64"},
		// (a peer as an IPv4-mapped address: IPv4, its trust and its key (AP1's AC4-no-unmap))
		{"203.0.113.7", "[::ffff:172.18.0.5]:41000", "203.0.113.7"},
		{"", "[::ffff:198.51.100.9]:5000", "198.51.100.9"},
	} {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		r.RemoteAddr = c.remote
		if c.cf != "" {
			r.Header.Set("CF-Connecting-IP", c.cf)
		}
		if got := ClientKey(r, cloudflared); got != c.want {
			t.Errorf("ClientKey(%q, %q) = %q, want %q", c.cf, c.remote, got, c.want)
		}
	}
	// (no proxy trusted: the header never)
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.RemoteAddr = "172.18.0.5:41000"
	r.Header.Set("CF-Connecting-IP", "203.0.113.7")
	if got := ClientKey(r, nil); got != "172.18.0.5" {
		t.Errorf("no trusted proxies: %q", got)
	}
}

func TestWideKey(t *testing.T) {
	for key, want := range map[string]string{
		"2001:db8:1:2::/64": "2001:db8:1::/48",
		"203.0.113.7":       "203.0.113.0/24",
		"unknown":           "unknown",
	} {
		if got := WideKey(key); got != want {
			t.Errorf("WideKey(%q) = %q, want %q", key, got, want)
		}
	}
}
