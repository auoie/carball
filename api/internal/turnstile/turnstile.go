// Package turnstile checks Cloudflare Turnstile's tokens on sign-up (notes/accounts.md §4, AC-16): siteverify says the
// token is good, issued for our hostname and for the action asked; Cloudflare refuses a token checked twice.
package turnstile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// SiteverifyURL is Cloudflare's
const SiteverifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// (Cloudflare's tokens are at most 2048 characters)
const maxToken = 2048

var (
	ErrFailed   = errors.New("turnstile: the challenge was not passed")
	ErrHostname = errors.New("turnstile: the token was issued for another hostname")
	ErrAction   = errors.New("turnstile: the token was issued for another action")
)

// Verifier checks tokens with one secret
type Verifier struct {
	Secret string
	// Hostname is the site's (PUBLIC_ORIGIN's host)
	Hostname string
	// Client makes the siteverify call (with a timeout: AC-15)
	Client *http.Client
	// URL is siteverify's (SiteverifyURL; a test's fake)
	URL string
}

// Verify checks a token the page got for action
func (v *Verifier) Verify(ctx context.Context, token, action string) error {
	if token == "" || len(token) > maxToken {
		return ErrFailed
	}
	form := url.Values{"secret": {v.Secret}, "response": {token}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.URL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := v.Client.Do(req)
	if err != nil {
		return fmt.Errorf("turnstile: siteverify: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("turnstile: siteverify: status %d", resp.StatusCode)
	}
	var body struct {
		Success  bool   `json:"success"`
		Hostname string `json:"hostname"`
		Action   string `json:"action"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<10)).Decode(&body); err != nil {
		return fmt.Errorf("turnstile: siteverify's answer: %w", err)
	}
	switch {
	case !body.Success:
		return ErrFailed
	case body.Hostname != v.Hostname:
		return ErrHostname
	case body.Action != action:
		return ErrAction
	}
	return nil
}
