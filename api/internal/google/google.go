// Package google signs players in with Google's OpenID Connect (notes/accounts.md §1): the authorization-code flow with
// PKCE, scope `openid` alone (no address or name ever reaches us), the ID token verified by go-oidc (signature, issuer,
// audience, expiry), then its nonce and `azp` checked here (AC-3). We keep `sub`.
package google

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Issuer is Google's
const Issuer = "https://accounts.google.com"

var (
	ErrNoIDToken = errors.New("google: the token response has no id_token")
	ErrNonce     = errors.New("google: the ID token's nonce is not this sign-in's")
	ErrAZP       = errors.New("google: the ID token's azp is not our client")
)

// Client is one OAuth client of ours at an issuer
type Client struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	// Issuer is Google's (Issuer; a test's fake)
	Issuer string
	// HTTP makes the discovery, key and token calls (with a timeout: AC-15)
	HTTP *http.Client
	// Now is the clock the discovery's failure is timed by (nil: time.Now; the tests')
	Now func() time.Time

	mu       sync.Mutex
	provider *oidc.Provider
	// (the last discovery's failure and when: others fail at once for a while, not each waiting on Google: AP-17)
	failed   error
	failedAt time.Time
}

// discoveryRetry: how long a failed discovery answers for itself before Google's asked again
const discoveryRetry = 30 * time.Second

// (the issuer's discovery document, read once it's first needed: a start-up never waits on Google; on its own context,
// not a request's, so a client leaving doesn't fail it for everyone)
func (c *Client) discover() (*oidc.Provider, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.provider != nil {
		return c.provider, nil
	}
	now := time.Now
	if c.Now != nil {
		now = c.Now
	}
	if c.failed != nil && now().Sub(c.failedAt) < discoveryRetry {
		return nil, c.failed
	}
	ctx, cancel := context.WithTimeout(oidc.ClientContext(context.Background(), c.HTTP), 10*time.Second)
	defer cancel()
	p, err := oidc.NewProvider(ctx, c.Issuer)
	if err != nil {
		c.failed, c.failedAt = fmt.Errorf("google: discovery: %w", err), now()
		return nil, c.failed
	}
	c.provider, c.failed = p, nil
	return p, nil
}

func (c *Client) config(p *oidc.Provider) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     c.ClientID,
		ClientSecret: c.ClientSecret,
		RedirectURL:  c.RedirectURL,
		Endpoint:     p.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID},
	}
}

// AuthURL is where a sign-in sends the browser, bound to this flow's state, nonce and PKCE verifier
func (c *Client) AuthURL(state, nonce, verifier string) (string, error) {
	p, err := c.discover()
	if err != nil {
		return "", err
	}
	return c.config(p).AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), nil
}

// Exchange trades the callback's code for the ID token, verifies it, and returns its subject
func (c *Client) Exchange(ctx context.Context, code, verifier, nonce string) (string, error) {
	p, err := c.discover()
	if err != nil {
		return "", err
	}
	ctx = oidc.ClientContext(ctx, c.HTTP)
	token, err := c.config(p).Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return "", fmt.Errorf("google: the code: %w", err)
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" {
		return "", ErrNoIDToken
	}
	id, err := p.Verifier(&oidc.Config{ClientID: c.ClientID}).Verify(ctx, raw)
	if err != nil {
		return "", fmt.Errorf("google: the ID token: %w", err)
	}
	if subtle.ConstantTimeCompare([]byte(id.Nonce), []byte(nonce)) != 1 {
		return "", ErrNonce
	}
	var claims struct {
		AZP string `json:"azp"`
	}
	if err := id.Claims(&claims); err != nil {
		return "", fmt.Errorf("google: the ID token's claims: %w", err)
	}
	// (azp, when given, is our client; with more audiences than ours it must be given)
	if (claims.AZP != "" || len(id.Audience) > 1) && claims.AZP != c.ClientID {
		return "", ErrAZP
	}
	if id.Subject == "" {
		return "", errors.New("google: the ID token has no subject")
	}
	return id.Subject, nil
}
