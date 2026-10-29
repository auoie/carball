// Wisp's port (bots/wisp.ts) on made-up states: its action table and mask (counts worked out from action_parser.py's
// rules), its geometry (the arena's SDF, the corner walls), its ETA's cases, its mirror and moments, its observation's
// layout; against Wisp's own observation and mask (golden vectors, src/testing/wisp.vectors.json: its Python run once in a
// sandbox on recorded states, RV-1190); then its package in the local host's 1v1 (it plays: the ball moves, no brain
// fails).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-web";
import { describe, expect, it, vi } from "vitest";
import createEngine from "@engine/carball_engine.mjs";
import createHost from "@host/carball_host.mjs";
import { World, initEngine } from "../engine/world";
import { BALL_PREDICTION_TICKS, BALL_SLICE, type BotCar, type BotView, LocalBots } from "../local/bots";
import { LocalHost } from "../local/host";
import { arenaMeshes } from "../testing/arena";
import { maskLogits, parseTable } from "./actions";
import { ZERO_ROW } from "./driver";
import type { Controls8 } from "./manifest";
import { loadBrain } from "./registry";
import { WISP_OBS_SIZE, linearEta, mirrorsX, sdfWallDist, wispBuilder, wispCelebrate, wispMask, wispMirror } from "./wisp";

const ROOT = fileURLToPath(new URL("../../bots/", import.meta.url));
/** A seeded random stream in [0, 1) (mulberry32) */
const seeded = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const PRESENT = existsSync(`${ROOT}wisp/bot.json`);
const files: typeof fetch = (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = `${ROOT}${url.replace(/^\/bots\//, "")}`;
  return Promise.resolve(existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 }));
};

const zero = { x: 0, y: 0, z: 0 };
const car = (over: Partial<BotCar> = {}): BotCar => ({
  pos: { x: 0, y: -4608, z: 17 },
  vel: zero,
  angVel: zero,
  rot: { forward: { x: 0, y: 1, z: 0 }, right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  team: 0,
  boost: 33,
  onGround: true,
  jumping: false,
  hasJumped: false,
  doubleJumped: false,
  hasFlipped: false,
  airTimeSinceJump: 0,
  demoed: false,
  demoRespawnTimer: 0,
  handbrakeVal: 0,
  lastBallHitTick: -1,
  ...over,
});
/** A ball prediction: the ball resting at the centre spot */
const restingPath = (): Float32Array => {
  const path = new Float32Array(BALL_PREDICTION_TICKS * BALL_SLICE);
  for (let i = 0; i < BALL_PREDICTION_TICKS; i++) path[i * BALL_SLICE + 2] = 93;
  return path;
};
const view = (cars: BotCar[], over: Partial<BotView["state"]> & { self?: number; tick?: number } = {}): BotView => ({
  state: {
    cars,
    ball: { pos: { x: 0, y: 0, z: 93 }, vel: zero, angVel: zero },
    pads: [],
    score: [0, 0],
    tickCount: 100,
    goalScored: false,
    matchEnded: false,
    ballPrediction: restingPath,
    ...over,
  },
  self: over.self ?? 0,
  tick: over.tick ?? 0,
});
/** Our arena's pads (the engine's), all up */
async function arenaPads(): Promise<BotView["state"]["pads"]> {
  const engine = await createEngine();
  initEngine(engine, arenaMeshes());
  const world = World.create(engine);
  const pads = world.boostPads().map((p) => ({ pos: p.pos, active: true, cooldown: 0 }));
  world.dispose();
  return pads;
}

const table = PRESENT ? (parseTable(JSON.parse(readFileSync(`${ROOT}wisp/actions.json`, "utf8"))) as Controls8[]) : [];

describe.skipIf(!PRESENT)("Wisp's action table and mask", () => {
  it("90 rows: 24 on the ground, then 66 in the air; the boost only at full throttle on the ground", () => {
    expect(table).toHaveLength(90);
    expect(table.slice(0, 24).every((r) => r[2] === 0 && r[4] === 0 && r[5] === 0 && r[1] === r[3] && (r[6] === 0 || r[0] === 1))).toBe(true);
    // (an air row: throttle = boost; no jump with yaw; never pitch, roll and jump all 0; the handbrake with a turning jump)
    expect(table.slice(24).every((r) => r[0] === r[6] && r[1] === r[3] && !(r[5] === 1 && r[3] !== 0) && !(r[2] === 0 && r[4] === 0 && r[5] === 0))).toBe(true);
    expect(table.slice(24).every((r) => r[7] === (r[5] === 1 && (r[2] !== 0 || r[3] !== 0 || r[4] !== 0) ? 1 : 0))).toBe(true);
  });

  it("allowed rows: the ground's and every jump; in the air its air rows (the first aerial left out), the jumps with a flip", () => {
    const mask = wispMask(table, 24);
    const count = (c: BotCar): number => mask(view([c])).filter((a) => a).length;
    // (24 ground + 18 jumps; no boost: 6 boosting ground rows out, the jumps all back; air: 47 aerial + 6 turning ground
    // rows, + 18 jumps while a flip is there; no boost: 27 of the 53 boost)
    expect(count(car())).toBe(42);
    expect(count(car({ boost: 0 }))).toBe(36);
    expect(count(car({ onGround: false, airTimeSinceJump: 0.5 }))).toBe(71);
    expect(count(car({ onGround: false, hasFlipped: true }))).toBe(53);
    expect(count(car({ onGround: false, hasFlipped: true, boost: 0 }))).toBe(26);
    expect(mask(view([car({ onGround: false, hasFlipped: true })]))[24]).toBe(false);
    // (on its roof, low and still: the jumps back)
    const turtle = car({ onGround: false, hasFlipped: true, pos: { x: 0, y: 0, z: 30 }, rot: { forward: { x: 1, y: 0, z: 0 }, right: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: -1 } } });
    expect(count(turtle)).toBe(71);
  });

  it("a masked pick: the other rows pushed down, none allowed meaning all", () => {
    const logits = Float32Array.from({ length: 90 }, (_, i) => i);
    const allowed = table.map((_, i) => i === 3);
    expect(Array.from(maskLogits(logits, allowed)).indexOf(3)).toBe(3);
    expect(Math.max(...Array.from(maskLogits(logits, allowed)))).toBe(3);
    expect(maskLogits(logits, table.map(() => false))).toBe(logits);
  });
});

describe("Wisp's geometry and estimates", () => {
  it("the arena's SDF: the floor's and the ceiling's distance at the centre, the side wall's near it, negative outside", () => {
    expect(sdfWallDist([0, 0, 17])).toBeCloseTo(17, 3);
    expect(sdfWallDist([0, 0, 1022])).toBeCloseTo(1022, 3);
    expect(sdfWallDist([4000, 0, 1022])).toBeCloseTo(96, 3);
    expect(sdfWallDist([0, 0, -40])).toBeLessThan(0);
    // (into a goal: inside its box, which the original leaves shrunk by its rounding: at its mid-height alone)
    expect(sdfWallDist([0, 5500, 320])).toBeCloseTo(40, 0);
    expect(sdfWallDist([0, 5500, 200])).toBeLessThan(0);
  });

  it("the ETA: at top speed the distance over 2300; past the throttle's top without boost, over the speed", () => {
    expect(linearEta(2300, 900, 3)).toBeCloseTo(900 / 2300, 12);
    expect(linearEta(1500, 3000, 0)).toBeCloseTo(2, 12);
    // (from rest with boost: sooner than without, both positive)
    expect(linearEta(0, 2000, 1)).toBeLessThan(linearEta(0, 2000, 0));
    expect(linearEta(0, 2000, 1)).toBeGreaterThan(0);
  });

  it("the mirror: blue at x < 0 and orange at x >= 0 see x mirrored (each then at +x); a row picked there turns back", () => {
    expect([mirrorsX(0, 100), mirrorsX(0, -100), mirrorsX(1, 100), mirrorsX(1, -100)]).toEqual([false, true, true, false]);
    const row: Controls8 = [1, 0.5, 1, -1, 1, 1, 0, 1];
    expect(wispMirror(view([car({ pos: { x: -500, y: 0, z: 17 } })]), row)).toEqual([1, -0.5, 1, 1, -1, 1, 0, 1]);
    expect(wispMirror(view([car({ pos: { x: 500, y: 0, z: 17 } })]), row)).toBe(row);
  });

  it("the moments: after a goal it drives on (nose up while upright), at the end it reverses; in play nothing", () => {
    expect(wispCelebrate(view([car()]))).toBeNull();
    const goal = wispCelebrate(view([car()], { goalScored: true }));
    expect(goal?.[0]).toBe(1);
    expect(goal?.[2]).toBe(1);
    expect(goal?.[4]).toBe(1);
    expect(wispCelebrate(view([car()], { matchEnded: true }))?.[0]).toBe(-1);
  });
});

describe("Wisp's observation", () => {
  it("432 floats; the kickoff flag at the centre spot; an empty seat's 51 zeros; the score's sign", async () => {
    const cars = [car(), car({ team: 1, pos: { x: 0, y: 4608, z: 17 }, rot: { forward: { x: 0, y: -1, z: 0 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } } })];
    const pads = await arenaPads();
    const builder = wispBuilder(() => 0);
    const [input] = builder.build(view(cars, { pads, score: [0, 2] }), ZERO_ROW);
    expect(input?.shape).toEqual([1, WISP_OBS_SIZE]);
    const obs = input?.data ?? new Float32Array(0);
    expect(obs).toHaveLength(WISP_OBS_SIZE);
    expect(obs[15]).toBe(1);
    // (the score: behind by 2, clipped to -1; then turning, touch, handbrake; the bot's 51; 2 mates' and 3 opponents')
    expect(obs[122]).toBe(-1);
    const seats = Array.from({ length: 5 }, (_, k) => Array.from(obs.subarray(177 + k * 51, 228 + k * 51)));
    expect(seats.filter((s) => s.every((x) => x === 0))).toHaveLength(4);
    // (orange sees the field turned: its own position as blue's would be)
    const [orange] = wispBuilder(() => 0).build(view(cars, { pads, self: 1 }), ZERO_ROW);
    const plain = (a: ArrayLike<number>): number[] => Array.from(a, (x) => x + 0);
    expect(plain(orange?.data.subarray(126, 129) ?? [])).toEqual(plain(obs.subarray(126, 129)));
  });
});

/** A golden vector: a recorded decision (our engine's state), the shuffles' draws, and Wisp's own observation and mask */
interface Golden {
  readonly self: number;
  readonly tick: number;
  readonly state: {
    readonly cars: readonly (Omit<BotCar, "pos" | "vel" | "angVel" | "rot"> & Record<"pos" | "vel" | "angVel" | "forward" | "right" | "up", readonly [number, number, number]>)[];
    readonly ball: Record<"pos" | "vel" | "angVel", readonly [number, number, number]>;
    readonly pads: readonly { readonly pos: readonly [number, number, number]; readonly active: boolean; readonly cooldown: number }[];
    readonly score: readonly [number, number];
    readonly tickCount: number;
  };
  readonly draws: readonly number[];
  readonly previous: Controls8;
  readonly slices: Readonly<Record<string, readonly number[]>>;
  readonly obs: readonly number[];
  readonly mask: readonly number[];
}
const GOLDEN = (JSON.parse(readFileSync(fileURLToPath(new URL("../testing/wisp.vectors.json", import.meta.url)), "utf8")) as { cases: Golden[] }).cases;
/** Each player's ETA (its 49th float): rough_eta's history across decisions, not in a vector */
const ETAS = new Set([0, 1, 2, 3, 4, 5].map((k) => 126 + k * 51 + 48));

describe.skipIf(!PRESENT)("Wisp's observation and mask against Wisp's own (golden vectors, RV-1190)", () => {
  it("every feature within 1e-6 but the ETAs, the mask exactly, on each recorded decision", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(15);
    const v = ([x, y, z]: readonly [number, number, number]): { x: number; y: number; z: number } => ({ x, y, z });
    const mask = wispMask(table, 24);
    const off: string[] = [];
    for (const [n, g] of GOLDEN.entries()) {
      const path = new Float32Array(BALL_PREDICTION_TICKS * BALL_SLICE);
      for (const [at, slice] of Object.entries(g.slices)) path.set(slice, Number(at) * BALL_SLICE);
      const cars = g.state.cars.map(({ pos, vel, angVel, forward, right, up, ...flags }) => ({ ...flags, pos: v(pos), vel: v(vel), angVel: v(angVel), rot: { forward: v(forward), right: v(right), up: v(up) } }));
      const at: BotView = {
        state: {
          cars,
          ball: { pos: v(g.state.ball.pos), vel: v(g.state.ball.vel), angVel: v(g.state.ball.angVel) },
          pads: g.state.pads.map((p) => ({ ...p, pos: v(p.pos) })),
          score: g.state.score,
          tickCount: g.state.tickCount,
          goalScored: false,
          matchEnded: false,
          ballPrediction: () => path,
        },
        self: g.self,
        tick: g.tick,
      };
      const draws = [...g.draws];
      const [input] = wispBuilder(() => draws.shift() ?? Number.NaN).build(at, g.previous);
      const obs = input?.data ?? new Float32Array(0);
      g.obs.forEach((want, i) => {
        if (!ETAS.has(i) && !(Math.abs((obs[i] ?? Number.NaN) - want) <= 1e-6)) off.push(`case ${String(n)} [${String(i)}] ${String(obs[i])} vs ${String(want)}`);
      });
      const allowed = mask(at).map((a) => (a ? 1 : 0));
      if (JSON.stringify(allowed) !== JSON.stringify(g.mask)) off.push(`case ${String(n)}: its mask`);
    }
    expect(off.slice(0, 8)).toEqual([]);
  });
});

describe.skipIf(!PRESENT)("Wisp in the local host", () => {
  it("a 1v1 of Wisp against itself: both brains run, the ball is hit, none fails", async () => {
    const failures = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const meshes = arenaMeshes();
    const engine = await createEngine();
    initEngine(engine, meshes);
    const host = LocalHost.create(await createHost({ printErr: () => undefined }), meshes);
    host.open(1, 5);
    const bots = new LocalBots(World.create(engine), 2);
    // (each its own seeded shuffles: the same match every run)
    bots.join(host, 2, { team: 0, name: "Wisp 1", brain: "wisp" }, await loadBrain("/bots/", "wisp", 1, files, seeded(11), ort), 0);
    bots.join(host, 3, { team: 1, name: "Wisp 2", brain: "wisp" }, await loadBrain("/bots/", "wisp", 1, files, seeded(12), ort), 0);
    const world = World.create(engine);
    let now = 0;
    let fastest = 0;
    for (let i = 0; i < 12 * 120; i++) {
      now = host.nextTick() ?? now + 1 / 120;
      await bots.beforeTick(host);
      host.tick(now);
      host.drain();
      if (i % 10 === 0) {
        world.loadState(host.state(2));
        const { vel } = world.ball();
        fastest = Math.max(fastest, Math.hypot(vel.x, vel.y, vel.z));
      }
    }
    expect(failures).not.toHaveBeenCalled();
    // (hit: a kickoff's touch sends it well over 500 uu/s, even a head-on one that leaves it near the spot)
    expect(fastest).toBeGreaterThan(500);
    failures.mockRestore();
  }, 300_000);
});
