package server

import (
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"carball/api/internal/ranked"
	"carball/api/internal/store"
	"carball/api/internal/ticket"
)

// The ranked rules' server-to-server calls (notes/accounts.md §3; LV1): the game server posts each match's result and
// reports each armed leave, with the players' tickets from the match's start.

// AcceptWindow is how old a result's or a quitter's tickets may be (W, AC-22): the match, overtime and the game server's
// retries fit in it; used tickets are kept as long
const AcceptWindow = 24 * time.Hour

// ResultsKept is how long results are kept (question 7: a year)
const ResultsKept = 365 * 24 * time.Hour

// MaxMatchSeconds caps a result's time played (a match of hours is no match)
const MaxMatchSeconds = 3 * 60 * 60

// matchID is a match's id as the game server names it
var matchID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// gameServer guards the game server's calls: its credential (GAME_SERVER_TOKEN_FILE) as a bearer token, compared in
// constant time, behind the tunnel's Access service token; at most Limits.GameServer of them (AC-26: 429, the game
// server's outbox tries again later); JSON bodies as the browser's writes. None configured: 503
func (s *Server) gameServer(next http.HandlerFunc) http.HandlerFunc {
	return s.gameServerCall(next, true)
}

// gameServerAsking: a game server's question (a rejoin's, RV-1008): its token, its body's size, not GameServer's budget
// (the question's own, by its account: rejoinCheck)
func (s *Server) gameServerAsking(next http.HandlerFunc) http.HandlerFunc {
	return s.gameServerCall(next, false)
}

// gameServerCall: the game server's token checked, then (budgeted) its own budget's call taken, keyed by the name it sends
// (X-Carball-Server, as a match ticket names a server; one without or with another: all such together, RV-1020)
func (s *Server) gameServerCall(next http.HandlerFunc, budgeted bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if len(s.GameServerToken) == 0 {
			writeError(w, http.StatusServiceUnavailable, "unavailable")
			return
		}
		given, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(given), s.GameServerToken) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		key := r.Header.Get("X-Carball-Server")
		if !serverName.MatchString(key) {
			key = "game-server"
		}
		// (its own budget first, so a server over it never spends the fleet's; refused by the fleet's ceiling, its own
		// token given back, so it isn't refused longer than the fleet once the ceiling refills: RV-1077)
		if budgeted {
			now := s.Now()
			own, giveBack := s.gameServerCalls.Reserve(key, now)
			if own && !s.gameServerFleet.Allow("fleet", now) {
				giveBack()
				own = false
			}
			if !own {
				writeError(w, http.StatusTooManyRequests, "busy")
				return
			}
		}
		if r.ContentLength > maxBody {
			writeError(w, http.StatusRequestEntityTooLarge, "too-large")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next(w, r)
	}
}

// playerTicket checks a player's ticket as a result, a quitter or a refill carries it: our signature (a key from before
// a rotation too), issued within the acceptance window (and not ahead of now past the skew), for that purpose and match
// (a result's and a quitter's: the seat's match ticket; a refill's: the rejoin's)
func (s *Server) playerTicket(encoded string, purpose byte, match string, now time.Time) (ticket.Ticket, error) {
	t, err := ticket.VerifySigned(encoded, s.TicketKeys)
	if err != nil {
		return ticket.Ticket{}, err
	}
	if t.Issued.After(now.Add(30*time.Second)) || now.Sub(t.Issued) > AcceptWindow {
		return ticket.Ticket{}, errors.New("ticket: outside the acceptance window")
	}
	if t.Purpose != purpose || matchText(t.Match) != match {
		return ticket.Ticket{}, errors.New("ticket: not for this")
	}
	return t, nil
}

// matchText is a match's id as the game server names it (16 hex digits)
func matchText(id uint64) string {
	return fmt.Sprintf("%016x", id)
}

// accountID is a ticket's account as the store names it (a UUID's text)
func accountID(b [16]byte) string {
	h := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", h[:8], h[8:12], h[12:16], h[16:20], h[20:])
}

// result: a match's result (every online match is rated; a no contest sends none: LV1). Recorded once (a retry: the
// same answer), each ticket counted once (AC-5)
func (s *Server) result(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Match       string `json:"match"`
		Server      string `json:"server"`
		Playlist    int    `json:"playlist"`
		WinningTeam int    `json:"winningTeam"`
		Players     []struct {
			Ticket  string `json:"ticket"`
			Team    int    `json:"team"`
			Quitter bool   `json:"quitter"`
			Seconds int    `json:"seconds"`
		} `json:"players"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	now := s.Now()
	res := store.Result{Match: body.Match, Server: body.Server, Playlist: body.Playlist, WinningTeam: body.WinningTeam}
	bad := !matchID.MatchString(body.Match) || body.Server == "" || len(body.Server) > 255 ||
		body.Playlist < 1 || body.Playlist > 3 || (body.WinningTeam != 0 && body.WinningTeam != 1) ||
		len(body.Players) != 2*body.Playlist
	perTeam := [2]int{}
	seen := map[string]bool{}
	seats := map[byte]bool{}
	var players []string // (the log's: each its account, name, team, a quitter)
	for _, p := range body.Players {
		if bad || (p.Team != 0 && p.Team != 1) || p.Seconds < 0 || p.Seconds > MaxMatchSeconds {
			bad = true
			break
		}
		t, err := s.playerTicket(p.Ticket, ticket.PurposeSeat, body.Match, now)
		// (each its seat's ticket for this match at this server in this playlist (its aud and playlist, as the matchmaker
		// signed them: RV-951), else refused as any ticket not for this)
		if err == nil && (t.Server != body.Server || int(t.Playlist) != body.Playlist) {
			err = errors.New("ticket: another server's or playlist's seat")
		}
		if err != nil {
			s.log(r).Warn("a result's ticket refused", "match", body.Match, "err", err)
			writeError(w, http.StatusForbidden, "ticket")
			return
		}
		account := accountID(t.Account)
		// (each account and each seat once, a seat's team its own: even blue, odd orange, RV-951)
		if seen[account] || seats[t.Seat] || int(t.Seat%2) != p.Team {
			bad = true
			break
		}
		seen[account] = true
		seats[t.Seat] = true
		perTeam[p.Team]++
		quit := ""
		if p.Quitter {
			quit = " quitter"
		}
		players = append(players, fmt.Sprintf("%s %q team %d%s", account, t.Name, p.Team, quit))
		res.Players = append(res.Players, store.ResultPlayer{
			Account: account, Team: p.Team, Quitter: p.Quitter, Seconds: p.Seconds, Nonce: t.Nonce, IssuedAt: t.Issued,
		})
	}
	if bad || perTeam[0] != body.Playlist || perTeam[1] != body.Playlist {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	recorded, err := s.Store.RecordResult(r.Context(), res, func(current map[string]*store.Rating) map[string]store.Rating {
		return ranked.Rate(res, current, now)
	}, now)
	switch {
	case errors.Is(err, store.ErrTicketUsed):
		writeError(w, http.StatusConflict, "ticket-used")
		return
	case store.IsDataError(err): // (data its checks let through and the database refused: wrong, not transient)
		s.log(r).Warn("a result refused by the database's constraints", "match", res.Match, "err", err)
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	case err != nil:
		s.log(r).Error("recording a result", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	if recorded {
		s.log(r).Info("result recorded", "match", res.Match, "playlist", res.Playlist, "winningTeam", res.WinningTeam,
			"players", strings.Join(players, ", "))
	}
	if id, err := strconv.ParseUint(body.Match, 16, 64); err == nil {
		s.Matchmaker.Ended("", id) // (its accounts free to search; its tickets the match's own, whatever server it names)
	}
	writeJSON(w, http.StatusOK, map[string]any{"recorded": recorded})
}

// rejoinCheck: POST /api/fleet/rejoin, a game server's question before it lets a player back into a match (RV-1008):
// the rejoin's ticket (ours, for that match, as a refill's) and the server asking. 200 {"rejoin": true} while the
// account's latest match is still that one, at that server (Matchmaker.RejoinCheck); false once it searched or was
// matched since. The server refuses the rejoin unless told true. Nothing spent: the server takes the ticket's one-time id
func (s *Server) rejoinCheck(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Match  string `json:"match"`
		Server string `json:"server"`
		Ticket string `json:"ticket"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	if !matchID.MatchString(body.Match) || !serverName.MatchString(body.Server) {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	t, err := s.playerTicket(body.Ticket, ticket.PurposeRejoin, body.Match, s.Now())
	if err != nil {
		s.log(r).Warn("a rejoin's ticket refused", "match", body.Match, "server", body.Server, "err", err)
		writeError(w, http.StatusForbidden, "ticket")
		return
	}
	account := accountID(t.Account)
	// (each account's questions, then everyone's: the account's own replays use up its budget alone, RV-1020)
	if s.rejoinQuestions != nil && (!s.rejoinQuestions.Allow(account, s.Now()) || !s.rejoinCeiling.Allow("rejoin", s.Now())) {
		writeError(w, http.StatusTooManyRequests, "busy")
		return
	}
	ok := s.Matchmaker.RejoinCheck(account, t.Match, body.Server, t.Nonce)
	if !ok {
		s.log(r).Info("a rejoin refused: the account searched or was matched since, or the match is another server's", "match", body.Match,
			"server", body.Server, "account", account, "name", t.Name)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"rejoin": ok})
}

// quitter: an armed leave (LV1: the lobby full of humans, no winner yet, the first leaver; the game server decides),
// reported at the leave with the player's ticket, spent for that match (one ticket, one match: AP3): the account's queue
// ban one step up the ladder. The same match again changes nothing
func (s *Server) quitter(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Match  string `json:"match"`
		Ticket string `json:"ticket"`
		At     int64  `json:"at"` // (the leave's time, Unix s: the ban runs from it, held within the window; none: now)
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	if !matchID.MatchString(body.Match) {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	now := s.Now()
	leftAt := now
	if body.At != 0 {
		leftAt = time.Unix(body.At, 0)
		if earliest := now.Add(-AcceptWindow); leftAt.Before(earliest) {
			leftAt = earliest
		}
		if leftAt.After(now) {
			leftAt = now
		}
	}
	t, err := s.playerTicket(body.Ticket, ticket.PurposeSeat, body.Match, now)
	if err != nil {
		s.log(r).Warn("a quitter's ticket refused", "match", body.Match, "err", err)
		writeError(w, http.StatusForbidden, "ticket")
		return
	}
	spent := &store.SpentTicket{Nonce: t.Nonce, IssuedAt: t.Issued, Match: body.Match}
	account := accountID(t.Account)
	err = s.Store.ChangeQueueBan(r.Context(), account, spent, now, func(cur store.QueueBan, exists bool) (*store.QueueBan, bool) {
		return ranked.Leave(cur, exists, body.Match, leftAt)
	})
	if err == nil {
		// (out of its match, and a search of its running now ended with the ban: RV-849)
		ban, banned, err := s.Store.QueueBanOf(r.Context(), account)
		until, on := ranked.BannedUntil(ban, banned, now)
		switch {
		case err != nil:
			// (the ban recorded, not read back: a search begun in the leave's moments ended all the same, its line the
			// ladder's first step from the leave (the page reads its account for the real one), said, RV-1012)
			s.log(r).Error("reading a quitter's ban back", "match", body.Match, "account", account, "err", err)
			s.Matchmaker.Quitter(account, leftAt.Add(ranked.Ladder[0]), now)
		case on:
			s.log(r).Info("a quitter reported: queue-banned", "match", body.Match, "account", account, "name", t.Name,
				"until", until.UTC().Format(time.RFC3339))
			s.Matchmaker.Quitter(account, until, now)
		default:
			// (a report late enough that its ban is over (its leave's time kept, the window held): a search of the account's
			// goes on, RV-965)
			s.log(r).Info("a quitter reported late: its ban already over", "match", body.Match, "account", account, "name", t.Name)
		}
	}
	s.queueBanDone(w, r, err)
}

// refill: a rejoin filled the lobby again (the game's RPC_RemoveQuitter), shown by the rejoin's own ticket (for that
// match, the player's: the token alone lifts no ban, AP3), spent: that match's ban undone
func (s *Server) refill(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Match  string `json:"match"`
		Ticket string `json:"ticket"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	if !matchID.MatchString(body.Match) {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	now := s.Now()
	t, err := s.playerTicket(body.Ticket, ticket.PurposeRejoin, body.Match, now)
	if err != nil {
		s.log(r).Warn("a refill's ticket refused", "match", body.Match, "err", err)
		writeError(w, http.StatusForbidden, "ticket")
		return
	}
	// (one refill a ticket: a replayed one can't lift a later ban from the same match, RX31)
	spent := &store.SpentTicket{Nonce: t.Nonce, IssuedAt: t.Issued, Match: body.Match, Once: true}
	err = s.Store.ChangeQueueBan(r.Context(), accountID(t.Account), spent, now, func(cur store.QueueBan, exists bool) (*store.QueueBan, bool) {
		return ranked.Refilled(cur, exists, body.Match)
	})
	if err == nil {
		s.log(r).Info("a refill: that match's queue ban undone", "match", body.Match, "account", accountID(t.Account), "name", t.Name)
	}
	s.queueBanDone(w, r, err)
}

func (s *Server) queueBanDone(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case err == nil, errors.Is(err, store.ErrNoAccount): // (an account deleted since: nothing to ban)
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, store.ErrTicketUsed): // (its ticket spent on another match)
		writeError(w, http.StatusConflict, "ticket-used")
	case store.IsDataError(err): // (refused by the database's constraints: wrong, not transient)
		s.log(r).Warn("a queue ban change refused by the database's constraints", "err", err)
		writeError(w, http.StatusBadRequest, "bad-request")
	default:
		s.log(r).Error("changing a queue ban", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
	}
}

// shownRatings: an account's ratings as the page shows them at now (each playlist; Default where it hasn't played),
// the deviation grown by the time since its last game there
func shownRatings(ratings map[int]store.Rating, now time.Time) []map[string]any {
	out := make([]map[string]any, 0, 3)
	for playlist := 1; playlist <= 3; playlist++ {
		r, ok := ratings[playlist]
		if !ok {
			r = ranked.Default
		}
		r.Deviation = ranked.Idle(r, now)
		sh := ranked.Shown(r)
		out = append(out, map[string]any{
			"playlist": playlist, "rating": sh.Rating, "deviation": sh.Deviation,
			"provisional": r.Deviation >= ranked.Provisional, "games": r.Games,
		})
	}
	return out
}
