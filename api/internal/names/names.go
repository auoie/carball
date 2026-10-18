// Package names checks the display names accounts choose (notes/accounts.md §5, AC-14): they cross to every other
// player, so the game server's rules for a name (server/src/game.rs `player_name`: hidden characters, runs of spaces,
// piled accents) apply, after NFKC, with a length cap that refuses rather than cuts.
package names

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// MaxBytes is the game's limit (server/src/protocol.rs MAX_NAME_BYTES)
const MaxBytes = 32

var (
	ErrEmpty   = errors.New("the name is empty")
	ErrTooLong = fmt.Errorf("the name is longer than %d bytes", MaxBytes)
)

// Clean returns the name as other players will see it, or why it can't be one
func Clean(asked string) (string, error) {
	name := tidy(asked)
	if name == "" {
		return "", ErrEmpty
	}
	if len(name) > MaxBytes {
		return "", ErrTooLong
	}
	return name, nil
}

// Suggest is a sign-up's suggested name: the provider's (a Steam persona: untrusted, tidied and cut to the limit at a
// character's boundary), else a guest-style one ("Player 4821"), never anything naming the person
func Suggest(provided string) string {
	name := tidy(provided)
	for len(name) > MaxBytes {
		_, size := utf8.DecodeLastRuneInString(name)
		name = strings.TrimRightFunc(name[:len(name)-size], unicode.IsSpace)
	}
	if name != "" {
		return name
	}
	n, err := rand.Int(rand.Reader, big.NewInt(9000))
	if err != nil {
		panic(err) // (crypto/rand doesn't fail on a supported system)
	}
	return fmt.Sprintf("Player %d", 1000+n.Int64())
}

// tidy: decomposed (NFKD: a precomposed letter's accent counts as a mark); hidden characters dropped; every run of
// spaces one space; two combining marks on a character at most, none on a space or the name's start; trimmed; composed
// again (NFKC as a whole)
func tidy(asked string) string {
	var b strings.Builder
	marks := 0
	space := false
	for _, c := range norm.NFKD.String(asked) {
		switch {
		case hidden(c):
		case unicode.IsSpace(c):
			if b.Len() > 0 && !space {
				b.WriteByte(' ')
				space = true
			}
			marks = 0
		case combining(c):
			if marks < 2 && b.Len() > 0 && !space {
				b.WriteRune(c)
				marks++
			}
		default:
			b.WriteRune(c)
			marks = 0
			space = false
		}
	}
	return norm.NFC.String(strings.TrimRight(b.String(), " "))
}

// hidden: the characters a name may not have (game.rs `hidden_char`, RV-249): controls, format characters (bidi
// controls, zero-width ones, the BOM), the line and paragraph separators, the invisible fillers a name could be made of
// alone, the replacement character
func hidden(c rune) bool {
	if unicode.IsControl(c) || unicode.Is(unicode.Cf, c) {
		return true
	}
	for _, r := range hiddenRanges {
		if r[0] <= c && c <= r[1] {
			return true
		}
	}
	return false
}

var hiddenRanges = [][2]rune{
	// (Unicode 15.1's Cf, as the server's list: Go's tables may be older)
	{0x00AD, 0x00AD}, {0x0600, 0x0605}, {0x061C, 0x061C}, {0x06DD, 0x06DD}, {0x070F, 0x070F}, {0x0890, 0x0891},
	{0x08E2, 0x08E2}, {0x180E, 0x180E}, {0x200B, 0x200F}, {0x202A, 0x202E}, {0x2060, 0x2064}, {0x2066, 0x206F},
	{0xFEFF, 0xFEFF}, {0xFFF9, 0xFFFB}, {0x110BD, 0x110BD}, {0x110CD, 0x110CD}, {0x13430, 0x1343F}, {0x1BCA0, 0x1BCA3},
	{0x1D173, 0x1D17A}, {0xE0001, 0xE0001}, {0xE0020, 0xE007F},
	// (the invisible marks and fillers)
	{0x034F, 0x034F}, {0x115F, 0x1160}, {0x17B4, 0x17B5}, {0x180B, 0x180D}, {0x180F, 0x180F}, {0x2028, 0x2029},
	{0x2065, 0x2065}, {0x2800, 0x2800}, {0x3164, 0x3164}, {0xFE00, 0xFE0F}, {0xFFA0, 0xFFA0}, {0xFFFC, 0xFFFD},
	{0xE0000, 0xE0FFF},
}

// combining: a mark of the blocks that stack (accents piled on a letter: game.rs `combining_mark`)
func combining(c rune) bool {
	for _, r := range combiningRanges {
		if r[0] <= c && c <= r[1] {
			return true
		}
	}
	return false
}

var combiningRanges = [][2]rune{
	{0x0300, 0x036F}, {0x0483, 0x0489}, {0x0591, 0x05BD}, {0x0610, 0x061A}, {0x064B, 0x065F}, {0x0E31, 0x0E31},
	{0x0E34, 0x0E3A}, {0x0E47, 0x0E4E}, {0x1AB0, 0x1AFF}, {0x1DC0, 0x1DFF}, {0x20D0, 0x20FF}, {0xFE20, 0xFE2F},
}
