package matchmaker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"carball/api/internal/ticket"
)

// (made-up accounts, servers, pings and ratings throughout)

var t0 = time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)

type harness struct {
	m      *Matchmaker
	now    time.Time
	issued []ticket.Seat
	ids    map[string]string // each account's latest search
}

func newHarness() *harness {
	h := &harness{now: t0, ids: map[string]string{}}
	h.m = New(func(p Player, seat ticket.Seat, _ time.Time) (string, error) {
		h.issued = append(h.issued, seat)
		return fmt.Sprintf("ticket:%s:%d", p.Account, seat.Seat), nil
	}, func() time.Time { return h.now }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return h
}

// player is an account with one rating in every playlist
func player(account string, rating uint16) Player {
	r := ticket.Shown{Rating: rating, Deviation: 100}
	return Player{Account: account, Name: "Name " + account, Ratings: [3]ticket.Shown{r, r, r}}
}

var near = map[string]int{"eu:4433": 30}

// req is a search of these playlists that ticked every server it pinged
func req(playlists []byte, pings map[string]int) Request {
	ticked := make([]string, 0, len(pings))
	for s := range pings {
		ticked = append(ticked, s)
	}
	return Request{Playlists: playlists, Pings: pings, Ticked: ticked}
}

func (h *harness) search(t *testing.T, p Player, playlists []byte, pings map[string]int) {
	t.Helper()
	id, state, err := h.m.Start(p, req(playlists, pings), h.now)
	if err != nil || state.Kind != Searching || state.Version != 1 {
		t.Fatalf("%s's search: %+v, %v", p.Account, state, err)
	}
	h.ids[p.Account] = id
	// (its page's first poll, at once: only a polled search is matched, RV-892)
	if _, ok := h.m.Poll(context.Background(), id, "", 0, 0); !ok {
		t.Fatalf("%s's search unknown", p.Account)
	}
}

func (h *harness) state(t *testing.T, account string) State {
	t.Helper()
	s, ok := h.m.Poll(context.Background(), h.ids[account], "", 0, 0)
	if !ok {
		t.Fatalf("%s's search unknown", account)
	}
	return s
}

func (h *harness) found(t *testing.T, account string) *Match {
	t.Helper()
	s := h.state(t, account)
	if s.Kind != Found {
		return nil
	}
	return s.Match
}

// at moves the clock, every search's page polling meanwhile (alive), and forms matches
func (h *harness) at(d time.Duration) {
	h.now = t0.Add(d)
	for _, id := range h.ids {
		h.m.Poll(context.Background(), id, "", 0, 0)
	}
	h.m.Tick(h.now)
}

func TestRatingWindowAndSnakeSeats(t *testing.T) {
	for _, c := range []struct {
		waited time.Duration
		want   float64
	}{{0, 100}, {9900 * time.Millisecond, 100}, {10 * time.Second, 150}, {95 * time.Second, 550}, {200 * time.Second, 1100}} {
		if got := RatingWindow(c.waited); got != c.want {
			t.Errorf("RatingWindow(%v) = %v, want %v", c.waited, got, c.want)
		}
	}
	// (the snake draft: the best and the 4th and 5th blue, the 2nd, 3rd and 6th orange; seats alternate, as queue.rs)
	if got := SnakeSeats([]uint16{1500, 1800, 1600, 1700}); !slices.Equal(got, []int{1, 3, 0, 2}) {
		t.Errorf("2v2 seats %v", got)
	}
	if got := SnakeSeats([]uint16{1000, 1100, 1200, 1300, 1400, 1500}); !slices.Equal(got, []int{5, 4, 2, 3, 1, 0}) {
		t.Errorf("3v3 seats %v", got)
	}
}

// Far apart in rating: they wait until the oldest's window reaches; a near one pairs at once, the far one's place kept
func TestFarApartWaitNearPairAtOnce(t *testing.T) {
	h := newHarness()
	h.search(t, player("low", 1000), []byte{1}, near)
	h.search(t, player("high", 1700), []byte{1}, near)
	h.at(0)
	if h.found(t, "low") != nil || h.found(t, "high") != nil {
		t.Fatal("700 apart: matched at once")
	}
	h.at(time.Second)
	h.search(t, player("near", 1650), []byte{1}, near)
	h.at(time.Second)
	if h.found(t, "high") == nil || h.found(t, "near") == nil || h.found(t, "low") != nil {
		t.Fatal("the near pair not matched, or the low one with them")
	}
	h.search(t, player("far", 1600), []byte{1}, near)
	h.at(50 * time.Second)
	if h.found(t, "low") != nil {
		t.Fatal("600 apart at the oldest's 50 s: matched")
	}
	h.at(100 * time.Second)
	if h.found(t, "low") == nil || h.found(t, "far") == nil {
		t.Fatal("600 apart at the oldest's 100 s: not matched")
	}
}

// A player is only ever matched on a server they ticked (and that answered their ping): of those all share, the lowest
// worst ping; one who ticked a quiet region alone waits
func TestRegions(t *testing.T) {
	h := newHarness()
	h.search(t, player("a", 1500), []byte{1}, map[string]int{"eu:4433": 30, "us:4433": 90})
	h.search(t, player("b", 1500), []byte{1}, map[string]int{"eu:4433": 80, "us:4433": 40})
	h.search(t, player("asia-only", 1500), []byte{1}, map[string]int{"asia:4433": 20})
	h.search(t, player("eu-only", 1500), []byte{1}, map[string]int{"eu:4433": 25})
	h.at(0)
	// (a, the oldest, with b: eu's worst 80 beats us's 90; the two left share no server)
	for _, a := range []string{"a", "b"} {
		if m := h.found(t, a); m == nil || m.Server != "eu:4433" {
			t.Fatalf("%s: %+v", a, m)
		}
	}
	h.at(10 * time.Minute)
	if h.found(t, "asia-only") != nil || h.found(t, "eu-only") != nil {
		t.Fatal("players with no server in common matched")
	}
	if _, _, err := h.m.Start(player("none", 1500), Request{Playlists: []byte{1}, Pings: map[string]int{}}, h.now); !errors.Is(err, ErrNoServer) {
		t.Errorf("a search no server answered: %v", err)
	}
}

// A search in two playlists' lists: matched in one, out of both
func TestPlaylists(t *testing.T) {
	h := newHarness()
	h.search(t, player("both", 1500), []byte{1, 2}, near)
	for _, a := range []string{"x", "y", "z"} {
		h.search(t, player(a, 1500), []byte{2}, near)
	}
	h.search(t, player("one", 1500), []byte{1}, near)
	h.at(0)
	if m := h.found(t, "both"); m == nil || m.Playlist != 1 || h.found(t, "one") == nil {
		t.Fatalf("1v1 first: %+v", m)
	}
	if h.found(t, "x") != nil {
		t.Fatal("2v2 formed with a player already matched in 1v1")
	}
	h.search(t, player("w", 1500), []byte{2, 3}, near)
	h.at(time.Second)
	for _, a := range []string{"x", "y", "z", "w"} {
		if m := h.found(t, a); m == nil || m.Playlist != 2 {
			t.Fatalf("%s: %+v", a, m)
		}
	}
}

// A match: one ticket a seat (draft order, its server, match and roster); once it starts, its players in it (no
// search while their page still reaches its server, a rejoin of it alone); a leave lets the leaver search (the game's
// rule), and that search gives up the rejoin; a rejoin puts them back; its end frees everyone
func TestOneMatchPerAccount(t *testing.T) {
	h := newHarness()
	for i, a := range []string{"p1", "p2", "p3", "p4"} {
		h.search(t, player(a, uint16(1500+30*i)), []byte{2}, near) //nolint:gosec // (G115: small)
	}
	h.at(0)
	m := h.found(t, "p1")
	if m == nil || len(h.issued) != 4 {
		t.Fatalf("found %+v, %d tickets", m, len(h.issued))
	}
	// (p4 the best: seat 0, blue; p3 and p2 orange; p1 blue)
	if got := h.found(t, "p4").Ticket; got != "ticket:p4:0" || h.found(t, "p1").Ticket != "ticket:p1:2" {
		t.Errorf("seats: p4 %q, p1 %q", got, h.found(t, "p1").Ticket)
	}
	for _, s := range h.issued {
		if s.Match != m.ID || s.Server != "eu:4433" || s.Playlist != 2 || s.Roster != 4 {
			t.Errorf("a seat: %+v", s)
		}
	}
	busy := func(a string, pings map[string]int) bool {
		t.Helper()
		_, _, err := h.m.Start(player(a, 1500), req([]byte{1}, pings), h.now)
		return errors.Is(err, ErrInMatch)
	}
	h.m.Started("eu:4433", m.ID, h.now)
	if !busy("p1", near) || !busy("p2", near) {
		t.Fatal("a search in a started match")
	}
	if !h.m.RejoinAllowed("p1", m.ID) || h.m.RejoinAllowed("p1", m.ID+1) {
		t.Error("a rejoin: of its match alone")
	}
	// (p1 leaves (seat 2): may search, which gives up the rejoin)
	h.m.Left("eu:4433", m.ID, 2)
	if busy("p1", near) {
		t.Fatal("a leaver's search refused")
	}
	if h.m.RejoinAllowed("p1", m.ID) {
		t.Error("a rejoin after a search")
	}
	// (p2 leaves (seat 3) and comes back: in the match again)
	h.m.Left("eu:4433", m.ID, 3)
	h.m.Back("eu:4433", m.ID, 3, h.now)
	if !busy("p2", near) {
		t.Fatal("a rejoined player's search let through")
	}
	// (a page that no longer reaches the match's server: its match gone with it)
	if busy("p3", map[string]int{"us:4433": 40}) {
		t.Error("a search whose pings lack the match's server refused")
	}
	h.m.Ended("", m.ID)
	if busy("p2", near) || busy("p4", near) {
		t.Error("a search after the match's end")
	}
}

// Before its start a match holds no one: a search then is theirs to make (if the match goes on without them, its
// cancel names them a no-show and ends that search with the cooldown); events from another server are ignored; a
// started match is let go by its server's restart or the backstop; a quitter's report ends a search
func TestMatchesFreed(t *testing.T) {
	h := newHarness()
	pair := func(a, b string) uint64 {
		h.search(t, player(a, 1500), []byte{1}, near)
		h.search(t, player(b, 1500), []byte{1}, near)
		h.m.Tick(h.now)
		m := h.found(t, a)
		if m == nil {
			t.Fatalf("%s and %s not matched", a, b)
		}
		return m.ID
	}
	busy := func(a string) bool {
		_, _, err := h.m.Start(player(a, 1500), req([]byte{3}, near), h.now)
		if err == nil {
			h.m.Cancel(h.ids[a], "")
		}
		return errors.Is(err, ErrInMatch)
	}
	forming := pair("f1", "f2")
	h.search(t, player("f1", 1500), []byte{3}, near)
	h.m.Cancelled("eu:4433", forming, []int{1}, h.now) // (f2's seat: the draft's second, f1 the first)
	if h.state(t, "f1").Kind != Searching {
		t.Error("the one who came, searching again, not kept")
	}
	restart := pair("r1", "r2")
	h.m.Started("us:4433", restart, h.now) // (another server's word: ignored)
	if busy("r1") {
		t.Fatal("another server's event taken")
	}
	restart = pair("r1", "r2")
	h.m.Started("eu:4433", restart, h.now)
	h.m.Restarted("eu:4433", h.now.Add(-time.Second))
	if !busy("r1") {
		t.Fatal("a restart before the match freed it")
	}
	h.m.Restarted("eu:4433", h.now.Add(time.Second))
	if busy("r1") || busy("r2") {
		t.Fatal("the server's restart didn't free its match")
	}
	long := pair("l1", "l2")
	h.m.Started("eu:4433", long, h.now)
	h.at(MatchLife - time.Second)
	if !busy("l1") {
		t.Fatal("freed before the backstop")
	}
	h.at(MatchLife)
	if busy("l1") || busy("l2") {
		t.Fatal("the backstop")
	}
	h.search(t, player("q", 1500), []byte{1}, map[string]int{"asia:4433": 5})
	h.m.Quitter("q", h.now.Add(5*time.Minute), h.now)
	if s := h.state(t, "q"); s.Reason != ReasonQueueBanned {
		t.Errorf("a quitter's search: %+v", s)
	}
}

// A no-show: its cooldown (its search refused, one open ended), the others' waits kept for their next search, first
func TestNoShow(t *testing.T) {
	h := newHarness()
	h.search(t, player("came", 1500), []byte{1}, near)
	h.at(20 * time.Second)
	h.search(t, player("stalled", 1500), []byte{1}, near)
	h.m.Tick(h.now)
	m := h.found(t, "came")
	if m == nil {
		t.Fatal("not matched")
	}
	h.at(25 * time.Second)
	h.search(t, player("waiting", 1500), []byte{1}, near)
	stalledSeat := slices.IndexFunc(h.issued, func(seat ticket.Seat) bool { return seat.Match == m.ID && seat.Seat != 0 })
	if h.found(t, "stalled").Ticket != fmt.Sprintf("ticket:stalled:%d", h.issued[stalledSeat].Seat) {
		t.Fatal("the seats as issued")
	}
	h.m.Cancelled("eu:4433", m.ID, []int{int(h.issued[stalledSeat].Seat)}, h.now)
	var cooldown CooldownError
	if _, _, err := h.m.Start(player("stalled", 1500), req([]byte{1}, near), h.now); !errors.As(err, &cooldown) ||
		!cooldown.Until.Equal(h.now.Add(NoShowCooldown)) {
		t.Fatalf("the no-show's search: %v", err)
	}
	// (the one who came searches again: their wait from 0 s, ahead of the one waiting since 25 s)
	h.search(t, player("came", 1500), []byte{1}, near)
	h.search(t, player("late", 1500), []byte{1}, near)
	h.at(26 * time.Second)
	if m := h.found(t, "came"); m == nil || h.found(t, "waiting") == nil || h.found(t, "late") != nil {
		t.Fatal("the player who came not first again")
	}
	h.at(25*time.Second + NoShowCooldown)
	h.search(t, player("stalled", 1500), []byte{1}, near)
}

// A newer search of the account replaces its open one; Cancel Search ends one; a search no page polls goes; a found
// answer is kept for a poll that lost it, then goes
func TestSearchLife(t *testing.T) {
	h := newHarness()
	h.search(t, player("tab", 1500), []byte{1}, near)
	first := h.ids["tab"]
	h.search(t, player("tab", 1500), []byte{1}, near)
	if s, _ := h.m.Poll(context.Background(), first, "", 1, 0); s.Kind != Ended || s.Reason != ReasonReplaced || s.Version != 2 {
		t.Errorf("the replaced search: %+v", s)
	}
	h.m.Cancel(h.ids["tab"], "")
	if s := h.state(t, "tab"); s.Reason != ReasonCancelled {
		t.Errorf("a cancelled search: %+v", s)
	}
	h.search(t, player("gone", 1500), []byte{1}, near)
	h.now = t0.Add(SearchLife) // (no page polls it)
	h.m.Tick(h.now)
	if _, ok := h.m.Poll(context.Background(), h.ids["gone"], "", 0, 0); ok {
		t.Error("a search no page polled still there")
	}
	h.search(t, player("f1", 1500), []byte{1}, near)
	h.search(t, player("f2", 1500), []byte{1}, near)
	h.at(SearchLife + time.Second)
	h.at(SearchLife + time.Second + AnswerKept - time.Millisecond)
	if h.found(t, "f1") == nil {
		t.Error("a found answer gone before AnswerKept")
	}
	h.at(SearchLife + 2*time.Second + AnswerKept)
	if _, ok := h.m.Poll(context.Background(), h.ids["f1"], "", 0, 0); ok {
		t.Error("a found answer kept past AnswerKept")
	}
}

// A poll waits for the change and answers it; a quitter's report ends an open search with its ban
func TestPollWaitsAndQuitter(t *testing.T) {
	h := newHarness()
	h.search(t, player("w1", 1500), []byte{1}, near)
	answered := make(chan State, 1)
	go func() {
		s, _ := h.m.Poll(context.Background(), h.ids["w1"], "", 1, 5*time.Second)
		answered <- s
	}()
	time.Sleep(50 * time.Millisecond)
	h.search(t, player("w2", 1500), []byte{1}, near)
	h.m.Tick(h.now)
	select {
	case s := <-answered:
		if s.Kind != Found || s.Version != 2 {
			t.Errorf("the poll's answer: %+v", s)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the poll didn't wake at the match")
	}
	h.search(t, player("banned", 1500), []byte{1}, near)
	until := h.now.Add(15 * time.Minute)
	h.m.Quitter("banned", until, h.now)
	if s := h.state(t, "banned"); s.Kind != Ended || s.Reason != ReasonQueueBanned || !s.Until.Equal(until) {
		t.Errorf("a quitter's search: %+v", s)
	}
}

// A region the anchor accepts that can't fill doesn't hold it back: each of its regions filled from the searchers who
// accept that one (MX1R-4's case: the next-oldest takes only us, three later only eu; anchor and the three play at eu)
func TestEachRegionFilledOnItsOwn(t *testing.T) {
	now := t0
	// (the region that can't fill first by name, so the one that can is found only if each is tried: RV-876's G14)
	both := map[string]int{"a-us:4433": 40, "eu:4433": 60}
	queue := []candidate{
		{rating: 1500, pings: both, since: now},
		{rating: 1500, pings: map[string]int{"a-us:4433": 30}, since: now.Add(time.Second)},
		{rating: 1500, pings: map[string]int{"eu:4433": 20}, since: now.Add(2 * time.Second)},
		{rating: 1500, pings: map[string]int{"eu:4433": 25}, since: now.Add(3 * time.Second)},
		{rating: 1500, pings: map[string]int{"eu:4433": 30}, since: now.Add(4 * time.Second)},
	}
	got := pair(queue, 4, now.Add(5*time.Second))
	if len(got) != 1 || got[0].server != "eu:4433" || !slices.Equal(got[0].members, []int{0, 2, 3, 4}) {
		t.Fatalf("the match: %+v", got)
	}
}

// A search accepts the servers it ticked that answered; the in-match gate reads every server that answered, ticked or
// not (MX1R-19); a newer poll of a search answers the one waiting before at once (MX1R-21)
func TestTickedAndPolls(t *testing.T) {
	h := newHarness()
	pings := map[string]int{"eu:4433": 30, "us:4433": 90}
	if _, _, err := h.m.Start(player("u", 1500), Request{Playlists: []byte{1}, Pings: pings, Ticked: []string{"asia:4433"}}, h.now); !errors.Is(err, ErrNoServer) {
		t.Errorf("only an unanswered server ticked: %v", err)
	}
	h.search(t, player("a", 1500), []byte{1}, near)
	h.search(t, player("b", 1500), []byte{1}, near)
	h.at(0)
	m := h.found(t, "a")
	h.m.Started("eu:4433", m.ID, h.now)
	// (eu unticked, but it answered: still in the match)
	if _, _, err := h.m.Start(player("a", 1500), Request{Playlists: []byte{1}, Pings: pings, Ticked: []string{"us:4433"}}, h.now); !errors.Is(err, ErrInMatch) {
		t.Errorf("a search unticking the match's server: %v", err)
	}
	h.search(t, player("w", 1500), []byte{3}, near)
	first := make(chan State, 1)
	go func() {
		s, _ := h.m.Poll(context.Background(), h.ids["w"], "", 1, 5*time.Second)
		first <- s
	}()
	time.Sleep(50 * time.Millisecond)
	go h.m.Poll(context.Background(), h.ids["w"], "", 1, 200*time.Millisecond)
	select {
	case s := <-first:
		if s.Kind != Searching {
			t.Errorf("the superseded poll's answer: %+v", s)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a newer poll didn't answer the one before")
	}
}

// A search gives up the account's rejoin for good: once it ends unmatched (cancelled, or no page polling it), still
// none (RV-869, RV-876's G3); a later match's own rejoin allowed
func TestRejoinStaysGivenUp(t *testing.T) {
	h := newHarness()
	h.search(t, player("p1", 1500), []byte{1}, near)
	h.search(t, player("p2", 1500), []byte{1}, near)
	h.at(0)
	m := h.found(t, "p1")
	h.m.Started("eu:4433", m.ID, h.now)
	h.m.Left("eu:4433", m.ID, int(h.issued[slices.IndexFunc(h.issued, func(s ticket.Seat) bool { return s.Match == m.ID })].Seat))
	h.m.Left("eu:4433", m.ID, 0)
	h.m.Left("eu:4433", m.ID, 1)
	h.search(t, player("p1", 1500), []byte{1}, near)
	h.m.Cancel(h.ids["p1"], "p1")
	if h.m.RejoinAllowed("p1", m.ID) || h.m.RejoinAllowed("p1", m.ID+1) {
		t.Error("a rejoin after a cancelled search")
	}
	h.search(t, player("p1", 1500), []byte{1}, near)
	h.now = h.now.Add(SearchLife)
	h.m.Tick(h.now)
	if h.m.RejoinAllowed("p1", m.ID) {
		t.Error("a rejoin after a search no page polled")
	}
	// (unknown, as after a restart: the ban's rule alone)
	if !h.m.RejoinAllowed("stranger", 7) {
		t.Error("an account the matchmaker doesn't know refused")
	}
}

// A cancelled match's player who came keeps the earlier wait: searching again after (first in line), or a search
// already back moved up (RV-876's G5)
func TestCancelledKeepsTheWait(t *testing.T) {
	h := newHarness()
	h.search(t, player("came", 1500), []byte{1}, near)
	h.at(40 * time.Second)
	h.search(t, player("gone", 1500), []byte{1}, near)
	h.m.Tick(h.now)
	m := h.found(t, "came")
	gone := int(h.issued[slices.IndexFunc(h.issued, func(s ticket.Seat) bool { return s.Match == m.ID && s.Seat != h.issued[0].Seat })].Seat)
	// (two others searching since 41 s and 42 s, no round between)
	h.now = t0.Add(41 * time.Second)
	h.search(t, player("x", 1500), []byte{1}, near)
	h.now = t0.Add(42 * time.Second)
	h.search(t, player("y", 1500), []byte{1}, near)
	// (already back before the cancel: its search moved up to the first one's wait)
	h.now = t0.Add(45 * time.Second)
	h.search(t, player("came", 1500), []byte{1}, near)
	h.m.Cancelled("eu:4433", m.ID, []int{gone}, h.now)
	h.at(46 * time.Second)
	// (the one who came, since 0 s, first: matched with the next-oldest, x; with its own 45 s, x and y would be: RV-876's
	// G5)
	if h.found(t, "came") == nil || h.found(t, "x") == nil || h.found(t, "y") != nil {
		t.Fatal("the earlier wait not kept for a search already back")
	}
}

// A start whose answer was lost (never polled) and the page's retry (RV-881): the retry keeps the wait the lost start
// took, here a cancelled match's kept one (RV-904)
func TestRetriedStartKeepsTheWait(t *testing.T) {
	h := newHarness()
	h.search(t, player("came", 1500), []byte{1}, near)
	h.at(40 * time.Second)
	h.search(t, player("gone", 1500), []byte{1}, near)
	h.m.Tick(h.now)
	m := h.found(t, "came")
	gone := int(h.issued[slices.IndexFunc(h.issued, func(s ticket.Seat) bool { return s.Match == m.ID && s.Seat != h.issued[0].Seat })].Seat)
	h.m.Cancelled("eu:4433", m.ID, []int{gone}, h.now)
	h.now = t0.Add(41 * time.Second)
	h.search(t, player("x", 1500), []byte{1}, near)
	h.now = t0.Add(42 * time.Second)
	h.search(t, player("y", 1500), []byte{1}, near)
	// (the start whose answer is lost: never polled; the retry half a second on)
	h.now = t0.Add(45 * time.Second)
	if _, _, err := h.m.Start(player("came", 1500), req([]byte{1}, near), h.now); err != nil {
		t.Fatal(err)
	}
	h.now = t0.Add(45500 * time.Millisecond)
	h.search(t, player("came", 1500), []byte{1}, near)
	h.at(46 * time.Second)
	// (the one who came, its wait since 0 s, first: matched with x; with the retry's own 45.5 s, x and y would be)
	if h.found(t, "came") == nil || h.found(t, "x") == nil || h.found(t, "y") != nil {
		t.Fatal("the retried start lost the kept wait")
	}
}

// StartWait: a match with no word that it started is forgotten (a late Started finds nothing); one started holds its
// players, but not one who searched again before the start (RV-876's G6, G9)
func TestStartWaitAndSearchBeforeTheStart(t *testing.T) {
	h := newHarness()
	h.search(t, player("a", 1500), []byte{1}, near)
	h.search(t, player("b", 1500), []byte{1}, near)
	h.at(0)
	m := h.found(t, "a")
	h.at(StartWait)
	h.m.Started("eu:4433", m.ID, h.now)
	if _, _, err := h.m.Start(player("a", 1500), req([]byte{2}, near), h.now); err != nil {
		t.Errorf("a match forgotten after StartWait held its player: %v", err)
	}
	h.search(t, player("c", 1500), []byte{1}, near)
	h.search(t, player("d", 1500), []byte{1}, near)
	h.m.Tick(h.now)
	m2 := h.found(t, "c")
	// (d searches again before the start: not held when it starts; c is)
	h.search(t, player("d", 1500), []byte{3}, near)
	h.m.Started("eu:4433", m2.ID, h.now)
	if _, _, err := h.m.Start(player("c", 1500), req([]byte{3}, near), h.now); !errors.Is(err, ErrInMatch) {
		t.Errorf("a started match's player: %v", err)
	}
	if s := h.state(t, "d"); s.Kind != Searching {
		t.Errorf("a player who searched before the start held: %+v", s)
	}
	if _, _, err := h.m.Start(player("d", 1500), req([]byte{3}, near), h.now); err != nil {
		t.Errorf("a player who searched before the start refused a search after it: %v", err)
	}
}

// MX1R-11: the playlist whose oldest searcher waited longest forms first: a search of 1v1 and 3v3 joins the fuller 3v3
// whose players waited longer, not the 1v1 that came later (RV-876's G7)
func TestThePlaylistWaitingLongestFirst(t *testing.T) {
	h := newHarness()
	for _, a := range []string{"t1", "t2", "t3", "t4", "t5"} {
		h.search(t, player(a, 1500), []byte{3}, near)
	}
	// (both and ones in before the one round that decides: RV-876's G7)
	h.now = t0.Add(time.Second)
	h.search(t, player("both", 1500), []byte{1, 3}, near)
	h.now = t0.Add(1500 * time.Millisecond)
	h.search(t, player("ones", 1500), []byte{1}, near)
	h.at(2 * time.Second)
	if m := h.found(t, "both"); m == nil || m.Playlist != 3 || h.found(t, "ones") != nil {
		t.Fatalf("the 3v3 not first: %+v", m)
	}
}

// A search no page ever polled (its start's answer lost on the way, so its page can't cancel it) is never matched: it
// goes after SearchLife, and the others wait on (RV-892)
func TestUnpolledSearchNotMatched(t *testing.T) {
	h := newHarness()
	if _, _, err := h.m.Start(player("lost", 1500), req([]byte{1}, near), h.now); err != nil {
		t.Fatal(err)
	}
	h.search(t, player("b", 1500), []byte{1}, near)
	h.at(0)
	if h.state(t, "b").Kind != Searching {
		t.Fatal("matched with a search no page polled")
	}
	h.at(SearchLife)
	h.search(t, player("c", 1500), []byte{1}, near)
	h.at(SearchLife + time.Second)
	if h.state(t, "b").Kind != Found || h.state(t, "c").Kind != Found {
		t.Error("the polled searches not matched together")
	}
}
