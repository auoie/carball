//go:build e2e

package server_test

import (
	"bytes"
	"context"
	"net/http"
	"testing"

	"carball/api/internal/server"
)

// The browser tests' sign-in (the e2e build): none outside --dev; under it an account named as asked, this browser signed
// in to it; the same subject again, the same account (a returning sign-in); a write's guards its own
func TestE2ESignIn(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	// (outside --dev: a 404, as the release build's, RV-1043)
	if resp := e.write(b, http.MethodPost, server.E2ERoute, map[string]string{"subject": "e2e-0", "name": "Not_Dev"}); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("without --dev: %d, want 404", resp.StatusCode)
	}
	if resp := e.write(b, http.MethodPost, server.E2ESignUpRoute, map[string]string{"subject": "e2e-0"}); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("the sign-up without --dev: %d, want 404", resp.StatusCode)
	}
	e.s.Dev = true
	resp := e.write(b, http.MethodPost, server.E2ERoute, map[string]string{"subject": "e2e-1", "name": "Made_Up_Racer"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sign-in: %d %s", resp.StatusCode, resp.Body)
	}
	account, _ := decode(t, resp)["account"].(string)
	me := decode(t, e.get(b, "/api/me"))
	if me["id"] != account || me["name"] != "Made_Up_Racer" {
		t.Fatalf("/api/me %v, want the account %q named as asked", me, account)
	}
	other := e.browser()
	again := e.write(other, http.MethodPost, server.E2ERoute, map[string]string{"subject": "e2e-1", "name": "Another"})
	if again.StatusCode != http.StatusOK || decode(t, again)["account"] != account {
		t.Fatalf("the same subject again: %d %s, want its account %q", again.StatusCode, again.Body, account)
	}
	if name := decode(t, e.get(other, "/api/me"))["name"]; name != "Made_Up_Racer" {
		t.Errorf("a returning sign-in renamed the account: %v", name)
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, e.srv.URL+server.E2ERoute, bytes.NewReader([]byte(`{"subject":"e2e-2","name":"Unguarded"}`)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if unguarded := e.do(e.browser(), req); unguarded.StatusCode != http.StatusForbidden {
		t.Fatalf("without the page's Origin and header: %d, want 403", unguarded.StatusCode)
	}
}

// The browser tests' sign-up (the e2e build): a new identity's sign-up left as a provider's callback leaves it, which
// the page's sign-up screen reads and finishes
func TestE2ESignUp(t *testing.T) {
	e := setup(t, nil)
	e.s.Dev = true
	b := e.browser()
	if resp := e.write(b, http.MethodPost, server.E2ESignUpRoute, map[string]string{"subject": "e2e-3", "suggestion": "Made Up"}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("sign-up: %d %s", resp.StatusCode, resp.Body)
	}
	if info := decode(t, e.get(b, "/api/signup")); info["suggestion"] != "Made_Up" {
		t.Fatalf("the sign-up's info: %v", info)
	}
	created := e.signUp(b, "Made_Up_Finisher")
	if e.meStatus(b) != http.StatusOK || created["name"] != "Made_Up_Finisher" {
		t.Fatalf("the sign-up finished: %v, /api/me %d", created, e.meStatus(b))
	}
}
