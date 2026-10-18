package store_test

import (
	"context"
	"errors"
	"os"
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
	// (a banned identity: refused, the ban carried)
	if _, err := s.BanIdentity(ctx, store.Identity{Provider: store.Steam, Subject: "76561190000000002"}, "cheating", "admin",
		store.Permanent{}, t0); err != nil {
		t.Fatal(err)
	}
	var banned store.BannedError
	_, err := s.CreateAccount(ctx, pending(t, s, "steam", "76561190000000002", t0), "B", []byte("h"), t0, t0)
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
	if _, err := s.BanIdentity(ctx, store.Identity{Provider: store.Google, Subject: "sub-s"}, "x", "admin", store.Until{At: day.Add(time.Hour)}, day); err != nil {
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
	ids, err := s.BanAccount(ctx, id, "abuse", "admin", store.Until{At: until}, t0)
	if err != nil || len(ids) != 1 {
		t.Fatalf("BanAccount = %v, %v", ids, err)
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
	// (banned by an identity: its account's every identity; then lifted)
	if _, err := s.BanIdentity(ctx, store.Identity{Provider: store.Google, Subject: "sub-b"}, "again", "admin", store.Permanent{}, t0); err != nil {
		t.Fatal(err)
	}
	if n, err := s.Unban(ctx, store.Identity{Provider: store.Google, Subject: "sub-b"}); err != nil || n != 1 {
		t.Errorf("Unban = %d, %v", n, err)
	}
	if _, banned, _ := s.BanOn(ctx, "google", "sub-b", t0); banned {
		t.Error("still banned after the unban")
	}
	if _, err := s.BanAccount(ctx, "00000000-0000-0000-0000-000000000000", "x", "admin", store.Permanent{}, t0); !errors.Is(err, store.ErrNoAccount) {
		t.Errorf("banning no account: %v", err)
	}
	found, err := s.FindAccounts(ctx, "bann")
	if err != nil || len(found) != 1 || found[0].ID != id || found[0].Identities[0].Subject != "sub-b" {
		t.Errorf("FindAccounts = %+v, %v", found, err)
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
