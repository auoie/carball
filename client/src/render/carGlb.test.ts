// The cars' Blender models (src/render/carGlb.ts; client/cars/README.md): each in client/cars within the budget (15,000
// triangles, a texture at most), holding its parts, naming no car maker, model or game; and the wheels drawn as the game
// draws them (SU1: where the model has them, dropped to the physics' contact within the body's travel or hanging by the
// car's tilt, eased at 10/s and snapped up by the ground, steered, turned by the travel)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Color, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { CAR_FILES, DRAWN_TRAVEL, EXHAUST_PREFIX, UU_PER_METRE, WHEEL_NODES, carModelParts, easeWheel, glbCarModel, hasCarModel, loadCarModels, missingParts, wheelDropTarget, wheelPose, wheelSpin } from "./carGlb";
import { CHASSIS_SPRINGS } from "./chassisSpring";

const CARS = new URL("../../cars", import.meta.url).pathname;

/** A .glb's JSON (its first chunk) and its triangles (every primitive's indices, else its positions, by three) */
function readGlb(bytes: Uint8Array): { readonly json: Record<string, unknown>; readonly triangles: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error("its first chunk isn't JSON");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as Record<string, unknown>;
  const accessors = (json["accessors"] ?? []) as { count: number }[];
  const meshes = (json["meshes"] ?? []) as { primitives: { indices?: number; attributes: Record<string, number>; mode?: number }[] }[];
  let triangles = 0;
  for (const mesh of meshes)
    for (const p of mesh.primitives) {
      const count = accessors[p.indices ?? p.attributes["POSITION"] ?? -1]?.count ?? 0;
      // (mode 4, triangles, the default; strips and fans a triangle a vertex past the first two)
      triangles += (p.mode ?? 4) === 4 ? count / 3 : Math.max(0, count - 2);
    }
  return { json, triangles };
}

/** Names no model may hold (client/cars/README.md): car makers and their best-known models, and the game's cars */
const NAMES = [
  "ferrari", "lamborghini", "porsche", "bmw", "audi", "mercedes", "benz", "ford", "chevrolet", "chevy", "toyota", "nissan",
  "honda", "mclaren", "bugatti", "aston martin", "jaguar", "dodge", "tesla", "volkswagen", "subaru", "mazda", "mitsubishi",
  "lotus", "koenigsegg", "pagani", "delorean", "maserati", "alfa romeo", "bentley", "rolls royce", "cadillac", "jeep",
  "hyundai", "peugeot", "renault", "citroen", "fiat", "volvo", "lexus", "corvette", "mustang", "camaro", "skyline", "supra",
  "countach", "octane", "fennec", "dominus", "breakout", "batmobile", "takumi", "plank", "hybrid", "merc", "psyonix",
  "rocket league",
];
const NAMED = new RegExp(`(?<![a-z])(${NAMES.map((n) => n.replace(/ /g, "[ _-]?")).join("|")})(?![a-z])`, "i");

/** The text a model holds (node, mesh, material and other names: its whole JSON), split at its compounds */
const words = (json: Record<string, unknown>): string => JSON.stringify(json).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]/g, " ");

/** A small glb for the reader: `names` nodes, one mesh of one indexed triangle and one of a 4-vertex strip */
function glb(names: readonly string[]): Uint8Array {
  const json = {
    asset: { version: "2.0" },
    nodes: names.map((name) => ({ name })),
    accessors: [{ count: 3 }, { count: 4 }],
    meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1 } }] }, { primitives: [{ attributes: { POSITION: 1 }, mode: 5 }] }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(20 + padded).fill(0x20, 20);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  return out;
}

describe("the cars' models (client/cars)", () => {
  it("the reader: a glb's JSON and its triangles; the parts a model needs; names no model may hold", () => {
    const { json, triangles } = readGlb(glb(["Body", ...WHEEL_NODES]));
    expect(triangles).toBe(3);
    const names = new Set((json["nodes"] as { name: string }[]).map((n) => n.name));
    expect(missingParts(names)).toEqual([]);
    expect(missingParts(new Set(["Body", "Wheel_FL"]))).toEqual(["Wheel_FR", "Wheel_RR", "Wheel_RL"]);
    expect(words(readGlb(glb(["Body", "PorscheBadge"])).json)).toMatch(NAMED);
    expect(words(readGlb(glb(["Body", "AstonMartinGrille"])).json)).toMatch(NAMED);
    expect(words(readGlb(glb(["Body", "Wheel_FL", "Exhaust_L"])).json)).not.toMatch(NAMED);
    expect(() => readGlb(new Uint8Array(24))).toThrow(/not a glb/);
  });

  const models = existsSync(CARS) ? readdirSync(CARS).filter((n) => n.endsWith(".glb")) : [];
  it.skipIf(models.length === 0)("each within the budget, its parts there (its exhausts empties), named as the garage's cars, no maker's, model's or game's name", () => {
    for (const name of models) {
      const { json, triangles } = readGlb(new Uint8Array(readFileSync(join(CARS, name))));
      expect(Object.values(CAR_FILES).map((f) => `${f}.glb`), name).toContain(name);
      expect(triangles, name).toBeLessThanOrEqual(15_000);
      expect(((json["images"] ?? []) as unknown[]).length, `${name}: textures`).toBeLessThanOrEqual(1);
      for (const key of ["animations", "cameras", "skins"]) expect(json[key], `${name}: ${key}`).toBeUndefined();
      const list = (json["nodes"] ?? []) as { name?: string; mesh?: number }[];
      const nodes = new Set(list.map((n) => n.name ?? ""));
      expect(missingParts(nodes), name).toEqual([]);
      // (its exhausts, if any, empties: every node named Exhaust…, as many as its sockets)
      const exhausts = list.filter((n) => (n.name ?? "").startsWith(EXHAUST_PREFIX));
      expect(exhausts.filter((n) => n.mesh !== undefined).map((n) => n.name), `${name}: exhausts with a mesh`).toEqual([]);
      expect(exhausts.length, `${name}: exhausts`).toBeLessThanOrEqual(4);
      expect(words(json).match(NAMED)?.[0] ?? null, name).toBeNull();
    }
  });

  it.skipIf(models.length === 0)("loaded through three's loader: each wheel's tyre radius its own (12-16 uu, not its box's diagonal: RX26), the body's travel and spring, its exhausts", async () => {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const count = await loadCarModels(async (url) => {
      const bytes = readFileSync(join(CARS, url.slice(url.lastIndexOf("/") + 1)));
      return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
    });
    expect(count).toBe(models.length);
    for (const [id, file] of Object.entries(CAR_FILES)) {
      if (!models.includes(`${file}.glb`)) continue;
      const car = Number(id);
      expect(hasCarModel(car), file).toBe(true);
      const model = glbCarModel(car, new Color(0x2050ff));
      const parts = model ? carModelParts(model) : null;
      if (!parts) throw new Error(`${file}: no parts`);
      const radii = parts.wheels.map((w) => w.radius);
      for (const r of radii) {
        expect(r, file).toBeGreaterThan(11.5);
        expect(r, file).toBeLessThan(16.5);
      }
      // (the back wheels the bigger or the same, as the bodies' are)
      expect(Math.min(radii[2] ?? 0, radii[3] ?? 0) + 0.01, file).toBeGreaterThanOrEqual(Math.max(radii[0] ?? 0, radii[1] ?? 0) - 1.5);
      expect(parts.travel, file).toEqual(DRAWN_TRAVEL[car]);
      expect(parts.spring, file).toBe(CHASSIS_SPRINGS[car]);
      expect(parts.exhausts?.length ?? 0, file).toBeGreaterThanOrEqual(1);
      // (its lamps the generated cars': clipped at an emissive of 1, not the file's bright ones that bloomed: RX26)
      const lamps = new Map<string, MeshStandardMaterial>();
      model?.traverse((o) => {
        if (o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.name.startsWith("Light_")) lamps.set(o.material.name, o.material);
      });
      expect([...lamps.keys()].sort(), file).toEqual(["Light_Head", "Light_Tail"]);
      for (const lamp of lamps.values()) {
        expect(lamp.emissiveIntensity, file).toBe(1);
        expect(lamp.color.getHex(), file).toBe(0);
      }
      expect(lamps.get("Light_Tail")?.emissive.g, file).toBeCloseTo(0.0103, 4);
    }
  });
});

describe("the wheels as the game draws them (SU1)", () => {
  // (a front wheel of the physics: connection 20.755 up, radius 12.5; the model's wheel 3.5 under the origin, its tyre's
  // radius 12.75; the ground 17 under the origin: the suspension's length then puts the contact on it)
  const physics = { offset: vec3(51.25, 25.9, 20.755), radius: 12.5 };
  const resting = 20.755 + 17 - 12.5;
  const flat = DRAWN_TRAVEL[2] ?? { min: 0, max: 4 };
  const sport = DRAWN_TRAVEL[0] ?? { min: 2, max: 6 };

  it("touching: dropped for its tyre to sit on the contact (at rest on flat ground, its bottom on it), within the body's travel", () => {
    const target = wheelDropTarget(-3.5, 12.75, physics, resting, 1, flat);
    expect(-3.5 + target - 12.75).toBeCloseTo(-17, 9);
    // (pressed up past the travel's least: drawn no higher than it; hanging past its most: no lower)
    expect(wheelDropTarget(-3.5, 12.75, physics, resting - 10, 1, sport)).toBe(-sport.min);
    expect(wheelDropTarget(-3.5, 12.75, physics, resting + 20, 1, sport)).toBe(-sport.max);
  });

  it("touching nothing: its full hang upright, the middle on its side, its least upside down (6/4/8 uu: Sport, Flat, Tall)", () => {
    expect([0, 2, 3].map((car) => wheelDropTarget(-3.5, 12.75, physics, null, 1, DRAWN_TRAVEL[car] ?? sport))).toEqual([-6, -4, -8]);
    expect(wheelDropTarget(-3.5, 12.75, physics, null, 0, sport)).toBe(-4);
    expect(wheelDropTarget(-3.5, 12.75, physics, null, -1, sport)).toBe(-2);
  });

  it("eased at 10/s, 90% in about 0.22 s whatever the frame rate; snapped up when the ground pushes a touching wheel", () => {
    for (const fps of [60, 144]) {
      let v = 0;
      let t = 0;
      while (v > -0.9 * 6) {
        v = easeWheel(v, -6, 1 / fps);
        t += 1 / fps;
      }
      expect(t).toBeGreaterThan(0.19);
      expect(t).toBeLessThan(0.24);
    }
    expect(easeWheel(-6, -2, 1 / 60, true)).toBe(-2);
    expect(easeWheel(-6, -2, 1 / 60, false)).toBeCloseTo(-6 + 4 / 6, 9);
    expect(easeWheel(-2, -6, 1 / 60, true)).toBeCloseTo(-2 - 4 / 6, 9);
    expect(easeWheel(0, 1, 0.5)).toBe(1);
  });

  it("posed where the model has it, dropped by the drop; steered to the car's right by a positive angle (the engine's sign); turned about its axle, its top forward as the car goes forward", () => {
    const rest = new Vector3(0.4875, -0.03, 0.259);
    const dropped = wheelPose(rest, new Quaternion(), -4, 0, 0).position;
    expect([dropped.x, dropped.z]).toEqual([rest.x, rest.z]);
    expect(dropped.y * UU_PER_METRE).toBeCloseTo(-3 - 4, 9);
    const ahead = new Vector3(1, 0, 0).applyQuaternion(wheelPose(rest, new Quaternion(), 0, 0.4, 0).quaternion);
    expect(ahead.z).toBeCloseTo(Math.sin(0.4), 9);
    expect(ahead.x).toBeCloseTo(Math.cos(0.4), 9);
    const spin = wheelSpin(10, 12.5);
    expect(spin).toBeCloseTo(-0.8, 12);
    const top = new Vector3(0, 1, 0).applyQuaternion(wheelPose(rest, new Quaternion(), 0, 0, spin).quaternion);
    expect(top.x).toBeGreaterThan(0.5);
    // (the model's own turn kept under them)
    const turned = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
    expect(new Vector3(0, 1, 0).applyQuaternion(wheelPose(rest, turned, 0, 0, 0).quaternion).y).toBeCloseTo(-1, 9);
  });
});
