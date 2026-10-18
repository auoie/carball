// The cars' Blender models (src/render/carGlb.ts; client/cars/README.md): each in client/cars within the budget (15,000
// triangles, a texture at most), holding its parts, naming no car maker, model or game; and the wheels posed as the game
// does (where the model has them along and across the car, the physics' height and steering, turned by the travel)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import type { CarConfig } from "../engine/world";
import { CAR_FILES, EXHAUST_PREFIX, UU_PER_METRE, WHEEL_NODES, missingParts, wheelPose, wheelSpin } from "./carGlb";

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
  "countach", "octane", "fennec", "dominus", "breakout", "batmobile", "takumi", "psyonix", "rocket league",
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
});

describe("the wheels as the game poses them", () => {
  const wheel = { offset: vec3(51.25, 25.9, 20.755), radius: 12.5, suspensionRest: 38.755 };
  const config: CarConfig = { hitboxSize: vec3(120.5, 86.7, 38.66), hitboxOffset: vec3(13.88, 0, 20.75), frontWheel: wheel, backWheel: { ...wheel, offset: vec3(-33.75, 29.5, 20.755), radius: 15 } };
  const rest = new Vector3(0.4875, -0.03, 0.259);

  it("along and across the car where the model has it; its centre's height the physics' (connection less suspension); else the model's", () => {
    const wheels = { suspension: [24, 24, 26, 26], steer: [0, 0, 0, 0] } as const;
    const posed = wheelPose(rest, new Quaternion(), 1, config, wheels, 0);
    expect([posed.position.x, posed.position.z]).toEqual([rest.x, rest.z]);
    expect(posed.position.y * UU_PER_METRE).toBeCloseTo(20.755 - 24, 9);
    expect(wheelPose(rest, new Quaternion(), 3, config, wheels, 0).position.y * UU_PER_METRE).toBeCloseTo(20.755 - 26, 9);
    expect(wheelPose(rest, new Quaternion(), 1, config, null, 0).position.y).toBe(rest.y);
  });

  it("steered to the car's right by a positive angle (the engine's sign); turned about its axle, its top forward as the car goes forward", () => {
    const steered = wheelPose(rest, new Quaternion(), 0, config, { suspension: [24, 24, 26, 26], steer: [0.4, 0.4, 0, 0] }, 0);
    const ahead = new Vector3(1, 0, 0).applyQuaternion(steered.quaternion);
    expect(ahead.z).toBeCloseTo(Math.sin(0.4), 9);
    expect(ahead.x).toBeCloseTo(Math.cos(0.4), 9);
    const spin = wheelSpin(10, 12.5);
    expect(spin).toBeCloseTo(-0.8, 12);
    const top = new Vector3(0, 1, 0).applyQuaternion(wheelPose(rest, new Quaternion(), 2, config, null, spin).quaternion);
    expect(top.x).toBeGreaterThan(0.5);
    // (the model's own turn kept under them)
    const turned = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
    expect(new Vector3(0, 1, 0).applyQuaternion(wheelPose(rest, turned, 2, config, null, 0).quaternion).y).toBeCloseTo(-1, 9);
  });
});
