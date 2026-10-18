package turnstile

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fake siteverify: Cloudflare's answer for a token, a token answered once (a second check fails as a duplicate)
func fake(t *testing.T, hostname, action string) (*Verifier, *map[string]bool) {
	t.Helper()
	seen := map[string]bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		token := r.PostForm.Get("response")
		ok := r.PostForm.Get("secret") == "the-secret" && strings.HasPrefix(token, "good") && !seen[token]
		seen[token] = true
		_ = json.NewEncoder(w).Encode(map[string]any{"success": ok, "hostname": hostname, "action": action})
	}))
	t.Cleanup(srv.Close)
	return &Verifier{Secret: "the-secret", Hostname: "carball.example", Client: srv.Client(), URL: srv.URL}, &seen
}

func TestVerify(t *testing.T) {
	v, _ := fake(t, "carball.example", "signup")
	if err := v.Verify(context.Background(), "good-1", "signup"); err != nil {
		t.Fatalf("a good token: %v", err)
	}
	if err := v.Verify(context.Background(), "good-1", "signup"); !errors.Is(err, ErrFailed) {
		t.Errorf("the same token again: %v, want ErrFailed", err)
	}
	if err := v.Verify(context.Background(), "bad", "signup"); !errors.Is(err, ErrFailed) {
		t.Errorf("a failed challenge: %v", err)
	}
	if err := v.Verify(context.Background(), "", "signup"); !errors.Is(err, ErrFailed) {
		t.Errorf("no token: %v", err)
	}
	if err := v.Verify(context.Background(), "good-"+strings.Repeat("x", 2048), "signup"); !errors.Is(err, ErrFailed) {
		t.Errorf("a token over 2048 characters: %v", err)
	}
}

func TestVerifyHostnameAndAction(t *testing.T) {
	v, _ := fake(t, "evil.example", "signup")
	if err := v.Verify(context.Background(), "good-1", "signup"); !errors.Is(err, ErrHostname) {
		t.Errorf("another hostname's token: %v", err)
	}
	v, _ = fake(t, "carball.example", "login")
	if err := v.Verify(context.Background(), "good-1", "signup"); !errors.Is(err, ErrAction) {
		t.Errorf("another action's token: %v", err)
	}
}
