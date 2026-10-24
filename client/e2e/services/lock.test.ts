// The services' lock (lock.ts): a second run refused and the first's lock untouched, so the refused run's teardown leaves
// the first's stacks be (RV-1053's scenario G); a lock an ended run left taken over (RV-1056). Vitest's (Node), not a
// browser test: Playwright's projects don't match it
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { lockedBy, noteGroup, readLock, startOf, takeLock } from "./lock";

// (the test's own folder, in the stacks' ignored work directory, gone after)
const WORK = new URL("../../.e2e-services/", import.meta.url).pathname;
mkdirSync(WORK, { recursive: true });
const DIR = mkdtempSync(join(WORK, "lock-test-"));
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});
let n = 0;
const fresh = (): string => join(DIR, `lock-${String(++n)}`);

/** A process that has ended: its pid */
async function endedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((done) => child.on("close", done));
  return child.pid ?? 0;
}

describe("the services' lock", () => {
  it("refuses a second run while the first's is live, and leaves the first's lock as it was (scenario G)", () => {
    const path = fresh();
    const first = process.pid;
    const second = process.ppid;
    takeLock(path, first);
    noteGroup(path, 4242, true);
    const before = readFileSync(path, "utf8");
    expect(() => {
      takeLock(path, second);
    }).toThrow(`another run (process ${String(first)}) has the services' stacks up`);
    // (the refused run's teardown asks whose they are: not its own, so it takes nothing down)
    expect(lockedBy(path, second)).toBe(false);
    expect(lockedBy(path, first)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(before);
    noteGroup(path, 4242, false);
    expect(readLock(path)?.groups).toEqual([]);
  });

  it("takes over a lock whose run has ended, or whose pid is another process's now", async () => {
    const ended = fresh();
    const gone = await endedPid();
    writeFileSync(ended, JSON.stringify({ pid: gone, start: "1", groups: [9] }));
    expect(lockedBy(ended, gone)).toBe(false);
    takeLock(ended, process.pid);
    expect(readLock(ended)).toEqual({ pid: process.pid, start: startOf(process.pid), groups: [] });

    // (a live pid, its start not the lock's: the pid reused)
    const reused = fresh();
    writeFileSync(reused, JSON.stringify({ pid: process.ppid, start: "0", groups: [] }));
    expect(lockedBy(reused, process.ppid)).toBe(false);
    takeLock(reused, process.pid);
    expect(lockedBy(reused, process.pid)).toBe(true);
  });

  it("refuses while a lock it can't read is fresh (a run writing it), takes one left unreadable", () => {
    const path = fresh();
    writeFileSync(path, "");
    expect(() => {
      takeLock(path, process.pid);
    }).toThrow("another run has the services' stacks up");
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
    takeLock(path, process.pid);
    expect(lockedBy(path, process.pid)).toBe(true);
  });
});
