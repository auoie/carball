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
    expect(meshes).toHaveLength(8); // four wall quadrants and four goal halves
    const mesh = mergeMeshes(meshes.map(parseCmf));
    expect(mesh.indices.length / 3).toBe(10904);
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
