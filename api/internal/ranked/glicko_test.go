package ranked

import (
	"math"
	"testing"
	"time"

	"carball/api/internal/store"
	"carball/api/internal/ticket"
)

func near(t *testing.T, name string, got, want, tolerance float64) {
	t.Helper()
	if math.Abs(got-want) > tolerance {
		t.Errorf("%s = %.5f, want %.5f (±%g)", name, got, want, tolerance)
	}
}

// Glickman's worked example (2012): 1500/200/0.06, τ 0.5; a win over 1400/30, losses to 1550/100 and 1700/300
func TestGlickmansExample(t *testing.T) {
	r := Update(store.Rating{Rating: 1500, Deviation: 200, Volatility: 0.06}, []Opponent{
		{Rating: 1400, Deviation: 30, Score: 1},
		{Rating: 1550, Deviation: 100, Score: 0},
		{Rating: 1700, Deviation: 300, Score: 0},
	}, 0.5, 1)
	near(t, "rating", r.Rating, 1464.06, 0.01)
	near(t, "deviation", r.Deviation, 151.52, 0.01)
	near(t, "volatility", r.Volatility, 0.05999, 0.00001)
}

func TestNoGamesWidensTheDeviation(t *testing.T) {
	r := Update(store.Rating{Rating: 1600, Deviation: 100, Volatility: 0.06}, nil, Tau, 1)
	near(t, "rating kept", r.Rating, 1600, 0)
	if r.Deviation <= 100 {
		t.Errorf("deviation %v: not widened", r.Deviation)
	}
	// (held within the ceiling and floor)
	if r := Update(store.Rating{Rating: 1500, Deviation: 499, Volatility: 0.9}, nil, Tau, 1); r.Deviation != MaxDeviation {
		t.Errorf("the ceiling: %v", r.Deviation)
	}
	if r := Update(store.Rating{Rating: 1500, Deviation: 46, Volatility: 0.001}, []Opponent{{1500, 45, 1}}, Tau, 0); r.Deviation < MinDeviation {
		t.Errorf("the floor: %v", r.Deviation)
	}
}

func TestATeamsResultForEveryone(t *testing.T) {
	a, b, c, d := "a", "b", "c", "d"
	strong := &store.Rating{Rating: 1700, Deviation: 80, Volatility: 0.06, Games: 30}
	result := store.Result{Playlist: 2, WinningTeam: 0, Players: []store.ResultPlayer{
		{Account: a, Team: 0, Quitter: true}, {Account: b, Team: 0}, {Account: c, Team: 1}, {Account: d, Team: 1},
	}}
	// (d's account deleted since: not rated, and counted as a new rating in its team)
	got := Rate(result, map[string]*store.Rating{a: nil, b: strong, c: nil}, t0)
	if len(got) != 3 {
		t.Fatalf("rated %d, want 3 (the deleted account not)", len(got))
	}
	if got[a].Rating <= DefaultRating || got[b].Rating <= strong.Rating || got[c].Rating >= DefaultRating {
		t.Errorf("the winners up (the quitter too), the loser down: %+v", got)
	}
	if got[a].Games != 1 || got[b].Games != 31 || !got[c].LastPlayed.Equal(t0) {
		t.Errorf("games and time: %+v", got)
	}
	// (the composite: the mean rating, the deviations' root mean square)
	r, dev := Composite([]store.Rating{{Rating: 1400, Deviation: 30}, {Rating: 1600, Deviation: 40}})
	near(t, "composite rating", r, 1500, 0)
	near(t, "composite deviation", dev, math.Sqrt((900+1600)/2.0), 1e-9)
}

func TestTicketRatings(t *testing.T) {
	got := TicketRatings(map[int]store.Rating{2: {Rating: 1723.6, Deviation: 64.4, Volatility: 0.06, LastPlayed: t0}}, t0)
	want := [3]ticket.Shown{{Rating: 1500, Deviation: 500}, {Rating: 1724, Deviation: 64}, {Rating: 1500, Deviation: 500}}
	if got != want {
		t.Errorf("TicketRatings = %v, want %v", got, want)
	}
}

// The deviation grows with time between games as lichess's does: its 0.21436 rating periods a day, chosen so that a
// typical player's deviation goes from 60 to 110 in a year (lila's Glicko settings), and its FAQ's "around a year of
// inactivity for your rating to become provisional again"
func TestTimeBetweenGamesGrowsTheDeviationAsLichess(t *testing.T) {
	typical := store.Rating{Rating: 1800, Deviation: 60, Volatility: 0.06, LastPlayed: t0}
	near(t, "a year idle", Idle(typical, t0.AddDate(1, 0, 0)), 110, 1)
	if Idle(typical, t0.AddDate(0, 6, 0)) >= Provisional {
		t.Error("provisional again after half a year")
	}
	near(t, "the same day", Idle(typical, t0), 60, 1e-9)
	near(t, "a first game's periods", Periods(time.Time{}, t0), 0, 0)
	near(t, "ten days' periods", Periods(t0, t0.AddDate(0, 0, 10)), 2.1436, 1e-9)
	// (a game after a long absence moves the rating further than one the next day: its deviation grown first)
	opp := []Opponent{{Rating: 1800, Deviation: 60, Score: 1}}
	soon := Update(typical, opp, Tau, Periods(t0, t0.Add(time.Hour)))
	late := Update(typical, opp, Tau, Periods(t0, t0.AddDate(1, 0, 0)))
	if late.Rating-typical.Rating <= soon.Rating-typical.Rating {
		t.Errorf("after a year %.1f, the next hour %.1f: the year should count", late.Rating-typical.Rating, soon.Rating-typical.Rating)
	}
}

// A game's change at most 700, the rating within 400-4000, the volatility at most 0.1 (lichess's bounds)
func TestBounds(t *testing.T) {
	low := Update(store.Rating{Rating: 410, Deviation: 500, Volatility: 0.09}, []Opponent{{Rating: 3000, Deviation: 45, Score: 0}}, Tau, 0)
	if low.Rating < MinRating {
		t.Errorf("below the floor: %v", low.Rating)
	}
	big := Update(store.Rating{Rating: 1500, Deviation: 500, Volatility: 0.09}, []Opponent{{Rating: 3900, Deviation: 45, Score: 1}}, Tau, 0)
	if big.Rating-1500 > MaxChange+1e-9 {
		t.Errorf("a change of %v", big.Rating-1500)
	}
	if big.Volatility > MaxVolatility {
		t.Errorf("volatility %v", big.Volatility)
	}
}
