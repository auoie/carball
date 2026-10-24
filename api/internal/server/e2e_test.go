//go:build e2e

package server_test

import (
	"bytes"
	"context"
	"net/http"
	"testing"

	"carball/api/internal/server"
)

// The browser tests' sign-in (the e2e build): an account named as asked, this browser signed in to it, once per subject,
// a write's guards its own
func TestE2ESignIn(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	resp := e.write(b, http.MethodPost, server.E2ERoute, map[string]string{"subject": "e2e-1", "name": "Made-Up Racer"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sign-in: %d %s", resp.StatusCode, resp.Body)
	}
	account, _ := decode(t, resp)["account"].(string)
	me := decode(t, e.get(b, "/api/me"))
	if me["id"] != account || me["name"] != "Made-Up Racer" {
		t.Fatalf("/api/me %v, want the account %q named as asked", me, account)
	}
	if again := e.write(e.browser(), http.MethodPost, server.E2ERoute, map[string]string{"subject": "e2e-1", "name": "Another"}); again.StatusCode != http.StatusConflict {
		t.Fatalf("the same subject again: %d, want 409", again.StatusCode)
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
