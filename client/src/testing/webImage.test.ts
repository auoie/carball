// The web image's nginx (docker/nginx.conf, APP-CONTRACT.md): the page's fallback for its own routes alone; the files the
// page fetches by name a 404 when missing (RV-537: a missing bot policy served the page, read as a broken model)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CONF = readFileSync(new URL("../../docker/nginx.conf", import.meta.url), "utf8");

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

  it("sends the security headers in every location (add_header there replaces the server's)", () => {
    const blocks = [...CONF.matchAll(/location[^{]*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) expect(block).toContain("include /etc/nginx/security-headers.conf;");
  });
});
