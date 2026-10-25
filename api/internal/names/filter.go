package names

import (
	"slices"
	"strings"
	"unicode"

	goaway "github.com/TwiN/go-away"
	"golang.org/x/text/unicode/norm"
)

// The word filter on a new name (sign-up, rename; existing names unaffected): github.com/TwiN/go-away (MIT), its
// dictionary of profanities and its false positives, ours added. It matches within the name, not whole words: a gamer
// tag runs words together ("xXFuckXx", "ShitLord") and spaces or separators are taken out ("f u c k", "f.u.c.k"), which
// a whole-word match would let through; the cost, a harmless word that holds a bad one (Scunthorpe, Cocktail), is kept
// low by the false positives (a word on that list is taken out before the match), and is small for a name: the player
// picks another, never a message or a name already in use rejected. Leetspeak counted (1 as i, 3 as e, @ as a, $ as s),
// but a number isn't a word: a run of three digits or more is taken out first ("Player 4553" isn't "asse"); a digit or
// two inside a word still counts ("B1tch", "a55hole"). go-away reads ASCII alone: a name is folded to it first (its
// accents taken off, NFKD; any other character a separator), so a lookalike from another script isn't caught

// falsePositives are ours, on top of go-away's (each a word with a bad one inside it, its common use harmless)
var falsePositives = []string{"cockpit", "cockatoo", "cockney", "hancock", "hitchcock", "dickens", "dickinson", "matsushita",
	"pussycat", "pussywillow", "cumulus", "snigger"}

var filter = goaway.NewProfanityDetector().WithCustomDictionary(goaway.DefaultProfanities,
	append(slices.Clone(goaway.DefaultFalsePositives), falsePositives...), goaway.DefaultFalseNegatives)

// allowed is whether a tidied name passes the word filter
func allowed(name string) bool {
	return !filter.IsProfane(filterForm(name))
}

// filterForm is the name as the filter reads it: ASCII (accents off; any other character a space), and every run of
// three digits or more (a number, not leetspeak) taken out
func filterForm(name string) string {
	var ascii strings.Builder
	for _, c := range norm.NFKD.String(name) {
		switch {
		case unicode.Is(unicode.Mn, c):
		case c < unicode.MaxASCII && unicode.IsPrint(c):
			ascii.WriteRune(c)
		default:
			ascii.WriteByte(' ')
		}
	}
	s := ascii.String()
	var out strings.Builder
	for i := 0; i < len(s); {
		j := i
		for j < len(s) && s[j] >= '0' && s[j] <= '9' {
			j++
		}
		if j-i >= 3 {
			out.WriteByte(' ')
			i = j
			continue
		}
		if j > i {
			out.WriteString(s[i:j])
			i = j
			continue
		}
		out.WriteByte(s[i])
		i++
	}
	return out.String()
}
