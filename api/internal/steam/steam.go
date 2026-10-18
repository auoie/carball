// Package steam signs players in with Steam's OpenID 2.0 (notes/accounts.md §1, AC-2): the assertion checked rule by
// rule, each with its own test, then confirmed by Steam itself (`check_authentication`: Steam holds the association, so
// no signature is checked here); and the persona name, a sign-up's suggested name, from the Web API.
package steam

import (
	"bufio"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Endpoint is Steam's OpenID provider: where a sign-in goes, the `op_endpoint` an assertion must name, where it's checked
const Endpoint = "https://steamcommunity.com/openid/login"

const (
	namespace      = "http://specs.openid.net/auth/2.0"
	identifierPick = "http://specs.openid.net/auth/2.0/identifier_select"
	// NonceWindow: how old a `response_nonce` may be (and how long it's kept: no replay within it)
	NonceWindow = 5 * time.Minute
	// (a nonce's time a little ahead of ours is the two clocks, not an attack)
	nonceSkew = time.Minute
)

var claimed = regexp.MustCompile(`^https://steamcommunity\.com/openid/id/(\d{17})$`)

// signedFields: what `openid.signed` must cover at least
var signedFields = []string{"claimed_id", "identity", "return_to", "response_nonce", "assoc_handle", "op_endpoint"}

// Assertion failures, one per rule (the tests name them)
var (
	ErrDuplicate   = errors.New("steam: a parameter given twice")
	ErrNamespace   = errors.New("steam: not an OpenID 2.0 response")
	ErrMode        = errors.New("steam: openid.mode is not id_res")
	ErrOPEndpoint  = errors.New("steam: openid.op_endpoint is not Steam's")
	ErrReturnTo    = errors.New("steam: openid.return_to is not this sign-in's")
	ErrClaimedID   = errors.New("steam: openid.claimed_id is not a Steam identity, or not openid.identity")
	ErrSigned      = errors.New("steam: openid.signed leaves out a field it must cover")
	ErrNonce       = errors.New("steam: openid.response_nonce is malformed, too old or ahead of us")
	ErrNotValid    = errors.New("steam: check_authentication did not answer is_valid:true")
	ErrNonceReused = errors.New("steam: openid.response_nonce seen before")
)

// NonceStore remembers the nonces of the assertions taken until they're too old to pass anyway
type NonceStore interface {
	// UseNonce records the nonce until `until`; false if it was recorded already
	UseNonce(ctx context.Context, nonce string, until time.Time) (bool, error)
}

// Verifier checks Steam's assertions
type Verifier struct {
	// Endpoint is Steam's (Endpoint; a test's fake)
	Endpoint string
	// Client makes the check_authentication call (with a timeout: AC-15)
	Client *http.Client
	Nonces NonceStore
	Now    func() time.Time
}

// LoginURL is where a sign-in sends the browser: Steam picks the identity, then returns to returnTo
func LoginURL(endpoint, returnTo, realm string) string {
	q := url.Values{
		"openid.ns":         {namespace},
		"openid.mode":       {"checkid_setup"},
		"openid.return_to":  {returnTo},
		"openid.realm":      {realm},
		"openid.identity":   {identifierPick},
		"openid.claimed_id": {identifierPick},
	}
	return endpoint + "?" + q.Encode()
}

// Verify checks the callback's query (raw, so a parameter given twice is seen) against the return_to this sign-in sent,
// and returns the SteamID64
func (v *Verifier) Verify(ctx context.Context, rawQuery, returnTo string) (string, error) {
	q, err := url.ParseQuery(rawQuery)
	if err != nil {
		return "", fmt.Errorf("steam: the query: %w", err)
	}
	params := map[string]string{}
	for k, vs := range q {
		if len(vs) != 1 {
			return "", ErrDuplicate
		}
		if strings.HasPrefix(k, "openid.") {
			params[k] = vs[0]
		}
	}
	if params["openid.ns"] != namespace {
		return "", ErrNamespace
	}
	if params["openid.mode"] != "id_res" {
		return "", ErrMode
	}
	if params["openid.op_endpoint"] != v.Endpoint {
		return "", ErrOPEndpoint
	}
	if subtle.ConstantTimeCompare([]byte(params["openid.return_to"]), []byte(returnTo)) != 1 {
		return "", ErrReturnTo
	}
	m := claimed.FindStringSubmatch(params["openid.claimed_id"])
	if m == nil || params["openid.identity"] != params["openid.claimed_id"] {
		return "", ErrClaimedID
	}
	signed := map[string]bool{}
	for f := range strings.SplitSeq(params["openid.signed"], ",") {
		signed[f] = true
	}
	for _, f := range signedFields {
		if !signed[f] {
			return "", ErrSigned
		}
	}
	nonce := params["openid.response_nonce"]
	at, err := nonceTime(nonce)
	now := v.Now()
	if err != nil || at.Before(now.Add(-NonceWindow)) || at.After(now.Add(nonceSkew)) {
		return "", ErrNonce
	}
	// (the nonce taken before Steam's asked: a replay costs no call of ours, AP-18; one Steam refuses stays taken, as it
	// can't pass anyway)
	fresh, err := v.Nonces.UseNonce(ctx, nonce, at.Add(NonceWindow+nonceSkew))
	if err != nil {
		return "", err
	}
	if !fresh {
		return "", ErrNonceReused
	}
	if err := v.checkAuthentication(ctx, params); err != nil {
		return "", err
	}
	return m[1], nil
}

// nonceTime: a response_nonce starts with its time, UTC to the second ("2026-10-18T12:00:00Z…")
func nonceTime(nonce string) (time.Time, error) {
	if len(nonce) < 20 || len(nonce) > 255 {
		return time.Time{}, ErrNonce
	}
	return time.Parse("2006-01-02T15:04:05Z", nonce[:20])
}

// checkAuthentication asks Steam whether it made this assertion: the same parameters, the mode changed
func (v *Verifier) checkAuthentication(ctx context.Context, params map[string]string) error {
	form := url.Values{}
	for k, val := range params {
		form.Set(k, val)
	}
	form.Set("openid.mode", "check_authentication")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.Endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := v.Client.Do(req)
	if err != nil {
		return fmt.Errorf("steam: check_authentication: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("steam: check_authentication: status %d", resp.StatusCode)
	}
	// (key:value lines; is_valid once, "true")
	valid := 0
	lines := bufio.NewScanner(io.LimitReader(resp.Body, 4096))
	for lines.Scan() {
		key, val, _ := strings.Cut(lines.Text(), ":")
		if key == "is_valid" {
			if val != "true" {
				return ErrNotValid
			}
			valid++
		}
	}
	if lines.Err() != nil || valid != 1 {
		return ErrNotValid
	}
	return nil
}

// Names reads persona names (ISteamUser/GetPlayerSummaries)
type Names struct {
	Key    string
	Client *http.Client
	// URL is the Web API's (a test's fake)
	URL string
}

// SummariesURL is the Web API's GetPlayerSummaries
const SummariesURL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"

// Persona returns the account's persona name, or "" if it can't be had
func (n *Names) Persona(ctx context.Context, steamID string) string {
	q := url.Values{"key": {n.Key}, "steamids": {steamID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, n.URL+"?"+q.Encode(), nil)
	if err != nil {
		return ""
	}
	resp, err := n.Client.Do(req)
	if err != nil {
		return ""
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	var body struct {
		Response struct {
			Players []struct {
				SteamID     string `json:"steamid"`
				PersonaName string `json:"personaname"`
			} `json:"players"`
		} `json:"response"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&body) != nil {
		return ""
	}
	for _, p := range body.Response.Players {
		if p.SteamID == steamID {
			return p.PersonaName
		}
	}
	return ""
}
