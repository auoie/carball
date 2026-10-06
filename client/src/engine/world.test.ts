// Integration test: the typed wrapper against the real WebAssembly engine (Node build).
// Requires the engine build (engine/build-wasm) and the generated arena (out/arena).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createEngine from "@engine/rlengine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { length, vec3 } from "../math/vec";
import { parseCmf } from "./cmf";
import { CarBody, NO_CONTROLS, World, initEngine } from "./world";

const arenaPath = fileURLToPath(new URL("../../../out/arena/collision_meshes/soccar/soccar_arena.cmf", import.meta.url));
const arenaBytes = new Uint8Array(readFileSync(arenaPath));
let engine: Awaited<ReturnType<typeof createEngine>>;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, [arenaBytes]);
});

describe("arena mesh file", () => {
  it("parses the generated arena", () => {
    const mesh = parseCmf(arenaBytes);
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
});
