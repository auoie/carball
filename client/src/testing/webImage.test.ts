// The web image's nginx (docker/nginx.conf, APP-CONTRACT.md): the page's fallback for its own routes alone; the files the
// page fetches by name a 404 when missing (RV-537: a missing bot policy served the page, read as a broken model)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const CONF = readFileSync(new URL("../../docker/nginx.conf", import.meta.url), "utf8");

/** Each location's path and its Cache-Control header (as written: value and flags), or none */
function cacheControl(): Map<string, string | undefined> {
  return new Map(
    [...CONF.matchAll(/location\s+(=\s*)?(\S+)\s*\{([^}]*)\}/g)].map((m) => [m[2] ?? "", /add_header\s+Cache-Control\s+([^;]+);/.exec(m[3] ?? "")?.[1]]),
  );
}

/** Each location's path and its try_files */
function locations(): Map<string, string | undefined> {
  return new Map([...CONF.matchAll(/location\s+(=\s*)?(\S+)\s*\{([^}]*)\}/g)].map((m) => [m[2] ?? "", /try_files\s+([^;]+);/.exec(m[3] ?? "")?.[1]]));
}

describe("the web image's nginx", () => {
  it("falls back to the page for its routes alone: the assets, the config and the bots' files a 404 when missing", () => {
    const at = locations();
    expect(at.get("/")).toBe("$uri $uri/ /index.html");
    for (const path of ["/assets/", "/config.json", "/bots/"]) expect(at.get(path), path).toBe("$uri =404");
  });

  it("answers /api/ with a 404, never the page: the accounts service's, misrouted if it reaches this container (RX28C)", () => {
    const api = /location\s+\/api\/\s*\{([^}]*)\}/.exec(CONF)?.[1] ?? "";
    expect(api).toContain("return 404;");
    expect(api).not.toContain("try_files");
    expect(cacheControl().get("/api/")).toBe('"no-store" always');
  });

  it("caches each location as the contract says: the hashed assets for good, the config never, the page and bots revalidated (RV-553)", () => {
    const at = cacheControl();
    expect(at.get("/assets/")).toBe('"public, max-age=31536000, immutable"');
    expect(at.get("/config.json")).toBe('"no-store"');
    expect(at.get("/")).toBe('"no-cache"');
    // (a missing package file's 404 revalidated too, so a package added later isn't hidden by a cached one)
    expect(at.get("/bots/")).toBe('"no-cache" always');
    expect(at.get("/healthz")).toBeUndefined();
  });

  it("sends the security headers in every location (add_header there replaces the server's)", () => {
    const blocks = [...CONF.matchAll(/location[^{]*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) expect(block).toContain("include /etc/nginx/security-headers.conf;");
  });
});

describe("the web image's Content-Security-Policy (docker/40-carball-config.sh)", () => {
  // (the start script's output in a directory of the test's own, gone after: RX29C)
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  /** The policy the start script writes for a game server URL */
  const policy = (gameServer: string): Map<string, string> => {
    const dir = mkdtempSync(join(tmpdir(), "carball-csp-"));
    dirs.push(dir);
    execFileSync("sh", [new URL("../../docker/40-carball-config.sh", import.meta.url).pathname], {
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", GAME_SERVER_URL: gameServer, CONFIG_DIR: dir, CSP_FILE: join(dir, "csp.conf") },
      stdio: "pipe",
    });
    const header = /Content-Security-Policy "([^"]*)"/.exec(readFileSync(join(dir, "csp.conf"), "utf8"))?.[1] ?? "";
    return new Map(header.split("; ").map((d) => [d.split(" ")[0] ?? "", d.split(" ").slice(1).join(" ")]));
  };

  it("lets Turnstile's script and frame in for the sign-up's check, nothing else from outside but the game server (RV-639)", () => {
    const csp = policy("https://game.carball.example:4433/play");
    expect(csp.get("script-src")).toBe("'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com");
    expect(csp.get("frame-src")).toBe("https://challenges.cloudflare.com");
    expect(csp.get("connect-src")).toBe("'self' data: https://game.carball.example:4433");
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("form-action")).toBe("'none'");
  });
});
