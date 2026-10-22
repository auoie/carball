package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"carball/api/internal/server"
)

func TestBanEnd(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		length time.Duration
		date   string
		want   string
	}{
		{0, "", "permanent"},
		{72 * time.Hour, "", "until 2026-10-21T12:00:00Z"},
		{0, "2026-11-01", "until 2026-11-01T00:00:00Z"},
		{0, "2026-11-01T08:30:00Z", "until 2026-11-01T08:30:00Z"},
		{time.Hour, "2026-11-01", ""},
		{-time.Hour, "", ""},
		{0, "next week", ""},
	} {
		got, err := banEnd(c.length, c.date, now)
		if c.want == "" {
			if err == nil {
				t.Errorf("banEnd(%v, %q) = %v, want an error", c.length, c.date, got)
			}
			continue
		}
		if err != nil || describe(got) != c.want {
			t.Errorf("banEnd(%v, %q) = %v, %v; want %s", c.length, c.date, got, err, c.want)
		}
	}
}

func TestTarget(t *testing.T) {
	for _, c := range []struct {
		t     target
		fails bool
	}{
		{target{account: "a"}, false},
		{target{identity: "steam:76561190000000001"}, false},
		{target{identity: "google:sub"}, false},
		{target{}, true},
		{target{account: "a", identity: "google:sub"}, true},
		{target{identity: "github:x"}, true},
		{target{identity: "steam:"}, true},
		{target{identity: "steam"}, true},
	} {
		if _, err := c.t.parse(); (err != nil) != c.fails {
			t.Errorf("%+v: %v", c.t, err)
		}
	}
}

// The used tickets kept past the acceptance window (a younger one purged could count twice: AC-22), the results a year
func TestRankedCutoffs(t *testing.T) {
	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	results, tickets := rankedCutoffs(now)
	if now.Sub(tickets) <= server.AcceptWindow || now.Sub(tickets) > server.AcceptWindow+2*time.Hour {
		t.Errorf("used tickets purged from %v before now: within the window, or kept far past it", now.Sub(tickets))
	}
	if now.Sub(results) != server.ResultsKept {
		t.Errorf("results purged from %v before now", now.Sub(results))
	}
}

// serve refuses a role that may create in the schema, but in development (AP-4, AP2-10)
func TestRoleRefusal(t *testing.T) {
	if roleRefusal(true, false) == nil {
		t.Error("a schema-creating role accepted outside development")
	}
	if roleRefusal(true, true) != nil || roleRefusal(false, false) != nil {
		t.Error("refused when it may run")
	}
}

// help, -h and --help list every command with its arguments and where the admin runs them; a command's -h its flags;
// an unknown command the same list, as an error (the user's report: --help showed serve's flag alone)
func TestHelp(t *testing.T) {
	for _, args := range [][]string{{"help"}, {"-h"}, {"--help"}} {
		var out, errs bytes.Buffer
		if code := run(args, &out, &errs); code != 0 || errs.Len() != 0 {
			t.Errorf("%v: exit %d, stderr %q", args, code, errs.String())
		}
		for _, want := range []string{"serve [--dev]", "migrate [--dev]", "accounts NAME", "ban (--account ID | --identity PROVIDER:SUBJECT)",
			"unban (--account ID", "bans", "healthcheck", "ticket-key KID", "docker exec carball-api /app/carball-api"} {
			if !strings.Contains(out.String(), want) {
				t.Errorf("%v: no %q in\n%s", args, want, out.String())
			}
		}
	}
	for command, wants := range map[string][]string{
		"ban":        {"usage: carball-api ban", "-account", "-identity", "-reason", "-by", "-for", "-until"},
		"unban":      {"usage: carball-api unban", "-account", "-identity"},
		"accounts":   {"usage: carball-api accounts NAME | --recent [N]", "-recent", "last seen", "within a day"},
		"serve":      {"usage: carball-api serve [--dev]", "-dev"},
		"migrate":    {"-dev"},
		"ticket-key": {"usage: carball-api ticket-key KID"},
		"bans":       {"usage: carball-api bans"},
	} {
		var out bytes.Buffer
		if code := run([]string{command, "-h"}, &out, &out); code != 0 {
			t.Errorf("%s -h: exit %d", command, code)
		}
		for _, want := range wants {
			if !strings.Contains(out.String(), want) {
				t.Errorf("%s -h: no %q in\n%s", command, want, out.String())
			}
		}
	}
	var out, errs bytes.Buffer
	if code := run([]string{"bnas"}, &out, &errs); code != 1 || !strings.Contains(errs.String(), `unknown command "bnas"`) || !strings.Contains(errs.String(), "ticket-key KID") {
		t.Errorf("an unknown command: exit %d, stderr %q", code, errs.String())
	}
	if code := run([]string{"ban", "--nope"}, &out, &errs); code != 1 {
		t.Errorf("a bad flag: exit %d", code)
	}
	// (accounts' arguments checked before the database is opened: a typo runs nothing)
	t.Setenv("DATABASE_URL", "")
	for _, args := range [][]string{{"accounts", "--recent", "x"}, {"accounts", "--recent", "0"}, {"accounts", "--recent", "1001"}, {"accounts"}, {"accounts", "a", "b"}} {
		errs.Reset()
		if code := run(args, &out, &errs); code != 1 || strings.Contains(errs.String(), "DATABASE_URL") {
			t.Errorf("%v: exit %d, %q (refused before the database)", args, code, errs.String())
		}
	}
	for _, args := range [][]string{{"accounts", "--recent"}, {"accounts", "--recent", "5"}, {"accounts", "Zig"}} {
		errs.Reset()
		if code := run(args, &out, &errs); code != 1 || !strings.Contains(errs.String(), "DATABASE_URL is required") {
			t.Errorf("%v: exit %d, %q (good arguments: on to the database)", args, code, errs.String())
		}
	}
}

func TestRecentCount(t *testing.T) {
	for _, c := range []struct {
		args []string
		want int
	}{{nil, 20}, {[]string{"5"}, 5}, {[]string{"1000"}, 1000}, {[]string{"0"}, 0}, {[]string{"x"}, 0}, {[]string{"1", "2"}, 0}} {
		if got, err := recentCount(c.args); got != c.want || (err == nil) != (c.want != 0) {
			t.Errorf("recentCount(%v) = %d, %v", c.args, got, err)
		}
	}
}

// The admin's commands on the live database refuse whatever they can't be sure of before anything runs (RX34): leftover
// words (an unquoted reason, a bare "72h"), a flag's value that looks like a flag, a help word anywhere (help, run
// nothing), a first argument that's a flag (serve only from no arguments: the image's start); errors on stderr alone
func TestArgumentsRefusedBeforeAnythingRuns(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("MIGRATE_DATABASE_URL", "")
	const id = "0f0e0d0c-0b0a-4908-8706-050403020100"
	for _, c := range []struct {
		args []string
		want string
	}{
		{[]string{"ban", "--account", id, "--by", "admin", "--reason", "cheating", "and", "smurfing", "--for", "72h"}, `unexpected argument "and"`},
		{[]string{"ban", "--account", id, "--by", "admin", "--reason", "x", "72h"}, `unexpected argument "72h"`},
		{[]string{"ban", "--account", id, "--by", "-h", "--reason", "x"}, `--by "-h" looks like a flag`},
		{[]string{"ban", "--account", id, "--by", "admin", "--reason", "--for"}, `looks like a flag`},
		{[]string{"unban", "--account", id, "now"}, `unexpected argument "now"`},
		{[]string{"--dev", "bans"}, "name the command first"},
		{[]string{"--", "bans"}, "name the command first"},
		{[]string{"--dev"}, "name the command first"},
		{[]string{"serve", "--dev", "bans"}, `unexpected argument "bans"`},
		{[]string{"migrate", "now"}, `unexpected argument "now"`},
		{[]string{"healthcheck", "extra"}, `unexpected argument "extra"`},
		{[]string{"bans", "--all"}, "flag provided but not defined"},
		{[]string{"ticket-key"}, "an argument missing"},
		{[]string{"ticket-key", "k1", "k2"}, `unexpected argument "k2"`},
		{[]string{"accounts", "a", "b"}, `unexpected argument "b"`},
	} {
		var out, errs bytes.Buffer
		code := run(c.args, &out, &errs)
		if code != 1 || !strings.Contains(errs.String(), c.want) || strings.Contains(errs.String(), "DATABASE_URL") || out.Len() != 0 {
			t.Errorf("%v: exit %d, stdout %q, stderr %q; want exit 1 with %q, nothing run, nothing on stdout", c.args, code, out.String(), errs.String(), c.want)
		}
	}
	// (a help word anywhere: the usage, nothing run: not the unban, not the migrations, not the server)
	for _, args := range [][]string{{"unban", "--account", id, "help"}, {"migrate", "help"}, {"serve", "--dev", "help"},
		{"ban", "--account", id, "-h"}, {"healthcheck", "-h"}, {"ticket-key", "--help"}} {
		var out, errs bytes.Buffer
		if code := run(args, &out, &errs); code != 0 || !strings.HasPrefix(out.String(), "usage: carball-api "+args[0]) || errs.Len() != 0 {
			t.Errorf("%v: exit %d, stdout %q, stderr %q; want the usage alone", args, code, out.String(), errs.String())
		}
	}
	// (the flags described in a command's usage)
	var out bytes.Buffer
	run([]string{"ban", "-h"}, &out, &out)
	for _, want := range []string{"who bans (kept with the ban)", "how long (e.g. 72h); none: no end", "the account's id"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("ban -h: no %q in\n%s", want, out.String())
		}
	}
	out.Reset()
	run([]string{"serve", "-h"}, &out, &out)
	if !strings.Contains(out.String(), "development: a localhost origin only") {
		t.Errorf("serve -h:\n%s", out.String())
	}
	// (no arguments: the image's start, serve: its configuration read, refused here for what's missing)
	var errs bytes.Buffer
	out.Reset()
	if code := run(nil, &out, &errs); code != 1 || !strings.Contains(errs.String(), "TICKET_SIGNING_KEY_FILE is required") {
		t.Errorf("no arguments: exit %d, %q; want serve's configuration refusal", code, errs.String())
	}
	// (good arguments go on to the database)
	errs.Reset()
	if code := run([]string{"ban", "--account", id, "--by", "admin", "--reason", "cheating and smurfing", "--for", "72h"}, &out, &errs); code != 1 || !strings.Contains(errs.String(), "DATABASE_URL is required") {
		t.Errorf("a quoted reason: exit %d, %q; want on to the database", code, errs.String())
	}
}
