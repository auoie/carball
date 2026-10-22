// Package ticket makes the search tickets the game server takes in a search's Hello (notes/accounts.md §3, AC-6): who the
// player is (the account and its display name), for a couple of minutes, used once, signed with Ed25519 so the game
// server checks it offline with the public keys it's given (by key id: keys rotate). The format is small and binary, so
// the game server reads it without a JSON parser:
//
//	version (1) = 3 | kid length (1) | kid | account id (16) | issued (8, Unix s) | expires (8) | nonce (16) |
//	name length (1) | name | the ratings, 1v1, 2v2, 3v3: rating (2) and deviation (2) each, rounded |
//	purpose (1): 0 a search (and its claim), 1 a rejoin | match (8): a rejoin's match id, 0 for a search
//
// then the signature (64) over "carball-search\x00" and those bytes (the audience: a ticket signs nothing else), all as
// unpadded base64url. Integers big-endian. The ratings are the account's at the ticket's issue (the queue pairs by them:
// notes/matchmaking.md, ranked pairing), the defaults where it hasn't played. A rejoin's ticket is for that match alone
// (the game server takes it for a rejoin of it, nothing else): a leaver's queue ban doesn't stop it, so the banned
// leaver can still come back and refill the lobby (LV1, AP3).
package ticket

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Version is the format's (2: the ratings; 3: the purpose and match)
const Version = 3

// A ticket's purposes
const (
	// PurposeSearch is a search's ticket, and its claim's
	PurposeSearch = 0
	// PurposeRejoin is a rejoin's, for its match alone
	PurposeRejoin = 1
)

// Context is what a ticket's signature covers before its bytes (the audience)
const Context = "carball-search\x00"

// Lifetime is a ticket's (AC-6: about 2 minutes)
const Lifetime = 2 * time.Minute

// MaxBytes is a ticket's longest encoded length (the game server caps its Hello's ticket at it; the longest ticket, a
// 32-byte key id and name, is 267)
const MaxBytes = 320

// Ticket is what a ticket says
type Ticket struct {
	KeyID   string
	Account [16]byte
	Issued  time.Time
	Expires time.Time
	Nonce   [16]byte
	Name    string
	// Ratings in the playlists 1v1, 2v2, 3v3 (index 0, 1, 2)
	Ratings [3]Shown
	// Purpose is PurposeSearch or PurposeRejoin; Match a rejoin's match id (0 for a search)
	Purpose byte
	Match   uint64
}

// Shown is a rating as a ticket carries it, rounded
type Shown struct {
	Rating, Deviation uint16
}

// Signer signs tickets with one key
type Signer struct {
	KeyID string
	key   ed25519.PrivateKey
}

// NewSigner takes a key's seed as written in its file (32 bytes, base64: `carball-api ticket-key` makes one)
func NewSigner(keyID, seed string) (*Signer, error) {
	if keyID == "" || len(keyID) > 32 || strings.ContainsAny(keyID, " \t\r\n") {
		return nil, errors.New("a ticket key's id is 1-32 characters, no spaces")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(seed))
	if err != nil || len(raw) != ed25519.SeedSize {
		return nil, errors.New("a ticket key's seed is 32 bytes, base64")
	}
	return &Signer{KeyID: keyID, key: ed25519.NewKeyFromSeed(raw)}, nil
}

// Public is the signer's public key as the game server's TICKET_PUBLIC_KEYS lists it: "KID BASE64"
func (s *Signer) Public() string {
	pub, _ := s.key.Public().(ed25519.PublicKey)
	return s.KeyID + " " + base64.StdEncoding.EncodeToString(pub)
}

// NewKey makes a key: its seed for the signer's file, its public key for the game server's list
func NewKey(keyID string) (seed, public string, err error) {
	raw := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	s, err := NewSigner(keyID, base64.StdEncoding.EncodeToString(raw))
	if err != nil {
		return "", "", err
	}
	return base64.StdEncoding.EncodeToString(raw), s.Public(), nil
}

// Issue signs a search's ticket for the account, its name and ratings at now (a fresh nonce, Lifetime long)
func (s *Signer) Issue(account [16]byte, name string, ratings [3]Shown, now time.Time) (string, Ticket, error) {
	return s.IssueFor(account, name, ratings, PurposeSearch, 0, now)
}

// IssueFor signs a ticket for a purpose: a search's (match 0), or a rejoin's of match
func (s *Signer) IssueFor(account [16]byte, name string, ratings [3]Shown, purpose byte, match uint64, now time.Time) (string, Ticket, error) {
	t := Ticket{KeyID: s.KeyID, Account: account, Issued: now.Truncate(time.Second), Name: name, Ratings: ratings, Purpose: purpose, Match: match}
	t.Expires = t.Issued.Add(Lifetime)
	if _, err := rand.Read(t.Nonce[:]); err != nil {
		return "", Ticket{}, err
	}
	body, err := Encode(t)
	if err != nil {
		return "", Ticket{}, err
	}
	signed := append([]byte(Context), body...)
	out := append(body, ed25519.Sign(s.key, signed)...)
	return base64.RawURLEncoding.EncodeToString(out), t, nil
}

// Encode is a ticket's bytes, unsigned
func Encode(t Ticket) ([]byte, error) {
	if len(t.KeyID) == 0 || len(t.KeyID) > 32 || len(t.Name) == 0 || len(t.Name) > 32 {
		return nil, errors.New("a ticket's key id and name are 1-32 bytes")
	}
	if (t.Purpose != PurposeSearch || t.Match != 0) && (t.Purpose != PurposeRejoin || t.Match == 0) {
		return nil, errors.New("a ticket is a search's (no match) or a rejoin's (its match)")
	}
	b := []byte{Version, byte(len(t.KeyID))} //nolint:gosec // (G115: checked above, 32 at most)
	b = append(b, t.KeyID...)
	b = append(b, t.Account[:]...)
	b = binary.BigEndian.AppendUint64(b, uint64(t.Issued.Unix()))  //nolint:gosec // (G115: a time after 1970)
	b = binary.BigEndian.AppendUint64(b, uint64(t.Expires.Unix())) //nolint:gosec // (G115: a time after 1970)
	b = append(b, t.Nonce[:]...)
	b = append(b, byte(len(t.Name))) //nolint:gosec // (G115: checked above, 32 at most)
	b = append(b, t.Name...)
	for _, r := range t.Ratings {
		b = binary.BigEndian.AppendUint16(b, r.Rating)
		b = binary.BigEndian.AppendUint16(b, r.Deviation)
	}
	b = append(b, t.Purpose)
	return binary.BigEndian.AppendUint64(b, t.Match), nil
}

// Verify reads and checks a ticket against public keys by id, at now with `skew` either way (the tests'; the game
// server's own, in Rust, mirrors it)
func Verify(encoded string, keys map[string]ed25519.PublicKey, now time.Time, skew time.Duration) (Ticket, error) {
	t, err := VerifySigned(encoded, keys)
	if err != nil {
		return Ticket{}, err
	}
	// (a life of Lifetime at most, begun before it ends: as the game server's check, AP2-3)
	if t.Expires.Before(t.Issued) || t.Expires.Sub(t.Issued) > Lifetime+skew {
		return Ticket{}, errors.New("ticket: not a ticket's life")
	}
	if now.Add(skew).Before(t.Issued) || !now.Add(-skew).Before(t.Expires) {
		return Ticket{}, errors.New("ticket: not in its time")
	}
	return t, nil
}

// VerifySigned reads a ticket and checks its signature alone, not its time: a result's or a quitter's (the game server
// hands on the player's ticket from the match's start; its issue time checked against the acceptance window instead)
func VerifySigned(encoded string, keys map[string]ed25519.PublicKey) (Ticket, error) {
	if len(encoded) > MaxBytes {
		return Ticket{}, errors.New("ticket: too long")
	}
	// (strict: no padding, no stray bits or line breaks: one encoding per ticket, as the game server reads it, AP2-11)
	raw, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) < ed25519.SignatureSize+2 || strings.ContainsAny(encoded, "\r\n") {
		return Ticket{}, errors.New("ticket: malformed")
	}
	body, sig := raw[:len(raw)-ed25519.SignatureSize], raw[len(raw)-ed25519.SignatureSize:]
	t, err := decode(body)
	if err != nil {
		return Ticket{}, err
	}
	key, ok := keys[t.KeyID]
	if !ok {
		return Ticket{}, fmt.Errorf("ticket: no key %q", t.KeyID)
	}
	if !ed25519.Verify(key, append([]byte(Context), body...), sig) {
		return Ticket{}, errors.New("ticket: bad signature")
	}
	return t, nil
}

// PublicKey is the signer's public key
func (s *Signer) PublicKey() ed25519.PublicKey {
	pub, _ := s.key.Public().(ed25519.PublicKey)
	return pub
}

// ParsePublic reads public key lines as the game server's TICKET_PUBLIC_KEYS lists them ("KID BASE64", comma- or
// newline-separated)
func ParsePublic(list string) (map[string]ed25519.PublicKey, error) {
	out := map[string]ed25519.PublicKey{}
	for _, item := range strings.FieldsFunc(list, func(r rune) bool { return r == ',' || r == '\n' }) {
		fields := strings.Fields(item)
		if len(fields) == 0 {
			continue
		}
		if len(fields) != 2 || len(fields[0]) > 32 {
			return nil, fmt.Errorf("ticket: a key line is \"KID BASE64\", got %q", item)
		}
		raw, err := base64.StdEncoding.DecodeString(fields[1])
		if err != nil || len(raw) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("ticket: key %q is not 32 bytes of base64", fields[0])
		}
		out[fields[0]] = ed25519.PublicKey(raw)
	}
	return out, nil
}

func decode(b []byte) (Ticket, error) {
	var t Ticket
	bad := errors.New("ticket: malformed")
	if len(b) < 2 || b[0] != Version {
		return t, bad
	}
	n := int(b[1])
	b = b[2:]
	if n == 0 || n > 32 || len(b) < n+16+8+8+16+1 {
		return t, bad
	}
	if !utf8.Valid(b[:n]) {
		return t, bad
	}
	t.KeyID, b = string(b[:n]), b[n:]
	copy(t.Account[:], b[:16])
	b = b[16:]
	t.Issued = time.Unix(int64(binary.BigEndian.Uint64(b[:8])), 0)    //nolint:gosec // (G115: checked against now after)
	t.Expires = time.Unix(int64(binary.BigEndian.Uint64(b[8:16])), 0) //nolint:gosec // (G115: as above)
	copy(t.Nonce[:], b[16:32])
	b = b[32:]
	m := int(b[0])
	if m == 0 || m > 32 || len(b) != 1+m+3*4+1+8 {
		return t, bad
	}
	if !utf8.Valid(b[1 : 1+m]) {
		return t, bad
	}
	t.Name = string(b[1 : 1+m])
	b = b[1+m:]
	for i := range t.Ratings {
		t.Ratings[i] = Shown{Rating: binary.BigEndian.Uint16(b[4*i:]), Deviation: binary.BigEndian.Uint16(b[4*i+2:])}
	}
	t.Purpose, t.Match = b[12], binary.BigEndian.Uint64(b[13:21])
	if (t.Purpose != PurposeSearch || t.Match != 0) && (t.Purpose != PurposeRejoin || t.Match == 0) {
		return t, bad
	}
	return t, nil
}
