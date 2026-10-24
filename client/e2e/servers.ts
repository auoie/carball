// The local browser tests' servers (playwright.config.ts globalSetup; the specs that search have the services' stacks
// instead, e2e/services): the production build's preview and the game servers (the e2e build: its test hooks),
// started and stopped by src/testing/serverProcesses.ts (half-second checks: Playwright's own webServer check waited
// 2 min 14 s a server where a closed local port drops the connection). Each server's output goes to
// test-results/servers/<name>.log.
import { type Server, startServers } from "../src/testing/serverProcesses";

// (the tests against an image's binary, taken out of it: CARBALL_E2E_GAME_BIN in place of cargo's build, the game-e2e
// image's (the hooks the goal and forfeit servers use), given the repository's meshes)
const GAME_BIN = process.env.CARBALL_E2E_GAME_BIN;
const GAME_COMMAND = GAME_BIN ?? "cargo";
const MESHES = new URL("../../out/arena/collision_meshes", import.meta.url).pathname;
// (every page from one address: no per-address session limits; the health ports apart; every match on Night, the one map)
const GAME = [
  ...(GAME_BIN === undefined ? ["run", "--quiet", "--features", "e2e", "--manifest-path", "../server/Cargo.toml", "--"] : ["--meshes", MESHES]),
  "--max-per-address",
  "1000",
  "--claims-per-address",
  "100000/100000",
  "--pings-per-address",
  "100000/100000",
];
const SERVERS: readonly Server[] = [
  {
    name: "preview",
    command: "node_modules/.bin/vite",
    args: ["preview", "--port", "4173", "--strictPort"],
    url: "http://localhost:4173/",
    reuse: true,
  },
  // The game server for the online tests (the first run builds it)
  {
    name: "game",
    command: GAME_COMMAND,
    args: [...GAME, "--port", "14433", "--health-port", "18081", "--info-port", "14434"],
    url: "http://127.0.0.1:14434/info",
    reuse: false,
  },
  // The pad's online menu test's own (e2e/padmenus.spec.ts: its match never shared with the online tests' in the other
  // worker, whose players would join it)
  {
    name: "pad",
    command: GAME_COMMAND,
    args: [...GAME, "--port", "14443", "--health-port", "18086", "--info-port", "14444"],
    url: "http://127.0.0.1:14444/info",
    reuse: false,
  },
  // The thumb buttons' test's own (e2e/mouseButtons.spec.ts: its player alone in its match, never another spec's)
  {
    name: "mouse",
    command: GAME_COMMAND,
    args: [...GAME, "--port", "14445", "--health-port", "18087", "--info-port", "14446"],
    url: "http://127.0.0.1:14446/info",
    reuse: false,
  },
  // One whose rounds end in a goal 1 s after go (the goal sequence's test)
  {
    name: "goal",
    command: GAME_COMMAND,
    args: [...GAME, "--port", "14435", "--health-port", "18082", "--info-port", "14436", "--test-goal-after", "1"],
    url: "http://127.0.0.1:14436/info",
    reuse: false,
  },
  // A 2v2 casual playlist whose forfeit votes are allowed once the clock runs (the forfeit and leave tests)
  {
    name: "forfeit",
    command: GAME_COMMAND,
    args: [...GAME, "--port", "14437", "--health-port", "18083", "--info-port", "14438", "--team-size", "2", "--forfeit-vote-wait", "0"],
    url: "http://127.0.0.1:14438/info",
    reuse: false,
  },
];

/** The first run builds the game server */
const START_TIMEOUT_MS = 600_000;

/** The local servers, unless the run is the services' alone (`npm run e2e:services`: none of its specs uses them) */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.CARBALL_E2E_SERVICES_ONLY === "1") return async () => Promise.resolve();
  return startServers(SERVERS, START_TIMEOUT_MS, "test-results/servers");
}
