// Package matchmaker is the one queue for every game server (notes/matchmaking.md, the central matchmaker): who plays
// together and where, and what each account may do meanwhile (one search, one match, a no-show's cooldown). All in
// memory: a restart loses the searches (their pages search again) and the matches' accounts (free again).
//
// This file is the pairing: the oldest searcher with the next-oldest within its rating window (RatingWindow) who share
// a region they all accept (ticked, and answered the page's last ping), at the one of those with the lowest worst ping;
// the teams by a snake draft on rating (SnakeSeats).
package matchmaker

import (
	"math"
	"slices"
	"sort"
	"time"
)

// RatingWindow is the ratings the oldest searcher, waiting `waited`, is matched within (±): 100, wider by 50 every 10 s
func RatingWindow(waited time.Duration) float64 {
	return 100 + 50*math.Floor(max(waited.Seconds(), 0)/10)
}

// SnakeSeats is a match's seats in seat order (teams alternating: blue, orange, ...) for these searchers, by a snake
// draft on their ratings (the best to blue, the next two to orange, the next two to blue, ...): their indices
func SnakeSeats(ratings []uint16) []int {
	order := make([]int, len(ratings))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return ratings[order[a]] > ratings[order[b]] })
	var blue, orange []int
	for pick, i := range order {
		// (picks 0, 3, 4, 7, 8, ... blue; 1, 2, 5, 6, ... orange)
		if (pick+1)%4 < 2 {
			blue = append(blue, i)
		} else {
			orange = append(orange, i)
		}
	}
	seats := make([]int, 0, len(ratings))
	for k := range min(len(blue), len(orange)) {
		seats = append(seats, blue[k], orange[k])
	}
	return seats
}

// candidate is a searcher as the pairing sees it: its rating in the playlist, the servers it accepts (their pings, ms)
// and when it began waiting
type candidate struct {
	rating uint16
	pings  map[string]int
	since  time.Time
}

// group is a match the pairing found: its members (indices into the queue, oldest first) and its server
type group struct {
	members []int
	server  string
}

// pair finds the matches a playlist's queue (oldest first) fills: the oldest not yet matched, and for each server it
// accepts the next-oldest within its rating window who accept that server too; of the servers that fill a match, the
// lowest worst ping (then total; ties to the first by name). One that can't fill waits, and the next-oldest is tried
func pair(queue []candidate, players int, now time.Time) []group {
	taken := make([]bool, len(queue))
	var found []group
	for anchor := range queue {
		if taken[anchor] {
			continue
		}
		a := queue[anchor]
		window := RatingWindow(now.Sub(a.since))
		servers := make([]string, 0, len(a.pings))
		for s := range a.pings {
			servers = append(servers, s)
		}
		slices.Sort(servers)
		var best *group
		bestWorst, bestTotal := 0, 0
		for _, server := range servers {
			members := []int{anchor}
			for i := anchor + 1; i < len(queue) && len(members) < players; i++ {
				_, accepts := queue[i].pings[server]
				if !taken[i] && accepts && math.Abs(float64(queue[i].rating)-float64(a.rating)) <= window {
					members = append(members, i)
				}
			}
			if len(members) < players {
				continue
			}
			worst, total := 0, 0
			for _, i := range members {
				worst = max(worst, queue[i].pings[server])
				total += queue[i].pings[server]
			}
			if best == nil || worst < bestWorst || (worst == bestWorst && total < bestTotal) {
				best, bestWorst, bestTotal = &group{members: members, server: server}, worst, total
			}
		}
		if best == nil {
			continue
		}
		for _, i := range best.members {
			taken[i] = true
		}
		found = append(found, *best)
	}
	return found
}
