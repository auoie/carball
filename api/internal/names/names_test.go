package names

import (
	"errors"
	"regexp"
	"strings"
	"testing"
)

func TestClean(t *testing.T) {
	for _, c := range []struct {
		asked, want string
		err         error
	}{
		{"Andy Example", "Andy Example", nil},
		{"  spaced   out  ", "spaced out", nil},
		// (NFKC: full-width letters as ASCII, the ligature split)
		{"\uFF21\uFF22\uFF23 \uFB01x", "ABC fix", nil},
		// (bidi controls, zero-width characters, the BOM, a tab (a control, as the server's): gone)
		{"a\u202Eb\u200Bc\uFEFFd\te", "abcde", nil},
		// (accents piled: two a letter at most, a precomposed letter's own counted; none at the start; composed after)
		{"\u0301e\u0301\u0302\u0303\u0304x", "\u00E9\u0302x", nil},
		{"\u00E9\u0302\u0303\u0304x", "\u00E9\u0302x", nil},
		// (private-use and unassigned characters: gone, AP-19)
		{"a\uE000b\U0010FFFDc\U000E0FFFd", "abcd", nil},
		// (nothing but invisible fillers: empty)
		{"\u3164\u2800\u115F", "", ErrEmpty},
		{"", "", ErrEmpty},
		// (32 bytes: fine; 33: refused, not cut)
		{strings.Repeat("a", 32), strings.Repeat("a", 32), nil},
		{strings.Repeat("a", 33), "", ErrTooLong},
		{strings.Repeat("é", 17), "", ErrTooLong},
	} {
		got, err := Clean(c.asked)
		if got != c.want || !errors.Is(err, c.err) {
			t.Errorf("Clean(%q) = %q, %v; want %q, %v", c.asked, got, err, c.want, c.err)
		}
	}
}

func TestSuggest(t *testing.T) {
	// (a persona tidied and cut at a character's boundary to the limit)
	if got := Suggest("  Some\u202E Persona  "); got != "Some Persona" {
		t.Errorf("Suggest = %q", got)
	}
	long := Suggest(strings.Repeat("é", 20))
	if len(long) > MaxBytes || long != strings.Repeat("é", 16) {
		t.Errorf("Suggest(long) = %q (%d bytes)", long, len(long))
	}
	// (none, or nothing left of it: guest-style)
	guest := regexp.MustCompile(`^Player [1-9]\d{3}$`)
	for _, persona := range []string{"", "\u200B\u3164"} {
		if got := Suggest(persona); !guest.MatchString(got) {
			t.Errorf("Suggest(%q) = %q, want a guest-style name", persona, got)
		}
	}
	// (whatever is suggested passes the rules)
	for _, persona := range []string{"x", strings.Repeat("ab ", 20), ""} {
		if _, err := Clean(Suggest(persona)); err != nil {
			t.Errorf("Clean(Suggest(%q)): %v", persona, err)
		}
	}
}
