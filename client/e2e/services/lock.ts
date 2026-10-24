// The lock naming the run whose services' stacks are up (stacks.ts; RV-1047, RV-1056): its Playwright runner's process
// id and that process's start (a pid reused by another process isn't the run), and the process groups of its stacks'
// starts still running (an interrupt kills them, RV-1054). Created at once or not at all; one an ended run left taken
// over. Linux alone (/proc), as the stacks are.
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";

export interface Lock {
  readonly pid: number;
  readonly start: string;
  readonly groups: readonly number[];
}

/** How long a lock that can't be read yet counts as being written (ms): a run's, taking it now */
const WRITING_MS = 10_000;

/** A process's start (its /proc stat's 22nd field, clock ticks since the boot), none if it's gone */
export function startOf(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    // (the fields after the name's closing parenthesis, the 3rd on: the name may hold spaces)
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

export function readLock(path: string): Lock | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as Partial<Lock>;
    if (typeof v.pid !== "number" || typeof v.start !== "string" || !Array.isArray(v.groups)) return null;
    return { pid: v.pid, start: v.start, groups: v.groups.filter((g): g is number => typeof g === "number") };
  } catch {
    return null;
  }
}

/** Whether the lock is the runner `owner`'s, the same process that took it */
export function lockedBy(path: string, owner: number): boolean {
  const held = readLock(path);
  return held !== null && held.pid === owner && held.start === startOf(owner);
}

/** The lock taken for the runner `owner`: refused while another live run holds it (its process the same that took it)
 *  or is writing it; one an ended run left (killed outright, or its pid now another process's) taken over */
export function takeLock(path: string, owner: number): void {
  const mine: Lock = { pid: owner, start: startOf(owner) ?? "", groups: [] };
  for (let tries = 0; tries < 3; tries++) {
    try {
      writeFileSync(path, JSON.stringify(mine), { flag: "wx" });
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== "EEXIST") throw e;
      const held = readLock(path);
      const writing = held === null && Date.now() - (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0) < WRITING_MS;
      if (writing || (held !== null && held.pid !== owner && held.start === startOf(held.pid))) {
        const who = held === null ? "another run" : `another run (process ${String(held.pid)})`;
        throw new Error(`${who} has the services' stacks up: wait for it to end (${path})`, { cause: e });
      }
      rmSync(path, { force: true });
    }
  }
  throw new Error(`the services' lock couldn't be taken (${path})`);
}

/** A stack's start's process group noted in the lock (`running`), or let go */
export function noteGroup(path: string, group: number, running: boolean): void {
  const held = readLock(path);
  if (held === null) return;
  const groups = running ? [...held.groups, group] : held.groups.filter((g) => g !== group);
  writeFileSync(path, JSON.stringify({ ...held, groups }));
}
