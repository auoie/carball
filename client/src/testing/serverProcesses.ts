// Servers for the browser tests (client/e2e/servers.ts, Playwright's globalSetup): each started unless it already answers
// (a reused one: the preview), all waited for with half-second checks (where a closed local port drops the connection
// instead of refusing it, Playwright's own check waited 2 min 14 s a server), and stopped together: each one's whole
// process group, SIGTERM then SIGKILL 5 s on, and SIGKILL on any exit of this process. A server that dies on the way up
// (exited, or killed by a signal: RV-320) fails the start at once. Each one's output goes to `<logDir>/<name>.log`.
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";

export interface Server {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Answers once the server is up */
  readonly url: string;
  /** Already running: used as it is (the preview), else the port is taken: an error */
  readonly reuse: boolean;
  /** Its environment's additions */
  readonly env?: Readonly<Record<string, string>>;
}

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

/** Starts the servers; the function that stops them */
export async function startServers(servers: readonly Server[], timeoutMs: number, logDir: string): Promise<() => Promise<void>> {
  mkdirSync(logDir, { recursive: true });
  const started: { readonly name: string; readonly child: ChildProcess; readonly exited: Promise<void>; done: boolean }[] = [];
  // (each server's whole group: npx's vite, cargo's carball-server)
  const signal = (name: NodeJS.Signals): void => {
    for (const s of started) {
      if (s.child.pid !== undefined && !s.done) {
        try {
          process.kill(-s.child.pid, name);
        } catch {
          // (gone already)
        }
      }
    }
  };
  // (an exit without the teardown, as a crash: no server left behind)
  process.once("exit", () => {
    signal("SIGKILL");
  });
  const stop = async (): Promise<void> => {
    signal("SIGTERM");
    // (one that ignores it is killed 5 s on)
    const killer = setTimeout(() => {
      signal("SIGKILL");
    }, 5000);
    await Promise.all(started.map(async (s) => s.exited));
    clearTimeout(killer);
  };
  try {
    for (const server of servers) {
      if (await answers(server.url)) {
        if (server.reuse) continue;
        throw new Error(`${server.url} already answers: another ${server.name} server is running`);
      }
      const log = createWriteStream(`${logDir}/${server.name}.log`);
      const child = spawn(server.command, server.args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...server.env } });
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      const entry = { name: server.name, child, exited: Promise.resolve(), done: false };
      // (its exit as an event: a server killed by a signal has no exit code, only its signal)
      entry.exited = new Promise<void>((resolve) => {
        const end = (): void => {
          entry.done = true;
          resolve();
        };
        child.once("exit", end);
        // (one that can't start, its command missing: an error, no exit, RV-350)
        child.once("error", (e) => {
          log.write(`${e.message}\n`);
          end();
        });
      });
      started.push(entry);
    }
    const deadline = Date.now() + timeoutMs;
    for (const server of servers) {
      while (!(await answers(server.url))) {
        const died = started.find((s) => s.name === server.name)?.done ?? false;
        if (Date.now() > deadline || died) throw new Error(`${server.name} server didn't start (${server.url}): ${logDir}/${server.name}.log`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
