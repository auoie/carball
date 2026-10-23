package ticket

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

func keys(t *testing.T, s *Signer) map[string]ed25519.PublicKey {
	t.Helper()
	kid, b64, _ := strings.Cut(s.Public(), " ")
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]ed25519.PublicKey{kid: raw}
}

// Each ticket's nonce its own, random: the game server takes each once (AP1's TK-nonce-fixed)
func TestNoncesDiffer(t *testing.T) {
	s, err := NewSigner("k1", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	seen := map[[16]byte]bool{}
	for range 8 {
		_, tk, err := s.Issue([16]byte{1}, "Ada", [3]Shown{}, at)
		if err != nil {
			t.Fatal(err)
		}
		if seen[tk.Nonce] || tk.Nonce == ([16]byte{}) {
			t.Fatalf("a nonce again, or none: %x", tk.Nonce)
		}
		seen[tk.Nonce] = true
	}
}

func TestIssueAndVerify(t *testing.T) {
	seed, public, err := NewKey("k1")
	if err != nil || !strings.HasPrefix(public, "k1 ") {
		t.Fatalf("NewKey = %q, %v", public, err)
	}
	s, err := NewSigner("k1", seed)
	if err != nil {
		t.Fatal(err)
	}
	account := [16]byte{1, 2, 3}
	ratings := [3]Shown{{1500, 500}, {1723, 64}, {65535, 45}}
	encoded, issued, err := s.Issue(account, "Made Up", ratings, now)
	if err != nil || len(encoded) > MaxBytes {
		t.Fatalf("Issue = %d bytes, %v", len(encoded), err)
	}
	got, err := Verify(encoded, keys(t, s), now.Add(time.Minute), 30*time.Second)
	if err != nil || got.Account != account || got.Name != "Made Up" || got.Nonce != issued.Nonce || !got.Expires.Equal(now.Add(Lifetime)) ||
		got.Ratings != ratings {
		t.Fatalf("Verify = %+v, %v", got, err)
	}
	// (a 32-byte key id and name: still within the cap)
	longKey, err := NewSigner(strings.Repeat("k", 32), seed)
	if err != nil {
		t.Fatal(err)
	}
	long, _, err := longKey.IssueFor(account, strings.Repeat("é", 16), ratings, PurposeRejoin, 1<<63, now)
	if err != nil || len(long) > MaxBytes {
		t.Errorf("a 32-byte name's rejoin ticket: %d bytes, %v", len(long), err)
	}
}

// A ticket's purpose: a search's has no match, a rejoin's its match; nothing else is made or read
func TestPurpose(t *testing.T) {
	seed, _, _ := NewKey("k1")
	s, _ := NewSigner("k1", seed)
	encoded, _, err := s.IssueFor([16]byte{9}, "Name", [3]Shown{}, PurposeRejoin, 0x0123456789abcdef, now)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Verify(encoded, keys(t, s), now, 0)
	if err != nil || got.Purpose != PurposeRejoin || got.Match != 0x0123456789abcdef {
		t.Fatalf("a rejoin's ticket read back: %+v, %v", got, err)
	}
	if got, _ := Verify(mustIssue(t, s), keys(t, s), now, 0); got.Purpose != PurposeSearch || got.Match != 0 {
		t.Errorf("a search's ticket read back: %+v", got)
	}
	for _, c := range []struct {
		purpose byte
		match   uint64
	}{{PurposeSearch, 9}, {PurposeRejoin, 0}, {2, 0}, {2, 9}} {
		if _, _, err := s.IssueFor([16]byte{9}, "Name", [3]Shown{}, c.purpose, c.match, now); err == nil {
			t.Errorf("purpose %d, match %d: issued", c.purpose, c.match)
		}
		// (signed by hand: refused on reading too)
		tk := Ticket{KeyID: "k1", Name: "Name", Issued: now, Expires: now.Add(Lifetime)}
		body, _ := Encode(tk)
		body[len(body)-9] = c.purpose
		binary.BigEndian.PutUint64(body[len(body)-8:], c.match)
		forged := base64.RawURLEncoding.EncodeToString(append(body, ed25519.Sign(s.key, append([]byte(Context), body...))...))
		if _, err := Verify(forged, keys(t, s), now, 0); err == nil {
			t.Errorf("purpose %d, match %d: read", c.purpose, c.match)
		}
	}
}

// Verify (the tests' and Rust's mirror): a ticket's life the API's at most, and begun before it ends
func TestVerifyChecksTheLife(t *testing.T) {
	seed, _, _ := NewKey("k1")
	s, _ := NewSigner("k1", seed)
	sign := func(tk Ticket) string {
		body, _ := Encode(tk)
		return base64.RawURLEncoding.EncodeToString(append(body, ed25519.Sign(s.key, append([]byte(Context), body...))...))
	}
	base := Ticket{KeyID: "k1", Name: "Name", Issued: now}
	for name, expires := range map[string]time.Time{"a day long": now.Add(24 * time.Hour), "ending before it begins": now.Add(-time.Second)} {
		tk := base
		tk.Expires = expires
		if _, err := Verify(sign(tk), keys(t, s), now, 30*time.Second); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	base.Expires = now.Add(Lifetime)
	if _, err := Verify(sign(base), keys(t, s), now, 30*time.Second); err != nil {
		t.Errorf("its lifetime: %v", err)
	}
}

func mustIssue(t *testing.T, s *Signer) string {
	t.Helper()
	encoded, _, err := s.Issue([16]byte{9}, "Name", [3]Shown{}, now)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestVerifyRefusals(t *testing.T) {
	seed, _, _ := NewKey("k1")
	s, _ := NewSigner("k1", seed)
	encoded, _, _ := s.Issue([16]byte{9}, "Name", [3]Shown{}, now)
	ks := keys(t, s)
	otherSeed, _, _ := NewKey("k1")
	other, _ := NewSigner("k1", otherSeed)
	forged, _, _ := other.Issue([16]byte{9}, "Name", [3]Shown{}, now)
	raw, _ := base64.RawURLEncoding.DecodeString(encoded)
	flipped := append([]byte(nil), raw...)
	flipped[20] ^= 1 // (the account's bytes changed: the signature no longer covers them)
	for name, c := range map[string]struct {
		ticket string
		at     time.Time
	}{
		"expired":                 {encoded, now.Add(Lifetime + 31*time.Second)},
		"not yet issued":          {encoded, now.Add(-31 * time.Second)},
		"another key's signature": {forged, now},
		"a byte changed":          {base64.RawURLEncoding.EncodeToString(flipped), now},
		"not base64":              {"!!!", now},
		"too long":                {strings.Repeat("A", MaxBytes+1), now},
		"truncated":               {encoded[:40], now},
		"a line break inside":     {encoded[:20] + "\n" + encoded[20:], now},
		"padded":                  {encoded + "==", now},
	} {
		if _, err := Verify(c.ticket, ks, c.at, 30*time.Second); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// (within the skew either way: accepted)
	for _, at := range []time.Time{now.Add(-29 * time.Second), now.Add(Lifetime + 29*time.Second)} {
		if _, err := Verify(encoded, ks, at, 30*time.Second); err != nil {
			t.Errorf("at %v: %v", at.Sub(now), err)
		}
	}
	// (an unknown key id)
	if _, err := Verify(encoded, map[string]ed25519.PublicKey{"k2": ks["k1"]}, now, 0); err == nil {
		t.Error("a ticket of an unknown key accepted")
	}
}

func TestNewSignerRefusals(t *testing.T) {
	seed, _, _ := NewKey("k1")
	for name, c := range map[string][2]string{
		"no id":        {"", seed},
		"a spaced id":  {"k 1", seed},
		"a short seed": {"k1", base64.StdEncoding.EncodeToString([]byte("short"))},
		"not base64":   {"k1", "!!!"},
	} {
		if _, err := NewSigner(c[0], c[1]); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// The lifetime pinned (AC-6: about two minutes; the game server's checks assume it, AP2-10)
func TestLifetime(t *testing.T) {
	if Lifetime != 2*time.Minute {
		t.Errorf("Lifetime = %v", Lifetime)
	}
}

// A name or key id that isn't UTF-8: refused, as the game server refuses it (AP2-11)
func TestNotUTF8Refused(t *testing.T) {
	seed, _, _ := NewKey("k1")
	s, _ := NewSigner("k1", seed)
	tk := Ticket{KeyID: "k1", Name: "\xff\xfe", Issued: now, Expires: now.Add(Lifetime)}
	body, err := Encode(tk)
	if err != nil {
		t.Fatal(err)
	}
	signed := append([]byte(Context), body...)
	encoded := base64.RawURLEncoding.EncodeToString(append(body, ed25519.Sign(s.key, signed)...))
	if _, err := VerifySigned(encoded, keys(t, s)); err == nil {
		t.Error("a name not UTF-8 accepted")
	}
}

// A match ticket: one seat of one match at one server, SeatLifetime long, version 4; its fields read back, the longest
// within the cap, and a seat that doesn't fit its roster, a seat's fields on another purpose or a seat at version 3
// neither made nor read (RV-850)
func TestSeat(t *testing.T) {
	seed, _, _ := NewKey("k1")
	s, _ := NewSigner("k1", seed)
	seat := Seat{Match: 0xfeedface12345678, Server: "game-eu.example:4433", Playlist: 3, Seat: 5, Roster: 6}
	encoded, issued, err := s.IssueSeat([16]byte{7}, "Made Up", [3]Shown{{1500, 500}, {1600, 80}, {1700, 90}}, seat, now)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Verify(encoded, keys(t, s), now.Add(10*time.Second), 30*time.Second)
	if err != nil || got.Purpose != PurposeSeat || got.Match != seat.Match || got.Server != seat.Server || got.Playlist != 3 ||
		got.Seat != 5 || got.Roster != 6 || !got.Expires.Equal(now.Add(SeatLifetime)) || got.Nonce != issued.Nonce {
		t.Fatalf("Verify = %+v, %v", got, err)
	}
	if _, err := Verify(encoded, keys(t, s), now.Add(SeatLifetime+31*time.Second), 30*time.Second); err == nil {
		t.Error("a match ticket past its life taken")
	}
	longKey, _ := NewSigner(strings.Repeat("k", 32), seed)
	long, _, err := longKey.IssueSeat([16]byte{7}, strings.Repeat("é", 16), [3]Shown{}, Seat{Match: 1, Server: strings.Repeat("s", MaxServer), Playlist: 1, Roster: 2}, now)
	if err != nil || len(long) > MaxBytes {
		t.Errorf("the longest match ticket: %d bytes, %v", len(long), err)
	}
	for _, bad := range []Seat{
		{Match: 1, Server: "a:1", Playlist: 2, Seat: 4, Roster: 4},
		{Match: 1, Server: "a:1", Playlist: 2, Seat: 0, Roster: 6},
		{Match: 1, Server: "a:1", Playlist: 4, Seat: 0, Roster: 8},
		{Match: 0, Server: "a:1", Playlist: 1, Seat: 0, Roster: 2},
		{Match: 1, Server: "", Playlist: 1, Seat: 0, Roster: 2},
		{Match: 1, Server: strings.Repeat("s", MaxServer+1), Playlist: 1, Seat: 0, Roster: 2},
	} {
		if _, _, err := s.IssueSeat([16]byte{7}, "Name", [3]Shown{}, bad, now); err == nil {
			t.Errorf("a seat that doesn't fit made: %+v", bad)
		}
	}
	if _, err := Encode(Ticket{KeyID: "k1", Name: "Name", Purpose: PurposeRejoin, Match: 1, Server: "a:1"}); err == nil {
		t.Error("a rejoin's ticket with a seat's server made")
	}
	// (a seat's bytes marked version 3, or a rejoin's marked 4: refused, whatever the signature)
	raw, _ := base64.RawURLEncoding.DecodeString(encoded)
	raw[0] = Version
	if _, err := decode(raw[:len(raw)-ed25519.SignatureSize]); err == nil {
		t.Error("a seat at version 3 read")
	}
	rejoin, _, _ := s.IssueFor([16]byte{9}, "Name", [3]Shown{}, PurposeRejoin, 5, now)
	raw, _ = base64.RawURLEncoding.DecodeString(rejoin)
	raw[0] = SeatVersion
	if _, err := decode(raw[:len(raw)-ed25519.SignatureSize]); err == nil {
		t.Error("a rejoin's ticket at version 4 read")
	}
	// (a seat with bytes after its fields: refused)
	raw, _ = base64.RawURLEncoding.DecodeString(encoded)
	body := append(append([]byte{}, raw[:len(raw)-ed25519.SignatureSize]...), 0)
	if _, err := decode(body); err == nil {
		t.Error("a seat with a stray byte read")
	}
}

// The development key: fixed, its public key the game server's test pins too (server/src/ticket.rs DEV_PUBLIC_KEY), so
// the development matchmaker's tickets check on a development server
func TestDevSigner(t *testing.T) {
	if got := DevSigner().Public(); got != "dev 1PGAXJYv9YNXDpJto+6YGra1rCGMn+EShfLPjpIiFgU=" {
		t.Errorf("the development key: %q", got)
	}
}
