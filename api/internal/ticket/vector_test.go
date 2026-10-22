package ticket

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"testing"
	"time"
)

// vectorFile is the ticket both sides check: made here (this code's encoding and signature), read by the game server's
// tests (server/src/ticket.rs). CARBALL_WRITE_TICKET_VECTOR=1 writes it anew; else it must be what this code makes
const vectorFile = "../../../protocol/ticket_vector.json"

type vector struct {
	Seed      string    `json:"seed"`
	KeyID     string    `json:"keyId"`
	PublicKey string    `json:"publicKey"`
	Account   string    `json:"account"`
	Name      string    `json:"name"`
	Issued    int64     `json:"issued"`
	Expires   int64     `json:"expires"`
	Nonce     string    `json:"nonce"`
	Ratings   [3][2]int `json:"ratings"`
	Purpose   int       `json:"purpose"`
	Match     string    `json:"match"` // (a decimal u64: JSON's numbers aren't)
	Encoded   string    `json:"encoded"`
}

type vectors struct {
	Comment string   `json:"comment"`
	Vectors []vector `json:"vectors"`
}

func TestTicketVector(t *testing.T) {
	// (made-up values; a key no one uses)
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(200 - i)
	}
	key := ed25519.NewKeyFromSeed(seed)
	pub, _ := key.Public().(ed25519.PublicKey)
	base := Ticket{
		KeyID: "vector", Account: [16]byte{0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x49, 0x08, 0x87, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00},
		Issued: time.Unix(1792300000, 0), Expires: time.Unix(1792300120, 0),
		Nonce: [16]byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}, Name: "Made Up é",
		Ratings: [3]Shown{{Rating: 1500, Deviation: 500}, {Rating: 1723, Deviation: 64}, {Rating: 1312, Deviation: 110}},
	}
	rejoin := base
	rejoin.Nonce[0], rejoin.Purpose, rejoin.Match = 0x99, PurposeRejoin, 0xfedcba9876543210
	made := vectors{Comment: "A search's ticket and a rejoin's (version 3) made by api/internal/ticket and checked by server/src/ticket.rs: made-up values"}
	for _, tk := range []Ticket{base, rejoin} {
		body, err := Encode(tk)
		if err != nil {
			t.Fatal(err)
		}
		signed := append([]byte(Context), body...)
		v := vector{
			Seed: base64.StdEncoding.EncodeToString(seed), KeyID: tk.KeyID, PublicKey: base64.StdEncoding.EncodeToString(pub),
			Account: hex.EncodeToString(tk.Account[:]), Name: tk.Name, Issued: tk.Issued.Unix(), Expires: tk.Expires.Unix(),
			Nonce: hex.EncodeToString(tk.Nonce[:]), Purpose: int(tk.Purpose), Match: strconv.FormatUint(tk.Match, 10),
			Encoded: base64.RawURLEncoding.EncodeToString(append(body, ed25519.Sign(key, signed)...)),
		}
		for i, r := range tk.Ratings {
			v.Ratings[i] = [2]int{int(r.Rating), int(r.Deviation)}
		}
		made.Vectors = append(made.Vectors, v)
	}
	if os.Getenv("CARBALL_WRITE_TICKET_VECTOR") == "1" {
		out, _ := json.MarshalIndent(made, "", "  ")
		if err := os.WriteFile(vectorFile, append(out, '\n'), 0o644); err != nil { //nolint:gosec // (G306: a shared test vector, not a secret)
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(vectorFile)
	if err != nil {
		t.Fatal(err)
	}
	var stored vectors
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored.Vectors) != len(made.Vectors) {
		t.Fatalf("protocol/ticket_vector.json has %d tickets, this code makes %d", len(stored.Vectors), len(made.Vectors))
	}
	for i, v := range made.Vectors {
		if stored.Vectors[i] != v {
			t.Fatalf("protocol/ticket_vector.json isn't what this code makes (CARBALL_WRITE_TICKET_VECTOR=1 to write it):\n%+v\n%+v", stored.Vectors[i], v)
		}
		got, err := VerifySigned(v.Encoded, map[string]ed25519.PublicKey{v.KeyID: pub})
		want := []Ticket{base, rejoin}[i]
		if err != nil || got.Name != want.Name || got.Ratings != want.Ratings || got.Nonce != want.Nonce || got.Purpose != want.Purpose ||
			got.Match != want.Match {
			t.Fatalf("ticket %d read back: %+v, %v", i, got, err)
		}
	}
}
