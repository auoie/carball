// Package ranked holds the ranked rules' pure parts (notes/matchmaking.md LV1, notes/accounts.md §3): the leavers' queue
// ban ladder, and (glicko.go) the ratings.
package ranked

import (
	"time"

	"carball/api/internal/store"
)

// Ladder is the queue ban's length at each step (the user's choice of LV1's suggestion, 2026-10-18: ours; the game's is
// PsyNet's): 5 minutes, 15, an hour, 6 hours, then 24 hours for every later leave
var Ladder = [...]time.Duration{5 * time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour, 24 * time.Hour}

// Forgive is how long without a leave takes one step off the ladder
const Forgive = 24 * time.Hour

// Leave is the ban a leave from `match` at now gives (the game server reports it at the leave, armed: LV1): one step up
// from where the account stands after the steps forgiven since its last leave, capped at the top. The same match again
// (a retried report) changes nothing: one ban per player per match
func Leave(cur store.QueueBan, exists bool, match string, now time.Time) (*store.QueueBan, bool) {
	if exists && cur.Match == match {
		return nil, false
	}
	step := 0
	next := store.QueueBan{Match: match, LastLeave: now}
	if exists {
		step = cur.Step
		if since := now.Sub(cur.LastLeave); since > 0 {
			step -= int(since / Forgive)
		}
		step = max(step, 0)
		until, leave := cur.Until, cur.LastLeave
		next.PreviousStep, next.PreviousUntil, next.PreviousLeave = cur.Step, &until, &leave
	}
	next.Step = min(step+1, len(Ladder))
	next.Until = now.Add(Ladder[next.Step-1])
	return &next, true
}

// Refilled undoes `match`'s ban: a rejoin filled the lobby again (the game's RPC_RemoveQuitter). The account back as it
// stood before that leave (none if it had no ban); a ban from another match stays
func Refilled(cur store.QueueBan, exists bool, match string) (*store.QueueBan, bool) {
	if !exists || cur.Match != match {
		return nil, false
	}
	if cur.PreviousLeave == nil || cur.PreviousUntil == nil || cur.PreviousStep == 0 {
		return nil, true
	}
	return &store.QueueBan{Step: cur.PreviousStep, Until: *cur.PreviousUntil, LastLeave: *cur.PreviousLeave, Match: ""}, true
}

// BannedUntil is when an account's ban ends, if one is in force at now
func BannedUntil(cur store.QueueBan, exists bool, now time.Time) (time.Time, bool) {
	return cur.Until, exists && cur.Until.After(now)
}
