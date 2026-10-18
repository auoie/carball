package server

import (
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
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
// constant time, behind the tunnel's Access service token; JSON bodies as the browser's writes. None configured: 503
func (s *Server) gameServer(next http.HandlerFunc) http.HandlerFunc {
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
		if r.ContentLength > maxBody {
			writeError(w, http.StatusRequestEntityTooLarge, "too-large")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next(w, r)
	}
}

// playerTicket checks a player's ticket as a result or quitter carries it: our signature (a key from before a rotation
// too), issued within the acceptance window (and not ahead of now past the skew)
func (s *Server) playerTicket(encoded string, now time.Time) (ticket.Ticket, error) {
	t, err := ticket.VerifySigned(encoded, s.TicketKeys)
	if err != nil {
		return ticket.Ticket{}, err
	}
	if t.Issued.After(now.Add(30*time.Second)) || now.Sub(t.Issued) > AcceptWindow {
		return ticket.Ticket{}, errors.New("ticket: outside the acceptance window")
	}
	return t, nil
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
	for _, p := range body.Players {
		if bad || (p.Team != 0 && p.Team != 1) || p.Seconds < 0 || p.Seconds > MaxMatchSeconds {
			bad = true
			break
		}
		t, err := s.playerTicket(p.Ticket, now)
		if err != nil {
			s.Log.Warn("a result's ticket refused", "match", body.Match, "err", err)
			writeError(w, http.StatusForbidden, "ticket")
			return
		}
		account := accountID(t.Account)
		if seen[account] {
			bad = true
			break
		}
		seen[account] = true
		perTeam[p.Team]++
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
	case err != nil:
		s.Log.Error("recording a result", "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	if recorded {
		s.Log.Info("result recorded", "match", res.Match, "playlist", res.Playlist)
	}
	writeJSON(w, http.StatusOK, map[string]any{"recorded": recorded})
}

// quitter: an armed leave (LV1: the lobby full of humans, no winner yet, the first leaver; the game server decides),
// reported at the leave with the player's ticket: the account's queue ban one step up the ladder. The same match again
// changes nothing
func (s *Server) quitter(w http.ResponseWriter, r *http.Request) {
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
	t, err := s.playerTicket(body.Ticket, now)
	if err != nil {
		writeError(w, http.StatusForbidden, "ticket")
		return
	}
	err = s.Store.ChangeQueueBan(r.Context(), accountID(t.Account), func(cur store.QueueBan, exists bool) (*store.QueueBan, bool) {
		return ranked.Leave(cur, exists, body.Match, now)
	})
	s.queueBanDone(w, err)
}

// quitterRefilled: a rejoin filled the lobby again (the game's RPC_RemoveQuitter): that match's ban undone
func (s *Server) quitterRefilled(w http.ResponseWriter, r *http.Request) {
	match, account := r.PathValue("match"), r.PathValue("account")
	if !matchID.MatchString(match) || !uuidText.MatchString(account) {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	err := s.Store.ChangeQueueBan(r.Context(), account, func(cur store.QueueBan, exists bool) (*store.QueueBan, bool) {
		return ranked.Refilled(cur, exists, match)
	})
	s.queueBanDone(w, err)
}

var uuidText = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func (s *Server) queueBanDone(w http.ResponseWriter, err error) {
	switch {
	case err == nil, errors.Is(err, store.ErrNoAccount): // (an account deleted since: nothing to ban)
		w.WriteHeader(http.StatusNoContent)
	default:
		s.Log.Error("changing a queue ban", "err", err)
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
