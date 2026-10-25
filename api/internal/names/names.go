// Package names checks the display names accounts choose (notes/accounts.md §5, AC-14): they cross to every other
// player. Twitch's rules (the user's, 2026-10-25): 4 to 25 characters, letters (both cases), digits and underscores
// alone; not unique; and a word filter (filter.go). A name in use from before these rules stays as it was: they're for
// a new sign-up's name and a rename. The game server takes any name a ticket carries (server/src/game.rs
// `verified_name`, a superset), so these pass through as they are.
package names

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// The length a name may have (characters; ASCII, so bytes too)
const (
	MinLength = 4
	MaxLength = 25
	// MaxBytes is the sign-up's field limit (GET /api/signup's nameMaxBytes): MaxLength, every character one byte
	MaxBytes = MaxLength
)

// Why a name can't be one
var (
	ErrTooShort   = fmt.Errorf("the name is shorter than %d characters", MinLength)
	ErrTooLong    = fmt.Errorf("the name is longer than %d characters", MaxLength)
	ErrInvalid    = errors.New("the name holds a character other than letters, digits and underscores")
	ErrNotAllowed = errors.New("the name isn't allowed") // (the word filter's: filter.go)
)

// characters is a name's alphabet: letters, digits, underscores
var characters = regexp.MustCompile(`^[A-Za-z0-9_]*$`)

// Clean returns the name as other players will see it (the asked one, its surrounding spaces off), or why it can't be
// one: another character first (ErrInvalid), then its length, then the word filter
func Clean(asked string) (string, error) {
	name := strings.TrimSpace(asked)
	switch {
	case !characters.MatchString(name):
		return "", ErrInvalid
	case len(name) < MinLength:
		return "", ErrTooShort
	case len(name) > MaxLength:
		return "", ErrTooLong
	case !allowed(name):
		return "", ErrNotAllowed
	}
	return name, nil
}

// Suggest is a sign-up's suggested name: the provider's (a Steam persona: untrusted) if it's a name as it is, its
// surrounding spaces off and the others underscores, never transliterated; else a guest-style one ("Player_4821"),
// never anything naming the person
func Suggest(provided string) string {
	if name, err := Clean(strings.ReplaceAll(strings.TrimSpace(provided), " ", "_")); err == nil {
		return name
	}
	return guest()
}

// Neutral is an admin's rename's name: "Player_NNNN", random digits (another account may have it too: names aren't
// unique)
func Neutral() string {
	return guest()
}

// guest: "Player_" and four random digits
func guest() string {
	n, err := rand.Int(rand.Reader, big.NewInt(9000))
	if err != nil {
		panic(err) // (crypto/rand doesn't fail on a supported system)
	}
	return fmt.Sprintf("Player_%d", 1000+n.Int64())
}
