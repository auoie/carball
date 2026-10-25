// Package server is carball-api's HTTP side (notes/accounts.md): sign-in with Google or Steam, each flow bound to the
// browser that started it; a new identity's sign-up behind Turnstile; sessions; the account page's calls. Everything is
// under /api/ on the site's own origin (AC-21); every write proves it's the page's own (AC-7); nothing logs an address
// or a query string (AC-15).
package server

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/netip"
	"net/url"
	"sync"
	"time"

	"carball/api/internal/google"
	"carball/api/internal/matchmaker"
	"carball/api/internal/ratelimit"
	"carball/api/internal/steam"
	"carball/api/internal/store"
	"carball/api/internal/ticket"
)

// The lifetimes (notes/accounts.md §1, §3)
const (
	// FlowTTL: a sign-in's pre-auth cookie and its flow
	FlowTTL = 10 * time.Minute
	// SignupTTL: a new identity's sign-up waiting for its name and Turnstile
	SignupTTL = 15 * time.Minute
	// SessionTTL: a session's absolute lifetime (AC-8)
	SessionTTL = 90 * 24 * time.Hour
	// RotateEvery: a session's token replaced this often, the old one honoured for RotateGrace (two tabs, a request in
	// flight)
	RotateEvery = 24 * time.Hour
	RotateGrace = 10 * time.Minute
	// RecreateBlock: an identity that deleted an account can't make another this long (the user's 30 days)
	RecreateBlock = 30 * 24 * time.Hour
)

// The cookies: __Host- (Secure, Path=/, no Domain: no sibling *.zolt.top site can set or read them, AC-7)
const (
	authCookie    = "__Host-cb_auth"
	signupCookie  = "__Host-cb_signup"
	sessionCookie = "__Host-cb_session"
)

// WriteHeader is the custom header every write carries (with Origin and a JSON body: AC-7)
const WriteHeader = "X-Carball"

// Store is what the server keeps (store.Store; the tests' too)
type Store interface {
	Ping(ctx context.Context) error
	CreateFlow(ctx context.Context, f store.Flow) error
	TakeFlow(ctx context.Context, idHash []byte, now time.Time) (store.Flow, bool, error)
	steam.NonceStore
	AccountByIdentity(ctx context.Context, provider store.Provider, subject string) (string, bool, error)
	BanOn(ctx context.Context, provider store.Provider, subject string, now time.Time) (store.Ban, bool, error)
	DeletedAfter(ctx context.Context, subjectHMAC []byte, after time.Time) (time.Time, bool, error)
	CreatePending(ctx context.Context, p store.Pending) error
	PendingSignup(ctx context.Context, tokenHash []byte, now time.Time) (store.Pending, bool, error)
	CreateAccount(ctx context.Context, p store.Pending, name string, subjectHMAC []byte, now, blockAfter time.Time) (string, error)
	CreateSession(ctx context.Context, tokenHash []byte, accountID string, now, expires time.Time) error
	SessionByToken(ctx context.Context, tokenHash []byte, now time.Time) (store.Session, bool, error)
	OpenFlows(ctx context.Context, now time.Time) (int, error)
	OpenSignups(ctx context.Context, now time.Time) (int, error)
	RotateSession(ctx context.Context, oldHash, newHash []byte, now, graceUntil time.Time) (bool, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
	DeleteSessions(ctx context.Context, accountID string) error
	Account(ctx context.Context, id string) (store.Account, error)
	Rename(ctx context.Context, id, name string) error
	DeleteAccount(ctx context.Context, id string, hmacOf func(store.Identity) []byte, now time.Time) error
	RatingsOf(ctx context.Context, accountID string) (map[int]store.Rating, error)
	QueueBanOf(ctx context.Context, accountID string) (store.QueueBan, bool, error)
	ChangeQueueBan(ctx context.Context, accountID string, spend *store.SpentTicket, now time.Time, change func(cur store.QueueBan, exists bool) (*store.QueueBan, bool)) error
	RecordResult(ctx context.Context, r store.Result, rate func(current map[string]*store.Rating) map[string]store.Rating, now time.Time) (bool, error)
	PlaylistRatings(ctx context.Context, playlist int) ([]store.Rated, error)
}

// Turnstile checks a sign-up's token (turnstile.Verifier)
type Turnstile interface {
	Verify(ctx context.Context, token, action string) error
}

// Server holds the service's parts
type Server struct {
	Store  Store
	Origin string
	// Dev is development mode (`serve --dev`: a localhost origin only); the e2e build's routes answer only under it
	Dev bool
	// Google is nil when not configured
	Google *google.Client
	Steam  *steam.Verifier
	// SteamNames is nil without a Web API key (a sign-up then suggests a guest-style name)
	SteamNames *steam.Names
	// Turnstile is nil only in development
	Turnstile        Turnstile
	TurnstileSiteKey string
	DeletionKey      []byte
	// Tickets signs the tickets, a seat's and a rejoin's (nil: none issued, a development server without a key)
	Tickets *ticket.Signer
	// TicketKeys check the tickets a result or a quitter carries: the signer's, and those from before a rotation
	TicketKeys map[string]ed25519.PublicKey
	// GameServerToken is the game server's credential on its calls (none: they answer 503)
	GameServerToken []byte
	// Matchmaker is the one queue (NewMatchmaker; notes/matchmaking.md, the central matchmaker)
	Matchmaker *matchmaker.Matchmaker
	// TrustedProxies are the connections whose CF-Connecting-IP is believed (cloudflared's: AP-1)
	TrustedProxies []netip.Prefix
	Now            func() time.Time
	Log            *slog.Logger

	limits Limits
	// the limits (AC-26): per client address (an IPv6 /64) and per its wider network (/48, IPv4 /24: AP-2) for sign-in
	// and sign-up, per account for renames
	signIns, signInsWide *ratelimit.Limiter
	signups, signupsWide *ratelimit.Limiter
	renames, tickets     *ratelimit.Limiter
	searchStarts         *ratelimit.Limiter
	gameServerCalls      *ratelimit.Limiter
	gameServerFleet      *ratelimit.Limiter
	rejoinQuestions      *ratelimit.Limiter
	rejoinCeiling        *ratelimit.Limiter
	// (the log's request lines per client address, and the ones not written since its last: RV-963)
	requestLines    *ratelimit.Limiter
	requestLinesAll *ratelimit.Limiter
	linesMu         sync.Mutex
	unlogged        map[string]int
	unloggedAll     int

	// (the kinds of peer whose CF-Connecting-IP was ignored, each warned of once)
	forwardMu     sync.Mutex
	forwardWarned map[string]bool

	// (the public reads' kept answers: public.go)
	public publicReads
}

// Limit is one rate limit: Burst requests at once, Burst more each Window
type Limit struct {
	Burst  int
	Window time.Duration
}

// Limits sets the rate limits and ceilings (DefaultLimits; the tests' tighter)
type Limits struct {
	SignIns, SignInsWide, Signups, SignupsWide, Renames, Tickets Limit
	// Searches is each account's searches started (a found match's next search, a cancel and again, another tab)
	Searches Limit
	// GameServer is each game server's calls' (results, quitters, refills, events: AC-26), by the name it sends
	// (X-Carball-Server; one without, all such together), so that one server's burst can't hold another's results
	// (RV-1020); GameServerFleet everyone's together above them: a name is the server's word, not an identity, so a
	// holder of the shared token naming many can't outrun the fleet's (RV-1024)
	GameServer, GameServerFleet Limit
	// RejoinQuestions and RejoinCeiling are the game servers' rejoin questions (RV-1008): each account's, and everyone's
	// together; apart from GameServer, so that a replayed rejoin ticket can't hold the outbox calls (RV-1020)
	RejoinQuestions, RejoinCeiling Limit
	// RequestLines is each client address's request lines in the log (an IPv6 /64's): past them its lines are counted,
	// not written, so that a flood can't push the abuse trail out of the log's rotation or fill the disk (RV-963); none
	// (0): every line. RequestLinesAll is everyone's together above them, a flood from many addresses too (RV-1027)
	RequestLines, RequestLinesAll Limit
	// Keys is each limit's most keys at once (past it the longest idle is forgotten)
	Keys int
	// OpenFlows and OpenSignups are the ceilings on sign-ins in progress and sign-ups waiting, everyone's (AP-2)
	OpenFlows, OpenSignups int
}

// DefaultLimits: generous for a household or a NAT, tight for a script; a network's wider limit a few households'
func DefaultLimits() Limits {
	return Limits{
		SignIns:         Limit{30, 10 * time.Minute},
		SignInsWide:     Limit{150, 10 * time.Minute},
		Signups:         Limit{5, time.Hour},
		SignupsWide:     Limit{25, time.Hour},
		Renames:         Limit{5, 24 * time.Hour},
		Tickets:         Limit{60, 10 * time.Minute},
		Searches:        Limit{30, 10 * time.Minute},
		GameServer:      Limit{300, time.Minute},
		GameServerFleet: Limit{2400, time.Minute},
		RejoinQuestions: Limit{20, 10 * time.Minute},
		RejoinCeiling:   Limit{600, time.Minute},
		// (a LAN party's 64 players' polls, about one each 25 s, and their pages, well inside)
		RequestLines:    Limit{600, time.Minute},
		RequestLinesAll: Limit{6000, time.Minute},
		Keys:            200_000,
		OpenFlows:       20_000,
		OpenSignups:     5_000,
	}
}

// SetLimits installs the limits (before Handler)
func (s *Server) SetLimits(l Limits) {
	s.limits = l
	limiter := func(x Limit) *ratelimit.Limiter { return ratelimit.NewSized(x.Burst, x.Window, l.Keys) }
	s.signIns, s.signInsWide = limiter(l.SignIns), limiter(l.SignInsWide)
	s.signups, s.signupsWide = limiter(l.Signups), limiter(l.SignupsWide)
	s.renames, s.tickets = limiter(l.Renames), limiter(l.Tickets)
	s.searchStarts = limiter(l.Searches)
	s.gameServerCalls, s.gameServerFleet = limiter(l.GameServer), limiter(l.GameServerFleet)
	s.rejoinQuestions, s.rejoinCeiling = limiter(l.RejoinQuestions), limiter(l.RejoinCeiling)
	s.requestLines, s.requestLinesAll = nil, nil
	if l.RequestLines.Burst > 0 {
		s.requestLines = limiter(l.RequestLines)
		if l.RequestLinesAll.Burst > 0 {
			s.requestLinesAll = limiter(l.RequestLinesAll)
		}
	}
}

// Sweep forgets the limits' keys idle for their window (the service's housekeeping, every minute)
func (s *Server) Sweep(now time.Time) {
	for _, l := range []*ratelimit.Limiter{s.signIns, s.signInsWide, s.signups, s.signupsWide, s.renames, s.tickets, s.searchStarts, s.gameServerCalls, s.gameServerFleet, s.rejoinQuestions, s.rejoinCeiling} {
		l.Sweep(now)
	}
	if s.requestLines != nil {
		s.requestLines.Sweep(now)
	}
	if s.requestLinesAll != nil {
		s.requestLinesAll.Sweep(now)
	}
	// (the request lines not written in the last minute, each address's count said (the first sweepAddresses of them:
	// a flood from many addresses can't make this a flood of its own, RV-1027), then forgotten)
	s.linesMu.Lock()
	unlogged, all := s.unlogged, s.unloggedAll
	s.unlogged, s.unloggedAll = nil, 0
	s.linesMu.Unlock()
	said, rest, restLines := 0, 0, 0
	for key, n := range unlogged {
		if said < sweepAddresses {
			s.Log.Warn("request lines not written", "ip", key, "lines", n)
			said++
		} else {
			rest++
			restLines += n
		}
	}
	if rest > 0 {
		s.Log.Warn("request lines not written from more addresses", "addresses", rest, "lines", restLines)
	}
	if all > 0 {
		s.Log.Warn("request lines not written past everyone's ceiling", "lines", all)
	}
}

// sweepAddresses: the most addresses the minute's line names one by one
const sweepAddresses = 100

// lineAllowed: whether a request from `key` (its address, ClientKey's) is written to the log (its address's lines and
// everyone's within their ceilings), and how many of its address's weren't since its last
func (s *Server) lineAllowed(key string, now time.Time) (int, bool) {
	if s.requestLines == nil {
		return 0, true
	}
	s.linesMu.Lock()
	defer s.linesMu.Unlock()
	if !s.requestLines.Allow(key, now) {
		if s.unlogged == nil {
			s.unlogged = map[string]int{}
		}
		s.unlogged[key]++
		return 0, false
	}
	// (everyone's ceiling past: counted together, the minute's line says how many, RV-1027)
	if s.requestLinesAll != nil && !s.requestLinesAll.Allow("all", now) {
		s.unloggedAll++
		return 0, false
	}
	n := s.unlogged[key]
	delete(s.unlogged, key)
	return n, true
}

// allowAddress takes one request of the client's address and of its wider network
func (s *Server) allowAddress(r *http.Request, now time.Time, narrow, wide *ratelimit.Limiter) bool {
	key := ratelimit.ClientKey(r, s.TrustedProxies)
	// (both counted: a block's addresses can't each take a fresh key past the network's)
	ok := narrow.Allow(key, now)
	return wide.Allow(ratelimit.WideKey(key), now) && ok
}

// Handler routes /api/
func (s *Server) Handler() http.Handler {
	if s.signIns == nil {
		s.SetLimits(DefaultLimits())
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/auth/{provider}/start", s.start)
	mux.HandleFunc("GET /api/auth/google/callback", s.googleCallback)
	mux.HandleFunc("GET /api/auth/steam/callback", s.steamCallback)
	mux.HandleFunc("GET /api/signup", s.signupInfo)
	mux.HandleFunc("POST /api/signup", s.write(s.signup))
	mux.HandleFunc("GET /api/me", s.me)
	mux.HandleFunc("PUT /api/me/name", s.write(s.rename))
	mux.HandleFunc("DELETE /api/me", s.write(s.deleteAccount))
	mux.HandleFunc("POST /api/signout", s.write(s.signOut))
	mux.HandleFunc("POST /api/signout-everywhere", s.write(s.signOutEverywhere))
	mux.HandleFunc("POST /api/ticket", s.write(s.ticket))
	mux.HandleFunc("POST /api/results", s.gameServer(s.result))
	mux.HandleFunc("POST /api/quitters", s.gameServer(s.quitter))
	mux.HandleFunc("POST /api/refills", s.gameServer(s.refill))
	mux.HandleFunc("POST /api/search", s.write(s.startSearch))
	mux.HandleFunc("GET /api/search/{id}", s.pollSearch)
	mux.HandleFunc("DELETE /api/search/{id}", s.write(s.cancelSearch))
	mux.HandleFunc("POST /api/fleet/events", s.gameServer(s.fleetEvent))
	mux.HandleFunc("POST /api/fleet/rejoin", s.gameServerAsking(s.rejoinCheck))
	mux.HandleFunc("GET /api/stats", s.stats)
	mux.HandleFunc("GET /api/leaderboard", s.leaderboard)
	s.e2eRoutes(mux)
	return s.logged(headers(mux))
}

// HealthHandler is the health check's own listener's (loopback only: not reachable through the tunnel, AP-6): GET
// /healthz, 200 while the database answers, else 503
func (s *Server) HealthHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	return mux
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.Store.Ping(ctx); err != nil {
		http.Error(w, "the database doesn't answer", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "ok\n")
}

// --- Middleware ---

// headers: nothing cached, nothing sniffed, no Referer (a callback's URL holds its code), never framed
func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	// refusal: the error code a refusal answered with (writeJSON's `error`)
	refusal string
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// logged: one line a request, its method, route (its pattern, never its path: a search's holds its id, RV-871; never
// the query: a callback's holds its code and assertion), status, a refusal's error code and time, and who (`who`: the
// client's address, and its account and name when signed in; the user's decision of 2026-10-23, in place of AC-15's
// "never the address")
func (s *Server) logged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		s.noteForward(r)
		client := &who{ip: ratelimit.ClientAddr(r, s.TrustedProxies)}
		r = withWho(r, client)
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		route := r.Pattern
		if route == "" {
			route = "(no route)"
		}
		attrs := []any{"method", r.Method, "route", route, "status", sw.status}
		if sw.refusal != "" {
			attrs = append(attrs, "error", sw.refusal)
		}
		attrs = append(attrs, "ms", time.Since(start).Milliseconds())
		// (a line an address can write so often: past that, counted, RV-963)
		unlogged, ok := s.lineAllowed(ratelimit.ClientKey(r, s.TrustedProxies), s.Now())
		if !ok {
			return
		}
		if unlogged > 0 {
			attrs = append(attrs, "unlogged", unlogged)
		}
		s.Log.Info("request", append(attrs, client.attrs()...)...)
	})
}

// noteForward warns, once for each kind of peer, of a CF-Connecting-IP from outside TRUSTED_PROXIES: ignored, so its
// connection's address is the limits' key, and behind the tunnel that's the connector's, every user's at once
func (s *Server) noteForward(r *http.Request) {
	kind, ignored := ratelimit.ForwardIgnored(r, s.TrustedProxies)
	if !ignored {
		return
	}
	s.forwardMu.Lock()
	defer s.forwardMu.Unlock()
	if s.forwardWarned[kind] {
		return
	}
	if s.forwardWarned == nil {
		s.forwardWarned = map[string]bool{}
	}
	s.forwardWarned[kind] = true
	s.Log.Warn("CF-Connecting-IP from a peer outside TRUSTED_PROXIES, ignored: the connection's address is the rate limits' key "+
		"(behind the tunnel, every user's): set TRUSTED_PROXIES to the connector's address as the API sees it", "peer", kind)
}

// maxBody: a write's largest body (bytes)
const maxBody = 16 << 10

// write guards a write (AC-7): Origin the site's, JSON when there's a body, the custom header; the body capped
func (s *Server) write(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != s.Origin || r.Header.Get(WriteHeader) != "1" {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}
		if r.ContentLength != 0 {
			if t, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || t != "application/json" {
				writeError(w, http.StatusUnsupportedMediaType, "json only")
				return
			}
		}
		if r.ContentLength > maxBody {
			writeError(w, http.StatusRequestEntityTooLarge, "too-large")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	if sw, ok := w.(*statusWriter); ok && status >= http.StatusBadRequest {
		switch body := v.(type) {
		case map[string]string:
			sw.refusal = body["error"]
		case map[string]any:
			sw.refusal, _ = body["error"].(string)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError: {"error": code} (a code the page knows, never a server's detail)
func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

// readJSON reads one JSON value into v, no field it doesn't know and nothing after it (a stray `}` too: AP-16)
func readJSON(r *http.Request, v any) error {
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if err := d.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("one JSON value only")
	}
	return nil
}

// badBody answers a body readJSON refused: too large (past maxBody, a stream without its length) or not the call's
func badBody(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "too-large")
		return
	}
	writeError(w, http.StatusBadRequest, "bad-request")
}

// --- Tokens and cookies ---

// token: 32 bytes from the system's random source, base64url
func token() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b) // (crypto/rand never fails on a supported system)
	return base64.RawURLEncoding.EncodeToString(b)
}

// digest is what the database keeps of a token
func digest(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// subjectHMAC is the delete/re-create rule's record of an identity (AC-24)
func (s *Server) subjectHMAC(i store.Identity) []byte {
	m := hmac.New(sha256.New, s.DeletionKey)
	_, _ = io.WriteString(m, string(i.Provider)+":"+i.Subject)
	return m.Sum(nil)
}

func setCookie(w http.ResponseWriter, name, value string, maxAge time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: "/", MaxAge: int(maxAge.Seconds()),
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	})
}

func clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	})
}

func cookie(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

// redirectPage sends the browser back to the page, with what happened (`?signin=…`, `?signup`)
func (s *Server) redirectPage(w http.ResponseWriter, r *http.Request, query url.Values) {
	target := s.Origin + "/"
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	http.Redirect(w, r, target, http.StatusSeeOther)
}
