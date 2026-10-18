package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func secret(t *testing.T, value string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(p, []byte(value), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func env(vars map[string]string) Env { return func(k string) string { return vars[k] } }

func good(t *testing.T) map[string]string {
	return map[string]string{
		"PUBLIC_ORIGIN":             "https://carball.example",
		"DATABASE_URL":              "postgres://carball_app@db:5432/carball",
		"DATABASE_PASSWORD_FILE":    secret(t, "pw\n"),
		"TURNSTILE_SITE_KEY":        "site-key",
		"TURNSTILE_SECRET_FILE":     secret(t, "turnstile-secret\n"),
		"DELETION_HMAC_KEY_FILE":    secret(t, strings.Repeat("k", 32)+"\n"),
		"GOOGLE_CLIENT_ID":          "client-id",
		"GOOGLE_CLIENT_SECRET_FILE": secret(t, "client-secret"),
	}
}

func TestLoad(t *testing.T) {
	c, err := Load(env(good(t)), false)
	if err != nil {
		t.Fatal(err)
	}
	if c.ListenAddr != ":8080" || c.TurnstileSecret != "turnstile-secret" || c.GoogleClientSecret != "client-secret" ||
		string(c.DeletionKey) != strings.Repeat("k", 32) {
		t.Errorf("Load = %+v", c)
	}
}

func TestLoadRefusals(t *testing.T) {
	for name, edit := range map[string]func(map[string]string){
		"a password in DATABASE_URL":         func(v map[string]string) { v["DATABASE_URL"] = "postgres://u:pw@db/carball" },
		"a password keyword in DATABASE_URL": func(v map[string]string) { v["DATABASE_URL"] = "host=db user=u password=pw" },
		"a password in the URL's query":      func(v map[string]string) { v["DATABASE_URL"] = "postgres://u@db/c?password=pw" },
		"no DATABASE_URL":                    func(v map[string]string) { delete(v, "DATABASE_URL") },
		"an http origin":                     func(v map[string]string) { v["PUBLIC_ORIGIN"] = "http://carball.example" },
		"an origin with a path":              func(v map[string]string) { v["PUBLIC_ORIGIN"] = "https://carball.example/x" },
		"no Turnstile secret":                func(v map[string]string) { delete(v, "TURNSTILE_SECRET_FILE") },
		"no Turnstile site key":              func(v map[string]string) { delete(v, "TURNSTILE_SITE_KEY") },
		"no deletion key":                    func(v map[string]string) { delete(v, "DELETION_HMAC_KEY_FILE") },
		"a short deletion key":               func(v map[string]string) { v["DELETION_HMAC_KEY_FILE"] = secret(t, "short") },
		"an empty secret file":               func(v map[string]string) { v["TURNSTILE_SECRET_FILE"] = secret(t, "\n") },
		"a missing secret file":              func(v map[string]string) { v["TURNSTILE_SECRET_FILE"] = "/nonexistent/secret" },
		"a Google id without its secret":     func(v map[string]string) { delete(v, "GOOGLE_CLIENT_SECRET_FILE") },
	} {
		vars := good(t)
		edit(vars)
		if _, err := Load(env(vars), false); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestLoadDev(t *testing.T) {
	vars := good(t)
	vars["PUBLIC_ORIGIN"] = "http://localhost:5173"
	delete(vars, "TURNSTILE_SECRET_FILE")
	delete(vars, "TURNSTILE_SITE_KEY")
	if _, err := Load(env(vars), true); err != nil {
		t.Errorf("development on localhost without Turnstile: %v", err)
	}
	vars["PUBLIC_ORIGIN"] = "http://carball.example"
	if _, err := Load(env(vars), true); err == nil {
		t.Error("development: an http origin off localhost accepted")
	}
}
