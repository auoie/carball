// Package config reads the service's settings from its environment (APP-CONTRACT.md "carball-api"): plain settings as
// variables, secrets from files (`*_FILE`: a variable's value shows in `docker inspect`, notes/accounts.md AC-17).
package config

import (
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strings"
)

// Config is everything the server takes from outside
type Config struct {
	// ListenAddr is the HTTP listener (the container's port; reached only by the tunnel, AC-4)
	ListenAddr string
	// HealthAddr is the health check's own listener, loopback only (not reachable through the tunnel: AP-6)
	HealthAddr string
	// TrustedProxies are the addresses whose CF-Connecting-IP is believed (cloudflared's: AP-1); from others, or with
	// none set, a request's address is its connection's
	TrustedProxies []netip.Prefix
	// PublicOrigin is the site's origin ("https://carball.zolt.top"): the Origin every write must carry, the redirect
	// URIs' and Steam's realm
	PublicOrigin string
	// DatabaseURL connects the least-privilege role (rows only: AC-18), its password from DatabasePasswordFile
	DatabaseURL          string
	DatabasePasswordFile string
	// MigrateDatabaseURL connects the schema's owner for `carball-api migrate`, a one-shot run of its own (the serving
	// container never holds the owner's password: AP-4)
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
	// TicketKeyID and TicketSeed sign the search tickets (AC-6: the game server checks them by the key's id); required
	// outside development
	TicketKeyID string
	TicketSeed  string
	// Dev is development mode (`--dev`): a localhost origin only (http or https), Turnstile optional (AP-7)
	Dev bool
}

// Env reads a variable; tests pass their own
type Env func(string) string

// Load reads the configuration from env, reading `*_FILE` secrets from disk
func Load(env Env, dev bool) (Config, error) {
	c := Config{
		ListenAddr:         or(env("LISTEN_ADDR"), ":8080"),
		HealthAddr:         or(env("HEALTH_ADDR"), "127.0.0.1:8081"),
		PublicOrigin:       strings.TrimSuffix(env("PUBLIC_ORIGIN"), "/"),
		DatabaseURL:        env("DATABASE_URL"),
		MigrateDatabaseURL: env("MIGRATE_DATABASE_URL"),
		GoogleClientID:     env("GOOGLE_CLIENT_ID"),
		TurnstileSiteKey:   env("TURNSTILE_SITE_KEY"),
		TicketKeyID:        env("TICKET_KEY_ID"),
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
	c.TicketSeed = read("TICKET_SIGNING_KEY_FILE", !dev)
	if (c.TicketKeyID == "") != (c.TicketSeed == "") {
		errs = append(errs, errors.New("TICKET_KEY_ID and TICKET_SIGNING_KEY_FILE go together"))
	}

	if err := checkOrigin(c.PublicOrigin, dev); err != nil {
		errs = append(errs, err)
	}
	proxies, err := parsePrefixes(env("TRUSTED_PROXIES"))
	if err != nil {
		errs = append(errs, fmt.Errorf("TRUSTED_PROXIES: %w", err))
	} else if len(proxies) == 0 && !dev {
		// (behind the tunnel, unset, every user would share the connector's address: one rate-limit key for all)
		errs = append(errs, errors.New("TRUSTED_PROXIES is required: the tunnel connector's address as the API sees it "+
			"(127.0.0.1/32,::1/128 when cloudflared shares the host's network; its Docker network's subnet, e.g. 172.18.0.0/16, when it's a container)"))
	}
	c.TrustedProxies = proxies
	if !isLoopback(c.HealthAddr) {
		errs = append(errs, fmt.Errorf("HEALTH_ADDR must be a loopback address (127.0.0.1:PORT), got %q", c.HealthAddr))
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

// checkOrigin: https with a host and nothing after it; with --dev, a localhost origin and no other (http allowed): a
// development server's Turnstile is optional, so --dev can never serve a public site (AP-7)
func checkOrigin(origin string, dev bool) error {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return fmt.Errorf("PUBLIC_ORIGIN must be SCHEME://HOST[:PORT], got %q", origin)
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"
	switch {
	case dev && !local:
		return fmt.Errorf("--dev serves a localhost origin only, got %q", origin)
	case u.Scheme != "https" && (!dev || u.Scheme != "http"):
		return fmt.Errorf("PUBLIC_ORIGIN must be https (http on localhost only with --dev), got %q", origin)
	}
	return nil
}

// passwordKey: a keyword string's password, however spaced (`password=x`, `password = x`: AP-14)
var passwordKey = regexp.MustCompile(`(?i)(^|\s)password\s*=`)

// hasPassword: a URL (postgres://user:password@…) or keyword string (password=…) naming a password
func hasPassword(dsn string) bool {
	if u, err := url.Parse(dsn); err == nil && u.Scheme != "" {
		_, set := u.User.Password()
		return set || u.Query().Has("password")
	}
	return passwordKey.MatchString(dsn)
}

// parsePrefixes: comma-separated CIDRs or single addresses
func parsePrefixes(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for item := range strings.SplitSeq(list, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if !strings.Contains(item, "/") {
			addr, err := netip.ParseAddr(item)
			if err != nil {
				return nil, err
			}
			out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
			continue
		}
		p, err := netip.ParsePrefix(item)
		if err != nil {
			return nil, err
		}
		out = append(out, p.Masked())
	}
	return out, nil
}

// Hostname is an origin's host, no port: Turnstile's hostname check (siteverify names the page's: AC-16)
func Hostname(origin string) string {
	u, err := url.Parse(origin)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// isLoopback: HOST:PORT with a loopback HOST
func isLoopback(addr string) bool {
	ap, err := netip.ParseAddrPort(addr)
	return err == nil && ap.Addr().IsLoopback()
}

func or(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
