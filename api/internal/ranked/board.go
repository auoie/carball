package ranked

import (
	"slices"
	"strings"
	"time"

	"carball/api/internal/store"
)

// OrderBoard orders a playlist's ratings as its leaderboard: by the rating as shown, highest first, ties by games (more
// first), then name, then account id (names aren't unique: a row never swaps with another between reads; the id never
// shown) (the admin's `ratings --top` and the public leaderboard's)
func OrderBoard(all []store.Rated) {
	slices.SortStableFunc(all, func(a, b store.Rated) int {
		ra, rb := Shown(a.Rating).Rating, Shown(b.Rating).Rating
		switch {
		case ra != rb:
			return int(rb) - int(ra)
		case a.Rating.Games != b.Rating.Games:
			return b.Rating.Games - a.Rating.Games
		case a.Name != b.Name:
			return strings.Compare(a.Name, b.Name)
		}
		return strings.Compare(a.Account, b.Account)
	})
}

// IsProvisional is whether a rating is provisional at now: its deviation, grown by the time since its last game, at
// Provisional or past it (a rating left idle long enough becomes provisional again)
func IsProvisional(r store.Rating, now time.Time) bool {
	return Idle(r, now) >= Provisional
}

// PublicBoard is a playlist's public leaderboard at now: its ratings ordered (OrderBoard), the provisional left out, the
// first n
func PublicBoard(all []store.Rated, n int, now time.Time) []store.Rated {
	settled := make([]store.Rated, 0, len(all))
	for _, r := range all {
		if !IsProvisional(r.Rating, now) {
			settled = append(settled, r)
		}
	}
	OrderBoard(settled)
	return settled[:min(n, len(settled))]
}

// BoardPage reads a page of a playlist's board candidates in rating order (highest first, then the account id) after
// `after` (nil: the top): up to n (store.BoardRatings: the stored deviation under the line, no ban in force)
type BoardPage func(after *store.Rated, n int) ([]store.Rated, error)

// ReadBoard is the public board at now (PublicBoard's) read a page of `page` at a time instead of every rating: in
// rating order, the provisional at now skipped (idling only raises a deviation, so the stored deviation's cut loses
// none), until n have passed and the next row's rating as shown is under the nth's (the ties at the nth all read, so
// OrderBoard's games, name and id order among them is exact), or the ratings run out
func ReadBoard(read BoardPage, n, page int, now time.Time) ([]store.Rated, error) {
	var kept []store.Rated
	var after *store.Rated
	for {
		rows, err := read(after, page)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			if len(kept) >= n && Shown(r.Rating).Rating < Shown(kept[n-1].Rating).Rating {
				return PublicBoard(kept, n, now), nil
			}
			if !IsProvisional(r.Rating, now) {
				kept = append(kept, r)
			}
		}
		if len(rows) < page {
			return PublicBoard(kept, n, now), nil
		}
		after = &rows[len(rows)-1]
	}
}
