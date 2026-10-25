package names

import (
	"errors"
	"regexp"
	"strings"
	"testing"
)

// Twitch's rules: 4 to 25 characters (3 and 26 refused), letters of both cases, digits and underscores alone (a space,
// a hyphen, an accent or another script refused, never transliterated), the surrounding spaces taken off; another
// character said before the length
func TestClean(t *testing.T) {
	for _, ok := range []string{"Zigg", strings.Repeat("a", 25), "Ziggy_Stardust", "xX_Sn1per_Xx", "UPPER_lower_09", "____",
		"  Padded_Name\t"} {
		if got, err := Clean(ok); err != nil || got != strings.TrimSpace(ok) {
			t.Errorf("Clean(%q) = %q, %v", ok, got, err)
		}
	}
	for asked, want := range map[string]error{
		"": ErrTooShort, "   ": ErrTooShort, "Zig": ErrTooShort, strings.Repeat("a", 26): ErrTooLong,
		"Ziggy Stardust": ErrInvalid, "Ziggy-Stardust": ErrInvalid, "Zoë_Name": ErrInvalid, "Иван_Name": ErrInvalid,
		"Ｚｉｇｇｙ": ErrInvalid, "Zig.gy": ErrInvalid, "Ziggy\u200B": ErrInvalid, "a b": ErrInvalid,
		strings.Repeat("a", 26) + " ": ErrTooLong,
	} {
		if got, err := Clean(asked); !errors.Is(err, want) {
			t.Errorf("Clean(%q) = %q, %v; want %v", asked, got, err, want)
		}
	}
}

// The word filter (filter.go): a name holding a profanity refused (ErrNotAllowed), its usual disguises too (case,
// leetspeak, underscores, run together); words that only hold one (Scunthorpe), numbers ("4553" isn't "asse") and our
// false positives let through
func TestCleanWordFilter(t *testing.T) {
	for _, bad := range []string{"fuck", "FuCk_You", "xXFuckXx", "FUCKYOU", "f_u_c_k", "sh1t_lord", "a55hole", "B1tch",
		"Wh0r3", "dickhead", "c_u_n_t", "Nazi_Boy"} {
		if got, err := Clean(bad); !errors.Is(err, ErrNotAllowed) {
			t.Errorf("Clean(%q) = %q, %v: want ErrNotAllowed", bad, got, err)
		}
	}
	for _, fine := range []string{"Scunthorpe", "Cassandra", "Assassin", "Classic_Bass", "Dickens", "Hancock", "Matsushita",
		"Cockpit_Ace", "Pussycat", "Cumulus", "Grasshopper", "Analyst", "Therapist", "Arsenal_Fan", "Sussex", "Penistone",
		"Player_4553", "Player4553", "Ace_5555", "Sniper2000", "xX_Sn1per_Xx", "Raccoon", "Shiitake", "Ziggy"} {
		if got, err := Clean(fine); err != nil || got != fine {
			t.Errorf("Clean(%q) = %q, %v: want it as given", fine, got, err)
		}
	}
	for in, want := range map[string]string{"f_u_c_k": "f u c k", "Player4553": "Player ", "B1tch": "B1tch", "A55": "A55"} {
		if got := filterForm(in); got != want {
			t.Errorf("filterForm(%q) = %q, want %q", in, got, want)
		}
	}
}

var guestName = regexp.MustCompile(`^Player_[1-9][0-9]{3}$`)

// A sign-up's suggestion: the provider's name when it is one as it is (its surrounding spaces off, the others
// underscores), never transliterated or cut; else Player_NNNN. An admin's rename's name is Player_NNNN too
func TestSuggestAndNeutral(t *testing.T) {
	for provided, want := range map[string]string{"Ziggy": "Ziggy", "  Ziggy Stardust ": "Ziggy_Stardust", "Mr  X_1": "Mr__X_1"} {
		if got := Suggest(provided); got != want {
			t.Errorf("Suggest(%q) = %q, want %q", provided, got, want)
		}
	}
	for _, provided := range []string{"", "Zig", "Zoë", "Иван Иванов", "Ziggy-Stardust", strings.Repeat("a", 26), "Shit Lord", "\u202EZiggy"} {
		if got := Suggest(provided); !guestName.MatchString(got) {
			t.Errorf("Suggest(%q) = %q, want a guest name", provided, got)
		}
	}
	for range 20 {
		got := Neutral()
		if !guestName.MatchString(got) {
			t.Fatalf("Neutral() = %q", got)
		}
		if _, err := Clean(got); err != nil {
			t.Fatalf("Neutral() %q isn't a name: %v", got, err)
		}
	}
}
