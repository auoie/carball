// Package ratelimit limits requests per key, in memory, over a short window (notes/accounts.md §4): per client address
// (an IPv6 one by its /64, as the game server's queue: RV-385, RV-407) or per account. Nothing is written down; a key
// idle for a while is forgotten.
package ratelimit

import (
	"container/list"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// (at most this many keys at once: past it the longest idle is forgotten, never a new one refused: AP-2)
const maxKeys = 200_000

// Limiter allows `burst` requests per key at once, refilled at `burst` per `window`
type Limiter struct {
	limit  rate.Limit
	burst  int
	window time.Duration
	max    int

	mu   sync.Mutex
	keys map[string]*list.Element
	// (most recently seen first)
	recent *list.List
}

type entry struct {
	key     string
	limiter *rate.Limiter
	seen    time.Time
}

// New: burst requests per window for each key
func New(burst int, window time.Duration) *Limiter {
	return NewSized(burst, window, maxKeys)
}

// NewSized is New holding at most `size` keys (the tests')
func NewSized(burst int, window time.Duration, size int) *Limiter {
	return &Limiter{
		limit: rate.Limit(float64(burst) / window.Seconds()), burst: burst, window: window, max: size,
		keys: map[string]*list.Element{}, recent: list.New(),
	}
}

// Allow takes one request for key at now. A new key past the limit's size makes room by forgetting the longest idle (its
// bucket the fullest anyway): a flood of new keys costs the flooder, never everyone else (AP-2)
func (l *Limiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if el := l.keys[key]; el != nil {
		e, _ := el.Value.(*entry)
		e.seen = now
		l.recent.MoveToFront(el)
		return e.limiter.AllowN(now, 1)
	}
	if l.recent.Len() >= l.max {
		if oldest := l.recent.Back(); oldest != nil {
			e, _ := l.recent.Remove(oldest).(*entry)
			delete(l.keys, e.key)
		}
	}
	e := &entry{key: key, limiter: rate.NewLimiter(l.limit, l.burst), seen: now}
	l.keys[key] = l.recent.PushFront(e)
	return e.limiter.AllowN(now, 1)
}

// Sweep forgets the keys idle for a whole window by now (their buckets full again: forgetting them changes nothing)
func (l *Limiter) Sweep(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for el := l.recent.Back(); el != nil; {
		e, _ := el.Value.(*entry)
		if now.Sub(e.seen) < l.window {
			return
		}
		prev := el.Prev()
		l.recent.Remove(el)
		delete(l.keys, e.key)
		el = prev
	}
}

// Len is how many keys it holds
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.recent.Len()
}

// ClientKey is a request's client address as a limit's key: the connection's, or Cloudflare's CF-Connecting-IP when the
// connection comes from one of `trusted` (cloudflared: AP-1; from anyone else the header is a client's to forge); an
// IPv6 address by its /64
func ClientKey(r *http.Request, trusted []netip.Prefix) string {
	addr, ok := Peer(r)
	if !ok {
		return "unknown"
	}
	if forwarded, err := netip.ParseAddr(r.Header.Get("CF-Connecting-IP")); err == nil && trustedAddr(addr, trusted) {
		addr = forwarded.Unmap()
	}
	if addr.Is6() {
		prefix, _ := addr.Prefix(64)
		return prefix.String()
	}
	return addr.String()
}

// WideKey is a client address's wider network (an IPv6 /48, an IPv4 /24): an aggregate limit's key, so a block of
// addresses can't take a key each (AP-2)
func WideKey(key string) string {
	if p, err := netip.ParsePrefix(key); err == nil {
		wide, _ := p.Addr().Prefix(48)
		return wide.String()
	}
	if a, err := netip.ParseAddr(key); err == nil && a.Is4() {
		wide, _ := a.Prefix(24)
		return wide.String()
	}
	return key
}

// Peer is the connection's own address (IPv4-mapped as IPv4)
func Peer(r *http.Request) (netip.Addr, bool) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return addr.Unmap(), true
}

// ForwardIgnored: the request carries CF-Connecting-IP from a peer outside `trusted`, so the header is ignored (behind
// the tunnel, its connector left out of TRUSTED_PROXIES: every user one key); the peer's kind, never its address
func ForwardIgnored(r *http.Request, trusted []netip.Prefix) (kind string, ignored bool) {
	if r.Header.Get("CF-Connecting-IP") == "" {
		return "", false
	}
	addr, ok := Peer(r)
	if !ok || trustedAddr(addr, trusted) {
		return "", false
	}
	switch {
	case addr.IsLoopback():
		return "loopback", true
	case addr.IsPrivate():
		return "private", true
	default:
		return "public", true
	}
}

func trustedAddr(addr netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
