package store_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"carball/api/internal/store"
	"carball/api/internal/testdb"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

var t0 = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

// open: a migrated database, the store connected as the rows-only role
func open(t *testing.T) (*store.Store, string, string) {
	t.Helper()
	owner, app := testdb.New(t)
	ctx := context.Background()
	if err := store.Migrate(ctx, owner, "", testdb.AppRole, false); err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(ctx, app, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s, owner, app
}

func TestMigrateAndGrants(t *testing.T) {
	_, owner, app := open(t)
	ctx := context.Background()
	// (again: nothing to do)
	if err := store.Migrate(ctx, owner, "", testdb.AppRole, false); err != nil {
		t.Fatalf("migrating again: %v", err)
	}
	conn, err := pgx.Connect(ctx, app)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	// (rows: yes; the schema and the migrations' record: no)
	if _, err := conn.Exec(ctx, "SELECT count(*) FROM accounts"); err != nil {
		t.Errorf("the service's role can't read accounts: %v", err)
	}
	for _, q := range []string{
		"CREATE TABLE x (y int)",
		"DROP TABLE bans",
		"ALTER TABLE accounts ADD COLUMN z int",
		"SELECT * FROM goose_db_version",
	} {
		if _, err := conn.Exec(ctx, q); err == nil {
			t.Errorf("the service's role may %q", q)
		}
	}
	if role, err := store.AppRole(app); err != nil || role != testdb.AppRole {
		t.Errorf("AppRole = %q, %v", role, err)
	}
	// (the same role for both: refused, unless development's; the service's may create nothing, the owner may: AP-4, AP-5)
	if err := store.Migrate(ctx, owner, "", testdb.OwnerRole, false); !errors.Is(err, store.ErrSameRole) {
		t.Errorf("one role for both: %v", err)
	}
	if err := store.Migrate(ctx, owner, "", testdb.OwnerRole, true); err != nil {
		t.Errorf("one role for both, development's: %v", err)
	}
	for _, c := range []struct {
		url  string
		want bool
	}{{app, false}, {owner, true}} {
		s, err := store.Open(ctx, c.url, "")
		if err != nil {
			t.Fatal(err)
		}
		if can, err := s.CanCreate(ctx); err != nil || can != c.want {
			t.Errorf("CanCreate (%s) = %v, %v; want %v", c.url, can, err, c.want)
		}
		s.Close()
	}
}

func pending(t *testing.T, s *store.Store, provider store.Provider, subject string, at time.Time) store.Pending {
	t.Helper()
	p := store.Pending{TokenHash: []byte(string(provider) + subject + at.String()), Provider: provider, Subject: subject,
		Suggestion: "Player 1234", ExpiresAt: at.Add(15 * time.Minute)}
	if err := s.CreatePending(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCreateAccount(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	p := pending(t, s, "google", "sub-1", t0)
	id, err := s.CreateAccount(ctx, p, "First", []byte("hmac-1"), t0, t0.Add(-30*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if got, found, err := s.AccountByIdentity(ctx, "google", "sub-1"); err != nil || !found || got != id {
		t.Fatalf("AccountByIdentity = %q, %v, %v", got, found, err)
	}
	a, err := s.Account(ctx, id)
	if err != nil || a.Name != "First" || len(a.Providers) != 1 || a.Providers[0] != "google" || !a.CreatedAt.Equal(t0) {
		t.Fatalf("Account = %+v, %v", a, err)
	}
	// (the sign-up is used up)
	if _, err := s.CreateAccount(ctx, p, "Again", []byte("hmac-1"), t0, t0.Add(-30*24*time.Hour)); !errors.Is(err, store.ErrPendingGone) {
		t.Errorf("the same sign-up twice: %v", err)
	}
	// (the identity signed up meanwhile, from another sign-up)
	if _, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-1", t0.Add(time.Second)), "Twin", []byte("hmac-1"), t0,
		t0.Add(-30*24*time.Hour)); !errors.Is(err, store.ErrIdentityTaken) {
		t.Errorf("a second account for the identity: %v", err)
	}
	// (an expired sign-up)
	late := pending(t, s, "steam", "76561190000000001", t0)
	if _, err := s.CreateAccount(ctx, late, "Late", []byte("hmac-2"), t0.Add(16*time.Minute), t0); !errors.Is(err, store.ErrPendingGone) {
		t.Errorf("an expired sign-up: %v", err)
	}
}

func TestCreateAccountRefusals(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	// (a banned identity with no account (the admin's --no-account, RV-788): its sign-up refused, the ban carried)
	b, err := s.BanNoAccount(ctx, store.Identity{Provider: store.Steam, Subject: "76561190000000002"}, "cheating", "admin", store.Permanent{}, false, t0)
	if err != nil || b.Account != "" || len(b.Identities) != 1 {
		t.Fatalf("BanNoAccount = %+v, %v", b, err)
	}
	// (banned already: refused unasked, replaced when asked)
	var held store.AlreadyBannedError
	if _, err := s.BanNoAccount(ctx, store.Identity{Provider: store.Steam, Subject: "76561190000000002"}, "again", "mod", store.Permanent{}, false, t0); !errors.As(err, &held) {
		t.Errorf("a re-ban with no account unasked: %v", err)
	}
	if b, err := s.BanNoAccount(ctx, store.Identity{Provider: store.Steam, Subject: "76561190000000002"}, "cheating", "admin", store.Permanent{}, true, t0); err != nil ||
		len(b.Replaced) != 1 || b.Replaced[0].Reason != "cheating" {
		t.Errorf("a re-ban with no account replacing = %+v, %v", b, err)
	}
	var banned store.BannedError
	_, err = s.CreateAccount(ctx, pending(t, s, "steam", "76561190000000002", t0), "B", []byte("h"), t0, t0)
	if !errors.As(err, &banned) || banned.Ban.Reason != "cheating" {
		t.Errorf("a banned identity's sign-up: %v", err)
	}
	// (a deletion within the block: refused, with its time; one before it: fine)
	id, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-del", t0), "D", []byte("hmac-del"), t0, t0)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAccount(ctx, id, func(store.Identity) []byte { return []byte("hmac-del") }, t0); err != nil {
		t.Fatal(err)
	}
	var blocked store.RecreateError
	later := t0.Add(10 * 24 * time.Hour)
	_, err = s.CreateAccount(ctx, pending(t, s, "google", "sub-del", later), "D2", []byte("hmac-del"), later, later.Add(-30*24*time.Hour))
	if !errors.As(err, &blocked) || !blocked.DeletedAt.Equal(t0) {
		t.Errorf("re-created within the block: %v", err)
	}
	after := t0.Add(31 * 24 * time.Hour)
	if _, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-del", after), "D3", []byte("hmac-del"), after,
		after.Add(-30*24*time.Hour)); err != nil {
		t.Errorf("re-created after the block: %v", err)
	}
}

func TestDeleteAccount(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	id, err := s.CreateAccount(ctx, pending(t, s, "steam", "76561190000000003", t0), "Gone", []byte("h3"), t0, t0)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession(ctx, []byte("tok"), id, t0, t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var hashed []store.Identity
	if err := s.DeleteAccount(ctx, id, func(i store.Identity) []byte { hashed = append(hashed, i); return []byte("h3") }, t0); err != nil {
		t.Fatal(err)
	}
	if len(hashed) != 1 || hashed[0].Subject != "76561190000000003" {
		t.Errorf("hashed %v", hashed)
	}
	if _, err := s.Account(ctx, id); !errors.Is(err, store.ErrNoAccount) {
		t.Errorf("the account after deletion: %v", err)
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("tok"), t0); found {
		t.Error("a session outlived its account")
	}
	if _, found, _ := s.AccountByIdentity(ctx, "steam", "76561190000000003"); found {
		t.Error("an identity outlived its account")
	}
	if at, found, err := s.DeletedAfter(ctx, []byte("h3"), t0.Add(-time.Hour)); err != nil || !found || !at.Equal(t0) {
		t.Errorf("the deletion's record: %v %v %v", at, found, err)
	}
}

func TestSessions(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	id, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-s", t0), "S", []byte("hs"), t0, t0)
	if err != nil {
		t.Fatal(err)
	}
	end := t0.Add(90 * 24 * time.Hour)
	if err := s.CreateSession(ctx, []byte("a"), id, t0, end); err != nil {
		t.Fatal(err)
	}
	ss, found, err := s.SessionByToken(ctx, []byte("a"), t0)
	if err != nil || !found || ss.AccountID != id || ss.Previous {
		t.Fatalf("SessionByToken = %+v, %v, %v", ss, found, err)
	}
	day := t0.Add(25 * time.Hour)
	if ok, err := s.RotateSession(ctx, []byte("a"), []byte("b"), day, day.Add(10*time.Minute)); err != nil || !ok {
		t.Fatalf("RotateSession = %v, %v", ok, err)
	}
	// (rotated already: a second rotation of the old token loses)
	if ok, _ := s.RotateSession(ctx, []byte("a"), []byte("c"), day, day.Add(10*time.Minute)); ok {
		t.Error("a rotated-out token rotated again")
	}
	if ss, found, _ := s.SessionByToken(ctx, []byte("a"), day.Add(5*time.Minute)); !found || !ss.Previous {
		t.Error("the old token refused within its grace")
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("a"), day.Add(11*time.Minute)); found {
		t.Error("the old token accepted after its grace")
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("b"), end.Add(-time.Second)); !found {
		t.Error("the new token refused")
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("b"), end); found {
		t.Error("a session accepted at its absolute end")
	}
	// (signed out by the old token, within its grace: the session gone)
	if err := s.DeleteSession(ctx, []byte("a")); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("b"), day); found {
		t.Error("signing out by the previous token left the session")
	}
	// (a ban in force on the account: no session of it opens, even one made after the ban (a sign-in racing it: AP-3))
	if _, err := s.BanIdentity(ctx, store.Identity{Provider: store.Google, Subject: "sub-s"}, "x", "admin", store.Until{At: day.Add(time.Hour)}, false, day); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession(ctx, []byte("late"), id, day, end); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("late"), day); found {
		t.Error("a banned account's session opened")
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("late"), day.Add(2*time.Hour)); !found {
		t.Error("the session refused after the ban's end")
	}
}

func TestBans(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	id, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-b", t0), "Banned", []byte("hb"), t0, t0)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession(ctx, []byte("sb"), id, t0, t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	until := t0.Add(72 * time.Hour)
	b0, err := s.BanAccount(ctx, id, "abuse", "admin", store.Until{At: until}, false, t0)
	if err != nil || len(b0.Identities) != 1 || b0.Account != id || len(b0.Replaced) != 0 {
		t.Fatalf("BanAccount = %+v, %v", b0, err)
	}
	if _, found, _ := s.SessionByToken(ctx, []byte("sb"), t0); found {
		t.Error("a banned account still signed in")
	}
	b, banned, err := s.BanOn(ctx, "google", "sub-b", t0)
	if end, ok := b.End.(store.Until); err != nil || !banned || !ok || !end.At.Equal(until) || b.By != "admin" {
		t.Errorf("BanOn = %+v, %v, %v", b, banned, err)
	}
	if list, err := s.Bans(ctx, t0); err != nil || len(list) != 1 {
		t.Errorf("Bans = %v, %v", list, err)
	}
	if b, banned, _ := s.BanOn(ctx, "google", "sub-b", until); banned {
		t.Errorf("a ban in force at its end: %+v", b)
	}
	// (a ban in force: not replaced unasked, nothing changed, the ban in force named (RV-787); replaced when asked, the
	// replaced one returned)
	var held store.AlreadyBannedError
	if _, err := s.BanIdentity(ctx, store.Identity{Provider: store.Google, Subject: "sub-b"}, "again", "mod", store.Permanent{}, false, t0); !errors.As(err, &held) ||
		len(held.Bans) != 1 || held.Bans[0].Reason != "abuse" {
		t.Errorf("a re-ban unasked: %v", err)
	}
	if b, _, _ := s.BanOn(ctx, "google", "sub-b", t0); b.Reason != "abuse" || b.By != "admin" {
		t.Errorf("a refused re-ban changed the ban: %+v", b)
	}
	if _, err := s.BanAccount(ctx, id, "again", "mod", store.Permanent{}, false, t0); !errors.As(err, &held) {
		t.Errorf("an account's re-ban unasked: %v", err)
	}
	// (banned by an identity: its account's every identity; then lifted)
	b1, err := s.BanIdentity(ctx, store.Identity{Provider: store.Google, Subject: "sub-b"}, "again", "mod", store.Permanent{}, true, t0)
	if err != nil || b1.Account != id || len(b1.Replaced) != 1 || b1.Replaced[0].Reason != "abuse" || b1.Replaced[0].By != "admin" {
		t.Fatalf("a re-ban replacing = %+v, %v", b1, err)
	}
	if b, _, _ := s.BanOn(ctx, "google", "sub-b", t0); b.Reason != "again" {
		t.Errorf("the replacing ban: %+v", b)
	}
	// (one with an account asked for as having none: refused, its account named, nothing changed (RV-788))
	var has store.HasAccountError
	if _, err := s.BanNoAccount(ctx, store.Identity{Provider: store.Google, Subject: "sub-b"}, "x", "admin", store.Permanent{}, true, t0); !errors.As(err, &has) || has.Account != id {
		t.Errorf("a ban with no account on an account's identity: %v", err)
	}
	if b, _, _ := s.BanOn(ctx, "google", "sub-b", t0); b.Reason != "again" {
		t.Errorf("a refused ban with no account changed the ban: %+v", b)
	}
	// (an identity no account has: refused, nothing stored (RV-781))
	if _, err := s.BanIdentity(ctx, store.Identity{Provider: store.Google, Subject: "sub-nobody"}, "x", "admin", store.Permanent{}, false, t0); !errors.Is(err, store.ErrNoIdentity) {
		t.Errorf("banning an unknown identity: %v", err)
	}
	if _, banned, _ := s.BanOn(ctx, "google", "sub-nobody", t0); banned {
		t.Error("an unknown identity's ban stored")
	}
	if n, err := s.Unban(ctx, store.Identity{Provider: store.Google, Subject: "sub-b"}); err != nil || n != 1 {
		t.Errorf("Unban = %d, %v", n, err)
	}
	if _, banned, _ := s.BanOn(ctx, "google", "sub-b", t0); banned {
		t.Error("still banned after the unban")
	}
	if _, err := s.BanAccount(ctx, "00000000-0000-0000-0000-000000000000", "x", "admin", store.Permanent{}, false, t0); !errors.Is(err, store.ErrNoAccount) {
		t.Errorf("banning no account: %v", err)
	}
	found, err := s.FindAccounts(ctx, "bann")
	if err != nil || len(found) != 1 || found[0].ID != id || found[0].Identities[0].Subject != "sub-b" {
		t.Errorf("FindAccounts = %+v, %v", found, err)
	}
}

// The newest accounts, newest first, at most n; each one's last seen its latest session's sign-in or renewal, none
// without a session (the admin's accounts --recent)
func TestRecentAccounts(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	var ids []string
	for i, sub := range []string{"sub-r1", "sub-r2", "sub-r3"} {
		at := t0.Add(time.Duration(i) * time.Hour)
		id, err := s.CreateAccount(ctx, pending(t, s, "google", sub, at), fmt.Sprintf("Recent %d", i+1), []byte("hr"+sub), at, at)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	// (the first's session: signed in at 3 h, renewed at 30 h)
	if err := s.CreateSession(ctx, []byte("sr1"), ids[0], t0.Add(3*time.Hour), t0.Add(90*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RotateSession(ctx, []byte("sr1"), []byte("sr1b"), t0.Add(30*time.Hour), t0.Add(30*time.Hour+time.Minute)); err != nil {
		t.Fatal(err)
	}
	two, err := s.RecentAccounts(ctx, 2)
	if err != nil || len(two) != 2 || two[0].ID != ids[2] || two[1].ID != ids[1] {
		t.Fatalf("the newest two: %+v, %v", two, err)
	}
	all, err := s.RecentAccounts(ctx, 10)
	if err != nil || len(all) != 3 || all[2].ID != ids[0] {
		t.Fatalf("all three: %+v, %v", all, err)
	}
	if seen := all[2].LastSeen; seen == nil || !seen.Equal(t0.Add(30*time.Hour)) || all[0].LastSeen != nil {
		t.Errorf("last seen: %v and %v, want its renewal and none", all[2].LastSeen, all[0].LastSeen)
	}
	if found, err := s.FindAccounts(ctx, "recent 1"); err != nil || len(found) != 1 || found[0].LastSeen == nil {
		t.Errorf("a name's search with its last seen: %+v, %v", found, err)
	}
}

func TestFlowsNoncesAndPurge(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	f := store.Flow{IDHash: []byte("flow"), Provider: "google", State: "st", Nonce: "n", Verifier: "v", ExpiresAt: t0.Add(10 * time.Minute)}
	if err := s.CreateFlow(ctx, f); err != nil {
		t.Fatal(err)
	}
	got, ok, err := s.TakeFlow(ctx, []byte("flow"), t0)
	if err != nil || !ok || got.State != "st" || got.Verifier != "v" {
		t.Fatalf("TakeFlow = %+v, %v, %v", got, ok, err)
	}
	if _, ok, _ := s.TakeFlow(ctx, []byte("flow"), t0); ok {
		t.Error("a flow taken twice")
	}
	f.IDHash = []byte("late")
	if err := s.CreateFlow(ctx, f); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.TakeFlow(ctx, []byte("late"), t0.Add(11*time.Minute)); ok {
		t.Error("an expired flow taken")
	}
	if fresh, err := s.UseNonce(ctx, "nonce", t0.Add(6*time.Minute)); err != nil || !fresh {
		t.Fatalf("UseNonce = %v, %v", fresh, err)
	}
	if fresh, _ := s.UseNonce(ctx, "nonce", t0.Add(6*time.Minute)); fresh {
		t.Error("a nonce used twice")
	}
	// (kept until its time: a purge before it leaves it, the replay still refused; after it, gone)
	if err := s.Purge(ctx, t0.Add(5*time.Minute), t0); err != nil {
		t.Fatal(err)
	}
	if fresh, _ := s.UseNonce(ctx, "nonce", t0.Add(6*time.Minute)); fresh {
		t.Error("a nonce purged before its time: replayable")
	}
	if err := s.Purge(ctx, t0.Add(7*time.Minute), t0); err != nil {
		t.Fatal(err)
	}
	if fresh, _ := s.UseNonce(ctx, "nonce", t0.Add(20*time.Minute)); !fresh {
		t.Error("an expired nonce not purged")
	}
	// (the open flows and sign-ups counted, the expired ones not: the ceilings', AP-2)
	if err := s.CreateFlow(ctx, store.Flow{IDHash: []byte("open"), Provider: store.Steam, State: "s", ExpiresAt: t0.Add(10 * time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if n, err := s.OpenFlows(ctx, t0); err != nil || n != 1 {
		t.Errorf("OpenFlows = %d, %v", n, err)
	}
	if n, _ := s.OpenFlows(ctx, t0.Add(11*time.Minute)); n != 0 {
		t.Errorf("OpenFlows past the end = %d", n)
	}
	pending(t, s, store.Google, "sub-count", t0)
	if n, err := s.OpenSignups(ctx, t0); err != nil || n != 1 {
		t.Errorf("OpenSignups = %d, %v", n, err)
	}
}

// A result recorded once: the players' ratings as `rate` gives them, a deleted account's player a placeholder (no
// account, not rated: AC-10); the account deleted later leaves its rows as placeholders; purged after their time
func TestRecordResultAndPurge(t *testing.T) {
	s, owner, _ := open(t)
	ctx := context.Background()
	a, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-ra", t0), "A", []byte("ha"), t0, t0)
	if err != nil {
		t.Fatal(err)
	}
	gone := "00000000-0000-4000-8000-000000000001" // (no such account: deleted before the result came)
	r := store.Result{Match: "m1", Server: "game", Playlist: 1, WinningTeam: 0, Players: []store.ResultPlayer{
		{Account: a, Team: 0, Seconds: 300, Nonce: [16]byte{1}, IssuedAt: t0},
		{Account: gone, Team: 1, Quitter: true, Seconds: 120, Nonce: [16]byte{2}, IssuedAt: t0},
	}}
	var given map[string]*store.Rating
	rate := func(current map[string]*store.Rating) map[string]store.Rating {
		given = current
		return map[string]store.Rating{a: {Rating: 1600, Deviation: 300, Volatility: 0.09, Games: 1, LastPlayed: t0}}
	}
	if ok, err := s.RecordResult(ctx, r, rate, t0); err != nil || !ok {
		t.Fatalf("RecordResult = %v, %v", ok, err)
	}
	if c, has := given[a]; !has || c != nil || len(given) != 1 {
		t.Errorf("rate given %v: the existing account without a rating, the deleted one absent", given)
	}
	if got, err := s.RatingsOf(ctx, a); err != nil || got[1].Rating != 1600 || got[1].Games != 1 {
		t.Errorf("RatingsOf = %+v, %v", got, err)
	}
	db, err := pgx.Connect(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close(ctx) }()
	count := func(sql string) (n int) {
		if err := db.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM ranked_result_players WHERE match_id = 'm1' AND account_id IS NULL`); n != 1 {
		t.Errorf("%d placeholders, want 1 (the deleted account's)", n)
	}
	// (again: not recorded; its tickets in another match: refused, nothing written)
	if ok, err := s.RecordResult(ctx, r, rate, t0); err != nil || ok {
		t.Errorf("a retry: %v, %v", ok, err)
	}
	r2 := r
	r2.Match = "m2"
	if _, err := s.RecordResult(ctx, r2, rate, t0); !errors.Is(err, store.ErrTicketUsed) {
		t.Errorf("used tickets: %v", err)
	}
	if n := count(`SELECT count(*) FROM ranked_results WHERE match_id = 'm2'`); n != 0 {
		t.Error("a refused result left its row")
	}
	// (the account deleted: its rows kept, as placeholders; its rating gone)
	if err := s.DeleteAccount(ctx, a, func(store.Identity) []byte { return []byte("ha") }, t0); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM ranked_result_players WHERE account_id IS NULL`); n != 2 {
		t.Errorf("%d placeholders after the deletion, want 2", n)
	}
	if n := count(`SELECT count(*) FROM ratings`); n != 0 {
		t.Errorf("%d ratings left", n)
	}
	// (purged: results past their year, tickets past the window)
	if err := s.PurgeRanked(ctx, t0.Add(time.Second), t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if count(`SELECT count(*) FROM ranked_results`)+count(`SELECT count(*) FROM used_tickets`) != 0 {
		t.Error("not purged")
	}
}

// A queue ban written, changed and removed in one transaction; an unknown account refused
// Results recorded at once for one account, new to the playlist: each counted (the account's row locked, so no two
// read "no rating" and write over each other; AP3)
func TestConcurrentResultsCountEach(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	a, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-cc", t0), "C", []byte("hc"), t0, t0)
	if err != nil {
		t.Fatal(err)
	}
	const n = 8
	// (each rating step waits a moment for the others: locked, they come one at a time and each waits it out; unlocked,
	// all would read "no rating" together and write over each other)
	var mu sync.Mutex
	arrived, all := 0, make(chan struct{})
	rate := func(current map[string]*store.Rating) map[string]store.Rating {
		mu.Lock()
		if arrived++; arrived == n {
			close(all)
		}
		mu.Unlock()
		select {
		case <-all:
		case <-time.After(150 * time.Millisecond):
		}
		out := map[string]store.Rating{}
		for id, r := range current {
			next := store.Rating{Rating: 1500, Deviation: 300, Volatility: 0.06, LastPlayed: t0}
			if r != nil {
				next.Games = r.Games
			}
			next.Games++
			out[id] = next
		}
		return out
	}
	errs := make(chan error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := store.Result{Match: fmt.Sprintf("cc%d", i), Server: "game", Playlist: 1, WinningTeam: 0, Players: []store.ResultPlayer{
				{Account: a, Team: 0, Seconds: 60, Nonce: [16]byte{0xcc, byte(i)}, IssuedAt: t0},
				{Account: "00000000-0000-4000-8000-0000000000cc", Team: 1, Seconds: 60, Nonce: [16]byte{0xcd, byte(i)}, IssuedAt: t0},
			}}
			_, err := s.RecordResult(ctx, r, rate, t0)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := s.RatingsOf(ctx, a); got[1].Games != n {
		t.Errorf("%d games counted of %d recorded at once", got[1].Games, n)
	}
}

// A result the database's constraints refuse is a data error (the handler answers 400, which the game server's outbox
// drops), a fault that may pass isn't (RX31)
func TestConstraintRefusalIsADataError(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	bad := store.Result{Match: "dx1", Server: "game", Playlist: 4, WinningTeam: 0}
	_, err := s.RecordResult(ctx, bad, func(map[string]*store.Rating) map[string]store.Rating { return nil }, t0)
	if err == nil || !store.IsDataError(err) {
		t.Errorf("a playlist outside 1-3: %v, want a data error", err)
	}
	if store.IsDataError(errors.New("connection reset")) || store.IsDataError(nil) {
		t.Error("not data errors")
	}
}

func TestQueueBans(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	a, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-qb", t0), "Q", []byte("hq"), t0, t0)
	if err != nil {
		t.Fatal(err)
	}
	before := t0.Add(-time.Hour)
	ban := store.QueueBan{Step: 2, Until: t0.Add(15 * time.Minute), LastLeave: t0, Match: "m", PreviousStep: 1, PreviousUntil: &t0, PreviousLeave: &before}
	if err := s.ChangeQueueBan(ctx, a, nil, t0, func(_ store.QueueBan, exists bool) (*store.QueueBan, bool) { return &ban, !exists }); err != nil {
		t.Fatal(err)
	}
	got, found, err := s.QueueBanOf(ctx, a)
	if err != nil || !found || got.Step != 2 || !got.Until.Equal(ban.Until) || got.Match != "m" || !got.PreviousLeave.Equal(before) {
		t.Fatalf("QueueBanOf = %+v, %v, %v", got, found, err)
	}
	if err := s.ChangeQueueBan(ctx, a, nil, t0, func(store.QueueBan, bool) (*store.QueueBan, bool) { return nil, true }); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := s.QueueBanOf(ctx, a); found {
		t.Error("not removed")
	}
	if err := s.ChangeQueueBan(ctx, "00000000-0000-4000-8000-000000000009", nil, t0, func(store.QueueBan, bool) (*store.QueueBan, bool) { return &ban, true }); !errors.Is(err, store.ErrNoAccount) {
		t.Errorf("an unknown account: %v", err)
	}
	// (a ticket spent with the change: again on its match, fine; on another, refused and nothing changed)
	spent := &store.SpentTicket{Nonce: [16]byte{7, 7}, IssuedAt: t0, Match: "m1"}
	write := func(match string) func(store.QueueBan, bool) (*store.QueueBan, bool) {
		return func(store.QueueBan, bool) (*store.QueueBan, bool) {
			b := ban
			b.Match = match
			return &b, true
		}
	}
	if err := s.ChangeQueueBan(ctx, a, spent, t0, write("m1")); err != nil {
		t.Fatal(err)
	}
	if err := s.ChangeQueueBan(ctx, a, spent, t0, write("m1")); err != nil {
		t.Errorf("its own match again: %v", err)
	}
	other := *spent
	other.Match = "m2"
	if err := s.ChangeQueueBan(ctx, a, &other, t0, write("m2")); !errors.Is(err, store.ErrTicketUsed) {
		t.Errorf("another match's: %v", err)
	}
	if got, _, _ := s.QueueBanOf(ctx, a); got.Match != "m1" {
		t.Errorf("changed by a refused spend: %+v", got)
	}
}

// Renames kept (name moderation): the player's own recorded with the old name (the same name not), an admin's with who
// and why and its lock, which refuses the player's renames until it ends (RenameLockedError); an account's history and
// the latest of all newest first; a year kept by the sweep; deleted with the account
func TestNameChanges(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	id, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-names", t0), "First", []byte("hmac-names"), t0, t0.Add(-30*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-other", t0), "Other", []byte("hmac-other"), t0, t0.Add(-30*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Rename(ctx, id, "Second", t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename(ctx, id, "Second", t0.Add(2*time.Minute)); err != nil { // (the same name: nothing recorded)
		t.Fatal(err)
	}
	// (the name drawn again while it's the account's own: a change always recorded, RV-1176)
	draws := []string{"Second", "Second", "Player_1234"}
	draw := func() string { d := draws[0]; draws = draws[1:]; return d }
	old, name, err := s.AdminRename(ctx, id, draw, "Mod", "an offensive name", t0.Add(30*24*time.Hour), t0.Add(3*time.Minute))
	if err != nil || old != "Second" || name != "Player_1234" {
		t.Fatalf("AdminRename: %q -> %q, %v", old, name, err)
	}
	var locked store.RenameLockedError
	if err := s.Rename(ctx, id, "Third", t0.Add(4*time.Minute)); !errors.As(err, &locked) || !locked.Until.Equal(t0.Add(30*24*time.Hour)) {
		t.Fatalf("a rename while locked: %v", err)
	}
	if err := s.Rename(ctx, other, "Another", t0.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	// (an admin's rename with a shorter lock, or none, keeps the lock as it was: a lock only extended, RV-1174)
	if _, _, err := s.AdminRename(ctx, id, func() string { return "Player_5678" }, "Mod", "again", t0.Add(time.Hour), t0.Add(6*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if until, ok, err := s.RenameLockedUntil(ctx, id, t0.Add(7*time.Minute)); err != nil || !ok || !until.Equal(t0.Add(30*24*time.Hour)) {
		t.Fatalf("the lock after a shorter one: %v %v %v", until, ok, err)
	}
	if err := s.Rename(ctx, id, "Third", t0.Add(7*time.Minute)); !errors.As(err, &locked) {
		t.Fatalf("the lock lost: %v", err)
	}
	// (the lock ended: the player's rename goes through)
	if err := s.Rename(ctx, id, "Third", t0.Add(31*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename(ctx, "00000000-0000-4000-8000-000000000000", "Nobody", t0); !errors.Is(err, store.ErrNoAccount) {
		t.Fatalf("a rename of no account: %v", err)
	}
	history, err := s.NameChanges(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	type change struct{ old, new, by, why string }
	var got []change
	for _, c := range history {
		if c.Account != id || c.Name != "Third" {
			t.Fatalf("a change's account: %+v", c)
		}
		got = append(got, change{c.Old, c.New, c.By, c.Reason})
	}
	want := []change{{"Player_5678", "Third", "", ""}, {"Player_1234", "Player_5678", "Mod", "again"}, {"Second", "Player_1234", "Mod", "an offensive name"}, {"First", "Second", "", ""}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("history %+v, want %+v", got, want)
	}
	recent, err := s.RecentNameChanges(ctx, 2)
	if err != nil || len(recent) != 2 || recent[0].New != "Third" || recent[1].New != "Player_5678" {
		t.Fatalf("recent: %+v, %v", recent, err)
	}
	// (a year on: the oldest gone, the rest kept till theirs)
	if err := s.Purge(ctx, t0.Add(store.NameChangesKept+4*time.Minute), t0); err != nil {
		t.Fatal(err)
	}
	if history, _ := s.NameChanges(ctx, id); len(history) != 2 {
		t.Fatalf("after a year: %+v", history)
	}
	if err := s.DeleteAccount(ctx, id, func(store.Identity) []byte { return []byte("h") }, t0.Add(32*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if all, _ := s.RecentNameChanges(ctx, 100); len(all) != 1 || all[0].Account != other {
		t.Fatalf("after the account's deletion: %+v", all)
	}
}

// An admin's lock lifted (UnlockRenames): the player's renames free again, the unlock recorded with who and why, its name
// unchanged; nothing to lift, nothing recorded. A lock that's ended is cleared by the sweep (RV-1174, RV-1175)
func TestRenameLocksLiftedAndSwept(t *testing.T) {
	s, _, _ := open(t)
	ctx := context.Background()
	id, err := s.CreateAccount(ctx, pending(t, s, "google", "sub-lock", t0), "Locked", []byte("hmac-lock"), t0, t0.Add(-30*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if was, err := s.UnlockRenames(ctx, id, "Mod", "nothing to lift", t0); err != nil || was != nil {
		t.Fatalf("no lock to lift: %v, %v", was, err)
	}
	if _, _, err := s.AdminRename(ctx, id, func() string { return "Player_1111" }, "Mod", "a name", t0.Add(30*24*time.Hour), t0); err != nil {
		t.Fatal(err)
	}
	was, err := s.UnlockRenames(ctx, id, "Mod", "a mistake", t0.Add(time.Minute))
	if err != nil || was == nil || !was.Equal(t0.Add(30*24*time.Hour)) {
		t.Fatalf("UnlockRenames: %v, %v", was, err)
	}
	if err := s.Rename(ctx, id, "Free_Again", t0.Add(2*time.Minute)); err != nil {
		t.Fatalf("a rename after the unlock: %v", err)
	}
	history, err := s.NameChanges(ctx, id)
	if err != nil || len(history) != 3 || history[1].Old != "Player_1111" || history[1].New != "Player_1111" ||
		history[1].By != "Mod" || history[1].Reason != "renames unlocked: a mistake" {
		t.Fatalf("the history: %+v, %v", history, err)
	}
	// (a lock that's ended: cleared by the sweep after its end, not before)
	if _, _, err := s.AdminRename(ctx, id, func() string { return "Player_2222" }, "Mod", "again", t0.Add(time.Hour), t0.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := s.Purge(ctx, t0.Add(30*time.Minute), t0); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.RenameLockedUntil(ctx, id, t0.Add(30*time.Minute)); !ok {
		t.Fatal("a lock in force cleared by the sweep")
	}
	if err := s.Purge(ctx, t0.Add(2*time.Hour), t0); err != nil {
		t.Fatal(err)
	}
	if was, err := s.UnlockRenames(ctx, id, "Mod", "after the sweep", t0.Add(3*time.Hour)); err != nil || was != nil {
		t.Fatalf("the ended lock still stored: %v, %v", was, err)
	}
}
