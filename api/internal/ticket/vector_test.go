package ticket

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
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
	Encoded   string    `json:"encoded"`
	Comment   string    `json:"comment,omitempty"`
}

func TestTicketVector(t *testing.T) {
	// (made-up values; a key no one uses)
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(200 - i)
	}
	tk := Ticket{
		KeyID: "vector", Account: [16]byte{0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x49, 0x08, 0x87, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00},
		Issued: time.Unix(1792300000, 0), Expires: time.Unix(1792300120, 0),
		Nonce: [16]byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}, Name: "Made Up é",
		Ratings: [3]Shown{{Rating: 1500, Deviation: 500}, {Rating: 1723, Deviation: 64}, {Rating: 1312, Deviation: 110}},
	}
	key := ed25519.NewKeyFromSeed(seed)
	body, err := Encode(tk)
	if err != nil {
		t.Fatal(err)
	}
	signed := append([]byte(Context), body...)
	encoded := base64.RawURLEncoding.EncodeToString(append(body, ed25519.Sign(key, signed)...))
	pub, _ := key.Public().(ed25519.PublicKey)
	v := vector{
		Seed: base64.StdEncoding.EncodeToString(seed), KeyID: tk.KeyID, PublicKey: base64.StdEncoding.EncodeToString(pub),
		Account: hex.EncodeToString(tk.Account[:]), Name: tk.Name, Issued: tk.Issued.Unix(), Expires: tk.Expires.Unix(),
		Nonce: hex.EncodeToString(tk.Nonce[:]), Encoded: encoded,
		Comment: "A search ticket (version 2) made by api/internal/ticket and checked by server/src/ticket.rs: made-up values",
	}
	for i, r := range tk.Ratings {
		v.Ratings[i] = [2]int{int(r.Rating), int(r.Deviation)}
	}
	if os.Getenv("CARBALL_WRITE_TICKET_VECTOR") == "1" {
		out, _ := json.MarshalIndent(v, "", "  ")
		if err := os.WriteFile(vectorFile, append(out, '\n'), 0o644); err != nil { //nolint:gosec // (G306: a shared test vector, not a secret)
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(vectorFile)
	if err != nil {
		t.Fatal(err)
	}
	var stored vector
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Encoded != encoded || stored.PublicKey != v.PublicKey {
		t.Fatalf("protocol/ticket_vector.json isn't what this code makes (CARBALL_WRITE_TICKET_VECTOR=1 to write it):\n%s\n%s", stored.Encoded, encoded)
	}
	got, err := VerifySigned(stored.Encoded, map[string]ed25519.PublicKey{tk.KeyID: pub})
	if err != nil || got.Name != tk.Name || got.Ratings != tk.Ratings || got.Nonce != tk.Nonce {
		t.Fatalf("the vector read back: %+v, %v", got, err)
	}
}
