package ranked

import (
	"math"
	"time"

	"carball/api/internal/store"
	"carball/api/internal/ticket"
)

// Glicko-2, implemented from Glickman's paper ("Example of the Glicko-2 system", 2012), with lichess's choices where they
// fit (notes/accounts.md §3 has which, and which not: the game's MMR is PsyNet's, unknowable): a new rating 1500,
// deviation 500 (also its ceiling) and volatility 0.09 (capped at 0.1), τ 0.75, the deviation's floor 45; each game its
// own rating period, the deviation first grown by the time since the account's last game (PeriodsPerDay rating periods
// a day: a typical deviation of 60 back to 110 after a year idle); a game's change at most MaxChange; the rating held
// within MinRating and MaxRating; shown with "?" from Provisional up.
const (
	DefaultRating     = 1500.0
	DefaultDeviation  = 500.0
	DefaultVolatility = 0.09
	MaxVolatility     = 0.1
	Tau               = 0.75
	MinDeviation      = 45.0
	MaxDeviation      = 500.0
	Provisional       = 110.0
	PeriodsPerDay     = 0.21436
	MaxChange         = 700.0
	MinRating         = 400.0
	MaxRating         = 4000.0

	scale   = 173.7178
	epsilon = 0.000001
)

// Default is an account's rating in a playlist before its first match there
var Default = store.Rating{Rating: DefaultRating, Deviation: DefaultDeviation, Volatility: DefaultVolatility}

// Opponent is one opponent's rating and the score against them (1 a win, 0 a loss, 0.5 a draw)
type Opponent struct {
	Rating, Deviation, Score float64
}

// Update is the rating after one rating period's games (Glickman's steps 2-8): tau the system's constant, periods how
// many rating periods the deviation grows by in step 6 (the paper's 1; ours, as lichess's, the time since the last
// game: Periods). The deviation held within its floor and ceiling, the volatility under its cap, the change under
// MaxChange and the rating within its bounds
func Update(r store.Rating, games []Opponent, tau, periods float64) store.Rating {
	mu := (r.Rating - DefaultRating) / scale
	phi := r.Deviation / scale
	sigma := r.Volatility
	if len(games) == 0 {
		out := r
		out.Deviation = clamp(scale*math.Sqrt(phi*phi+periods*sigma*sigma), MinDeviation, MaxDeviation)
		return out
	}
	// (steps 3, 4: the estimated variance v and improvement Δ)
	var vInv, sum float64
	for _, o := range games {
		muJ := (o.Rating - DefaultRating) / scale
		g := gOf(o.Deviation / scale)
		e := 1 / (1 + math.Exp(-g*(mu-muJ)))
		vInv += g * g * e * (1 - e)
		sum += g * (o.Score - e)
	}
	v := 1 / vInv
	delta := v * sum
	// (step 5: the new volatility, the Illinois algorithm)
	a := math.Log(sigma * sigma)
	f := func(x float64) float64 {
		ex := math.Exp(x)
		d := phi*phi + v + ex
		return ex*(delta*delta-phi*phi-v-ex)/(2*d*d) - (x-a)/(tau*tau)
	}
	A := a
	var B float64
	if delta*delta > phi*phi+v {
		B = math.Log(delta*delta - phi*phi - v)
	} else {
		k := 1.0
		for f(a-k*tau) < 0 {
			k++
		}
		B = a - k*tau
	}
	fA, fB := f(A), f(B)
	for i := 0; math.Abs(B-A) > epsilon && i < 100; i++ {
		C := A + (A-B)*fA/(fB-fA)
		fC := f(C)
		if fC*fB <= 0 {
			A, fA = B, fB
		} else {
			fA /= 2
		}
		B, fB = C, fC
	}
	sigma2 := math.Exp(A / 2)
	// (steps 6-8: the new deviation and rating)
	phiStar := math.Sqrt(phi*phi + periods*sigma2*sigma2)
	phi2 := 1 / math.Sqrt(1/(phiStar*phiStar)+1/v)
	mu2 := mu + phi2*phi2*sum
	out := r
	change := clamp(scale*(mu2-mu), -MaxChange, MaxChange)
	out.Rating = clamp(r.Rating+change, MinRating, MaxRating)
	out.Deviation = clamp(scale*phi2, MinDeviation, MaxDeviation)
	out.Volatility = math.Min(sigma2, MaxVolatility)
	return out
}

// Periods is the rating periods between an account's last game and now (PeriodsPerDay a day): none before its first
func Periods(last, now time.Time) float64 {
	if last.IsZero() || !now.After(last) {
		return 0
	}
	return now.Sub(last).Hours() / 24 * PeriodsPerDay
}

// Idle is a rating's deviation as it stands at now, grown by the time since its last game (the page's "?" after a
// long absence, as lichess's)
func Idle(r store.Rating, now time.Time) float64 {
	phi := r.Deviation / scale
	return clamp(scale*math.Sqrt(phi*phi+Periods(r.LastPlayed, now)*r.Volatility*r.Volatility), MinDeviation, MaxDeviation)
}

func gOf(phi float64) float64 { return 1 / math.Sqrt(1+3*phi*phi/(math.Pi*math.Pi)) }

func clamp(x, lo, hi float64) float64 { return math.Min(hi, math.Max(lo, x)) }

// Composite is a team as one opponent: its players' mean rating, their deviations combined as the root mean square
func Composite(team []store.Rating) (rating, deviation float64) {
	if len(team) == 0 {
		return DefaultRating, DefaultDeviation
	}
	var r, d2 float64
	for _, p := range team {
		r += p.Rating
		d2 += p.Deviation * p.Deviation
	}
	n := float64(len(team))
	return r / n, math.Sqrt(d2 / n)
}

// Rate is a result's new ratings (store.RecordResult's): each player still with an account rated against the other team
// as one composite opponent (notes/accounts.md §3), with their team's result (a quitter's too, no dampening: LV1, ours);
// a player without a rating there yet starts from Default, and a deleted account counts as Default in its team
func Rate(r store.Result, current map[string]*store.Rating, now time.Time) map[string]store.Rating {
	before := func(account string) store.Rating {
		if c := current[account]; c != nil {
			return *c
		}
		return Default
	}
	teams := [2][]store.Rating{}
	for _, p := range r.Players {
		teams[p.Team] = append(teams[p.Team], before(p.Account))
	}
	out := map[string]store.Rating{}
	for _, p := range r.Players {
		if _, exists := current[p.Account]; !exists {
			continue // (a deleted account's placeholder: not rated)
		}
		rating, deviation := Composite(teams[1-p.Team])
		score := 0.0
		if p.Team == r.WinningTeam {
			score = 1
		}
		own := before(p.Account)
		next := Update(own, []Opponent{{Rating: rating, Deviation: deviation, Score: score}}, Tau, Periods(own.LastPlayed, now))
		next.Games = own.Games + 1
		next.LastPlayed = now
		out[p.Account] = next
	}
	return out
}

// Shown is a rating as tickets and the page carry it: rounded, held within a u16
func Shown(r store.Rating) ticket.Shown {
	round := func(x float64) uint16 { return uint16(clamp(math.Round(x), 0, math.MaxUint16)) }
	return ticket.Shown{Rating: round(r.Rating), Deviation: round(r.Deviation)}
}

// TicketRatings are an account's three playlists' ratings for its ticket at now (Default where it hasn't played), each
// deviation grown by the time since its last game there
func TicketRatings(ratings map[int]store.Rating, now time.Time) [3]ticket.Shown {
	var out [3]ticket.Shown
	for i := range out {
		r, ok := ratings[i+1]
		if !ok {
			r = Default
		}
		r.Deviation = Idle(r, now)
		out[i] = Shown(r)
	}
	return out
}
