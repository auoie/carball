// carball-api: Carball's accounts service (notes/accounts.md, APP-CONTRACT.md "carball-api"). The server by default;
// the admin's commands against the same database (bans: notes/accounts.md §4, question 13), run on the box:
//
//	carball-api [serve] [--dev]                 the HTTP server (migrations first, when MIGRATE_DATABASE_URL is set)
//	carball-api migrate                         the migrations alone (MIGRATE_DATABASE_URL)
//	carball-api accounts NAME                   the accounts whose name contains NAME, with their identities
//	carball-api ban (--account ID | --identity PROVIDER:SUBJECT) --reason TEXT --by NAME [--for DURATION | --until DATE]
//	carball-api unban (--account ID | --identity PROVIDER:SUBJECT)
//	carball-api bans                            the bans in force
//	carball-api healthcheck                     the container's check: GET /api/healthz on LISTEN_ADDR
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	// (the root certificates built in, for an image without a system bundle: Google, Steam and Cloudflare are https)
	_ "golang.org/x/crypto/x509roots/fallback"

	"carball/api/internal/config"
	"carball/api/internal/google"
	"carball/api/internal/server"
	"carball/api/internal/steam"
	"carball/api/internal/store"
	"carball/api/internal/turnstile"
)

func main() {
	args := os.Args[1:]
	command := "serve"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command, args = args[0], args[1:]
	}
	var err error
	switch command {
	case "serve":
		err = serve(args)
	case "migrate":
		err = migrate()
	case "accounts":
		err = accounts(args)
	case "ban":
		err = ban(args)
	case "unban":
		err = unban(args)
	case "bans":
		err = bans()
	case "healthcheck":
		err = healthcheck()
	default:
		err = fmt.Errorf("unknown command %q (serve, migrate, accounts, ban, unban, bans, healthcheck)", command)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "carball-api:", err)
		os.Exit(1)
	}
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	dev := fs.Bool("dev", false, "development: an http origin on localhost allowed, Turnstile optional")
	_ = fs.Parse(args)
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cfg, err := config.Load(os.Getenv, *dev)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if cfg.MigrateDatabaseURL != "" {
		if err := runMigrations(ctx, cfg); err != nil {
			return err
		}
	}
	db, err := store.Open(ctx, cfg.DatabaseURL, cfg.DatabasePasswordFile)
	if err != nil {
		return err
	}
	defer db.Close()

	// (every outbound call bounded: AC-15)
	client := &http.Client{Timeout: 10 * time.Second}
	s := &server.Server{
		Store:            db,
		Origin:           cfg.PublicOrigin,
		Steam:            &steam.Verifier{Endpoint: steam.Endpoint, Client: client, Nonces: db, Now: time.Now},
		TurnstileSiteKey: cfg.TurnstileSiteKey,
		DeletionKey:      cfg.DeletionKey,
		Now:              time.Now,
		Log:              log,
	}
	if cfg.GoogleClientID != "" {
		s.Google = &google.Client{
			ClientID: cfg.GoogleClientID, ClientSecret: cfg.GoogleClientSecret,
			RedirectURL: cfg.PublicOrigin + "/api/auth/google/callback", Issuer: google.Issuer, HTTP: client,
		}
	} else {
		log.Warn("Google sign-in off: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET_FILE not set")
	}
	if cfg.SteamWebAPIKey != "" {
		s.SteamNames = &steam.Names{Key: cfg.SteamWebAPIKey, Client: client, URL: steam.SummariesURL}
	}
	if cfg.TurnstileSecret != "" {
		host := strings.TrimPrefix(strings.TrimPrefix(cfg.PublicOrigin, "https://"), "http://")
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		s.Turnstile = &turnstile.Verifier{Secret: cfg.TurnstileSecret, Hostname: host, Client: client, URL: turnstile.SiteverifyURL}
	} else {
		log.Warn("development: sign-ups without Turnstile")
	}
	httpServer := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	go housekeeping(ctx, db, s, log)
	errs := make(chan error, 1)
	go func() { errs <- httpServer.ListenAndServe() }()
	log.Info("carball-api listening", "addr", cfg.ListenAddr, "origin", cfg.PublicOrigin, "dev", cfg.Dev)
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdown)
}

// housekeeping: what's run out purged (expired sessions daily at least: notes/accounts.md, question 7), the limits'
// idle keys forgotten; hourly
func housekeeping(ctx context.Context, db *store.Store, s *server.Server, log *slog.Logger) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		now := time.Now()
		if err := db.Purge(ctx, now, now.Add(-server.RecreateBlock)); err != nil && ctx.Err() == nil {
			log.Error("purging", "err", err)
		}
		s.Sweep(now)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func runMigrations(ctx context.Context, cfg config.Config) error {
	role, err := store.AppRole(cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("DATABASE_URL: %w", err)
	}
	return store.Migrate(ctx, cfg.MigrateDatabaseURL, cfg.MigrateDatabasePasswordFile, role)
}

func migrate() error {
	cfg := config.Config{
		DatabaseURL:                 os.Getenv("DATABASE_URL"),
		MigrateDatabaseURL:          os.Getenv("MIGRATE_DATABASE_URL"),
		MigrateDatabasePasswordFile: os.Getenv("MIGRATE_DATABASE_PASSWORD_FILE"),
	}
	if cfg.MigrateDatabaseURL == "" {
		return errors.New("MIGRATE_DATABASE_URL is required")
	}
	return runMigrations(context.Background(), cfg)
}

// --- The admin's commands ---

func openStore() (*store.Store, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	return store.Open(context.Background(), dsn, os.Getenv("DATABASE_PASSWORD_FILE"))
}

func accounts(args []string) error {
	if len(args) != 1 {
		return errors.New("accounts NAME")
	}
	db, err := openStore()
	if err != nil {
		return err
	}
	defer db.Close()
	found, err := db.FindAccounts(context.Background(), args[0])
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "ACCOUNT\tNAME\tCREATED\tIDENTITIES")
	for _, f := range found {
		var ids []string
		for _, i := range f.Identities {
			ids = append(ids, string(i.Provider)+":"+i.Subject)
		}
		_, _ = fmt.Fprintf(w, "%s\t%q\t%s\t%s\n", f.ID, f.Name, f.CreatedAt.UTC().Format(time.DateOnly), strings.Join(ids, " "))
	}
	return w.Flush()
}

// target: --account ID or --identity PROVIDER:SUBJECT, one of them
type target struct {
	account, identity string
}

func (t *target) flags(fs *flag.FlagSet) {
	fs.StringVar(&t.account, "account", "", "the account's id (every identity of it)")
	fs.StringVar(&t.identity, "identity", "", "PROVIDER:SUBJECT (google:<sub>, steam:<SteamID64>; its account's too)")
}

func (t *target) parse() (store.Identity, error) {
	if (t.account == "") == (t.identity == "") {
		return store.Identity{}, errors.New("one of --account or --identity")
	}
	if t.account != "" {
		return store.Identity{}, nil
	}
	name, subject, ok := strings.Cut(t.identity, ":")
	provider, known := store.ParseProvider(name)
	if !ok || !known || subject == "" {
		return store.Identity{}, errors.New("--identity is PROVIDER:SUBJECT, the provider google or steam")
	}
	return store.Identity{Provider: provider, Subject: subject}, nil
}

func ban(args []string) error {
	fs := flag.NewFlagSet("ban", flag.ExitOnError)
	var t target
	t.flags(fs)
	reason := fs.String("reason", "", "why (kept with the ban)")
	by := fs.String("by", "", "who bans (kept with the ban)")
	length := fs.Duration("for", 0, "how long (e.g. 72h); none: no end")
	untilDate := fs.String("until", "", "the end, a date (YYYY-MM-DD, UTC) or RFC 3339 time")
	_ = fs.Parse(args)
	identity, err := t.parse()
	if err != nil {
		return err
	}
	if *reason == "" || *by == "" {
		return errors.New("--reason and --by are required")
	}
	end, err := banEnd(*length, *untilDate, time.Now())
	if err != nil {
		return err
	}
	db, err := openStore()
	if err != nil {
		return err
	}
	defer db.Close()
	var banned []store.Identity
	if t.account != "" {
		banned, err = db.BanAccount(context.Background(), t.account, *reason, *by, end, time.Now())
	} else {
		banned, err = db.BanIdentity(context.Background(), identity, *reason, *by, end, time.Now())
	}
	if err != nil {
		return err
	}
	for _, i := range banned {
		fmt.Printf("banned %s:%s (%s); signed out everywhere\n", i.Provider, i.Subject, describe(end))
	}
	return nil
}

func banEnd(length time.Duration, date string, now time.Time) (store.BanEnd, error) {
	switch {
	case length != 0 && date != "":
		return nil, errors.New("--for or --until, not both")
	case length < 0:
		return nil, errors.New("--for must be positive")
	case length > 0:
		return store.Until{At: now.Add(length)}, nil
	case date == "":
		return store.Permanent{}, nil
	}
	if t, err := time.Parse(time.DateOnly, date); err == nil {
		return store.Until{At: t}, nil
	}
	t, err := time.Parse(time.RFC3339, date)
	if err != nil {
		return nil, errors.New("--until is YYYY-MM-DD or an RFC 3339 time")
	}
	return store.Until{At: t}, nil
}

// describe a ban's end for the admin
func describe(end store.BanEnd) string {
	switch e := end.(type) {
	case store.Permanent:
		return "no end"
	case store.Until:
		return "until " + e.At.UTC().Format(time.RFC3339)
	}
	return "?"
}

func unban(args []string) error {
	fs := flag.NewFlagSet("unban", flag.ExitOnError)
	var t target
	t.flags(fs)
	_ = fs.Parse(args)
	identity, err := t.parse()
	if err != nil {
		return err
	}
	db, err := openStore()
	if err != nil {
		return err
	}
	defer db.Close()
	var n int64
	if t.account != "" {
		n, err = db.UnbanAccount(context.Background(), t.account)
	} else {
		n, err = db.Unban(context.Background(), identity)
	}
	if err != nil {
		return err
	}
	fmt.Printf("%d ban(s) lifted\n", n)
	return nil
}

func bans() error {
	db, err := openStore()
	if err != nil {
		return err
	}
	defer db.Close()
	list, err := db.Bans(context.Background(), time.Now())
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "IDENTITY\tUNTIL\tBY\tSINCE\tREASON")
	for _, b := range list {
		_, _ = fmt.Fprintf(w, "%s:%s\t%s\t%s\t%s\t%q\n", b.Provider, b.Subject, describe(b.End), b.By, b.Created.UTC().Format(time.DateOnly), b.Reason)
	}
	return w.Flush()
}

// healthcheck: the image's HEALTHCHECK (no curl or wget in it): the server's /api/healthz on its own port
func healthcheck() error {
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("LISTEN_ADDR: %w", err)
	}
	n, err := strconv.ParseUint(port, 10, 16)
	if err != nil {
		return fmt.Errorf("LISTEN_ADDR's port: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// (G704 below: the request goes to 127.0.0.1 alone, the port a number from the service's own setting)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/api/healthz", n), nil) //nolint:gosec
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req) //nolint:gosec
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}
