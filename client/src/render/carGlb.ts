// Carball's car models made in Blender (the user's, 2026-10-18: client/cars/README.md): client/cars/<type>.glb for the
// garage's cars (sport, flat, tall), each where it's there, else the generated car (src/render/carModel.ts). A model is in
// metres (1 m = 100 uu) on the car's frame (x forward, y up, z right: glTF's own with the front along +X) about the
// physics body's origin: its Body, its four wheels (Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR, each about its own centre,
// where the model draws it), its exhausts (every empty named Exhaust…: Exhaust_L and Exhaust_R, Exhaust_Top and
// Exhaust_Bottom, one Exhaust; each blowing along its own -X, straight back unturned; none: found on the body as the
// generated cars' are). Its Paint takes the team's colour; Light_Head and Light_Tail the generated cars' lamps (clipped,
// as the game's show: PNT-12, not the file's bright emissive, which bloomed over the body: RX26).
// The wheels are drawn every frame as the game draws them (the static session's SU1, live exe CarMeshComponent_TA's wheel
// update): where the model has them along and across the car; each dropped from where the model has it as far as its
// tyre must go to sit on the physics' contact, within its body's drawn travel (none touching: its full hang upright,
// less as the car tilts, tucked up upside down), eased there at 10/s but snapped up when the ground pushes it; steered
// toward the physics' angle at the same rate; turning as the car moves.
import {
  type Color,
  Group,
  LinearSRGBColorSpace,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { WheelConfig } from "../engine/world";
import { CHASSIS_SPRINGS, DEFAULT_SPRING, type SpringSpec } from "./chassisSpring";
import { HEADLIGHT, TAILLIGHT } from "./carParts";

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
    /** its tyre's radius as drawn (uu: where it sits on the contact, its turning as the car moves) */
    readonly radius: number;
  }[];
  readonly exhausts: readonly { readonly at: Vector3; readonly turn: Quaternion }[] | null;
  /** how far its wheels are drawn below where the model has them (uu: DRAWN_TRAVEL's) */
  readonly travel: { readonly min: number; readonly max: number };
  /** its Body (as the model has it: the sway turns it about its chassis bone, the wheels apart) and its spring */
  readonly body: { readonly node: Object3D; readonly rest: Vector3; readonly turn: Quaternion };
  readonly spring: SpringSpec;
}

/** Each garage car's drawn wheel travel (uu below the model's wheels: the game's bodies these follow, SuspensionTravelMin
 *  and Max: Sport the Fennec's 2-6, Flat the Dominus's 0-4, Tall the Merc's 0-8) */
export const DRAWN_TRAVEL: Readonly<Record<number, { readonly min: number; readonly max: number }>> = {
  0: { min: 2, max: 6 },
  2: { min: 0, max: 4 },
  3: { min: 0, max: 8 },
};

/** The drawn wheels' easing toward their target (/s: WheelSteerBlendRate, the suspension's too; the share min(10 dt, 1)) */
export const WHEEL_BLEND = 10;

const loaded = new Map<number, Group>();
const parts = new WeakMap<Object3D, CarModelParts>();
const paints = new Map<string, Material>();

/** What a model must hold (else the generated car): its Body and its four wheels, by name */
export function missingParts(names: ReadonlySet<string>): string[] {
  return ["Body", ...WHEEL_NODES].filter((name) => !names.has(name));
}

/** A model's longest wait (ms): one that never answers left to the generated car, the loading screen not held (RX26) */
export const CAR_LOAD_TIMEOUT = 10_000;

/** Whether garage car `car` has its model loaded */
export function hasCarModel(car: number): boolean {
  return loaded.has(car);
}

/** Loads the models there are (each one that fails, lacks a part or takes longer than CAR_LOAD_TIMEOUT, left to the
 *  generated car: said in the console); how many loaded. `load`: a model's scene from its URL (the tests'; else three's
 *  GLTFLoader) */
export async function loadCarModels(load: ((url: string) => Promise<Object3D>) | null = null): Promise<number> {
  const wanted = Object.entries(CAR_FILES).flatMap(([id, name]) => {
    const url = FILES[`../../cars/${name}.glb`];
    return url ? [{ id: Number(id), name, url }] : [];
  });
  if (wanted.length === 0) return 0;
  try {
    const fetchScene = load ?? (await gltfLoad());
    await Promise.all(
      wanted.map(async ({ id, name, url }) => {
        try {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const late = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`no answer in ${String(CAR_LOAD_TIMEOUT / 1000)} s`));
            }, CAR_LOAD_TIMEOUT);
          });
          const scene = await Promise.race([fetchScene(url), late]).finally(() => {
            clearTimeout(timer);
          });
          const names = new Set<string>();
          scene.traverse((o) => names.add(o.name));
          const missing = missingParts(names);
          if (missing.length > 0) {
            console.warn(`cars/${name}.glb: no ${missing.join(", ")}; the generated car instead`);
            return;
          }
          loaded.set(id, scene as Group);
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

/** three's GLTFLoader, loaded when first wanted (its own chunk) */
async function gltfLoad(): Promise<(url: string) => Promise<Object3D>> {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  return async (url) => (await loader.loadAsync(url)).scene;
}

/** The Paint in the team's colour (the generated cars' finish on it: not metallic, PNT-6, RV-584; the file's roughness
 *  kept), one per colour */
function paintFor(original: MeshStandardMaterial, paint: Color): Material {
  const key = `${original.uuid}|${String(paint.getHex())}`;
  const known = paints.get(key);
  if (known) return known;
  const material = new MeshPhysicalMaterial({
    name: original.name,
    color: paint.clone().multiplyScalar(GLOSSY_SHADE),
    roughness: original.roughness,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    side: original.side,
  });
  paints.set(key, material);
  return material;
}

/** The lamps: the generated cars' (carParts' carMaterials: black, emissive the clipped colour at 1), one each, shared */
const lamps = new Map<string, Material>();
function lampFor(original: MeshStandardMaterial): Material {
  const known = lamps.get(original.name);
  if (known) return known;
  const [r, g, b] = original.name === "Light_Head" ? HEADLIGHT : TAILLIGHT;
  const material = new MeshStandardMaterial({ name: original.name, color: 0x000000, side: original.side });
  material.emissive.setRGB(r, g, b, LinearSRGBColorSpace);
  lamps.set(original.name, material);
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
    const recolour = (m: Material): Material =>
      !(m instanceof MeshStandardMaterial) ? m : m.name === "Paint" ? paintFor(m, paint) : m.name === "Light_Head" || m.name === "Light_Tail" ? lampFor(m) : m;
    o.material = Array.isArray(o.material) ? o.material.map(recolour) : recolour(o.material as Material);
  });
  scene.scale.setScalar(UU_PER_METRE);
  const model = new Group();
  model.add(scene);
  const wheels = WHEEL_NODES.map((name) => {
    const node = scene.getObjectByName(name) ?? new Group();
    // (the tyre's radius: its meshes' reach about the axle, the node's z; their own frames the node's, as the export has them)
    let radius = 0;
    node.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const geometry = o.geometry as { boundingBox: { min: Vector3; max: Vector3 } | null; computeBoundingBox: () => void };
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (box) radius = Math.max(radius, Math.max(box.max.x, -box.min.x, box.max.y, -box.min.y) * UU_PER_METRE);
    });
    return { node, rest: node.position.clone(), turn: node.quaternion.clone(), radius: radius > 1 ? radius : 13 };
  });
  const found: Object3D[] = [];
  scene.traverse((o) => {
    if (o.name.startsWith(EXHAUST_PREFIX)) found.push(o);
  });
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const exhausts = found.length > 0 ? found.map((n) => inCar(n, model)) : null;
  const body = scene.getObjectByName("Body") ?? new Group();
  parts.set(model, {
    wheels,
    exhausts,
    travel: DRAWN_TRAVEL[car] ?? { min: 0, max: 6 },
    body: { node: body, rest: body.position.clone(), turn: body.quaternion.clone() },
    spring: CHASSIS_SPRINGS[car] ?? DEFAULT_SPRING,
  });
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

/** A drawn wheel's target (uu below where the model has it, as a negative offset), SU1: how far it must drop for its tyre
 *  (`radius`, its centre `modelZ` uu up in the car's frame) to sit on the physics' contact (the physics wheel's centre,
 *  its connection point less its suspension `length`, one physics radius above it), or with no contact (`length` null)
 *  its hang by the car's tilt (`upZ`, its up's world z: full upright, its least upside down); kept within `travel` */
export function wheelDropTarget(
  modelZ: number,
  radius: number,
  physics: Pick<WheelConfig, "offset" | "radius">,
  length: number | null,
  upZ: number,
  travel: { readonly min: number; readonly max: number },
): number {
  const contactZ = length === null ? 0 : physics.offset.z - length - physics.radius;
  const drop = length === null ? travel.min + ((travel.max - travel.min) * (upZ + 1)) / 2 : modelZ - contactZ - radius;
  return -Math.max(travel.min, Math.min(travel.max, drop));
}

/** A drawn value eased toward its target over `dt` s (the share min(10 dt, 1)); a touching wheel pushed up (`snapUp`, a
 *  target above it) jumps there */
export function easeWheel(current: number, target: number, dt: number, snapUp = false): number {
  if (snapUp && target > current) return target;
  return current + Math.min(WHEEL_BLEND * dt, 1) * (target - current);
}

/** A wheel's pose (the model's frame, metres): where the model has it, dropped `drop` uu (negative: down), steered by
 *  `steer` (a positive one to the car's right, about the car's up: three's -y), turned `spin` radians about its axle (the
 *  car's right); the model's own turn under them */
export function wheelPose(
  rest: Vector3,
  turn: Quaternion,
  drop: number,
  steer: number,
  spin: number,
): { readonly position: Vector3; readonly quaternion: Quaternion } {
  const position = rest.clone();
  position.y += drop / UU_PER_METRE;
  steering.setFromAxisAngle(STEER_AXIS, -steer);
  spinning.setFromAxisAngle(SPIN_AXIS, spin);
  return { position, quaternion: steering.clone().multiply(spinning).multiply(turn) };
}

/** A wheel's turning for `travelled` uu along the car (forward: its top going forward, about its axle the car's right) */
export function wheelSpin(travelled: number, radius: number): number {
  return -travelled / radius;
}
