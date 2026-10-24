package ticket

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
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

func newSigner(t *testing.T, kid string) *Signer {
	t.Helper()
	seed, _, err := NewKey(kid)
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewSigner(kid, seed)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// handSigned is a JWT signed with the signer's key whatever its claims say (a ticket this package wouldn't make)
func handSigned(t *testing.T, s *Signer, registered jwt.Claims, own map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.EdDSA, Key: jose.JSONWebKey{Key: s.key, KeyID: s.KeyID}}, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := jwt.Signed(signer).Claims(registered).Claims(own).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

// a rejoin ticket's claims as this package makes them (its registered ones, its own), for hand-signed variations
func rejoinClaims() (jwt.Claims, map[string]any) {
	return jwt.Claims{
		Issuer: Issuer, Subject: strings.Repeat("09", 16), IssuedAt: jwt.NewNumericDate(now), Expiry: jwt.NewNumericDate(now.Add(Lifetime)),
		ID: base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
	}, map[string]any{
		"name": "Name", "ratings": [3][2]uint16{{1500, 500}, {1500, 500}, {1500, 500}}, "purpose": "rejoin", "match": "00000000000000a1",
	}
}

// Each ticket's one-time id its own, random: the game server takes each once (AP1's TK-nonce-fixed)
func TestNoncesDiffer(t *testing.T) {
	s := newSigner(t, "k1")
	_, a, _ := s.IssueRejoin([16]byte{9}, "Name", [3]Shown{}, 0xa1, now)
	_, b, _ := s.IssueRejoin([16]byte{9}, "Name", [3]Shown{}, 0xa1, now)
	if a.Nonce == b.Nonce || a.Nonce == [16]byte{} {
		t.Errorf("nonces %x and %x", a.Nonce, b.Nonce)
	}
}

// A rejoin's ticket: a JWT (EdDSA, its key's id, typ JWT) whose claims read back as issued
func TestIssueAndVerify(t *testing.T) {
	s := newSigner(t, "k1")
	ratings := [3]Shown{{Rating: 1500, Deviation: 500}, {Rating: 1723, Deviation: 64}, {Rating: 1312, Deviation: 110}}
	encoded, issued, err := s.IssueRejoin([16]byte{1, 2, 3, 15: 16}, "Made Up é", ratings, 0xfedcba9876543210, now)
	if err != nil {
		t.Fatal(err)
	}
	head, _, _ := strings.Cut(encoded, ".")
	raw, _ := base64.RawURLEncoding.DecodeString(head)
	var header map[string]string
	if err := json.Unmarshal(raw, &header); err != nil || header["alg"] != "EdDSA" || header["kid"] != "k1" || header["typ"] != "JWT" {
		t.Errorf("the header %s: %v", raw, err)
	}
	got, err := Verify(encoded, keys(t, s), now, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if got != issued || got.Name != "Made Up é" || got.Ratings != ratings || got.Purpose != PurposeRejoin || got.Match != 0xfedcba9876543210 || !got.Expires.Equal(now.Add(Lifetime)) {
		t.Errorf("read back %+v, issued %+v", got, issued)
	}
	// (the longest: a 32-byte key id, a 64-byte server, a name of 32 characters JSON writes as 6 bytes each, within the
	// cap: 885 characters)
	long, _ := NewSigner(strings.Repeat("k", 32), base64.StdEncoding.EncodeToString(make([]byte, 32)))
	seat := Seat{Match: ^uint64(0), Server: strings.Repeat("h", 59) + ":4433", Playlist: 3, Seat: 5, Roster: 6}
	most := [3]Shown{{65535, 65535}, {65535, 65535}, {65535, 65535}}
	encoded, _, err = long.IssueSeat([16]byte{255}, strings.Repeat("<", 32), most, seat, now)
	if err != nil || len(encoded) != 885 || len(encoded) > MaxBytes {
		t.Errorf("the longest ticket: %d bytes, %v", len(encoded), err)
	}
}

// What a ticket's claims must be: a rejoin's its match and no seat, a seat's its match, server and a seat in its roster;
// iss carball, sub 32 hex digits, jti 16 bytes; anything else refused on issue or on reading
func TestPurposeAndClaims(t *testing.T) {
	s := newSigner(t, "k1")
	if _, _, err := s.IssueRejoin([16]byte{9}, "Name", [3]Shown{}, 0, now); err == nil {
		t.Error("a rejoin of no match issued")
	}
	if _, _, err := s.IssueRejoin([16]byte{9}, "", [3]Shown{}, 1, now); err == nil {
		t.Error("a ticket without a name issued")
	}
	if _, _, err := s.IssueRejoin([16]byte{9}, "\xff\xfe", [3]Shown{}, 1, now); err == nil {
		t.Error("a name not UTF-8 issued")
	}
	ks := keys(t, s)
	registered, own := rejoinClaims()
	if _, err := Verify(handSigned(t, s, registered, own), ks, now, 0); err != nil {
		t.Fatalf("the hand-signed rejoin itself: %v", err)
	}
	for name, change := range map[string]func(r *jwt.Claims, o map[string]any){
		"another issuer":         func(r *jwt.Claims, _ map[string]any) { r.Issuer = "someone" },
		"a short sub":            func(r *jwt.Claims, _ map[string]any) { r.Subject = "09" },
		"a jti not 16 bytes":     func(r *jwt.Claims, _ map[string]any) { r.ID = "abc" },
		"no expiry":              func(r *jwt.Claims, _ map[string]any) { r.Expiry = nil },
		"a search's purpose":     func(_ *jwt.Claims, o map[string]any) { o["purpose"] = "search" },
		"a rejoin with a seat":   func(_ *jwt.Claims, o map[string]any) { o["seat"] = 1 },
		"a rejoin with an aud":   func(r *jwt.Claims, _ map[string]any) { r.Audience = jwt.Audience{"game.example:4433"} },
		"a rejoin of match zero": func(_ *jwt.Claims, o map[string]any) { o["match"] = "0000000000000000" },
		"a match not hex":        func(_ *jwt.Claims, o map[string]any) { o["match"] = "zz000000000000a1" },
		"a seat without a seat": func(r *jwt.Claims, o map[string]any) {
			r.Audience, o["purpose"], o["playlist"], o["roster"] = jwt.Audience{"game.example:4433"}, "seat", 1, 2
		},
		"a seat outside its roster": func(r *jwt.Claims, o map[string]any) {
			r.Audience, o["purpose"], o["playlist"], o["seat"], o["roster"] = jwt.Audience{"game.example:4433"}, "seat", 1, 2, 2
		},
		"a seat of two servers": func(r *jwt.Claims, o map[string]any) {
			r.Audience, o["purpose"], o["playlist"], o["seat"], o["roster"] = jwt.Audience{"a.example:1", "b.example:1"}, "seat", 1, 0, 2
		},
	} {
		r, o := rejoinClaims()
		change(&r, o)
		if _, err := Verify(handSigned(t, s, r, o), ks, now, 0); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// A ticket's life: Lifetime at most (and the skew), begun before it ends (AP2-3)
func TestVerifyChecksTheLife(t *testing.T) {
	s := newSigner(t, "k1")
	for name, expires := range map[string]time.Time{"a day long": now.Add(24 * time.Hour), "ending before it begins": now.Add(-time.Second)} {
		r, o := rejoinClaims()
		r.Expiry = jwt.NewNumericDate(expires)
		if _, err := Verify(handSigned(t, s, r, o), keys(t, s), now, 30*time.Second); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestVerifyRefusals(t *testing.T) {
	s := newSigner(t, "k1")
	encoded, _, _ := s.IssueRejoin([16]byte{9}, "Name", [3]Shown{}, 0xa1, now)
	ks := keys(t, s)
	forged, _, _ := newSigner(t, "k1").IssueRejoin([16]byte{9}, "Name", [3]Shown{}, 0xa1, now)
	parts := strings.Split(encoded, ".")
	// (its payload's account changed: the signature no longer covers it)
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	changed := strings.Replace(string(payload), `"sub":"09`, `"sub":"0a`, 1)
	if changed == string(payload) {
		t.Fatalf("no account in %s", payload)
	}
	tampered := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(changed)) + "." + parts[2]
	// (alg none, and an HMAC keyed with the public key: refused, EdDSA alone)
	none := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","kid":"k1","typ":"JWT"}`)) + "." + parts[1] + "."
	hsHead := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","kid":"k1","typ":"JWT"}`))
	mac := hmac.New(sha256.New, ks["k1"])
	mac.Write([]byte(hsHead + "." + parts[1]))
	confused := hsHead + "." + parts[1] + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	for name, c := range map[string]struct {
		ticket string
		at     time.Time
	}{
		"expired":                 {encoded, now.Add(Lifetime + 31*time.Second)},
		"not yet issued":          {encoded, now.Add(-31 * time.Second)},
		"another key's signature": {forged, now},
		"its payload changed":     {tampered, now},
		"alg none":                {none, now},
		"HS256 with the key":      {confused, now},
		"not a JWT":               {"!!!", now},
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

// rawSigned: a JWT of this header and payload as given (JSON by hand: any member, any spelling), signed with the signer's
// key
func rawSigned(s *Signer, header, payload string) string {
	h := base64.RawURLEncoding.EncodeToString([]byte(header))
	p := base64.RawURLEncoding.EncodeToString([]byte(payload))
	return h + "." + p + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(s.key, []byte(h+"."+p)))
}

// One spelling per ticket and nothing it doesn't carry (AP2-11; RV-946, RV-947, RV-954, RV-955): a line break, stray
// bits, another header member (crit, b64, x5c, jku), a member twice, a float time, an array aud, ratings of another
// shape, an unknown claim, a null aud: refused as malformed; a changed payload as a bad signature
func TestOneSpellingNothingElse(t *testing.T) {
	s := newSigner(t, "k1")
	ks := keys(t, s)
	head := `{"alg":"EdDSA","kid":"k1","typ":"JWT"}`
	iat := strconv.FormatInt(now.Unix(), 10)
	body := `{"exp":` + strconv.FormatInt(now.Unix()+120, 10) + `,"iat":` + iat + `,"iss":"carball","jti":"AAAAAAAAAAAAAAAAAAAAAA",` +
		`"match":"00000000000000a1","name":"Name","purpose":"rejoin","ratings":[[1500,500],[1500,500],[1500,500]],` +
		`"sub":"` + strings.Repeat("09", 16) + `"}`
	good := rawSigned(s, head, body)
	if _, err := Verify(good, ks, now, 0); err != nil {
		t.Fatalf("the hand-made ticket itself: %v", err)
	}
	// (a name's U+FFFD itself, an escaped pair, an escaped backslash before a "u": taken, read as written, RV-1005)
	for spelled, want := range map[string]string{`"N\ufffd"`: "N\ufffd", "\"N\ufffd\"": "N\ufffd", `"\ud83d\ude00"`: "\U0001F600", `"a\\u0041"`: `a\u0041`} {
		got, err := Verify(rawSigned(s, head, strings.Replace(body, `"Name"`, spelled, 1)), ks, now, 0)
		if err != nil || got.Name != want {
			t.Errorf("the name %s: %q, %v", spelled, got.Name, err)
		}
	}
	parts := strings.Split(good, ".")
	// (the signature's last character, 2 bits of it the signature's and 4 always zero: one of those set, the bytes the same)
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	last := strings.IndexByte(alphabet, parts[2][len(parts[2])-1])
	strayBits := parts[0] + "." + parts[1] + "." + parts[2][:len(parts[2])-1] + string(alphabet[last|1])
	malformed := map[string]string{
		"a line break inside":   good[:20] + "\n" + good[20:],
		"a carriage return":     good[:20] + "\r" + good[20:],
		"stray bits at its end": strayBits,
		"padded":                good + "==",
		"four parts":            good + ".AAAA",
		"crit":                  rawSigned(s, `{"alg":"EdDSA","kid":"k1","typ":"JWT","crit":["exp"]}`, body),
		"b64 false":             rawSigned(s, `{"alg":"EdDSA","kid":"k1","typ":"JWT","b64":false}`, body),
		"x5c":                   rawSigned(s, `{"alg":"EdDSA","kid":"k1","typ":"JWT","x5c":["AAAA"]}`, body),
		"jku":                   rawSigned(s, `{"alg":"EdDSA","kid":"k1","typ":"JWT","jku":"https://x.example"}`, body),
		"no typ":                rawSigned(s, `{"alg":"EdDSA","kid":"k1"}`, body),
		"typ JOSE":              rawSigned(s, `{"alg":"EdDSA","kid":"k1","typ":"JOSE"}`, body),
		"a lone surrogate":      rawSigned(s, head, strings.Replace(body, `"name":"Name"`, `"name":"N\ud800ame"`, 1)),
		"a lone low surrogate":  rawSigned(s, head, strings.Replace(body, `"name":"Name"`, `"name":"N\udc00ame"`, 1)),
		"an invalid byte":       rawSigned(s, head, strings.Replace(body, `"name":"Name"`, "\"name\":\"N\xffame\"", 1)),
		"a null rating":         rawSigned(s, head, strings.Replace(body, `[[1500,500],`, `[[1500,null],`, 1)),
		"alg twice":             rawSigned(s, `{"alg":"EdDSA","alg":"EdDSA","kid":"k1","typ":"JWT"}`, body),
		"a float time":          rawSigned(s, head, strings.Replace(body, `"iat":`+iat, `"iat":`+iat+`.5`, 1)),
		"an array aud":          rawSigned(s, head, strings.Replace(body, `"purpose":"rejoin"`, `"purpose":"seat","aud":["a.example:1"],"playlist":1,"seat":0,"roster":2`, 1)),
		"two ratings":           rawSigned(s, head, strings.Replace(body, `[[1500,500],[1500,500],[1500,500]]`, `[[1500,500],[1500,500]]`, 1)),
		"a rating of three":     rawSigned(s, head, strings.Replace(body, `[[1500,500],`, `[[1500,500,1],`, 1)),
		"an unknown claim":      rawSigned(s, head, strings.Replace(body, `"iss"`, `"admin":true,"iss"`, 1)),
		"a claim twice":         rawSigned(s, head, strings.Replace(body, `"iss":"carball"`, `"iss":"carball","iss":"carball"`, 1)),
		"a null aud":            rawSigned(s, head, strings.Replace(body, `"iss"`, `"aud":null,"iss"`, 1)),
		"a jti with stray bits": rawSigned(s, head, strings.Replace(body, `"AAAAAAAAAAAAAAAAAAAAAA"`, `"AAAAAAAAAAAAAAAAAAAAAB"`, 1)),
	}
	for name, ticket := range malformed {
		if _, err := Verify(ticket, ks, now, 0); err == nil || !strings.Contains(err.Error(), "malformed") {
			t.Errorf("%s: %v (want malformed)", name, err)
		}
	}
	tampered := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(body, `"Name"`, `"Mame"`, 1))) + "." + parts[2]
	if _, err := Verify(tampered, ks, now, 0); err == nil || !strings.Contains(err.Error(), "bad signature") {
		t.Errorf("a changed payload: %v (want a bad signature)", err)
	}
}

// Each purpose its own life, no skew in it (one clock's difference, RV-950): a rejoin's 120 s, a seat's 30 s
func TestEachPurposeItsLife(t *testing.T) {
	s := newSigner(t, "k1")
	for name, c := range map[string]struct {
		seat bool
		life time.Duration
		ok   bool
	}{
		"a rejoin's 120 s": {false, Lifetime, true}, "a rejoin's 121 s": {false, Lifetime + time.Second, false},
		"a seat's 30 s": {true, SeatLifetime, true}, "a seat's 31 s": {true, SeatLifetime + time.Second, false},
	} {
		tk := Ticket{KeyID: "k1", Account: [16]byte{9}, Issued: now, Expires: now.Add(c.life), Name: "Name", Purpose: PurposeRejoin, Match: 1}
		if c.seat {
			tk.Purpose, tk.Server, tk.Playlist, tk.Roster = PurposeSeat, "a.example:1", 1, 2
		}
		encoded, err := s.signed(tk)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := Verify(encoded, keys(t, s), now, 30*time.Second); (err == nil) != c.ok {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// A ticket past MaxBytes refused for its length alone, validly signed and otherwise fine (RV-952's G2): a 32-byte key
// id, a server of 64 and a name of 32 characters JSON writes as 6 bytes each
func TestATicketPastMaxBytesIsRefused(t *testing.T) {
	long, _ := NewSigner(strings.Repeat("k", 32), base64.StdEncoding.EncodeToString(make([]byte, 32)))
	registered := jwt.Claims{
		Issuer: Issuer, Subject: strings.Repeat("ff", 16), IssuedAt: jwt.NewNumericDate(now), Expiry: jwt.NewNumericDate(now.Add(SeatLifetime)),
		Audience: jwt.Audience{strings.Repeat("<", 59) + ":4433"}, ID: base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
	}
	own := map[string]any{
		"name": strings.Repeat("<", 32), "ratings": [3][2]uint16{}, "purpose": "seat", "match": "00000000000000a1",
		"playlist": 3, "seat": 5, "roster": 6,
	}
	encoded := handSigned(t, long, registered, own)
	if len(encoded) <= MaxBytes {
		t.Fatalf("only %d bytes", len(encoded))
	}
	if _, err := VerifySigned(encoded, keys(t, long)); err == nil || !strings.Contains(err.Error(), "too long") {
		t.Errorf("a %d-byte ticket: %v", len(encoded), err)
	}
}

// The public keys' list by the game server's rules (AP2-5, RV-948): a key of small order (its sign bit either way), an
// id twice, a key not 32 bytes of base64: refused; an error names the entry, never its text
// (RV-953)
func TestParsePublicRefusesWhatTheGameServerRefuses(t *testing.T) {
	good := func(seed byte) string {
		return base64.StdEncoding.EncodeToString(ed25519.NewKeyFromSeed(bytes.Repeat([]byte{seed}, 32)).Public().(ed25519.PublicKey))
	}
	keys, err := ParsePublic("k1 " + good(1) + ",\nk2 " + good(2) + "\n")
	if err != nil || len(keys) != 2 {
		t.Fatalf("two good keys: %v %v", keys, err)
	}
	for _, bad := range smallOrderKeys {
		signed := bad
		signed[31] |= 0x80
		for _, key := range [][32]byte{bad, signed} {
			if _, err := ParsePublic("so " + base64.StdEncoding.EncodeToString(key[:])); err == nil {
				t.Errorf("a key of small order taken: %x", key)
			}
		}
	}
	secret := "c2VlZC1vZi1hLWtleS1uZXZlci10by1iZS1sb2dnZWQhIQ=="
	for name, list := range map[string]string{
		"an id twice":             "k1 " + good(1) + ", k1 " + good(2),
		"the old development key": "prod 1PGAXJYv9YNXDpJto+6YGra1rCGMn+EShfLPjpIiFgU=",
		"not 32 bytes":            "k1 c2hvcnQ=",
		"not base64":              "k1 !!!",
		"three fields":            "k1 " + secret + " extra",
		"a seed, not a key":       "k1 " + secret,
	} {
		_, err := ParsePublic(list)
		if err == nil {
			t.Errorf("%s: taken", name)
		} else if strings.Contains(err.Error(), secret) {
			t.Errorf("%s: the entry's text in the error: %v", name, err)
		}
	}
	// (the old development key's seed, published: no signer of it either, RV-1059)
	devSeed := sha256.Sum256([]byte("carball development ticket key"))
	if _, err := NewSigner("prod", base64.StdEncoding.EncodeToString(devSeed[:])); err == nil {
		t.Error("a signer of the old development key's seed")
	}
}

// The lifetimes pinned (AC-6: about two minutes; a seat's thirty seconds; the game server's checks assume them, AP2-10)
func TestLifetime(t *testing.T) {
	if Lifetime != 2*time.Minute || SeatLifetime != 30*time.Second {
		t.Errorf("Lifetime = %v, SeatLifetime = %v", Lifetime, SeatLifetime)
	}
}

// A match ticket: its seat's fields read back, its server its aud, its life SeatLifetime; a seat that doesn't fit its
// playlist's roster, or no server, not issued
func TestSeat(t *testing.T) {
	s := newSigner(t, "k1")
	seat := Seat{Match: 0x0123456789abcdef, Server: "game-eu.example:4433", Playlist: 2, Seat: 3, Roster: 4}
	encoded, issued, err := s.IssueSeat([16]byte{7}, "Seated", [3]Shown{}, seat, now)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Verify(encoded, keys(t, s), now, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if got != issued || got.Purpose != PurposeSeat || got.Server != seat.Server || got.Seat != 3 || got.Roster != 4 || !got.Expires.Equal(now.Add(SeatLifetime)) {
		t.Errorf("read back %+v", got)
	}
	_, payload, _ := strings.Cut(encoded, ".")
	payload, _, _ = strings.Cut(payload, ".")
	raw, _ := base64.RawURLEncoding.DecodeString(payload)
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil || claims["aud"] != seat.Server || claims["sub"] != hex.EncodeToString([]byte{7, 15: 0}) {
		t.Errorf("the claims %s: %v", raw, err)
	}
	for name, bad := range map[string]Seat{
		"no server":           {Match: 1, Playlist: 1, Seat: 0, Roster: 2},
		"a roster not 2x":     {Match: 1, Server: "a:1", Playlist: 2, Seat: 0, Roster: 2},
		"a seat past it":      {Match: 1, Server: "a:1", Playlist: 1, Seat: 2, Roster: 2},
		"a playlist past 3":   {Match: 1, Server: "a:1", Playlist: 4, Seat: 0, Roster: 8},
		"no match":            {Server: "a:1", Playlist: 1, Seat: 0, Roster: 2},
		"a server past 64":    {Match: 1, Server: strings.Repeat("h", 65), Playlist: 1, Seat: 0, Roster: 2},
		"a server not UTF-8":  {Match: 1, Server: "\xff:1", Playlist: 1, Seat: 0, Roster: 2},
		"no playlist at all":  {Match: 1, Server: "a:1"},
		"seat zero no roster": {Match: 1, Server: "a:1", Playlist: 1},
	} {
		if _, _, err := s.IssueSeat([16]byte{7}, "Seated", [3]Shown{}, bad, now); err == nil {
			t.Errorf("%s: issued", name)
		}
	}
}
