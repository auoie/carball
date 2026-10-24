// carball-api: Carball's accounts service (notes/accounts.md, APP-CONTRACT.md "carball-api"). The server by default;
// the admin's commands against the same database (bans: notes/accounts.md §4, question 13), run on the box:
//
//	carball-api help (or -h, --help)            these commands; carball-api COMMAND -h: a command's flags
//	carball-api [serve] [--dev]                 the HTTP server (and its health check's, on HEALTH_ADDR)
//	carball-api migrate [--dev]                 the migrations, a one-shot run as the schema's owner (MIGRATE_DATABASE_URL)
//	carball-api matchmaker --dev [--listen A]   development: the matchmaker alone, no database (the browser tests')
//	carball-api accounts NAME | --recent [N]    the accounts whose name contains NAME, or the N newest, with their
//	                                            identities and when last seen (their latest session: to a day)
//	carball-api ban (--account ID | --identity PROVIDER:SUBJECT) --reason TEXT --by NAME [--for DURATION | --until DATE]
//	carball-api unban (--account ID | --identity PROVIDER:SUBJECT)
//	carball-api bans                            the bans in force
//	carball-api stats | matches --recent [N] | account ID | ratings --top [N] [--playlist P] | queue-bans
//	                                            the live app's reports (read-only; each one's -h)
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
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"
	"unicode/utf8"

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
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// command is one of the CLI's commands: its name, its arguments and what it does (its help line), and its run (`out`
// where its -h prints its flags)
type command struct {
	name, args, about string
	run               func(args []string, out io.Writer) error
}

// commands: the CLI's, in the help's order (serve when none is named)
func commands() []command {
	return []command{
		{"serve", "[--dev]", "the HTTP server (and its health check's, on HEALTH_ADDR); the default", serve},
		{"migrate", "[--dev]", "the migrations, a one-shot run as the schema's owner (MIGRATE_DATABASE_URL)", migrate},
		{"matchmaker", "--dev [--listen 127.0.0.1:8090]", "development: the matchmaker alone, no database or sign-in, on " +
			"loopback, its match tickets signed with the development key (only a --dev game server takes them; the browser " +
			"tests' and a development page's)", matchmakerDev},
		{"accounts", "NAME | --recent [N]", "the accounts whose name contains NAME, or the N newest (20 by default), newest " +
			"first, with their identities and when last seen: the latest session's sign-in or daily renewal (so to within " +
			"a day; none once its sessions have ended, after 90 days)", accounts},
		{"ban", "(--account ID | --identity PROVIDER:SUBJECT [--no-account]) --reason TEXT --by NAME [--for DURATION | --until DATE] [--replace]",
			"a ban: an account's every identity, or one identity's account; signed out everywhere. An identity no account " +
				"has signed in with is refused unless --no-account (then it bans that identity alone, and an identity " +
				"with an account is refused), and so is a ban in force on any of them unless --replace (the bans it " +
				"replaced printed)", ban},
		{"unban", "(--account ID | --identity PROVIDER:SUBJECT)", "the bans lifted (a subject stored by an older version " +
			"without its checks lifted as given: one bans shows quoted is typed as the shell's $'...', e.g. --identity " +
			"$'steam:7656119000000001 ')", unban},
		{"bans", "", "the bans in force", bans},
		{"stats", "", "the live app at a glance: accounts (new today, in the last 7 days, in all), ranked matches today and in " +
			"the week by playlist, the bans and leave bans in force", stats},
		{"matches", "--recent [N]", "the latest ranked results (20 by default), newest first: their time, playlist, each " +
			"team's players, the winner and who left", matches},
		{"account", "ID", "one account: its name, created, last seen, identities, rating in each playlist (\"?\" while " +
			"provisional, as the page shows it), any ban, its leave ban's step and end, and its last 10 matches", account},
		{"ratings", "--top [N] [--playlist 1v1|2v2|3v3]", "a playlist's leaderboard (1v1, the top 20 by default) by the " +
			"rating as shown, provisional ones marked \"?\"", ratingsBoard},
		{"queue-bans", "", "the leave bans in force: account, name, ladder step, until when", queueBans},
		{"healthcheck", "", "the container's check: GET /healthz on HEALTH_ADDR", healthcheck},
		{"ticket-key", "KID", "a new ticket key: its seed (TICKET_SIGNING_KEY_FILE's) on stdout, its public line (the game " +
			"server's TICKET_PUBLIC_KEYS) on stderr", ticketKey},
	}
}

// usage: the commands, one line each with its arguments (each one's -h: what it does), and where the admin runs them
func usage(out io.Writer) {
	_, _ = fmt.Fprintln(out, "usage: carball-api COMMAND [ARGUMENTS]   (serve when none)")
	_, _ = fmt.Fprintln(out)
	for _, c := range commands() {
		_, _ = fmt.Fprintf(out, "  carball-api %s\n", strings.TrimSpace(c.name+" "+c.args))
	}
	_, _ = fmt.Fprintln(out)
	_, _ = fmt.Fprintln(out, "carball-api COMMAND -h: what it does and its flags.")
	_, _ = fmt.Fprintln(out)
	_, _ = fmt.Fprintln(out, "The admin's commands run in the service's container, with its environment and database, e.g.:")
	_, _ = fmt.Fprintln(out, "  docker exec carball-api /app/carball-api bans")
}

// helpWord: an argument asking for the help
func helpWord(arg string) bool {
	return arg == "help" || arg == "-h" || arg == "-help" || arg == "--help"
}

// loadTicketKeys: the signer of the key `keyID` (its seed, base64) and the keys tickets are checked with: its own and
// the previous ones (TICKET_PREVIOUS_KEYS, by the game server's rules: ticket.ParsePublic), none of them its id (a
// previous key silently taking the signer's place would refuse its every ticket: RV-948)
func loadTicketKeys(keyID, seed, previous string) (*ticket.Signer, map[string]ed25519.PublicKey, error) {
	signer, err := ticket.NewSigner(keyID, seed)
	if err != nil {
		return nil, nil, fmt.Errorf("TICKET_SIGNING_KEY_FILE: %w", err)
	}
	keys, err := ticket.ParsePublic(previous)
	if err != nil {
		return nil, nil, fmt.Errorf("TICKET_PREVIOUS_KEYS: %w", err)
	}
	if _, taken := keys[signer.KeyID]; taken {
		return nil, nil, fmt.Errorf("TICKET_PREVIOUS_KEYS lists the signing key's id %q (TICKET_KEY_ID): a previous key has its own", signer.KeyID)
	}
	keys[signer.KeyID] = signer.PublicKey()
	return signer, keys, nil
}

// run runs the command the arguments name (serve when the first is a flag or none); its exit status
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) > 0 && helpWord(args[0]) {
		usage(stdout)
		return 0
	}
	// (no arguments: the image's own start, its ENTRYPOINT naming no command; anything else names its command first, so
	// `--dev bans` or `-- bans` serves nothing: RX34)
	if len(args) == 0 {
		args = []string{"serve"}
	}
	name := args[0]
	args = args[1:]
	if strings.HasPrefix(name, "-") {
		_, _ = fmt.Fprintf(stderr, "carball-api: %q: name the command first (carball-api serve %s; carball-api help)\n", name, name)
		return 1
	}
	for _, c := range commands() {
		if c.name != name {
			continue
		}
		// (ticket-key's stdout is its seed, kept for a file: its usage on stderr, RX35)
		help := stdout
		if c.name == "ticket-key" {
			help = stderr
		}
		err := c.run(args, help)
		switch {
		case errors.Is(err, flag.ErrHelp):
			return 0
		case err != nil:
			_, _ = fmt.Fprintln(stderr, "carball-api:", err)
			return 1
		}
		return 0
	}
	_, _ = fmt.Fprintf(stderr, "carball-api: unknown command %q\n\n", name)
	usage(stderr)
	return 1
}

// flagsFor: a command's flag set, read by parseArgs (silent: its errors returned, its usage printed for help alone)
func flagsFor(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.Usage = func() {}
	return fs
}

// printUsage: a command's line, what it does and its flags
func printUsage(fs *flag.FlagSet, out io.Writer) {
	for _, c := range commands() {
		if c.name == fs.Name() {
			_, _ = fmt.Fprintf(out, "usage: carball-api %s\n  %s\n", strings.TrimSpace(c.name+" "+c.args), c.about)
		}
	}
	fs.SetOutput(out)
	fs.PrintDefaults()
	fs.SetOutput(io.Discard)
}

// flagScan is what the arguments before `--` show: a help word among them (not as a flag's value: `--by -h` is a value,
// refused as one), a flag given twice (`--account A1 … --account A2`: refused, not the last taken, RX35), and the flags
// given as --name=value (a value that may start with "-")
type flagScan struct {
	help     bool
	repeated string
	inline   map[string]bool
}

func scanFlags(fs *flag.FlagSet, args []string) flagScan {
	scan := flagScan{inline: map[string]bool{}}
	seen := map[string]bool{}
	for i := 0; i < len(args); i++ {
		if helpWord(args[i]) {
			scan.help = true
			continue
		}
		name, isFlag := strings.CutPrefix(args[i], "-")
		if !isFlag || name == "" {
			continue
		}
		name, _, inline := strings.Cut(strings.TrimPrefix(name, "-"), "=")
		f := fs.Lookup(name)
		if f == nil {
			continue
		}
		if seen[name] && scan.repeated == "" {
			scan.repeated = name
		}
		seen[name] = true
		if inline {
			scan.inline[name] = true
		} else if b, ok := f.Value.(interface{ IsBoolFlag() bool }); !ok || !b.IsBoolFlag() {
			i++ // (its value next)
		}
	}
	return scan
}

// parseArgs reads a command's arguments and refuses whatever it can't be sure of before anything runs (the admin's
// commands run on the live database, RX34): a help word anywhere before `--` (help, -h, -help, --help) prints its usage
// to out and runs nothing (flag.ErrHelp); its flags are read wherever they come; a flag's value that looks like a flag
// (`--by -h`, a value forgotten) is refused; fewer than `least` or more than `most` other arguments are refused
// (`--reason cheating and smurfing --for 72h`: quote a value with spaces). The words after `--` are arguments as they are
func parseArgs(fs *flag.FlagSet, args []string, out io.Writer, least, most int) ([]string, error) {
	head, tail := args, []string(nil)
	if i := slices.Index(args, "--"); i >= 0 {
		head, tail = args[:i], args[i+1:]
	}
	scan := scanFlags(fs, head)
	if scan.help {
		printUsage(fs, out)
		return nil, flag.ErrHelp
	}
	if scan.repeated != "" {
		return nil, fmt.Errorf("--%s given twice (carball-api %s -h)", scan.repeated, fs.Name())
	}
	var rest []string
	for {
		if err := fs.Parse(head); err != nil {
			return nil, fmt.Errorf("%w (carball-api %s -h)", err, fs.Name())
		}
		head = fs.Args()
		if len(head) == 0 {
			break
		}
		rest, head = append(rest, head[0]), head[1:]
	}
	rest = append(rest, tail...)
	var flagLike error
	fs.Visit(func(f *flag.Flag) {
		if v := f.Value.String(); flagLike == nil && strings.HasPrefix(v, "-") && !scan.inline[f.Name] {
			flagLike = fmt.Errorf("--%s %q looks like a flag, not its value (a value starting with \"-\": --%s=%s; carball-api %s -h)",
				f.Name, v, f.Name, v, fs.Name())
		}
	})
	switch {
	case flagLike != nil:
		return nil, flagLike
	case len(rest) > most:
		return nil, fmt.Errorf("unexpected argument %q (quote a value with spaces; carball-api %s -h)", rest[most], fs.Name())
	case len(rest) < least:
		return nil, fmt.Errorf("an argument missing (carball-api %s -h)", fs.Name())
	}
	return rest, nil
}

func serve(args []string, out io.Writer) error {
	fs := flagsFor("serve")
	dev := fs.Bool("dev", false, "development: a localhost origin only, Turnstile optional")
	if _, err := parseArgs(fs, args, out, 0, 0); err != nil {
		return err
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cfg, err := config.Load(os.Getenv, *dev)
	if err != nil {
		return err
	}
	// (the ticket key read first: a bad one stops the start before the database is waited for, AP2-12)
	var signer *ticket.Signer
	var ticketKeys map[string]ed25519.PublicKey
	if cfg.TicketKeyID != "" {
		if signer, ticketKeys, err = loadTicketKeys(cfg.TicketKeyID, cfg.TicketSeed, cfg.TicketPreviousKeys); err != nil {
			return err
		}
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
		log.Info("tickets signed", "key", signer.Public())
	} else {
		log.Warn("development: no ticket key, no tickets")
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
	go s.NewMatchmaker().Run(ctx)
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

// matchmakerDev: the development matchmaker (notes/matchmaking.md, the central matchmaker), on a loopback address alone
func matchmakerDev(args []string, out io.Writer) error {
	fs := flagsFor("matchmaker")
	dev := fs.Bool("dev", false, "development (required: the only way it runs)")
	listen := fs.String("listen", "127.0.0.1:8090", "the loopback address it listens on")
	if _, err := parseArgs(fs, args, out, 0, 0); err != nil {
		return err
	}
	if !*dev {
		return errors.New("the matchmaker alone is development only: carball-api matchmaker --dev")
	}
	host, _, err := net.SplitHostPort(*listen)
	if ip, perr := netip.ParseAddr(host); err != nil || perr != nil || !ip.IsLoopback() {
		return fmt.Errorf("--listen %q: a loopback address and port (127.0.0.1:PORT)", *listen)
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	s := &server.Server{Tickets: ticket.DevSigner(), Now: time.Now, Log: log}
	s.SetLimits(server.DefaultLimits())
	go s.NewMatchmaker().Run(ctx)
	httpServer := &http.Server{Addr: *listen, Handler: s.DevHandler(), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second}
	errs := make(chan error, 1)
	go func() { errs <- httpServer.ListenAndServe() }()
	log.Info("development matchmaker listening", "addr", *listen, "key", s.Tickets.Public())
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
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

// rankedCutoffs: the results received before the first are a year old; the used tickets issued before the second are
// past the acceptance window, and an hour more (one older is refused anyway, so it can't count twice: AC-22)
func rankedCutoffs(now time.Time) (resultsBefore, ticketsBefore time.Time) {
	return now.Add(-server.ResultsKept), now.Add(-server.AcceptWindow - time.Hour)
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
			results, tickets := rankedCutoffs(now)
			if err := db.PurgeRanked(ctx, results, tickets); err != nil && ctx.Err() == nil {
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
func migrate(args []string, out io.Writer) error {
	fs := flagsFor("migrate")
	dev := fs.Bool("dev", false, "development: one role for both URLs")
	if _, err := parseArgs(fs, args, out, 0, 0); err != nil {
		return err
	}
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

// openStore connects an admin's command: read-only for the reports, accounts and bans; time-limited for all (RX35)
func openStore(readOnly bool) (*store.Store, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	return store.OpenAdmin(context.Background(), dsn, os.Getenv("DATABASE_PASSWORD_FILE"), readOnly)
}

func accounts(args []string, out io.Writer) error {
	fs := flagsFor("accounts")
	recent := fs.Bool("recent", false, "the newest accounts instead of a name: N of them after it (20 by default, 1000 at most)")
	rest, err := parseArgs(fs, args, out, 0, 1)
	if err != nil {
		return err
	}
	// (the arguments checked before the database is opened: a typo runs nothing)
	var find func(*store.Store) ([]store.Found, error)
	switch {
	case *recent:
		n, err := recentCount(rest)
		if err != nil {
			return err
		}
		find = func(db *store.Store) ([]store.Found, error) { return db.RecentAccounts(context.Background(), n) }
	case len(rest) == 1:
		find = func(db *store.Store) ([]store.Found, error) { return db.FindAccounts(context.Background(), rest[0]) }
	default:
		return errors.New("accounts NAME (a part of the name) or accounts --recent [N] (carball-api accounts -h)")
	}
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	found, err := find(db)
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "ACCOUNT\tNAME\tCREATED\tLAST SEEN\tIDENTITIES")
	for _, f := range found {
		var ids []string
		for _, i := range f.Identities {
			ids = append(ids, string(i.Provider)+":"+i.Subject)
		}
		seen := "-"
		if f.LastSeen != nil {
			seen = f.LastSeen.UTC().Format(time.DateOnly)
		}
		_, _ = fmt.Fprintf(w, "%s\t%q\t%s\t%s\t%s\n", f.ID, f.Name, f.CreatedAt.UTC().Format(time.DateOnly), seen, strings.Join(ids, " "))
	}
	return w.Flush()
}

// recentCount: --recent's N (20 when none), 1 to 1000
func recentCount(args []string) (int, error) {
	switch len(args) {
	case 0:
		return 20, nil
	case 1:
		if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 && n <= 1000 {
			return n, nil
		}
	}
	return 0, errors.New("accounts --recent [N]: N a count from 1 to 1000")
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
		if !accountID.MatchString(t.account) {
			return store.Identity{}, errors.New("--account is an account's id, as accounts lists it")
		}
		return store.Identity{}, nil
	}
	name, subject, ok := strings.Cut(t.identity, ":")
	provider, known := store.ParseProvider(name)
	if !ok || !known || subject == "" {
		return store.Identity{}, errors.New("--identity is PROVIDER:SUBJECT, the provider google or steam")
	}
	// (a pasted space, a newline, an invisible or a look-alike character, a wrong length: refused before the database;
	// both providers' subjects are printable ASCII: RV-781, RV-810)
	if !plain(subject) {
		return store.Identity{}, fmt.Errorf("--identity's subject %q has a space, a control or invisible character, or one outside ASCII", subject)
	}
	if provider == store.Steam && !steamID.MatchString(subject) {
		return store.Identity{}, fmt.Errorf("--identity steam:%q: a Steam subject is a SteamID64, 17 digits", subject)
	}
	if len(subject) > 255 {
		return store.Identity{}, errors.New("--identity's subject is longer than any provider's (255)")
	}
	return store.Identity{Provider: provider, Subject: subject}, nil
}

// asGiven: --identity's provider and subject exactly as given, unchecked but for the provider's name and a subject
// (unban's: a ban stored by an older version without the checks)
func (t *target) asGiven() (store.Identity, bool) {
	if t.account != "" {
		return store.Identity{}, false
	}
	name, subject, ok := strings.Cut(t.identity, ":")
	provider, known := store.ParseProvider(name)
	if !ok || !known || subject == "" || !utf8.ValidString(subject) {
		return store.Identity{}, false
	}
	return store.Identity{Provider: provider, Subject: subject}, true
}

// plain: printable ASCII with no space, quote or backslash, every provider's subject (printed as it is)
func plain(subject string) bool {
	return subject != "" && !strings.ContainsFunc(subject, func(r rune) bool { return r <= ' ' || r > '~' || r == '"' || r == '\\' })
}

// shown: an identity as the admin commands print it, its subject quoted (Go's escapes) unless plain: an older version's
// stored subject (a trailing space, a newline, a tab) seen for what it is (RV-809)
func shown(provider store.Provider, subject string) string {
	if plain(subject) {
		return string(provider) + ":" + subject
	}
	return string(provider) + ":" + strconv.Quote(subject)
}

// steamID: a SteamID64, the Steam subject
var steamID = regexp.MustCompile(`^[0-9]{17}$`)

func ban(args []string, out io.Writer) error {
	fs := flagsFor("ban")
	var t target
	t.flags(fs)
	reason := fs.String("reason", "", "why (kept with the ban)")
	by := fs.String("by", "", "who bans (kept with the ban)")
	length := fs.Duration("for", 0, "how long (e.g. 72h); none: no end")
	untilDate := fs.String("until", "", "the end, a date (YYYY-MM-DD, UTC) or RFC 3339 time")
	replace := fs.Bool("replace", false, "replace a ban in force on any of its identities (each one replaced printed)")
	noAccount := fs.Bool("no-account", false, "with --identity: ban an identity no account has signed in with (a deleted account's, a throwaway's)")
	if _, err := parseArgs(fs, args, out, 0, 0); err != nil {
		return err
	}
	identity, err := t.parse()
	if err != nil {
		return err
	}
	if *reason == "" || *by == "" {
		return errors.New("--reason and --by are required")
	}
	if *noAccount && t.account != "" {
		return errors.New("--no-account goes with --identity (an account's ban has its identities)")
	}
	given := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { given[f.Name] = true })
	end, err := banEnd(*length, given["for"], *untilDate, given["until"], time.Now())
	if err != nil {
		return err
	}
	db, err := openStore(false)
	if err != nil {
		return err
	}
	defer db.Close()
	var banned store.Banned
	switch {
	case t.account != "":
		banned, err = db.BanAccount(context.Background(), t.account, *reason, *by, end, *replace, time.Now())
	case *noAccount:
		banned, err = db.BanNoAccount(context.Background(), identity, *reason, *by, end, *replace, time.Now())
	default:
		banned, err = db.BanIdentity(context.Background(), identity, *reason, *by, end, *replace, time.Now())
	}
	var held store.AlreadyBannedError
	var has store.HasAccountError
	switch {
	case errors.As(err, &has):
		return fmt.Errorf("account %s has signed in with %s: nothing banned (ban it without --no-account)", has.Account, shown(identity.Provider, identity.Subject))
	case errors.As(err, &held):
		lines := make([]string, len(held.Bans))
		for k, b := range held.Bans {
			lines[k] = "  " + banLine(b)
		}
		return fmt.Errorf("already banned, nothing changed (--replace to replace it):\n%s", strings.Join(lines, "\n"))
	case errors.Is(err, store.ErrNoIdentity):
		return fmt.Errorf("no account has signed in with %s: nothing banned (check it: accounts NAME lists the identities)", shown(identity.Provider, identity.Subject))
	case err != nil:
		return err
	}
	for _, b := range banned.Replaced {
		_, _ = fmt.Fprintf(out, "replaced %s\n", banLine(b))
	}
	for _, i := range banned.Identities {
		if banned.Account == "" {
			_, _ = fmt.Fprintf(out, "banned %s (no account): %s, reason %q, by %q\n", shown(i.Provider, i.Subject), describe(end), *reason, *by)
			continue
		}
		_, _ = fmt.Fprintf(out, "banned %s (account %s): %s, reason %q, by %q; its sessions ended\n", shown(i.Provider, i.Subject), banned.Account, describe(end), *reason, *by)
	}
	return nil
}

// banLine: a ban in force, as ban prints the ones it replaced or was refused by
func banLine(b store.Ban) string {
	return fmt.Sprintf("%s's ban: %s, reason %q, by %q, since %s", shown(b.Provider, b.Subject), describe(b.End), b.Reason, b.By, b.Created.UTC().Format(time.RFC3339))
}

// banEnd: a ban's end from --for (given: `forGiven`) or --until (`untilGiven`), neither a permanent ban. One given but
// empty, zero or negative is refused, not taken as permanent (a script's unset variable), and so is an end less than a
// minute away (a ban over at once would still end every session): RX35
func banEnd(length time.Duration, forGiven bool, date string, untilGiven bool, now time.Time) (store.BanEnd, error) {
	var end time.Time
	switch {
	case forGiven && untilGiven:
		return nil, errors.New("--for or --until, not both")
	case forGiven && length <= 0:
		return nil, errors.New("--for must be a positive length, e.g. 72h (neither --for nor --until: a permanent ban)")
	case forGiven:
		end = now.Add(length)
	case !untilGiven:
		return store.Permanent{}, nil
	case strings.TrimSpace(date) == "":
		return nil, errors.New("--until is empty (neither --for nor --until: a permanent ban)")
	default:
		t, err := time.Parse(time.DateOnly, date)
		if err != nil {
			if t, err = time.Parse(time.RFC3339, date); err != nil {
				return nil, errors.New("--until is YYYY-MM-DD (UTC) or an RFC 3339 time")
			}
		}
		end = t
	}
	if !end.After(now.Add(time.Minute)) {
		return nil, fmt.Errorf("the ban's end, %s, isn't a minute ahead of now", end.UTC().Format(time.RFC3339))
	}
	return store.Until{At: end}, nil
}

// describe a ban's end for the admin
func describe(end store.BanEnd) string {
	switch e := end.(type) {
	case store.Permanent:
		return "permanent"
	case store.Until:
		return "until " + e.At.UTC().Format(time.RFC3339)
	}
	return "?"
}

func unban(args []string, out io.Writer) error {
	fs := flagsFor("unban")
	var t target
	t.flags(fs)
	if _, err := parseArgs(fs, args, out, 0, 0); err != nil {
		return err
	}
	identity, malformed := t.parse()
	if malformed != nil {
		// (a subject an older version stored without today's checks (a trailing space, 16 digits) lifted exactly as
		// given, if a ban has it: RV-790)
		var ok bool
		if identity, ok = t.asGiven(); !ok {
			return malformed
		}
	}
	db, err := openStore(false)
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
	if malformed != nil && n == 0 {
		return fmt.Errorf("%w (and no ban is stored on it as given)", malformed)
	}
	_, _ = fmt.Fprintf(out, "%d ban(s) lifted\n", n)
	return nil
}

func bans(args []string, out io.Writer) error {
	if _, err := parseArgs(flagsFor("bans"), args, out, 0, 0); err != nil {
		return err
	}
	db, err := openStore(true)
	if err != nil {
		return err
	}
	defer db.Close()
	list, err := db.Bans(context.Background(), time.Now())
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "IDENTITY\tUNTIL\tBY\tSINCE\tREASON")
	for _, b := range list {
		_, _ = fmt.Fprintf(w, "%s\t%s\t%q\t%s\t%q\n", shown(b.Provider, b.Subject), describe(b.End), b.By, b.Created.UTC().Format(time.DateOnly), b.Reason)
	}
	return w.Flush()
}

// healthcheck: the image's HEALTHCHECK (no curl or wget in it): the health listener's GET /healthz (HEALTH_ADDR)
func healthcheck(args []string, out io.Writer) error {
	if _, err := parseArgs(flagsFor("healthcheck"), args, out, 0, 0); err != nil {
		return err
	}
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
func ticketKey(args []string, out io.Writer) error {
	rest, err := parseArgs(flagsFor("ticket-key"), args, out, 1, 1)
	if err != nil {
		return err
	}
	seed, public, err := ticket.NewKey(rest[0])
	if err != nil {
		return err
	}
	fmt.Println(seed)
	fmt.Fprintln(os.Stderr, public)
	return nil
}
