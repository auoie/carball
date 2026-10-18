package server

import (
	"errors"
	"net/http"
	"time"

	"carball/api/internal/names"
	"carball/api/internal/store"
)

// session is the browser's signed-in session, its token rotated when due (the old one honoured for RotateGrace: AC-8);
// a cookie that opens none is cleared
func (s *Server) session(w http.ResponseWriter, r *http.Request) (store.Session, bool) {
	tok := cookie(r, sessionCookie)
	if tok == "" {
		return store.Session{}, false
	}
	now := s.Now()
	ss, ok, err := s.Store.SessionByToken(r.Context(), digest(tok), now)
	if err != nil {
		s.Log.Error("reading a session", "err", err)
		return store.Session{}, false
	}
	if !ok {
		clearCookie(w, sessionCookie)
		return store.Session{}, false
	}
	if !ss.Previous && now.Sub(ss.RotatedAt) >= RotateEvery {
		next := token()
		rotated, err := s.Store.RotateSession(r.Context(), ss.TokenHash, digest(next), now, now.Add(RotateGrace))
		if err != nil {
			s.Log.Error("rotating a session", "err", err)
		} else if rotated {
			setCookie(w, sessionCookie, next, ss.ExpiresAt.Sub(now))
			ss.TokenHash = digest(next)
		}
	}
	return ss, true
}

// signedOut: the call needs a session
func signedOut(w http.ResponseWriter) {
	writeError(w, http.StatusUnauthorized, "signed-out")
}

func (s *Server) writeAccount(w http.ResponseWriter, r *http.Request, status int, id string) {
	a, err := s.Store.Account(r.Context(), id)
	if err != nil {
		s.Log.Error("reading an account", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	writeJSON(w, status, map[string]any{
		"id": a.ID, "name": a.Name, "providers": a.Providers, "createdAt": a.CreatedAt.UTC().Format(time.RFC3339),
	})
}

// me: the signed-in account (the page's account state), or 401
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		signedOut(w)
		return
	}
	s.writeAccount(w, r, http.StatusOK, ss.AccountID)
}

// rename: a new display name, under the name rules, a few a day (AC-14)
func (s *Server) rename(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		signedOut(w)
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad-request")
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
	if err := s.Store.Rename(r.Context(), ss.AccountID, name); err != nil {
		s.Log.Error("renaming", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	s.writeAccount(w, r, http.StatusOK, ss.AccountID)
}

// deleteAccount: gone at once, asked for in so many words ({"confirm": true}: AC-10); the identities kept out of a new
// account for RecreateBlock
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		signedOut(w)
		return
	}
	var body struct {
		Confirm bool `json:"confirm"`
	}
	if err := readJSON(r, &body); err != nil || !body.Confirm {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	err := s.Store.DeleteAccount(r.Context(), ss.AccountID, s.subjectHMAC, s.Now())
	if err != nil && !errors.Is(err, store.ErrNoAccount) {
		s.Log.Error("deleting an account", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	clearCookie(w, sessionCookie)
	s.Log.Info("account deleted")
	w.WriteHeader(http.StatusNoContent)
}

// signOut ends this browser's session (none is fine: signed out either way)
func (s *Server) signOut(w http.ResponseWriter, r *http.Request) {
	if tok := cookie(r, sessionCookie); tok != "" {
		if err := s.Store.DeleteSession(r.Context(), digest(tok)); err != nil {
			s.Log.Error("signing out", "err", err)
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
		signedOut(w)
		return
	}
	if err := s.Store.DeleteSessions(r.Context(), ss.AccountID); err != nil {
		s.Log.Error("signing out everywhere", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	clearCookie(w, sessionCookie)
	w.WriteHeader(http.StatusNoContent)
}
