import { mkdtempSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startServers } from "./serverProcesses";

const LOGS = mkdtempSync(join(tmpdir(), "rl-server-logs-"));

/** A port no one listens on now (the system's pick: concurrent runs don't clash, RV-350) */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// (a failed test's servers stopped too, the stubborn one killed: RV-350)
const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.all(stops.map(async (stop) => stop()));
});

describe("the browser tests' servers (RV-320)", () => {
  it("fails at once when a server is killed on its way up (a signal: no exit code)", async () => {
    const start = Date.now();
    await expect(startServers([{ name: "killed", command: "sh", args: ["-c", "kill -9 $$"], url: "http://127.0.0.1:9/never", reuse: false }], 60_000, LOGS)).rejects.toThrow(
      /killed server didn't start/,
    );
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("fails at once when a server's command doesn't exist (an error, no exit)", async () => {
    const start = Date.now();
    await expect(startServers([{ name: "missing", command: "/nonexistent/rl-server", args: [], url: "http://127.0.0.1:9/never", reuse: false }], 60_000, LOGS)).rejects.toThrow(
      /missing server didn't start/,
    );
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("starts a server, then stops it; one that ignores SIGTERM is killed 5 s on", async () => {
    const http = (port: number, ignoreTerm: boolean) =>
      `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""} require('http').createServer((q, s) => s.end('ok')).listen(${String(port)}, '127.0.0.1')`;
    const [plain, stubborn] = [await freePort(), await freePort()];
    const stop = await startServers(
      [
        { name: "plain", command: process.execPath, args: ["-e", http(plain, false)], url: `http://127.0.0.1:${String(plain)}/`, reuse: false },
        { name: "stubborn", command: process.execPath, args: ["-e", http(stubborn, true)], url: `http://127.0.0.1:${String(stubborn)}/`, reuse: false },
      ],
      30_000,
      LOGS,
    );
    stops.push(stop);
    expect((await fetch(`http://127.0.0.1:${String(plain)}/`)).ok).toBe(true);
    const start = Date.now();
    await stop();
    expect(Date.now() - start).toBeLessThan(8000);
    await expect(fetch(`http://127.0.0.1:${String(stubborn)}/`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  }, 20_000);
});
