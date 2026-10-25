package server_test

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// Name moderation at the API: a sign-up's name the word filter refuses is a 400 name-not-allowed (the sign-up still
// waiting for a name); an admin's lock refuses the player's renames with 403 rename-locked and the lock's seconds left,
// until it ends; every rename recorded, the admin's with who and why
func TestNameModeration(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-mod")
	resp := e.write(b, http.MethodPost, "/api/signup", map[string]string{"name": "xXFuckXx", "turnstile": "good-token"})
	if v := decode(t, resp); resp.StatusCode != http.StatusBadRequest || v["error"] != "name-not-allowed" {
		t.Fatalf("a sign-up's refused name: %d %v", resp.StatusCode, v)
	}
	id := e.signUp(b, "Fine Name")["id"].(string)

	ctx := context.Background()
	now := e.clock.Now()
	if _, err := e.db.AdminRename(ctx, id, "Player-1234", "Mod", "made up", now.Add(48*time.Hour), now); err != nil {
		t.Fatal(err)
	}
	resp = e.write(b, http.MethodPut, "/api/me/name", map[string]string{"name": "Back Again"})
	v := decode(t, resp)
	if resp.StatusCode != http.StatusForbidden || v["error"] != "rename-locked" || v["seconds"] != float64(48*3600) {
		t.Fatalf("a rename while locked: %d %v", resp.StatusCode, v)
	}
	e.clock.Add(48 * time.Hour)
	if resp := e.write(b, http.MethodPut, "/api/me/name", map[string]string{"name": "Back Again"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("a rename after the lock: %d %v", resp.StatusCode, decode(t, resp))
	}
	history, err := e.db.NameChanges(ctx, id)
	if err != nil || len(history) != 2 || history[0].New != "Back Again" || history[0].By != "" || history[1].By != "Mod" {
		t.Fatalf("the history: %+v, %v", history, err)
	}
}
