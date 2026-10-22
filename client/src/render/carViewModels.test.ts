// A car drawn with its Blender model (src/render/carGlb.ts in CarView: notes/visual-timing.md VT-32): the real models
// loaded through three's loader; the wheels hanging in the air and eased, snapped up by the ground, a replay's at rest;
// the body swaying while the wheels keep where the model has them. Skipped where client/cars has no Tall model.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type BufferGeometry, Color, Mesh, MeshPhysicalMaterial, type Object3D, Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { UU_PER_METRE, carModelParts, glbCarModel, hasCarModel, loadCarModels } from "./carGlb";
import { CarView } from "./entities";

const CARS = new URL("../../cars", import.meta.url).pathname;
const TALL = 3;
// (a Tall-like car: its physics' connection points and radii; what matters here is the model's own)
const CONFIG = {
  hitboxSize: vec3(123.2, 79.2, 44.2),
  hitboxOffset: vec3(11.4, 0, 21.5),
  frontWheel: { offset: vec3(51.25, 25.9, 21.5), radius: 15, suspensionRest: 38.8 },
  backWheel: { offset: vec3(-33.75, 29.5, 21.5), radius: 15, suspensionRest: 37.1 },
};
const FRAME = 1 / 60;

beforeAll(async () => {
  if (!existsSync(join(CARS, "tall.glb"))) return;
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  await loadCarModels(async (url) => {
    const bytes = readFileSync(join(CARS, url.slice(url.lastIndexOf("/") + 1)));
    return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
  });
});

const named = (root: Object3D, name: string): Object3D => {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};
const four = <T>(v: T): [T, T, T, T] => [v, v, v, v];

describe.skipIf(!existsSync(join(CARS, "tall.glb")))("a car wearing its model (Tall)", () => {
  it("its wheels: hanging 8 uu in the air (set at once the first time), snapped up by the ground, eased down again at 10/s; a replay's touching wheels at rest", () => {
    expect(hasCarModel(TALL)).toBe(true);
    const car = new CarView(CONFIG, 0, null, TALL);
    expect(car.posesWheels).toBe(true);
    const wheel = named(car.root, "Wheel_FL");
    const rest = wheel.position.clone();
    const drop = (): number => (wheel.position.y - rest.y) * UU_PER_METRE;
    const at = new Vector3(0, 300, 0);
    const upright = new Quaternion();
    car.wheels = { suspension: four(0), steer: four(0), contact: four(false) };
    car.update(at, upright, false, false, false, FRAME);
    expect(drop()).toBeCloseTo(-8, 6);
    expect([wheel.position.x, wheel.position.z]).toEqual([rest.x, rest.z]);
    // (landing pressed up: no lower than the model's own, at once)
    car.wheels = { suspension: four(10), steer: four(0), contact: four(true) };
    car.update(at, upright, false, false, false, FRAME);
    expect(drop()).toBeCloseTo(0, 6);
    // (in the air again: a sixth of the way to the hang in one 60th of a second)
    car.wheels = { suspension: four(0), steer: four(0), contact: four(false) };
    car.update(at, upright, false, false, false, FRAME);
    expect(drop()).toBeCloseTo(-8 / 6, 6);
    // (a replay's: the touching wheels eased to rest, its least drop, 0 on Tall)
    car.replayWheels(four(true));
    for (let i = 0; i < 60; i++) car.update(at, upright, false, false, false, FRAME);
    expect(drop()).toBeCloseTo(0, 3);
    car.dispose();
  });

  it("its body sways as the car speeds up (nose up), its wheels where the model has them along and across the car", () => {
    const car = new CarView(CONFIG, 0, null, TALL);
    const body = named(car.root, "Body");
    const wheel = named(car.root, "Wheel_RR");
    const rest = wheel.position.clone();
    const upright = new Quaternion();
    car.wheels = { suspension: four(30), steer: four(0), contact: four(true) };
    // (from rest, speeding up along the car at 1000 uu/s²)
    for (let i = 0; i <= 30; i++) car.update(new Vector3(500 * (i * FRAME) ** 2, 30, 0), upright, false, false, false, FRAME);
    const nose = new Vector3(1, 0, 0).applyQuaternion(body.quaternion);
    expect(nose.y).toBeGreaterThan(0.01);
    expect([wheel.position.x, wheel.position.z]).toEqual([rest.x, rest.z]);
    expect(wheel.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0); // (turning as it rolls, not swaying)
    car.dispose();
  });

  it("put somewhere new (a reset, a respawn, a replay's start: teleport), its sway starts fresh: a 300 uu jump at speed doesn't swing it (RV-597)", () => {
    const upright = new Quaternion();
    const drive = (car: CarView): number => {
      car.wheels = { suspension: four(30), steer: four(0), contact: four(true) };
      // (from rest, speeding up along the car to 1400 uu/s, then holding it: the spring settled to its lag)
      let x = 0;
      for (let i = 0; i < 90; i++) {
        x += Math.min(1400, 1000 * (i + 1) * FRAME) * FRAME;
        car.update(new Vector3(x, 30, 0), upright, false, false, false, FRAME);
      }
      return x;
    };
    const flagged = new CarView(CONFIG, 0, null, TALL);
    const body = named(flagged.root, "Body");
    const rest = body.quaternion.clone();
    const x = drive(flagged);
    flagged.teleport();
    flagged.update(new Vector3(x - 300, 30, 0), upright, false, false, false, FRAME);
    expect(body.quaternion.angleTo(rest)).toBeLessThan(1e-9);
    // (unflagged, under the 400 uu fallback: the same jump swings it)
    const plain = new CarView(CONFIG, 0, null, TALL);
    const plainBody = named(plain.root, "Body");
    const before = drive(plain);
    plain.update(new Vector3(before - 300, 30, 0), upright, false, false, false, FRAME);
    expect(plainBody.quaternion.angleTo(rest)).toBeGreaterThan(0.01);
    flagged.dispose();
    plain.dispose();
  });

  it("teleported, its next frame sets the wheels at once and doesn't turn them for the jump (RV-597)", () => {
    const upright = new Quaternion();
    const car = new CarView(CONFIG, 0, null, TALL);
    const wheel = named(car.root, "Wheel_FL");
    car.wheels = { suspension: four(30), steer: four(0), contact: four(true) };
    for (let i = 0; i < 60; i++) car.update(new Vector3(0, 30, 0), upright, false, false, false, FRAME);
    const turned = wheel.quaternion.clone();
    // (300 uu on along the car, under the 400 uu fallback: no roll for it)
    car.teleport();
    car.update(new Vector3(300, 30, 0), upright, false, false, false, FRAME);
    expect(wheel.quaternion.angleTo(turned)).toBeLessThan(1e-6);
    // (lifted off, then teleported: its hang at once, where easing would take a while)
    car.wheels = { suspension: four(30), steer: four(0), contact: four(false) };
    car.teleport();
    car.update(new Vector3(300, 30, 0), upright, false, false, false, FRAME);
    const first = wheel.position.clone();
    for (let i = 0; i < 120; i++) car.update(new Vector3(300, 30, 0), upright, false, false, false, FRAME);
    expect(first.distanceTo(wheel.position)).toBeLessThan(1e-6);
    car.dispose();
  });

  it("its supersonic trails from its own rear tyres' contact, not the physics' wheels (RV-590)", () => {
    const car = new CarView(CONFIG, 0, null, TALL);
    const wheels = [named(car.root, "Wheel_RL"), named(car.root, "Wheel_RR")];
    const sources = car.trailSources.map((v) => [v.x, v.y, v.z].map((n) => Math.round(n * 100) / 100));
    expect(sources).toHaveLength(2);
    for (const [i, wheel] of wheels.entries()) {
      // (along and across the car the wheel's own; below its centre by about its tyre's radius: not the physics' rear x)
      expect(sources[i]?.[0]).toBeCloseTo(wheel.position.x * UU_PER_METRE, 1);
      expect(sources[i]?.[2]).toBeCloseTo(wheel.position.z * UU_PER_METRE, 1);
      expect(sources[i]?.[1]).toBeLessThan(wheel.position.y * UU_PER_METRE - 10);
    }
    expect(Math.abs((sources[0]?.[0] ?? 0) - CONFIG.backWheel.offset.x)).toBeGreaterThan(1);
    car.dispose();
  });

  it("its exhausts at its empties (Sport's Exhaust_L/R: x -57, 12.86 up, 20.43 to each side), its Paint the team's (not metallic, one per colour)", () => {
    const sport = glbCarModel(0, new Color(0x2050ff));
    const parts = sport ? carModelParts(sport) : null;
    if (!sport || !parts) throw new Error("no Sport model");
    const at = (parts.exhausts ?? []).map((e) => [e.at.x, e.at.y, e.at.z].map((v) => Math.round(v * 100) / 100));
    expect(at).toEqual([
      [-57, 12.86, -20.43],
      [-57, 12.86, 20.43],
    ]);
    const paints: MeshPhysicalMaterial[] = [];
    sport.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial && o.material.name === "Paint") paints.push(o.material);
    });
    expect(paints.length).toBeGreaterThan(0);
    const paint = paints[0];
    expect(paint?.metalness).toBe(0);
    expect(paint?.color.getHex()).toBe(new Color(0x2050ff).multiplyScalar(0.734).getHex());
    const again = glbCarModel(0, new Color(0x2050ff));
    let shared = false;
    again?.traverse((o) => {
      if (o instanceof Mesh && o.material === paint) shared = true;
    });
    expect(shared).toBe(true);
  });

  it("its wheels turn by the travel (a tyre's radius rolled: a radian), and its shared geometry outlives the car (dispose leaves it)", () => {
    const car = new CarView(CONFIG, 0, null, TALL);
    const wheel = named(car.root, "Wheel_FL");
    const upright = new Quaternion();
    car.update(new Vector3(0, 30, 0), upright, false, false, false, FRAME);
    const before = wheel.quaternion.clone();
    // (15.29 uu along the car: Tall's front tyre's radius, a radian)
    car.update(new Vector3(15.29, 30, 0), upright, false, false, false, FRAME);
    expect(wheel.quaternion.angleTo(before)).toBeCloseTo(1, 2);
    let freed = 0;
    wheel.traverse((o) => {
      if (o instanceof Mesh)
        (o.geometry as BufferGeometry).addEventListener("dispose", () => {
          freed += 1;
        });
    });
    car.dispose();
    expect(freed).toBe(0);
  });
});
