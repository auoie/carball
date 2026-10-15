// The browser tests' servers (playwright.config.ts globalSetup): the production build's preview and the game servers,
// started and stopped by src/testing/serverProcesses.ts (half-second checks: Playwright's own webServer check waited
// 2 min 14 s a server where a closed local port drops the connection). Each server's output goes to
// test-results/servers/<name>.log.
import { type Server, startServers } from "../src/testing/serverProcesses";

// (every page from one address: no per-address session limits; the health ports apart)
const GAME = ["run", "--quiet", "--manifest-path", "../server/Cargo.toml", "--", "--max-per-address", "1000", "--max-per-address-per-minute", "100000"];
const SERVERS: readonly Server[] = [
  { name: "preview", command: "npx", args: ["vite", "preview", "--port", "4173", "--strictPort"], url: "http://localhost:4173/", reuse: true },
  // The game server for the online tests (the first run builds it)
  { name: "game", command: "cargo", args: [...GAME, "--port", "14433", "--health-port", "18081", "--info-port", "14434"], url: "http://127.0.0.1:14434/info", reuse: false },
  // One whose rounds end in a goal 1 s after go (the goal sequence's test)
  { name: "goal", command: "cargo", args: [...GAME, "--port", "14435", "--health-port", "18082", "--info-port", "14436", "--test-goal-after", "1"], url: "http://127.0.0.1:14436/info", reuse: false },
  // A 2v2 casual playlist whose forfeit votes are allowed once the clock runs (the forfeit and leave tests)
  {
    name: "forfeit",
    command: "cargo",
    args: [...GAME, "--port", "14437", "--health-port", "18083", "--info-port", "14438", "--team-size", "2", "--forfeit-vote-wait", "0"],
    url: "http://127.0.0.1:14438/info",
    reuse: false,
  },
  // The queue's matches (1v1, 2v2, 3v3: searches and claims; the queue test)
  { name: "queue", command: "cargo", args: [...GAME, "--port", "14439", "--health-port", "18084", "--info-port", "14440", "--mode", "queue", "--dev"], url: "http://127.0.0.1:14440/info", reuse: false },
];

/** The first run builds the game server */
const START_TIMEOUT_MS = 600_000;

export default async function globalSetup(): Promise<() => Promise<void>> {
  return startServers(SERVERS, START_TIMEOUT_MS, "test-results/servers");
}
