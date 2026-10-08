// The car model is built around the physics hitbox: what you see is what collides.
// Requires the engine build (engine/build-wasm) and the generated arena (out/arena), for every body's dimensions.
import createEngine from "@engine/rlengine.mjs";
import { Box3, Color, Mesh } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CarBody, type CarConfig, World, initEngine } from "../engine/world";
import { buildCarModel } from "./carModel";
import { arenaMeshes } from "../testing/arena";

const configs = new Map<string, CarConfig>();

beforeAll(async () => {
  const engine = await createEngine();
  initEngine(engine, arenaMeshes());
  const world = World.create(engine);
  for (const [name, body] of Object.entries(CarBody)) {
    if (typeof body === "number") configs.set(name, world.carConfig(world.addCar(0, body)));
  }
  world.dispose();
});

/** Bounds of the model in Three.js local axes (x forward, y up, z right), wheels left out or not. */
function bounds(config: CarConfig, withWheels: boolean): Box3 {
  const model = buildCarModel(config, new Color(0x1f6fff));
  model.updateMatrixWorld(true);
  const box = new Box3();
  for (const part of model.children) {
    if (!(part instanceof Mesh)) continue;
    if (!withWheels && (part.name === "tyre" || part.name === "rim")) continue;
    box.union(new Box3().setFromObject(part));
  }
  return box;
}

describe("car model", () => {
  it("covers the six hitboxes", () => {
    expect([...configs.keys()]).toEqual(["Octane", "Dominus", "Plank", "Breakout", "Hybrid", "Merc"]);
  });

  it("draws in one call per material", () => {
    const octane = configs.get("Octane");
    if (!octane) throw new Error("no Octane");
    const names = buildCarModel(octane, new Color(0x1f6fff)).children.map((c) => c.name);
    expect(names.sort()).toEqual(["body", "glass", "headlight", "rim", "taillight", "trim", "tyre"]);
  });

  it("has the hitbox's nose, tail, roof and sides (within 1 uu)", () => {
    for (const [name, c] of configs) {
      const box = bounds(c, false);
      const hitbox = {
        front: c.hitboxOffset.x + c.hitboxSize.x / 2,
        rear: c.hitboxOffset.x - c.hitboxSize.x / 2,
        top: c.hitboxOffset.z + c.hitboxSize.z / 2,
        side: c.hitboxSize.y / 2,
      };
      expect.soft(Math.abs(box.max.x - hitbox.front), `${name} front`).toBeLessThan(1);
      expect.soft(Math.abs(box.min.x - hitbox.rear), `${name} rear`).toBeLessThan(1);
      expect.soft(Math.abs(box.max.y - hitbox.top), `${name} roof`).toBeLessThan(1);
      expect.soft(Math.abs(box.max.z - hitbox.side), `${name} right side`).toBeLessThan(1);
      expect.soft(Math.abs(box.min.z + hitbox.side), `${name} left side`).toBeLessThan(1);
    }
  });

  it("keeps the wheels within the body's width and builds finite geometry", () => {
    for (const [name, c] of configs) {
      const box = bounds(c, true);
      for (const v of [box.min, box.max]) expect(Number.isFinite(v.x + v.y + v.z), name).toBe(true);
      expect(box.max.z, name).toBeLessThanOrEqual(c.hitboxSize.y / 2);
    }
  });
});
