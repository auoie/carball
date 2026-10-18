// The car model has the Fennec's proportions set on the physics hitbox (its measured scalars, FENNEC: the user's
// decision of 2026-10-14): narrower and lower than the hitbox, its tail past the hitbox's back, its nose a little past
// the front; other hitboxes get them scaled to theirs.
// Requires the engine build (engine/build-wasm) and the generated arena (out/arena), for every body's dimensions.
import createEngine from "@engine/carball_engine.mjs";
import { Box3, type BufferGeometry, Color, DoubleSide, type Material, Mesh, MeshStandardMaterial, type Object3D, Raycaster, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CarBody, type CarConfig, World, initEngine } from "../engine/world";
import { FENNEC, buildCarModel, carExhausts, fennecFrame } from "./carModel";
import { FLAT_BODY, TALL_BODY, carBody } from "./carBodies";
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

/** Pairs of the model's triangles of two materials that lie within `tolerance` uu of one plane, face the same way
 *  (either way for a two-sided material) and overlap with some area: what z-fights (the user's finding: the Sport's
 *  bumper phasing in and out), near or, further off as the depth buffer coarsens, a little apart (RV-487: the depth's
 *  step is z^2 / (near 2^24), 0.3 uu at 5000; faces 0.5 apart hold to about 6400 uu, where a car is a few pixels; the
 *  Standard's rear pods, flush with CM1's tyres and capped by its width, 0.4: to about 5800). (One material's faces in
 *  one plane shade the same: nothing shows) */
function coplanarOverlaps(model: Object3D, tolerance = 0.35): string[] {
  model.updateMatrixWorld(true);
  interface Tri {
    readonly p: Vector3[];
    readonly n: Vector3;
    readonly d: number;
    readonly mesh: string;
    readonly twoSided: boolean;
  }
  const tris: Tri[] = [];
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geometry = o.geometry as BufferGeometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const twoSided = (o.material as Material).side === DoubleSide;
    for (let k = 0; k + 2 < count; k += 3) {
      const p = [0, 1, 2].map((j) => new Vector3().fromBufferAttribute(position, index ? index.getX(k + j) : k + j).applyMatrix4(o.matrixWorld));
      const [a, b, c] = p as [Vector3, Vector3, Vector3];
      const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      if (n.length() < 1e-6) continue;
      n.normalize();
      tris.push({ p, n, d: n.dot(a), mesh: o.name, twoSided });
    }
  });
  // (by the normal, to 1/200, its neighbours looked in too: the planes' offsets compared directly)
  const key = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`;
  const q = (n: Vector3): [number, number, number] => [Math.round(n.x * 200), Math.round(n.y * 200), Math.round(n.z * 200)];
  const byNormal = new Map<string, number[]>();
  tris.forEach((t, i) => {
    const k = key(...q(t.n));
    byNormal.set(k, [...(byNormal.get(k) ?? []), i]);
  });
  const overlap = (a: Tri, b: Tri): boolean => {
    // (in the plane's own axes; two triangles overlap with area if no edge of either separates them by more than 0.05)
    const u = new Vector3(1, 0, 0).cross(a.n).length() > 0.5 ? new Vector3(1, 0, 0).cross(a.n).normalize() : new Vector3(0, 1, 0).cross(a.n).normalize();
    const v = new Vector3().crossVectors(a.n, u);
    const flat = (t: Tri): [number, number][] => t.p.map((point) => [point.dot(u), point.dot(v)]);
    const [A, B] = [flat(a), flat(b)];
    for (const poly of [A, B]) {
      for (let i = 0; i < 3; i++) {
        const [x0, y0] = poly[i] ?? [0, 0];
        const [x1, y1] = poly[(i + 1) % 3] ?? [0, 0];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const [nx, ny] = [-(y1 - y0) / len, (x1 - x0) / len];
        const along = (point: [number, number]): number => (point[0] - x0) * nx + (point[1] - y0) * ny;
        const [minA, maxA] = [Math.min(...A.map(along)), Math.max(...A.map(along))];
        const [minB, maxB] = [Math.min(...B.map(along)), Math.max(...B.map(along))];
        if (maxA < minB + 0.05 || maxB < minA + 0.05) return false;
      }
    }
    return true;
  };
  const found = new Set<string>();
  tris.forEach((a, i) => {
    const [nx, ny, nz] = q(a.n);
    for (const sign of a.twoSided ? [1, -1] : [1]) {
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            for (const j of byNormal.get(key(sign * nx + dx, sign * ny + dy, sign * nz + dz)) ?? []) {
              const b = tris[j];
              if (!b || j <= i || a.mesh === b.mesh || a.n.dot(b.n) * sign < 0.9999 || Math.abs(a.d - sign * b.d) > tolerance) continue;
              if (overlap(a, b)) {
                const at = a.p[0] ?? new Vector3();
                found.add(
                  `${a.mesh}/${b.mesh} ${Math.abs(a.d - sign * b.d).toFixed(2)} apart at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)}) facing (${a.n.x.toFixed(2)}, ${a.n.y.toFixed(2)}, ${a.n.z.toFixed(2)})`,
                );
              }
            }
          }
    }
  });
  return [...found];
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
  // (each on its own preset's hitbox: its car id, its preset, its overall back (the Merc's spare wheel) and top (the roof,
  // the roof lip))
  const cars = [
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

  it("their exhausts just behind their tails' faces, outside them, nothing behind (RV-470: the Fennec's sockets sat inside the Flat's and Tall's)", () => {
    for (const { car, preset } of [{ car: 0, preset: "Standard" }, ...cars]) {
      const c = configs.get(preset);
      if (!c) throw new Error(preset);
      const model = buildCarModel(c, new Color(0x1f6fff), 0, car);
      model.updateMatrixWorld(true);
      // (front faces only, but the glass's: a ray from inside the body meets none of the body's)
      const solid = model.children.filter((p) => p.name !== "glass");
      for (const at of carExhausts(buildCarModel(c, new Color(0x1f6fff), 0, car), c, car)) {
        const ahead = new Raycaster(at, new Vector3(1, 0, 0)).intersectObjects(solid)[0];
        expect(ahead?.distance ?? Infinity, `${preset} ahead`).toBeLessThan(3);
        expect(new Raycaster(at, new Vector3(-1, 0, 0), 0, 40).intersectObjects(solid), `${preset} behind`).toEqual([]);
      }
    }
  });

  it("the Tall's roof 67.8 over the ground at its peak, the Sport's hood 37.0 at the windscreen's foot (on the centreline: RV-462)", () => {
    const down = (c: CarConfig, car: number, x: number): number => {
      const model = buildCarModel(c, new Color(0x1f6fff), 0, car);
      model.updateMatrixWorld(true);
      const hit = new Raycaster(new Vector3(x, 500, 0), new Vector3(0, -1, 0)).intersectObjects(model.children.filter((p) => p.name !== "glass"))[0];
      return hit?.point.y ?? Number.NaN;
    };
    const tall = configs.get("Tall");
    const standard = configs.get("Standard");
    if (!tall || !standard) throw new Error("no preset");
    const t = bodyFrame(TALL_BODY.spec.ground, TALL_BODY.hitbox, tall);
    expect(TALL_BODY.spec.roof).toBe(67.8);
    expect(down(tall, 3, t.x(TALL_BODY.roofPeakX))).toBeCloseTo(t.y(67.8), 0);
    const f = fennecFrame(standard);
    expect(FENNEC.hood).toBe(37.0);
    expect(down(standard, 0, f.x(FENNEC.windscreenBase) + 1)).toBeCloseTo(f.y(37.0), 0);
  });

  it("no two faces of a car in one plane, facing the same way, overlapping (they'd z-fight: the user's finding, the Sport's bumper)", () => {
    for (const { car, preset } of [{ car: 0, preset: "Standard" }, ...cars]) {
      const c = configs.get(preset);
      if (!c) throw new Error(preset);
      expect.soft(coplanarOverlaps(buildCarModel(c, new Color(0x1f6fff), 0, car)), `${preset} car ${String(car)}`).toEqual([]);
    }
  });

  it("the retired Standard (id 1, the user's, 2026-10-17) drawn as the Sport, 140 long overall", () => {
    const c = configs.get("Standard");
    if (!c) throw new Error("no Standard preset");
    expect(carBody(1)).toBeNull();
    const [sport, retired] = [bounds(c, false, 0), bounds(c, false, 1)];
    expect(Math.abs(sport.max.x - sport.min.x - 140.4)).toBeLessThan(2);
    expect(retired.max.toArray()).toEqual(sport.max.toArray());
  });
});
