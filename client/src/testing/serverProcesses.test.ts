import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServers } from "./serverProcesses";

const LOGS = mkdtempSync(join(tmpdir(), "rl-server-logs-"));

describe("the browser tests' servers (RV-320)", () => {
  it("fails at once when a server is killed on its way up (a signal: no exit code)", async () => {
    const start = Date.now();
    await expect(startServers([{ name: "killed", command: "sh", args: ["-c", "kill -9 $$"], url: "http://127.0.0.1:9/never", reuse: false }], 60_000, LOGS)).rejects.toThrow(
      /killed server didn't start/,
    );
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("starts a server, then stops it; one that ignores SIGTERM is killed 5 s on", async () => {
    const http = (port: number, ignoreTerm: boolean) =>
      `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""} require('http').createServer((q, s) => s.end('ok')).listen(${String(port)}, '127.0.0.1')`;
    const stop = await startServers(
      [
        { name: "plain", command: process.execPath, args: ["-e", http(14491, false)], url: "http://127.0.0.1:14491/", reuse: false },
        { name: "stubborn", command: process.execPath, args: ["-e", http(14492, true)], url: "http://127.0.0.1:14492/", reuse: false },
      ],
      30_000,
      LOGS,
    );
    expect((await fetch("http://127.0.0.1:14491/")).ok).toBe(true);
    const start = Date.now();
    await stop();
    expect(Date.now() - start).toBeLessThan(8000);
    await expect(fetch("http://127.0.0.1:14492/", { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  }, 20_000);
});
