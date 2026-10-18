// Package ticket makes the search tickets the game server takes in a search's Hello (notes/accounts.md §3, AC-6): who the
// player is (the account and its display name), for a couple of minutes, used once, signed with Ed25519 so the game
// server checks it offline with the public keys it's given (by key id: keys rotate). The format is small and binary, so
// the game server reads it without a JSON parser:
//
//	version (1) | kid length (1) | kid | account id (16) | issued (8, Unix s) | expires (8) | nonce (16) | name length (1) | name
//
// then the signature (64) over "carball-search\x00" and those bytes (the audience: a ticket signs nothing else), all as
// unpadded base64url.
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
)

// Version is the format's
const Version = 1

// Context is what a ticket's signature covers before its bytes (the audience)
const Context = "carball-search\x00"

// Lifetime is a ticket's (AC-6: about 2 minutes)
const Lifetime = 2 * time.Minute

// MaxBytes is a ticket's longest encoded length (the game server caps its Hello's ticket at it)
const MaxBytes = 256

// Ticket is what a ticket says
type Ticket struct {
	KeyID   string
	Account [16]byte
	Issued  time.Time
	Expires time.Time
	Nonce   [16]byte
	Name    string
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

// Issue signs a ticket for the account and name at now (a fresh nonce, Lifetime long)
func (s *Signer) Issue(account [16]byte, name string, now time.Time) (string, Ticket, error) {
	t := Ticket{KeyID: s.KeyID, Account: account, Issued: now.Truncate(time.Second), Name: name}
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
	b := []byte{Version, byte(len(t.KeyID))} //nolint:gosec // (G115: checked above, 32 at most)
	b = append(b, t.KeyID...)
	b = append(b, t.Account[:]...)
	b = binary.BigEndian.AppendUint64(b, uint64(t.Issued.Unix()))  //nolint:gosec // (G115: a time after 1970)
	b = binary.BigEndian.AppendUint64(b, uint64(t.Expires.Unix())) //nolint:gosec // (G115: a time after 1970)
	b = append(b, t.Nonce[:]...)
	b = append(b, byte(len(t.Name))) //nolint:gosec // (G115: checked above, 32 at most)
	b = append(b, t.Name...)
	return b, nil
}

// Verify reads and checks a ticket against public keys by id, at now with `skew` either way (the tests'; the game
// server's own, in Rust, mirrors it)
func Verify(encoded string, keys map[string]ed25519.PublicKey, now time.Time, skew time.Duration) (Ticket, error) {
	if len(encoded) > MaxBytes {
		return Ticket{}, errors.New("ticket: too long")
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(raw) < ed25519.SignatureSize+2 {
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
	if now.Add(skew).Before(t.Issued) || !now.Add(-skew).Before(t.Expires) {
		return Ticket{}, errors.New("ticket: not in its time")
	}
	return t, nil
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
	t.KeyID, b = string(b[:n]), b[n:]
	copy(t.Account[:], b[:16])
	b = b[16:]
	t.Issued = time.Unix(int64(binary.BigEndian.Uint64(b[:8])), 0)    //nolint:gosec // (G115: checked against now after)
	t.Expires = time.Unix(int64(binary.BigEndian.Uint64(b[8:16])), 0) //nolint:gosec // (G115: as above)
	copy(t.Nonce[:], b[16:32])
	b = b[32:]
	m := int(b[0])
	if m == 0 || m > 32 || len(b) != 1+m {
		return t, bad
	}
	t.Name = string(b[1:])
	return t, nil
}
