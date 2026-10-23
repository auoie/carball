package server

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"golang.org/x/oauth2"

	"carball/api/internal/names"
	"carball/api/internal/steam"
	"carball/api/internal/store"
)

// What a sign-in tells the page (`/?signin=…`)
const (
	signinFailed    = "failed"    // (the flow not this browser's, expired, refused by the provider or by a check)
	signinCancelled = "cancelled" // (the player said no at the provider)
	signinBusy      = "busy"      // (the address's limit)
	signinBanned    = "banned"    // (with `until`, a date, unless it has no end)
	signinBlocked   = "blocked"   // (a deleted account's identity, with `until`)
	signinOff       = "unavailable"
)

// start begins a sign-in: a flow bound to this browser by the pre-auth cookie (AC-1), then the provider
func (s *Server) start(w http.ResponseWriter, r *http.Request) {
	now := s.Now()
	if !s.allowAddress(r, now, s.signIns, s.signInsWide) {
		s.redirectPage(w, r, url.Values{"signin": {signinBusy}})
		return
	}
	provider, known := store.ParseProvider(r.PathValue("provider"))
	if !known {
		http.NotFound(w, r)
		return
	}
	id, state := token(), token()
	f := store.Flow{IDHash: digest(id), Provider: provider, State: state, ExpiresAt: now.Add(FlowTTL)}
	var target string
	switch provider {
	case store.Google:
		if s.Google == nil {
			s.redirectPage(w, r, url.Values{"signin": {signinOff}})
			return
		}
		f.Nonce, f.Verifier = token(), oauth2.GenerateVerifier()
		var err error
		if target, err = s.Google.AuthURL(state, f.Nonce, f.Verifier); err != nil {
			s.log(r).Error("google sign-in unavailable", "err", err)
			s.redirectPage(w, r, url.Values{"signin": {signinOff}})
			return
		}
	case store.Steam:
		target = steam.LoginURL(s.Steam.Endpoint, s.steamReturnTo(state), s.Origin)
	}
	// (everyone's sign-ins in progress at most so many: a flood can't fill the table, AP-2)
	if open, err := s.Store.OpenFlows(r.Context(), now); err != nil || open >= s.limits.OpenFlows {
		if err != nil {
			s.log(r).Error("counting sign-ins", "err", err)
		}
		s.redirectPage(w, r, url.Values{"signin": {signinBusy}})
		return
	}
	if err := s.Store.CreateFlow(r.Context(), f); err != nil {
		s.fail(w, r, "storing a sign-in", err)
		return
	}
	setCookie(w, authCookie, id, FlowTTL)
	http.Redirect(w, r, target, http.StatusSeeOther)
}

// steamReturnTo is where Steam sends the browser back: this flow's state in it (checked against the cookie's flow)
func (s *Server) steamReturnTo(state string) string {
	return s.Origin + "/api/auth/steam/callback?flow=" + state
}

// takeFlow: the flow this browser's pre-auth cookie names, taken once (the cookie cleared either way), if it's the
// provider's and not expired
func (s *Server) takeFlow(w http.ResponseWriter, r *http.Request, provider store.Provider) (store.Flow, bool) {
	id := cookie(r, authCookie)
	clearCookie(w, authCookie)
	if id == "" {
		return store.Flow{}, false
	}
	f, ok, err := s.Store.TakeFlow(r.Context(), digest(id), s.Now())
	if err != nil {
		s.log(r).Error("taking a sign-in", "err", err)
		return store.Flow{}, false
	}
	return f, ok && f.Provider == provider
}

func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

func (s *Server) googleCallback(w http.ResponseWriter, r *http.Request) {
	if !s.allowAddress(r, s.Now(), s.signIns, s.signInsWide) {
		s.redirectPage(w, r, url.Values{"signin": {signinBusy}})
		return
	}
	f, ok := s.takeFlow(w, r, store.Google)
	q := r.URL.Query()
	if !ok || s.Google == nil || !equal(q.Get("state"), f.State) {
		s.redirectPage(w, r, url.Values{"signin": {signinFailed}})
		return
	}
	if q.Get("error") != "" {
		s.redirectPage(w, r, url.Values{"signin": {signinCancelled}})
		return
	}
	sub, err := s.Google.Exchange(r.Context(), q.Get("code"), f.Verifier, f.Nonce)
	if err != nil {
		s.log(r).Warn("google sign-in refused", "err", err)
		s.redirectPage(w, r, url.Values{"signin": {signinFailed}})
		return
	}
	s.signedIn(w, r, store.Identity{Provider: store.Google, Subject: sub})
}

func (s *Server) steamCallback(w http.ResponseWriter, r *http.Request) {
	if !s.allowAddress(r, s.Now(), s.signIns, s.signInsWide) {
		s.redirectPage(w, r, url.Values{"signin": {signinBusy}})
		return
	}
	f, ok := s.takeFlow(w, r, store.Steam)
	q := r.URL.Query()
	if !ok || !equal(q.Get("flow"), f.State) {
		s.redirectPage(w, r, url.Values{"signin": {signinFailed}})
		return
	}
	if q.Get("openid.mode") == "cancel" {
		s.redirectPage(w, r, url.Values{"signin": {signinCancelled}})
		return
	}
	id, err := s.Steam.Verify(r.Context(), r.URL.RawQuery, s.steamReturnTo(f.State))
	if err != nil {
		s.log(r).Warn("steam sign-in refused", "err", err)
		s.redirectPage(w, r, url.Values{"signin": {signinFailed}})
		return
	}
	s.signedIn(w, r, store.Identity{Provider: store.Steam, Subject: id})
}

// signIn is what a sign-in comes to (sealed: gochecksumtype keeps the handler's switch over it whole)
//
//sumtype:decl
type signIn interface{ signIn() }

type (
	// signInBanned: the identity is banned, until its end
	signInBanned struct{ end store.BanEnd }
	// signInKnown: the identity's account, signed in to
	signInKnown struct{ account string }
	// signInBlocked: a new identity that deleted an account within the block, free again at `free`
	signInBlocked struct{ free time.Time }
	// signInNew: a new identity: its sign-up next
	signInNew struct{}
)

func (signInBanned) signIn()  {}
func (signInKnown) signIn()   {}
func (signInBlocked) signIn() {}
func (signInNew) signIn()     {}

// decide what a sign-in by the identity comes to at now
func (s *Server) decide(ctx context.Context, i store.Identity, now time.Time) (signIn, error) {
	if ban, banned, err := s.Store.BanOn(ctx, i.Provider, i.Subject, now); err != nil {
		return nil, fmt.Errorf("reading bans: %w", err)
	} else if banned {
		return signInBanned{end: ban.End}, nil
	}
	account, known, err := s.Store.AccountByIdentity(ctx, i.Provider, i.Subject)
	if err != nil {
		return nil, fmt.Errorf("reading identities: %w", err)
	}
	if known {
		return signInKnown{account: account}, nil
	}
	if at, blocked, err := s.Store.DeletedAfter(ctx, s.subjectHMAC(i), now.Add(-RecreateBlock)); err != nil {
		return nil, fmt.Errorf("reading deletions: %w", err)
	} else if blocked {
		return signInBlocked{free: at.Add(RecreateBlock)}, nil
	}
	return signInNew{}, nil
}

// signedIn: the provider vouched for the identity. Banned: refused; known: its account's session; new: a sign-up waits
// for its name and the Turnstile check, unless the identity deleted an account within the block
func (s *Server) signedIn(w http.ResponseWriter, r *http.Request, i store.Identity) {
	ctx, now := r.Context(), s.Now()
	outcome, err := s.decide(ctx, i, now)
	if err != nil {
		s.fail(w, r, "signing in", err)
		return
	}
	switch o := outcome.(type) {
	case signInBanned:
		s.log(r).Warn("sign-in refused: banned", "provider", i.Provider, "account", s.accountOf(r, i))
		q := url.Values{"signin": {signinBanned}}
		switch end := o.end.(type) {
		case store.Permanent:
		case store.Until:
			q.Set("until", end.At.UTC().Format(time.DateOnly))
		}
		s.redirectPage(w, r, q)
	case signInBlocked:
		s.log(r).Warn("sign-in refused: its account deleted within the block", "provider", i.Provider)
		s.redirectPage(w, r, url.Values{"signin": {signinBlocked}, "until": {o.free.UTC().Format(time.DateOnly)}})
	case signInKnown:
		if err := s.newSession(w, r, o.account, now); err != nil {
			s.fail(w, r, "starting a session", err)
			return
		}
		name := ""
		if a, err := s.Store.Account(ctx, o.account); err == nil {
			name = a.Name
		}
		whoOf(r).signedIn(o.account, name)
		s.log(r).Info("signed in", "provider", i.Provider)
		s.redirectPage(w, r, nil)
	case signInNew:
		if open, err := s.Store.OpenSignups(ctx, now); err != nil || open >= s.limits.OpenSignups {
			if err != nil {
				s.log(r).Error("counting sign-ups", "err", err)
			}
			s.log(r).Warn("sign-in refused: too many sign-ups under way", "provider", i.Provider)
			s.redirectPage(w, r, url.Values{"signin": {signinBusy}})
			return
		}
		tok := token()
		p := store.Pending{
			TokenHash: digest(tok), Provider: i.Provider, Subject: i.Subject,
			Suggestion: names.Suggest(s.persona(ctx, i)), ExpiresAt: now.Add(SignupTTL),
		}
		if err := s.Store.CreatePending(ctx, p); err != nil {
			s.fail(w, r, "storing a sign-up", err)
			return
		}
		setCookie(w, signupCookie, tok, SignupTTL)
		s.log(r).Info("a new sign-in: its sign-up next", "provider", i.Provider)
		s.redirectPage(w, r, url.Values{"signup": {""}})
	}
}

// accountOf: the identity's account id for the log ("" for none, or unread)
func (s *Server) accountOf(r *http.Request, i store.Identity) string {
	account, _, err := s.Store.AccountByIdentity(r.Context(), i.Provider, i.Subject)
	if err != nil {
		return ""
	}
	return account
}

// persona: a Steam identity's persona name (a suggestion only, untrusted), "" for Google's (we never ask for a name)
func (s *Server) persona(ctx context.Context, i store.Identity) string {
	switch i.Provider {
	case store.Google:
		return ""
	case store.Steam:
		if s.SteamNames == nil {
			return ""
		}
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return s.SteamNames.Persona(ctx, i.Subject)
	}
	return ""
}

// fail: the server's own trouble, logged; the page told only that it failed
func (s *Server) fail(w http.ResponseWriter, r *http.Request, doing string, err error) {
	s.log(r).Error(doing, "err", err)
	s.redirectPage(w, r, url.Values{"signin": {signinFailed}})
}

// newSession signs the browser in to the account (a session it had before ended first)
func (s *Server) newSession(w http.ResponseWriter, r *http.Request, accountID string, now time.Time) error {
	if old := cookie(r, sessionCookie); old != "" {
		if err := s.Store.DeleteSession(r.Context(), digest(old)); err != nil {
			return err
		}
	}
	tok := token()
	if err := s.Store.CreateSession(r.Context(), digest(tok), accountID, now, now.Add(SessionTTL)); err != nil {
		return err
	}
	setCookie(w, sessionCookie, tok, SessionTTL)
	return nil
}

// pending is the sign-up this browser's cookie names
func (s *Server) pending(r *http.Request) (store.Pending, bool, error) {
	tok := cookie(r, signupCookie)
	if tok == "" {
		return store.Pending{}, false, nil
	}
	return s.Store.PendingSignup(r.Context(), digest(tok), s.Now())
}

// signupInfo: what the sign-up screen shows (the provider, the suggested name, the Turnstile widget's site key)
func (s *Server) signupInfo(w http.ResponseWriter, r *http.Request) {
	p, ok, err := s.pending(r)
	if err != nil {
		s.log(r).Error("reading a sign-up", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no-signup")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"provider": p.Provider, "suggestion": p.Suggestion, "turnstileSiteKey": s.TurnstileSiteKey,
		"nameMaxBytes": names.MaxBytes,
	})
}

// signup makes the account: the name checked, Turnstile passed (AC-16), then the store's checks again in one transaction
func (s *Server) signup(w http.ResponseWriter, r *http.Request) {
	ctx, now := r.Context(), s.Now()
	if !s.allowAddress(r, now, s.signups, s.signupsWide) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	p, ok, err := s.pending(r)
	if err != nil {
		s.log(r).Error("reading a sign-up", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no-signup")
		return
	}
	var body struct {
		Name      string `json:"name"`
		Turnstile string `json:"turnstile"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	name, err := names.Clean(body.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, nameError(err))
		return
	}
	if s.Turnstile != nil {
		if err := s.Turnstile.Verify(ctx, body.Turnstile, "signup"); err != nil {
			s.log(r).Warn("sign-up's turnstile refused", "err", err)
			writeError(w, http.StatusForbidden, "turnstile")
			return
		}
	}
	i := store.Identity{Provider: p.Provider, Subject: p.Subject}
	account, err := s.Store.CreateAccount(ctx, p, name, s.subjectHMAC(i), now, now.Add(-RecreateBlock))
	var banned store.BannedError
	var blocked store.RecreateError
	switch {
	case errors.Is(err, store.ErrPendingGone):
		writeError(w, http.StatusNotFound, "no-signup")
		return
	case errors.As(err, &banned):
		writeError(w, http.StatusForbidden, "banned")
		return
	case errors.As(err, &blocked):
		writeError(w, http.StatusForbidden, "blocked")
		return
	case errors.Is(err, store.ErrIdentityTaken):
		writeError(w, http.StatusConflict, "taken")
		return
	case err != nil:
		s.log(r).Error("making an account", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	clearCookie(w, signupCookie)
	if err := s.newSession(w, r, account, now); err != nil {
		s.log(r).Error("starting a session", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	whoOf(r).signedIn(account, name)
	s.log(r).Info("signed up: account made", "provider", p.Provider)
	s.writeAccount(w, r, http.StatusCreated, account)
}

func nameError(err error) string {
	if errors.Is(err, names.ErrTooLong) {
		return "name-too-long"
	}
	return "name-empty"
}
