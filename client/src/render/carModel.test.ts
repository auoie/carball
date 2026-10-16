// The car model has the Fennec's proportions set on the physics hitbox (its measured scalars, FENNEC: the user's
// decision of 2026-10-14): narrower and lower than the hitbox, its tail past the hitbox's back, its nose a little past
// the front; other hitboxes get them scaled to theirs.
// Requires the engine build (engine/build-wasm) and the generated arena (out/arena), for every body's dimensions.
import createEngine from "@engine/carball_engine.mjs";
import { Box3, Color, Mesh, MeshStandardMaterial } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CarBody, type CarConfig, World, initEngine } from "../engine/world";
import { FENNEC, buildCarModel, fennecFrame } from "./carModel";
import { FLAT_BODY, STANDARD_BODY, TALL_BODY } from "./carBodies";
import { bodyFrame } from "./carParts";
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
function bounds(config: CarConfig, withWheels: boolean, car = 0): Box3 {
  const model = buildCarModel(config, new Color(0x1f6fff), 0, car);
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

describe("the garage's other cars (CM1's proportions, notes/hitboxes.md)", () => {
  // (each on its own preset's hitbox: its car id, its preset, its overall back (the Octane's wing, the Merc's spare
  // wheel) and top (the wing, the roof, the roof lip))
  const cars = [
    { car: 1, look: STANDARD_BODY, preset: "Standard", back: -60.4, top: 62.7 },
    { car: 2, look: FLAT_BODY, preset: "Flat", back: -61.1, top: 42.8 },
    { car: 3, look: TALL_BODY, preset: "Tall", back: -68.4, top: 71.9 },
  ] as const;

  it("each its nose, overall tail, top and sides as measured on its preset (within 1.5 uu), in one call per material", () => {
    for (const { car, look, preset, back, top } of cars) {
      const c = configs.get(preset);
      if (!c) throw new Error(preset);
      const { x, y, z } = bodyFrame(look.spec.ground, look.hitbox, c);
      const box = bounds(c, false, car);
      expect.soft(Math.abs(box.max.x - x(look.spec.front)), `${preset} front`).toBeLessThan(1.5);
      expect.soft(Math.abs(bounds(c, true, car).min.x - x(back)), `${preset} back`).toBeLessThan(1.5);
      expect.soft(Math.abs(box.max.y - y(top)), `${preset} top`).toBeLessThan(1.5);
      expect.soft(Math.abs(box.max.z - z(look.spec.halfWidth)), `${preset} side`).toBeLessThan(1.5);
      const names = buildCarModel(c, new Color(0x1f6fff), 0, car).children.map((m) => m.name);
      expect(names.sort(), preset).toEqual(["body", "glass", "headlight", "rim", "taillight", "trim", "tyre"]);
    }
  });

  it("their wheels where measured (the Flat's and Tall's tyres standing out past their bodies, as CM1's); finite geometry", () => {
    for (const { car, look, preset } of cars) {
      const c = configs.get(preset);
      if (!c) throw new Error(preset);
      const box = bounds(c, true, car);
      for (const v of [box.min, box.max]) expect(Number.isFinite(v.x + v.y + v.z), preset).toBe(true);
      const model = buildCarModel(c, new Color(0x1f6fff), 0, car);
      model.updateMatrixWorld(true);
      const tyres = model.children.find((p) => p.name === "tyre");
      if (!tyres) throw new Error("no tyres");
      const { z } = bodyFrame(look.spec.ground, look.hitbox, c);
      const outer = Math.max(...[look.spec.frontWheel, look.spec.backWheel].map((w) => z(w.z + w.width / 2)));
      expect(Math.abs(new Box3().setFromObject(tyres).max.z - outer), preset).toBeLessThan(0.1);
      // (the tyres' bottoms on the ground under the car at rest)
      expect(Math.abs(new Box3().setFromObject(tyres).min.y - look.spec.ground), preset).toBeLessThan(1.5);
    }
  });

  it("Sport and Standard: the same hitbox, two looks (140 and 138 long overall)", () => {
    const c = configs.get("Standard");
    if (!c) throw new Error("no Standard");
    const [sport, standard] = [bounds(c, false, 0), bounds(c, false, 1)];
    expect(Math.abs(sport.max.x - sport.min.x - 140.4)).toBeLessThan(2);
    expect(Math.abs(standard.max.x - standard.min.x - (78 + 60.4))).toBeLessThan(2);
    expect(standard.max.y).toBeGreaterThan(sport.max.y + 5); // (the Standard's wing)
  });
});
