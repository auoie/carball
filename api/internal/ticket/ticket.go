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
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	// (its purpose's life at most, begun before it ends: as the game server's check, AP2-3, RV-950; one clock's
	// difference, no skew in it)
	life := Lifetime
	if t.Purpose == PurposeSeat {
		life = SeatLifetime
	}
	if t.Expires.Before(t.Issued) || t.Expires.Sub(t.Issued) > life {
		return Ticket{}, errors.New("ticket: not a ticket's life")
	}
	if now.Add(skew).Before(t.Issued) || !now.Add(-skew).Before(t.Expires) {
		return Ticket{}, errors.New("ticket: not in its time")
	}
	return t, nil
}

// VerifySigned reads a ticket and checks its signature (EdDSA alone, by a key of ours) and its claims, not its time: a
// result's or a quitter's (the game server hands on the player's ticket from the match's start; its issue time checked
// against the acceptance window instead). One spelling per ticket (AP2-11, RV-946): three parts, each canonical
// base64url, no line break; its header exactly alg EdDSA, its key's id and typ JWT (RV-947); its claims read strictly
// (`read`)
func VerifySigned(encoded string, keys map[string]ed25519.PublicKey) (Ticket, error) {
	malformed := errors.New("ticket: malformed")
	if len(encoded) > MaxBytes {
		return Ticket{}, errors.New("ticket: too long")
	}
	kid, err := header(encoded)
	if err != nil {
		return Ticket{}, malformed
	}
	key, ok := keys[kid]
	if !ok {
		return Ticket{}, fmt.Errorf("ticket: no key %q", kid)
	}
	token, err := jwt.ParseSigned(encoded, []jose.SignatureAlgorithm{jose.EdDSA})
	if err != nil || len(token.Headers) != 1 || token.Headers[0].KeyID != kid {
		return Ticket{}, malformed
	}
	var payload json.RawMessage
	if err := token.Claims(key, &payload); err != nil {
		return Ticket{}, errors.New("ticket: bad signature")
	}
	return read(kid, payload)
}

// header: a ticket's key id, its spelling and its header checked: three parts, each canonical unpadded base64url (no
// line break, no stray bits: Go's decoder skips \r and \n, so they're refused first), the header exactly alg "EdDSA",
// kid (1-32 bytes) and typ "JWT", each once
func header(encoded string) (string, error) {
	bad := errors.New("ticket: malformed")
	parts := strings.Split(encoded, ".")
	if strings.ContainsAny(encoded, "\r\n") || len(parts) != 3 {
		return "", bad
	}
	var raw []byte
	for i, part := range parts {
		decoded, err := base64.RawURLEncoding.Strict().DecodeString(part)
		if err != nil || len(decoded) == 0 {
			return "", bad
		}
		if i == 0 {
			raw = decoded
		}
	}
	members, err := object(raw)
	if err != nil || len(members) != 3 {
		return "", bad
	}
	var alg, kid, typ string
	for name, into := range map[string]*string{"alg": &alg, "kid": &kid, "typ": &typ} {
		if v, ok := members[name]; !ok || json.Unmarshal(v, into) != nil {
			return "", bad
		}
	}
	if alg != string(jose.EdDSA) || typ != "JWT" || kid == "" || len(kid) > 32 {
		return "", bad
	}
	return kid, nil
}

// object: a JSON object's members (its values as they are), each name once and nothing after it; else an error
func object(raw []byte) (map[string]json.RawMessage, error) {
	bad := errors.New("ticket: not one JSON object")
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, bad
	}
	out := map[string]json.RawMessage{}
	for dec.More() {
		t, err := dec.Token()
		name, isName := t.(string)
		if err != nil || !isName {
			return nil, bad
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, bad
		}
		if _, twice := out[name]; twice {
			return nil, bad
		}
		out[name] = value
	}
	if t, err := dec.Token(); err != nil || t != json.Delim('}') {
		return nil, bad
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, bad
	}
	return out, nil
}

// wellFormed: a JSON string's bytes as RFC 8259 and the game server (Rust's serde_json) take them: valid UTF-8, and no
// unpaired surrogate escape; Go's decoder would read either as U+FFFD, a ticket one side takes and the other refuses
// (RV-1005). U+FFFD itself, a name may have it, is taken
func wellFormed(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	s := string(raw)
	quad := func(at int) (uint64, bool) {
		if at+4 > len(s) {
			return 0, false
		}
		n, err := strconv.ParseUint(s[at:at+4], 16, 16)
		return n, err == nil
	}
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' {
			continue
		}
		i++
		if i >= len(s) || s[i] != 'u' {
			continue
		}
		r, ok := quad(i + 1)
		i += 4
		switch {
		case !ok:
			return false
		case r >= 0xD800 && r < 0xDC00: // (a high surrogate: its low one next)
			lo, ok := quad(i + 3)
			if !ok || i+2 >= len(s) || s[i+1] != '\\' || s[i+2] != 'u' || lo < 0xDC00 || lo >= 0xE000 {
				return false
			}
			i += 6
		case r >= 0xDC00 && r < 0xE000:
			return false
		}
	}
	return true
}

// read is a verified ticket's claims (its payload) as a Ticket, each in its form, strictly (RV-954): only the claims a
// ticket has, each once; iat and exp whole seconds; sub 32 hex digits; jti 16 bytes of canonical base64url; aud a
// string; the ratings three pairs; a rejoin's with its match and no seat, a seat's with its server, playlist, seat and
// roster (`fits`)
func read(keyID string, payload []byte) (Ticket, error) {
	bad := errors.New("ticket: malformed")
	members, err := object(payload)
	if err != nil {
		return Ticket{}, bad
	}
	allowed := map[string]bool{
		"iss": true, "sub": true, "aud": true, "iat": true, "exp": true, "jti": true, "name": true, "ratings": true,
		"purpose": true, "match": true, "playlist": true, "seat": true, "roster": true,
	}
	for name := range members {
		if !allowed[name] {
			return Ticket{}, bad
		}
	}
	str := func(name string) (string, bool) {
		var v string
		raw, ok := members[name]
		return v, ok && wellFormed(raw) && json.Unmarshal(raw, &v) == nil
	}
	seconds := func(name string) (time.Time, bool) {
		n, err := strconv.ParseInt(string(members[name]), 10, 64)
		return time.Unix(n, 0).UTC(), err == nil
	}
	small := func(name string) (*byte, bool) {
		raw, ok := members[name]
		if !ok {
			return nil, true
		}
		n, err := strconv.ParseUint(string(raw), 10, 8)
		b := byte(n)
		return &b, err == nil
	}
	iss, okIss := str("iss")
	sub, okSub := str("sub")
	jti, okJti := str("jti")
	name, okName := str("name")
	purpose, okPurpose := str("purpose")
	match, okMatch := str("match")
	issued, okIssued := seconds("iat")
	expires, okExpires := seconds("exp")
	playlist, okPlaylist := small("playlist")
	seat, okSeat := small("seat")
	roster, okRoster := small("roster")
	// (a null in a pair refused, not read as 0: RV-1005)
	var ratings [][]*uint16
	okRatings := json.Unmarshal(members["ratings"], &ratings) == nil && len(ratings) == 3
	for _, r := range ratings {
		okRatings = okRatings && len(r) == 2 && r[0] != nil && r[1] != nil
	}
	for _, ok := range []bool{okIss, okSub, okJti, okName, okPurpose, okMatch, okIssued, okExpires, okPlaylist, okSeat, okRoster, okRatings} {
		if !ok {
			return Ticket{}, bad
		}
	}
	if iss != Issuer || len(sub) != 32 || len(match) != 16 {
		return Ticket{}, bad
	}
	t := Ticket{KeyID: keyID, Name: name, Issued: issued, Expires: expires}
	account, err := hex.DecodeString(sub)
	nonce, errNonce := base64.RawURLEncoding.Strict().DecodeString(jti)
	if err != nil || errNonce != nil || len(nonce) != 16 {
		return Ticket{}, bad
	}
	copy(t.Account[:], account)
	copy(t.Nonce[:], nonce)
	for i, r := range ratings {
		t.Ratings[i] = Shown{Rating: *r[0], Deviation: *r[1]}
	}
	if t.Match, err = strconv.ParseUint(match, 16, 64); err != nil {
		return Ticket{}, bad
	}
	_, hasAud := members["aud"]
	switch purpose {
	case "rejoin":
		if hasAud || playlist != nil || seat != nil || roster != nil {
			return Ticket{}, bad
		}
		t.Purpose = PurposeRejoin
	case "seat":
		server, okServer := str("aud")
		if !okServer || playlist == nil || seat == nil || roster == nil {
			return Ticket{}, bad
		}
		t.Purpose, t.Server, t.Playlist, t.Seat, t.Roster = PurposeSeat, server, *playlist, *seat, *roster
	default:
		return Ticket{}, bad
	}
	if fits(t) != nil {
		return Ticket{}, bad
	}
	return t, nil
}

// ParsePublic reads public key lines as the game server's TICKET_PUBLIC_KEYS lists them ("KID BASE64", comma- or
// newline-separated), by its rules (server/src/ticket.rs `parse_keys`, AP2-5, RV-948): a key id 1-32 characters, never
// twice; a key 32 bytes, never one of small order (a signature "checks" under one for any
// message). An error names the entry by its number, never its text (a seed pasted in the wrong file stays out of the
// log: RV-953)
func ParsePublic(list string) (map[string]ed25519.PublicKey, error) {
	out := map[string]ed25519.PublicKey{}
	n := 0
	for _, item := range strings.FieldsFunc(list, func(r rune) bool { return r == ',' || r == '\n' }) {
		fields := strings.Fields(item)
		if len(fields) == 0 {
			continue
		}
		n++
		if len(fields) != 2 || len(fields[0]) > 32 {
			return nil, fmt.Errorf("ticket: key entry %d isn't \"KID BASE64\"", n)
		}
		kid := fields[0]
		raw, err := base64.StdEncoding.Strict().DecodeString(fields[1])
		switch {
		case err != nil || len(raw) != ed25519.PublicKeySize:
			return nil, fmt.Errorf("ticket: key entry %d isn't 32 bytes of base64", n)
		case smallOrder(raw):
			return nil, fmt.Errorf("ticket: key entry %d is of small order (no signer's)", n)
		}
		if _, twice := out[kid]; twice {
			return nil, fmt.Errorf("ticket: key entry %d repeats an id", n)
		}
		out[kid] = ed25519.PublicKey(raw)
	}
	return out, nil
}

// smallOrderKeys are the Ed25519 public keys of small order, sign bit aside (libsodium's list; the game server's
// SMALL_ORDER)
var smallOrderKeys = func() [7][32]byte {
	var ones [32]byte
	for i := range ones {
		ones[i] = 0xff
	}
	ones[31] = 0x7f
	a, b, c := ones, ones, ones
	a[0], b[0], c[0] = 0xec, 0xed, 0xee
	var one [32]byte
	one[0] = 1
	return [7][32]byte{
		{},
		one,
		{
			0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4, 0x89, 0xf2, 0xef, 0x98, 0xf0, 0xd5, 0xdf,
			0xac, 0x05, 0xd3, 0xc6, 0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x05,
		},
		{
			0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b, 0x76, 0x0d, 0x10, 0x67, 0x0f, 0x2a, 0x20,
			0x53, 0xfa, 0x2c, 0x39, 0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0x7a,
		},
		a, b, c,
	}
}()

// smallOrder: a public key of small order, its sign bit aside
func smallOrder(key []byte) bool {
	if len(key) != 32 {
		return false
	}
	for _, bad := range smallOrderKeys {
		if string(key[:31]) == string(bad[:31]) && key[31]&0x7f == bad[31] {
			return true
		}
	}
	return false
}
