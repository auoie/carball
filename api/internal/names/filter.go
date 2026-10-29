package names

import (
	"slices"
	"strings"

	goaway "github.com/TwiN/go-away"
)

// The word filter on a new name (sign-up, rename; existing names unaffected): github.com/TwiN/go-away (MIT), its
// dictionary of profanities and its false positives, ours added. It matches within the name, not whole words: a gamer
// tag runs words together ("xXFuckXx", "ShitLord") or splits them with underscores ("f_u_c_k"), which a whole-word
// match would let through; the cost, a harmless word that holds a bad one (Scunthorpe, Cocktail), is kept low by the
// false positives (a word on that list is taken out before the match), and is small for a name: the player picks
// another, never a name already in use rejected. Leetspeak counted (1 as i, 3 as e), but a number isn't a word: a run of
// three digits or more is taken out first ("Player_4553" isn't "asse"); a digit or two inside a word still counts
// ("B1tch", "a55hole"). A name is ASCII (names.go), go-away's alphabet

// falsePositives are ours, on top of go-away's (each a word with a bad one inside it, its common use harmless)
var falsePositives = []string{"cockpit", "cockatoo", "cockney", "hancock", "hitchcock", "dickens", "dickinson", "matsushita",
	"pussycat", "pussywillow", "cumulus", "snigger"}

var filter = goaway.NewProfanityDetector().WithCustomDictionary(goaway.DefaultProfanities,
	append(slices.Clone(goaway.DefaultFalsePositives), falsePositives...), goaway.DefaultFalseNegatives)

// allowed is whether a name passes the word filter
func allowed(name string) bool {
	return !filter.IsProfane(filterForm(name))
}

// Allowed is whether a text passes the word filter as a name does (a shared training pack's name and description:
// internal/packs; spaces and punctuation its separators as underscores are)
func Allowed(text string) bool {
	return allowed(text)
}

// filterForm is the name as the filter reads it: underscores separators (spaces), every run of three digits or more (a
// number, not leetspeak) taken out
func filterForm(name string) string {
	var out strings.Builder
	for i := 0; i < len(name); {
		j := i
		for j < len(name) && name[j] >= '0' && name[j] <= '9' {
			j++
		}
		switch {
		case j-i >= 3:
			out.WriteByte(' ')
			i = j
		case j > i:
			out.WriteString(name[i:j])
			i = j
		case name[i] == '_':
			out.WriteByte(' ')
			i++
		default:
			out.WriteByte(name[i])
			i++
		}
	}
	return out.String()
}
