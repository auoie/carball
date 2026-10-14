// The browser tests' servers (playwright.config.ts globalSetup): the production build's preview and the game servers,
// started here and stopped after the run. Playwright's own webServer first checks each URL with no timeout of its own:
// where a closed local port drops the connection instead of refusing it, that check waited about 2 min 14 s per server
// (9 of the suite's 12 minutes). Here each check gives up after half a second. Each server's output goes to
// test-results/servers/<name>.log.
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";

interface Server {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Answers once the server is up */
  readonly url: string;
  /** Already running: used as it is (the preview), else the port is taken: an error */
  readonly reuse: boolean;
}

const GAME = ["run", "--quiet", "--manifest-path", "../server/Cargo.toml", "--"];
const SERVERS: readonly Server[] = [
  { name: "preview", command: "npx", args: ["vite", "preview", "--port", "4173", "--strictPort"], url: "http://localhost:4173/", reuse: true },
  // The game server for the online tests (the first run builds it)
  { name: "game", command: "cargo", args: [...GAME, "--port", "14433", "--info-port", "14434"], url: "http://127.0.0.1:14434/info", reuse: false },
  // One whose rounds end in a goal 1 s after go (the goal sequence's test)
  { name: "goal", command: "cargo", args: [...GAME, "--port", "14435", "--info-port", "14436", "--test-goal-after", "1"], url: "http://127.0.0.1:14436/info", reuse: false },
  // A 2v2 casual playlist whose forfeit votes are allowed once the clock runs (the forfeit and leave tests)
  {
    name: "forfeit",
    command: "cargo",
    args: [...GAME, "--port", "14437", "--info-port", "14438", "--team-size", "2", "--forfeit-vote-wait", "0"],
    url: "http://127.0.0.1:14438/info",
    reuse: false,
  },
];

/** The first run builds the game server */
const START_TIMEOUT_MS = 600_000;

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

export default async function startServers(): Promise<() => Promise<void>> {
  mkdirSync("test-results/servers", { recursive: true });
  const started: ChildProcess[] = [];
  const children = new Map<string, ChildProcess>();
  // (each server's whole group: npx's vite, cargo's rl-server)
  const signal = (name: NodeJS.Signals): void => {
    for (const child of started) {
      if (child.pid !== undefined && child.exitCode === null) {
        try {
          process.kill(-child.pid, name);
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
    await Promise.all(started.map(async (child) => (child.exitCode === null ? new Promise((done) => child.once("exit", done)) : undefined)));
    clearTimeout(killer);
  };
  try {
    for (const server of SERVERS) {
      if (await answers(server.url)) {
        if (server.reuse) continue;
        throw new Error(`${server.url} already answers: another ${server.name} server is running`);
      }
      const log = createWriteStream(`test-results/servers/${server.name}.log`);
      const child = spawn(server.command, server.args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      started.push(child);
      children.set(server.name, child);
    }
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (const server of SERVERS) {
      while (!(await answers(server.url))) {
        const exited = children.get(server.name)?.exitCode;
        if (Date.now() > deadline || (exited !== null && exited !== undefined)) {
          throw new Error(`${server.name} server didn't start (${server.url}): test-results/servers/${server.name}.log`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
