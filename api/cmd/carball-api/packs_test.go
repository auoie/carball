package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"carball/api/internal/store"
	"carball/api/internal/testdb"
)

// The pack commands on a made-up account's packs: the newest listed, one hidden (with why and by whom) and shown again,
// the reported ones, an account's
func TestPackCommands(t *testing.T) {
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
	account := func(name string) string {
		p := store.Pending{TokenHash: []byte("p" + name), Provider: store.Google, Subject: "sub-" + name, Suggestion: name, ExpiresAt: now.Add(time.Hour)}
		if err := db.CreatePending(ctx, p); err != nil {
			t.Fatal(err)
		}
		id, err := db.CreateAccount(ctx, p, name, []byte("h"+name), now, now)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	maker, reporter := account("Maker_One"), account("Reporter_One")
	var codes []string
	for i, name := range []string{"First Drill", "Second Drill"} {
		code, err := db.CreatePack(ctx, maker, store.NewPack{Name: name, Type: "striker", Difficulty: "easy", Shots: 2,
			File: func(string) ([]byte, error) { return []byte(`{}`), nil }}, now.Add(time.Duration(i)*time.Minute), 10, 100)
		if err != nil {
			t.Fatal(err)
		}
		codes = append(codes, code)
	}
	if _, _, err := db.ReportPack(ctx, codes[0], reporter, now); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", app)
	command := func(args ...string) string {
		t.Helper()
		var out, errs bytes.Buffer
		if code := run(args, &out, &errs); code != 0 {
			t.Fatalf("%v: exit %d, %s", args, code, errs.String())
		}
		return out.String()
	}
	if recent := command("packs", "--recent"); strings.Index(recent, "Second Drill") > strings.Index(recent, "First Drill") || !strings.Contains(recent, maker) {
		t.Fatalf("packs --recent:\n%s", recent)
	}
	if reported := command("packs", "--reported"); !strings.Contains(reported, codes[0]) || strings.Contains(reported, codes[1]) || !strings.Contains(reported, "1 (last") {
		t.Fatalf("packs --reported:\n%s", reported)
	}
	if said := command("pack-hide", strings.ToLower(codes[0]), "--reason", "made-up reason", "--by", "Mod"); !strings.Contains(said, "hidden") {
		t.Fatalf("pack-hide said:\n%s", said)
	}
	if mine := command("pack", maker); !strings.Contains(mine, `by "Mod": "made-up reason"`) {
		t.Fatalf("pack ACCOUNT:\n%s", mine)
	}
	if said := command("pack-unhide", codes[0]); !strings.Contains(said, "shown again") {
		t.Fatalf("pack-unhide said:\n%s", said)
	}
	if said := command("pack-unhide", codes[0]); !strings.Contains(said, "wasn't hidden") {
		t.Fatalf("pack-unhide again said:\n%s", said)
	}
	var out, errs bytes.Buffer
	if code := run([]string{"pack-hide", "0000-0000-0000-0000", "--reason", "x", "--by", "Mod"}, &out, &errs); code != 1 || !strings.Contains(errs.String(), "no pack") {
		t.Errorf("an unknown pack's hide: exit %d, %s", code, errs.String())
	}
}
