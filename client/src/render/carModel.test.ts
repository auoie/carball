// The car model has the Fennec's proportions set on the physics hitbox (its measured scalars, FENNEC: the user's
// decision of 2026-10-14): narrower and lower than the hitbox, its tail past the hitbox's back, its nose a little past
// the front; other hitboxes get them scaled to theirs.
// Requires the engine build (engine/build-wasm) and the generated arena (out/arena), for every body's dimensions.
import createEngine from "@engine/rlengine.mjs";
import { Box3, Color, Mesh, MeshStandardMaterial } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CarBody, type CarConfig, World, initEngine } from "../engine/world";
import { FENNEC, buildCarModel, fennecFrame } from "./carModel";
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
    expect([...configs.keys()]).toEqual(["Standard", "Flat", "Wide", "Long", "Mid", "Tall"]);
  });

  it("draws in one call per material", () => {
    const octane = configs.get("Standard");
    if (!octane) throw new Error("no Standard");
    const names = buildCarModel(octane, new Color(0x1f6fff)).children.map((c) => c.name);
    expect(names.sort()).toEqual(["body", "glass", "headlight", "rim", "taillight", "trim", "tyre"]);
  });

  it("has the Fennec's nose, tail, roof and sides on every hitbox (within 2 uu: the flares and spoiler stand proud)", () => {
    for (const [name, c] of configs) {
      const box = bounds(c, false);
      const { x, y, z } = fennecFrame(c);
      expect.soft(Math.abs(box.max.x - x(FENNEC.front)), `${name} front`).toBeLessThan(2);
      expect.soft(Math.abs(box.min.x - x(FENNEC.rear)), `${name} rear`).toBeLessThan(1);
      expect.soft(Math.abs(box.max.y - y(FENNEC.roof)), `${name} roof`).toBeLessThan(2);
      expect.soft(Math.abs(box.max.z - z(FENNEC.halfWidth)), `${name} right side`).toBeLessThan(2);
      expect.soft(Math.abs(box.min.z + z(FENNEC.halfWidth)), `${name} left side`).toBeLessThan(2);
    }
  });

  it("on the Octane's hitbox, as the Fennec measures: 140 long, 71 wide, its roof 52 over the ground, 4 under the hitbox", () => {
    const octane = configs.get("Standard");
    if (!octane) throw new Error("no Standard");
    const box = bounds(octane, false);
    // (the lights and the grille stand a hair proud of the nose and the tail)
    expect(Math.abs(box.max.x - box.min.x - 140.4)).toBeLessThan(2);
    expect(box.max.z - box.min.z).toBeLessThan(74);
    expect(box.max.z - box.min.z).toBeGreaterThan(70);
    const roof = FENNEC.ground + FENNEC.roof;
    expect(roof).toBeLessThan(octane.hitboxOffset.z + octane.hitboxSize.z / 2 - 4);
  });

  it("keeps the wheels within the body's width and builds finite geometry", () => {
    for (const [name, c] of configs) {
      const box = bounds(c, true);
      for (const v of [box.min, box.max]) expect(Number.isFinite(v.x + v.y + v.z), name).toBe(true);
      const model = buildCarModel(c, new Color(0x1f6fff));
      model.updateMatrixWorld(true);
      const tyres = model.children.find((p) => p.name === "tyre");
      if (!tyres) throw new Error("no tyres");
      expect(new Box3().setFromObject(tyres).max.z, name).toBeLessThanOrEqual(fennecFrame(c).z(FENNEC.halfWidth));
    }
  });
});

describe("the car's lights (RV-15)", () => {
  it("show as the game's: headlights a white core, tail lights deep red", () => {
    const octane = configs.get("Standard");
    if (!octane) throw new Error("no Standard");
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
