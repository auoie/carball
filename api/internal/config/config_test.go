package config

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func secret(t *testing.T, value string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(p, []byte(value), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func env(vars map[string]string) Env { return func(k string) string { return vars[k] } }

// A secret's file loses its line end alone (as `echo` writes one), its other spaces kept: the game server's rule too (RX31)
func TestReadSecretDropsOnlyTheLineEnd(t *testing.T) {
	for in, want := range map[string]string{"tok\n": "tok", "tok\r\n": "tok", " tok \n": " tok ", "tok\t": "tok\t"} {
		if got, err := ReadSecret(secret(t, in)); err != nil || got != want {
			t.Errorf("%q: %q %v, want %q", in, got, err, want)
		}
	}
	if _, err := ReadSecret(secret(t, "\r\n")); err == nil {
		t.Error("a line end alone: empty, refused")
	}
}

func good(t *testing.T) map[string]string {
	return map[string]string{
		"PUBLIC_ORIGIN":             "https://carball.example",
		"DATABASE_URL":              "postgres://carball_app@db:5432/carball",
		"DATABASE_PASSWORD_FILE":    secret(t, "pw\n"),
		"TURNSTILE_SITE_KEY":        "site-key",
		"TURNSTILE_SECRET_FILE":     secret(t, "turnstile-secret\n"),
		"DELETION_HMAC_KEY_FILE":    secret(t, strings.Repeat("k", 32)+"\n"),
		"GOOGLE_CLIENT_ID":          "client-id",
		"GOOGLE_CLIENT_SECRET_FILE": secret(t, "client-secret"),
		"TICKET_KEY_ID":             "k1",
		"TICKET_SIGNING_KEY_FILE":   secret(t, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=\n"),
		"TRUSTED_PROXIES":           "127.0.0.1/32,::1/128",
		"GAME_SERVER_TOKEN_FILE":    secret(t, strings.Repeat("g", 32)+"\n"),
		"GAME_SERVERS":              "us-east|US East|https://Game.Carball.example:4433/play,eu|Europe (West)|https://game-eu.carball.example/play",
	}
}

func TestLoad(t *testing.T) {
	c, err := Load(env(good(t)), false)
	if err != nil {
		t.Fatal(err)
	}
	if c.ListenAddr != ":8080" || c.TurnstileSecret != "turnstile-secret" || c.GoogleClientSecret != "client-secret" ||
		string(c.DeletionKey) != strings.Repeat("k", 32) {
		t.Errorf("Load = %+v", c)
	}
	if want := []string{"game.carball.example:4433", "game-eu.carball.example:443"}; !slices.Equal(c.GameServers, want) {
		t.Errorf("GameServers = %v, want %v", c.GameServers, want)
	}
}

// GAME_SERVERS by the web image's rules (40-carball-config.sh): each server's name as matches know it, host:port
// (lower-case, 443 by default); an entry that breaks a rule refused, not dropped
func TestParseGameServers(t *testing.T) {
	got, err := ParseGameServers("a|A|https://one.example:4433/play,b-2|B (2)|https://TWO.example/,c|C.|https://three.example:1/x/y")
	if want := []string{"one.example:4433", "two.example:443", "three.example:1"}; err != nil || !slices.Equal(got, want) {
		t.Fatalf("got %v, %v; want %v", got, err, want)
	}
	for name, list := range map[string]string{
		"an empty entry":             "a|A|https://one.example/play,",
		"two fields":                 "a|https://one.example/play",
		"four fields":                "a|A|https://one.example/play|x",
		"an id twice":                "a|A|https://one.example/play,a|B|https://two.example/play",
		"an upper-case id":           "A|A|https://one.example/play",
		"an id ending in a hyphen":   "a-|A|https://one.example/play",
		"a name with a comma's kin":  "a|A;B|https://one.example/play",
		"a name too long":            "a|" + strings.Repeat("n", 41) + "|https://one.example/play",
		"http":                       "a|A|http://one.example/play",
		"no path":                    "a|A|https://one.example",
		"a port past 65535":          "a|A|https://one.example:65536/play",
		"a port with a leading zero": "a|A|https://one.example:0443/play",
		"a host label with a hyphen": "a|A|https://-one.example/play",
		"a query":                    "a|A|https://one.example/play?x=1",
		"nine entries":               strings.Repeat("a|A|https://one.example/play,", 8) + "i|I|https://nine.example/play",
	} {
		if got, err := ParseGameServers(list); err == nil {
			t.Errorf("%s: accepted as %v", name, got)
		}
	}
}

func TestLoadRefusals(t *testing.T) {
	for name, edit := range map[string]func(map[string]string){
		"a password in DATABASE_URL":         func(v map[string]string) { v["DATABASE_URL"] = "postgres://u:pw@db/carball" },
		"a password keyword in DATABASE_URL": func(v map[string]string) { v["DATABASE_URL"] = "host=db user=u password=pw" },
		"a password in the URL's query":      func(v map[string]string) { v["DATABASE_URL"] = "postgres://u@db/c?password=pw" },
		"no DATABASE_URL":                    func(v map[string]string) { delete(v, "DATABASE_URL") },
		"an http origin":                     func(v map[string]string) { v["PUBLIC_ORIGIN"] = "http://carball.example" },
		"an origin with a path":              func(v map[string]string) { v["PUBLIC_ORIGIN"] = "https://carball.example/x" },
		"no Turnstile secret":                func(v map[string]string) { delete(v, "TURNSTILE_SECRET_FILE") },
		"no Turnstile site key":              func(v map[string]string) { delete(v, "TURNSTILE_SITE_KEY") },
		"no deletion key":                    func(v map[string]string) { delete(v, "DELETION_HMAC_KEY_FILE") },
		"a short deletion key":               func(v map[string]string) { v["DELETION_HMAC_KEY_FILE"] = secret(t, "short") },
		"an empty secret file":               func(v map[string]string) { v["TURNSTILE_SECRET_FILE"] = secret(t, "\n") },
		"a missing secret file":              func(v map[string]string) { v["TURNSTILE_SECRET_FILE"] = "/nonexistent/secret" },
		"a Google id without its secret":     func(v map[string]string) { delete(v, "GOOGLE_CLIENT_SECRET_FILE") },
		"a spaced password keyword (AP-14)":  func(v map[string]string) { v["DATABASE_URL"] = "host=db user=u password = pw" },
		"a bad trusted proxy":                func(v map[string]string) { v["TRUSTED_PROXIES"] = "172.18.0.0/16, not-a-cidr" },
		"every address trusted (AP2-6)":      func(v map[string]string) { v["TRUSTED_PROXIES"] = "0.0.0.0/0" },
		"every IPv6 address trusted":         func(v map[string]string) { v["TRUSTED_PROXIES"] = "::/0" },
		"a public address trusted":           func(v map[string]string) { v["TRUSTED_PROXIES"] = "203.0.113.7" },
		"a zoned address (RV-974)":           func(v map[string]string) { v["TRUSTED_PROXIES"] = "fe80::1%eth0" },
		"a prefix running past private":      func(v map[string]string) { v["TRUSTED_PROXIES"] = "10.0.0.0/7" },
		"no trusted proxy (the tunnel's)":    func(v map[string]string) { delete(v, "TRUSTED_PROXIES") },
		"a blank trusted proxy list":         func(v map[string]string) { v["TRUSTED_PROXIES"] = " , " },
		"a health address off loopback":      func(v map[string]string) { v["HEALTH_ADDR"] = "0.0.0.0:8081" },
		"no ticket key":                      func(v map[string]string) { delete(v, "TICKET_SIGNING_KEY_FILE") },
		"a ticket key without its id":        func(v map[string]string) { delete(v, "TICKET_KEY_ID") },
		"no game server token (AP3)":         func(v map[string]string) { delete(v, "GAME_SERVER_TOKEN_FILE") },
		"a short game server token":          func(v map[string]string) { v["GAME_SERVER_TOKEN_FILE"] = secret(t, strings.Repeat("g", 31)) },
		"no game servers (RV-1157)":          func(v map[string]string) { delete(v, "GAME_SERVERS") },
		"a game server list broken":          func(v map[string]string) { v["GAME_SERVERS"] = "us-east|US East|http://game.example/play" },
	} {
		vars := good(t)
		edit(vars)
		if _, err := Load(env(vars), false); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestLoadDev(t *testing.T) {
	vars := good(t)
	vars["PUBLIC_ORIGIN"] = "http://localhost:5173"
	delete(vars, "TURNSTILE_SECRET_FILE")
	delete(vars, "TURNSTILE_SITE_KEY")
	delete(vars, "TRUSTED_PROXIES") // (development: no tunnel in front)
	delete(vars, "TICKET_KEY_ID")
	delete(vars, "TICKET_SIGNING_KEY_FILE")
	delete(vars, "GAME_SERVER_TOKEN_FILE")
	delete(vars, "GAME_SERVERS")
	if c, err := Load(env(vars), true); err != nil || c.GameServers != nil {
		t.Errorf("development on localhost without Turnstile, a ticket key, a game server token or a list of servers (any): %v, %v", c.GameServers, err)
	}
	// (--dev never serves a public origin, https or not: its Turnstile is optional, AP-7)
	for _, origin := range []string{"http://carball.example", "https://carball.example"} {
		vars["PUBLIC_ORIGIN"] = origin
		if _, err := Load(env(vars), true); err == nil {
			t.Errorf("development with %s accepted", origin)
		}
	}
	// (a development server on loopback alone, unless LISTEN_ADDR says otherwise: AP2-7)
	vars["PUBLIC_ORIGIN"] = "http://localhost:5173"
	if c, err := Load(env(vars), true); err != nil || c.ListenAddr != "127.0.0.1:8080" {
		t.Errorf("the development listener: %q, %v", c.ListenAddr, err)
	}
}

func TestProxiesAndHealth(t *testing.T) {
	vars := good(t)
	vars["TRUSTED_PROXIES"] = "172.18.0.0/16, 10.0.0.7, fd00::/8, ::ffff:172.19.0.0/112, ::ffff:127.0.0.1"
	c, err := Load(env(vars), false)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, p := range c.TrustedProxies {
		got = append(got, p.String())
	}
	if strings.Join(got, " ") != "172.18.0.0/16 10.0.0.7/32 fd00::/8 172.19.0.0/16 127.0.0.1/32" || c.HealthAddr != "127.0.0.1:8081" {
		t.Errorf("TrustedProxies %v, HealthAddr %q", got, c.HealthAddr)
	}
	if Hostname("https://carball.example") != "carball.example" || Hostname("http://localhost:5173") != "localhost" {
		t.Error("Hostname")
	}
}
