package ranked

import (
	"testing"
	"time"

	"carball/api/internal/store"
)

var t0 = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

func TestLadderClimbsAndCaps(t *testing.T) {
	cur, exists := store.QueueBan{}, false
	at := t0
	for i, want := range []time.Duration{5 * time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour, 24 * time.Hour, 24 * time.Hour} {
		next, write := Leave(cur, exists, "m"+string(rune('a'+i)), at)
		if !write || next.Until.Sub(at) != want {
			t.Fatalf("leave %d: %v for %v, want %v", i+1, write, next.Until.Sub(at), want)
		}
		cur, exists = *next, true
		at = at.Add(time.Hour)
	}
	if cur.Step != 5 {
		t.Errorf("the top step %d, want 5", cur.Step)
	}
}

func TestLadderForgivesAStepADay(t *testing.T) {
	cur := store.QueueBan{Step: 3, Until: t0.Add(time.Hour), LastLeave: t0, Match: "a"}
	// (two full days without a leave: two steps off, then one up: step 2, 15 minutes)
	next, _ := Leave(cur, true, "b", t0.Add(49*time.Hour))
	if next.Step != 2 || next.Until.Sub(t0.Add(49*time.Hour)) != 15*time.Minute {
		t.Errorf("after two days: step %d for %v", next.Step, next.Until.Sub(t0.Add(49*time.Hour)))
	}
	// (a week: back to the bottom, 5 minutes)
	next, _ = Leave(cur, true, "b", t0.Add(7*24*time.Hour))
	if next.Step != 1 {
		t.Errorf("after a week: step %d", next.Step)
	}
	// (23 hours: nothing forgiven)
	next, _ = Leave(cur, true, "b", t0.Add(23*time.Hour))
	if next.Step != 4 {
		t.Errorf("after 23 hours: step %d", next.Step)
	}
	// (the day counted from the last leave, not the ban's end an hour later: 24.5 hours, one step off)
	next, _ = Leave(cur, true, "b", t0.Add(24*time.Hour+30*time.Minute))
	if next.Step != 3 {
		t.Errorf("24.5 hours after the leave: step %d, want 3", next.Step)
	}
}

func TestOneBanAMatchAndARejoinUndoesIt(t *testing.T) {
	first, _ := Leave(store.QueueBan{}, false, "a", t0)
	if _, write := Leave(*first, true, "a", t0.Add(time.Minute)); write {
		t.Error("the same match's leave again (a retried report) changed the ban")
	}
	second, _ := Leave(*first, true, "b", t0.Add(time.Hour))
	if second.Step != 2 {
		t.Fatalf("the second leave: step %d", second.Step)
	}
	// (b's rejoin refilled the lobby: back to a's ban as it stood)
	back, write := Refilled(*second, true, "b")
	if !write || back == nil || back.Step != 1 || !back.Until.Equal(first.Until) || !back.LastLeave.Equal(t0) {
		t.Errorf("undone: %v %+v", write, back)
	}
	// (another match's rejoin: a's ban stays; the first ban undone: none)
	if _, write := Refilled(*second, true, "c"); write {
		t.Error("another match's rejoin changed the ban")
	}
	if none, write := Refilled(*first, true, "a"); !write || none != nil {
		t.Errorf("the only ban undone: %v %+v", write, none)
	}
	if until, banned := BannedUntil(*first, true, t0.Add(4*time.Minute)); !banned || !until.Equal(t0.Add(5*time.Minute)) {
		t.Error("in force within its 5 minutes")
	}
	if _, banned := BannedUntil(*first, true, t0.Add(5*time.Minute)); banned {
		t.Error("in force at its end")
	}
}
