package server

import (
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"time"

	"carball/api/internal/matchmaker"
	"carball/api/internal/ranked"
	"carball/api/internal/ticket"
)

// The page's search and the game servers' events (notes/matchmaking.md, the central matchmaker): a search is a long
// poll, its id its page's alone (128 random bits); the game servers' events come through their outbox, as their results

// PollWait is a poll's longest wait: well under Cloudflare's 100 s idle limit
const PollWait = 25 * time.Second

// serverName is a game server's address as a search's pings and a match ticket name it (host:port)
var serverName = regexp.MustCompile(`^[A-Za-z0-9.-]{1,58}:[0-9]{1,5}$`)

// searchBody is a search's request: its ticked playlists (team sizes), the servers that answered the page's ping just
// before with their pings (ms: every listed region's, ticked or not), and its ticked regions' servers
type searchBody struct {
	Playlists []int          `json:"playlists"`
	Pings     map[string]int `json:"pings"`
	Regions   []string       `json:"regions"`
}

// request checks a search's body: one to three playlists, each once; up to 16 servers with their pings and 16 ticked
// servers. A server whose name isn't one (no host:port, too long), a ping out of 0-10000 ms or a name given twice is
// dropped, not the search: one region's odd name never stops every page's searches (RV-868). (The 16 count each key
// sent, dropped ones too: the page sends none it would drop, RV-898)
func (b searchBody) request() (matchmaker.Request, bool) {
	req := matchmaker.Request{Pings: map[string]int{}}
	if len(b.Playlists) == 0 || len(b.Playlists) > 3 || len(b.Pings) > 16 || len(b.Regions) > 16 {
		return req, false
	}
	for _, server := range b.Regions {
		if serverName.MatchString(server) && !slices.Contains(req.Ticked, server) {
			req.Ticked = append(req.Ticked, server)
		}
	}
	for _, p := range b.Playlists {
		if p < 1 || p > 3 || slices.Contains(req.Playlists, byte(p)) {
			return req, false
		}
		req.Playlists = append(req.Playlists, byte(p))
	}
	for server, ms := range b.Pings {
		if serverName.MatchString(server) && ms >= 0 && ms <= 10_000 {
			req.Pings[server] = ms
		}
	}
	return req, true
}

// startSearch: the signed-in account's search (POST /api/search). Refused while it's queue-banned (its ban's end), in a
// match, in a no-show's cooldown (seconds left), when no ticked server answered, or past its limit
func (s *Server) startSearch(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.session(w, r)
	if !ok {
		return
	}
	var body searchBody
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	req, ok := body.request()
	if !ok {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	now := s.Now()
	if s.Tickets == nil {
		writeError(w, http.StatusServiceUnavailable, "unavailable") // (a development server without a key: no match tickets)
		return
	}
	if !s.searchStarts.Allow(ss.AccountID, now) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	a, err := s.Store.Account(r.Context(), ss.AccountID)
	if err != nil {
		s.log(r).Error("reading an account", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	ban, banned, err := s.Store.QueueBanOf(r.Context(), ss.AccountID)
	if err != nil {
		s.log(r).Error("reading a queue ban", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	if until, on := ranked.BannedUntil(ban, banned, now); on {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "queue-banned", "seconds": secondsUntil(until, now)})
		return
	}
	ratings, err := s.Store.RatingsOf(r.Context(), ss.AccountID)
	if err != nil {
		s.log(r).Error("reading ratings", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	s.openSearch(w, r, matchmaker.Player{Account: a.ID, Name: a.Name, Ratings: ranked.TicketRatings(ratings, now)}, req, now)
}

// openSearch opens the player's search and answers it, or why not
func (s *Server) openSearch(w http.ResponseWriter, r *http.Request, p matchmaker.Player, req matchmaker.Request, now time.Time) {
	id, state, err := s.Matchmaker.Start(p, req, now)
	var cooldown matchmaker.CooldownError
	switch {
	case errors.Is(err, matchmaker.ErrInMatch):
		writeError(w, http.StatusForbidden, "in-match")
	case errors.Is(err, matchmaker.ErrNoServer):
		writeError(w, http.StatusServiceUnavailable, "no-server")
	case errors.As(err, &cooldown):
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "cooldown", "seconds": secondsUntil(cooldown.Until, now)})
	case err != nil:
		s.log(r).Error("starting a search", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
	default:
		playlists := make([]int, len(req.Playlists))
		for i, p := range req.Playlists {
			playlists[i] = int(p)
		}
		s.log(r).Info("search started", "playlists", playlists, "regions", req.Ticked)
		writeJSON(w, http.StatusOK, stateJSON(id, state, now))
	}
}

// secondsUntil: the whole seconds left, one at least
func secondsUntil(until, now time.Time) int {
	return max(int((until.Sub(now)+time.Second-1)/time.Second), 1)
}

// stateJSON: a search's state as its page reads it
func stateJSON(id string, st matchmaker.State, now time.Time) map[string]any {
	out := map[string]any{"search": id, "version": st.Version, "state": st.Kind}
	if st.Match != nil {
		out["match"] = map[string]any{
			"id": matchText(st.Match.ID), "server": st.Match.Server, "ticket": st.Match.Ticket, "playlist": st.Match.Playlist, "map": 0,
		}
	}
	if st.Kind == matchmaker.Ended {
		out["reason"] = st.Reason
		// (a ban's or a cooldown's seconds left: the page's clock never ours, RV-1001)
		if st.Reason == matchmaker.ReasonQueueBanned || st.Reason == matchmaker.ReasonCooldown {
			out["seconds"] = secondsUntil(st.Until, now)
		}
	}
	return out
}

// pollSearch: GET /api/search/{id}?after=N, its state once past version N (at a change, or after PollWait); 404 for a
// search it doesn't know (the page searches again once). The session's account's own search alone (its id isn't the
// only key to its match ticket: RV-871); a session ended (signed out, the account banned or deleted) polls no more, so
// its search goes within SearchLife (RV-872)
func (s *Server) pollSearch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	after, err := strconv.Atoi(r.URL.Query().Get("after"))
	if err != nil || after < 0 || len(id) != 32 {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	ss, ok := s.sessionOf(w, r, false) // (never rotated by a poll: RV-889)
	if !ok {
		return
	}
	s.poll(w, r, id, ss.AccountID, after)
}

// poll answers a search's poll, the account's own
func (s *Server) poll(w http.ResponseWriter, r *http.Request, id, account string, after int) {
	state, ok := s.Matchmaker.Poll(r.Context(), id, account, after, PollWait)
	if !ok {
		writeError(w, http.StatusNotFound, "no-search")
		return
	}
	writeJSON(w, http.StatusOK, stateJSON(id, state, s.Now()))
}

// cancelSearch: DELETE /api/search/{id}, Cancel Search, of the session's own account's search (as a poll's, RV-871,
// RV-896; read with no rotation, as a poll's: the delete often goes as its page does, its answer never read, RV-889);
// 204 whether or not there was one
func (s *Server) cancelSearch(w http.ResponseWriter, r *http.Request) {
	ss, ok := s.sessionOf(w, r, false)
	if !ok {
		return
	}
	s.Matchmaker.Cancel(r.PathValue("id"), ss.AccountID)
	w.WriteHeader(http.StatusNoContent)
}

// issueSeat signs a player's match ticket (the matchmaker's Issuer)
func (s *Server) issueSeat(p matchmaker.Player, seat ticket.Seat, now time.Time) (string, error) {
	if s.Tickets == nil {
		return "", errors.New("no ticket key")
	}
	id, err := accountBytes(p.Account)
	if err != nil {
		return "", err
	}
	encoded, _, err := s.Tickets.IssueSeat(id, p.Name, p.Ratings, seat, now)
	return encoded, err
}

// NewMatchmaker gives the server its matchmaker, signing with its Tickets (Run it beside the server)
func (s *Server) NewMatchmaker() *matchmaker.Matchmaker {
	s.Matchmaker = matchmaker.New(s.issueSeat, s.Now, s.Log)
	return s.Matchmaker
}

// fleetEvent: a game server's event for the matchmaker (POST /api/fleet/events, through its outbox, kept and retried in
// order): a match started, a player left it or came back (their seat), cancelled before its start (its no-shows'
// seats), over with no result, or the server restarted (its matches before gone). Each names its server: an event
// about a match this matchmaker didn't assign to it (another's, one from before a restart, one already over) is taken
// and ignored (204, never a retry that would hold the outbox's later calls: MX1R-2), each event once in effect
func (s *Server) fleetEvent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Event   string `json:"event"`
		Match   string `json:"match"`
		Server  string `json:"server"`
		At      int64  `json:"at"`
		Seat    *int   `json:"seat"`
		NoShows []int  `json:"noShows"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	id, err := strconv.ParseUint(body.Match, 16, 64)
	matchOK := err == nil && len(body.Match) == 16 && id != 0
	seatOK := func(seat int) bool { return seat >= 0 && seat < 6 }
	bad := !serverName.MatchString(body.Server) || len(body.NoShows) > 6 || (body.Seat != nil && !seatOK(*body.Seat))
	for _, seat := range body.NoShows {
		bad = bad || !seatOK(seat)
	}
	now := s.Now()
	switch {
	case bad:
	case body.Event == "started" && matchOK:
		s.Matchmaker.Started(body.Server, id, now)
	case body.Event == "left" && matchOK && body.Seat != nil:
		s.Matchmaker.Left(body.Server, id, *body.Seat)
	case body.Event == "back" && matchOK && body.Seat != nil:
		s.Matchmaker.Back(body.Server, id, *body.Seat, now)
	case body.Event == "over" && matchOK:
		s.Matchmaker.Ended(body.Server, id)
	case body.Event == "cancelled" && matchOK:
		s.Matchmaker.Cancelled(body.Server, id, body.NoShows, now)
	case body.Event == "restarted" && body.At > 0:
		s.Matchmaker.Restarted(body.Server, time.Unix(body.At, 0))
	default:
		bad = true
	}
	if bad {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
