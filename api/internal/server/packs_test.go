package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"carball/api/internal/packs"
	"carball/api/internal/server"
	"carball/api/internal/store"
)

// A made-up pack's file, as the page writes it (myPacks.ts packFile): `name`, `shots` copies of one shot
func packFile(name string, shots int) map[string]any {
	s := map[string]any{
		"timeLimit": 10,
		"ball":      map[string]any{"location": []any{120.5, 3010.25, 140.75}, "launch": map[string]any{"pitch": 4100, "yaw": 50123}, "speed": 1450},
		"car":       map[string]any{"location": []any{-210.5, -300.25, 17.25}, "rotation": map[string]any{"pitch": 10, "yaw": 15000, "roll": 20}, "startSpeed": 0},
	}
	list := make([]any, shots)
	for i := range list {
		list[i] = s
	}
	return map[string]any{"format": 1, "id": "mine-0abc1234", "name": name, "type": "striker", "difficulty": "easy", "tags": []any{},
		"description": "Made up for a test", "creator": "", "shots": list}
}

// writeFrom: a guarded write from another client address (its CF-Connecting-IP, trusted from loopback)
func (e *env) writeFrom(b *http.Client, method, path string, body any, ip string) reply {
	e.t.Helper()
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(context.Background(), method, e.srv.URL+path, bytes.NewReader(raw))
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("Origin", e.srv.URL)
	req.Header.Set("X-Carball", "1")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Connecting-IP", ip)
	return e.do(b, req)
}

// signedUp: a new account (its Google subject and name) signed in in a browser of its own
func (e *env) signedUp(sub, name string) (*http.Client, string) {
	e.t.Helper()
	b := e.browser()
	e.googleSignIn(b, sub)
	return b, e.signUp(b, name)["id"].(string)
}

// share: a pack shared, its code
func (e *env) share(b *http.Client, name string) string {
	e.t.Helper()
	resp := e.write(b, http.MethodPost, "/api/packs", packFile(name, 3))
	if resp.StatusCode != http.StatusCreated {
		e.t.Fatalf("share %q: %d %s", name, resp.StatusCode, resp.Body)
	}
	return decode(e.t, resp)["code"].(string)
}

// roomy: the default limits with an address's uploads out of the way (the account's own day is the database's)
func roomy() *server.Limits {
	l := server.DefaultLimits()
	l.PackUploads, l.PackUploadsWide = server.Limit{Burst: 1000, Window: time.Hour}, server.Limit{Burst: 1000, Window: time.Hour}
	return &l
}

// Shared and handed out: its code's shape, its file the canonical one (its creator the owner's display name, its id the
// shared one), its downloads counted once a day per account or per address
func TestPackShareAndDownload(t *testing.T) {
	e := setup(t, nil)
	owner, _ := e.signedUp("sub-owner", "Pack_Owner")
	code := e.share(owner, "Made Up Drills")
	if !packs.ValidCode(code) {
		t.Fatalf("code %q", code)
	}
	anon := e.browser()
	got := e.get(anon, "/api/packs/"+code, "CF-Connecting-IP", "2001:db8:1::1")
	if got.StatusCode != http.StatusOK {
		t.Fatalf("download: %d %s", got.StatusCode, got.Body)
	}
	var body struct {
		Code, Name, Creator string
		Shots               int
		Downloads           int
		Pack                map[string]any
	}
	if err := json.Unmarshal(got.Body, &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != code || body.Name != "Made Up Drills" || body.Creator != "Pack_Owner" || body.Shots != 3 || body.Downloads != 1 ||
		body.Pack["creator"] != "Pack_Owner" || body.Pack["id"] != packs.SharedID(code) || body.Pack["format"] != 1.0 {
		t.Errorf("download: %s", got.Body)
	}
	downloads := func(b *http.Client, ip string) int {
		var v struct{ Downloads int }
		_ = json.Unmarshal(e.get(b, "/api/packs/"+code, "CF-Connecting-IP", ip).Body, &v)
		return v.Downloads
	}
	// (the same address again: not counted; another: counted; the owner signed in, from any address: once)
	if n := downloads(anon, "2001:db8:1::1"); n != 1 {
		t.Errorf("the same address again: %d", n)
	}
	if n := downloads(anon, "2001:db8:2::1"); n != 2 {
		t.Errorf("another address: %d", n)
	}
	if n := downloads(owner, "2001:db8:3::1"); n != 3 {
		t.Errorf("a signed-in account: %d", n)
	}
	if n := downloads(owner, "2001:db8:4::1"); n != 3 {
		t.Errorf("the same account from another address: %d", n)
	}
	e.clock.Add(24 * time.Hour)
	if n := downloads(anon, "2001:db8:1::1"); n != 4 {
		t.Errorf("the next day: %d", n)
	}
	// (no address is kept: the viewers are an account's id or a keyed hash, its key the day's: the first address's hash
	// on the next day another, so three hashes for two addresses, RV-1203)
	if e.rows(`SELECT count(*) FROM pack_downloads WHERE position('2001:db8' in encode(viewer, 'escape')) > 0`) != 0 {
		t.Error("an address in the download records")
	}
	if n := e.rows(`SELECT count(DISTINCT viewer) FROM pack_downloads WHERE length(viewer) = 32`); n != 3 {
		t.Errorf("the addresses' hashes over two days: %d distinct, want 3", n)
	}
	if e.get(anon, "/api/packs/0000-0000-0000-0000").StatusCode != http.StatusNotFound || e.get(anon, "/api/packs/nope").StatusCode != http.StatusNotFound {
		t.Error("an unknown code not 404")
	}
}

// The checks over the wire: signed out refused; a pack's shots, fields and names as the validator says (its code and
// what in it); a body past 64 KB refused as too large; the write's guard
func TestPackChecks(t *testing.T) {
	e := setup(t, roomy())
	if resp := e.write(e.browser(), http.MethodPost, "/api/packs", packFile("Made Up", 1)); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("signed out: %d", resp.StatusCode)
	}
	b, _ := e.signedUp("sub-checks", "Checker")
	unknown := packFile("Made Up", 1)
	unknown["script"] = "x"
	for _, c := range []struct {
		name string
		body any
		code string
	}{
		{"0 shots", packFile("Made Up", 0), "pack-invalid"},
		{"51 shots", packFile("Made Up", 51), "pack-invalid"},
		{"an unknown field", unknown, "pack-invalid"},
		{"a short name", packFile("Ab", 1), "pack-name"},
		{"a non-ASCII name", packFile("Café Drills", 1), "pack-name"},
	} {
		resp := e.write(b, http.MethodPost, "/api/packs", c.body)
		if v := decode(t, resp); resp.StatusCode != http.StatusBadRequest || v["error"] != c.code {
			t.Errorf("%s: %d %v", c.name, resp.StatusCode, v)
		}
	}
	for _, n := range []int{1, 50} {
		if resp := e.write(b, http.MethodPost, "/api/packs", packFile("Made Up", n)); resp.StatusCode != http.StatusCreated {
			t.Errorf("%d shots: %d %s", n, resp.StatusCode, resp.Body)
		}
	}
	// (past 64 KB: refused before it's read)
	big := packFile("Made Up", 1)
	big["description"] = strings.Repeat("d", 70<<10)
	if resp := e.write(b, http.MethodPost, "/api/packs", big); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversize: %d", resp.StatusCode)
	}
	// (the write's guard: another origin refused)
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, e.srv.URL+"/api/packs", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://elsewhere.example")
	req.Header.Set("X-Carball", "1")
	req.Header.Set("Content-Type", "application/json")
	if resp := e.do(b, req); resp.StatusCode != http.StatusForbidden {
		t.Errorf("another origin: %d", resp.StatusCode)
	}
}

// The limits: an account's uploads a day kept in the database (a pack deleted since still counted; the next day free
// again), its packs at a time, an address's uploads (accounts behind one address together)
func TestPackLimits(t *testing.T) {
	e := setup(t, roomy())
	b, id := e.signedUp("sub-limits", "Limited")
	var codes []string
	for i := range server.PacksPerDay {
		codes = append(codes, e.share(b, fmt.Sprintf("Pack %02d", i)))
	}
	refused := func(b *http.Client) map[string]any {
		resp := e.write(b, http.MethodPost, "/api/packs", packFile("One Too Many", 1))
		v := decode(t, resp)
		v["status"] = float64(resp.StatusCode)
		return v
	}
	if v := refused(b); v["status"] != 429.0 || v["error"] != "pack-uploads" || v["seconds"] != float64(24*3600) {
		t.Errorf("the day's 11th: %v", v)
	}
	if resp := e.write(b, http.MethodDelete, "/api/packs/"+codes[0], nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	if v := refused(b); v["error"] != "pack-uploads" {
		t.Errorf("after a delete: %v", v)
	}
	e.clock.Add(24*time.Hour + time.Second)
	e.share(b, "Next Day")
	// (the account's most: filled straight in the store, then the page's upload refused)
	ctx := context.Background()
	for i := range server.PacksPerAccount - 10 {
		if _, err := e.db.CreatePack(ctx, id, store.NewPack{Name: fmt.Sprintf("Filler %d", i), Type: "striker", Difficulty: "easy", Shots: 1,
			File: func(string) ([]byte, error) { return []byte(`{}`), nil }}, e.clock.Now(), 1000, 1000); err != nil {
			t.Fatal(err)
		}
	}
	e.clock.Add(25 * time.Hour)
	if v := refused(b); v["status"] != 409.0 || v["error"] != "pack-limit" {
		t.Errorf("past the account's most: %v", v)
	}
	// (an address's uploads: two accounts behind it, its limit shared)
	l := server.DefaultLimits()
	l.PackUploads = server.Limit{Burst: 2, Window: 24 * time.Hour}
	e2 := setup(t, &l)
	one, _ := e2.signedUp("sub-a", "First_One")
	two, _ := e2.signedUp("sub-b", "Second_One")
	for i, b := range []*http.Client{one, two, two} {
		resp := e2.writeFrom(b, http.MethodPost, "/api/packs", packFile("Shared Address", 1), "2001:db8:9::1")
		if want := map[bool]int{true: http.StatusCreated, false: http.StatusTooManyRequests}[i < 2]; resp.StatusCode != want {
			t.Errorf("upload %d behind one address: %d", i+1, resp.StatusCode)
		}
	}
}

// Browse: newest first or the most downloaded, a search (any case, its wildcards literal), a page at a time by cursor;
// hidden packs and a banned owner's left out; the first page kept, but a share or a delete shows at once
func TestPackBrowse(t *testing.T) {
	e := setup(t, roomy())
	b, id := e.signedUp("sub-browse", "Browser_One")
	other, otherID := e.signedUp("sub-other", "Other_One")
	ctx := context.Background()
	// (35 packs over 35 minutes, straight in the store: the newest last)
	var all []string
	for i := range 35 {
		code, err := e.db.CreatePack(ctx, id, store.NewPack{Name: fmt.Sprintf("Drill %02d", i), Type: "striker", Difficulty: "easy", Shots: 1,
			File: func(string) ([]byte, error) { return []byte(`{}`), nil }}, e.clock.Now(), 1000, 1000)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, code)
		e.clock.Add(time.Minute)
	}
	type page struct {
		Packs []struct{ Code, Name, Creator string }
		Next  *string
	}
	read := func(query string) page {
		resp := e.get(b, "/api/packs"+query)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("browse %s: %d %s", query, resp.StatusCode, resp.Body)
		}
		var p page
		if err := json.Unmarshal(resp.Body, &p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	first := read("")
	if len(first.Packs) != server.BrowsePage || first.Packs[0].Name != "Drill 34" || first.Packs[0].Creator != "Browser_One" || first.Next == nil {
		t.Fatalf("the first page: %d, %+v", len(first.Packs), first.Packs[0])
	}
	second := read("?cursor=" + *first.Next)
	if len(second.Packs) != 5 || second.Packs[4].Name != "Drill 00" || second.Next != nil {
		t.Errorf("the second page: %+v", second)
	}
	// (the most downloaded first: two of them read)
	for _, ip := range []string{"2001:db8:a::1", "2001:db8:b::1"} {
		e.get(e.browser(), "/api/packs/"+all[3], "CF-Connecting-IP", ip)
	}
	e.get(e.browser(), "/api/packs/"+all[7], "CF-Connecting-IP", "2001:db8:a::1")
	top := read("?sort=downloads")
	if top.Packs[0].Name != "Drill 03" || top.Packs[1].Name != "Drill 07" || top.Packs[2].Name != "Drill 34" {
		t.Errorf("by downloads: %v %v %v", top.Packs[0].Name, top.Packs[1].Name, top.Packs[2].Name)
	}
	// (a search: a part of the name, any case; a % or _ literal)
	if found := read("?search=drill%201"); len(found.Packs) != 10 {
		t.Errorf("search \"drill 1\": %d", len(found.Packs))
	}
	if found := read("?search=%25"); len(found.Packs) != 0 {
		t.Errorf("search %%: %d", len(found.Packs))
	}
	for _, bad := range []string{"?sort=best", "?search=" + strings.Repeat("a", 31), "?search=%C3%A9", "?cursor=bogus"} {
		if resp := e.get(b, "/api/packs"+bad); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d", bad, resp.StatusCode)
		}
	}
	// (hidden: out of browse and the code's read; its owner still lists it, with why)
	if err := e.db.HidePack(ctx, all[34], "made-up reason", "admin", e.clock.Now()); err != nil {
		t.Fatal(err)
	}
	e.clock.Add(time.Minute) // (past the kept first page)
	if p := read(""); p.Packs[0].Name != "Drill 33" {
		t.Errorf("hidden still listed: %v", p.Packs[0].Name)
	}
	if e.get(b, "/api/packs/"+all[34]).StatusCode != http.StatusNotFound {
		t.Error("a hidden pack handed out")
	}
	var mine struct {
		Packs []struct {
			Code         string
			Hidden       bool
			HiddenReason string
		}
	}
	_ = json.Unmarshal(e.get(b, "/api/me/packs").Body, &mine)
	if len(mine.Packs) != 35 || !mine.Packs[0].Hidden || mine.Packs[0].HiddenReason != "made-up reason" {
		t.Errorf("my packs: %d %+v", len(mine.Packs), mine.Packs[0])
	}
	// (a share shows at once on the kept first page; a banned owner's packs gone)
	code := e.share(other, "Other Pack")
	if p := read(""); p.Packs[0].Code != code {
		t.Errorf("a share not shown at once: %v", p.Packs[0])
	}
	if _, err := e.db.BanAccount(ctx, otherID, "made up", "admin", store.Permanent{}, false, e.clock.Now()); err != nil {
		t.Fatal(err)
	}
	e.clock.Add(time.Minute)
	if p := read(""); p.Packs[0].Code == code {
		t.Error("a banned owner's pack listed")
	}
	if e.get(b, "/api/packs/"+code).StatusCode != http.StatusNotFound {
		t.Error("a banned owner's pack handed out")
	}
}

// Reports: signed in, once per account per pack (again the same), an unknown code 404; delete: the owner's alone; the
// account's deletion takes its packs with it
func TestPackReportsAndDeletes(t *testing.T) {
	e := setup(t, roomy())
	owner, ownerID := e.signedUp("sub-o", "Owner_One")
	reporter, _ := e.signedUp("sub-r", "Reporter_One")
	code := e.share(owner, "Reported Pack")
	if resp := e.write(e.browser(), http.MethodPost, "/api/packs/"+code+"/report", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("signed out: %d", resp.StatusCode)
	}
	for range 2 {
		if resp := e.write(reporter, http.MethodPost, "/api/packs/"+code+"/report", nil); resp.StatusCode != http.StatusNoContent {
			t.Errorf("report: %d", resp.StatusCode)
		}
	}
	reported, err := e.db.ReportedPacks(context.Background())
	if err != nil || len(reported) != 1 || reported[0].Reports != 1 || reported[0].Owner != ownerID {
		t.Errorf("reported: %+v %v", reported, err)
	}
	if resp := e.write(reporter, http.MethodPost, "/api/packs/0000-0000-0000-0000/report", nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("an unknown pack's report: %d", resp.StatusCode)
	}
	// (its own: refused, not recorded, RV-1203)
	if resp := e.write(owner, http.MethodPost, "/api/packs/"+code+"/report", nil); resp.StatusCode != http.StatusBadRequest ||
		!strings.Contains(string(resp.Body), `"pack-own"`) {
		t.Errorf("a report of its own: %d %s", resp.StatusCode, resp.Body)
	}
	if n := e.rows(`SELECT count(*) FROM pack_reports`); n != 1 {
		t.Errorf("reports after its own: %d", n)
	}
	if resp := e.write(reporter, http.MethodDelete, "/api/packs/"+code, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("another's delete: %d", resp.StatusCode)
	}
	if resp := e.write(owner, http.MethodDelete, "/api/packs/"+code, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("the owner's delete: %d", resp.StatusCode)
	}
	if e.get(reporter, "/api/packs/"+code).StatusCode != http.StatusNotFound || e.rows(`SELECT count(*) FROM pack_reports`) != 0 {
		t.Error("a deleted pack still there")
	}
	// (the account deleted: its packs with it, and the downloads it was counted for, RV-1203)
	e.share(owner, "Goes With Me")
	theirs := e.share(reporter, "Stays Here")
	if e.get(owner, "/api/packs/"+theirs).StatusCode != http.StatusOK {
		t.Fatal("a download")
	}
	if n := e.rows(`SELECT count(*) FROM pack_downloads WHERE viewer = uuid_send($1::uuid)`, ownerID); n != 1 {
		t.Fatalf("the account's download records: %d", n)
	}
	if resp := e.write(owner, http.MethodDelete, "/api/me", map[string]bool{"confirm": true}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("account delete: %d", resp.StatusCode)
	}
	if e.rows(`SELECT count(*) FROM training_packs WHERE name <> 'Stays Here'`) != 0 || e.rows(`SELECT count(*) FROM pack_uploads WHERE account_id = $1`, ownerID) != 0 {
		t.Error("an account's packs kept after its deletion")
	}
	if n := e.rows(`SELECT count(*) FROM pack_downloads WHERE viewer = uuid_send($1::uuid)`, ownerID); n != 0 {
		t.Errorf("the account's download records after its deletion: %d", n)
	}
}

// slowBrowse is the store with its next browse read held (once armed) after reading, till released: a read in flight
type slowBrowse struct {
	server.Store
	armed         atomic.Bool
	read, release chan struct{}
}

func (s *slowBrowse) BrowsePacks(ctx context.Context, search string, byDownloads bool, after *store.PackCursor, n int, now time.Time) ([]store.SharedPack, error) {
	rows, err := s.Store.BrowsePacks(ctx, search, byDownloads, after, n, now)
	if s.armed.CompareAndSwap(true, false) {
		close(s.read)
		<-s.release
	}
	return rows, err
}

// The kept first page never shows a pack gone (RV-1198): a delete during a read in flight (that read not kept, an ask
// after the delete not joining it); an account deleted with its packs; an admin's hide (another process) within
// BrowseKept
func TestPackBrowseKeptForgets(t *testing.T) {
	e := setup(t, roomy())
	slow := &slowBrowse{Store: e.db, read: make(chan struct{}), release: make(chan struct{})}
	e.s.Store = slow
	owner, _ := e.signedUp("sub-kept", "Kept_Owner")
	leaver, _ := e.signedUp("sub-leaver", "Leaving_Owner")
	stays := e.share(owner, "Stays Listed")
	deleted := e.share(owner, "Deleted Mid Read")
	goes := e.share(leaver, "Goes With Account")
	b := e.browser()
	listed := func() []string {
		t.Helper()
		resp := e.get(b, "/api/packs")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("browse: %d %s", resp.StatusCode, resp.Body)
		}
		var p struct{ Packs []struct{ Code string } }
		if err := json.Unmarshal(resp.Body, &p); err != nil {
			t.Fatal(err)
		}
		var codes []string
		for _, pk := range p.Packs {
			codes = append(codes, pk.Code)
		}
		return codes
	}
	// (a read held in flight with the pack in it; the pack deleted; an ask meanwhile reads again, without it)
	slow.armed.Store(true)
	first := make(chan []string)
	go func() { first <- listed() }()
	<-slow.read
	if resp := e.write(owner, http.MethodDelete, "/api/packs/"+deleted, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	if codes := listed(); slices.Contains(codes, deleted) || !slices.Contains(codes, stays) {
		t.Errorf("an ask after the delete, the read before it in flight: %v", codes)
	}
	close(slow.release)
	<-first
	if codes := listed(); slices.Contains(codes, deleted) {
		t.Errorf("the read begun before the delete kept: %v", codes)
	}
	// (an account deleted: its pack off the kept page at once)
	if !slices.Contains(listed(), goes) {
		t.Fatal("the leaver's pack not listed")
	}
	if resp := e.write(leaver, http.MethodDelete, "/api/me", map[string]bool{"confirm": true}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("account delete: %d", resp.StatusCode)
	}
	if codes := listed(); slices.Contains(codes, goes) {
		t.Errorf("a deleted account's pack still listed: %v", codes)
	}
	// (the admin's hide, from another process: gone once BrowseKept is over)
	if err := e.db.HidePack(context.Background(), stays, "made-up reason", "admin", e.clock.Now()); err != nil {
		t.Fatal(err)
	}
	e.clock.Add(server.BrowseKept)
	if codes := listed(); slices.Contains(codes, stays) {
		t.Errorf("a hidden pack listed after BrowseKept: %v", codes)
	}
}
