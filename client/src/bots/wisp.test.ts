// Wisp's port (bots/wisp.ts) on made-up states: its action table and mask (counts worked out from action_parser.py's
// rules), its geometry (the arena's SDF, the corner walls), its ETA's cases, its mirror and moments, its observation's
// layout; then its package in the local host's 1v1 (it plays: the ball moves, no brain fails).
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
    kickoffPause: false,
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

describe.skipIf(!PRESENT)("Wisp in the local host", () => {
  it("a 1v1 of Wisp against itself: both brains run, the ball moves, none fails", async () => {
    const failures = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const meshes = arenaMeshes();
    const engine = await createEngine();
    initEngine(engine, meshes);
    const host = LocalHost.create(await createHost({ printErr: () => undefined }), meshes);
    host.open(1, 5);
    const bots = new LocalBots(World.create(engine), 2);
    bots.join(host, 2, { team: 0, name: "Wisp 1", brain: "wisp" }, await loadBrain("/bots/", "wisp", 1, files, Math.random, ort), 0);
    bots.join(host, 3, { team: 1, name: "Wisp 2", brain: "wisp" }, await loadBrain("/bots/", "wisp", 1, files, Math.random, ort), 0);
    const world = World.create(engine);
    let now = 0;
    let moved = 0;
    for (let i = 0; i < 12 * 120; i++) {
      now = host.nextTick() ?? now + 1 / 120;
      await bots.beforeTick(host);
      host.tick(now);
      host.drain();
      if (i % 60 === 0) {
        world.loadState(host.state(2));
        moved = Math.max(moved, Math.hypot(world.ball().pos.x, world.ball().pos.y));
      }
    }
    expect(failures).not.toHaveBeenCalled();
    expect(moved).toBeGreaterThan(200);
    failures.mockRestore();
  }, 300_000);
});
