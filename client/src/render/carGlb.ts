// Carball's car models made in Blender (the user's, 2026-10-18: client/cars/README.md): client/cars/<type>.glb for the
// garage's cars (sport, flat, tall), each where it's there, else the generated car (src/render/carModel.ts). A model is in
// metres (1 m = 100 uu) on the car's frame (x forward, y up, z right: glTF's own with the front along +X) about the
// physics body's origin: its Body, its four wheels (Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR, each about its own centre,
// where the model draws it), its exhausts (every empty named Exhaust…: Exhaust_L and Exhaust_R, Exhaust_Top and
// Exhaust_Bottom, one Exhaust; each blowing along its own -X, straight back unturned; none: found on the body as the
// generated cars' are). Its Paint takes the team's colour; Light_Head and Light_Tail are emissive as the file has them.
// The wheels are posed every frame as the game does: where the model has them along and across the car, their height
// and steering the physics' (the vehicle's suspension and steer angle), turning as the car moves.
import { type Color, Group, type Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Object3D, Quaternion, Vector3 } from "three";
import type { CarConfig, CarWheels } from "../engine/world";

/** The models there are (client/cars/*.glb), by file: their URLs (a build's hashed under /assets/; none, the generated
 *  cars) */
const FILES = import.meta.glob<string>("../../cars/*.glb", { query: "?url", import: "default", eager: true });

/** Each garage car's model (src/game/cars.ts ids: 0 Sport, 2 Flat, 3 Tall) */
export const CAR_FILES: Readonly<Record<number, string>> = { 0: "sport", 2: "flat", 3: "tall" };

/** uu a metre (the models' unit) */
export const UU_PER_METRE = 100;

/** The wheels' nodes in the engine's order (front right, front left, back right, back left: CarWheels') */
export const WHEEL_NODES = ["Wheel_FR", "Wheel_FL", "Wheel_RR", "Wheel_RL"] as const;

/** The exhausts' nodes: every one named so (a pair side by side, a stacked pair, a single one) */
export const EXHAUST_PREFIX = "Exhaust";

/** The Paint's shade on the team's colour, its clear coat (the generated cars' Glossy finish: notes/car-paint.md PNT-6) */
const GLOSSY_SHADE = 0.734;

/** What a loaded model's car needs each frame: its wheels (the engine's order), each's rest pose and radius, and its
 *  exhausts (where, car frame, uu; their turn from the car's, straight back unturned; by name; null: none in the model) */
export interface CarModelParts {
  readonly wheels: readonly {
    readonly node: Object3D;
    /** its position and turn as the model has them (the model's frame, metres) */
    readonly rest: Vector3;
    readonly turn: Quaternion;
    /** its radius as drawn (uu: its turning as the car moves) */
    readonly radius: number;
  }[];
  readonly exhausts: readonly { readonly at: Vector3; readonly turn: Quaternion }[] | null;
}

const loaded = new Map<number, Group>();
const parts = new WeakMap<Object3D, CarModelParts>();
const paints = new Map<string, Material>();

/** What a model must hold (else the generated car): its Body and its four wheels, by name */
export function missingParts(names: ReadonlySet<string>): string[] {
  return ["Body", ...WHEEL_NODES].filter((name) => !names.has(name));
}

/** Loads the models there are (each one that fails, or lacks a part, left to the generated car: said in the console);
 *  how many loaded */
export async function loadCarModels(): Promise<number> {
  const wanted = Object.entries(CAR_FILES).flatMap(([id, name]) => {
    const url = FILES[`../../cars/${name}.glb`];
    return url ? [{ id: Number(id), name, url }] : [];
  });
  if (wanted.length === 0) return 0;
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    await Promise.all(
      wanted.map(async ({ id, name, url }) => {
        try {
          const scene = (await loader.loadAsync(url)).scene;
          const names = new Set<string>();
          scene.traverse((o) => names.add(o.name));
          const missing = missingParts(names);
          if (missing.length > 0) {
            console.warn(`cars/${name}.glb: no ${missing.join(", ")}; the generated car instead`);
            return;
          }
          loaded.set(id, scene);
        } catch (e) {
          console.warn(`cars/${name}.glb: ${e instanceof Error ? e.message : String(e)}; the generated car instead`);
        }
      }),
    );
  } catch {
    // (no loader: the generated cars)
  }
  return loaded.size;
}

/** The Paint in the team's colour (the generated cars' finish on it, the file's roughness kept), one per colour */
function paintFor(original: MeshStandardMaterial, paint: Color): Material {
  const key = `${original.uuid}|${String(paint.getHex())}`;
  const known = paints.get(key);
  if (known) return known;
  const material = new MeshPhysicalMaterial({
    name: original.name,
    color: paint.clone().multiplyScalar(GLOSSY_SHADE),
    roughness: original.roughness,
    metalness: original.metalness,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    side: original.side,
  });
  paints.set(key, material);
  return material;
}

/** A node's position (uu) and turn in the car's frame (`root` unposed: the model's own) */
function inCar(node: Object3D, root: Object3D): { readonly at: Vector3; readonly turn: Quaternion } {
  root.updateMatrixWorld(true);
  return { at: root.worldToLocal(node.getWorldPosition(new Vector3())), turn: node.getWorldQuaternion(new Quaternion()) };
}

/** The model of garage car `car` in `paint` (its geometry and other materials shared: not freed with the car), in the
 *  car's frame (x forward, y up, z right; uu), or null: none loaded for it */
export function glbCarModel(car: number, paint: Color): Group | null {
  const source = loaded.get(car);
  if (!source) return null;
  const scene = source.clone(true);
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const recolour = (m: Material): Material => (m instanceof MeshStandardMaterial && m.name === "Paint" ? paintFor(m, paint) : m);
    o.material = Array.isArray(o.material) ? o.material.map(recolour) : recolour(o.material as Material);
  });
  scene.scale.setScalar(UU_PER_METRE);
  const model = new Group();
  model.add(scene);
  const wheels = WHEEL_NODES.map((name) => {
    const node = scene.getObjectByName(name) ?? new Group();
    let radius = 0;
    node.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const geometry = o.geometry as { boundingSphere: { radius: number } | null; computeBoundingSphere: () => void };
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      radius = Math.max(radius, (geometry.boundingSphere?.radius ?? 0) * UU_PER_METRE);
    });
    return { node, rest: node.position.clone(), turn: node.quaternion.clone(), radius: radius > 1 ? radius : 13 };
  });
  const found: Object3D[] = [];
  scene.traverse((o) => {
    if (o.name.startsWith(EXHAUST_PREFIX)) found.push(o);
  });
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const exhausts = found.length > 0 ? found.map((n) => inCar(n, model)) : null;
  parts.set(model, { wheels, exhausts });
  return model;
}

/** A model's parts, if it's one of these (glbCarModel's) */
export function carModelParts(model: Object3D): CarModelParts | null {
  return parts.get(model) ?? null;
}

const STEER_AXIS = new Vector3(0, 1, 0);
const SPIN_AXIS = new Vector3(0, 0, 1);
const steering = new Quaternion();
const spinning = new Quaternion();

/** A wheel's pose this frame (the model's frame, metres): along and across the car where the model has it; its centre's
 *  height the physics' (its connection point's height less its suspension: `config`'s), else the model's; steered by the
 *  physics' angle (a positive one to the car's right, turning about the car's up: three's -y); turned `spin` radians
 *  about its axle (the car's right) */
export function wheelPose(
  rest: Vector3,
  turn: Quaternion,
  index: number,
  config: CarConfig,
  wheels: CarWheels | null,
  spin: number,
): { readonly position: Vector3; readonly quaternion: Quaternion } {
  const position = rest.clone();
  const physics = index < 2 ? config.frontWheel : config.backWheel;
  if (wheels) position.y = (physics.offset.z - (wheels.suspension[index] ?? physics.suspensionRest)) / UU_PER_METRE;
  steering.setFromAxisAngle(STEER_AXIS, -(wheels?.steer[index] ?? 0));
  spinning.setFromAxisAngle(SPIN_AXIS, spin);
  return { position, quaternion: steering.clone().multiply(spinning).multiply(turn) };
}

/** A wheel's turning for `travelled` uu along the car (forward: its top going forward, about its axle the car's right) */
export function wheelSpin(travelled: number, radius: number): number {
  return -travelled / radius;
}
