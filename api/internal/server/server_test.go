package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"carball/api/internal/google"
	"carball/api/internal/server"
	"carball/api/internal/steam"
	"carball/api/internal/store"
	"carball/api/internal/testdb"
	"carball/api/internal/testoidc"
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
}

// (a made-up SteamID64)
const steamID = "76561190000000077"

func setup(t *testing.T, limits *server.Limits) *env {
	t.Helper()
	owner, app := testdb.New(t)
	ctx := context.Background()
	if err := store.Migrate(ctx, owner, "", testdb.AppRole); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(ctx, app, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	e := &env{t: t, db: db, google: testoidc.New(t, "our-client", "our-secret"), steam: &fakeSteam{},
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

	e.s = &server.Server{Store: db, DeletionKey: bytes.Repeat([]byte("k"), 32), Now: e.clock.Now,
		Log: slog.New(slog.NewTextHandler(&lockedWriter{w: e.logs}, nil)), TurnstileSiteKey: "site-key"}
	if limits != nil {
		e.s.SetLimits(*limits)
	}
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
	first := b.Jar.Cookies(u)[0].Value
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
	second := b.Jar.Cookies(u)[0].Value
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

func TestHealthAndHeaders(t *testing.T) {
	e := setup(t, nil)
	resp := e.get(e.browser(), "/api/healthz")
	if resp.StatusCode != http.StatusOK || string(resp.Body) != "ok\n" {
		t.Errorf("healthz: %d %q", resp.StatusCode, resp.Body)
	}
	for k, v := range map[string]string{"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"} {
		if resp.Header.Get(k) != v {
			t.Errorf("%s: %q", k, resp.Header.Get(k))
		}
	}
	// (the cookies: __Host-, Secure, HttpOnly, Lax, Path=/, no Domain)
	start := e.get(e.browser(), "/api/auth/google/start")
	c := start.Header.Get("Set-Cookie")
	for _, part := range []string{"__Host-cb_auth=", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"} {
		if !strings.Contains(c, part) {
			t.Errorf("the pre-auth cookie %q lacks %s", c, part)
		}
	}
	if strings.Contains(strings.ToLower(c), "domain=") {
		t.Errorf("the pre-auth cookie names a domain: %q", c)
	}
}
