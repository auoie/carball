// Package ticket makes the tickets the game server takes in a Hello (notes/accounts.md §3, AC-6): who the player is (the
// account and its display name), for a short while, used once, signed with Ed25519 so the game server checks it offline
// with the public keys it's given (by key id: keys rotate). A ticket is a JWT (compact JWS, alg EdDSA, the key's id its
// `kid`), its claims:
//
//	iss "carball" | sub the account id (32 hex digits) | iat, exp (Unix s) | jti its one-time id (16 random bytes,
//	base64url) | name | ratings: 1v1, 2v2, 3v3, [rating, deviation] each, rounded | purpose "rejoin" or "seat" |
//	match (16 hex digits) | a seat's: aud its server (host:port), playlist (the team size), seat, roster (its seats)
//
// The ratings are the account's at the ticket's issue (the queue pairs by them: notes/matchmaking.md, ranked pairing),
// the defaults where it hasn't played. A rejoin's ticket is for that match alone (the game server takes it for a rejoin
// of it, nothing else): a leaver's queue ban doesn't stop it, so the banned leaver can still come back and refill the
// lobby (LV1, AP3). A match ticket (a seat) is the matchmaker's for one seat of one match at one game server,
// SeatLifetime long, taken once (RV-850). protocol/ticket_vector.json holds tickets this code makes, checked by the game
// server's tests (server/src/ticket.rs, the format's other half).
package ticket

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// A ticket's purposes
const (
	// PurposeRejoin is a rejoin's, for its match alone
	PurposeRejoin = 1
	// PurposeSeat is a match ticket's: one seat of its match, at its server
	PurposeSeat = 2
)

// Issuer is every ticket's `iss`
const Issuer = "carball"

// Lifetime is a rejoin ticket's (AC-6: about 2 minutes); SeatLifetime a match ticket's (claimed within seconds of its
// match)
const (
	Lifetime     = 2 * time.Minute
	SeatLifetime = 30 * time.Second
)

// MaxBytes is a ticket's longest encoded length (the game server caps its Hello's ticket at it: protocol 29; a match
// ticket with a 32-byte key id and name and a 64-byte server comes to about 650)
const MaxBytes = 1024

// MaxServer is a match ticket's server address's longest (bytes)
const MaxServer = 64

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
	// Purpose is PurposeRejoin or PurposeSeat; Match its match id
	Purpose byte
	Match   uint64
	// A seat's (PurposeSeat alone): its server's address, its playlist (the team size), its seat and its roster's size
	Server   string
	Playlist byte
	Seat     byte
	Roster   byte
}

// Shown is a rating as a ticket carries it, rounded
type Shown struct {
	Rating, Deviation uint16
}

// claims are a ticket's own claims, beside the registered ones
type claims struct {
	Name     string       `json:"name"`
	Ratings  [3][2]uint16 `json:"ratings"`
	Purpose  string       `json:"purpose"`
	Match    string       `json:"match"`
	Playlist *byte        `json:"playlist,omitempty"`
	Seat     *byte        `json:"seat,omitempty"`
	Roster   *byte        `json:"roster,omitempty"`
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
	return s.KeyID + " " + base64.StdEncoding.EncodeToString(s.PublicKey())
}

// PublicKey is the signer's public key
func (s *Signer) PublicKey() ed25519.PublicKey {
	pub, _ := s.key.Public().(ed25519.PublicKey)
	return pub
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

// IssueRejoin signs a rejoin's ticket for the account, its name and ratings at now, for match alone (Lifetime long)
func (s *Signer) IssueRejoin(account [16]byte, name string, ratings [3]Shown, match uint64, now time.Time) (string, Ticket, error) {
	t := Ticket{KeyID: s.KeyID, Account: account, Issued: now.Truncate(time.Second).UTC(), Name: name, Ratings: ratings, Purpose: PurposeRejoin, Match: match}
	return s.sign(t)
}

// Seat is a match ticket's seat: its match, server, playlist (team size), seat and roster size
type Seat struct {
	Match    uint64
	Server   string
	Playlist byte
	Seat     byte
	Roster   byte
}

// IssueSeat signs a match ticket for the account's seat (SeatLifetime long)
func (s *Signer) IssueSeat(account [16]byte, name string, ratings [3]Shown, seat Seat, now time.Time) (string, Ticket, error) {
	return s.sign(Ticket{
		KeyID: s.KeyID, Account: account, Issued: now.Truncate(time.Second).UTC(), Name: name, Ratings: ratings, Purpose: PurposeSeat,
		Match: seat.Match, Server: seat.Server, Playlist: seat.Playlist, Seat: seat.Seat, Roster: seat.Roster,
	})
}

// sign gives a ticket its life and a fresh one-time id, then signs it
func (s *Signer) sign(t Ticket) (string, Ticket, error) {
	t.Expires = t.Issued.Add(Lifetime)
	if t.Purpose == PurposeSeat {
		t.Expires = t.Issued.Add(SeatLifetime)
	}
	if _, err := rand.Read(t.Nonce[:]); err != nil {
		return "", Ticket{}, err
	}
	encoded, err := s.signed(t)
	return encoded, t, err
}

// signed is a ticket's JWT as it stands (its life and id set: the vector's too)
func (s *Signer) signed(t Ticket) (string, error) {
	if err := fits(t); err != nil {
		return "", err
	}
	key := jose.SigningKey{Algorithm: jose.EdDSA, Key: jose.JSONWebKey{Key: s.key, KeyID: t.KeyID}}
	signer, err := jose.NewSigner(key, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		return "", err
	}
	registered := jwt.Claims{
		Issuer: Issuer, Subject: hex.EncodeToString(t.Account[:]),
		IssuedAt: jwt.NewNumericDate(t.Issued), Expiry: jwt.NewNumericDate(t.Expires),
		ID: base64.RawURLEncoding.EncodeToString(t.Nonce[:]),
	}
	own := claims{Name: t.Name, Purpose: "rejoin", Match: fmt.Sprintf("%016x", t.Match)}
	for i, r := range t.Ratings {
		own.Ratings[i] = [2]uint16{r.Rating, r.Deviation}
	}
	if t.Purpose == PurposeSeat {
		registered.Audience = jwt.Audience{t.Server}
		own.Purpose, own.Playlist, own.Seat, own.Roster = "seat", &t.Playlist, &t.Seat, &t.Roster
	}
	encoded, err := jwt.Signed(signer).Claims(registered).Claims(own).Serialize()
	if err != nil {
		return "", err
	}
	if len(encoded) > MaxBytes {
		return "", errors.New("ticket: longer than MaxBytes")
	}
	return encoded, nil
}

// fits: a rejoin's ticket has its match and no seat; a seat's its match and a seat that fits its playlist's roster at a
// named server; a key id and a name of 1-32 bytes
func fits(t Ticket) error {
	if len(t.KeyID) == 0 || len(t.KeyID) > 32 || len(t.Name) == 0 || len(t.Name) > 32 || !utf8.ValidString(t.Name) {
		return errors.New("ticket: a key id and a name of 1-32 bytes")
	}
	seatless := t.Server == "" && t.Playlist == 0 && t.Seat == 0 && t.Roster == 0
	switch {
	case t.Purpose == PurposeRejoin && t.Match != 0 && seatless:
		return nil
	case t.Purpose == PurposeSeat && t.Match != 0 && len(t.Server) > 0 && len(t.Server) <= MaxServer && utf8.ValidString(t.Server) &&
		t.Playlist >= 1 && t.Playlist <= 3 && t.Roster == 2*t.Playlist && t.Seat < t.Roster:
		return nil
	}
	return errors.New("ticket: a rejoin's (its match) or a seat's (its match, server and seat)")
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

// VerifySigned reads a ticket and checks its signature (EdDSA alone, by a key of ours) and its claims, not its time: a
// result's or a quitter's (the game server hands on the player's ticket from the match's start; its issue time checked
// against the acceptance window instead)
func VerifySigned(encoded string, keys map[string]ed25519.PublicKey) (Ticket, error) {
	if len(encoded) > MaxBytes {
		return Ticket{}, errors.New("ticket: too long")
	}
	token, err := jwt.ParseSigned(encoded, []jose.SignatureAlgorithm{jose.EdDSA})
	if err != nil || len(token.Headers) != 1 {
		return Ticket{}, errors.New("ticket: malformed")
	}
	key, ok := keys[token.Headers[0].KeyID]
	if !ok {
		return Ticket{}, fmt.Errorf("ticket: no key %q", token.Headers[0].KeyID)
	}
	var registered jwt.Claims
	var own claims
	if err := token.Claims(key, &registered, &own); err != nil {
		return Ticket{}, errors.New("ticket: bad signature")
	}
	return read(token.Headers[0].KeyID, registered, own)
}

// read is a verified ticket's claims as a Ticket, each in its form (a malformed one refused)
func read(keyID string, registered jwt.Claims, own claims) (Ticket, error) {
	bad := errors.New("ticket: malformed")
	t := Ticket{KeyID: keyID, Name: own.Name}
	account, err := hex.DecodeString(registered.Subject)
	nonce, errNonce := base64.RawURLEncoding.DecodeString(registered.ID)
	if registered.Issuer != Issuer || err != nil || len(account) != 16 || errNonce != nil || len(nonce) != 16 ||
		registered.IssuedAt == nil || registered.Expiry == nil || len(own.Match) != 16 {
		return Ticket{}, bad
	}
	copy(t.Account[:], account)
	copy(t.Nonce[:], nonce)
	t.Issued, t.Expires = registered.IssuedAt.Time().UTC(), registered.Expiry.Time().UTC()
	for i, r := range own.Ratings {
		t.Ratings[i] = Shown{Rating: r[0], Deviation: r[1]}
	}
	if t.Match, err = strconv.ParseUint(own.Match, 16, 64); err != nil {
		return Ticket{}, bad
	}
	switch own.Purpose {
	case "rejoin":
		if len(registered.Audience) != 0 || own.Playlist != nil || own.Seat != nil || own.Roster != nil {
			return Ticket{}, bad
		}
		t.Purpose = PurposeRejoin
	case "seat":
		if len(registered.Audience) != 1 || own.Playlist == nil || own.Seat == nil || own.Roster == nil {
			return Ticket{}, bad
		}
		t.Purpose, t.Server, t.Playlist, t.Seat, t.Roster = PurposeSeat, registered.Audience[0], *own.Playlist, *own.Seat, *own.Roster
	default:
		return Ticket{}, bad
	}
	if fits(t) != nil {
		return Ticket{}, bad
	}
	return t, nil
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

// DevKeyID is the development key's id; DevSeedText what its seed is the SHA-256 of. Published on purpose: only a
// development game server (--dev) takes this key's tickets (the id is reserved: a listed key can't take it), and one
// hands a ticket to anyone who asks anyway; the development matchmaker (`carball-api matchmaker --dev`) signs with it
const (
	DevKeyID    = "dev"
	DevSeedText = "carball development ticket key"
)

// DevSigner signs with the development key
func DevSigner() *Signer {
	seed := sha256.Sum256([]byte(DevSeedText))
	return &Signer{KeyID: DevKeyID, key: ed25519.NewKeyFromSeed(seed[:])}
}
