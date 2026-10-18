// Package testoidc is a stand-in OpenID Connect provider for the tests (Google's part of a sign-in): discovery, its keys,
// an authorization step the test drives, and a token endpoint that checks the client and the PKCE verifier. Its knobs
// make the ID tokens a test needs wrong.
package testoidc

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// Provider is the stand-in
type Provider struct {
	URL                    string
	ClientID, ClientSecret string

	// Knobs: the next ID tokens' audience (default the client), azp (default none), nonce (default the request's),
	// issued how long ago (default now); Exchanges counts the token calls
	Audience  []string
	AZP       string
	Nonce     *string
	IssuedAgo time.Duration
	Exchanges int

	key   *rsa.PrivateKey
	mu    sync.Mutex
	codes map[string]grant
}

type grant struct {
	sub, nonce, challenge, redirect string
}

// New starts one, stopped with the test
func New(t *testing.T, clientID, secret string) *Provider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p := &Provider{ClientID: clientID, ClientSecret: secret, key: key, codes: map[string]grant{}}
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	p.URL = srv.URL
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{
			"issuer": p.URL, "authorization_endpoint": p.URL + "/authorize", "token_endpoint": p.URL + "/token",
			"jwks_uri": p.URL + "/jwks", "id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}})
	})
	mux.HandleFunc("POST /token", p.token)
	return p
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// Authorize is the player at the provider: the sign-in's authorization URL consented to as `sub`; the callback's query
// (state and code). It checks what our side must send: our client, the openid scope alone, S256 PKCE, a nonce
func (p *Provider) Authorize(t *testing.T, authURL, sub string) url.Values {
	t.Helper()
	u, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Scheme+"://"+u.Host+u.Path != p.URL+"/authorize" || q.Get("client_id") != p.ClientID ||
		q.Get("response_type") != "code" || q.Get("scope") != "openid" || q.Get("code_challenge_method") != "S256" ||
		q.Get("code_challenge") == "" || q.Get("nonce") == "" || q.Get("state") == "" {
		t.Fatalf("the authorization request: %s", authURL)
	}
	code := rand.Text()
	p.mu.Lock()
	p.codes[code] = grant{sub: sub, nonce: q.Get("nonce"), challenge: q.Get("code_challenge"), redirect: q.Get("redirect_uri")}
	p.mu.Unlock()
	return url.Values{"state": {q.Get("state")}, "code": {code}}
}

func (p *Provider) token(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Exchanges++
	if err := r.ParseForm(); err != nil {
		http.Error(w, "form", http.StatusBadRequest)
		return
	}
	id, secret, ok := r.BasicAuth()
	if !ok {
		id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	g, found := p.codes[r.PostForm.Get("code")]
	delete(p.codes, r.PostForm.Get("code")) // (a code is used once)
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if id != p.ClientID || secret != p.ClientSecret || !found || r.PostForm.Get("grant_type") != "authorization_code" ||
		r.PostForm.Get("redirect_uri") != g.redirect || base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	nonce := g.nonce
	if p.Nonce != nil {
		nonce = *p.Nonce
	}
	aud := p.Audience
	if aud == nil {
		aud = []string{p.ClientID}
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: p.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	issued := time.Now().Add(-p.IssuedAgo)
	claims := map[string]any{
		"iss": p.URL, "sub": g.sub, "aud": aud, "nonce": nonce,
		"iat": issued.Unix(), "exp": issued.Add(time.Hour).Unix(),
	}
	if p.AZP != "" {
		claims["azp"] = p.AZP
	}
	raw, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"access_token": "at", "token_type": "Bearer", "expires_in": 3600, "id_token": raw})
}
