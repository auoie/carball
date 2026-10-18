// The Blender cars' tyres never show through their bodies in play (RV-598, the static session's landing probe): the real
// engine drives each car through a jump from rest, a 300 uu drop and a jump at 1400 uu/s, its drawn wheels and body sway
// posed frame by frame as the game draws them (VT-32), and no Body vertex may come inside a tyre's cylinder in any frame.
// Skipped where client/cars has none of the models.
import createEngine from "@engine/carball_engine.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type BufferGeometry, Matrix4, Mesh, type Object3D, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CarBody, type CarControls, NO_CONTROLS, World, initEngine } from "../engine/world";
import { TICK_SECONDS } from "../loop/fixedStep";
import { vec3 } from "../math/vec";
import { arenaMeshes } from "../testing/arena";
import { CAR_FILES, WHEEL_NODES, hasCarModel, loadCarModels } from "./carGlb";
import { toThreeQuaternion, toThreeVector } from "./coords";
import { CarView } from "./entities";

const CARS = new URL("../../cars", import.meta.url).pathname;
const MODELS = existsSync(CARS) ? readdirSync(CARS).filter((f) => f.endsWith(".glb")) : [];
const BODIES: Record<number, CarBody> = { 0: CarBody.Standard, 2: CarBody.Flat, 3: CarBody.Tall };
const UPRIGHT = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) };
const ZERO = vec3(0, 0, 0);
const FPS = 60;
/** Known to fail, its model's fix pending (each fails until then: a fixed model passes it, and this list must lose it).
 *  None now: Flat's arches fixed by CB1-F2, Tall's by F3 and F4 (RV-598) */
const KNOWN = new Set<string>([]);

let engine: Awaited<ReturnType<typeof createEngine>>;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
  if (MODELS.length === 0) return;
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  await loadCarModels(async (url) => {
    const bytes = readFileSync(join(CARS, url.slice(url.lastIndexOf("/") + 1)));
    return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
  });
});

/** The Body's vertices inside each tyre's cylinder (its extent along the axle and its radius, in its own frame), and the
 *  deepest of them (uu in from the tyre's surface) */
function inside(root: Object3D): { count: number; depth: number } {
  root.updateMatrixWorld(true);
  const verts: Vector3[] = [];
  root.getObjectByName("Body")?.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const pos = (o.geometry as BufferGeometry).getAttribute("position");
    for (let i = 0; i < pos.count; i++) verts.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  let count = 0;
  let depth = 0;
  const p = new Vector3();
  for (const name of WHEEL_NODES) {
    const node = root.getObjectByName(name);
    if (!node) continue;
    const toWheel = new Matrix4().copy(node.matrixWorld).invert();
    let [zMin, zMax, radius] = [Infinity, -Infinity, 0];
    node.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const pos = (o.geometry as BufferGeometry).getAttribute("position");
      const m = new Matrix4().multiplyMatrices(toWheel, o.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m);
        [zMin, zMax, radius] = [Math.min(zMin, p.z), Math.max(zMax, p.z), Math.max(radius, Math.hypot(p.x, p.y))];
      }
    });
    for (const v of verts) {
      p.copy(v).applyMatrix4(toWheel);
      const r = Math.hypot(p.x, p.y);
      if (p.z > zMin + 1e-4 && p.z < zMax - 1e-4 && r < radius * 0.995) {
        count++;
        depth = Math.max(depth, (radius - r) * node.getWorldScale(p.clone()).x);
      }
    }
  }
  return { count, depth };
}

describe.skipIf(MODELS.length === 0)("the Blender cars' tyres stay out of their bodies (RV-598)", () => {
  const cases: readonly [string, (w: World, id: number) => void, (t: number) => CarControls][] = [
    [
      "a jump from rest",
      (w, id) => {
        w.setCar(id, { pos: vec3(0, 0, 17), vel: ZERO, angVel: ZERO, rot: UPRIGHT, boost: 33 });
        w.step(240);
      },
      (t) => ({ ...NO_CONTROLS, jump: t < 0.2 }),
    ],
    [
      "a 300 uu drop",
      (w, id) => {
        w.setCar(id, { pos: vec3(0, 0, 300), vel: ZERO, angVel: ZERO, rot: UPRIGHT, boost: 33 });
      },
      () => NO_CONTROLS,
    ],
    [
      "a jump at 1400 uu/s",
      (w, id) => {
        w.setCar(id, { pos: vec3(-2000, 0, 17), vel: vec3(1400, 0, 0), angVel: ZERO, rot: UPRIGHT, boost: 33 });
        w.step(60);
      },
      (t) => ({ ...NO_CONTROLS, throttle: 1, jump: t < 0.2 }),
    ],
  ];
  for (const [id, file] of Object.entries(CAR_FILES)) {
    const car = Number(id);
    for (const [what, setup, controls] of cases) {
      const name = `${file}: ${what}`;
      const test = !MODELS.includes(`${file}.glb`) ? it.skip : KNOWN.has(name) ? it.fails : it;
      test(`${name}, 2.5 s frame by frame`, () => {
        expect(hasCarModel(car)).toBe(true);
        const world = World.create(engine);
        const carId = world.addCar(0, BODIES[car] ?? CarBody.Standard);
        const view = new CarView(world.carConfig(carId), 0, null, car);
        setup(world, carId);
        const frames: string[] = [];
        let ticks = 0;
        for (let f = 0; f < 2.5 * FPS; f++) {
          // (the engine's ticks this frame, the controls by the time since the start)
          const due = Math.round((f + 1) / FPS / TICK_SECONDS);
          while (ticks < due) {
            world.setControls(carId, controls(ticks * TICK_SECONDS));
            world.step(1);
            ticks++;
          }
          const state = world.car(carId);
          view.wheels = { ...world.carWheels(carId), contact: state.wheelContact };
          view.update(toThreeVector(state.pos), toThreeQuaternion(state.rot), false, false, false, 1 / FPS);
          const { count, depth } = inside(view.root);
          if (count > 0) frames.push(`${String(f)}: ${String(count)}, ${depth.toFixed(2)} uu deep`);
        }
        view.dispose();
        world.dispose();
        expect(frames, "frames with Body vertices inside a tyre (frame: vertices, depth)").toEqual([]);
      });
    }
  }
});
