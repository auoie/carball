package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"carball/api/internal/ranked"
	"carball/api/internal/store"
	"carball/api/internal/testdb"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

// The reports' arguments checked before the database is opened (a typo runs nothing), and each one's -h
func TestReportArgumentsAndHelp(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	for _, args := range [][]string{
		{"stats", "extra"}, {"matches"}, {"matches", "5"}, {"matches", "--recent", "0"}, {"matches", "--recent", "x"},
		{"account"}, {"account", "nope"}, {"account", "0f0e0d0c-0b0a-4908-8706-050403020100", "more"},
		{"ratings"}, {"ratings", "--top", "x"}, {"ratings", "--top", "--playlist", "4v4"}, {"queue-bans", "extra"},
		{"matches", "--nope"},
	} {
		var out, errs bytes.Buffer
		if code := run(args, &out, &errs); code != 1 || strings.Contains(errs.String(), "DATABASE_URL") {
			t.Errorf("%v: exit %d, %q (refused before the database)", args, code, errs.String())
		}
	}
	for _, args := range [][]string{
		{"stats"}, {"matches", "--recent"}, {"matches", "--recent", "5"}, {"account", "0F0E0D0C-0B0A-4908-8706-050403020100"},
		{"ratings", "--top"}, {"ratings", "--top", "10", "--playlist", "2v2"}, {"ratings", "--playlist", "3v3", "--top"},
		{"queue-bans"},
	} {
		var out, errs bytes.Buffer
		if code := run(args, &out, &errs); code != 1 || !strings.Contains(errs.String(), "DATABASE_URL is required") {
			t.Errorf("%v: exit %d, %q (good arguments: on to the database)", args, code, errs.String())
		}
	}
	for command, want := range map[string]string{
		"stats": "usage: carball-api stats", "matches": "-recent", "account": "usage: carball-api account ID",
		"ratings": "-playlist", "queue-bans": "usage: carball-api queue-bans",
	} {
		var out bytes.Buffer
		if code := run([]string{command, "-h"}, &out, &out); code != 0 || !strings.Contains(out.String(), want) {
			t.Errorf("%s -h: exit %d, no %q in\n%s", command, code, want, out.String())
		}
	}
}

// A provisional rating shown with "?", as the page shows it; the leaderboard by the shown rating, then games, then name
func TestShownRatingAndLeaderboard(t *testing.T) {
	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	settled := store.Rating{Rating: 1610.4, Deviation: 60, Volatility: 0.06, Games: 30, LastPlayed: now}
	if got := shownRating(settled, now); got != "1610" {
		t.Errorf("a settled rating: %q", got)
	}
	if got := shownRating(ranked.Default, now); got != "1500?" {
		t.Errorf("a new account's: %q", got)
	}
	rows := leaderboard([]store.Rated{
		{Account: "a", Name: "Low", Rating: store.Rating{Rating: 1400, Deviation: 60, Games: 9, LastPlayed: now}},
		{Account: "b", Name: "Top", Rating: settled},
		{Account: "c", Name: "Fresh", Rating: store.Rating{Rating: 1610, Deviation: 300, Games: 2, LastPlayed: now}},
	}, 2, now)
	if len(rows) != 2 || rows[0][1] != `"Top"` || rows[1][1] != `"Fresh"` || rows[1][2] != "1610?" {
		t.Errorf("the top two: %v", rows)
	}
}

// Each report against a database holding a few accounts, results, a ban and a leave ban
func TestReports(t *testing.T) {
	owner, app := testdb.New(t)
	ctx := context.Background()
	if err := store.Migrate(ctx, owner, "", testdb.AppRole, false); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(ctx, app, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	ids := map[string]string{}
	for i, name := range []string{"Ada", "Bea", "Cy", "Di"} {
		p := store.Pending{TokenHash: []byte("p" + name), Provider: store.Google, Subject: "sub-" + name, Suggestion: name, ExpiresAt: now.Add(time.Hour)}
		if err := db.CreatePending(ctx, p); err != nil {
			t.Fatal(err)
		}
		id, err := db.CreateAccount(ctx, p, name, []byte("h"+name), now.Add(-time.Duration(4-i)*time.Minute), now)
		if err != nil {
			t.Fatal(err)
		}
		ids[name] = id
	}
	rated := func(accounts ...string) func(map[string]*store.Rating) map[string]store.Rating {
		return func(map[string]*store.Rating) map[string]store.Rating {
			out := map[string]store.Rating{}
			for i, a := range accounts {
				out[ids[a]] = store.Rating{Rating: 1520 - float64(i)*40, Deviation: 300, Volatility: 0.09, Games: 1, LastPlayed: now}
			}
			return out
		}
	}
	player := func(name string, team int, quit bool, nonce byte) store.ResultPlayer {
		return store.ResultPlayer{Account: ids[name], Team: team, Quitter: quit, Seconds: 300, Nonce: [16]byte{nonce}, IssuedAt: now}
	}
	if _, err := db.RecordResult(ctx, store.Result{Match: "m1", Server: "game", Playlist: 1, WinningTeam: 0,
		Players: []store.ResultPlayer{player("Ada", 0, false, 1), player("Bea", 1, false, 2)}}, rated("Ada", "Bea"), now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.RecordResult(ctx, store.Result{Match: "m2", Server: "game", Playlist: 2, WinningTeam: 1,
		Players: []store.ResultPlayer{player("Ada", 0, false, 3), player("Cy", 0, false, 4), player("Bea", 1, false, 5), player("Di", 1, true, 6)}},
		rated("Bea", "Di", "Ada", "Cy"), now); err != nil {
		t.Fatal(err)
	}
	// (one two days ago: in the week, not today)
	if _, err := db.RecordResult(ctx, store.Result{Match: "m0", Server: "game", Playlist: 1, WinningTeam: 1,
		Players: []store.ResultPlayer{player("Cy", 0, false, 7), player("Di", 1, false, 8)}}, rated("Di", "Cy"), now.Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	// (one ten days ago: not even in the week)
	if _, err := db.RecordResult(ctx, store.Result{Match: "m00", Server: "game", Playlist: 1, WinningTeam: 0,
		Players: []store.ResultPlayer{player("Bea", 0, false, 9), player("Ada", 1, false, 10)}}, rated("Bea", "Ada"), now.Add(-240*time.Hour)); err != nil {
		t.Fatal(err)
	}
	// (Bea's ban over: not in force)
	if _, err := db.BanIdentity(ctx, store.Identity{Provider: store.Google, Subject: "sub-Bea"}, "old", "admin", store.Until{At: now.Add(-time.Hour)}, false, now.Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.BanIdentity(ctx, store.Identity{Provider: store.Google, Subject: "sub-Cy"}, "abuse", "admin", store.Until{At: now.Add(time.Hour)}, false, now); err != nil {
		t.Fatal(err)
	}
	if err := db.ChangeQueueBan(ctx, ids["Di"], nil, now, func(store.QueueBan, bool) (*store.QueueBan, bool) {
		return &store.QueueBan{Step: 1, Until: now.Add(5 * time.Minute), LastLeave: now, Match: "m2"}, true
	}); err != nil {
		t.Fatal(err)
	}
	// (Ada's leave ban over: not in force)
	if err := db.ChangeQueueBan(ctx, ids["Ada"], nil, now, func(store.QueueBan, bool) (*store.QueueBan, bool) {
		return &store.QueueBan{Step: 2, Until: now.Add(-time.Minute), LastLeave: now.Add(-time.Hour), Match: "m9"}, true
	}); err != nil {
		t.Fatal(err)
	}
	// (today as the report counts it: since 00:00 UTC; the minutes before now may be yesterday's just after midnight)
	day := now.Truncate(24 * time.Hour)
	today := func(times ...time.Time) int {
		n := 0
		for _, at := range times {
			if !at.Before(day) {
				n++
			}
		}
		return n
	}
	t.Setenv("DATABASE_URL", app)
	report := func(args ...string) string {
		t.Helper()
		var out, errs bytes.Buffer
		if code := run(args, &out, &errs); code != 0 {
			t.Fatalf("%v: exit %d, %s", args, code, errs.String())
		}
		return out.String()
	}
	lineWith := func(text, start string) string {
		for l := range strings.SplitSeq(text, "\n") {
			if strings.HasPrefix(l, start) {
				return strings.Join(strings.Fields(l), " ")
			}
		}
		return ""
	}
	st := report("stats")
	newToday := today(now.Add(-4*time.Minute), now.Add(-3*time.Minute), now.Add(-2*time.Minute), now.Add(-time.Minute))
	if got, want := lineWith(st, "accounts"), fmt.Sprintf("accounts %d 4 4", newToday); got != want {
		t.Errorf("stats' accounts: %q, want %q, in\n%s", got, want, st)
	}
	if got, want := lineWith(st, "1v1 matches"), fmt.Sprintf("1v1 matches %d 2", today(now.Add(-time.Minute))); got != want {
		t.Errorf("stats' 1v1: %q, want %q", got, want)
	}
	if !strings.Contains(st, "bans in force: 1 accounts' identities; leave bans in force: 1") {
		t.Errorf("stats' bans:\n%s", st)
	}
	ms := report("matches", "--recent")
	m1, m2 := strings.Index(ms, `"Bea" "Di"`), strings.Index(ms, `"Ada"  `)
	if !strings.Contains(ms, `2v2       "Ada" "Cy"  "Bea" "Di"  orange  "Di"`) || m1 < 0 || m2 < 0 {
		t.Errorf("matches:\n%s", ms)
	}
	if lines := strings.Split(strings.TrimSpace(ms), "\n"); len(lines) != 5 || !strings.Contains(lines[1], "2v2") || !strings.Contains(lines[2], "1v1") || !strings.Contains(lines[3], `"Cy"`) {
		t.Errorf("matches, newest first:\n%s", ms)
	}
	if one := report("matches", "--recent", "1"); strings.Count(strings.TrimSpace(one), "\n") != 1 || !strings.Contains(one, "2v2") {
		t.Errorf("matches --recent 1:\n%s", one)
	}
	ac := report("account", ids["Cy"])
	for _, want := range []string{`NAME        "Cy"`, "google:sub-Cy", "2v2 1400? (1 games)", "1v1 1480? (1 games)", `by admin: "abuse"`, "LEAVE BAN   none", "lost, 1500 → 1400"} {
		if !strings.Contains(ac, want) {
			t.Errorf("account: no %q in\n%s", want, ac)
		}
	}
	if strings.Count(ac, "1v1       ") != 1 || strings.Count(ac, "2v2       ") != 1 {
		t.Errorf("Cy's matches: its two alone (m0 and m2), not m1\n%s", ac)
	}
	if di := report("account", ids["Di"]); !strings.Contains(di, "step 1, until") || !strings.Contains(di, "(in force)") {
		t.Errorf("account with a leave ban:\n%s", di)
	}
	board := report("ratings", "--top", "--playlist", "2v2")
	if got := lineWith(board, "1"); !strings.HasPrefix(got, `1 "Bea" 1520? 1`) {
		t.Errorf("the 2v2 leaderboard's first: %q in\n%s", got, board)
	}
	if lines := strings.Split(strings.TrimSpace(board), "\n"); len(lines) != 5 {
		t.Errorf("the 2v2 leaderboard: four players\n%s", board)
	}
	// (ban says the ban it made: its end, or permanent; unban what it lifted)
	if got := report("ban", "--account", ids["Ada"], "--by", "admin", "--reason", "cheating and smurfing", "--for", "72h"); !strings.Contains(got,
		`banned google:sub-Ada (account `+ids["Ada"]+`): until `) || !strings.Contains(got, `reason "cheating and smurfing", by "admin"`) {
		t.Errorf("ban for 72h: %q", got)
	}
	// (an identity's ban names its account; Bea's earlier ban was over, so nothing to replace)
	if got := report("ban", "--identity", "google:sub-Bea", "--by", "admin", "--reason", "x"); got != "banned google:sub-Bea (account "+ids["Bea"]+
		"): permanent, reason \"x\", by \"admin\"; its sessions ended\n" {
		t.Errorf("a permanent ban: %q", got)
	}
	refused := func(want string, args ...string) {
		t.Helper()
		var out, errs bytes.Buffer
		if code := run(args, &out, &errs); code != 1 || out.Len() != 0 || !strings.Contains(errs.String(), want) {
			t.Errorf("%v: exit %d, stdout %q, stderr %q; want %q", args, code, out.String(), errs.String(), want)
		}
	}
	// (RV-787: a ban in force replaced only with --replace, refused naming it, nothing changed; replaced, printed)
	refused(`already banned, nothing changed (--replace to replace it):
  google:sub-Bea's ban: permanent, reason "x", by "admin", since `, "ban", "--identity", "google:sub-Bea", "--by", "mod", "--reason", "y", "--for", "1h")
	refused("google:sub-Cy's ban: until ", "ban", "--account", ids["Cy"], "--by", "mod", "--reason", "y")
	if got := report("account", ids["Bea"]); !strings.Contains(got, `google:sub-Bea permanent, by admin: "x"`) {
		t.Errorf("a refused re-ban changed the ban:\n%s", got)
	}
	if got := report("ban", "--identity", "google:sub-Bea", "--by", "mod", "--reason", "y", "--for", "1h", "--replace"); !strings.HasPrefix(got,
		`replaced google:sub-Bea's ban: permanent, reason "x", by "admin", since `) || !strings.Contains(got, "\nbanned google:sub-Bea (account "+ids["Bea"]+`): until `) {
		t.Errorf("a ban replaced: %q", got)
	}
	// (RV-781: an identity no account has, or one mistyped, refused: nothing banned)
	refused("no account has signed in with google:sub-Nobody: nothing banned", "ban", "--identity", "google:sub-Nobody", "--by", "admin", "--reason", "x")
	refused("no account has signed in with steam:76561190000000009", "ban", "--identity", "steam:76561190000000009", "--by", "admin", "--reason", "x")
	if got := report("bans"); strings.Contains(got, "sub-Nobody") || strings.Contains(got, "76561190000000009") {
		t.Errorf("a refused identity's ban stored:\n%s", got)
	}
	// (RV-788: --no-account bans an identity no account has, on purpose; one with an account refused; a re-ban as any:
	// --replace, which can extend it)
	if got := report("ban", "--identity", "google:sub-Nobody", "--no-account", "--by", "admin", "--reason", "x", "--for", "1h"); !strings.HasPrefix(got,
		"banned google:sub-Nobody (no account): until ") || !strings.HasSuffix(got, `, reason "x", by "admin"`+"\n") || strings.Count(got, "\n") != 1 {
		t.Errorf("a ban with no account: %q", got)
	}
	refused("google:sub-Nobody's ban: until ", "ban", "--identity", "google:sub-Nobody", "--no-account", "--by", "admin", "--reason", "x")
	if got := report("ban", "--identity", "google:sub-Nobody", "--no-account", "--by", "admin", "--reason", "x", "--replace"); !strings.HasPrefix(got,
		`replaced google:sub-Nobody's ban: until `) || !strings.HasSuffix(got, "\nbanned google:sub-Nobody (no account): permanent, reason \"x\", by \"admin\"\n") {
		t.Errorf("a ban with no account extended: %q", got)
	}
	refused("account "+ids["Di"]+" has signed in with google:sub-Di: nothing banned (ban it without --no-account)",
		"ban", "--identity", "google:sub-Di", "--no-account", "--by", "admin", "--reason", "x")
	if got := report("account", ids["Di"]); !strings.Contains(got, "BAN") || strings.Contains(got, "google:sub-Di permanent") {
		t.Errorf("a refused --no-account ban stored:\n%s", got)
	}
	// (RV-790: a ban an older version stored on a malformed subject (a trailing space, 16 digits) lifted as given; then
	// nothing to lift, refused with the format's reason)
	conn, err := pgx.Connect(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	if _, err := conn.Exec(ctx, `INSERT INTO bans (provider, subject, reason, until, banned_by, created_at)
		VALUES ('steam', '7656119000000001 ', 'old', NULL, 'admin', now())`); err != nil {
		t.Fatal(err)
	}
	if got := report("unban", "--identity", "steam:7656119000000001 "); got != "1 ban(s) lifted\n" {
		t.Errorf("unban of a malformed stored subject: %q", got)
	}
	refused("has a space or control character (and no ban is stored on it as given)", "unban", "--identity", "steam:7656119000000001 ")
	if got := report("bans"); strings.Contains(got, "7656119000000001") {
		t.Errorf("the malformed ban still listed:\n%s", got)
	}
	if got := report("unban", "--account", ids["Ada"]); got != "1 ban(s) lifted\n" {
		t.Errorf("unban: %q", got)
	}
	qb := report("queue-bans")
	if !strings.Contains(qb, ids["Di"]) || lineWith(qb, ids["Di"]) == "" || strings.Contains(qb, ids["Ada"]) {
		t.Errorf("queue-bans:\n%s", qb)
	}
}
