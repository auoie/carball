package server

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"
	"unicode/utf8"

	"carball/api/internal/matchmaker"
	"carball/api/internal/ticket"
)

// The development matchmaker (`carball-api matchmaker --dev`: notes/matchmaking.md, the central matchmaker): the search
// and the game servers' events alone, no database and no sign-in, on loopback, for a development page and the browser
// tests. A search names its player (the page's key and name, as a development server's /dev-ticket); match tickets are
// signed with the development key (ticket.DevSigner), which only a development game server takes

// devKey is a development page's key (16 hex digits); its account is the key twice, as a development ticket's
var devKey = regexp.MustCompile(`^[0-9a-f]{16}$`)

// DevHandler routes the development matchmaker's calls, each open to a page on this machine (CORS)
func (s *Server) DevHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/search", s.devStartSearch)
	mux.HandleFunc("GET /api/search/{id}", s.devPollSearch)
	mux.HandleFunc("DELETE /api/search/{id}", s.devCancelSearch)
	mux.HandleFunc("POST /api/fleet/events", s.fleetEvent)
	mux.HandleFunc("POST /api/fleet/rejoin", s.devRejoinCheck)
	// (a development server's outbox sends its results too: a match's end, its accounts free, no ratings; a quitter
	// banned DevBan (the ladder's first step), a refill lifting it)
	mux.HandleFunc("POST /api/results", s.devResult)
	mux.HandleFunc("POST /api/quitters", s.devQuitter)
	mux.HandleFunc("POST /api/refills", s.devRefill)
	// (up: the browser tests' wait for it)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok\n")) })
	return s.logged(devCORS(mux))
}

// localPage: an Origin of a page on this machine (localhost or a loopback address, any port)
func localPage(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	h := u.Hostname()
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// devCORS: a page on this machine may call (its preflight answered); no Origin (a game server's outbox) passes as is
func devCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !localPage(origin) {
				writeError(w, http.StatusForbidden, "forbidden")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, "+WriteHeader)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next.ServeHTTP(w, r)
	})
}

// devStartSearch: a development page's search, its player named by the page (its key and name), a new account's
// ratings
func (s *Server) devStartSearch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		searchBody
		Name string `json:"name"`
		Key  string `json:"key"`
	}
	if err := readJSON(r, &body); err != nil {
		badBody(w, err)
		return
	}
	req, ok := body.request()
	if !ok || !devKey.MatchString(body.Key) || body.Name == "" || len(body.Name) > 32 || !utf8.ValidString(body.Name) {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	k := body.Key + body.Key
	account := k[:8] + "-" + k[8:12] + "-" + k[12:16] + "-" + k[16:20] + "-" + k[20:]
	whoOf(r).signedIn(account, body.Name)
	now := s.Now()
	if until, banned := s.devBanOf(account, now); banned {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "queue-banned", "seconds": secondsUntil(until, now)})
		return
	}
	fresh := ticket.Shown{Rating: 1500, Deviation: 500}
	s.openSearch(w, r, matchmaker.Player{Account: account, Name: body.Name, Ratings: [3]ticket.Shown{fresh, fresh, fresh}}, req, now)
}

// DevBan is a development quitter's ban (the ladder's first step)
const DevBan = 5 * time.Minute

// devBanOf: a development account's ban's end, if one's in force
func (s *Server) devBanOf(account string, now time.Time) (time.Time, bool) {
	s.devMu.Lock()
	defer s.devMu.Unlock()
	until, ok := s.devBans[account]
	return until, ok && until.After(now)
}

// devTicketAccount: a development server's call's ticket's account (the development key's), if it's one
func (s *Server) devTicketAccount(r *http.Request) (string, bool) {
	var body struct {
		Ticket string `json:"ticket"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return "", false
	}
	t, err := ticket.VerifySigned(body.Ticket, map[string]ed25519.PublicKey{ticket.DevKeyID: s.Tickets.PublicKey()})
	if err != nil {
		return "", false
	}
	return accountID(t.Account), true
}

// devRejoinCheck: a development server's rejoin question (the service's, RV-1008), its ticket the development key's
func (s *Server) devRejoinCheck(w http.ResponseWriter, r *http.Request) {
	s.answerRejoin(w, r, func(encoded, match string, _ time.Time) (ticket.Ticket, error) {
		t, err := ticket.VerifySigned(encoded, map[string]ed25519.PublicKey{ticket.DevKeyID: s.Tickets.PublicKey()})
		if err == nil && (t.Purpose != ticket.PurposeRejoin || matchText(t.Match) != match) {
			err = errors.New("ticket: not for this")
		}
		return t, err
	})
}

// devQuitter: a development quitter banned DevBan, its search ended with it
func (s *Server) devQuitter(w http.ResponseWriter, r *http.Request) {
	if account, ok := s.devTicketAccount(r); ok {
		now := s.Now()
		s.devMu.Lock()
		if s.devBans == nil {
			s.devBans = map[string]time.Time{}
		}
		s.devBans[account] = now.Add(DevBan)
		s.devMu.Unlock()
		s.Matchmaker.Quitter(account, now.Add(DevBan), now)
	}
	w.WriteHeader(http.StatusNoContent)
}

// devRefill: a development refill, the ban lifted
func (s *Server) devRefill(w http.ResponseWriter, r *http.Request) {
	if account, ok := s.devTicketAccount(r); ok {
		s.devMu.Lock()
		delete(s.devBans, account)
		s.devMu.Unlock()
	}
	w.WriteHeader(http.StatusNoContent)
}

// devPollSearch: a development page's poll (no session: its search's id alone)
func (s *Server) devPollSearch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	after, err := strconv.Atoi(r.URL.Query().Get("after"))
	if err != nil || after < 0 || len(id) != 32 {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	s.poll(w, r, id, "", after)
}

// devCancelSearch: a development page's Cancel Search (no sessions: any search's, by its id)
func (s *Server) devCancelSearch(w http.ResponseWriter, r *http.Request) {
	s.Matchmaker.Cancel(r.PathValue("id"), "")
	w.WriteHeader(http.StatusNoContent)
}

// devResult: a development match's result, taken as its end alone
func (s *Server) devResult(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Match string `json:"match"`
	}
	// (the rest of the result not read: its players, teams and tickets are a development server's)
	_ = json.NewDecoder(r.Body).Decode(&body)
	if id, err := strconv.ParseUint(body.Match, 16, 64); err == nil {
		s.Matchmaker.Ended("", id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"recorded": false})
}
