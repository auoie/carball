package ranked

import (
	"errors"
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

// The leaderboard's index holds the provisional line as a literal (00003_indexes.sql): it and Provisional are one number
func TestBoardDeviationIsProvisional(t *testing.T) {
	if store.BoardDeviation != Provisional {
		t.Fatalf("store.BoardDeviation %v, Provisional %v: change the index's migration with it", store.BoardDeviation, Provisional)
	}
}

// Names aren't unique: two rows the same in rating, games and name keep one order, by account id (RV-1161)
func TestOrderBoardTiesByAccount(t *testing.T) {
	all := []store.Rated{rated("Twin", 1600, 60, 10, boardNow), rated("Twin", 1600, 60, 10, boardNow)}
	all[0].Account, all[1].Account = "id-b", "id-a"
	OrderBoard(all)
	if all[0].Account != "id-a" {
		t.Fatalf("order %v", all)
	}
}

// pages: a reader over rows already in the board query's order (the rating, then the account id), counting its reads
func pages(rows []store.Rated) (BoardPage, *int) {
	reads := 0
	return func(after *store.Rated, n int) ([]store.Rated, error) {
		reads++
		from := 0
		if after != nil {
			for i, r := range rows {
				if r.Account == after.Account {
					from = i + 1
				}
			}
		}
		return rows[from:min(from+n, len(rows))], nil
	}, &reads
}

// ReadBoard: the public board read a page at a time, the same as PublicBoard over every row: rows idle past the line
// skipped (pages read on for them), the ties at the nth all read (one with more games on a later page comes in), and no
// more pages read once the rating as shown falls under the nth's
func TestReadBoard(t *testing.T) {
	long := boardNow.AddDate(-2, 0, 0)
	rows := []store.Rated{
		rated("IdleTop", 2100, 100, 90, long), // (provisional by idling: skipped)
		rated("A", 2000, 60, 10, boardNow),
		rated("IdleToo", 1990, 100, 90, long),
		rated("B", 1900, 60, 5, boardNow),
		rated("C", 1900.2, 60, 9, boardNow),  // (shown 1900: tied with B and D)
		rated("D", 1899.6, 60, 30, boardNow), // (shown 1900, more games: ahead of B and C)
		rated("E", 1800, 60, 10, boardNow),
		rated("F", 1700, 60, 10, boardNow),
	}
	// (the query's order: the raw rating, highest first)
	slices.SortStableFunc(rows, func(a, b store.Rated) int {
		switch {
		case a.Rating.Rating > b.Rating.Rating:
			return -1
		case a.Rating.Rating < b.Rating.Rating:
			return 1
		}
		return 0
	})
	read, reads := pages(rows)
	got, err := ReadBoard(read, 3, 2, boardNow)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"A", "D", "C"}; !slices.Equal(names(got), want) {
		t.Fatalf("board %v, want %v", names(got), want)
	}
	if want := names(PublicBoard(slices.Clone(rows), 3, boardNow)); !slices.Equal(names(got), want) {
		t.Fatalf("board %v, PublicBoard's %v", names(got), want)
	}
	// (pages of 2: IdleTop A, IdleToo C, B D, E F: stopped at E, under the third's 1900; never past it)
	if *reads != 4 {
		t.Fatalf("%d pages read, want 4", *reads)
	}
	// (all of them fewer than n: every page read, the last short)
	read, reads = pages(rows[:3])
	if got, _ := ReadBoard(read, 3, 2, boardNow); !slices.Equal(names(got), []string{"A"}) || *reads != 2 {
		t.Fatalf("short: %v in %d reads", names(got), *reads)
	}
	failing := func(*store.Rated, int) ([]store.Rated, error) { return nil, errors.New("down") }
	if _, err := ReadBoard(failing, 3, 2, boardNow); err == nil {
		t.Fatal("a failed read: no error")
	}
}
