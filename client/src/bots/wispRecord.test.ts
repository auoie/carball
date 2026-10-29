// Wisp's parity recording and strength matches (a tool, run on demand; skipped otherwise):
//   WISP_RECORD=FILE: scripted bot matches (1v1, 2v2, 3v3 of Wisp against itself) through our driver, builder, mask and
//     mirror, each decision's state (every car's fields the builder reads, the ball, the pads, the score, the tick count,
//     the shuffles' random draws, the previous action), observation, logits (onnxruntime), allowed rows, pick and row
//     written to FILE (NDJSON, the arrays as base64 float32; each tick's ball prediction once, its own line), for
//     scripts/wisp_parity.py to check against its references
//   WISP_MATCHES=FILE: Wisp against the other brains there are (the packages', the built-in chaser) in full matches,
//     each match's score written to FILE (JSON)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-web";
import { describe, expect, it } from "vitest";
import createEngine from "@engine/carball_engine.mjs";
import createHost from "@host/carball_host.mjs";
import { World, initEngine } from "../engine/world";
import { type BotBrain, type BotView, LocalBots, chaser } from "../local/bots";
import { LocalHost } from "../local/host";
import { arenaMeshes } from "../testing/arena";
import { lookupParser, parseTable } from "./actions";
import { tickSkipDriver } from "./driver";
import { type Controls8, parseManifest } from "./manifest";
import { OnnxPolicy } from "./policy";
import { loadBrain } from "./registry";
import { wispBuilder, wispCelebrate, wispMask, wispMirror } from "./wisp";

const ROOT = fileURLToPath(new URL("../../bots/", import.meta.url));
const RECORD = process.env["WISP_RECORD"];
const MATCHES = process.env["WISP_MATCHES"];
const files: typeof fetch = (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = `${ROOT}${url.replace(/^\/bots\//, "")}`;
  return Promise.resolve(existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 }));
};
const b64 = (a: ArrayLike<number>): string => Buffer.from(Float32Array.from(a).buffer).toString("base64");

/** A seeded random stream in [0, 1) */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A match of `teamSize` a side in the local host, `brains` in seat order (blue first), for `seconds` of ticks or (with
 *  `untilEnd`) until it ends (its pre-podium, at most `seconds`): its score */
async function play(teamSize: number, brains: readonly BotBrain[], seconds: number, seed: number, untilEnd = false): Promise<readonly [number, number]> {
  const meshes = arenaMeshes();
  const engine = await createEngine();
  initEngine(engine, meshes);
  const host = LocalHost.create(await createHost({ printErr: () => undefined }), meshes);
  host.open(teamSize, seed);
  const bots = new LocalBots(World.create(engine), teamSize * 2);
  brains.forEach((brain, i) => {
    const team = i < teamSize ? 0 : 1;
    bots.join(host, 2 + i, { team, name: `Bot ${String(i)}`, brain: "wisp" }, brain, 0);
  });
  let now = 0;
  for (let i = 0; i < seconds * 120; i++) {
    now = host.nextTick() ?? now + 1 / 120;
    await bots.beforeTick(host);
    host.tick(now);
    host.drain();
    if (untilEnd && i % 120 === 0 && [4, 7, 8].includes(host.phase(2) ?? -1)) break;
  }
  return host.score(2) ?? [0, 0];
}

describe.skipIf(RECORD === undefined)("Wisp's parity recording", () => {
  it("1v1, 2v2 and 3v3 of Wisp against itself, every decision written", async () => {
    const manifest = parseManifest(JSON.parse(readFileSync(`${ROOT}wisp/bot.json`, "utf8")));
    if (typeof manifest === "string") throw new Error(manifest);
    const table = parseTable(JSON.parse(readFileSync(`${ROOT}wisp/actions.json`, "utf8"))) as Controls8[];
    const policy = await OnnxPolicy.create(new Uint8Array(readFileSync(`${ROOT}wisp/policy.onnx`)), manifest.policy, ort);
    const parser = lookupParser(table);
    const mask = wispMask(table, 24);
    const lines: string[] = [];
    const predicted = new Set<string>();
    const v3 = (p: { readonly x: number; readonly y: number; readonly z: number }): number[] => [p.x, p.y, p.z];
    let match = 0;
    for (const [teamSize, seconds] of [
      [1, 60],
      [2, 30],
      [3, 20],
    ] as const) {
      match++;
      const brains = Array.from({ length: teamSize * 2 }, (_, seat) => {
        const stream = seeded(1000 * match + seat);
        const draws: number[] = [];
        const random = (): number => {
          const r = stream();
          draws.push(r);
          return r;
        };
        const builder = wispBuilder(random);
        return tickSkipDriver({
          tickSkip: manifest.tickSkip,
          applyAtCounter: manifest.timing?.applyAtCounter ?? manifest.tickSkip,
          moment: wispCelebrate,
          async decide(view: BotView, previous: Controls8) {
            draws.length = 0;
            const { state } = view;
            const key = `${String(match)}/${String(state.tickCount)}`;
            if (!predicted.has(key)) {
              predicted.add(key);
              lines.push(JSON.stringify({ kind: "prediction", match, tickCount: state.tickCount, path: b64(state.ballPrediction()) }));
            }
            const [input] = builder.build(view, previous);
            if (!input) throw new Error("no input");
            const logits = await policy.run([input]);
            const allowed = mask(view);
            const parsed = parser(logits, 1, Math.random, allowed);
            const row = wispMirror(view, parsed.row);
            const cars = state.cars.map((c) => ({
              pos: v3(c.pos),
              forward: v3(c.rot.forward),
              right: v3(c.rot.right),
              up: v3(c.rot.up),
              vel: v3(c.vel),
              angVel: v3(c.angVel),
              team: c.team,
              boost: c.boost,
              onGround: c.onGround,
              jumping: c.jumping,
              hasJumped: c.hasJumped,
              doubleJumped: c.doubleJumped,
              hasFlipped: c.hasFlipped,
              airTimeSinceJump: c.airTimeSinceJump,
              demoed: c.demoed,
              demoRespawnTimer: c.demoRespawnTimer,
              handbrakeVal: c.handbrakeVal,
              lastBallHitTick: c.lastBallHitTick,
            }));
            const ball = { pos: v3(state.ball.pos), vel: v3(state.ball.vel), angVel: v3(state.ball.angVel) };
            const pads = state.pads.map((p) => ({ pos: v3(p.pos), active: p.active, cooldown: p.cooldown }));
            lines.push(
              JSON.stringify({
                kind: "decision",
                match,
                teamSize,
                seat,
                tick: view.tick,
                self: view.self,
                state: { cars, ball, pads, score: state.score, tickCount: state.tickCount },
                draws: [...draws],
                previous,
                obs: b64(input.data),
                logits: b64(logits),
                allowed: allowed.map((a) => (a ? 1 : 0)),
                pick: parsed.pick,
                row,
              }),
            );
            return row;
          },
        });
      });
      await play(teamSize, brains, seconds, 40 + match);
    }
    writeFileSync(RECORD ?? "", `${lines.join("\n")}\n`);
    expect(lines.filter((l) => l.startsWith('{"kind":"decision"')).length).toBeGreaterThan(3000);
  }, 3_600_000);
});

describe.skipIf(MATCHES === undefined)("Wisp's strength matches", () => {
  it("Wisp against the other brains, full matches", async () => {
    const results: { readonly match: string; readonly score: readonly [number, number] }[] = [];
    const wisp = async (teamSize: number, seed: number): Promise<BotBrain> => loadBrain("/bots/", "wisp", teamSize, files, seeded(seed), ort);
    const other = async (id: string, teamSize: number, seed: number): Promise<BotBrain> => (id === "chaser" ? chaser() : loadBrain("/bots/", id, teamSize, files, seeded(seed), ort));
    const ids = ["chaser", ...(JSON.parse(readFileSync(`${ROOT}index.json`, "utf8")) as { bots: string[] }).bots.filter((id) => id !== "wisp")];
    let seed = 1;
    for (const id of ids) {
      for (const teamSize of [1, 3]) {
        for (const wispBlue of [true, false]) {
          seed++;
          const blue = await Promise.all(Array.from({ length: teamSize }, (_, i) => (wispBlue ? wisp(teamSize, seed * 10 + i) : other(id, teamSize, seed * 10 + i))));
          const orange = await Promise.all(Array.from({ length: teamSize }, (_, i) => (wispBlue ? other(id, teamSize, seed * 10 + 5 + i) : wisp(teamSize, seed * 10 + 5 + i))));
          const score = await play(teamSize, [...blue, ...orange], 15 * 60, seed, true);
          const [wispGoals, theirs] = wispBlue ? score : [score[1], score[0]];
          results.push({ match: `Wisp vs ${id} ${String(teamSize)}v${String(teamSize)} (Wisp ${wispBlue ? "blue" : "orange"})`, score: [wispGoals, theirs] });
          writeFileSync(MATCHES ?? "", JSON.stringify(results, null, 1));
        }
      }
    }
    expect(results.length).toBeGreaterThan(0);
  }, 24 * 3_600_000);
});
