package ranked

import (
	"slices"
	"strings"
	"time"

	"carball/api/internal/store"
)

// OrderBoard orders a playlist's ratings as its leaderboard: by the rating as shown, highest first, ties by games (more
// first) then name (the admin's `ratings --top` and the public leaderboard's)
func OrderBoard(all []store.Rated) {
	slices.SortStableFunc(all, func(a, b store.Rated) int {
		ra, rb := Shown(a.Rating).Rating, Shown(b.Rating).Rating
		switch {
		case ra != rb:
			return int(rb) - int(ra)
		case a.Rating.Games != b.Rating.Games:
			return b.Rating.Games - a.Rating.Games
		}
		return strings.Compare(a.Name, b.Name)
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
