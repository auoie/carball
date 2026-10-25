package matchmaker

import "time"

// Stats is the matchmaker's state counted for the public stats (GET /api/stats): aggregates only, no account, name or
// match id. By playlist (1v1, 2v2, 3v3: index 0, 1, 2) its matches and the players in them, and the players searching
// it (a search of several playlists counted in each); by game server (its name, host:port) its matches and players; the
// players playing (in a match or searching, each once) and the matches
type Stats struct {
	Playlists [3]PlaylistStats
	Servers   map[string]ServerStats
	Playing   int
	Matches   int
}

// PlaylistStats is a playlist's count: its matches, the players in them, the players searching it
type PlaylistStats struct {
	Matches, Players, Searching int
}

// ServerStats is a game server's count: its matches and the players in them
type ServerStats struct {
	Matches, Players int
}

// Stats counts the matchmaker's state at now (what expired let go first). A match counts from its assignment (its players
// joining) until its server's word that it ended or was cancelled; its players are those in it: before its start the
// accounts it still holds (one that searched again since is searching), after it those present (a leaver out, a rejoin
// back). A search counts while it would be matched (polled, a poll open or just answered: Tick's)
func (m *Matchmaker) Stats(now time.Time) Stats {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tidy(now)
	out := Stats{Servers: map[string]ServerStats{}}
	for id, mt := range m.matches {
		players := 0
		if mt.started.IsZero() {
			for _, a := range mt.accounts {
				if m.active[a] == id {
					players++
				}
			}
		} else {
			players = len(mt.present)
		}
		if p := len(mt.accounts) / 2; p >= 1 && p <= len(out.Playlists) {
			out.Playlists[p-1].Matches++
			out.Playlists[p-1].Players += players
		}
		s := out.Servers[mt.server]
		s.Matches++
		s.Players += players
		out.Servers[mt.server] = s
		out.Matches++
		out.Playing += players
	}
	for _, s := range m.open {
		if s.state.Kind != Searching || !s.polled || (s.polls == 0 && now.Sub(s.lastPoll) >= PollGap) {
			continue
		}
		for _, p := range s.playlists {
			if p >= 1 && int(p) <= len(out.Playlists) {
				out.Playlists[p-1].Searching++
			}
		}
		out.Playing++
	}
	return out
}
