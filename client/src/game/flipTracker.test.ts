// The flip indicator's state against the real engine (requires engine/build-wasm and out/arena): what it says is
// available is what the engine allows when the player presses, tick for tick, and flip resets are seen when the wheels
// touch the ball.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createEngine from "@engine/rlengine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type CarControls, NO_CONTROLS, type RbActor, World, initEngine } from "../engine/world";
import { type Rot3, ZERO, vec3 } from "../math/vec";
import { DODGE_WINDOW, type FlipTick, FlipTracker } from "./flipTracker";

const TICK = 1 / 120;
const UPRIGHT: Rot3 = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) };
const UPSIDE_DOWN: Rot3 = { forward: vec3(1, 0, 0), right: vec3(0, -1, 0), up: vec3(0, 0, -1) };

let engine: Awaited<ReturnType<typeof createEngine>>;
beforeAll(async () => {
  const arenaPath = fileURLToPath(new URL("../../../out/arena/collision_meshes/soccar/soccar_arena.cmf", import.meta.url));
  engine = await createEngine();
  initEngine(engine, [new Uint8Array(readFileSync(arenaPath))]);
});

/** A world with one car, stepped tick by tick with the tracker following it. */
function rig(): { world: World; car: number; tracker: FlipTracker; step: (c?: CarControls) => FlipTick } {
  const world = World.create(engine);
  const car = world.addCar(0);
  world.resetKickoff(1);
  const tracker = new FlipTracker();
  const step = (c: CarControls = NO_CONTROLS): FlipTick => {
    world.setControls(car, c);
    world.step();
    return tracker.tick(world.car(car), TICK);
  };
  return { world, car, tracker, step };
}

/** Upside down on the ceiling, then jumping down from it: a long way to fall, so the dodge window can run out. */
function jumpFromCeiling(): ReturnType<typeof rig> {
  const r = rig();
  r.world.setCar(r.car, { pos: vec3(0, 0, 2044 - 18), vel: ZERO, angVel: ZERO, rot: UPSIDE_DOWN, boost: 0 });
  for (let i = 0; i < 5; i++) r.step();
  expect(r.world.car(r.car).onGround).toBe(true); // (on the ceiling, for a moment: without throttle it falls off)
  for (let i = 0; i < 3; i++) r.step({ ...NO_CONTROLS, jump: true });
  return r;
}

describe("FlipTracker against the engine", () => {
  it("the dodge window: available exactly while the engine still lets the car dodge", () => {
    // Press dodge on tick n + 1 after reading the tracker on tick n, for every n across the window's end
    const results: { said: boolean; flipped: boolean }[] = [];
    for (let n = 130; n <= 175; n++) {
      const r = jumpFromCeiling();
      let tick: FlipTick = r.step();
      for (let i = 1; i < n; i++) tick = r.step();
      expect(r.world.car(r.car).onGround).toBe(false); // (still falling)
      r.step({ ...NO_CONTROLS, jump: true, pitch: -1 });
      results.push({ said: tick.dodge.kind === "window", flipped: r.world.car(r.car).hasFlipped });
      r.world.dispose();
    }
    // Both outcomes occur, and the tracker agrees with the engine every time
    expect(results.some((x) => x.flipped)).toBe(true);
    expect(results.some((x) => !x.flipped)).toBe(true);
    expect(results.map((x) => x.said)).toEqual(results.map((x) => x.flipped));
  });

  it("counts the window down from the jump's end, and spends it on a dodge", () => {
    const r = jumpFromCeiling();
    const windows: number[] = [];
    for (let i = 0; i < 60; i++) {
      const { dodge } = r.step();
      if (dodge.kind === "window") windows.push(dodge.remaining);
    }
    expect(windows.length).toBeGreaterThan(30);
    expect(windows[0]).toBeLessThanOrEqual(DODGE_WINDOW);
    for (let i = 1; i < windows.length; i++) expect(windows[i]).toBeLessThan(windows[i - 1] ?? Infinity);
    expect(r.step({ ...NO_CONTROLS, jump: true, pitch: -1 }).dodge.kind).toBe("spent");
    r.world.dispose();
  });

  it("in the air without having jumped: a dodge with no time limit", () => {
    const r = rig();
    r.world.setCar(r.car, { pos: vec3(0, 0, 1800), vel: ZERO, angVel: ZERO, rot: UPRIGHT, boost: 0 });
    let tick = r.step();
    for (let i = 0; i < 200; i++) tick = r.step(); // (longer than the window)
    expect(tick.dodge).toEqual({ kind: "free", reset: false });
    r.step({ ...NO_CONTROLS, jump: true, pitch: -1 });
    expect(r.world.car(r.car).hasFlipped).toBe(true);
    r.world.dispose();
  });

  it("a flip reset: wheels on the ball in mid-air give the dodge back, and the engine agrees", () => {
    const r = rig();
    // The car above the ball, both in the air; it spends its dodge on a double jump, then comes down onto the ball
    r.world.setCar(r.car, { pos: vec3(0, 0, 1100), vel: ZERO, angVel: ZERO, rot: UPRIGHT, boost: 0 });
    r.world.setBall({ pos: vec3(0, 0, 500), vel: vec3(0, 0, 1300), angVel: ZERO }); // (rising to meet it, hard enough to bounce it off)
    r.step();
    expect(r.step({ ...NO_CONTROLS, jump: true }).dodge.kind).toBe("spent");
    const resets: RbActor[] = [];
    let tick = r.step();
    for (let i = 0; i < 150 && tick.dodge.kind !== "free"; i++) {
      tick = r.step();
      if (tick.reset) resets.push(tick.reset);
    }
    expect(resets).toEqual([{ kind: "ball" }]);
    expect(tick.dodge).toEqual({ kind: "free", reset: true });
    r.step({ ...NO_CONTROLS, jump: true, pitch: -1 });
    expect(r.world.car(r.car).hasFlipped).toBe(true);
    r.world.dispose();
  });

  it("a flip reset off another car's roof", () => {
    const world = World.create(engine);
    const [car, other] = [world.addCar(0), world.addCar(1)];
    world.resetKickoff(1);
    // The other car parked on the floor, away from the ball; this one dropped onto its roof, wheels down
    world.setCar(other, { pos: vec3(2000, 2000, 17), vel: ZERO, angVel: ZERO, rot: UPRIGHT, boost: 0 });
    world.setCar(car, { pos: vec3(2000, 2000, 300), vel: ZERO, angVel: ZERO, rot: UPRIGHT, boost: 0 });
    const tracker = new FlipTracker();
    const resets: RbActor[] = [];
    for (let i = 0; i < 120; i++) {
      world.step();
      const tick = tracker.tick(world.car(car), TICK);
      if (tick.reset) resets.push(tick.reset);
    }
    // Resting on it, all four wheels on that car; one reset, off that car
    expect(world.car(car).rbActor).toEqual({ kind: "car", id: other });
    expect(world.car(car).wheelGround).toEqual(["car", "car", "car", "car"]);
    expect(resets).toEqual([{ kind: "car", id: other }]);
    world.dispose();
  });

  it("landing on the floor beside the ball is not a flip reset", () => {
    const r = rig();
    r.world.setBall({ pos: vec3(0, 0, 93), vel: ZERO, angVel: ZERO });
    r.world.setCar(r.car, { pos: vec3(0, 170, 400), vel: ZERO, angVel: ZERO, rot: UPRIGHT, boost: 0 });
    const resets: RbActor[] = [];
    for (let i = 0; i < 200; i++) {
      const tick = r.step();
      if (tick.reset) resets.push(tick.reset);
    }
    expect(r.world.car(r.car).onGround).toBe(true);
    expect(resets).toEqual([]);
    r.world.dispose();
  });
});
