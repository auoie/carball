package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// BoardDeviation is the provisional line the leaderboard's index holds (00003_indexes.sql's ratings_board predicate,
// literal in its query so the planner can use it): ranked.Provisional, which its test keeps equal
const BoardDeviation = 110.0

// The board's query (BoardRatings): its candidates ($1 the playlist, $2 now for the bans), the page after a row read
// (a lower rating, or the same one with a later account id: $4, $5; `rating <= $4` the index's bound), its order and
// size ($3)
const (
	boardHead = `SELECT r.account_id::text, a.name, r.rating, r.deviation, r.volatility, r.games, r.last_played
		FROM ratings r JOIN accounts a ON a.id = r.account_id
		WHERE r.playlist = $1 AND r.deviation < 110
		AND NOT EXISTS (SELECT 1 FROM identities i JOIN bans b ON b.provider = i.provider AND b.subject = i.subject
			WHERE i.account_id = r.account_id AND (b.until IS NULL OR b.until > $2))`
	boardAfter = ` AND r.rating <= $4 AND (r.rating < $4 OR r.account_id > $5::uuid)`
	boardTail  = ` ORDER BY r.rating DESC, r.account_id LIMIT $3`
)

// BoardRatings is a page of a playlist's leaderboard read (ratings_board's order: the rating, highest first, then the
// account id): up to n ratings whose stored deviation is under BoardDeviation, of accounts with no ban in force at now on
// any of their sign-ins, after `after` (nil: from the top). The idle check is the caller's (ranked.ReadBoard)
func (s *Store) BoardRatings(ctx context.Context, playlist int, after *Rated, n int, now time.Time) ([]Rated, error) {
	var rows pgx.Rows
	var err error
	if after == nil {
		rows, err = s.pool.Query(ctx, boardHead+boardTail, playlist, now, n)
	} else {
		rows, err = s.pool.Query(ctx, boardHead+boardAfter+boardTail, playlist, now, n, after.Rating.Rating, after.Account)
	}
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Rated, error) {
		var r Rated
		err := row.Scan(&r.Account, &r.Name, &r.Rating.Rating, &r.Rating.Deviation, &r.Rating.Volatility, &r.Rating.Games, &r.Rating.LastPlayed)
		return r, err
	})
}
