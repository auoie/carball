package server

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"carball/api/internal/names"
	"carball/api/internal/ranked"
	"carball/api/internal/store"
)

// session is the browser's signed-in session, its token rotated when due (the old one honoured for RotateGrace: AC-8).
// None: answered here (401 signed out, the cookie cleared if it opened none; 503 when the database doesn't answer, never
// taken for signed out: AP-22)
func (s *Server) session(w http.ResponseWriter, r *http.Request) (store.Session, bool) {
	return s.sessionOf(w, r, true)
}

// sessionOf: the request's session, rotated when due if `rotate` (not for a search's long poll: its answer, and the new
// cookie with it, may never reach the page, a poll aborted by Cancel Search or the page going, and the old token would
// then lapse with its grace: RV-889)
func (s *Server) sessionOf(w http.ResponseWriter, r *http.Request, rotate bool) (store.Session, bool) {
	tok := cookie(r, sessionCookie)
	if tok == "" {
		signedOut(w)
		return store.Session{}, false
	}
	now := s.Now()
	ss, ok, err := s.Store.SessionByToken(r.Context(), digest(tok), now)
	if err != nil {
		s.log(r).Error("reading a session", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return store.Session{}, false
	}
	if !ok {
		clearCookie(w, sessionCookie)
		signedOut(w)
		return store.Session{}, false
	}
	if rotate && !ss.Previous && now.Sub(ss.RotatedAt) >= RotateEvery {
		next := token()
		rotated, err := s.Store.RotateSession(r.Context(), ss.TokenHash, digest(next), now, now.Add(RotateGrace))
		if err != nil {
			s.log(r).Error("rotating a session", "err", err)
		} else if rotated {
			setCookie(w, sessionCookie, next, ss.ExpiresAt.Sub(now))
			ss.TokenHash = digest(next)
		}
	}
	whoOf(r).signedIn(ss.AccountID, ss.AccountName)
	return ss, true
}

// signedOut: the call needs a session
func signedOut(w http.ResponseWriter) {
	writeError(w, http.StatusUnauthorized, "signed-out")
}

func (s *Server) writeAccount(w http.ResponseWriter, r *http.Request, status int, id string) {
	a, err := s.Store.Account(r.Context(), id)
	if err != nil {
		s.log(r).Error("reading an account", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	ratings, err := s.Store.RatingsOf(r.Context(), id)
	if err != nil {
		s.log(r).Error("reading ratings", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	body := map[string]any{
		"id": a.ID, "name": a.Name, "providers": a.Providers, "createdAt": a.CreatedAt.UTC().Format(time.RFC3339),
		"ratings": shownRatings(ratings, s.Now()),
	}
	ban, banned, err := s.Store.QueueBanOf(r.Context(), id)
	if err != nil {
		s.log(r).Error("reading a queue ban", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	if until, on := ranked.BannedUntil(ban, banned, s.Now()); on {
		// (seconds left, not its end: the page's clock never ours, RV-1001, as the cooldown's RV-983)
		body["queueBanSeconds"] = secondsUntil(until, s.Now())
	}
	// (a no-show's cooldown (a match it stalled): its seconds left, the Play page's line as the ban's, its end taken on
	// the page's own clock (an absolute time would be off by the clocks' difference, RV-983)
	if s.Matchmaker != nil {
		if until, on := s.Matchmaker.CooldownOf(id, s.Now()); on {
			body["searchCooldownSeconds"] = secondsUntil(until, s.Now())
		}
	}
	writeJSON(w, status, body)
}

// me: the signed-in account (the page's account state), or 401
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	s.writeAccount(w, r, http.StatusOK, ss.AccountID)
}

// rename: a new display name, under the name rules, a few a day (AC-14)
func (s *Server) rename(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
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
	if !s.renames.Allow(ss.AccountID, s.Now()) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	now := s.Now()
	var locked store.RenameLockedError
	if err := s.Store.Rename(r.Context(), ss.AccountID, name, now); errors.As(err, &locked) {
		// (an admin's lock: its seconds left, its end on the page's clock as a ban's, RV-1001)
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "rename-locked", "seconds": secondsUntil(locked.Until, now)})
		return
	} else if err != nil {
		s.log(r).Error("renaming", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	s.log(r).Info("renamed", "to", name)
	s.writeAccount(w, r, http.StatusOK, ss.AccountID)
}

// deleteAccount: gone at once, asked for in so many words ({"confirm": true}: AC-10); the identities kept out of a new
// account for RecreateBlock
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Confirm bool `json:"confirm"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	if !body.Confirm {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	err := s.Store.DeleteAccount(r.Context(), ss.AccountID, s.subjectHMAC, s.Now())
	if err != nil && !errors.Is(err, store.ErrNoAccount) {
		s.log(r).Error("deleting an account", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	clearCookie(w, sessionCookie)
	s.log(r).Info("account deleted")
	w.WriteHeader(http.StatusNoContent)
}

// signOut ends this browser's session (none is fine: signed out either way)
func (s *Server) signOut(w http.ResponseWriter, r *http.Request) {
	if tok := cookie(r, sessionCookie); tok != "" {
		if err := s.Store.DeleteSession(r.Context(), digest(tok)); err != nil {
			s.log(r).Error("signing out", "err", err)
			writeError(w, http.StatusInternalServerError, "server")
			return
		}
	}
	clearCookie(w, sessionCookie)
	w.WriteHeader(http.StatusNoContent)
}

// signOutEverywhere ends every session of the account
func (s *Server) signOutEverywhere(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	if err := s.Store.DeleteSessions(r.Context(), ss.AccountID); err != nil {
		s.log(r).Error("signing out everywhere", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	clearCookie(w, sessionCookie)
	w.WriteHeader(http.StatusNoContent)
}

// ticket: a rejoin's ticket for the signed-in account (AC-6), `?rejoin=MATCH` (16 hex digits): its id and display name,
// for that match alone, two minutes, a fresh nonce, signed for the game server to check offline; a few a minute per
// account (AC-26). A banned account has no session to ask with; a queue ban from that same match doesn't stop it (LV1:
// the leaver may come back and refill the lobby, which undoes the ban; AP3). A match's own tickets are the matchmaker's
// (a seat each: internal/matchmaker)
func (s *Server) ticket(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	if s.Tickets == nil {
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	// (a rejoin's ticket, for its match: the search's own tickets are the matchmaker's now)
	q := r.URL.Query()
	match, err := strconv.ParseUint(q.Get("rejoin"), 16, 64)
	if err != nil || match == 0 || len(q.Get("rejoin")) != 16 {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	now := s.Now()
	if !s.tickets.Allow(ss.AccountID, now) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	a, err := s.Store.Account(r.Context(), ss.AccountID)
	if err != nil {
		s.log(r).Error("reading an account", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	// (a leaver's queue ban in force: no search, the page told until when, LV1)
	ban, banned, err := s.Store.QueueBanOf(r.Context(), ss.AccountID)
	if err != nil {
		s.log(r).Error("reading a queue ban", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	if until, on := ranked.BannedUntil(ban, banned, now); on && ban.Match != matchText(match) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "queue-banned", "seconds": secondsUntil(until, now)})
		return
	}
	// (a rejoin of its own match alone: not while it searches or is in another, one at a time)
	if s.Matchmaker != nil && !s.Matchmaker.RejoinAllowed(ss.AccountID, match) {
		writeError(w, http.StatusConflict, "in-match")
		return
	}
	ratings, err := s.Store.RatingsOf(r.Context(), ss.AccountID)
	if err != nil {
		s.log(r).Error("reading ratings", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	id, err := accountBytes(a.ID)
	if err != nil {
		s.log(r).Error("an account's id", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	encoded, t, err := s.Tickets.IssueRejoin(id, a.Name, ranked.TicketRatings(ratings, now), match, now)
	if err != nil {
		s.log(r).Error("signing a ticket", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ticket": encoded, "expiresAt": t.Expires.UTC().Format(time.RFC3339)})
}

// accountBytes: an account's id (a UUID's text) as its 16 bytes
func accountBytes(id string) ([16]byte, error) {
	var out [16]byte
	raw, err := hex.DecodeString(strings.ReplaceAll(id, "-", ""))
	if err != nil || len(raw) != 16 {
		return out, fmt.Errorf("not a UUID: %q", id)
	}
	copy(out[:], raw)
	return out, nil
}
