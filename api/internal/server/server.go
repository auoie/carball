// Package server is carball-api's HTTP side (notes/accounts.md): sign-in with Google or Steam, each flow bound to the
// browser that started it; a new identity's sign-up behind Turnstile; sessions; the account page's calls. Everything is
// under /api/ on the site's own origin (AC-21); every write proves it's the page's own (AC-7); nothing logs an address
// or a query string (AC-15).
package server

import (
	"context"
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
	"net/url"
	"time"

	"carball/api/internal/google"
	"carball/api/internal/ratelimit"
	"carball/api/internal/steam"
	"carball/api/internal/store"
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
	RotateSession(ctx context.Context, oldHash, newHash []byte, now, graceUntil time.Time) (bool, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
	DeleteSessions(ctx context.Context, accountID string) error
	Account(ctx context.Context, id string) (store.Account, error)
	Rename(ctx context.Context, id, name string) error
	DeleteAccount(ctx context.Context, id string, hmacOf func(store.Identity) []byte, now time.Time) error
}

// Turnstile checks a sign-up's token (turnstile.Verifier)
type Turnstile interface {
	Verify(ctx context.Context, token, action string) error
}

// Server holds the service's parts
type Server struct {
	Store  Store
	Origin string
	// Google is nil when not configured
	Google *google.Client
	Steam  *steam.Verifier
	// SteamNames is nil without a Web API key (a sign-up then suggests a guest-style name)
	SteamNames *steam.Names
	// Turnstile is nil only in development
	Turnstile        Turnstile
	TurnstileSiteKey string
	DeletionKey      []byte
	Now              func() time.Time
	Log              *slog.Logger

	// the limits (AC-26): per client address for sign-in and sign-up, per account for renames
	signIns *ratelimit.Limiter
	signups *ratelimit.Limiter
	renames *ratelimit.Limiter
}

// Limits sets the rate limits (New's defaults; the tests' tighter)
type Limits struct {
	SignIns, Signups, Renames struct {
		Burst  int
		Window time.Duration
	}
}

// DefaultLimits: generous for a household or a NAT, tight for a script
func DefaultLimits() Limits {
	var l Limits
	l.SignIns.Burst, l.SignIns.Window = 30, 10*time.Minute
	l.Signups.Burst, l.Signups.Window = 5, time.Hour
	l.Renames.Burst, l.Renames.Window = 5, 24*time.Hour
	return l
}

// SetLimits installs the limits (before Handler)
func (s *Server) SetLimits(l Limits) {
	s.signIns = ratelimit.New(l.SignIns.Burst, l.SignIns.Window)
	s.signups = ratelimit.New(l.Signups.Burst, l.Signups.Window)
	s.renames = ratelimit.New(l.Renames.Burst, l.Renames.Window)
}

// Sweep forgets the limits' idle keys (the service's housekeeping)
func (s *Server) Sweep(now time.Time) {
	for _, l := range []*ratelimit.Limiter{s.signIns, s.signups, s.renames} {
		l.Sweep(now.Add(-24 * time.Hour))
	}
}

// Handler routes /api/
func (s *Server) Handler() http.Handler {
	if s.signIns == nil {
		s.SetLimits(DefaultLimits())
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", s.health)
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
	return s.logged(headers(mux))
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

// logged: one line a request, its method, path (never the query: a callback's holds its code and assertion), status and
// time; never the address (AC-15)
func (s *Server) logged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		if r.URL.Path == "/api/healthz" && sw.status == http.StatusOK {
			return
		}
		s.Log.Info("request", "method", r.Method, "path", r.URL.Path, "status", sw.status,
			"ms", time.Since(start).Milliseconds())
	})
}

// write guards a write (AC-7): Origin the site's, a JSON body (or none), the custom header; then the body capped
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
		r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError: {"error": code} (a code the page knows, never a server's detail)
func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func readJSON(r *http.Request, v any) error {
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if d.More() {
		return errors.New("one JSON value only")
	}
	return nil
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
