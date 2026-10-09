// Integration test: the typed wrapper against the real WebAssembly engine (Node build).
// Requires the engine build (engine/build-wasm) and the generated arena (out/arena).
import createEngine from "@engine/rlengine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { length, vec3 } from "../math/vec";
import { arenaMeshes } from "../testing/arena";
import { mergeMeshes, parseCmf } from "./cmf";
import { CarBody, NO_CONTROLS, World, initEngine } from "./world";

const meshes = arenaMeshes(); // the generated arena: one .cmf per piece
let engine: Awaited<ReturnType<typeof createEngine>>;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, meshes);
});

describe("arena mesh file", () => {
  it("parses the generated arena", () => {
    // The game's 16 pieces: per quadrant a corner, a side-wall floor half and ceiling half, a goal-and-back-wall half
    expect(meshes).toHaveLength(16);
    const mesh = mergeMeshes(meshes.map(parseCmf));
    expect(mesh.indices.length / 3).toBe(8020); // the game's 16 meshes: (880 + 126 + 16 + 983) x 4
    // Back of the goals is 6000 uu from centre
    let maxY = 0;
    for (let i = 1; i < mesh.positions.length; i += 3) maxY = Math.max(maxY, Math.abs(mesh.positions[i] ?? 0));
    expect(maxY).toBeCloseTo(6000, 1);
  });
});

describe("World", () => {
  it("drives a car forward with throttle", () => {
    const world = World.create(engine);
    const id = world.addCar(0, CarBody.Octane);
    world.resetKickoff(3);
    const start = world.car(id);
    for (let i = 0; i < 120; i++) {
      world.setControls(id, { ...NO_CONTROLS, throttle: 1 });
      world.step();
    }
    const end = world.car(id);
    const moved = vec3(end.pos.x - start.pos.x, end.pos.y - start.pos.y, 0);
    expect(length(moved)).toBeGreaterThan(400);
    expect(end.onGround).toBe(true);
    expect(end.team).toBe(0);
    world.dispose();
  });

  it("applies the player's steering sensitivity in the physics", () => {
    const drive = (steer: number, steeringSensitivity: number) => {
      const world = World.create(engine);
      const id = world.addCar(0, CarBody.Octane);
      world.resetKickoff(3);
      world.setCarPreferences(id, { dodgeDeadzone: 0.5, steeringSensitivity, airControlSensitivity: 1 });
      for (let i = 0; i < 120; i++) {
        world.setControls(id, { ...NO_CONTROLS, throttle: 1, steer });
        world.step();
      }
      const pos = world.car(id).pos;
      world.dispose();
      return pos;
    };
    const full = drive(1, 1);
    expect(drive(0.5, 2)).toEqual(full); // bit-identical: 0.5 x 2 = 1
    expect(drive(0.5, 1)).not.toEqual(full);
  });

  it("reports the car's hitbox and wheels", () => {
    const world = World.create(engine);
    const id = world.addCar(1, CarBody.Octane);
    const cfg = world.carConfig(id);
    expect(cfg.hitboxSize.x).toBeCloseTo(120.507, 2);
    expect(cfg.frontWheel.radius).toBeCloseTo(12.5);
    expect(cfg.backWheel.offset.x).toBeCloseTo(-33.75);
    world.dispose();
  });

  it("reports a goal once when the ball crosses the line", () => {
    const world = World.create(engine);
    world.setBall({ pos: vec3(0, 4900, 200), vel: vec3(0, 2000, 0), angVel: vec3(0, 0, 0) });
    const goals = [];
    for (let i = 0; i < 120; i++) {
      world.step();
      goals.push(...world.takeEvents().filter((e) => e.type === "goal"));
    }
    expect(goals).toEqual([{ type: "goal", scoringTeam: 0 }]);
    world.dispose();
  });

  it("the engine turns the ball: its orientation follows its spin (the client draws it as is)", () => {
    const world = World.create(engine);
    world.setBall({ pos: vec3(0, 0, 800), vel: vec3(0, 0, 0), angVel: vec3(0, 0, 6) }); // 6 rad/s about z (the cap)
    world.step(10);
    const f = world.ball().rot.forward;
    expect(Math.atan2(f.y, f.x)).toBeCloseTo(0.5, 2); // 10 ticks at 6 rad/s
    world.dispose();
  });

  it("a goal explodes the ball: it stays where it scored, even moving back out, until it is set again", () => {
    const world = World.create(engine);
    world.setBall({ pos: vec3(0, 5300, 300), vel: vec3(0, -1500, 0), angVel: vec3(0, 0, 0) }); // in, on its way out
    world.step();
    expect(world.ballExploded()).toBe(true);
    const at = world.ball().pos;
    world.step(240);
    expect(world.ball().pos).toEqual(at);
    world.setBall({ pos: vec3(0, 0, 300), vel: vec3(0, 0, 0), angVel: vec3(0, 0, 0) });
    world.step(10);
    expect(world.ballExploded()).toBe(false);
    expect(world.ball().pos.z).toBeLessThan(300); // falling again
    world.dispose();
  });

  it("has 34 boost pads, 6 of them big", () => {
    const world = World.create(engine);
    const pads = world.boostPads();
    expect(pads).toHaveLength(34);
    expect(pads.filter((p) => p.big)).toHaveLength(6);
    world.dispose();
  });

  it("restores a saved state", () => {
    const world = World.create(engine);
    const id = world.addCar(0);
    world.resetKickoff(5);
    const saved = world.saveState();
    const before = world.car(id).pos;
    world.setControls(id, { ...NO_CONTROLS, throttle: 1, boost: true });
    world.step(60);
    expect(world.car(id).pos).not.toEqual(before);
    world.loadState(saved);
    expect(world.car(id).pos).toEqual(before);
    expect(world.carIds()).toEqual([id]);
    world.dispose();
  });

  it("continues bit for bit after a rollback", () => {
    const world = World.create(engine);
    const blue = world.addCar(0);
    const orange = world.addCar(1);
    world.resetKickoff(9);
    const drive = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        world.setControls(blue, { ...NO_CONTROLS, throttle: 1, boost: true, steer: Math.sin(i / 15) });
        world.setControls(orange, { ...NO_CONTROLS, throttle: 1, jump: i % 40 === 0 });
        world.step();
      }
    };
    drive(150); // kickoff: cars and ball collide
    const saved = world.saveState();
    drive(240);
    const expected = world.saveState();
    world.loadState(saved);
    drive(240);
    expect(world.saveState()).toEqual(expected);
    world.dispose();
  });
});

describe("freeplay's new round (notes/camera-respawn-goal.md, RV-26, RV-39)", () => {
  it("held two ticks (CountdownTime 0: a 0.01 s timer), then the car takes input", async () => {
    const { FREEPLAY_COUNTDOWN_TICKS } = await import("../game/goalSequence");
    const world = World.create(engine);
    const id = world.addCar(0);
    world.resetFreeplay(5, 0);
    world.setKickoffCountdown(FREEPLAY_COUNTDOWN_TICKS);
    for (let i = 0; i < 2; i++) world.step();
    expect(world.kickoffCountdown()).toBe(0);
    world.setControls(id, { ...NO_CONTROLS, throttle: 1 });
    for (let i = 0; i < 30; i++) world.step();
    expect(length(world.car(id).vel)).toBeGreaterThan(50);
    world.dispose();
  });

  it("consecutive rounds alternate halves, each spot once as blue's and once mirrored in ten", () => {
    const world = World.create(engine);
    const id = world.addCar(0);
    // (each spot in blue's frame: the odd rounds' mirrored back)
    const spot = (k: number): string => {
      const { pos } = world.car(id);
      const s = k % 2 === 0 ? 1 : -1;
      return `${Math.round(s * pos.x).toString()},${Math.round(s * pos.y).toString()}`;
    };
    const spots: string[] = [];
    for (let k = 0; k < 10; k++) {
      world.resetFreeplay(5, k);
      const { pos } = world.car(id);
      expect(pos.y < 0, `round ${String(k)} at y ${pos.y.toFixed(0)}`).toBe(k % 2 === 0);
      expect(Math.abs(pos.y)).toBeGreaterThan(2000);
      spots.push(spot(k));
      if (k % 2 === 1) expect(spots[k]).toBe(spots[k - 1]); // (the mirror of the round before's)
    }
    expect(new Set(spots).size).toBe(5);
    world.resetFreeplay(5, 10);
    expect(spot(10)).toBe(spots[0]);
    world.dispose();
  });

  it("the ball at its spawn, z 100.49 at rest; it falls, and bounces as the game's (no freeze on landing: RV-57)", () => {
    const world = World.create(engine);
    world.addCar(0);
    world.resetFreeplay(5, 0);
    expect(world.ball().pos).toEqual(vec3(0, 0, expect.closeTo(100.49, 3) as number));
    // (live: the floor at -97.2 uu/s, up at +58.3, the hop's top at z 95.60)
    let lowest = Infinity;
    let up = 0;
    let top = 0;
    for (let i = 0; i < 60; i++) {
      world.step();
      const { pos, vel } = world.ball();
      lowest = Math.min(lowest, pos.z);
      if (up === 0 && vel.z > 0) up = vel.z;
      if (up > 0) top = Math.max(top, pos.z);
    }
    expect(lowest).toBeLessThan(93.2);
    expect(up).toBeGreaterThan(55);
    expect(up).toBeLessThan(62);
    expect(top).toBeCloseTo(95.6, 0);
    world.dispose();
  });


  it("unlimited boost: 100 at the spawn and never used up", () => {
    const world = World.create(engine);
    const id = world.addCar(0);
    world.setUnlimitedBoost(true);
    world.resetFreeplay(5, 0);
    expect(world.car(id).boost).toBe(100);
    for (let i = 0; i < 240; i++) {
      world.setControls(id, { ...NO_CONTROLS, throttle: 1, boost: true });
      world.step();
    }
    expect(world.car(id).boost).toBe(100);
    expect(length(world.car(id).vel)).toBeGreaterThan(1500);
    world.setUnlimitedBoost(false);
    for (let i = 0; i < 120; i++) {
      world.setControls(id, { ...NO_CONTROLS, throttle: 1, boost: true });
      world.step();
    }
    expect(world.car(id).boost).toBeLessThan(70);
    world.dispose();
  });
});
