package server_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"carball/api/internal/google"
	"carball/api/internal/server"
	"carball/api/internal/steam"
	"carball/api/internal/store"
	"carball/api/internal/testdb"
	"carball/api/internal/testoidc"
	"carball/api/internal/ticket"
	"carball/api/internal/turnstile"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

// clock: the server's time, moved by the tests
type clock struct {
	mu sync.Mutex
	at time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.at
}

func (c *clock) Add(d time.Duration) {
	c.mu.Lock()
	c.at = c.at.Add(d)
	c.mu.Unlock()
}

// fakeSteam: Steam's check_authentication (is_valid for every assertion it's shown) and GetPlayerSummaries
type fakeSteam struct {
	mu     sync.Mutex
	called int
}

type env struct {
	t        *testing.T
	srv      *httptest.Server
	s        *server.Server
	db       *store.Store
	google   *testoidc.Provider
	steam    *fakeSteam
	steamURL string
	clock    *clock
	logs     *bytes.Buffer
	// owner is the database's owner's URL (the tests' look at the rows themselves)
	owner string
}

// (a made-up SteamID64)
const steamID = "76561190000000077"

// (the game server's made-up credential)
const gameToken = "game-server-token-0123456789abcdef"

func setup(t *testing.T, limits *server.Limits) *env {
	t.Helper()
	owner, app := testdb.New(t)
	ctx := context.Background()
	if err := store.Migrate(ctx, owner, "", testdb.AppRole, false); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(ctx, app, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	e := &env{t: t, db: db, owner: owner, google: testoidc.New(t, "our-client", "our-secret"), steam: &fakeSteam{},
		clock: &clock{at: time.Now().UTC().Truncate(time.Second)}, logs: &bytes.Buffer{}}

	steamSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		e.steam.mu.Lock()
		defer e.steam.mu.Unlock()
		if r.Method == http.MethodGet { // (GetPlayerSummaries)
			_, _ = io.WriteString(w, `{"response":{"players":[{"steamid":"`+steamID+`","personaname":"Made-Up Persona"}]}}`)
			return
		}
		e.steam.called++
		_, _ = io.WriteString(w, "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n")
	}))
	t.Cleanup(steamSrv.Close)
	e.steamURL = steamSrv.URL + "/openid/login"
	turnstileSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		ok := strings.HasPrefix(r.PostForm.Get("response"), "good")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": ok, "hostname": "127.0.0.1", "action": "signup"})
	}))
	t.Cleanup(turnstileSrv.Close)

	// (the tests' connections come from loopback: trusted as cloudflared, so their CF-Connecting-IP counts)
	e.s = &server.Server{Store: db, DeletionKey: bytes.Repeat([]byte("k"), 32), Now: e.clock.Now,
		TrustedProxies: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("::1/128")},
		Log:            slog.New(slog.NewTextHandler(&lockedWriter{w: e.logs}, nil)), TurnstileSiteKey: "site-key"}
	if limits != nil {
		e.s.SetLimits(*limits)
	}
	signer, err := ticket.NewSigner("test", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
	if err != nil {
		t.Fatal(err)
	}
	e.s.Tickets = signer
	e.s.TicketKeys = map[string]ed25519.PublicKey{signer.KeyID: signer.PublicKey()}
	e.s.GameServerToken = []byte(gameToken)
	e.srv = httptest.NewTLSServer(e.s.Handler())
	t.Cleanup(e.srv.Close)
	e.s.Origin = e.srv.URL
	client := &http.Client{Timeout: 5 * time.Second}
	e.s.Google = &google.Client{ClientID: "our-client", ClientSecret: "our-secret",
		RedirectURL: e.srv.URL + "/api/auth/google/callback", Issuer: e.google.URL, HTTP: client}
	e.s.Steam = &steam.Verifier{Endpoint: e.steamURL, Client: client, Nonces: db, Now: e.clock.Now}
	e.s.SteamNames = &steam.Names{Key: "k", Client: client, URL: steamSrv.URL}
	e.s.Turnstile = &turnstile.Verifier{Secret: "s", Hostname: "127.0.0.1", Client: client, URL: turnstileSrv.URL}
	return e
}

type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(b []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(b)
}

// browser: a client with its own cookies that doesn't follow redirects (the tests read where they go)
func (e *env) browser() *http.Client {
	jar, _ := cookiejar.New(nil)
	c := e.srv.Client()
	return &http.Client{Transport: c.Transport, Jar: jar, Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// reply: a response read and closed at once
type reply struct {
	StatusCode int
	Header     http.Header
	Body       []byte
}

func (e *env) do(b *http.Client, req *http.Request) reply {
	e.t.Helper()
	resp, err := b.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		e.t.Fatal(err)
	}
	return reply{StatusCode: resp.StatusCode, Header: resp.Header, Body: body}
}

func (e *env) get(b *http.Client, path string, header ...string) reply {
	e.t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, e.absolute(path), nil)
	if err != nil {
		e.t.Fatal(err)
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	return e.do(b, req)
}

func (e *env) absolute(path string) string {
	if strings.HasPrefix(path, "http") {
		return path
	}
	return e.srv.URL + path
}

// write: a guarded call as the page makes it (Origin, the custom header, JSON)
func (e *env) write(b *http.Client, method, path string, body any) reply {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		r = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, e.srv.URL+path, r)
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("Origin", e.srv.URL)
	req.Header.Set("X-Carball", "1")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return e.do(b, req)
}

// page: where a redirect sends the browser back on our page, and its query
func (e *env) page(resp reply) url.Values {
	e.t.Helper()
	if resp.StatusCode != http.StatusSeeOther {
		e.t.Fatalf("status %d, want a redirect", resp.StatusCode)
	}
	u, err := url.Parse(resp.Header.Get("Location"))
	if err != nil || u.Scheme+"://"+u.Host != e.srv.URL || u.Path != "/" {
		e.t.Fatalf("redirected to %q, not the page", resp.Header.Get("Location"))
	}
	return u.Query()
}

func decode(t *testing.T, resp reply) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(resp.Body, &v); err != nil {
		t.Fatalf("status %d, body not JSON: %v", resp.StatusCode, err)
	}
	return v
}

// googleSignIn: start, consent as sub, the callback; the page's query
func (e *env) googleSignIn(b *http.Client, sub string) url.Values {
	e.t.Helper()
	start := e.get(b, "/api/auth/google/start")
	if start.StatusCode != http.StatusSeeOther {
		e.t.Fatalf("start: %d", start.StatusCode)
	}
	q := e.google.Authorize(e.t, start.Header.Get("Location"), sub)
	return e.page(e.get(b, "/api/auth/google/callback?"+q.Encode()))
}

// steamAssertion: Steam's answer for the flow a start sent the browser to (return_to read off the login URL)
func (e *env) steamAssertion(loginURL string, nonce string) string {
	e.t.Helper()
	u, err := url.Parse(loginURL)
	if err != nil {
		e.t.Fatal(err)
	}
	returnTo := u.Query().Get("openid.return_to")
	claimed := "https://steamcommunity.com/openid/id/" + steamID
	q := url.Values{
		"openid.ns": {"http://specs.openid.net/auth/2.0"}, "openid.mode": {"id_res"},
		"openid.op_endpoint": {e.steamURL}, "openid.claimed_id": {claimed}, "openid.identity": {claimed},
		"openid.return_to": {returnTo}, "openid.assoc_handle": {"1"},
		"openid.response_nonce": {e.clock.Now().Format("2006-01-02T15:04:05Z") + nonce},
		"openid.signed":         {"signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle"},
		"openid.sig":            {"c2ln"},
	}
	return returnTo + "&" + q.Encode()
}

// signUp: a pending sign-up finished with a name and a good Turnstile token; the account
func (e *env) signUp(b *http.Client, name string) map[string]any {
	e.t.Helper()
	resp := e.write(b, http.MethodPost, "/api/signup", map[string]string{"name": name, "turnstile": "good-token"})
	if resp.StatusCode != http.StatusCreated {
		e.t.Fatalf("sign-up: %d %v", resp.StatusCode, decode(e.t, resp))
	}
	return decode(e.t, resp)
}

func (e *env) meStatus(b *http.Client) int {
	e.t.Helper()
	return e.get(b, "/api/me").StatusCode
}

func TestGoogleSignUpThenSignIn(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	if q := e.googleSignIn(b, "sub-1"); !q.Has("signup") {
		t.Fatalf("a new identity: %v, want the sign-up", q)
	}
	info := decode(t, e.get(b, "/api/signup"))
	if !regexp.MustCompile(`^Player [1-9]\d{3}$`).MatchString(info["suggestion"].(string)) || info["provider"] != "google" ||
		info["turnstileSiteKey"] != "site-key" {
		t.Errorf("the sign-up's info: %v", info)
	}
	account := e.signUp(b, "  Made  Up  ")
	if account["name"] != "Made Up" || fmt.Sprint(account["providers"]) != "[google]" {
		t.Errorf("the account: %v", account)
	}
	me := decode(t, e.get(b, "/api/me"))
	if me["id"] != account["id"] {
		t.Errorf("/api/me: %v", me)
	}
	// (signed out; signed in again: straight to the account)
	if resp := e.write(b, http.MethodPost, "/api/signout", nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("sign-out: %d", resp.StatusCode)
	}
	if e.meStatus(b) != http.StatusUnauthorized {
		t.Fatal("still signed in after signing out")
	}
	if q := e.googleSignIn(b, "sub-1"); len(q) != 0 {
		t.Fatalf("a known identity: %v, want the page", q)
	}
	if me := decode(t, e.get(b, "/api/me")); me["id"] != account["id"] {
		t.Errorf("signed in to %v", me)
	}
}

func TestSteamSignUp(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	start := e.get(b, "/api/auth/steam/start")
	login := start.Header.Get("Location")
	if !strings.HasPrefix(login, e.steamURL+"?") {
		t.Fatalf("start went to %q", login)
	}
	if q := e.page(e.get(b, e.steamAssertion(login, "n1"))); !q.Has("signup") {
		t.Fatalf("callback: %v", q)
	}
	if info := decode(t, e.get(b, "/api/signup")); info["suggestion"] != "Made-Up Persona" || info["provider"] != "steam" {
		t.Errorf("the sign-up's info: %v", info)
	}
	if account := e.signUp(b, "Made-Up Persona"); fmt.Sprint(account["providers"]) != "[steam]" {
		t.Errorf("the account: %v", account)
	}
}

// AC-1: a callback counts only in the browser that started its flow, once
func TestCallbacksBoundToTheBrowser(t *testing.T) {
	e := setup(t, nil)
	victim, attacker := e.browser(), e.browser()
	// (the attacker's own Google consent, its callback URL sent to the victim)
	start := e.get(attacker, "/api/auth/google/start")
	q := e.google.Authorize(t, start.Header.Get("Location"), "attacker-sub")
	if got := e.page(e.get(victim, "/api/auth/google/callback?"+q.Encode())); got.Get("signin") != "failed" {
		t.Errorf("another browser's Google callback: %v", got)
	}
	if e.google.Exchanges != 0 {
		t.Errorf("the code exchanged (%d) for a browser that didn't start the flow", e.google.Exchanges)
	}
	// (the right browser, the wrong state: refused, and the flow gone with it)
	q2 := url.Values{"state": {"not-the-state"}, "code": {q.Get("code")}}
	if got := e.page(e.get(attacker, "/api/auth/google/callback?"+q2.Encode())); got.Get("signin") != "failed" {
		t.Errorf("a wrong state: %v", got)
	}
	if got := e.page(e.get(attacker, "/api/auth/google/callback?"+q.Encode())); got.Get("signin") != "failed" {
		t.Errorf("a flow used twice: %v", got)
	}
	// (Steam: another browser's assertion; Steam not even asked)
	login := e.get(attacker, "/api/auth/steam/start").Header.Get("Location")
	if got := e.page(e.get(victim, e.steamAssertion(login, "n2"))); got.Get("signin") != "failed" {
		t.Errorf("another browser's Steam callback: %v", got)
	}
	// (the right browser started a second flow since (its cookie that one's): the first flow's assertion refused)
	e.get(attacker, "/api/auth/steam/start")
	if got := e.page(e.get(attacker, e.steamAssertion(login, "n3"))); got.Get("signin") != "failed" {
		t.Errorf("an assertion for another flow: %v", got)
	}
	// (the right browser, its own Steam flow, the assertion's return_to right but the callback's flow another: refused
	// (AP1's AC1-steam-flow-unchecked))
	login = e.get(attacker, "/api/auth/steam/start").Header.Get("Location")
	if got := e.page(e.get(attacker, strings.Replace(e.steamAssertion(login, "n4"), "?flow=", "?flow=other&was=", 1))); got.Get("signin") != "failed" {
		t.Errorf("a callback's flow not its cookie's: %v", got)
	}
	// (a Google flow's state at Steam's callback, its return_to made for it: the flow's provider checked (AP1's
	// AC1-flow-provider-unchecked))
	googleStart, err := url.Parse(e.get(attacker, "/api/auth/google/start").Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	state := googleStart.Query().Get("state")
	forged := "https://steam.example/login?openid.return_to=" + url.QueryEscape(e.srv.URL+"/api/auth/steam/callback?flow="+state)
	if got := e.page(e.get(attacker, e.steamAssertion(forged, "n5"))); got.Get("signin") != "failed" {
		t.Errorf("a Google flow at Steam's callback: %v", got)
	}
	if e.steam.called != 0 {
		t.Errorf("Steam asked %d times for callbacks refused here", e.steam.called)
	}
	if e.meStatus(victim) != http.StatusUnauthorized || e.meStatus(attacker) != http.StatusUnauthorized {
		t.Error("someone signed in")
	}
}

// AC-7: every write proves it's the page's own
func TestWritesGuarded(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	call := func(edit func(*http.Request)) int {
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, e.srv.URL+"/api/signout", strings.NewReader("{}"))
		req.Header.Set("Origin", e.srv.URL)
		req.Header.Set("X-Carball", "1")
		req.Header.Set("Content-Type", "application/json")
		edit(req)
		return e.do(b, req).StatusCode
	}
	for name, c := range map[string]struct {
		edit func(*http.Request)
		want int
	}{
		"as the page":        {func(*http.Request) {}, http.StatusNoContent},
		"no Origin":          {func(r *http.Request) { r.Header.Del("Origin") }, http.StatusForbidden},
		"a sibling's Origin": {func(r *http.Request) { r.Header.Set("Origin", "https://other.example") }, http.StatusForbidden},
		"no custom header":   {func(r *http.Request) { r.Header.Del("X-Carball") }, http.StatusForbidden},
		"a form's body":      {func(r *http.Request) { r.Header.Set("Content-Type", "application/x-www-form-urlencoded") }, http.StatusUnsupportedMediaType},
		"text":               {func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }, http.StatusUnsupportedMediaType},
	} {
		if got := call(c.edit); got != c.want {
			t.Errorf("%s: %d, want %d", name, got, c.want)
		}
	}
}

func TestSessionRotation(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-r")
	e.signUp(b, "Rotating")
	u, _ := url.Parse(e.srv.URL)
	first := sessionToken(b, u)
	with := func(token string) int {
		c := &http.Client{Transport: b.Transport, Timeout: 5 * time.Second}
		return e.get(c, "/api/me", "Cookie", "__Host-cb_session="+token).StatusCode
	}
	// (a day later: a new token set, the old one honoured for 10 minutes)
	e.clock.Add(25 * time.Hour)
	resp := e.get(b, "/api/me")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("a day later: %d", resp.StatusCode)
	}
	second := sessionToken(b, u)
	if second == first {
		t.Fatal("no rotation after a day")
	}
	if with(first) != http.StatusOK {
		t.Error("the old token refused within its grace")
	}
	e.clock.Add(11 * time.Minute)
	if with(first) != http.StatusUnauthorized {
		t.Error("the old token accepted after its grace")
	}
	if with(second) != http.StatusOK {
		t.Error("the new token refused")
	}
	// (90 days from the sign-in: over, whatever the rotations)
	e.clock.Add(90 * 24 * time.Hour)
	if e.meStatus(b) != http.StatusUnauthorized {
		t.Error("a session past its absolute lifetime")
	}
}

func TestDeleteBlocksRecreating(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-d")
	e.signUp(b, "Deleted")
	if resp := e.write(b, http.MethodDelete, "/api/me", map[string]bool{"confirm": false}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a delete not confirmed: %d", resp.StatusCode)
	}
	if resp := e.write(b, http.MethodDelete, "/api/me", map[string]bool{"confirm": true}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	if e.meStatus(b) != http.StatusUnauthorized {
		t.Fatal("signed in after deleting")
	}
	q := e.googleSignIn(b, "sub-d")
	want := e.clock.Now().Add(server.RecreateBlock).UTC().Format(time.DateOnly)
	if q.Get("signin") != "blocked" || q.Get("until") != want {
		t.Errorf("signing in again at once: %v, want blocked until %s", q, want)
	}
	e.clock.Add(server.RecreateBlock + time.Minute)
	if q := e.googleSignIn(b, "sub-d"); !q.Has("signup") {
		t.Errorf("after the block: %v, want a sign-up", q)
	}
}

func TestBannedIdentity(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-b")
	account := e.signUp(b, "Banned")
	u, _ := url.Parse(e.srv.URL)
	old := sessionToken(b, u)
	until := e.clock.Now().Add(72 * time.Hour)
	if _, err := e.db.BanAccount(context.Background(), account["id"].(string), "abuse", "admin", store.Until{At: until}, e.clock.Now()); err != nil {
		t.Fatal(err)
	}
	if e.meStatus(b) != http.StatusUnauthorized {
		t.Error("a banned account still signed in")
	}
	if q := e.googleSignIn(b, "sub-b"); q.Get("signin") != "banned" || q.Get("until") != until.UTC().Format(time.DateOnly) {
		t.Errorf("a banned identity's sign-in: %v", q)
	}
	e.clock.Add(73 * time.Hour)
	// (the ban over: the sessions it ended stay ended, the old token too (AP1's AC8-ban-keeps-sessions))
	c := &http.Client{Transport: b.Transport, Timeout: 5 * time.Second}
	if e.get(c, "/api/me", "Cookie", "__Host-cb_session="+old).StatusCode != http.StatusUnauthorized {
		t.Error("the ban's end brought its account's old session back")
	}
	if q := e.googleSignIn(b, "sub-b"); len(q) != 0 {
		t.Errorf("after the ban: %v", q)
	}
}

func TestSignUpRefusals(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-x")
	refused := func(body map[string]string, status int, code string) {
		t.Helper()
		resp := e.write(b, http.MethodPost, "/api/signup", body)
		if v := decode(t, resp); resp.StatusCode != status || v["error"] != code {
			t.Errorf("%v: %d %v, want %d %s", body, resp.StatusCode, v, status, code)
		}
	}
	refused(map[string]string{"name": strings.Repeat("n", 33), "turnstile": "good"}, http.StatusBadRequest, "name-too-long")
	refused(map[string]string{"name": "\u200B\u3164", "turnstile": "good"}, http.StatusBadRequest, "name-empty")
	refused(map[string]string{"name": "Fine", "turnstile": "bad"}, http.StatusForbidden, "turnstile")
	refused(map[string]string{"name": "Fine", "turnstile": "good", "extra": "x"}, http.StatusBadRequest, "bad-request")
	e.clock.Add(server.SignupTTL + time.Second)
	refused(map[string]string{"name": "Fine", "turnstile": "good"}, http.StatusNotFound, "no-signup")
	if resp := e.get(b, "/api/signup"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("an expired sign-up's info: %d", resp.StatusCode)
	}
}

func TestRateLimits(t *testing.T) {
	limits := server.DefaultLimits()
	limits.SignIns.Burst = 2
	limits.Renames.Burst = 1
	e := setup(t, &limits)
	b := e.browser()
	for i := range 2 {
		if resp := e.get(b, "/api/auth/steam/start", "CF-Connecting-IP", "2001:db8:5:6::1"); resp.StatusCode != http.StatusSeeOther ||
			strings.Contains(resp.Header.Get("Location"), "busy") {
			t.Fatalf("start %d refused", i+1)
		}
	}
	// (the same /64: refused; another address: fine)
	if q := e.page(e.get(b, "/api/auth/steam/start", "CF-Connecting-IP", "2001:db8:5:6::2")); q.Get("signin") != "busy" {
		t.Errorf("a third start from the /64: %v", q)
	}
	if resp := e.get(b, "/api/auth/steam/start", "CF-Connecting-IP", "203.0.113.9"); strings.Contains(resp.Header.Get("Location"), "busy") {
		t.Error("another address refused")
	}
	// (renames: one, then refused)
	b2 := e.browser()
	e.googleSignIn(b2, "sub-n")
	e.signUp(b2, "Name")
	if resp := e.write(b2, http.MethodPut, "/api/me/name", map[string]string{"name": "Renamed"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("a rename: %d", resp.StatusCode)
	}
	if resp := e.write(b2, http.MethodPut, "/api/me/name", map[string]string{"name": "Again"}); resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("a second rename: %d", resp.StatusCode)
	}
}

func TestSignOutEverywhere(t *testing.T) {
	e := setup(t, nil)
	laptop, phone := e.browser(), e.browser()
	e.googleSignIn(laptop, "sub-e")
	e.signUp(laptop, "Everywhere")
	e.googleSignIn(phone, "sub-e")
	if e.meStatus(phone) != http.StatusOK {
		t.Fatal("the second browser not signed in")
	}
	if resp := e.write(laptop, http.MethodPost, "/api/signout-everywhere", nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("sign out everywhere: %d", resp.StatusCode)
	}
	if e.meStatus(laptop) != http.StatusUnauthorized || e.meStatus(phone) != http.StatusUnauthorized {
		t.Error("a browser still signed in")
	}
}

// AC-15: the access log has neither the query (a callback's code) nor the address
func TestLogsKeepNoQueryOrAddress(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	start := e.get(b, "/api/auth/google/start", "CF-Connecting-IP", "198.51.100.23")
	q := e.google.Authorize(t, start.Header.Get("Location"), "sub-l")
	e.get(b, "/api/auth/google/callback?"+q.Encode(), "CF-Connecting-IP", "198.51.100.23")
	logs := e.logs.String()
	if !strings.Contains(logs, "path=/api/auth/google/callback") {
		t.Fatalf("no request logged: %s", logs)
	}
	for _, secret := range []string{q.Get("code"), q.Get("state"), "198.51.100.23", "127.0.0.1"} {
		if strings.Contains(logs, secret) {
			t.Errorf("the log holds %q:\n%s", secret, logs)
		}
	}
}

// A CF-Connecting-IP from a peer outside TRUSTED_PROXIES (the tunnel's connector left out): warned of once for each kind
// of peer, never its address; from the trusted peer, nothing
func TestUntrustedForwardWarned(t *testing.T) {
	e := setup(t, nil)
	h := e.s.Handler()
	call := func(remote string) {
		r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/me", nil)
		r.RemoteAddr = remote
		r.Header.Set("CF-Connecting-IP", "203.0.113.50")
		h.ServeHTTP(httptest.NewRecorder(), r)
	}
	call("127.0.0.1:5000")
	call("172.18.0.9:5000")
	call("172.18.0.10:5000")
	call("198.51.100.9:5000")
	logs := e.logs.String()
	if n := strings.Count(logs, "outside TRUSTED_PROXIES"); n != 2 {
		t.Errorf("%d warnings, want 2 (private once, public once): %s", n, logs)
	}
	if !strings.Contains(logs, "peer=private") || !strings.Contains(logs, "peer=public") {
		t.Errorf("the peers' kinds not named: %s", logs)
	}
	for _, addr := range []string{"172.18.0.9", "198.51.100.9", "203.0.113.50"} {
		if strings.Contains(logs, addr) {
			t.Errorf("an address in the log: %s", addr)
		}
	}
}

func TestHealthAndHeaders(t *testing.T) {
	e := setup(t, nil)
	// (the health check on its own handler, the loopback listener's; not under /api/: AP-6)
	rec := httptest.NewRecorder()
	e.s.HealthHandler().ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "ok\n" {
		t.Errorf("healthz: %d %q", rec.Code, rec.Body.String())
	}
	if resp := e.get(e.browser(), "/api/healthz"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("/api/healthz through the tunnel: %d", resp.StatusCode)
	}
	resp := e.get(e.browser(), "/api/me")
	for k, v := range map[string]string{"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"} {
		if resp.Header.Get(k) != v {
			t.Errorf("%s: %q", k, resp.Header.Get(k))
		}
	}
}

// sessionToken is the browser's session cookie's value (by its name: AP-11)
func sessionToken(b *http.Client, u *url.URL) string {
	for _, c := range b.Jar.Cookies(u) {
		if c.Name == "__Host-cb_session" {
			return c.Value
		}
	}
	return ""
}

// rows: a count from the database as its owner sees it
func (e *env) rows(query string, args ...any) int {
	e.t.Helper()
	conn, err := pgx.Connect(context.Background(), e.owner)
	if err != nil {
		e.t.Fatal(err)
	}
	defer func() { _ = conn.Close(context.Background()) }()
	var n int
	if err := conn.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// cookieAttrs: a Set-Cookie of `name` in a reply, and whether it's __Host-'s (Secure, HttpOnly, Lax, Path=/, no Domain)
// with this Max-Age
func cookieAttrs(t *testing.T, resp reply, name string, maxAge int) {
	t.Helper()
	for _, c := range resp.Header.Values("Set-Cookie") {
		if !strings.HasPrefix(c, name+"=") {
			continue
		}
		for _, part := range []string{"Path=/", "HttpOnly", "Secure", "SameSite=Lax", fmt.Sprintf("Max-Age=%d", maxAge)} {
			if !strings.Contains(c, part) {
				t.Errorf("%s lacks %s: %q", name, part, c)
			}
		}
		if strings.Contains(strings.ToLower(c), "domain=") {
			t.Errorf("%s names a domain: %q", name, c)
		}
		return
	}
	t.Errorf("no %s set", name)
}

// The cookies: each __Host-'s, the pre-auth one living FlowTTL, the sign-up's SignupTTL, the session's SessionTTL; the
// pre-auth one cleared by its callback; only a token's hash kept (AP-11)
func TestCookiesAndTokens(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	start := e.get(b, "/api/auth/google/start")
	cookieAttrs(t, start, "__Host-cb_auth", int(server.FlowTTL.Seconds()))
	q := e.google.Authorize(t, start.Header.Get("Location"), "sub-c")
	callback := e.get(b, "/api/auth/google/callback?"+q.Encode())
	cookieAttrs(t, callback, "__Host-cb_signup", int(server.SignupTTL.Seconds()))
	u, _ := url.Parse(e.srv.URL)
	for _, c := range b.Jar.Cookies(u) {
		if c.Name == "__Host-cb_auth" {
			t.Error("the pre-auth cookie outlived its callback")
		}
	}
	resp := e.write(b, http.MethodPost, "/api/signup", map[string]string{"name": "Cookie", "turnstile": "good-token"})
	cookieAttrs(t, resp, "__Host-cb_session", int(server.SessionTTL.Seconds()))
	tok := sessionToken(b, u)
	sum := sha256.Sum256([]byte(tok))
	if e.rows("SELECT count(*) FROM sessions WHERE token_hash = $1", []byte(tok)) != 0 ||
		e.rows("SELECT count(*) FROM sessions WHERE token_hash = $1", sum[:]) != 1 {
		t.Error("the session's token kept as it is, or its hash not kept")
	}
}

// A flow lives FlowTTL: its callback after it fails, Google never asked (AP-11)
func TestFlowExpires(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	start := e.get(b, "/api/auth/google/start")
	q := e.google.Authorize(t, start.Header.Get("Location"), "sub-x")
	e.clock.Add(server.FlowTTL + time.Second)
	if got := e.page(e.get(b, "/api/auth/google/callback?"+q.Encode())); got.Get("signin") != "failed" {
		t.Errorf("a callback after the flow's end: %v", got)
	}
	if e.google.Exchanges != 0 {
		t.Error("an expired flow's code exchanged")
	}
}

// Signing out deletes the session itself (its token refused after, not just the cookie dropped); a new sign-in in the
// same browser ends the session it had (AP-11)
func TestSessionsEnd(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	u, _ := url.Parse(e.srv.URL)
	e.googleSignIn(b, "sub-o")
	e.signUp(b, "Out")
	with := func(token string) int {
		c := &http.Client{Transport: b.Transport, Timeout: 5 * time.Second}
		return e.get(c, "/api/me", "Cookie", "__Host-cb_session="+token).StatusCode
	}
	first := sessionToken(b, u)
	e.googleSignIn(b, "sub-o")
	second := sessionToken(b, u)
	if second == first || with(first) != http.StatusUnauthorized || with(second) != http.StatusOK {
		t.Error("a new sign-in kept the browser's old session")
	}
	if resp := e.write(b, http.MethodPost, "/api/signout", nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("sign-out: %d", resp.StatusCode)
	}
	if with(second) != http.StatusUnauthorized {
		t.Error("the signed-out session's token still opens it")
	}
}

// The delete/re-create rule's record is keyed (AP-24, AP-11): not the identity's plain hash, and another key's differs
func TestDeletionRecordKeyed(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-k")
	e.signUp(b, "Keyed")
	if resp := e.write(b, http.MethodDelete, "/api/me", map[string]bool{"confirm": true}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	plain := sha256.Sum256([]byte("google:sub-k"))
	m := hmac.New(sha256.New, bytes.Repeat([]byte("k"), 32))
	_, _ = m.Write([]byte("google:sub-k"))
	if e.rows("SELECT count(*) FROM deletions WHERE subject_hmac = $1", plain[:]) != 0 ||
		e.rows("SELECT count(*) FROM deletions WHERE subject_hmac = $1", m.Sum(nil)) != 1 {
		t.Error("the deletion's record not the identity's keyed hash")
	}
}

// Every write guarded (AC-7, AP-9): each route refuses a call without the page's Origin, its header, or JSON; a body past
// 16 KiB; a JSON value with anything after it
func TestEveryWriteGuarded(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-w")
	e.signUp(b, "Writes")
	call := func(method, path, body string, edit func(*http.Request)) int {
		req, _ := http.NewRequestWithContext(context.Background(), method, e.srv.URL+path, strings.NewReader(body))
		req.Header.Set("Origin", e.srv.URL)
		req.Header.Set("X-Carball", "1")
		req.Header.Set("Content-Type", "application/json")
		edit(req)
		return e.do(b, req).StatusCode
	}
	routes := [][2]string{
		{http.MethodPost, "/api/signup"}, {http.MethodPut, "/api/me/name"}, {http.MethodDelete, "/api/me"},
		{http.MethodPost, "/api/signout"}, {http.MethodPost, "/api/signout-everywhere"}, {http.MethodPost, "/api/ticket"},
	}
	for _, r := range routes {
		for name, c := range map[string]struct {
			body string
			edit func(*http.Request)
			want int
		}{
			"no Origin":          {"{}", func(r *http.Request) { r.Header.Del("Origin") }, http.StatusForbidden},
			"a sibling's Origin": {"{}", func(r *http.Request) { r.Header.Set("Origin", "https://other.example") }, http.StatusForbidden},
			"no custom header":   {"{}", func(r *http.Request) { r.Header.Del("X-Carball") }, http.StatusForbidden},
			"a form's body":      {"a=b", func(r *http.Request) { r.Header.Set("Content-Type", "application/x-www-form-urlencoded") }, http.StatusUnsupportedMediaType},
			"17 KiB":             {`{"name":"` + strings.Repeat("x", 17<<10) + `"}`, func(*http.Request) {}, http.StatusRequestEntityTooLarge},
		} {
			if got := call(r[0], r[1], c.body, c.edit); got != c.want {
				t.Errorf("%s %s, %s: %d, want %d", r[0], r[1], name, got, c.want)
			}
		}
	}
	// (one JSON value and nothing after: a stray brace, a second value, AP-16)
	for _, body := range []string{`{"name":"A"}}`, `{"name":"A"} {"name":"B"}`} {
		if got := call(http.MethodPut, "/api/me/name", body, func(*http.Request) {}); got != http.StatusBadRequest {
			t.Errorf("rename with %q: %d", body, got)
		}
	}
}

// A rename passes the name rules too (AC-14, AP-10)
func TestRenameChecksTheName(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-r2")
	e.signUp(b, "Before")
	for body, code := range map[string]string{"\u200B\u202E": "name-empty", strings.Repeat("n", 33): "name-too-long"} {
		resp := e.write(b, http.MethodPut, "/api/me/name", map[string]string{"name": body})
		if v := decode(t, resp); resp.StatusCode != http.StatusBadRequest || v["error"] != code {
			t.Errorf("rename to %q: %d %v", body, resp.StatusCode, v)
		}
	}
	resp := e.write(b, http.MethodPut, "/api/me/name", map[string]string{"name": "A\u202Eb"})
	if v := decode(t, resp); resp.StatusCode != http.StatusOK || v["name"] != "Ab" {
		t.Errorf("rename with a bidi control: %d %v", resp.StatusCode, v)
	}
}

// The callbacks' and the sign-up's address limits, and the ceilings on open flows (AP-2, AP-11)
func TestCallbackSignupLimitsAndCeilings(t *testing.T) {
	limits := server.DefaultLimits()
	limits.SignIns.Burst = 2
	limits.Signups.Burst = 1
	limits.OpenFlows = 3
	e := setup(t, &limits)
	b := e.browser()
	ip := []string{"CF-Connecting-IP", "198.51.100.40"}
	// (a start and its callback: two; a third request from the address, a callback, refused)
	start := e.get(b, "/api/auth/google/start", ip...)
	q := e.google.Authorize(t, start.Header.Get("Location"), "sub-l")
	e.get(b, "/api/auth/google/callback?"+q.Encode(), ip...)
	if got := e.page(e.get(b, "/api/auth/steam/callback?flow=x", ip...)); got.Get("signin") != "busy" {
		t.Errorf("a callback past the limit: %v", got)
	}
	// (the sign-up: one, then refused from the address)
	call := func() int {
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, e.srv.URL+"/api/signup", strings.NewReader(`{"name":"N","turnstile":"good"}`))
		req.Header.Set("Origin", e.srv.URL)
		req.Header.Set("X-Carball", "1")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("CF-Connecting-IP", "198.51.100.41")
		return e.do(b, req).StatusCode
	}
	call()
	if got := call(); got != http.StatusTooManyRequests {
		t.Errorf("a second sign-up from the address: %d", got)
	}
	// (everyone's open flows at most 3: from fresh addresses, the 4th start refused)
	busy := 0
	for i := range 4 {
		resp := e.get(e.browser(), "/api/auth/steam/start", "CF-Connecting-IP", fmt.Sprintf("203.0.113.%d", 10+i))
		if strings.Contains(resp.Header.Get("Location"), "signin=busy") {
			busy++
		}
	}
	if busy != 1 {
		t.Errorf("%d starts refused past the open flows' ceiling, want 1 (one flow open already)", busy)
	}
}

// The wide limits: a block's addresses share their network's (/24, /48) count, so fresh addresses can't each take a
// new one past it (AP-2)
func TestWideLimits(t *testing.T) {
	limits := server.DefaultLimits()
	limits.SignIns.Burst = 100
	limits.SignInsWide.Burst = 2
	e := setup(t, &limits)
	start := func(ip string) bool {
		return !strings.Contains(e.get(e.browser(), "/api/auth/steam/start", "CF-Connecting-IP", ip).Header.Get("Location"), "signin=busy")
	}
	if !start("198.51.100.1") || !start("198.51.100.2") {
		t.Fatal("the first two of a /24 refused")
	}
	if start("198.51.100.3") {
		t.Error("a third address of the same /24 past its wide limit")
	}
	if !start("198.51.101.3") {
		t.Error("another /24 refused")
	}
}

// The sign-ups' ceiling: everyone's waiting sign-ups at most OpenSignups, a new identity's sign-in refused past it
func TestSignupCeiling(t *testing.T) {
	limits := server.DefaultLimits()
	limits.OpenSignups = 1
	e := setup(t, &limits)
	if q := e.googleSignIn(e.browser(), "sub-c1"); !q.Has("signup") {
		t.Fatalf("the first sign-up: %v", q)
	}
	if q := e.googleSignIn(e.browser(), "sub-c2"); q.Get("signin") != "busy" {
		t.Errorf("a second sign-up past the ceiling: %v", q)
	}
}

// The database not answering: 503, never taken for signed out (AP-22)
func TestDatabaseDown(t *testing.T) {
	e := setup(t, nil)
	b := e.browser()
	e.googleSignIn(b, "sub-d2")
	e.signUp(b, "Down")
	e.db.Close()
	resp := e.get(b, "/api/me")
	if v := decode(t, resp); resp.StatusCode != http.StatusServiceUnavailable || v["error"] != "unavailable" {
		t.Errorf("/api/me with the database closed: %d %v", resp.StatusCode, v)
	}
}

// The search ticket (AC-6): for a signed-in account only, its id and name in it, signed with the service's key, two
// minutes long; a few a minute per account; none without a key
func TestTicket(t *testing.T) {
	limits := server.DefaultLimits()
	limits.Tickets.Burst = 2
	e := setup(t, &limits)
	b := e.browser()
	if resp := e.write(b, http.MethodPost, "/api/ticket", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("signed out: %d", resp.StatusCode)
	}
	e.googleSignIn(b, "sub-t")
	account := e.signUp(b, "Ticketed")
	resp := e.write(b, http.MethodPost, "/api/ticket", nil)
	v := decode(t, resp)
	encoded, _ := v["ticket"].(string)
	if resp.StatusCode != http.StatusOK || encoded == "" {
		t.Fatalf("a ticket: %d %v", resp.StatusCode, v)
	}
	kid, b64, _ := strings.Cut(e.s.Tickets.Public(), " ")
	pub, _ := base64.StdEncoding.DecodeString(b64)
	got, err := ticket.Verify(encoded, map[string]ed25519.PublicKey{kid: pub}, e.clock.Now(), 0)
	if err != nil || got.Name != "Ticketed" || !got.Expires.Equal(e.clock.Now().Add(ticket.Lifetime)) {
		t.Fatalf("Verify = %+v, %v", got, err)
	}
	id := strings.ReplaceAll(account["id"].(string), "-", "")
	if hex.EncodeToString(got.Account[:]) != id {
		t.Errorf("the ticket's account %x, the account %s", got.Account, id)
	}
	if got.Purpose != ticket.PurposeSearch || got.Match != 0 {
		t.Errorf("a search's ticket: purpose %d, match %d", got.Purpose, got.Match)
	}
	// (a rejoin's: for its match)
	resp = e.write(b, http.MethodPost, "/api/ticket?rejoin=0123456789abcdef", nil)
	rejoin, _ := decode(t, resp)["ticket"].(string)
	if got, err := ticket.Verify(rejoin, map[string]ed25519.PublicKey{kid: pub}, e.clock.Now(), 0); err != nil ||
		got.Purpose != ticket.PurposeRejoin || got.Match != 0x0123456789abcdef {
		t.Errorf("a rejoin's ticket: %+v, %v", got, err)
	}
	if resp := e.write(b, http.MethodPost, "/api/ticket", nil); resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("a third ticket at once: %d", resp.StatusCode)
	}
	e.s.Tickets = nil
	e.clock.Add(time.Hour)
	if resp := e.write(b, http.MethodPost, "/api/ticket", nil); resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("no key: %d", resp.StatusCode)
	}
}

// gameCall: the game server's call (its bearer token: `token`), JSON
func (e *env) gameCall(method, path, token string, body any) reply {
	e.t.Helper()
	var buf []byte
	if body != nil {
		var err error
		if buf, err = json.Marshal(body); err != nil {
			e.t.Fatal(err)
		}
	}
	req, err := http.NewRequestWithContext(context.Background(), method, e.srv.URL+path, bytes.NewReader(buf))
	if err != nil {
		e.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return e.do(e.browser(), req)
}

// player: a new account signed in on its own browser, and a search ticket of its
func (e *env) player(sub string) (b *http.Client, id, encoded string) {
	e.t.Helper()
	b = e.browser()
	e.googleSignIn(b, sub)
	account := e.signUp(b, "P "+sub)
	resp := e.write(b, http.MethodPost, "/api/ticket", nil)
	encoded, _ = decode(e.t, resp)["ticket"].(string)
	if encoded == "" {
		e.t.Fatalf("%s's ticket: %d", sub, resp.StatusCode)
	}
	return b, account["id"].(string), encoded
}

// rating: an account's rating in a playlist as /api/me shows it
func (e *env) rating(b *http.Client, playlist int) map[string]any {
	e.t.Helper()
	for _, r := range decode(e.t, e.get(b, "/api/me"))["ratings"].([]any) {
		if m := r.(map[string]any); int(m["playlist"].(float64)) == playlist {
			return m
		}
	}
	e.t.Fatalf("no rating for playlist %d", playlist)
	return nil
}

// A match's result from the game server: its credential checked, each ticket ours and counted once, the result recorded
// once, the winners up (a quitter too) and the losers down
func TestResults(t *testing.T) {
	e := setup(t, nil)
	ba, _, ta := e.player("sub-ra")
	bb, _, tb := e.player("sub-rb")
	if got := e.rating(ba, 1); got["rating"].(float64) != 1500 || got["provisional"] != true || got["games"].(float64) != 0 {
		t.Errorf("a new account's rating: %v", got)
	}
	result := func(match string, tickets ...string) map[string]any {
		players := []map[string]any{}
		for i, tk := range tickets {
			players = append(players, map[string]any{"ticket": tk, "team": i % 2, "quitter": i == 1, "seconds": 300})
		}
		return map[string]any{"match": match, "server": "game.example", "playlist": len(tickets) / 2, "winningTeam": 0, "players": players}
	}
	if resp := e.gameCall(http.MethodPost, "/api/results", "", result("m1", ta, tb)); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no credential: %d", resp.StatusCode)
	}
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken+"x", result("m1", ta, tb)); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("a wrong credential: %d", resp.StatusCode)
	}
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken[:len(gameToken)-1], result("m1", ta, tb)); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the credential's prefix: %d", resp.StatusCode)
	}
	resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m1", ta, tb))
	if resp.StatusCode != http.StatusOK || decode(t, resp)["recorded"] != true {
		t.Fatalf("the result: %d %v", resp.StatusCode, decode(t, resp))
	}
	a, b := e.rating(ba, 1), e.rating(bb, 1)
	if a["rating"].(float64) <= 1500 || b["rating"].(float64) >= 1500 || a["games"].(float64) != 1 || b["games"].(float64) != 1 {
		t.Errorf("after the match: the winner %v, the loser (a quitter) %v", a, b)
	}
	if e.rating(ba, 2)["games"].(float64) != 0 {
		t.Error("another playlist's rating changed")
	}
	// (the same result again: recorded once, nothing changes; its tickets in another result: refused)
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m1", ta, tb)); resp.StatusCode != http.StatusOK || decode(t, resp)["recorded"] != false {
		t.Errorf("a retry: %d", resp.StatusCode)
	}
	if e.rating(ba, 1)["rating"] != a["rating"] {
		t.Error("a retry changed the rating")
	}
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m2", ta, tb)); resp.StatusCode != http.StatusConflict {
		t.Errorf("used tickets in another result: %d", resp.StatusCode)
	}
	if n := e.rows(`SELECT count(*) FROM ranked_result_players WHERE match_id = 'm1'`); n != 2 {
		t.Errorf("%d players recorded, want 2", n)
	}
	// (refusals: the wrong number of players, an account twice, a foreign ticket, a ticket past the window)
	_, _, tc := e.player("sub-rc")
	_, _, td := e.player("sub-rd")
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m3", tc)); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("one player: %d", resp.StatusCode)
	}
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m3", tc, tc)); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("an account twice: %d", resp.StatusCode)
	}
	otherSeed, _, _ := ticket.NewKey("test")
	other, _ := ticket.NewSigner("test", otherSeed)
	forged, _, _ := other.Issue([16]byte{7}, "Forged", [3]ticket.Shown{}, e.clock.Now())
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m3", tc, forged)); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a foreign ticket: %d", resp.StatusCode)
	}
	// (a result's shape checked before its tickets: each team its playlist's size, the playlist 1-3, the winner a team,
	// the time played at most MaxMatchSeconds; a ticket issued ahead of now past the skew refused; AP3)
	body := result("m3", tc, td)
	body["players"].([]map[string]any)[1]["team"] = 0
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, body); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("both on one team: %d", resp.StatusCode)
	}
	for name, change := range map[string]func(map[string]any){
		"three players": func(b map[string]any) {
			b["players"] = append(b["players"].([]map[string]any), map[string]any{"ticket": forged, "team": 1})
		},
		"playlist 4": func(b map[string]any) {
			b["playlist"] = 4
			for i := range 6 {
				b["players"] = append(b["players"].([]map[string]any), map[string]any{"ticket": forged, "team": i % 2})
			}
		},
		"winning team 2": func(b map[string]any) { b["winningTeam"] = 2 },
	} {
		b := result("m3", forged, forged)
		change(b)
		if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, b); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d (the shape refused before the tickets are read)", name, resp.StatusCode)
		}
	}
	long := result("m3", tc, td)
	long["players"].([]map[string]any)[0]["seconds"] = server.MaxMatchSeconds + 1
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, long); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a time played past MaxMatchSeconds: %d", resp.StatusCode)
	}
	ahead, _, _ := e.s.Tickets.Issue([16]byte{8}, "Ahead", [3]ticket.Shown{}, e.clock.Now().Add(time.Hour))
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m3", tc, ahead)); resp.StatusCode != http.StatusForbidden {
		t.Errorf("a ticket issued an hour ahead: %d", resp.StatusCode)
	}
	e.clock.Add(server.AcceptWindow + time.Minute)
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m3", tc, td)); resp.StatusCode != http.StatusForbidden {
		t.Errorf("tickets past the window: %d", resp.StatusCode)
	}
	// (no credential configured: refused as unavailable)
	e.s.GameServerToken = nil
	if resp := e.gameCall(http.MethodPost, "/api/results", gameToken, result("m4", tc, td)); resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("no game server token set: %d", resp.StatusCode)
	}
}

// An armed leave reported at the leave with the seat's ticket, spent on that match (AP3): the account's queue ban up the
// ladder, its search tickets refused while it runs (the page told until when) but not a rejoin's of that match; the same
// match once, the ticket on no other; a rejoin that refills the lobby, shown by the rejoin's own ticket, undoes it (LV1)
func TestQuitters(t *testing.T) {
	e := setup(t, nil)
	const q1, q2, q3 = "00000000000000a1", "00000000000000a2", "00000000000000a3"
	b, _, seat1 := e.player("sub-q")
	ticketFor := func(query string) (int, string, string) {
		resp := e.write(b, http.MethodPost, "/api/ticket"+query, nil)
		v := decode(t, resp)
		tk, _ := v["ticket"].(string)
		until, _ := v["until"].(string)
		return resp.StatusCode, tk, until
	}
	call := func(path, match, tk string) int {
		return e.gameCall(http.MethodPost, path, gameToken, map[string]string{"match": match, "ticket": tk}).StatusCode
	}
	if got := call("/api/quitters", q1, seat1); got != http.StatusNoContent {
		t.Fatalf("a quitter: %d", got)
	}
	want := e.clock.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339)
	if code, _, until := ticketFor(""); code != http.StatusForbidden || until != want {
		t.Errorf("a search ticket while banned: %d until %q, want 403 until %q", code, until, want)
	}
	if me := decode(t, e.get(b, "/api/me")); me["queueBanUntil"] != want {
		t.Errorf("the page's ban: %v", me["queueBanUntil"])
	}
	e.clock.Add(time.Minute)
	call("/api/quitters", q1, seat1) // (the same match again: one ban per match)
	if _, _, until := ticketFor(""); until != want {
		t.Errorf("a retried report moved the ban to %q", until)
	}
	// (the seat's ticket on another match: refused, no second ban from one ticket)
	if got := call("/api/quitters", q2, seat1); got != http.StatusConflict {
		t.Errorf("one ticket, another match: %d", got)
	}
	if _, _, until := ticketFor(""); until != want {
		t.Errorf("a refused report moved the ban to %q", until)
	}
	// (banned, a rejoin's ticket of the ban's match, not of another; a malformed match refused)
	if code, _, _ := ticketFor("?rejoin=" + q2); code != http.StatusForbidden {
		t.Errorf("a rejoin ticket of another match while banned: %d", code)
	}
	for _, bad := range []string{"xyz", "0000000000000000", "a1"} {
		if code, _, _ := ticketFor("?rejoin=" + bad); code != http.StatusBadRequest {
			t.Errorf("a rejoin ticket of %q: %d", bad, code)
		}
	}
	code, rejoin, _ := ticketFor("?rejoin=" + q1)
	if code != http.StatusOK {
		t.Fatalf("the banned leaver's rejoin ticket: %d", code)
	}
	// (each ticket for its own call: a rejoin's isn't a seat's, a search's isn't a refill's, a rejoin's of q1 not q2's)
	if got := call("/api/quitters", q1, rejoin); got != http.StatusForbidden {
		t.Errorf("a rejoin's ticket as a quitter's: %d", got)
	}
	if got := call("/api/refills", q1, seat1); got != http.StatusForbidden {
		t.Errorf("a seat's ticket as a refill's: %d", got)
	}
	if got := call("/api/refills", q2, rejoin); got != http.StatusForbidden {
		t.Errorf("another match's rejoin ticket: %d", got)
	}
	if got := call("/api/refills", q1, rejoin); got != http.StatusNoContent {
		t.Fatalf("a refill: %d", got)
	}
	// (its ticket refills once: replayed, refused, so a later ban from the same match can't be lifted by it, RX31)
	if got := call("/api/refills", q1, rejoin); got != http.StatusConflict {
		t.Errorf("the same refill again: %d", got)
	}
	if code, _, _ := ticketFor(""); code != http.StatusOK {
		t.Errorf("after the rejoin refilled the lobby: %d", code)
	}
	// (two leaves: 5 minutes, then 15; over at its end)
	_, seat2, _ := ticketFor("")
	call("/api/quitters", q2, seat2)
	e.clock.Add(6 * time.Minute)
	_, seat3, _ := ticketFor("")
	if seat3 == "" {
		t.Error("after the 5 minutes: no ticket")
	}
	call("/api/quitters", q3, seat3)
	if _, _, until := ticketFor(""); until != e.clock.Now().Add(15*time.Minute).UTC().Format(time.RFC3339) {
		t.Errorf("the second leave's ban until %q, want 15 minutes", until)
	}
	if got := e.gameCall(http.MethodPost, "/api/quitters", "", map[string]string{"match": q3, "ticket": seat3}).StatusCode; got != http.StatusUnauthorized {
		t.Errorf("without the game server's credential: %d", got)
	}
	if got := call("/api/refills", "not a match!", rejoin); got != http.StatusBadRequest {
		t.Errorf("a malformed match: %d", got)
	}
	// (the ban runs from the leave's time the report carries, held within the window: a report that got through late
	// bans for what's left, one dated ahead from now; AP3)
	late, _, lateSeat := e.player("sub-q-late")
	report := func(match, tk string, at time.Time) int {
		return e.gameCall(http.MethodPost, "/api/quitters", gameToken, map[string]any{"match": match, "ticket": tk, "at": at.Unix()}).StatusCode
	}
	if got := report("00000000000000c1", lateSeat, e.clock.Now().Add(-10*time.Minute)); got != http.StatusNoContent {
		t.Fatalf("a late report: %d", got)
	}
	resp := e.write(late, http.MethodPost, "/api/ticket", nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("a 5-minute ban from a leave 10 minutes ago: %d (over)", resp.StatusCode)
	}
	nextSeat, _ := decode(t, resp)["ticket"].(string)
	report("00000000000000c2", nextSeat, e.clock.Now().Add(time.Hour))
	resp = e.write(late, http.MethodPost, "/api/ticket", nil)
	if until, _ := decode(t, resp)["until"].(string); until != e.clock.Now().Add(15*time.Minute).UTC().Format(time.RFC3339) {
		t.Errorf("a leave dated ahead: banned until %q, want 15 minutes from now", until)
	}
	// (one dated before the window: held at the window's start, the ban's leave there, RX31)
	_, oldID, oldSeat := e.player("sub-q-old")
	if got := report("00000000000000c3", oldSeat, e.clock.Now().Add(-10*24*time.Hour)); got != http.StatusNoContent {
		t.Fatalf("a report dated before the window: %d", got)
	}
	ban, ok, err := e.db.QueueBanOf(context.Background(), oldID)
	if want := e.clock.Now().Add(-server.AcceptWindow); err != nil || !ok || ban.LastLeave.Sub(want).Abs() > time.Second {
		t.Errorf("its ban: %+v %v %v, want its leave at %v", ban, ok, err, want)
	}
}

// The game server's calls, all of them together, at most Limits.GameServer (AC-26): past it 429, which its outbox tries
// again; a window later, taken again
func TestGameServerCallsLimited(t *testing.T) {
	limits := server.DefaultLimits()
	limits.GameServer = server.Limit{Burst: 2, Window: time.Minute}
	e := setup(t, &limits)
	empty := map[string]string{"match": "00000000000000b1", "ticket": "x"}
	for i, want := range []int{http.StatusForbidden, http.StatusForbidden, http.StatusTooManyRequests} {
		if got := e.gameCall(http.MethodPost, "/api/quitters", gameToken, empty).StatusCode; got != want {
			t.Errorf("call %d: %d, want %d", i, got, want)
		}
	}
	if got := e.gameCall(http.MethodPost, "/api/refills", gameToken, empty).StatusCode; got != http.StatusTooManyRequests {
		t.Errorf("a refill past the limit: %d", got)
	}
	// (a wrong credential isn't counted: refused before)
	if got := e.gameCall(http.MethodPost, "/api/results", "wrong", empty).StatusCode; got != http.StatusUnauthorized {
		t.Errorf("a wrong credential: %d", got)
	}
	e.clock.Add(time.Minute)
	if got := e.gameCall(http.MethodPost, "/api/quitters", gameToken, empty).StatusCode; got != http.StatusForbidden {
		t.Errorf("a minute later: %d", got)
	}
}

// A body without its length (chunked) is capped as one with it: past 16 KiB, 413 (AP2-10)
func TestChunkedBodyCapped(t *testing.T) {
	e := setup(t, nil)
	big := strings.Repeat("x", 17<<10)
	body := io.MultiReader(strings.NewReader(`{"match":"`), strings.NewReader(big), strings.NewReader(`"}`))
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, e.srv.URL+"/api/results", body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+gameToken)
	if req.ContentLength != 0 && req.ContentLength != -1 {
		t.Fatalf("not chunked: %d", req.ContentLength)
	}
	if resp := e.do(e.browser(), req); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("a 17 KiB chunked body: %d", resp.StatusCode)
	}
	// (the page's writes too: a sign-up's body without its length, past 16 KiB)
	b := e.browser()
	e.googleSignIn(b, "sub-chunked")
	page := io.MultiReader(strings.NewReader(`{"name":"`), strings.NewReader(big), strings.NewReader(`","turnstile":"good"}`))
	req, err = http.NewRequestWithContext(context.Background(), http.MethodPost, e.srv.URL+"/api/signup", page)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", e.srv.URL)
	req.Header.Set("X-Carball", "1")
	if resp := e.do(b, req); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("a page's 17 KiB chunked body: %d", resp.StatusCode)
	}
}
