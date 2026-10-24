//go:build e2e

package server

import (
	"errors"
	"net/http"

	"carball/api/internal/names"
	"carball/api/internal/store"
)

// The browser tests' sign-in, in the `e2e` build alone (the Dockerfile's api-e2e image, never deployed; the release
// binary has no such route, which the image checks look for), standing for a provider's (a Google identity of the
// subject asked): POST /api/e2e/sign-in {"subject", "name"} signs this browser in to the identity's account, made as a
// sign-up makes one (named so) if it has none, its id answered; POST /api/e2e/sign-up {"subject", "suggestion"} leaves
// a new identity's sign-up as a provider's callback does (its cookie: the page's sign-up screen next, `/?signup`).
// Writes as the page's (Origin, the custom header), no rate limit: the tests' pages share one address. Under `serve
// --dev` alone (its origin localhost's, RV-1043): an e2e image run as a deployment's answers 404, never minting an account
// or claiming a subject for anyone

// E2ERoute is the sign-in's path, the image checks' marker (`/api/e2e/`)
const E2ERoute = "/api/e2e/sign-in"

// E2ESignUpRoute is the sign-up's path
const E2ESignUpRoute = "/api/e2e/sign-up"

func (s *Server) e2eRoutes(mux *http.ServeMux) {
	if s.Dev {
		s.Log.Warn("e2e build: the browser tests' sign-in is on (" + E2ERoute + ", " + E2ESignUpRoute + "): never a deployment's")
	} else {
		s.Log.Warn("e2e build without --dev: the browser tests' sign-in is off")
	}
	mux.HandleFunc("POST "+E2ERoute, s.devOnly(s.write(s.e2eSignIn)))
	mux.HandleFunc("POST "+E2ESignUpRoute, s.devOnly(s.write(s.e2eSignUp)))
}

// devOnly: the route under --dev alone, a 404 otherwise (as the release build's, which has none)
func (s *Server) devOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.Dev {
			http.NotFound(w, r)
			return
		}
		next(w, r)
	}
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
	account, found, err := s.Store.AccountByIdentity(ctx, store.Google, body.Subject)
	if err != nil {
		s.log(r).Error("e2e: reading an identity", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	if !found {
		p := store.Pending{TokenHash: digest(token()), Provider: store.Google, Subject: body.Subject, Suggestion: name, ExpiresAt: now.Add(SignupTTL)}
		if err := s.Store.CreatePending(ctx, p); err != nil {
			s.log(r).Error("e2e: storing a sign-up", "err", err)
			writeError(w, http.StatusInternalServerError, "server")
			return
		}
		account, err = s.Store.CreateAccount(ctx, p, name, s.subjectHMAC(store.Identity{Provider: p.Provider, Subject: p.Subject}), now, now.Add(-RecreateBlock))
		if errors.Is(err, store.ErrIdentityTaken) {
			writeError(w, http.StatusConflict, "identity-taken")
			return
		} else if err != nil {
			s.log(r).Error("e2e: making an account", "err", err)
			writeError(w, http.StatusInternalServerError, "server")
			return
		}
	}
	if err := s.newSession(w, r, account, now); err != nil {
		s.log(r).Error("e2e: a session", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	s.log(r).Info("e2e: signed in", "account", account, "new", !found)
	writeJSON(w, http.StatusOK, map[string]string{"account": account})
}

func (s *Server) e2eSignUp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Subject    string `json:"subject"`
		Suggestion string `json:"suggestion"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	if body.Subject == "" {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	tok, now := token(), s.Now()
	p := store.Pending{TokenHash: digest(tok), Provider: store.Google, Subject: body.Subject, Suggestion: names.Suggest(body.Suggestion), ExpiresAt: now.Add(SignupTTL)}
	if err := s.Store.CreatePending(r.Context(), p); err != nil {
		s.log(r).Error("e2e: storing a sign-up", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	setCookie(w, signupCookie, tok, SignupTTL)
	s.log(r).Info("e2e: a sign-up under way")
	w.WriteHeader(http.StatusNoContent)
}
