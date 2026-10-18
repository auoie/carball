// carball-api: Carball's accounts service (notes/accounts.md, APP-CONTRACT.md "carball-api"). The server by default;
// the admin's commands against the same database (bans: notes/accounts.md §4, question 13), run on the box:
//
//	carball-api [serve] [--dev]                 the HTTP server (and its health check's, on HEALTH_ADDR)
//	carball-api migrate [--dev]                 the migrations, a one-shot run as the schema's owner (MIGRATE_DATABASE_URL)
//	carball-api accounts NAME                   the accounts whose name contains NAME, with their identities
//	carball-api ban (--account ID | --identity PROVIDER:SUBJECT) --reason TEXT --by NAME [--for DURATION | --until DATE]
//	carball-api unban (--account ID | --identity PROVIDER:SUBJECT)
//	carball-api bans                            the bans in force
//	carball-api healthcheck                     the container's check: GET /healthz on HEALTH_ADDR
//	carball-api ticket-key KID                  a new ticket key: its seed (TICKET_SIGNING_KEY_FILE's) on stdout, its
//	                                            public line (the game server's TICKET_PUBLIC_KEYS) on stderr
package main

import (
	"context"
	"crypto/ed25519"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
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
	"carball/api/internal/ticket"
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
		err = migrate(args)
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
	case "ticket-key":
		err = ticketKey(args)
	default:
		err = fmt.Errorf("unknown command %q (serve, migrate, accounts, ban, unban, bans, healthcheck, ticket-key)", command)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "carball-api:", err)
		os.Exit(1)
	}
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	dev := fs.Bool("dev", false, "development: a localhost origin only, Turnstile optional")
	_ = fs.Parse(args)
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cfg, err := config.Load(os.Getenv, *dev)
	if err != nil {
		return err
	}
	// (the ticket key read first: a bad one stops the start before the database is waited for, AP2-12)
	var signer *ticket.Signer
	var ticketKeys map[string]ed25519.PublicKey
	if cfg.TicketKeyID != "" {
		if signer, err = ticket.NewSigner(cfg.TicketKeyID, cfg.TicketSeed); err != nil {
			return fmt.Errorf("TICKET_SIGNING_KEY_FILE: %w", err)
		}
		if ticketKeys, err = ticket.ParsePublic(cfg.TicketPreviousKeys); err != nil {
			return fmt.Errorf("TICKET_PREVIOUS_KEYS: %w", err)
		}
		ticketKeys[signer.KeyID] = signer.PublicKey()
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	db, err := openWithRetry(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer db.Close()
	// (the service's role rows only: one that could change the schema is a deployment's mistake, AP-4)
	can, err := db.CanCreate(ctx)
	if err != nil {
		return fmt.Errorf("checking the service's role: %w", err)
	}
	if err := roleRefusal(can, cfg.Dev); err != nil {
		return err
	} else if can {
		log.Warn("development: the service's role may create in the schema")
	}
	// (whose CF-Connecting-IP is believed: the tunnel's connector; a wrong one shows as noteForward's warning)
	proxies := make([]string, len(cfg.TrustedProxies))
	for i, p := range cfg.TrustedProxies {
		proxies[i] = p.String()
	}
	log.Info("trusted proxies (CF-Connecting-IP believed from)", "proxies", strings.Join(proxies, ","))

	// (every outbound call bounded: AC-15)
	client := &http.Client{Timeout: 10 * time.Second}
	s := &server.Server{
		Store:            db,
		Origin:           cfg.PublicOrigin,
		Steam:            &steam.Verifier{Endpoint: steam.Endpoint, Client: client, Nonces: db, Now: time.Now},
		TurnstileSiteKey: cfg.TurnstileSiteKey,
		DeletionKey:      cfg.DeletionKey,
		TrustedProxies:   cfg.TrustedProxies,
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
	s.Tickets, s.TicketKeys = signer, ticketKeys
	if signer != nil {
		log.Info("search tickets signed", "key", signer.Public())
	} else {
		log.Warn("development: no ticket key, no search tickets")
	}
	if cfg.GameServerToken != "" {
		s.GameServerToken = []byte(cfg.GameServerToken)
	} else {
		log.Warn("GAME_SERVER_TOKEN_FILE not set: the game server's results and quitters refused (503)")
	}
	if cfg.TurnstileSecret != "" {
		s.Turnstile = &turnstile.Verifier{Secret: cfg.TurnstileSecret, Hostname: config.Hostname(cfg.PublicOrigin), Client: client, URL: turnstile.SiteverifyURL}
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
	// (the health check on its own loopback listener: not reachable through the tunnel, AP-6)
	healthServer := &http.Server{Addr: cfg.HealthAddr, Handler: s.HealthHandler(), ReadHeaderTimeout: 2 * time.Second}
	go housekeeping(ctx, db, s, log)
	errs := make(chan error, 2)
	go func() { errs <- httpServer.ListenAndServe() }()
	go func() { errs <- healthServer.ListenAndServe() }()
	log.Info("carball-api listening", "addr", cfg.ListenAddr, "health", cfg.HealthAddr, "origin", cfg.PublicOrigin, "dev", cfg.Dev)
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = healthServer.Shutdown(shutdown)
	return httpServer.Shutdown(shutdown)
}

// roleRefusal: a role that may create in the schema refused outside development (AP-4)
func roleRefusal(canCreate, dev bool) error {
	if canCreate && !dev {
		return errors.New("DATABASE_URL's role may create in the schema: give the service a role of its own, rows only (carball-api migrate grants it)")
	}
	return nil
}

// openWithRetry connects the database, trying again for a minute while it isn't up yet (a container started beside it:
// AP-24), then giving up
func openWithRetry(ctx context.Context, cfg config.Config, log *slog.Logger) (*store.Store, error) {
	deadline := time.Now().Add(time.Minute)
	for wait := time.Second; ; wait = min(2*wait, 8*time.Second) {
		db, err := store.Open(ctx, cfg.DatabaseURL, cfg.DatabasePasswordFile)
		if err == nil || time.Now().Add(wait).After(deadline) {
			return db, err
		}
		log.Warn("the database isn't answering yet; trying again", "in", wait.String())
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
	}
}

// housekeeping: the limits' idle keys forgotten every minute; what's run out purged hourly (expired sessions daily at
// least: notes/accounts.md, question 7)
func housekeeping(ctx context.Context, db *store.Store, s *server.Server, log *slog.Logger) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	var purged time.Time
	for {
		now := time.Now()
		if now.Sub(purged) >= time.Hour {
			if err := db.PurgeRanked(ctx, now.Add(-server.ResultsKept), now.Add(-server.AcceptWindow-time.Hour)); err != nil && ctx.Err() == nil {
				log.Error("purging results and used tickets", "err", err)
			}
			if err := db.Purge(ctx, now, now.Add(-server.RecreateBlock)); err != nil && ctx.Err() == nil {
				log.Error("purging", "err", err)
			} else {
				purged = now
			}
		}
		s.Sweep(now)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// migrate: the schema brought up to date, a one-shot run as its owner (MIGRATE_DATABASE_URL), the service's role
// (DATABASE_URL's) granted its rows; the serving container never holds the owner's password (AP-4). `--dev` allows one
// role for both (a development database)
func migrate(args []string) error {
	fs := flag.NewFlagSet("migrate", flag.ExitOnError)
	dev := fs.Bool("dev", false, "development: one role for both URLs")
	_ = fs.Parse(args)
	owner := os.Getenv("MIGRATE_DATABASE_URL")
	if owner == "" {
		return errors.New("MIGRATE_DATABASE_URL is required")
	}
	role, err := store.AppRole(os.Getenv("DATABASE_URL"))
	if err != nil || role == "" {
		return errors.New("DATABASE_URL (the service's role, granted its rows) is required")
	}
	return store.Migrate(context.Background(), owner, os.Getenv("MIGRATE_DATABASE_PASSWORD_FILE"), role, *dev)
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

// healthcheck: the image's HEALTHCHECK (no curl or wget in it): the health listener's GET /healthz (HEALTH_ADDR)
func healthcheck() error {
	addr := os.Getenv("HEALTH_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	ap, err := netip.ParseAddrPort(addr)
	if err != nil || !ap.Addr().IsLoopback() {
		return fmt.Errorf("HEALTH_ADDR must be a loopback HOST:PORT, got %q", addr)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// (G704 below: a loopback address, checked above, the service's own)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+ap.String()+"/healthz", nil) //nolint:gosec
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

// ticketKey makes a ticket key (notes/accounts.md §6: its rotation, a new id added to the game server's list first, then
// the API switched, the old id dropped once its tickets have run out): the seed alone on stdout (to a file kept secret),
// the public line for TICKET_PUBLIC_KEYS on stderr
func ticketKey(args []string) error {
	if len(args) != 1 {
		return errors.New("ticket-key KID (an id of 1-32 characters, no spaces)")
	}
	seed, public, err := ticket.NewKey(args[0])
	if err != nil {
		return err
	}
	fmt.Println(seed)
	fmt.Fprintln(os.Stderr, public)
	return nil
}
