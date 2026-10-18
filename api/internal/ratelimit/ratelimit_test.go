package ratelimit

import (
	"context"
	"net/http"
	"net/http/httptest"
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

func TestClientKey(t *testing.T) {
	for _, c := range []struct{ cf, remote, want string }{
		{"203.0.113.7", "172.18.0.5:41000", "203.0.113.7"},
		// (an IPv6 address by its /64)
		{"2001:db8:1:2:3:4:5:6", "172.18.0.5:41000", "2001:db8:1:2::/64"},
		{"2001:db8:1:2:ffff::1", "172.18.0.5:41000", "2001:db8:1:2::/64"},
		// (an IPv4-mapped one as IPv4)
		{"::ffff:203.0.113.7", "172.18.0.5:41000", "203.0.113.7"},
		// (no header, or garbage in it: the connection's)
		{"", "198.51.100.9:5000", "198.51.100.9"},
		{"not an address", "[2001:db8::1]:5000", "2001:db8::/64"},
	} {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
		r.RemoteAddr = c.remote
		if c.cf != "" {
			r.Header.Set("CF-Connecting-IP", c.cf)
		}
		if got := ClientKey(r); got != c.want {
			t.Errorf("ClientKey(%q, %q) = %q, want %q", c.cf, c.remote, got, c.want)
		}
	}
}
