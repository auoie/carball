// T5 (notes/netcode-live.md §13, G2): how the client predicts other players' cars, three models compared on their
// corrections at a clean 50, 100 and 150 ms round trip: "fade" (ours before G2: the last server inputs on every frame,
// fading out), "game" (the game's rule, its SimulatedProxy: replicated throttle, steer and handbrake in full on new
// frames, the fade only inside a replay; jump, boost, dodge and air control not simulated) and "gameComponents" (the
// game's rule, the components run on the server's jump and boost). Inputs: real players' (replays' 2v2s, local data,
// skipped without it) and scripted bots. The decision (the static session's rule): the game's model unless
// "gameComponents" halves the other cars' corrections (median and 99th percentile) at every round trip without
// raising the ball's.
import { fileURLToPath } from "node:url";
import createEngine from "@engine/carball_engine.mjs";
import createHost from "@host/carball_host.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine } from "../engine/world";
import { LocalHost } from "../local/host";
import { arenaMeshes } from "../testing/arena";
import { type Driver, type Summary, netRun, summary } from "../testing/netRun";
import { constantProfile } from "../testing/netsim";
import { replayInputStreams } from "../testing/replayInputs";
import type { RemoteModel } from "./predictor";
import type { InputFrame } from "./protocol";

let engine: Awaited<ReturnType<typeof createEngine>>;
let host: LocalHost;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
  host = LocalHost.create(await createHost(), arenaMeshes());
});

const MODELS: readonly RemoteModel[] = ["fade", "game", "gameComponents"];
const RTTS = [50, 100, 150];
const SECONDS = 20;
/** Into each replay's streams (past the first kickoff's countdown) */
const SKIP_TICKS = 10 * 120;

const STATES = new URL("../../../out/replays/check/states.csv", import.meta.url);

interface Cell {
  readonly remote: Summary;
  readonly ball: Summary;
}

function compare(sources: readonly { readonly drive?: Driver; readonly seed: number }[]): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const rtt of RTTS) {
    for (const model of MODELS) {
      const remote: number[] = [];
      const ball: number[] = [];
      for (const source of sources) {
        const r = netRun(engine, host, {
          seconds: SECONDS,
          up: constantProfile(rtt / 2),
          down: constantProfile(rtt / 2),
          seed: source.seed,
          players: 4,
          model,
          ...(source.drive ? { drive: source.drive } : {}),
        });
        remote.push(...r.errors.remote);
        ball.push(...r.errors.ball);
      }
      cells.set(`${model}@${String(rtt)}`, { remote: summary(remote), ball: summary(ball) });
    }
  }
  return cells;
}

function table(name: string, cells: Map<string, Cell>): void {
  const lines = [`T5 ${name}: other cars' and the ball's corrections at capture, p50 / p99 (uu)`];
  for (const rtt of RTTS) {
    const row = MODELS.map((m) => {
      const c = cells.get(`${m}@${String(rtt)}`);
      return c ? `${m} cars ${c.remote.p50.toFixed(2)} / ${c.remote.p99.toFixed(1)}, ball ${c.ball.p50.toFixed(2)} / ${c.ball.p99.toFixed(1)}` : m;
    });
    lines.push(`  ${String(rtt)} ms: ${row.join("; ")}`);
  }
  console.info(lines.join("\n"));
}

/** The decision rule: "gameComponents" only if it halves the cars' p50 and p99 at every round trip, the ball no worse */
function componentsWin(cells: Map<string, Cell>): boolean {
  return RTTS.every((rtt) => {
    const game = cells.get(`game@${String(rtt)}`);
    const comp = cells.get(`gameComponents@${String(rtt)}`);
    if (!game || !comp) return false;
    // (the ball's mean: its p99 is 0 in every cell, RV-326)
    return comp.remote.p50 <= game.remote.p50 / 2 && comp.remote.p99 <= game.remote.p99 / 2 && comp.ball.mean <= game.ball.mean;
  });
}

/** The game's model on its own (RV-1036: "not beaten by half" alone passed a model that predicted nothing well): its cars'
 *  p50 and p99 within these bounds at each round trip (uu), its p99 no worse than the fading model's */
function gameModelHolds(cells: Map<string, Cell>, p50: (rtt: number) => number, p99: (rtt: number) => number): void {
  for (const rtt of RTTS) {
    const game = cells.get(`game@${String(rtt)}`);
    const fade = cells.get(`fade@${String(rtt)}`);
    expect(game, `${String(rtt)} ms`).toBeDefined();
    if (!game || !fade) continue;
    expect(game.remote.p50, `p50 at ${String(rtt)} ms`).toBeLessThanOrEqual(p50(rtt));
    expect(game.remote.p99, `p99 at ${String(rtt)} ms`).toBeLessThanOrEqual(p99(rtt));
    expect(game.remote.p99, `p99 against the fade's at ${String(rtt)} ms`).toBeLessThanOrEqual(fade.remote.p99);
  }
}

describe("T5: predicting other players' cars", () => {
  it("scripted bots: the game's model, not beaten by half", () => {
    const cells = compare([{ seed: 3 }]);
    table("bots", cells);
    expect(componentsWin(cells)).toBe(false);
    // (measured: p50 4.5 / 8.3 / 15.7, p99 19.4 / 30.2 / 45.3 at 50 / 100 / 150 ms)
    gameModelHolds(
      cells,
      (rtt) => 0.12 * rtt,
      (rtt) => 0.45 * rtt,
    );
  }, 600_000);

  const streams = replayInputStreams(fileURLToPath(STATES), (name) => name.startsWith("2v2_"));
  it.skipIf(streams === null)(
    "real players' inputs (replays, local data): the game's model, not beaten by half",
    () => {
      const replays = [...(streams ?? new Map<string, InputFrame[][]>()).entries()].filter(([, s]) => s.length >= 4).slice(0, 2);
      expect(replays.length).toBe(2);
      const sources = replays.map(([, players], i) => ({
        seed: 11 + i,
        drive: ((player, frame) => {
          const stream = players[player] ?? [];
          return stream[(SKIP_TICKS + frame) % Math.max(1, stream.length)] ?? { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, dodgeForward: 0, bits: 0 };
        }) satisfies Driver,
      }));
      const cells = compare(sources);
      table("replay inputs", cells);
      expect(componentsWin(cells)).toBe(false);
      // (measured: p50 3.8 / 8.4 / 12.0, p99 51.3 / 76.5 / 92.3)
      gameModelHolds(
        cells,
        (rtt) => 0.12 * rtt,
        (rtt) => 0.7 * rtt + 20,
      );
    },
    900_000,
  );
});
