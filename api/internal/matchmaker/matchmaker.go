package matchmaker

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"log/slog"
	"slices"
	"sync"
	"time"

	"carball/api/internal/ticket"
)

// The matchmaker's times
const (
	// SearchLife is how long a search lives with no poll open or answered (its page gone)
	SearchLife = 10 * time.Second
	// AnswerKept is how long a found or ended search's answer is kept for a poll that lost it
	AnswerKept = 30 * time.Second
	// StartWait is how long an assigned match is kept with no word that it started (no one claimed it)
	StartWait = time.Minute
	// MatchLife is the backstop: no started match holds its accounts longer (a server gone with no restart since)
	MatchLife = 45 * time.Minute
	// NoShowCooldown is how long an account that stalled a match can't search (RV-367, the user's decision)
	NoShowCooldown = 2 * time.Minute
	// ReturnFor is how long a cancelled match's players who came keep their wait for their next search
	ReturnFor = time.Minute
	// tickEvery is how often Run forms matches
	tickEvery = time.Second
)

// A search's states, and why one ended
const (
	Searching = "searching"
	Found     = "found"
	Ended     = "ended"

	// ReasonReplaced is a newer search of the account's (another tab); ReasonQueueBanned a quitter report's ban;
	// ReasonCooldown a no-show's; ReasonCancelled Cancel Search
	ReasonReplaced    = "replaced"
	ReasonQueueBanned = "queue-banned"
	ReasonCooldown    = "cooldown"
	ReasonCancelled   = "cancelled"
)

// ErrInMatch refuses a search of an account in a match (one at a time); ErrNoServer one that accepts no server (none
// ticked answered its page's ping)
var (
	ErrInMatch  = errors.New("matchmaker: the account is in a match")
	ErrNoServer = errors.New("matchmaker: no ticked server answered")
)

// CooldownError refuses a search of an account that stalled a match lately, until Until
type CooldownError struct{ Until time.Time }

func (e CooldownError) Error() string { return "matchmaker: a no-show's cooldown" }

// Player is who searches: their account (a UUID's text), name and ratings in the playlists 1v1, 2v2, 3v3
type Player struct {
	Account string
	Name    string
	Ratings [3]ticket.Shown
}

// Request is what a search asks: its ticked playlists (team sizes), the servers that answered its page's ping just
// before (ms: every listed region's, ticked or not), and its ticked regions' servers; it accepts those ticked that
// answered
type Request struct {
	Playlists []byte
	Pings     map[string]int
	Ticked    []string
}

// accepted is the servers a search accepts, with their pings: ticked and answered
func (r Request) accepted() map[string]int {
	out := map[string]int{}
	for _, s := range r.Ticked {
		if ms, ok := r.Pings[s]; ok {
			out[s] = ms
		}
	}
	return out
}

// Match is a found match as its player is told: its id, server, the player's match ticket and the playlist that matched
type Match struct {
	ID       uint64
	Server   string
	Ticket   string
	Playlist byte
}

// State is a search's state as its page polls it: its version (each change one more), searching, found (its match) or
// ended (why, and until when for a ban or a cooldown)
type State struct {
	Version int
	Kind    string
	Match   *Match
	Reason  string
	Until   time.Time
}

// Issuer signs a player's match ticket for a seat
type Issuer func(p Player, seat ticket.Seat, now time.Time) (string, error)

type search struct {
	id        string
	player    Player
	playlists []byte
	pings     map[string]int
	// when it began waiting (a cancelled match's player keeps their earlier wait), and its arrival (ties)
	since time.Time
	order uint64
	// the polls open now (one: a newer answers the one before at once, MX1R-21), and when one last ended
	polls      int
	lastPoll   time.Time
	superseded chan struct{}
	// a poll came: only then is it matched (its start's answer may never have reached its page, which then can't cancel
	// it: a search no page polls was never there, RV-892)
	polled  bool
	state   State
	changed chan struct{}
	// a found or ended search's record goes then
	gone time.Time
}

type match struct {
	server string
	// its accounts in seat order
	accounts []string
	// each account's wait (kept for its next search if the match is cancelled)
	since    map[string]time.Time
	assigned time.Time
	// when it started (zero: not yet), and whose players are in it (all at its start; a leave out, a rejoin back)
	started time.Time
	present map[string]bool
}

type kept struct{ since, until time.Time }

// Matchmaker is the queue and the matches it assigned; safe for concurrent use
type Matchmaker struct {
	issue Issuer
	now   func() time.Time
	log   *slog.Logger

	mu        sync.Mutex
	searches  map[string]*search
	open      map[string]*search // each account's search in the lists
	matches   map[uint64]*match
	active    map[string]uint64 // each account's match
	latest    map[string]uint64 // each account's latest match, its rejoin's; 0 once a later search gave it up
	cooldowns map[string]time.Time
	waits     map[string]kept // a cancelled match's players' waits, for their next search
	arrivals  uint64
}

// New is an empty matchmaker that signs match tickets with issue, its clock now
func New(issue Issuer, now func() time.Time, log *slog.Logger) *Matchmaker {
	return &Matchmaker{
		issue: issue, now: now, log: log, searches: map[string]*search{}, open: map[string]*search{}, matches: map[uint64]*match{},
		active: map[string]uint64{}, latest: map[string]uint64{}, cooldowns: map[string]time.Time{}, waits: map[string]kept{},
	}
}

// Run forms matches every second until ctx is done
func (m *Matchmaker) Run(ctx context.Context) {
	t := time.NewTicker(tickEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.Tick(m.now())
		}
	}
}

// Start opens a search for the player: its id and first state. Refused for an account whose player is in a started
// match (its server still answering their page), in its no-show cooldown, or that accepts no server. Accepted, it gives
// up the account's match: a seat left (the game's rule: a leaver may search at once, MM-2) is no longer theirs to
// rejoin (RV-846), and a match assigned but not started is theirs to stall (its no-show). A search of the account's
// already open is replaced (its page told)
func (m *Matchmaker) Start(p Player, req Request, now time.Time) (string, State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tidy(now)
	if until, ok := m.cooldowns[p.Account]; ok {
		return "", State{}, CooldownError{Until: until}
	}
	if id, ok := m.active[p.Account]; ok {
		// (a match whose server no longer answers their page, ticked or not: gone with it, theirs no longer, MX1R-1,
		// MX1R-19; the page's word, so a page that leaves a match it plays only harms itself: that leave is reported)
		if mt := m.matches[id]; mt != nil && mt.present[p.Account] {
			if _, answers := req.Pings[mt.server]; answers {
				return "", State{}, ErrInMatch
			}
		}
	}
	accepted := req.accepted()
	if len(accepted) == 0 {
		return "", State{}, ErrNoServer
	}
	if id, ok := m.active[p.Account]; ok {
		if mt := m.matches[id]; mt != nil {
			delete(mt.present, p.Account)
		}
		delete(m.active, p.Account)
	}
	// (given up: no rejoin of it, even once this search ends unmatched, RV-869)
	m.latest[p.Account] = 0
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", State{}, err
	}
	if old := m.open[p.Account]; old != nil {
		m.end(old, ReasonReplaced, time.Time{}, now)
	}
	m.arrivals++
	s := &search{
		id: hex.EncodeToString(b[:]), player: p, playlists: slices.Clone(req.Playlists), pings: accepted, since: now, order: m.arrivals,
		lastPoll: now, state: State{Version: 1, Kind: Searching}, changed: make(chan struct{}),
	}
	if w, ok := m.waits[p.Account]; ok {
		s.since = w.since
		delete(m.waits, p.Account)
	}
	m.searches[s.id] = s
	m.open[p.Account] = s
	return s.id, s.state, nil
}

// Poll answers a search's state once it's past `after` (its version), waiting up to `wait` for a change; false for a
// search it doesn't know (never, gone, before a restart, or another account's: `account`, none for any). An open poll
// keeps its search alive
func (m *Matchmaker) Poll(ctx context.Context, id, account string, after int, wait time.Duration) (State, bool) {
	m.mu.Lock()
	s := m.searches[id]
	if s == nil || (account != "" && s.player.Account != account) {
		m.mu.Unlock()
		return State{}, false
	}
	s.polled = true
	if s.state.Version > after {
		s.lastPoll = m.now()
		state := s.state
		m.mu.Unlock()
		return state, true
	}
	if s.superseded != nil {
		close(s.superseded)
	}
	superseded := make(chan struct{})
	s.superseded = superseded
	s.polls++
	changed := s.changed
	m.mu.Unlock()
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-changed:
	case <-timer.C:
	case <-ctx.Done():
	case <-superseded:
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s.polls--
	s.lastPoll = m.now()
	if s.superseded == superseded {
		s.superseded = nil
	}
	return s.state, true
}

// Cancel ends a search (Cancel Search) of `account`'s (none: any); a match it found stands (the page claims or stalls it)
func (m *Matchmaker) Cancel(id, account string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s := m.searches[id]; s != nil && s.state.Kind == Searching && (account == "" || s.player.Account == account) {
		m.end(s, ReasonCancelled, time.Time{}, m.now())
	}
}

// change sets a search's new state, its version one more, its polls woken
func (s *search) change(state State, now time.Time) {
	state.Version = s.state.Version + 1
	s.state = state
	close(s.changed)
	s.changed = make(chan struct{})
	s.gone = now.Add(AnswerKept)
}

// end takes a search out of the lists, ended for why (until when, for a ban or a cooldown)
func (m *Matchmaker) end(s *search, reason string, until, now time.Time) {
	if m.open[s.player.Account] == s {
		delete(m.open, s.player.Account)
	}
	s.change(State{Kind: Ended, Reason: reason, Until: until}, now)
}

// tidy lets go of what expired: searches no page polls, answers no poll fetched, cooldowns and kept waits, and the
// matches with no word that they started (no one claimed) or started past the backstop
func (m *Matchmaker) tidy(now time.Time) {
	for id, s := range m.searches {
		if (s.state.Kind == Searching && s.polls == 0 && now.Sub(s.lastPoll) >= SearchLife) || (s.state.Kind != Searching && !now.Before(s.gone)) {
			if m.open[s.player.Account] == s {
				delete(m.open, s.player.Account)
			}
			delete(m.searches, id)
		}
	}
	for a, until := range m.cooldowns {
		if !until.After(now) {
			delete(m.cooldowns, a)
		}
	}
	for a, w := range m.waits {
		if !w.until.After(now) {
			delete(m.waits, a)
		}
	}
	for id, mt := range m.matches {
		if (mt.started.IsZero() && now.Sub(mt.assigned) >= StartWait) || (!mt.started.IsZero() && now.Sub(mt.started) >= MatchLife) {
			m.log.Info("a match forgotten with no word from its server", "match", matchText(id), "server", mt.server, "started", !mt.started.IsZero())
			m.free(id)
		}
	}
}

// free forgets a match, its accounts out of it
func (m *Matchmaker) free(id uint64) {
	if mt := m.matches[id]; mt != nil {
		for _, a := range mt.accounts {
			if m.active[a] == id {
				delete(m.active, a)
			}
		}
	}
	delete(m.matches, id)
}

func matchText(id uint64) string {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], id)
	return hex.EncodeToString(b[:])
}

// Tick lets go of what expired and forms the matches the lists fill: playlist by playlist (the one whose oldest searcher
// has waited longest first, so a playlist with fewer players doesn't keep taking a several-playlist search from a
// fuller one: MX1R-11), each list oldest first (`pair`); each match's tickets signed, its players' searches found and
// out of every list. The searches' calls take the same lock: a search is in one match at most
func (m *Matchmaker) Tick(now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tidy(now)
	oldest := func(a, b *search) int {
		if c := a.since.Compare(b.since); c != 0 {
			return c
		}
		return int(a.order) - int(b.order) //nolint:gosec // (G115: arrivals counted from 1, far below the limit)
	}
	lists := map[byte][]*search{}
	for _, s := range m.open {
		if !s.polled {
			continue
		}
		for _, p := range s.playlists {
			lists[p] = append(lists[p], s)
		}
	}
	playlists := make([]byte, 0, len(lists))
	for p, list := range lists {
		slices.SortFunc(list, oldest)
		playlists = append(playlists, p)
	}
	slices.SortFunc(playlists, func(a, b byte) int {
		if c := oldest(lists[a][0], lists[b][0]); c != 0 {
			return c
		}
		return int(a) - int(b)
	})
	for _, p := range playlists {
		var waiting []*search
		for _, s := range lists[p] {
			if s.state.Kind == Searching { // (not matched in an earlier playlist this round)
				waiting = append(waiting, s)
			}
		}
		players := 2 * int(p)
		if len(waiting) < players {
			continue
		}
		candidates := make([]candidate, len(waiting))
		for i, s := range waiting {
			candidates[i] = candidate{rating: s.player.Ratings[p-1].Rating, pings: s.pings, since: s.since}
		}
		for _, g := range pair(candidates, players, now) {
			members := make([]*search, len(g.members))
			ratings := make([]uint16, len(g.members))
			for i, k := range g.members {
				members[i], ratings[i] = waiting[k], candidates[k].rating
			}
			m.assign(members, SnakeSeats(ratings), g.server, p, now)
		}
	}
}

// assign makes one match: its id, each seat's ticket (seat order from the draft), its accounts in it, the players'
// searches found
func (m *Matchmaker) assign(members []*search, seats []int, server string, playlist byte, now time.Time) {
	var id uint64
	for id == 0 || m.matches[id] != nil {
		var b [8]byte
		if _, err := rand.Read(b[:]); err != nil {
			m.log.Error("a match's id", "err", err)
			return
		}
		id = binary.BigEndian.Uint64(b[:])
	}
	mt := &match{server: server, since: map[string]time.Time{}, assigned: now, present: map[string]bool{}}
	tickets := make([]string, len(seats))
	for seat, k := range seats {
		s := members[k]
		t, err := m.issue(s.player, ticket.Seat{Match: id, Server: server, Playlist: playlist, Seat: byte(seat), Roster: byte(len(seats))}, now) //nolint:gosec // (G115: 6 seats at most)
		if err != nil {
			m.log.Error("signing a match ticket", "err", err)
			return // (no one told: they stay in the lists)
		}
		tickets[seat] = t
		mt.accounts = append(mt.accounts, s.player.Account)
		mt.since[s.player.Account] = s.since
	}
	m.matches[id] = mt
	for seat, k := range seats {
		s := members[k]
		delete(m.open, s.player.Account)
		m.active[s.player.Account] = id
		m.latest[s.player.Account] = id
		s.change(State{Kind: Found, Match: &Match{ID: id, Server: server, Ticket: tickets[seat], Playlist: playlist}}, now)
	}
	m.log.Info("a match found", "match", matchText(id), "server", server, "playlist", playlist)
}

// event finds a match an event names, if this matchmaker assigned it to that server (an event about another, or one
// from before a restart, is ignored: MX1R-2, MX1R-12)
func (m *Matchmaker) event(server string, id uint64) *match {
	if mt := m.matches[id]; mt != nil && mt.server == server {
		return mt
	}
	return nil
}

// Started notes the server's word that the match started: its players in it till they leave or it ends (or the
// backstop)
func (m *Matchmaker) Started(server string, id uint64, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mt := m.event(server, id); mt != nil && mt.started.IsZero() {
		mt.started = now
		for _, a := range mt.accounts {
			mt.present[a] = m.active[a] == id
		}
	}
}

// Left notes a player leaving a started match (its seat): they may search (the game's rule), and that search gives up
// their rejoin
func (m *Matchmaker) Left(server string, id uint64, seat int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mt := m.event(server, id); mt != nil && seat >= 0 && seat < len(mt.accounts) {
		delete(mt.present, mt.accounts[seat])
	}
}

// Back notes a player's rejoin of their seat: in the match again (a search of theirs open now ended: one at a time)
func (m *Matchmaker) Back(server string, id uint64, seat int, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mt := m.event(server, id); mt != nil && seat >= 0 && seat < len(mt.accounts) {
		a := mt.accounts[seat]
		mt.present[a] = true
		m.active[a] = id
		if s := m.open[a]; s != nil {
			m.end(s, ReasonReplaced, time.Time{}, now)
		}
	}
}

// Ended frees a match's accounts: its result, or its end with no result (an empty server: a result's caller, which
// names no server here)
func (m *Matchmaker) Ended(server string, id uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mt := m.matches[id]; mt != nil && (server == "" || mt.server == server) {
		m.free(id)
	}
}

// Cancelled takes a match cancelled before its start, its no-shows by seat (the server knows a seat it waited for, not
// whose it was; this matchmaker assigned them): they can't search for NoShowCooldown (a search of theirs open now
// ended), the others keep their wait for their next search (one already back keeps the earlier of the two), and every
// one of its accounts is free. A match this matchmaker doesn't know (made before a restart) just goes
func (m *Matchmaker) Cancelled(server string, id uint64, noShows []int, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mt := m.event(server, id)
	if mt == nil {
		return
	}
	for seat, a := range mt.accounts {
		if slices.Contains(noShows, seat) {
			until := now.Add(NoShowCooldown)
			m.cooldowns[a] = until
			delete(m.waits, a)
			if s := m.open[a]; s != nil {
				m.end(s, ReasonCooldown, until, now)
			}
			continue
		}
		if s := m.open[a]; s != nil {
			if mt.since[a].Before(s.since) {
				s.since = mt.since[a]
			}
		} else {
			m.waits[a] = kept{since: mt.since[a], until: now.Add(ReturnFor)}
		}
	}
	m.free(id)
}

// Restarted frees the matches a server had before its restart (assigned before `at`, its clock: gone with it)
func (m *Matchmaker) Restarted(server string, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, mt := range m.matches {
		if mt.server == server && !mt.assigned.After(at) {
			m.free(id)
		}
	}
}

// Quitter ends a reported quitter's search (one begun in the leave's moments), with their ban (until when)
func (m *Matchmaker) Quitter(account string, until, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s := m.open[account]; s != nil {
		m.end(s, ReasonQueueBanned, until, now)
	}
}

// RejoinAllowed reports whether the account may have a rejoin ticket for the match: its latest match alone, none once a
// later search of its was accepted (whether or not that search found a match: RV-869), and not while it searches
// (MX1R-5); not known (a restart since), the ban's rule alone
func (m *Matchmaker) RejoinAllowed(account string, id uint64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	latest, ok := m.latest[account]
	return m.open[account] == nil && (!ok || (latest != 0 && latest == id))
}
