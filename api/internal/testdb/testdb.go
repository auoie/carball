// Package testdb runs a throwaway Postgres for the tests from the installed binaries (initdb, pg_ctl): one server for a
// test binary, under $TMPDIR, on 127.0.0.1 alone (no Unix socket), stopped and removed after; each test its own empty
// database, owned by the schema's owner role, with a rows-only role beside it (as the service's: AC-18). Without the
// binaries the tests that need it are skipped, or fail with CARBALL_API_REQUIRE_DB=1.
package testdb

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
)

const (
	// OwnerRole owns the tests' databases (the migrations' role); AppRole is the service's, granted rows only
	OwnerRole = "carball_owner"
	AppRole   = "carball_app"
)

var (
	port    int
	missing string
	count   atomic.Int64
)

// Main is a package's TestMain: the server started, the tests run, the server stopped and its directory removed
func Main(m *testing.M) int {
	dir, err := start()
	if err != nil {
		missing = err.Error()
	}
	code := m.Run()
	if dir != "" {
		stop(dir)
	}
	return code
}

func binary(name string) (string, error) {
	if p, err := exec.LookPath(name); err == nil {
		return p, nil
	}
	matches, _ := filepath.Glob("/usr/lib/postgresql/*/bin/" + name)
	if len(matches) > 0 {
		return matches[len(matches)-1], nil
	}
	return "", fmt.Errorf("%s not found", name)
}

func start() (string, error) {
	initdb, err := binary("initdb")
	if err != nil {
		return "", err
	}
	pgctl, err := binary("pg_ctl")
	if err != nil {
		return "", err
	}
	dir, err := os.MkdirTemp("", "carball-api-pg-")
	if err != nil {
		return "", err
	}
	ctx := context.Background()
	data := filepath.Join(dir, "data")
	if out, err := exec.CommandContext(ctx, initdb, "-D", data, "-U", OwnerRole, "--auth=trust", "--no-sync", "-E", "UTF8",
		"--no-locale").CombinedOutput(); err != nil {
		return dir, fmt.Errorf("initdb: %w: %s", err, out)
	}
	l, err := (&net.ListenConfig{}).Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return dir, err
	}
	port = l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	opts := fmt.Sprintf("-p %d -k '' -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off "+
		"-c synchronous_commit=off -c max_connections=200", port)
	if out, err := exec.CommandContext(ctx, pgctl, "-D", data, "-l", filepath.Join(dir, "log"), "-o", opts, "-w", "-t", "30",
		"start").CombinedOutput(); err != nil {
		return dir, fmt.Errorf("pg_ctl start: %w: %s", err, out)
	}
	conn, err := pgx.Connect(ctx, url("postgres", OwnerRole))
	if err != nil {
		return dir, err
	}
	defer func() { _ = conn.Close(ctx) }()
	if _, err := conn.Exec(ctx, "CREATE ROLE "+AppRole+" LOGIN"); err != nil {
		return dir, err
	}
	return dir, nil
}

func stop(dir string) {
	if pgctl, err := binary("pg_ctl"); err == nil {
		_ = exec.CommandContext(context.Background(), pgctl, "-D", filepath.Join(dir, "data"), "-m", "fast", "-w", "stop").Run()
	}
	_ = os.RemoveAll(dir)
}

func url(db, role string) string {
	return fmt.Sprintf("postgres://%s@127.0.0.1:%d/%s?sslmode=disable", role, port, db)
}

// New is a test's own empty database: the owner's URL (to migrate) and the service role's
func New(t *testing.T) (owner, app string) {
	t.Helper()
	if missing != "" {
		if os.Getenv("CARBALL_API_REQUIRE_DB") == "1" {
			t.Fatalf("no throwaway Postgres: %s", missing)
		}
		t.Skipf("no throwaway Postgres: %s", missing)
	}
	name := "t" + strconv.FormatInt(count.Add(1), 10)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url("postgres", OwnerRole))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name+" OWNER "+OwnerRole); err != nil {
		t.Fatal(err)
	}
	return url(name, OwnerRole), url(name, AppRole)
}
