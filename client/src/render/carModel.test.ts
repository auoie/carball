// The car model is built around the physics hitbox: what you see is what collides, but for the Fennec's tail (past
// the hitbox's back, over the rear wheels) and its flares and spoiler (a couple of uu proud of it).
// Requires the engine build (engine/build-wasm) and the generated arena (out/arena), for every body's dimensions.
import createEngine from "@engine/rlengine.mjs";
import { Box3, Color, Mesh, MeshStandardMaterial } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CarBody, type CarConfig, World, initEngine } from "../engine/world";
import { TAIL_PAST_HITBOX, buildCarModel } from "./carModel";
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

  it("has the hitbox's nose, roof and sides (within 2 uu: the flares and spoiler stand proud), the tail past it", () => {
    for (const [name, c] of configs) {
      const box = bounds(c, false);
      const hitbox = {
        front: c.hitboxOffset.x + c.hitboxSize.x / 2,
        rear: c.hitboxOffset.x - c.hitboxSize.x / 2,
        top: c.hitboxOffset.z + c.hitboxSize.z / 2,
        side: c.hitboxSize.y / 2,
      };
      expect.soft(Math.abs(box.max.x - hitbox.front), `${name} front`).toBeLessThan(2);
      expect.soft(Math.abs(box.min.x - (hitbox.rear - TAIL_PAST_HITBOX)), `${name} rear`).toBeLessThan(1);
      expect.soft(Math.abs(box.max.y - hitbox.top), `${name} roof`).toBeLessThan(2);
      expect.soft(Math.abs(box.max.z - hitbox.side), `${name} right side`).toBeLessThan(2);
      expect.soft(Math.abs(box.min.z + hitbox.side), `${name} left side`).toBeLessThan(2);
    }
  });

  it("keeps the wheels within the body's width and builds finite geometry", () => {
    for (const [name, c] of configs) {
      const box = bounds(c, true);
      for (const v of [box.min, box.max]) expect(Number.isFinite(v.x + v.y + v.z), name).toBe(true);
      const model = buildCarModel(c, new Color(0x1f6fff));
      model.updateMatrixWorld(true);
      const tyres = model.children.find((p) => p.name === "tyre");
      if (!tyres) throw new Error("no tyres");
      expect(new Box3().setFromObject(tyres).max.z, name).toBeLessThanOrEqual(c.hitboxSize.y / 2);
    }
  });
});

describe("the car's lights (RV-15)", () => {
  it("show as the game's: headlights a white core, tail lights deep red", () => {
    const octane = configs.get("Octane");
    if (!octane) throw new Error("no Octane");
    const model = buildCarModel(octane, new Color(0x1f6fff));
    const emissive = (name: string) => {
      let found: Color | null = null;
      model.traverse((o) => {
        if (o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.name === name) found = o.material.emissive;
      });
      return found as Color | null;
    };
    const head = emissive("headlight");
    const tail = emissive("taillight");
    expect(head && [head.r, head.g, head.b]).toEqual([1, 1, 1]);
    // (on screen, as the painted bake's: sRGB ff1a00)
    expect(tail?.getHexString()).toBe("ff1a00");
  });
});
