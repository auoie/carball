package steam

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// (a made-up SteamID64 and our callback)
const (
	steamID  = "76561190000000042"
	returnTo = "https://carball.example/api/auth/steam/callback?flow=abc"
)

var now = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

// memNonces keeps each nonce until the time it's given (as the store's table: forgotten after), by its clock (`now`,
// the verifier's when nil)
type memNonces struct {
	mu   sync.Mutex
	seen map[string]time.Time
	now  func() time.Time
}

func (m *memNonces) UseNonce(_ context.Context, nonce string, until time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	at := now
	if m.now != nil {
		at = m.now()
	}
	if kept, ok := m.seen[nonce]; ok && kept.After(at) {
		return false, nil
	}
	m.seen[nonce] = until
	return true, nil
}

// fakeSteam answers check_authentication: is_valid as `valid`, and records what it was asked
type fakeSteam struct {
	valid  string
	asked  url.Values
	called int
}

func (f *fakeSteam) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.asked, _ = url.ParseQuery(string(body))
	f.called++
	_, _ = fmt.Fprintf(w, "ns:http://specs.openid.net/auth/2.0\nis_valid:%s\n", f.valid)
}

func setup(t *testing.T) (*Verifier, *fakeSteam) {
	t.Helper()
	fake := &fakeSteam{valid: "true"}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	return &Verifier{
		Endpoint: srv.URL + "/openid/login",
		Client:   srv.Client(),
		Nonces:   &memNonces{seen: map[string]time.Time{}},
		Now:      func() time.Time { return now },
	}, fake
}

// assertion: a good id_res for the verifier's endpoint, then changed by `edit`
func assertion(v *Verifier, edit func(url.Values)) string {
	claimed := "https://steamcommunity.com/openid/id/" + steamID
	q := url.Values{
		"flow":                  {"abc"},
		"openid.ns":             {namespace},
		"openid.mode":           {"id_res"},
		"openid.op_endpoint":    {v.Endpoint},
		"openid.claimed_id":     {claimed},
		"openid.identity":       {claimed},
		"openid.return_to":      {returnTo},
		"openid.response_nonce": {now.Add(-time.Minute).Format("2006-01-02T15:04:05Z") + "nonce1"},
		"openid.assoc_handle":   {"1234567890"},
		"openid.signed":         {"signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle"},
		"openid.sig":            {"c2lnbmF0dXJl"},
	}
	if edit != nil {
		edit(q)
	}
	return q.Encode()
}

func TestVerifyGood(t *testing.T) {
	v, fake := setup(t)
	id, err := v.Verify(context.Background(), assertion(v, nil), returnTo)
	if err != nil || id != steamID {
		t.Fatalf("Verify = %q, %v", id, err)
	}
	// (check_authentication asked with the same parameters, the mode changed, nothing but openid.*)
	if fake.asked.Get("openid.mode") != "check_authentication" || fake.asked.Get("openid.sig") != "c2lnbmF0dXJl" ||
		fake.asked.Get("openid.claimed_id") == "" || fake.asked.Has("flow") {
		t.Errorf("check_authentication asked %v", fake.asked)
	}
}

// Each rule of notes/accounts.md §1 (AC-2), one case each: the assertion refused, Steam not even asked where the rule is
// ours to check first
func TestVerifyRules(t *testing.T) {
	cases := []struct {
		name string
		edit func(url.Values)
		want error
	}{
		{"mode not id_res", func(q url.Values) { q.Set("openid.mode", "cancel") }, ErrMode},
		{"another namespace", func(q url.Values) { q.Set("openid.ns", "http://openid.net/signon/1.1") }, ErrNamespace},
		{"op_endpoint not Steam's", func(q url.Values) { q.Set("openid.op_endpoint", "https://evil.example/openid/login") }, ErrOPEndpoint},
		{"return_to another", func(q url.Values) { q.Set("openid.return_to", returnTo+"x") }, ErrReturnTo},
		{"claimed_id not Steam's", func(q url.Values) {
			q.Set("openid.claimed_id", "https://evil.example/openid/id/"+steamID)
			q.Set("openid.identity", "https://evil.example/openid/id/"+steamID)
		}, ErrClaimedID},
		{"claimed_id over http", func(q url.Values) {
			q.Set("openid.claimed_id", "http://steamcommunity.com/openid/id/"+steamID)
			q.Set("openid.identity", "http://steamcommunity.com/openid/id/"+steamID)
		}, ErrClaimedID},
		{"claimed_id not 17 digits", func(q url.Values) {
			q.Set("openid.claimed_id", "https://steamcommunity.com/openid/id/7656119")
			q.Set("openid.identity", "https://steamcommunity.com/openid/id/7656119")
		}, ErrClaimedID},
		{"identity not claimed_id", func(q url.Values) {
			q.Set("openid.identity", "https://steamcommunity.com/openid/id/76561190000000043")
		}, ErrClaimedID},
		{"signed without claimed_id", func(q url.Values) {
			q.Set("openid.signed", "signed,op_endpoint,identity,return_to,response_nonce,assoc_handle")
		}, ErrSigned},
		{"signed without return_to", func(q url.Values) {
			q.Set("openid.signed", "signed,op_endpoint,claimed_id,identity,response_nonce,assoc_handle")
		}, ErrSigned},
		{"signed without op_endpoint", func(q url.Values) {
			q.Set("openid.signed", "signed,claimed_id,identity,return_to,response_nonce,assoc_handle")
		}, ErrSigned},
		{"signed without identity", func(q url.Values) {
			q.Set("openid.signed", "signed,op_endpoint,claimed_id,return_to,response_nonce,assoc_handle")
		}, ErrSigned},
		{"signed without response_nonce", func(q url.Values) {
			q.Set("openid.signed", "signed,op_endpoint,claimed_id,identity,return_to,assoc_handle")
		}, ErrSigned},
		{"signed without assoc_handle", func(q url.Values) {
			q.Set("openid.signed", "signed,op_endpoint,claimed_id,identity,return_to,response_nonce")
		}, ErrSigned},
		// (the claimed_id's pattern whole: anchored at both ends, 17 digits exactly)
		{"claimed_id with 18 digits", func(q url.Values) {
			q.Set("openid.claimed_id", "https://steamcommunity.com/openid/id/"+steamID+"0")
			q.Set("openid.identity", "https://steamcommunity.com/openid/id/"+steamID+"0")
		}, ErrClaimedID},
		{"claimed_id with something after", func(q url.Values) {
			q.Set("openid.claimed_id", "https://steamcommunity.com/openid/id/"+steamID+"/x")
			q.Set("openid.identity", "https://steamcommunity.com/openid/id/"+steamID+"/x")
		}, ErrClaimedID},
		{"claimed_id with something before", func(q url.Values) {
			q.Set("openid.claimed_id", "https://evil.example/?https://steamcommunity.com/openid/id/"+steamID)
			q.Set("openid.identity", "https://evil.example/?https://steamcommunity.com/openid/id/"+steamID)
		}, ErrClaimedID},
		{"nonce too old", func(q url.Values) {
			q.Set("openid.response_nonce", now.Add(-6*time.Minute).Format("2006-01-02T15:04:05Z")+"x")
		}, ErrNonce},
		{"nonce ahead", func(q url.Values) {
			q.Set("openid.response_nonce", now.Add(2*time.Minute).Format("2006-01-02T15:04:05Z")+"x")
		}, ErrNonce},
		{"nonce malformed", func(q url.Values) { q.Set("openid.response_nonce", "yesterday") }, ErrNonce},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v, fake := setup(t)
			_, err := v.Verify(context.Background(), assertion(v, c.edit), returnTo)
			if !errors.Is(err, c.want) {
				t.Fatalf("Verify: %v, want %v", err, c.want)
			}
			if fake.called != 0 {
				t.Errorf("Steam asked %d times for an assertion refused here", fake.called)
			}
		})
	}
}

func TestVerifyDuplicateParameter(t *testing.T) {
	v, fake := setup(t)
	raw := assertion(v, nil) + "&openid.claimed_id=" + url.QueryEscape("https://steamcommunity.com/openid/id/76561190000000043")
	if _, err := v.Verify(context.Background(), raw, returnTo); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("Verify: %v, want ErrDuplicate", err)
	}
	if fake.called != 0 {
		t.Error("Steam asked")
	}
}

// (Steam's answer read whole: is_valid once and true, a 200)
func TestVerifySteamAnswers(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{
		"is_valid twice": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, "ns:http://specs.openid.net/auth/2.0\nis_valid:true\nis_valid:true\n")
		},
		"a 500 saying is_valid:true": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, "is_valid:true\n")
		},
		"no is_valid": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, "ns:http://specs.openid.net/auth/2.0\n")
		},
	} {
		srv := httptest.NewServer(handler)
		v := &Verifier{Endpoint: srv.URL + "/openid/login", Client: srv.Client(), Nonces: &memNonces{seen: map[string]time.Time{}},
			Now: func() time.Time { return now }}
		if _, err := v.Verify(context.Background(), assertion(v, nil), returnTo); err == nil {
			t.Errorf("%s: accepted", name)
		}
		srv.Close()
	}
}

// (a replay costs no call to Steam: the nonce taken first, AP-18)
func TestVerifyReplayNotAsked(t *testing.T) {
	v, fake := setup(t)
	raw := assertion(v, nil)
	if _, err := v.Verify(context.Background(), raw, returnTo); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Verify(context.Background(), raw, returnTo); !errors.Is(err, ErrNonceReused) {
		t.Fatalf("the replay: %v", err)
	}
	if fake.called != 1 {
		t.Errorf("Steam asked %d times for an assertion and its replay", fake.called)
	}
}

func TestVerifySteamSaysNo(t *testing.T) {
	for _, answer := range []string{"false", "TRUE", ""} {
		v, fake := setup(t)
		fake.valid = answer
		if _, err := v.Verify(context.Background(), assertion(v, nil), returnTo); !errors.Is(err, ErrNotValid) {
			t.Errorf("is_valid:%s: %v, want ErrNotValid", answer, err)
		}
	}
}

func TestVerifyNonceReplay(t *testing.T) {
	v, _ := setup(t)
	raw := assertion(v, nil)
	if _, err := v.Verify(context.Background(), raw, returnTo); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Verify(context.Background(), raw, returnTo); !errors.Is(err, ErrNonceReused) {
		t.Fatalf("the same assertion again: %v, want ErrNonceReused", err)
	}
}

// A nonce is kept as long as its assertion could be taken (its time's window and the skew): a replay later within it is
// still refused (AP1's AC2-nonce-kept-too-short)
func TestVerifyNonceKeptForItsWindow(t *testing.T) {
	v, _ := setup(t)
	clock := now
	v.Now = func() time.Time { return clock }
	v.Nonces = &memNonces{seen: map[string]time.Time{}, now: func() time.Time { return clock }}
	raw := assertion(v, nil) // (its nonce a minute old)
	if _, err := v.Verify(context.Background(), raw, returnTo); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(NonceWindow - 2*time.Minute) // (the nonce four minutes old: still in its window)
	if _, err := v.Verify(context.Background(), raw, returnTo); !errors.Is(err, ErrNonceReused) {
		t.Fatalf("a replay within the window: %v, want ErrNonceReused", err)
	}
}

func TestLoginURL(t *testing.T) {
	u, err := url.Parse(LoginURL(Endpoint, returnTo, "https://carball.example"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Scheme+"://"+u.Host+u.Path != Endpoint || q.Get("openid.mode") != "checkid_setup" ||
		q.Get("openid.return_to") != returnTo || q.Get("openid.realm") != "https://carball.example" ||
		q.Get("openid.claimed_id") != identifierPick || q.Get("openid.identity") != identifierPick {
		t.Errorf("LoginURL = %s", u)
	}
}

func TestPersona(t *testing.T) {
	var asked url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = r.URL.Query()
		_, _ = io.WriteString(w, `{"response":{"players":[{"steamid":"`+steamID+`","personaname":"Made Up"}]}}`)
	}))
	defer srv.Close()
	n := &Names{Key: "k", Client: srv.Client(), URL: srv.URL}
	if got := n.Persona(context.Background(), steamID); got != "Made Up" || asked.Get("steamids") != steamID {
		t.Errorf("Persona = %q (asked %v)", got, asked)
	}
	if got := n.Persona(context.Background(), "76561190000000043"); got != "" {
		t.Errorf("another account's persona: %q", got)
	}
	srv.Close()
	if got := n.Persona(context.Background(), steamID); got != "" {
		t.Errorf("Steam down: %q", got)
	}
	if !strings.HasPrefix(SummariesURL, "https://") {
		t.Error("SummariesURL not https")
	}
}
