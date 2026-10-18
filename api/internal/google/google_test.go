package google

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"carball/api/internal/testoidc"
)

const redirect = "https://carball.example/api/auth/google/callback"

func setup(t *testing.T) (*Client, *testoidc.Provider) {
	t.Helper()
	p := testoidc.New(t, "our-client", "our-secret")
	return &Client{ClientID: "our-client", ClientSecret: "our-secret", RedirectURL: redirect, Issuer: p.URL,
		HTTP: &http.Client{Timeout: 5 * time.Second}}, p
}

// signIn: a flow's start, the consent as sub, the exchange with the flow's verifier and nonce
func signIn(t *testing.T, c *Client, p *testoidc.Provider, sub string) (string, error) {
	t.Helper()
	nonce, verifier := "the-flows-nonce", oauth2.GenerateVerifier()
	authURL, err := c.AuthURL("the-state", nonce, verifier)
	if err != nil {
		t.Fatal(err)
	}
	q := p.Authorize(t, authURL, sub)
	return c.Exchange(context.Background(), q.Get("code"), verifier, nonce)
}

func TestExchange(t *testing.T) {
	c, p := setup(t)
	if sub, err := signIn(t, c, p, "sub-1"); err != nil || sub != "sub-1" {
		t.Fatalf("Exchange = %q, %v", sub, err)
	}
	// (azp our client: fine)
	p.AZP = "our-client"
	if _, err := signIn(t, c, p, "sub-1"); err != nil {
		t.Fatalf("azp ours: %v", err)
	}
}

func TestExchangeRefusals(t *testing.T) {
	other := "another-nonce"
	for _, tc := range []struct {
		name string
		knob func(p *testoidc.Provider)
		want error
	}{
		{"nonce not the flow's", func(p *testoidc.Provider) { p.Nonce = &other }, ErrNonce},
		{"azp another client", func(p *testoidc.Provider) { p.AZP = "their-client" }, ErrAZP},
		{"two audiences, no azp", func(p *testoidc.Provider) { p.Audience = []string{"our-client", "their-client"} }, ErrAZP},
		{"two audiences, azp theirs", func(p *testoidc.Provider) {
			p.Audience = []string{"our-client", "their-client"}
			p.AZP = "their-client"
		}, ErrAZP},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, p := setup(t)
			tc.knob(p)
			if _, err := signIn(t, c, p, "sub-1"); !errors.Is(err, tc.want) {
				t.Fatalf("Exchange: %v, want %v", err, tc.want)
			}
		})
	}
	// (go-oidc's own: another audience, an expired token)
	c, p := setup(t)
	p.Audience = []string{"their-client"}
	if _, err := signIn(t, c, p, "sub-1"); err == nil {
		t.Error("an ID token for another client accepted")
	}
	c, p = setup(t)
	p.IssuedAgo = 2 * time.Hour
	if _, err := signIn(t, c, p, "sub-1"); err == nil {
		t.Error("an expired ID token accepted")
	}
	// (signed by the issuer's keys but naming another issuer: refused, the issuer checked)
	c, p = setup(t)
	p.Issuer = "https://accounts.example"
	if _, err := signIn(t, c, p, "sub-1"); err == nil {
		t.Error("an ID token from another issuer accepted")
	}
}

func TestExchangePKCE(t *testing.T) {
	c, p := setup(t)
	authURL, err := c.AuthURL("s", "n", oauth2.GenerateVerifier())
	if err != nil {
		t.Fatal(err)
	}
	q := p.Authorize(t, authURL, "sub-1")
	// (another verifier than the challenge's: the provider refuses the code)
	if _, err := c.Exchange(context.Background(), q.Get("code"), oauth2.GenerateVerifier(), "n"); err == nil {
		t.Fatal("a code exchanged with the wrong PKCE verifier")
	}
}

// A failed discovery answers for itself for 30 s: Google isn't asked again by every sign-in meanwhile; after, it is
// (AP-17, AP2-10)
func TestDiscoveryFailureCached(t *testing.T) {
	asked := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		asked++
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	at := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	c := &Client{ClientID: "c", Issuer: srv.URL, HTTP: srv.Client(), Now: func() time.Time { return at }}
	for range 3 {
		if _, err := c.AuthURL("s", "n", "v"); err == nil {
			t.Fatal("a discovery that failed: no error")
		}
	}
	if asked != 1 {
		t.Errorf("asked %d times within the 30 s, want 1", asked)
	}
	at = at.Add(31 * time.Second)
	_, _ = c.AuthURL("s", "n", "v")
	if asked != 2 {
		t.Errorf("asked %d times after the 30 s, want 2", asked)
	}
}
