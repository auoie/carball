// Package ratelimit limits requests per key, in memory, over a short window (notes/accounts.md §4): per client address
// (an IPv6 one by its /64, as the game server's queue: RV-385, RV-407) or per account. Nothing is written down; a key
// idle for a while is forgotten.
package ratelimit

import (
	"net"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// (beyond this many keys at once, new ones are refused rather than the map grown: a flood of addresses can't use the
// memory up)
const maxKeys = 200_000

// Limiter allows `burst` requests per key at once, refilled at `burst` per `window`
type Limiter struct {
	limit rate.Limit
	burst int

	mu   sync.Mutex
	keys map[string]*entry
}

type entry struct {
	limiter *rate.Limiter
	seen    time.Time
}

// New: burst requests per window for each key
func New(burst int, window time.Duration) *Limiter {
	return &Limiter{limit: rate.Limit(float64(burst) / window.Seconds()), burst: burst, keys: map[string]*entry{}}
}

// Allow takes one request for key at now
func (l *Limiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.keys[key]
	if e == nil {
		if len(l.keys) >= maxKeys {
			return false
		}
		e = &entry{limiter: rate.NewLimiter(l.limit, l.burst)}
		l.keys[key] = e
	}
	e.seen = now
	return e.limiter.AllowN(now, 1)
}

// Sweep forgets the keys idle since before `before` (their buckets full again by then)
func (l *Limiter) Sweep(before time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, e := range l.keys {
		if e.seen.Before(before) {
			delete(l.keys, k)
		}
	}
}

// ClientKey is a request's client address as a limit's key: Cloudflare's CF-Connecting-IP, trusted because nothing but
// cloudflared reaches the service (it listens on its docker network alone: AC-4), else the connection's; an IPv6
// address by its /64
func ClientKey(r *http.Request) string {
	addr, err := netip.ParseAddr(r.Header.Get("CF-Connecting-IP"))
	if err != nil {
		host, _, splitErr := net.SplitHostPort(r.RemoteAddr)
		if splitErr != nil {
			host = r.RemoteAddr
		}
		if addr, err = netip.ParseAddr(host); err != nil {
			return "unknown"
		}
	}
	addr = addr.Unmap()
	if addr.Is6() {
		prefix, _ := addr.Prefix(64)
		return prefix.String()
	}
	return addr.String()
}
