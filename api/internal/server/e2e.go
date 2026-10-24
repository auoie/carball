//go:build e2e

package server

import (
	"errors"
	"net/http"

	"carball/api/internal/names"
	"carball/api/internal/store"
)

// The browser tests' sign-in, in the `e2e` build alone (the Dockerfile's api-e2e image, never deployed; the release
// binary has no such route, which the image checks look for): POST /api/e2e/sign-in {"subject", "name"} makes the
// account a provider's callback and the sign-up screen would (a Google identity of that subject, named so) and signs
// this browser in to it; its id answered. A write as the page's (Origin, the custom header), no rate limit: the tests'
// pages share one address

// E2ERoute is the route's path, the image checks' marker
const E2ERoute = "/api/e2e/sign-in"

func (s *Server) e2eRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST "+E2ERoute, s.write(s.e2eSignIn))
}

func (s *Server) e2eSignIn(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Subject string `json:"subject"`
		Name    string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	name, err := names.Clean(body.Name)
	if err != nil || body.Subject == "" {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	ctx, now := r.Context(), s.Now()
	p := store.Pending{TokenHash: digest(token()), Provider: store.Google, Subject: body.Subject, Suggestion: name, ExpiresAt: now.Add(SignupTTL)}
	if err := s.Store.CreatePending(ctx, p); err != nil {
		s.log(r).Error("e2e: storing a sign-up", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	account, err := s.Store.CreateAccount(ctx, p, name, s.subjectHMAC(store.Identity{Provider: p.Provider, Subject: p.Subject}), now, now.Add(-RecreateBlock))
	if errors.Is(err, store.ErrIdentityTaken) {
		writeError(w, http.StatusConflict, "identity-taken")
		return
	} else if err != nil {
		s.log(r).Error("e2e: making an account", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	if err := s.newSession(w, r, account, now); err != nil {
		s.log(r).Error("e2e: a session", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	s.log(r).Info("e2e: signed in", "account", account, "name", name)
	writeJSON(w, http.StatusOK, map[string]string{"account": account})
}
