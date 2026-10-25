package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"carball/api/internal/ranked"
)

// The public reads (no sign-in; the menu's): the live counts from the matchmaker (GET /api/stats) and a playlist's
// leaderboard (GET /api/leaderboard?playlist=1v1), each answered from a copy kept a while (StatsKept, BoardKept), so
// however many pages read them, the matchmaker's lock or the database is asked once a period. Aggregates and display
// names only: no account id, match id or address

const (
	// StatsKept is how long the live counts are answered from the last count
	StatsKept = 5 * time.Second
	// BoardKept is how long a playlist's leaderboard is answered from its last read
	BoardKept = time.Minute
	// BoardSize is how many players a leaderboard lists
	BoardSize = 100
	// boardRead is how long a leaderboard's database read may take
	boardRead = 5 * time.Second
)

// keptBody is an answer kept until `until`; its lock held while it's made, so the requests meanwhile wait for that one
type keptBody struct {
	mu    sync.Mutex
	until time.Time
	body  []byte
}

// get is the kept answer at now, made again (kept for `keep`) once it's expired; an error isn't kept
func (k *keptBody) get(now time.Time, keep time.Duration, fill func() ([]byte, error)) ([]byte, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.body != nil && now.Before(k.until) {
		return k.body, nil
	}
	body, err := fill()
	if err != nil {
		return nil, err
	}
	k.body, k.until = body, now.Add(keep)
	return body, nil
}

// publicReads are the public reads' kept answers: the counts, and each playlist's leaderboard
type publicReads struct {
	stats  keptBody
	boards [3]keptBody
}

type playlistCount struct {
	Playlist  int `json:"playlist"`
	Matches   int `json:"matches"`
	Players   int `json:"players"`
	Searching int `json:"searching"`
}

type serverCount struct {
	Matches int `json:"matches"`
	Players int `json:"players"`
}

// statsBody: by playlist (its team size) its matches, their players and those searching it; by game server (host:port,
// the page's regions' servers) its matches and players; the players playing (in a match or searching) and the matches
type statsBody struct {
	Playlists []playlistCount        `json:"playlists"`
	Servers   map[string]serverCount `json:"servers"`
	Playing   int                    `json:"playing"`
	Matches   int                    `json:"matches"`
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	now := s.Now()
	body, err := s.public.stats.get(now, StatsKept, func() ([]byte, error) {
		out := statsBody{Playlists: []playlistCount{}, Servers: map[string]serverCount{}}
		if s.Matchmaker != nil {
			st := s.Matchmaker.Stats(now)
			for i, p := range st.Playlists {
				out.Playlists = append(out.Playlists, playlistCount{Playlist: i + 1, Matches: p.Matches, Players: p.Players, Searching: p.Searching})
			}
			for name, c := range st.Servers {
				out.Servers[name] = serverCount(c)
			}
			out.Playing, out.Matches = st.Playing, st.Matches
		}
		return json.Marshal(out)
	})
	if err != nil {
		s.log(r).Error("counting the live stats", "err", err)
		writeError(w, http.StatusInternalServerError, "server")
		return
	}
	writeBody(w, body)
}

type boardRow struct {
	Rank   int    `json:"rank"`
	Name   string `json:"name"`
	Rating int    `json:"rating"`
	Games  int    `json:"games"`
}

// boardBody: a playlist's leaderboard ("1v1"): its top BoardSize by the rating as shown, the provisional left out
// (ranked.PublicBoard)
type boardBody struct {
	Playlist string     `json:"playlist"`
	Players  []boardRow `json:"players"`
}

// boardPlaylists: the playlists a leaderboard is asked for by name, their team sizes
var boardPlaylists = map[string]int{"1v1": 1, "2v2": 2, "3v3": 3}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("playlist")
	p, ok := boardPlaylists[name]
	if !ok {
		writeError(w, http.StatusBadRequest, "bad-request")
		return
	}
	now := s.Now()
	body, err := s.public.boards[p-1].get(now, BoardKept, func() ([]byte, error) {
		ctx, cancel := context.WithTimeout(r.Context(), boardRead)
		defer cancel()
		all, err := s.Store.PlaylistRatings(ctx, p)
		if err != nil {
			return nil, err
		}
		out := boardBody{Playlist: name, Players: []boardRow{}}
		for i, rated := range ranked.PublicBoard(all, BoardSize, now) {
			out.Players = append(out.Players, boardRow{Rank: i + 1, Name: rated.Name, Rating: int(ranked.Shown(rated.Rating).Rating), Games: rated.Rating.Games})
		}
		return json.Marshal(out)
	})
	if err != nil {
		s.log(r).Error("reading a leaderboard", "playlist", name, "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	writeBody(w, body)
}

// writeBody: a 200 with a JSON body already made
func writeBody(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
