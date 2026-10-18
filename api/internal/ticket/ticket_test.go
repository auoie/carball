package ticket

import (
	"crypto/ed25519"
	"encoding/base64"
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
		_, tk, err := s.Issue([16]byte{1}, "Ada", at)
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
	encoded, issued, err := s.Issue(account, "Made Up", now)
	if err != nil || len(encoded) > MaxBytes {
		t.Fatalf("Issue = %d bytes, %v", len(encoded), err)
	}
	got, err := Verify(encoded, keys(t, s), now.Add(time.Minute), 30*time.Second)
	if err != nil || got.Account != account || got.Name != "Made Up" || got.Nonce != issued.Nonce || !got.Expires.Equal(now.Add(Lifetime)) {
		t.Fatalf("Verify = %+v, %v", got, err)
	}
	// (a 32-byte name: still within the cap)
	long, _, err := s.Issue(account, strings.Repeat("é", 16), now)
	if err != nil || len(long) > MaxBytes {
		t.Errorf("a 32-byte name's ticket: %d bytes, %v", len(long), err)
	}
}

func TestVerifyRefusals(t *testing.T) {
	seed, _, _ := NewKey("k1")
	s, _ := NewSigner("k1", seed)
	encoded, _, _ := s.Issue([16]byte{9}, "Name", now)
	ks := keys(t, s)
	otherSeed, _, _ := NewKey("k1")
	other, _ := NewSigner("k1", otherSeed)
	forged, _, _ := other.Issue([16]byte{9}, "Name", now)
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
