package ranked

import (
	"slices"
	"testing"
	"time"

	"carball/api/internal/store"
)

var boardNow = time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)

func rated(name string, rating, deviation float64, games int, lastPlayed time.Time) store.Rated {
	return store.Rated{Account: "id-" + name, Name: name, Rating: store.Rating{Rating: rating, Deviation: deviation, Volatility: DefaultVolatility, Games: games, LastPlayed: lastPlayed}}
}

func names(all []store.Rated) []string {
	out := make([]string, len(all))
	for i, r := range all {
		out[i] = r.Name
	}
	return out
}

// The order: by the rating as shown (rounded: 1600.4 ties 1600), ties by games (more first), then by name
func TestOrderBoard(t *testing.T) {
	all := []store.Rated{
		rated("Cleo", 1600, 60, 10, boardNow),
		rated("Abe", 1700, 60, 5, boardNow),
		rated("Bea", 1600.4, 60, 10, boardNow),
		rated("Dan", 1600, 60, 30, boardNow),
		rated("Eve", 1400, 60, 99, boardNow),
	}
	OrderBoard(all)
	if got, want := names(all), []string{"Abe", "Dan", "Bea", "Cleo", "Eve"}; !slices.Equal(got, want) {
		t.Fatalf("order %v, want %v", got, want)
	}
}

// The public board: the provisional left out, the deviation as grown by the time since the last game (a settled rating
// left idle long enough is provisional again), the first n
func TestPublicBoard(t *testing.T) {
	all := []store.Rated{
		rated("Settled", 1500, 60, 40, boardNow),
		rated("New", 1900, 300, 2, boardNow),                        // (provisional by its deviation)
		rated("JustUnder", 1800, Provisional-1, 12, boardNow),       // (under the line now)
		rated("Idle", 2000, 100, 80, boardNow.AddDate(-2, 0, 0)),    // (its deviation grown past the line)
		rated("Recent", 1700, 100, 20, boardNow.Add(-24*time.Hour)), // (grown, still under)
	}
	if !IsProvisional(all[3].Rating, boardNow) || IsProvisional(all[4].Rating, boardNow) {
		t.Fatal("the idle rating should be provisional at now, the recent one not")
	}
	if got, want := names(PublicBoard(slices.Clone(all), 100, boardNow)), []string{"JustUnder", "Recent", "Settled"}; !slices.Equal(got, want) {
		t.Fatalf("board %v, want %v", got, want)
	}
	if got, want := names(PublicBoard(slices.Clone(all), 2, boardNow)), []string{"JustUnder", "Recent"}; !slices.Equal(got, want) {
		t.Fatalf("board of 2 %v, want %v", got, want)
	}
	if got := PublicBoard(nil, 100, boardNow); len(got) != 0 {
		t.Fatalf("an empty board: %v", got)
	}
}
