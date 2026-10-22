package store

// The admin's reports (carball-api stats, matches, account, ratings, queue-bans): read-only, from what the service keeps
// already; nothing new tracked for them

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Stats is the live app at a glance: the accounts, the ranked results by playlist (indexed 1 to 3), the bans in force
type Stats struct {
	Accounts, NewToday, NewWeek int
	MatchesToday, MatchesWeek   [4]int
	Bans, QueueBans             int
}

// StatsAt counts them at now: today since the UTC day began, the week the last 7 days
func (s *Store) StatsAt(ctx context.Context, now time.Time) (Stats, error) {
	var st Stats
	day := now.UTC().Truncate(24 * time.Hour)
	week := now.Add(-7 * 24 * time.Hour)
	err := s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM accounts),
		(SELECT count(*) FROM accounts WHERE created_at >= $1),
		(SELECT count(*) FROM accounts WHERE created_at >= $2),
		(SELECT count(*) FROM bans WHERE until IS NULL OR until > $3),
		(SELECT count(*) FROM queue_bans WHERE until > $3)`, day, week, now).
		Scan(&st.Accounts, &st.NewToday, &st.NewWeek, &st.Bans, &st.QueueBans)
	if err != nil {
		return st, err
	}
	rows, err := s.pool.Query(ctx, `SELECT playlist, count(*) FILTER (WHERE received_at >= $1), count(*)
		FROM ranked_results WHERE received_at >= $2 GROUP BY playlist`, day, week)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var playlist, today, inWeek int
		if err := rows.Scan(&playlist, &today, &inWeek); err != nil {
			return st, err
		}
		if playlist >= 1 && playlist <= 3 {
			st.MatchesToday[playlist], st.MatchesWeek[playlist] = today, inWeek
		}
	}
	return st, rows.Err()
}

// MatchPlayer is one player of a recorded result: the account ("" once deleted) and its name, team, whether they
// left, and the rating before and after
type MatchPlayer struct {
	Account, Name string
	Team          int
	Quitter       bool
	Before, After float64
}

// MatchSummary is a recorded ranked result: when it came, its playlist, the winning team, its players
type MatchSummary struct {
	Match    string
	At       time.Time
	Playlist int
	Winner   int
	Players  []MatchPlayer
}

// RecentMatches lists the latest `n` results, newest first
func (s *Store) RecentMatches(ctx context.Context, n int) ([]MatchSummary, error) {
	return s.matches(ctx, n, nil)
}

// MatchesOf lists the latest `n` results an account played in, newest first
func (s *Store) MatchesOf(ctx context.Context, accountID string, n int) ([]MatchSummary, error) {
	return s.matches(ctx, n, &accountID)
}

func (s *Store) matches(ctx context.Context, n int, accountID *string) ([]MatchSummary, error) {
	rows, err := s.pool.Query(ctx, `WITH r AS (SELECT match_id, received_at, playlist, winning_team FROM ranked_results
			WHERE $2::uuid IS NULL OR match_id IN (SELECT match_id FROM ranked_result_players WHERE account_id = $2::uuid)
			ORDER BY received_at DESC, match_id LIMIT $1)
		SELECT r.match_id, r.received_at, r.playlist, r.winning_team, coalesce(p.account_id::text, ''),
			coalesce(a.name, ''), p.team, p.quitter, p.rating_before, p.rating_after
		FROM r JOIN ranked_result_players p ON p.match_id = r.match_id LEFT JOIN accounts a ON a.id = p.account_id
		ORDER BY r.received_at DESC, r.match_id, p.team, a.name`, n, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MatchSummary
	for rows.Next() {
		var m MatchSummary
		var p MatchPlayer
		if err := rows.Scan(&m.Match, &m.At, &m.Playlist, &m.Winner, &p.Account, &p.Name, &p.Team, &p.Quitter, &p.Before, &p.After); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1].Match != m.Match {
			out = append(out, m)
		}
		last := &out[len(out)-1]
		last.Players = append(last.Players, p)
	}
	return out, rows.Err()
}

// FoundAccount is one account as FindAccounts shows it; false: no such account
func (s *Store) FoundAccount(ctx context.Context, id string) (Found, bool, error) {
	rows, err := s.pool.Query(ctx, foundAccounts+` WHERE a.id = $1::uuid GROUP BY a.id`, id)
	if err != nil {
		return Found{}, false, err
	}
	found, err := collectFound(rows)
	if err != nil || len(found) == 0 {
		return Found{}, false, err
	}
	return found[0], true, nil
}

// Rated is an account's rating in a playlist, with its name
type Rated struct {
	Account, Name string
	Rating        Rating
}

// PlaylistRatings lists every account's rating in a playlist (its leaderboard is ordered by the rating as shown)
func (s *Store) PlaylistRatings(ctx context.Context, playlist int) ([]Rated, error) {
	rows, err := s.pool.Query(ctx, `SELECT r.account_id::text, a.name, r.rating, r.deviation, r.volatility, r.games,
		r.last_played FROM ratings r JOIN accounts a ON a.id = r.account_id WHERE r.playlist = $1`, playlist)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Rated, error) {
		var r Rated
		err := row.Scan(&r.Account, &r.Name, &r.Rating.Rating, &r.Rating.Deviation, &r.Rating.Volatility, &r.Rating.Games, &r.Rating.LastPlayed)
		return r, err
	})
}

// QueueBanned is a leave ban in force: the account, its name, its step on the ladder, until when, its last leave
type QueueBanned struct {
	Account, Name    string
	Step             int
	Until, LastLeave time.Time
}

// QueueBans lists the leave bans in force at now, the latest to end first
func (s *Store) QueueBans(ctx context.Context, now time.Time) ([]QueueBanned, error) {
	rows, err := s.pool.Query(ctx, `SELECT q.account_id::text, a.name, q.step, q.until, q.last_leave FROM queue_bans q
		JOIN accounts a ON a.id = q.account_id WHERE q.until > $1 ORDER BY q.until DESC`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (QueueBanned, error) {
		var q QueueBanned
		err := row.Scan(&q.Account, &q.Name, &q.Step, &q.Until, &q.LastLeave)
		return q, err
	})
}
