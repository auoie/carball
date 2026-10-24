package server_test

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"carball/api/internal/server"
	"carball/api/internal/ticket"
)

// (made-up accounts, servers and pings throughout)

const euServer = "game-eu.example:4433"

// searchAs starts a search as the page does; its reply
func (e *env) searchAs(b *http.Client, playlists []int, pings map[string]int) reply {
	e.t.Helper()
	regions := []string{}
	for server := range pings {
		regions = append(regions, server)
	}
	resp := e.write(b, http.MethodPost, "/api/search", map[string]any{"playlists": playlists, "pings": pings, "regions": regions})
	// (its page's first poll, at once: only a polled search is matched, RV-892)
	if resp.StatusCode == http.StatusOK {
		if id, _ := decode(e.t, resp)["search"].(string); id != "" {
			e.poll(b, id, 0)
		}
	}
	return resp
}

// poll: a search's state past version `after` as the browser `b` asks it (no wait: the change already made)
func (e *env) poll(b *http.Client, id string, after int) (int, map[string]any) {
	e.t.Helper()
	resp := e.get(b, fmt.Sprintf("/api/search/%s?after=%d", id, after))
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, nil
	}
	return resp.StatusCode, decode(e.t, resp)
}

// The page's search: started signed in (a session's account, its ratings), found with a match ticket for its seat at
// the server both ticked, the account then in that match (a search refused, a rejoin of it alone) until its result
func TestSearch(t *testing.T) {
	e := setup(t, nil)
	ba, _, _ := e.player("sub-sa")
	bb, _, _ := e.player("sub-sb")
	pings := map[string]int{euServer: 30}
	if resp := e.searchAs(e.browser(), []int{1}, pings); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("signed out: %d", resp.StatusCode)
	}
	for _, bad := range []map[string]any{
		{"playlists": []int{}, "pings": pings},
		{"playlists": []int{4}, "pings": pings},
		{"playlists": []int{1, 1}, "pings": pings},
	} {
		if resp := e.write(ba, http.MethodPost, "/api/search", bad); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%v: %d", bad, resp.StatusCode)
		}
	}
	if resp := e.searchAs(ba, []int{1}, map[string]int{}); resp.StatusCode != http.StatusServiceUnavailable || decode(t, resp)["error"] != "no-server" {
		t.Errorf("no server answered: %d", resp.StatusCode)
	}
	// (only odd names or pings: dropped, so no server answered)
	for _, pings := range []map[string]int{{"no port": 30}, {euServer: -1}} {
		if resp := e.searchAs(ba, []int{1}, pings); resp.StatusCode != http.StatusServiceUnavailable {
			t.Errorf("%v: %d", pings, resp.StatusCode)
		}
	}
	// (an odd server name, one given twice, an IPv6 literal or a ping out of range: dropped, not the search; the good
	// ones searched, RV-868)
	odd := e.write(ba, http.MethodPost, "/api/search", map[string]any{
		"playlists": []int{1},
		"pings":     map[string]int{"bad_name:4433": 20, "[::1]:4433": 5, euServer: 30, "game-asia.example:4433": 99999},
		"regions":   []string{"bad_name:4433", euServer, euServer},
	})
	if odd.StatusCode != http.StatusOK {
		t.Fatalf("a search with an odd name among good ones: %d %s", odd.StatusCode, odd.Body)
	}
	e.write(ba, http.MethodDelete, "/api/search/"+decode(t, odd)["search"].(string), nil)
	ra := decode(t, e.searchAs(ba, []int{1, 2}, map[string]int{euServer: 30, "game-us.example:4433": 90}))
	rb := decode(t, e.searchAs(bb, []int{1}, map[string]int{euServer: 80}))
	if ra["state"] != "searching" || ra["version"].(float64) != 1 {
		t.Fatalf("a search's start: %v", ra)
	}
	idA, idB := ra["search"].(string), rb["search"].(string)
	e.s.Matchmaker.Tick(e.clock.Now())
	_, fa := e.poll(ba, idA, 1)
	_, fb := e.poll(bb, idB, 1)
	ma, _ := fa["match"].(map[string]any)
	mb, _ := fb["match"].(map[string]any)
	if fa["state"] != "found" || ma == nil || mb == nil || ma["id"] != mb["id"] || ma["server"] != euServer || ma["playlist"].(float64) != 1 {
		t.Fatalf("found: %v / %v", fa, fb)
	}
	// (each one's ticket: their seat of that match at that server, signed by the service)
	seats := map[byte]bool{}
	for _, m := range []map[string]any{ma, mb} {
		tk, err := ticket.Verify(m["ticket"].(string), map[string]ed25519.PublicKey{e.s.Tickets.KeyID: e.s.Tickets.PublicKey()}, e.clock.Now(), 30*time.Second)
		if err != nil || tk.Purpose != ticket.PurposeSeat || fmt.Sprintf("%016x", tk.Match) != m["id"] || tk.Server != euServer || tk.Roster != 2 {
			t.Fatalf("a match ticket: %+v, %v", tk, err)
		}
		seats[tk.Seat] = true
	}
	if !seats[0] || !seats[1] {
		t.Errorf("the seats: %v", seats)
	}
	// (started: in that match, a search refused, a rejoin ticket of it alone)
	if resp := e.gameCall(http.MethodPost, "/api/fleet/events", gameToken, map[string]any{"event": "started", "match": ma["id"], "server": euServer}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("started: %d", resp.StatusCode)
	}
	if resp := e.searchAs(ba, []int{1}, pings); resp.StatusCode != http.StatusForbidden || decode(t, resp)["error"] != "in-match" {
		t.Errorf("a search in a match: %d", resp.StatusCode)
	}
	if resp := e.write(ba, http.MethodPost, "/api/ticket?rejoin="+ma["id"].(string), nil); resp.StatusCode != http.StatusOK {
		t.Errorf("its match's rejoin: %d", resp.StatusCode)
	}
	if resp := e.write(ba, http.MethodPost, "/api/ticket?rejoin=00000000000000ff", nil); resp.StatusCode != http.StatusConflict || decode(t, resp)["error"] != "in-match" {
		t.Errorf("another match's rejoin: %d", resp.StatusCode)
	}
	// (its result, with the match tickets: recorded, and the accounts free)
	result := map[string]any{"match": ma["id"], "server": euServer, "playlist": 1, "winningTeam": 0, "players": []map[string]any{
		{"ticket": ma["ticket"], "team": 0, "quitter": false, "seconds": 300}, {"ticket": mb["ticket"], "team": 1, "quitter": false, "seconds": 300},
	}}
	if seatOf(t, e, ma) != 0 {
		result["players"].([]map[string]any)[0]["team"], result["players"].([]map[string]any)[1]["team"] = 1, 0
	}
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result); resp.StatusCode != http.StatusOK || decode(t, resp)["recorded"] != true {
		t.Fatalf("the result with match tickets: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := e.searchAs(ba, []int{1}, pings); resp.StatusCode != http.StatusOK {
		t.Errorf("a search after the result: %d", resp.StatusCode)
	}
	// (a match ticket for another match's result: refused)
	other := result
	other["match"] = "00000000000000aa"
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, other); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a match ticket in another match's result: %d", resp.StatusCode)
	}
}

// seatOf: a found match's seat (its ticket's)
func seatOf(t *testing.T, e *env, m map[string]any) byte {
	t.Helper()
	tk, err := ticket.VerifySigned(m["ticket"].(string), map[string]ed25519.PublicKey{e.s.Tickets.KeyID: e.s.Tickets.PublicKey()})
	if err != nil {
		t.Fatal(err)
	}
	return tk.Seat
}

// The polls: an unknown search 404 (the page searches again), a newer search of the account replaces the open one,
// Cancel Search ends it, a long poll answers at the change
func TestSearchPolls(t *testing.T) {
	e := setup(t, nil)
	b, _, _ := e.player("sub-sp")
	if code, _ := e.poll(b, strings.Repeat("ab", 16), 0); code != http.StatusNotFound {
		t.Errorf("an unknown search: %d", code)
	}
	if code, _ := e.poll(b, "short", 0); code != http.StatusBadRequest {
		t.Errorf("a malformed id: %d", code)
	}
	first := decode(t, e.searchAs(b, []int{2}, map[string]int{euServer: 40}))["search"].(string)
	second := decode(t, e.searchAs(b, []int{2}, map[string]int{euServer: 40}))["search"].(string)
	if _, st := e.poll(b, first, 1); st["state"] != "ended" || st["reason"] != "replaced" {
		t.Errorf("the replaced search: %v", st)
	}
	// (another account's delete, or one with no session, ends nothing: RV-896)
	other, _, _ := e.player("sub-other")
	if resp := e.write(other, http.MethodDelete, "/api/search/"+second, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("another account's Cancel Search: %d", resp.StatusCode)
	}
	if resp := e.write(e.browser(), http.MethodDelete, "/api/search/"+second, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a Cancel Search with no session: %d", resp.StatusCode)
	}
	if _, st := e.poll(b, second, 0); st["state"] != "searching" {
		t.Errorf("a search another account cancelled: %v", st)
	}
	if resp := e.write(b, http.MethodDelete, "/api/search/"+second, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("Cancel Search: %d", resp.StatusCode)
	}
	if _, st := e.poll(b, second, 1); st["reason"] != "cancelled" {
		t.Errorf("a cancelled search: %v", st)
	}
	// (the session's account's own search alone: no session, 401; another account's, as unknown, RV-871)
	if code, _ := e.poll(e.browser(), second, 0); code != http.StatusUnauthorized {
		t.Errorf("a poll with no session: %d", code)
	}
	if code, _ := e.poll(other, second, 0); code != http.StatusNotFound {
		t.Errorf("another account's poll: %d", code)
	}
	// (a poll waiting: answered when the match forms)
	bc, _, _ := e.player("sub-sc")
	bd, _, _ := e.player("sub-sd")
	c := decode(t, e.searchAs(bc, []int{1}, map[string]int{euServer: 40}))["search"].(string)
	answered := make(chan map[string]any, 1)
	go func() {
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, e.srv.URL+"/api/search/"+c+"?after=1", nil)
		resp, err := bc.Do(req)
		if err != nil {
			answered <- nil
			return
		}
		defer func() { _ = resp.Body.Close() }()
		read, _ := io.ReadAll(resp.Body)
		answered <- decode(t, reply{StatusCode: resp.StatusCode, Body: read})
	}()
	time.Sleep(100 * time.Millisecond)
	e.searchAs(bd, []int{1}, map[string]int{euServer: 50})
	e.s.Matchmaker.Tick(e.clock.Now())
	select {
	case st := <-answered:
		if st["state"] != "found" {
			t.Errorf("the waiting poll's answer: %v", st)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the waiting poll wasn't answered at the match")
	}
}

// The game servers' events, each naming its server: started holds the players (a search refused), a leave lets the
// leaver search, over frees them, a cancel gives the no-show its cooldown (the other free), a restart frees the
// server's matches; an event about a match it doesn't know is taken and ignored (MX1R-2); bad events refused
func TestFleetEvents(t *testing.T) {
	e := setup(t, nil)
	b1, _, _ := e.player("sub-f1")
	b2, _, _ := e.player("sub-f2")
	pings := map[string]int{euServer: 30}
	match := func() (map[string]any, map[string]any) {
		s1 := decode(t, e.searchAs(b1, []int{1}, pings))["search"].(string)
		s2 := decode(t, e.searchAs(b2, []int{1}, pings))["search"].(string)
		e.s.Matchmaker.Tick(e.clock.Now())
		_, f1 := e.poll(b1, s1, 1)
		_, f2 := e.poll(b2, s2, 1)
		m1, _ := f1["match"].(map[string]any)
		m2, _ := f2["match"].(map[string]any)
		if m1 == nil || m2 == nil {
			t.Fatalf("not matched: %v %v", f1, f2)
		}
		return m1, m2
	}
	event := func(body map[string]any) int {
		if _, ok := body["server"]; !ok {
			body["server"] = euServer
		}
		return e.gameCall(http.MethodPost, "/api/fleet/events", gameToken, body).StatusCode
	}
	searchCode := func(b *http.Client) int {
		resp := e.searchAs(b, []int{1}, pings)
		if resp.StatusCode == http.StatusOK {
			e.write(b, http.MethodDelete, "/api/search/"+decode(t, resp)["search"].(string), nil)
		}
		return resp.StatusCode
	}
	m1, _ := match()
	if code := e.gameCall(http.MethodPost, "/api/fleet/events", "", map[string]any{"event": "started", "match": m1["id"], "server": euServer}).StatusCode; code != http.StatusUnauthorized {
		t.Errorf("no credential: %d", code)
	}
	if code := event(map[string]any{"event": "started", "match": m1["id"]}); code != http.StatusNoContent {
		t.Fatalf("started: %d", code)
	}
	if code := searchCode(b1); code != http.StatusForbidden {
		t.Errorf("a started match's player searching: %d", code)
	}
	if code := event(map[string]any{"event": "left", "match": m1["id"], "seat": int(seatOf(t, e, m1))}); code != http.StatusNoContent {
		t.Fatalf("left: %d", code)
	}
	if code := searchCode(b1); code != http.StatusOK {
		t.Errorf("a leaver searching: %d", code)
	}
	if code := searchCode(b2); code != http.StatusForbidden {
		t.Errorf("the one still playing: %d", code)
	}
	if code := event(map[string]any{"event": "over", "match": m1["id"]}); code != http.StatusNoContent {
		t.Fatalf("over: %d", code)
	}
	if code := searchCode(b2); code != http.StatusOK {
		t.Errorf("after over: %d", code)
	}
	// (events about a match it doesn't know, or another server's: taken, nothing changes)
	for _, ev := range []map[string]any{
		{"event": "started", "match": "00000000000000ab"},
		{"event": "cancelled", "match": "00000000000000ab", "noShows": []int{0}},
		{"event": "over", "match": m1["id"], "server": "game-us.example:4433"},
	} {
		if code := event(ev); code != http.StatusNoContent {
			t.Errorf("%v: %d", ev, code)
		}
	}
	// (a cancel: player 2's seat a no-show; its cooldown, player 1 free)
	e.clock.Add(time.Minute)
	m1, m2 := match()
	if code := event(map[string]any{"event": "cancelled", "match": m1["id"], "noShows": []int{int(seatOf(t, e, m2))}}); code != http.StatusNoContent {
		t.Fatalf("cancelled: %d", code)
	}
	resp := e.searchAs(b2, []int{1}, pings)
	if resp.StatusCode != http.StatusTooManyRequests || decode(t, resp)["error"] != "cooldown" || decode(t, resp)["seconds"].(float64) != 120 {
		t.Errorf("the no-show's search: %d %s", resp.StatusCode, resp.Body)
	}
	if code := searchCode(b1); code != http.StatusOK {
		t.Errorf("the one who came: %d", code)
	}
	// (the no-show's cooldown on its account's page, the Play page's line; none for the one who came)
	if got := decode(t, e.get(b2, "/api/me"))["searchCooldownSeconds"]; got != float64(120) {
		t.Errorf("the no-show's cooldown on /api/me: %v, want 120 s", got)
	}
	if got, ok := decode(t, e.get(b1, "/api/me"))["searchCooldownSeconds"]; ok {
		t.Errorf("a cooldown for the one who came: %v", got)
	}
	// (a restart of the server: its matches before it freed)
	e.clock.Add(3 * time.Minute)
	m1, _ = match()
	event(map[string]any{"event": "started", "match": m1["id"]})
	if code := searchCode(b1); code != http.StatusForbidden {
		t.Fatalf("matched again and started, then a search: %d", code)
	}
	if code := event(map[string]any{"event": "restarted", "at": e.clock.Now().Add(time.Hour).Unix()}); code != http.StatusNoContent {
		t.Fatalf("restarted: %d", code)
	}
	if code := searchCode(b1); code != http.StatusOK {
		t.Errorf("after the server's restart: %d", code)
	}
	for _, bad := range []map[string]any{
		{"event": "started", "match": "xyz"},
		{"event": "begun", "match": m1["id"]},
		{"event": "cancelled", "match": m1["id"], "noShows": []int{6}},
		{"event": "left", "match": m1["id"]},
		{"event": "left", "match": m1["id"], "seat": 9},
		{"event": "started", "match": m1["id"], "server": "no port"},
		{"event": "restarted"},
		{"event": "started", "match": "0000000000000000"},
		{"event": "started", "match": "abc"},
	} {
		if code := event(bad); code != http.StatusBadRequest {
			t.Errorf("%v: %d", bad, code)
		}
	}
}

// A quitter's report: the account's running search ended with its ban, its next one refused till the ban's end
func TestQuitterEndsSearch(t *testing.T) {
	e := setup(t, nil)
	b, _, encoded := e.player("sub-q")
	id := decode(t, e.searchAs(b, []int{3}, map[string]int{euServer: 30}))["search"].(string)
	if resp := e.gameCall(http.MethodPost, "/api/quitters", gameToken, map[string]any{"match": testMatch, "ticket": encoded}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("the report: %d", resp.StatusCode)
	}
	_, st := e.poll(b, id, 1)
	if st["state"] != "ended" || st["reason"] != "queue-banned" || st["seconds"] != float64(300) {
		t.Errorf("the quitter's search: %v", st)
	}
	if resp := e.searchAs(b, []int{3}, map[string]int{euServer: 30}); resp.StatusCode != http.StatusForbidden || decode(t, resp)["error"] != "queue-banned" {
		t.Errorf("the quitter's next search: %d", resp.StatusCode)
	}
}

// A quitter's report late enough that its ban is over (a first leave's 5 minutes, the leave 10 minutes ago): the
// account's running search goes on (RV-965)
func TestALateQuitterReportLeavesASearchAlone(t *testing.T) {
	e := setup(t, nil)
	b, _, encoded := e.player("sub-late")
	id := decode(t, e.searchAs(b, []int{3}, map[string]int{euServer: 30}))["search"].(string)
	body := map[string]any{"match": testMatch, "ticket": encoded, "at": e.clock.Now().Add(-10 * time.Minute).Unix()}
	if resp := e.gameCall(http.MethodPost, "/api/quitters", gameToken, body); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("the report: %d", resp.StatusCode)
	}
	if _, st := e.poll(b, id, 0); st["state"] != "searching" {
		t.Errorf("the search after a late report: %v", st)
	}
}

// The searches' own limit per account
func TestSearchLimit(t *testing.T) {
	limits := server.DefaultLimits()
	limits.Searches = server.Limit{Burst: 2, Window: 10 * time.Minute}
	e := setup(t, &limits)
	b, _, _ := e.player("sub-sl")
	codes := []int{}
	for range 3 {
		codes = append(codes, e.searchAs(b, []int{1}, map[string]int{euServer: 30}).StatusCode)
	}
	if codes[0] != http.StatusOK || codes[1] != http.StatusOK || codes[2] != http.StatusTooManyRequests {
		t.Errorf("the searches' limit: %v", codes)
	}
}

// A search's poll never rotates the session (its answer, and a new cookie with it, may never reach the page: a poll
// aborted by Cancel Search or the page going): a day on, a poll leaves the token as it was, and the next ordinary call
// rotates it (RV-889)
func TestPollDoesNotRotateTheSession(t *testing.T) {
	e := setup(t, nil)
	b, _, _ := e.player("sub-rot")
	u, _ := url.Parse(e.srv.URL)
	first := sessionToken(b, u)
	id := decode(t, e.searchAs(b, []int{1}, map[string]int{euServer: 30}))["search"].(string)
	e.clock.Add(25 * time.Hour)
	// (the poll as an aborted one would have left it: its reply's cookies not kept)
	bare := &http.Client{Transport: b.Transport, Timeout: 5 * time.Second}
	resp := e.get(bare, "/api/search/"+id+"?after=0", "Cookie", "__Host-cb_session="+first)
	if resp.StatusCode != http.StatusOK || len(resp.Header.Values("Set-Cookie")) != 0 {
		t.Fatalf("a poll a day on: %d, cookies %v", resp.StatusCode, resp.Header.Values("Set-Cookie"))
	}
	// (past the grace a rotation would have started, the original token still good; the next call rotates it)
	e.clock.Add(11 * time.Minute)
	if code := e.get(bare, "/api/search/"+id+"?after=0", "Cookie", "__Host-cb_session="+first).StatusCode; code == http.StatusUnauthorized {
		t.Fatalf("the original token past a rotation's grace, after a poll a day on: %d", code)
	}
	if e.meStatus(b) != http.StatusOK || sessionToken(b, u) == first {
		t.Error("the next ordinary call didn't rotate it")
	}
}

// Cancel Search's DELETE never rotates the session either (it often goes as its page does, its answer never read): a day
// on, it sets no cookie, the token stays good past a rotation's grace, and the next ordinary call rotates it (RV-905)
func TestCancelDoesNotRotateTheSession(t *testing.T) {
	e := setup(t, nil)
	b, _, _ := e.player("sub-rot-del")
	u, _ := url.Parse(e.srv.URL)
	first := sessionToken(b, u)
	id := decode(t, e.searchAs(b, []int{1}, map[string]int{euServer: 30}))["search"].(string)
	e.clock.Add(25 * time.Hour)
	// (the delete as a page going sends it: its reply's cookies never kept)
	bare := &http.Client{Transport: b.Transport, Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodDelete, e.srv.URL+"/api/search/"+id, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", e.srv.URL)
	req.Header.Set("X-Carball", "1")
	req.Header.Set("Cookie", "__Host-cb_session="+first)
	resp, err := bare.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent || len(resp.Header.Values("Set-Cookie")) != 0 {
		t.Fatalf("a Cancel Search a day on: %d, cookies %v", resp.StatusCode, resp.Header.Values("Set-Cookie"))
	}
	// (past the grace a rotation would have started, the original token still good)
	e.clock.Add(11 * time.Minute)
	if code := e.get(bare, "/api/search/"+id+"?after=0", "Cookie", "__Host-cb_session="+first).StatusCode; code == http.StatusUnauthorized {
		t.Fatal("the original token refused after a Cancel Search a day on")
	}
	if e.meStatus(b) != http.StatusOK || sessionToken(b, u) == first {
		t.Error("the next ordinary call didn't rotate it")
	}
}

// RV-1008: a game server's rejoin question (POST /api/fleet/rejoin, its token): the rejoin's ticket checked as ours, then
// true while the account's latest match is still that one at that server; false asked by another server, or once the
// account searched since (its ticket from before would put it in two matches); a seat's ticket, or no token, refused
func TestFleetRejoinQuestion(t *testing.T) {
	e := setup(t, nil)
	b1, _, _ := e.player("sub-r1")
	b2, _, _ := e.player("sub-r2")
	pings := map[string]int{euServer: 30}
	s1 := decode(t, e.searchAs(b1, []int{1}, pings))["search"].(string)
	s2 := decode(t, e.searchAs(b2, []int{1}, pings))["search"].(string)
	e.s.Matchmaker.Tick(e.clock.Now())
	_, f1 := e.poll(b1, s1, 1)
	e.poll(b2, s2, 1)
	m1, _ := f1["match"].(map[string]any)
	if m1 == nil {
		t.Fatalf("not matched: %v", f1)
	}
	match := m1["id"].(string)
	event := func(body map[string]any) {
		body["server"] = euServer
		if code := e.gameCall(http.MethodPost, "/api/fleet/events", gameToken, body).StatusCode; code != http.StatusNoContent {
			t.Fatalf("%v: %d", body, code)
		}
	}
	event(map[string]any{"event": "started", "match": match})
	event(map[string]any{"event": "left", "match": match, "seat": int(seatOf(t, e, m1))})
	resp := e.write(b1, http.MethodPost, "/api/ticket?rejoin="+match, nil)
	rejoin, _ := decode(t, resp)["ticket"].(string)
	if resp.StatusCode != http.StatusOK || rejoin == "" {
		t.Fatalf("the leaver's rejoin ticket: %d", resp.StatusCode)
	}
	ask := func(server, tk, token string) (int, any) {
		resp := e.gameCall(http.MethodPost, "/api/fleet/rejoin", token, map[string]string{"match": match, "server": server, "ticket": tk})
		if resp.StatusCode != http.StatusOK {
			return resp.StatusCode, nil
		}
		return resp.StatusCode, decode(t, resp)["rejoin"]
	}
	if code, ok := ask(euServer, rejoin, gameToken); code != http.StatusOK || ok != true {
		t.Errorf("an ordinary rejoin: %d %v", code, ok)
	}
	if code, ok := ask("game-us.example:4433", rejoin, gameToken); code != http.StatusOK || ok != false {
		t.Errorf("asked by another server: %d %v", code, ok)
	}
	if code, _ := ask(euServer, rejoin, ""); code != http.StatusUnauthorized {
		t.Errorf("no token: %d", code)
	}
	if code, _ := ask(euServer, m1["ticket"].(string), gameToken); code != http.StatusForbidden {
		t.Errorf("a seat's ticket: %d", code)
	}
	if resp := e.searchAs(b1, []int{1}, pings); resp.StatusCode != http.StatusOK {
		t.Fatalf("the leaver's search: %d", resp.StatusCode)
	}
	if code, ok := ask(euServer, rejoin, gameToken); code != http.StatusOK || ok != false {
		t.Errorf("a rejoin after the account's search: %d %v", code, ok)
	}
}

// RV-1020: rejoin questions on their own budgets: each account's (here 2), then everyone's; never the game servers'
// outbox budget, which is each server's own (by its X-Carball-Server name: here 3), so neither a replayed rejoin
// ticket nor one server's burst holds another server's results and events
func TestRejoinQuestionsAndEachServerOnTheirOwnBudgets(t *testing.T) {
	limits := server.DefaultLimits()
	limits.GameServer = server.Limit{Burst: 3, Window: time.Minute}
	limits.RejoinQuestions = server.Limit{Burst: 2, Window: 10 * time.Minute}
	e := setup(t, &limits)
	b1, _, _ := e.player("sub-q1")
	b2, _, _ := e.player("sub-q2")
	pings := map[string]int{euServer: 30}
	s1 := decode(t, e.searchAs(b1, []int{1}, pings))["search"].(string)
	s2 := decode(t, e.searchAs(b2, []int{1}, pings))["search"].(string)
	e.s.Matchmaker.Tick(e.clock.Now())
	_, f1 := e.poll(b1, s1, 1)
	e.poll(b2, s2, 1)
	m1, _ := f1["match"].(map[string]any)
	if m1 == nil {
		t.Fatalf("not matched: %v", f1)
	}
	match := m1["id"].(string)
	resp := e.write(b1, http.MethodPost, "/api/ticket?rejoin="+match, nil)
	rejoin, _ := decode(t, resp)["ticket"].(string)
	if rejoin == "" {
		t.Fatalf("the rejoin ticket: %d", resp.StatusCode)
	}
	ask := func() int {
		return e.gameCallAs(euServer, http.MethodPost, "/api/fleet/rejoin", gameToken, map[string]string{"match": match, "server": euServer, "ticket": rejoin}).StatusCode
	}
	got := []int{}
	for range 10 {
		got = append(got, ask())
	}
	if want := []int{200, 200, 429, 429, 429, 429, 429, 429, 429, 429}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("the account's rejoin questions: %v, want %v", got, want)
	}
	event := func(from string) int {
		return e.gameCallAs(from, http.MethodPost, "/api/fleet/events", gameToken, map[string]any{"event": "started", "match": "00000000000000ab", "server": euServer}).StatusCode
	}
	got = []int{}
	for range 4 {
		got = append(got, event(euServer))
	}
	if want := []int{204, 204, 204, 429}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("a server's calls after the rejoin questions: %v, want its own 3 then 429", got)
	}
	if code := event("game-us.example:4433"); code != http.StatusNoContent {
		t.Errorf("another server's call after the first's ran out: %d", code)
	}
}
