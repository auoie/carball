// Package config reads the service's settings from its environment (APP-CONTRACT.md "carball-api"): plain settings as
// variables, secrets from files (`*_FILE`: a variable's value shows in `docker inspect`, notes/accounts.md AC-17).
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Config is everything the server takes from outside
type Config struct {
	// ListenAddr is the HTTP listener (the container's port; reached only by the tunnel, AC-4)
	ListenAddr string
	// PublicOrigin is the site's origin ("https://carball.zolt.top"): the Origin every write must carry, the redirect
	// URIs' and Steam's realm
	PublicOrigin string
	// DatabaseURL connects the least-privilege role (rows only: AC-18), its password from DatabasePasswordFile
	DatabaseURL          string
	DatabasePasswordFile string
	// MigrateDatabaseURL, when set, connects the schema's owner at start to run the migrations (AC-18)
	MigrateDatabaseURL          string
	MigrateDatabasePasswordFile string
	// Google sign-in, on when both are set
	GoogleClientID     string
	GoogleClientSecret string
	// SteamWebAPIKey, optional: the persona name as a sign-up's suggested name (GetPlayerSummaries)
	SteamWebAPIKey string
	// Turnstile on sign-up (AC-16): its site key is public (the page's widget), its secret a file. Both required
	// outside development
	TurnstileSiteKey string
	TurnstileSecret  string
	// DeletionKey keys the delete/re-create rule's hashes (AC-24): 32 bytes or more
	DeletionKey []byte
	// Dev is development mode (`--dev`): an http origin on localhost allowed, Turnstile optional
	Dev bool
}

// Env reads a variable; tests pass their own
type Env func(string) string

// Load reads the configuration from env, reading `*_FILE` secrets from disk
func Load(env Env, dev bool) (Config, error) {
	c := Config{
		ListenAddr:         or(env("LISTEN_ADDR"), ":8080"),
		PublicOrigin:       strings.TrimSuffix(env("PUBLIC_ORIGIN"), "/"),
		DatabaseURL:        env("DATABASE_URL"),
		MigrateDatabaseURL: env("MIGRATE_DATABASE_URL"),
		GoogleClientID:     env("GOOGLE_CLIENT_ID"),
		TurnstileSiteKey:   env("TURNSTILE_SITE_KEY"),
		Dev:                dev,

		DatabasePasswordFile:        env("DATABASE_PASSWORD_FILE"),
		MigrateDatabasePasswordFile: env("MIGRATE_DATABASE_PASSWORD_FILE"),
	}
	var errs []error
	read := func(name string, required bool) string {
		path := env(name)
		if path == "" {
			if required {
				errs = append(errs, fmt.Errorf("%s is required", name))
			}
			return ""
		}
		v, err := ReadSecret(path)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
		}
		return v
	}
	c.GoogleClientSecret = read("GOOGLE_CLIENT_SECRET_FILE", false)
	c.SteamWebAPIKey = read("STEAM_WEB_API_KEY_FILE", false)
	c.TurnstileSecret = read("TURNSTILE_SECRET_FILE", !dev)
	c.DeletionKey = []byte(read("DELETION_HMAC_KEY_FILE", true))

	if err := checkOrigin(c.PublicOrigin, dev); err != nil {
		errs = append(errs, err)
	}
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	} else if hasPassword(c.DatabaseURL) {
		errs = append(errs, errors.New("DATABASE_URL must not hold a password: DATABASE_PASSWORD_FILE"))
	}
	if hasPassword(c.MigrateDatabaseURL) {
		errs = append(errs, errors.New("MIGRATE_DATABASE_URL must not hold a password: MIGRATE_DATABASE_PASSWORD_FILE"))
	}
	if (c.GoogleClientID == "") != (c.GoogleClientSecret == "") {
		errs = append(errs, errors.New("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET_FILE go together"))
	}
	if !dev && c.TurnstileSiteKey == "" {
		errs = append(errs, errors.New("TURNSTILE_SITE_KEY is required"))
	}
	if len(c.DeletionKey) > 0 && len(c.DeletionKey) < 32 {
		errs = append(errs, errors.New("DELETION_HMAC_KEY_FILE must hold 32 bytes or more"))
	}
	return c, errors.Join(errs...)
}

// ReadSecret reads a secret's file, its trailing newline dropped (a file written by `echo` keeps one)
func ReadSecret(path string) (string, error) {
	b, err := os.ReadFile(path) //nolint:gosec // (G304: the operator names the file; reading it is the point)
	if err != nil {
		return "", err
	}
	v := strings.TrimRight(string(b), "\r\n")
	if v == "" {
		return "", errors.New("empty")
	}
	return v, nil
}

// checkOrigin: https with a host and nothing after it; in development, http on localhost as well
func checkOrigin(origin string, dev bool) error {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return fmt.Errorf("PUBLIC_ORIGIN must be SCHEME://HOST[:PORT], got %q", origin)
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"
	if allowed := u.Scheme == "https" || (dev && local && u.Scheme == "http"); !allowed {
		return fmt.Errorf("PUBLIC_ORIGIN must be https (http on localhost only with --dev), got %q", origin)
	}
	return nil
}

// hasPassword: a URL (postgres://user:password@…) or keyword string (password=…) naming a password
func hasPassword(dsn string) bool {
	if u, err := url.Parse(dsn); err == nil && u.Scheme != "" {
		_, set := u.User.Password()
		return set || u.Query().Has("password")
	}
	for field := range strings.FieldsSeq(dsn) {
		if strings.HasPrefix(field, "password=") {
			return true
		}
	}
	return false
}

func or(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
