package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"carball/api/internal/ranked"
	"carball/api/internal/store"
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
	// boardPage is how many ratings a leaderboard's read takes from the database at a time (one page, mostly: a few of
	// the top idle past the provisional line, or ties at the 100th, read on)
	boardPage = 128
	// fillFor is how long one read of a kept answer may take (its own: not cut short by the request that asked first)
	fillFor = 5 * time.Second
	// errorKept is how long a read that failed is answered from (the database not asked again by every request meanwhile)
	errorKept = 5 * time.Second
)

// keptBody is an answer kept until `until`, or the error of its last read kept until `errUntil`; one read at a time for
// everyone who asks meanwhile (`reading`), each asker waiting only as long as its own request lasts (RV-1158)
type keptBody struct {
	mu       sync.Mutex
	until    time.Time
	body     []byte
	err      error
	errUntil time.Time
	reading  singleflight.Group
}

// kept is the answer, or the error, kept at now (ok false: neither)
func (k *keptBody) kept(now time.Time) (body []byte, ok bool, err error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.body != nil && now.Before(k.until) {
		return k.body, true, nil
	}
	if k.err != nil && now.Before(k.errUntil) {
		return nil, true, k.err
	}
	return nil, false, nil
}

// get is the kept answer at now, else one read (`fill`, on its own context: ctx's values, never its cancel, fillFor
// long) shared by every asker meanwhile, its answer kept for `keep` (an error for errorKept, logged once on `log` as
// `what`'s); ctx's end ends this asker's wait alone
func (k *keptBody) get(ctx context.Context, now time.Time, keep time.Duration, log *slog.Logger, what string, fill func(context.Context) ([]byte, error)) ([]byte, error) {
	if body, ok, err := k.kept(now); ok {
		return body, err
	}
	answer := k.reading.DoChan("", func() (any, error) {
		// (another read's answer may have come between the look above and this read's start)
		if body, ok, err := k.kept(now); ok {
			return body, err
		}
		fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), fillFor)
		defer cancel()
		body, err := recovered(fctx, fill)
		k.mu.Lock()
		defer k.mu.Unlock()
		if err != nil {
			log.Error("a public read failed", "read", what, "err", err)
			k.err, k.errUntil = err, now.Add(errorKept)
			return nil, err
		}
		k.body, k.until, k.err = body, now.Add(keep), nil
		return body, nil
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-answer:
		if r.Err != nil {
			return nil, r.Err
		}
		body, _ := r.Val.([]byte)
		return body, nil
	}
}

// recovered is fill's answer, a panic in it an error (its value and stack): the shared read runs in singleflight's own
// goroutine, which re-raises a panic where nothing recovers it, so one bug in a read would stop the whole service
// (RV-1163)
func recovered(ctx context.Context, fill func(context.Context) ([]byte, error)) (body []byte, err error) {
	defer func() {
		if p := recover(); p != nil {
			body, err = nil, fmt.Errorf("a panic: %v\n%s", p, debug.Stack())
		}
	}()
	return fill(ctx)
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
	body, err := s.public.stats.get(r.Context(), now, StatsKept, s.Log, "the live stats", func(context.Context) ([]byte, error) {
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
		if r.Context().Err() == nil {
			writeError(w, http.StatusServiceUnavailable, "unavailable")
		}
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
	body, err := s.public.boards[p-1].get(r.Context(), now, BoardKept, s.Log, "the "+name+" leaderboard", func(ctx context.Context) ([]byte, error) {
		// (a page of ratings at a time from the board's index, the banned left out, till the top BoardSize are known:
		// ranked.ReadBoard)
		rows, err := ranked.ReadBoard(func(after *store.Rated, n int) ([]store.Rated, error) {
			return s.Store.BoardRatings(ctx, p, after, n, now)
		}, BoardSize, boardPage, now)
		if err != nil {
			return nil, err
		}
		out := boardBody{Playlist: name, Players: []boardRow{}}
		for i, rated := range rows {
			out.Players = append(out.Players, boardRow{Rank: i + 1, Name: rated.Name, Rating: int(ranked.Shown(rated.Rating).Rating), Games: rated.Rating.Games})
		}
		return json.Marshal(out)
	})
	if err != nil {
		if r.Context().Err() == nil {
			writeError(w, http.StatusServiceUnavailable, "unavailable")
		}
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
