// Sound events found in the real engine's states (requires engine/build-wasm and out/arena), and in made-up ones: the
// detector's (jumps, dodges, pads, demolitions) and the impact and landing triggers' (the engine's contacts, the ball's
// bounces too: game/impactTriggers.ts), as the game loop runs them.
import createEngine from "@engine/carball_engine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type BodyState, type BoostPadState, type CarControls, type CarState, NO_CONTROLS, World, initEngine } from "../engine/world";
import { IDENTITY_ROT, type Rot3, type Vec3, ZERO, vec3 } from "../math/vec";
import { ImpactTriggers, triggerSounds } from "../game/impactTriggers";
import { type SoundEvent, SoundDetector, type SoundWorld } from "./detect";
import { arenaMeshes } from "../testing/arena";

let engine: Awaited<ReturnType<typeof createEngine>>;
beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

/** Runs the world at 120 / `perFrame` frames a second (`perFrame` ticks each; 60 by default), with `controls(tick)` for
 *  its one car, collecting sounds. */
function play(
  world: World,
  car: number | null,
  ticks: number,
  controls: (tick: number) => CarControls = () => NO_CONTROLS,
  perFrame = 2,
): SoundEvent[] {
  const detector = new SoundDetector();
  const triggers = new ImpactTriggers();
  const configs = new Map(car === null ? [] : [[car, world.carConfig(car)]]);
  const events: SoundEvent[] = [];
  const observe = (): SoundWorld => ({
    cars: new Map(car === null ? [] : [[car, world.car(car)]]),
    ball: world.ball(),
    pads: world.boostPads(),
  });
  const frame = (): void => {
    const now = observe();
    events.push(...detector.update(now, perFrame / 120));
    events.push(...triggerSounds(triggers.frame(perFrame / 120, world.takeImpacts(), now.cars, configs, car)));
  };
  frame();
  events.length = 0;
  for (let t = 0; t < ticks; t += perFrame) {
    for (let k = 0; k < perFrame; k++) {
      if (car !== null) world.setControls(car, controls(t + k));
      world.step();
    }
    frame();
  }
  return events;
}

const kinds = (events: readonly SoundEvent[]): string[] => events.map((e) => e.kind);
/** A landing: a sound for each wheel touching down (one to four: RV-171), nothing else */
const landing = (k: readonly string[]): boolean => k.length >= 1 && k.length <= 4 && k.every((x) => x === "land");

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
    const k = kinds(events);
    expect(k[0]).toBe("jump");
    expect(landing(k.slice(1)), k.join(", ")).toBe(true);
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

describe("the car hitting the ground", () => {
  const drop = (rot: Rot3, z: number, vz: number, perFrame = 2): SoundEvent[] => {
    const world = World.create(engine);
    const car = world.addCar(0);
    world.resetKickoff(1);
    world.setCar(car, { pos: vec3(2000, 2000, z), vel: vec3(0, 0, vz), angVel: ZERO, rot, boost: 0 });
    const events = play(world, car, 240, () => NO_CONTROLS, perFrame);
    world.dispose();
    return events.filter((e) => e.kind === "land" || e.kind === "impact");
  };
  const pitched = (angle: number): Rot3 => ({
    forward: vec3(Math.cos(angle), 0, Math.sin(angle)),
    right: vec3(0, 1, 0),
    up: vec3(-Math.sin(angle), 0, Math.cos(angle)),
  });

  // (a pogo: the nose's impact, then the wheels touching down as they come, each wheel's edge a landing: IT-5, no
  // cooldown)
  const pogo = (events: readonly SoundEvent[]): boolean => events[0]?.kind === "impact" && events.slice(1).every((e) => e.kind === "land") && events.length >= 2;

  it("nose first into the floor (as in a pogo): one impact, a firm one, then the wheels landing", () => {
    const events = drop(pitched(-1.05), 400, -900);
    expect(pogo(events), kinds(events).join(", ")).toBe(true);
    if (events[0]?.kind === "impact") expect(events[0].strength).toBeGreaterThan(0.3);
  });

  it("landing on the roof is an impact", () => {
    const events = drop({ forward: vec3(1, 0, 0), right: vec3(0, -1, 0), up: vec3(0, 0, -1) }, 400, -600);
    expect(kinds(events)).toEqual(["impact"]);
  });

  it("the same at 120, 60 and 30 frames a second", () => {
    const roof: Rot3 = { forward: vec3(1, 0, 0), right: vec3(0, -1, 0), up: vec3(0, 0, -1) };
    for (const perFrame of [1, 2, 4]) {
      const nose = drop(pitched(-1.05), 400, -900, perFrame);
      expect(pogo(nose), `nose, ${String(perFrame)} ticks a frame: ${kinds(nose).join(", ")}`).toBe(true);
      expect(kinds(drop(roof, 400, -600, perFrame)), `roof, ${String(perFrame)} ticks a frame`).toEqual(["impact"]);
      const wheels = kinds(drop(IDENTITY_ROT, 400, -600, perFrame));
      expect(landing(wheels), `wheels, ${String(perFrame)} ticks a frame: ${wheels.join(", ")}`).toBe(true);
    }
  });

  it("landing on the wheels: a landing sound a wheel, not an impact as well", () => {
    const k = kinds(drop(IDENTITY_ROT, 400, -600));
    expect(landing(k), k.join(", ")).toBe(true);
  });

  it("hard driving (steering, boosting, powersliding) makes no landing or impact sounds", () => {
    const world = World.create(engine);
    const car = world.addCar(0);
    world.resetKickoff(1);
    const events = play(world, car, 480, (t) => ({
      ...NO_CONTROLS,
      throttle: 1,
      boost: t < 240,
      steer: Math.sin(t / 25),
      handbrake: t % 120 > 90,
    })).filter((e) => e.kind === "land" || e.kind === "impact");
    expect(events).toEqual([]);
    world.dispose();
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
  hasJumped: false,
  doubleJumped: false,
  hasFlipped: false,
  flipping: false,
  airTimeSinceJump: 0,
  hasFlipOrJump: true,
  hasFlipReset: false,
  worldWheelContacts: 4,
  onRbActor: false,
  wheelGround: ["arena", "arena", "arena", "arena"],
  rbActor: null,
  wheelContact: [true, true, true, true],
  groundNormal: vec3(0, 0, 1),
  wheelNormals: [vec3(0, 0, 1), vec3(0, 0, 1), vec3(0, 0, 1), vec3(0, 0, 1)],
  demoRespawnTimer: 0,
  spawnSelection: { side: null, index: 0, locked: null },
  flipResets: 0,
  spawnCount: 0,
  ...extra,
});
const ball: BodyState = { pos: vec3(0, 0, 93), vel: ZERO, angVel: ZERO, rot: IDENTITY_ROT };
const pads = (active: boolean): BoostPadState[] => [{ pos: vec3(0, -4240, 70), big: false, active, cooldown: active ? 0 : 4 }];
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

  it("two cars colliding bump, once a pair (the engine's contacts: one side sounds, the 0.15 s cooldown)", () => {
    const w = World.create(engine);
    w.setDemolitions(false);
    const [a, b] = [w.addCar(0), w.addCar(1)];
    const upright = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) };
    w.setCar(a, { pos: vec3(0, 0, 17.01), vel: vec3(1500, 0, 0), angVel: ZERO, rot: upright, boost: 0 });
    w.setCar(b, { pos: vec3(400, 0, 17.01), vel: ZERO, angVel: ZERO, rot: upright, boost: 0 });
    const triggers = new ImpactTriggers();
    const configs = new Map([a, b].map((id) => [id, w.carConfig(id)]));
    const sounds: SoundEvent[] = [];
    for (let t = 0; t < 60; t += 2) {
      w.step(2);
      const cars = new Map([a, b].map((id) => [id, w.car(id)]));
      sounds.push(...triggerSounds(triggers.frame(2 / 120, w.takeImpacts(), cars, configs, a)));
    }
    expect(kinds(sounds).filter((k) => k === "bump")).toEqual(["bump"]);
    w.dispose();
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
