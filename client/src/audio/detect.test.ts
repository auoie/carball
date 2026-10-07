// Sound events found in the real engine's states (requires engine/build-wasm and out/arena), and in made-up ones.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createEngine from "@engine/rlengine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type BodyState, type BoostPadState, type CarControls, type CarState, NO_CONTROLS, World, initEngine } from "../engine/world";
import { IDENTITY_ROT, type Vec3, ZERO, vec3 } from "../math/vec";
import { type SoundEvent, SoundDetector, type SoundWorld } from "./detect";

let engine: Awaited<ReturnType<typeof createEngine>>;
beforeAll(async () => {
  const arenaPath = fileURLToPath(new URL("../../../out/arena/collision_meshes/soccar/soccar_arena.cmf", import.meta.url));
  engine = await createEngine();
  initEngine(engine, [new Uint8Array(readFileSync(arenaPath))]);
});

/** Runs the world at 60 frames a second (two ticks each), with `controls(tick)` for its one car, collecting sounds. */
function play(world: World, car: number | null, ticks: number, controls: (tick: number) => CarControls = () => NO_CONTROLS): SoundEvent[] {
  const detector = new SoundDetector();
  const events: SoundEvent[] = [];
  const observe = (): SoundWorld => ({
    cars: new Map(car === null ? [] : [[car, world.car(car)]]),
    ball: world.ball(),
    pads: world.boostPads(),
  });
  detector.update(observe(), 1 / 60);
  for (let t = 0; t < ticks; t += 2) {
    for (let k = 0; k < 2; k++) {
      if (car !== null) world.setControls(car, controls(t + k));
      world.step();
    }
    events.push(...detector.update(observe(), 1 / 60));
  }
  return events;
}

const kinds = (events: readonly SoundEvent[]): string[] => events.map((e) => e.kind);

describe("sound events from the engine", () => {
  it("a dropped ball bounces, softer each time", () => {
    const world = World.create(engine);
    world.setBall({ pos: vec3(0, 0, 1200), vel: ZERO, angVel: ZERO });
    const strengths = play(world, null, 600).flatMap((e) => (e.kind === "ballBounce" ? [e.strength] : []));
    expect(strengths.length).toBeGreaterThanOrEqual(2);
    expect(strengths[0]).toBeGreaterThan(0.3);
    expect(strengths[1]).toBeLessThan(strengths[0] ?? 0);
    world.dispose();
  });

  it("driving into the ball hits it", () => {
    const world = World.create(engine);
    const car = world.addCar(0);
    world.resetKickoff(1);
    // The ball straight ahead of the car
    const { pos, rot } = world.car(car);
    world.setBall({ pos: vec3(pos.x + rot.forward.x * 1500, pos.y + rot.forward.y * 1500, 93), vel: ZERO, angVel: ZERO });
    const events = play(world, car, 300, () => ({ ...NO_CONTROLS, throttle: 1, boost: true }));
    const hit = events.find((e) => e.kind === "ballHit");
    expect(hit).toBeDefined();
    if (hit?.kind === "ballHit") expect(hit.strength).toBeGreaterThan(0.2);
    world.dispose();
  });

  it("jumping, then landing", () => {
    const world = World.create(engine);
    const car = world.addCar(0);
    world.resetKickoff(1);
    play(world, car, 120); // settle
    const events = play(world, car, 360, (t) => ({ ...NO_CONTROLS, jump: t < 30 }));
    expect(kinds(events)).toEqual(["jump", "land"]);
    world.dispose();
  });

  it("a second jump without a direction is a double jump; with one, a dodge", () => {
    const second = (pitch: number): string[] => {
      const world = World.create(engine);
      const car = world.addCar(0);
      world.resetKickoff(1);
      play(world, car, 120);
      // Jump, let go, jump again (pushing the stick forward or not)
      const events = play(world, car, 360, (t) => ({ ...NO_CONTROLS, jump: t < 10 || (t >= 24 && t < 30), pitch: t >= 24 ? pitch : 0 }));
      world.dispose();
      return kinds(events).filter((k) => k !== "land");
    };
    expect(second(0)).toEqual(["jump", "doubleJump"]);
    expect(second(-1)).toEqual(["jump", "flip"]);
  });
});

// --- made-up states ---

const car = (pos: Vec3, vel: Vec3, extra: Partial<CarState> = {}): CarState => ({
  pos,
  vel,
  angVel: ZERO,
  rot: IDENTITY_ROT,
  team: 0,
  boost: 33,
  onGround: true,
  supersonic: false,
  boosting: false,
  demoed: false,
  jumping: false,
  doubleJumped: false,
  flipping: false,
  wheelContact: [true, true, true, true],
  groundNormal: vec3(0, 0, 1),
  ...extra,
});
const ball: BodyState = { pos: vec3(0, 0, 93), vel: ZERO, angVel: ZERO, rot: IDENTITY_ROT };
const pads = (active: boolean): BoostPadState[] => [{ pos: vec3(0, -4240, 70), big: false, active }];
const world = (cars: [number, CarState][], padsActive = true): SoundWorld => ({ cars: new Map(cars), ball, pads: pads(padsActive) });

describe("sound events from made-up states", () => {
  it("a pad taken", () => {
    const d = new SoundDetector();
    d.update(world([]), 1 / 60);
    expect(d.update(world([], false), 1 / 60)).toEqual([{ kind: "pad", big: false, at: vec3(0, -4240, 70) }]);
  });

  it("a car demolished, where it was", () => {
    const d = new SoundDetector();
    d.update(world([[1, car(vec3(100, 200, 17), ZERO)]]), 1 / 60);
    const events = d.update(world([[1, car(vec3(0, 0, -1000), ZERO, { demoed: true })]]), 1 / 60);
    expect(events).toEqual([{ kind: "demo", at: vec3(100, 200, 17) }]);
  });

  it("two cars colliding bump, once", () => {
    const d = new SoundDetector();
    d.update(world([[1, car(vec3(0, 0, 17), vec3(1500, 0, 0))], [2, car(vec3(200, 0, 17), ZERO)]]), 1 / 60);
    const hit = d.update(world([[1, car(vec3(20, 0, 17), vec3(300, 0, 0))], [2, car(vec3(210, 0, 17), vec3(1200, 0, 0))]]), 1 / 60);
    expect(kinds(hit)).toEqual(["bump"]);
    const after = d.update(world([[1, car(vec3(25, 0, 17), vec3(1000, 0, 0))], [2, car(vec3(230, 0, 17), vec3(500, 0, 0))]]), 1 / 60);
    expect(after).toEqual([]); // (the same collision, settling)
  });

  it("a teleport (reset) makes no sound", () => {
    const d = new SoundDetector();
    d.update(world([[1, car(vec3(3000, 3000, 17), vec3(1500, 0, 0), { wheelContact: [false, false, false, false] })]]), 1 / 60);
    for (let i = 0; i < 30; i++) {
      d.update(world([[1, car(vec3(3000, 3000, 300), vec3(1500, 0, -500), { wheelContact: [false, false, false, false] })]]), 1 / 60);
    }
    expect(d.update(world([[1, car(vec3(0, -2000, 17), ZERO)]]), 1 / 60)).toEqual([]);
  });
});
