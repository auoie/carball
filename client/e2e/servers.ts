// The browser tests' servers (playwright.config.ts globalSetup): the production build's preview and the game servers,
// started and stopped by src/testing/serverProcesses.ts (half-second checks: Playwright's own webServer check waited
// 2 min 14 s a server where a closed local port drops the connection). Each server's output goes to
// test-results/servers/<name>.log.
import { type Server, startServers } from "../src/testing/serverProcesses";

// (the tests against an image's binaries, taken out of it: CARBALL_E2E_GAME_BIN and CARBALL_E2E_API_BIN in place of cargo's
// and go's builds, the game server given the repository's meshes)
const GAME_BIN = process.env.CARBALL_E2E_GAME_BIN;
const API_BIN = process.env.CARBALL_E2E_API_BIN;
const GAME_COMMAND = GAME_BIN ?? "cargo";
const MESHES = new URL("../../out/arena/collision_meshes", import.meta.url).pathname;
// (every page from one address: no per-address session limits; the health ports apart; every match on Night, the one map)
const GAME = [
  ...(GAME_BIN === undefined ? ["run", "--quiet", "--manifest-path", "../server/Cargo.toml", "--"] : ["--meshes", MESHES]),
  "--max-per-address",
  "1000",
  "--max-per-address-per-minute",
  "100000",
];
/** A development matchmaker (`carball-api matchmaker --dev`: notes/matchmaking.md, the central matchmaker) on `port`,
 *  built from the API's module offline */
const matchmaker = (name: string, port: number): Server => ({
  name,
  command: API_BIN ?? "go",
  args: [...(API_BIN === undefined ? ["-C", "../api", "run", "./cmd/carball-api"] : []), "matchmaker", "--dev", "--listen", `127.0.0.1:${String(port)}`],
  url: `http://127.0.0.1:${String(port)}/healthz`,
  reuse: false,
  env: { GOFLAGS: "-mod=readonly", GOPROXY: "off" },
});

const SERVERS: readonly Server[] = [
  // (the development matchmakers below behind it, same-origin as a deployment's: /dev-matchmaker/PORT, RV-911)
  {
    name: "preview",
    command: "node_modules/.bin/vite",
    args: ["preview", "--port", "4173", "--strictPort"],
    url: "http://localhost:4173/",
    reuse: true,
    env: { CARBALL_PREVIEW_MATCHMAKERS: "14450,14451,14452" },
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
  // The development matchmakers, one for each group of the specs that search (their matches apart): the queue test's,
  // the queue's edge cases', the regions'
  matchmaker("matchmaker-queue", 14450),
  matchmaker("matchmaker-edges", 14451),
  matchmaker("matchmaker-regions", 14452),
  // The matchmaker's matches (1v1, 2v2, 3v3: claims; the queue test)
  {
    name: "queue",
    command: GAME_COMMAND,
    args: [...GAME, "--port", "14439", "--health-port", "18084", "--info-port", "14440", "--mode", "queue", "--dev", "--api-url", "http://127.0.0.1:14450"],
    url: "http://127.0.0.1:14440/info",
    reuse: false,
  },
  // Another for the queue's edge cases (e2e/queueEdges.spec.ts, in order: its matches apart from the queue test's, and
  // its one no-show's cooldown its own)
  {
    name: "queue-edges",
    command: GAME_COMMAND,
    args: [...GAME, "--port", "14441", "--health-port", "18085", "--info-port", "14442", "--mode", "queue", "--dev", "--api-url", "http://127.0.0.1:14451"],
    url: "http://127.0.0.1:14442/info",
    reuse: false,
  },
  // Two regions' servers (e2e/regions.spec.ts: a search of both, notes/matchmaking.md, Regions)
  {
    name: "region-a",
    command: GAME_COMMAND,
    args: [...GAME, "--port", "14445", "--health-port", "18087", "--info-port", "14446", "--mode", "queue", "--dev", "--api-url", "http://127.0.0.1:14452"],
    url: "http://127.0.0.1:14446/info",
    reuse: false,
  },
  // (its name for the matchmaker unlike its URL's host: the page sends the name its Pong says, RV-863)
  {
    name: "region-b",
    command: GAME_COMMAND,
    args: [
      ...GAME,
      "--port",
      "14447",
      "--health-port",
      "18088",
      "--info-port",
      "14448",
      "--mode",
      "queue",
      "--dev",
      "--api-url",
      "http://127.0.0.1:14452",
      "--public-host",
      "Region-B.Test",
    ],
    url: "http://127.0.0.1:14448/info",
    reuse: false,
  },
];

/** The first run builds the game server */
const START_TIMEOUT_MS = 600_000;

export default async function globalSetup(): Promise<() => Promise<void>> {
  const stop = await startServers(SERVERS, START_TIMEOUT_MS, "test-results/servers");
  // (a preview already running is reused: one started without the development matchmakers behind it would fail the
  // searching specs with bare 404s, so said here instead, RV-923)
  for (const port of ["14450", "14451", "14452"]) {
    const answer = await fetch(`http://localhost:4173/dev-matchmaker/${port}/healthz`).catch(() => null);
    if (answer?.status !== 200) {
      await stop();
      throw new Error(
        `the preview on :4173 has no development matchmaker at /dev-matchmaker/${port} (a preview started without CARBALL_PREVIEW_MATCHMAKERS, reused?): stop it and run again`,
      );
    }
  }
  return stop;
}
