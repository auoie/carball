//go:build !e2e

package server_test

import (
	"net/http"
	"testing"
)

// The release build has no browser tests' sign-in (internal/server/e2e.go, the e2e build's alone)
func TestNoE2ESignIn(t *testing.T) {
	e := setup(t, nil)
	if resp := e.write(e.browser(), http.MethodPost, "/api/e2e/sign-in", map[string]string{"subject": "e2e-1", "name": "Made_Up_Racer"}); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("POST /api/e2e/sign-in: %d, want 404", resp.StatusCode)
	}
}
