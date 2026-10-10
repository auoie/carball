// A car-on-car demolition as the game draws it (Demolish_FXActor, Demolished_New_PS): the static session's rl-fx/1
// export (out/bsim/assets_local/fx/demolition/, notes/visual-timing.md VT-19). The emitters' values are the game's;
// what its textures give (the flipbooks' colour, size and fade over their frames, the burnt husks' colour) is measured
// from them as values; the look is our own. No team colour anywhere. Placed at the car, in world axes (the FX actor's
// rotation is absolute: the car's is ignored). Game seconds after FinishDemo: 0 the burst (embers, the spark streams
// from 8 invisible sources, a flash, smoke, a fireball, a rising plume, the husks), 0.1 "BOOM!" (2 s), 1.85 the last
// spark, 2.0 the last smoke, 3.0 the husks gone (and the car's respawn).
import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Sprite,
  SpriteMaterial,
} from "three";
import { rotationAxes } from "../camera/unreal";
import type { Vec3 } from "../math/vec";
import { toThreeQuaternion, toThreeVector } from "./coords";
import { type Curve, type Curve3, Emitter, type EmitterSpec, type Particles, evaluate, evaluate3, unitDirection } from "./particles";

const curve = (times: readonly number[], values: readonly number[]): Curve => ({ times, values });
const curve3 = (times: readonly number[], values: readonly (readonly [number, number, number])[]): Curve3 => ({ times, values });
/** The flipbooks' base colour (their start colour) */
const FLIPBOOK_COLOR = [0.8, 0.9, 1] as const;

/** large_embers: 125 sparks flung out from a 200 uu sphere, stretched along their flight, blue-white to orange */
const EMBERS: EmitterSpec = {
  name: "demolition embers",
  blend: "additive",
  duration: 1,
  bursts: [{ time: 0, count: 125 }],
  lifetime: { min: 0.5, max: 1 },
  size: { min: 0.1, max: 0.5 },
  length: { min: 4, max: 6 },
  sizeOverLife: curve(
    [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1],
    [15, 14.374, 12.749, 10.507, 8.029, 5.698, 3.894, 3, 2.675, 2.336, 2.001, 1.688, 1.413, 1.195, 1.052, 1],
  ),
  lengthOverLife: curve(
    [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1],
    [10, 9.792, 9.238, 8.445, 7.519, 6.565, 5.69, 5, 4.397, 3.742, 3.075, 2.438, 1.87, 1.414, 1.11, 1],
  ),
  sphere: { radius: 200, surface: true, velocityScale: { min: 4, max: 6 } },
  velocityOverLife: curve3(
    [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1],
    (
      [
        [1, 2],
        [1.012, 1.988],
        [1.04, 1.951],
        [1.067, 1.887],
        [1.079, 1.792],
        [1.062, 1.664],
        [1, 1.5],
        [0.916, 1.325],
        [0.841, 1.165],
        [0.776, 1.02],
        [0.719, 0.89],
        [0.67, 0.773],
        [0.628, 0.67],
        [0.594, 0.581],
        [0.566, 0.504],
        [0.543, 0.44],
        [0.526, 0.389],
        [0.514, 0.35],
        [0.506, 0.322],
        [0.501, 0.305],
        [0.5, 0.3],
      ] as const
    ).map(([xy, z]) => [xy, xy, z] as const),
  ),
  acceleration: [{ min: [0, 0, -355], max: [0, 0, -720] }],
  color: [6, 6, 6],
  colorOverLife: curve3(
    [0, 0.058, 0.117, 0.175, 0.233, 0.292, 0.35],
    [
      [0.2, 1, 6],
      [0.63, 1, 5.57],
      [1.704, 1, 4.496],
      [3.1, 1, 3.1],
      [4.496, 1, 1.704],
      [5.57, 1, 0.63],
      [6, 1, 0.2],
    ],
  ),
};

/** follow and ExtraFollow: each 455 sparks a second for 0.35 s, taken in turn from the 8 sources (so per source, both
 *  together: 2 x 455 / 8 a second), with a tenth of the source's velocity */
const STREAM: EmitterSpec = {
  name: "demolition streams",
  blend: "additive",
  duration: 0.35,
  rate: (2 * 455) / 8,
  lifetime: { min: 1, max: 1.5 },
  size: { min: 0.25, max: 0.5 },
  length: { min: 4, max: 5 },
  sizeOverLife: curve([0, 0.05, 0.1, 0.75, 0.8, 0.85, 0.9, 0.95, 1], [0, 2, 4, 4, 3.584, 2.592, 1.408, 0.416, 0]),
  velocity: { min: [-55, -55, -55], max: [55, 55, 55] },
  inheritVelocity: 0.1,
  // (AccelerationOverLifetime: none until a tenth of its life, then down to -256..-512 by half of it)
  acceleration: [{ min: [0, 0, -512], max: [0, 0, -256] }],
  accelerationOverLife: curve([0.1, 0.5], [0, 1]),
  color: [6, 6, 6],
  colorOverLife: curve3([0], [[6, 0.8, 0.2]]),
};

/** Parent: the streams' 8 invisible sources, 75 uu out, flung at 2100-2400 uu/s (drawn at (0.5, 0.5, 1) of it) */
const SOURCES = { count: 8, radius: 75, speedScale: { min: 28, max: 32 }, drawn: [0.5, 0.5, 1], fall: { min: 855, max: 2048 }, life: { min: 0.38, max: 0.4 } };

/** Smoke: 3 near-black puffs (900-1065 uu), Explosion_FinalSheet_03's frames 0-63 over their life (measured: its
 *  colour, the cloud's size and density in each frame) */
const SMOKE: EmitterSpec = {
  name: "demolition smoke",
  // (a soft particle: Explosion_Smoke_02: Explosion_MAT's fade, DepthBias 0; RV-86)
  softDepth: 255,
  blend: "translucent",
  duration: 1,
  bursts: [{ time: 0, count: 3 }],
  lifetime: { min: 1.6, max: 2 },
  size: { min: 300, max: 355 },
  sizeOverLife: curve([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.95, 1], [0.276, 1.01, 1.532, 1.941, 2.277, 2.657, 2.972, 2.71, 1.005, 0]),
  sphere: { radius: 50, surface: true, velocityScale: { min: 1, max: 2 } },
  color: FLIPBOOK_COLOR,
  colorOverLife: curve([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.95, 1], [0.027, 0.03, 0.03, 0.03, 0.029, 0.029, 0.028, 0.025, 0.016, 0.009]),
  alphaOverLife: curve([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.95, 1], [0.301, 0.828, 0.928, 0.929, 0.915, 0.889, 0.637, 0.278, 0.133, 0]),
};

/** The fireball (Menu): 8 sprites (300-455 uu, growing x 2.2), white-hot (x 12) cooling to x 1 by 0.6 of their life,
 *  Explosion_FinalSheet_04's frames 16-63 (measured, as the smoke's) */
const FIREBALL: EmitterSpec = {
  name: "demolition fireball",
  // (a soft particle: Explosion_02_MIC: DepthBias 0; RV-86)
  softDepth: 255,
  blend: "translucent",
  duration: 1,
  bursts: [{ time: 0, count: 8 }],
  lifetime: { min: 1, max: 1.5 },
  size: { min: 300, max: 455 },
  sizeOverLife: curve([0, 0.125, 0.25, 0.375, 0.5, 0.6, 0.625, 0.75, 0.875, 0.95, 1], [0.526, 0.961, 1.281, 1.597, 1.878, 2.024, 2.047, 2.166, 2.088, 0.935, 0]),
  velocity: { min: [0, 0, 45], max: [0, 0, 55] },
  velocityOverLife: curve([0, 0.05, 0.1, 0.15, 0.2, 0.25], [6, 5.376, 3.888, 2.112, 0.624, 0]),
  sphere: { radius: 50, surface: true, velocityScale: { min: 1, max: 2 } },
  color: FLIPBOOK_COLOR,
  colorOverLife: curve3(
    [0, 0.125, 0.25, 0.375, 0.5, 0.6, 0.625, 0.75, 0.875, 0.95, 1],
    [
      [9.283, 5.46, 2.568],
      [9.006, 5.534, 2.617],
      [6.21, 3.275, 1.688],
      [2.537, 1.179, 0.85],
      [0.448, 0.435, 0.432],
      [0.148, 0.149, 0.149],
      [0.15, 0.152, 0.151],
      [0.151, 0.153, 0.153],
      [0.139, 0.14, 0.139],
      [0.082, 0.08, 0.082],
      [0, 0, 0],
    ],
  ),
  alphaOverLife: curve([0, 0.125, 0.25, 0.375, 0.5, 0.6, 0.625, 0.75, 0.875, 0.95, 1], [0.921, 0.917, 0.913, 0.944, 0.951, 0.915, 0.9, 0.713, 0.34, 0.131, 0]),
};

/** Up: one 800 uu plume 300 uu above, rising at 100 uu/s slowing to rest, x 6 cooling to x 1 by 0.7 of its life,
 *  Explosion_FinalSheet_05's frames 0-63 (measured) */
const PLUME: EmitterSpec = {
  name: "demolition plume",
  // (a soft particle: Explosion_03_MIC: DepthBias 0; RV-86)
  softDepth: 255,
  blend: "translucent",
  duration: 1,
  bursts: [{ time: 0, count: 1 }],
  lifetime: 1.5,
  size: 800,
  sizeOverLife: curve([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.7, 0.75, 0.875, 0.95, 1], [0.18, 0.507, 0.662, 0.787, 0.911, 0.99, 0.998, 0.981, 1, 0.927, 0]),
  offset: [0, 0, 300],
  velocity: { min: [0, 0, 100], max: [0, 0, 100] },
  velocityOverLife: curve([0, 1], [1, 0]),
  color: FLIPBOOK_COLOR,
  colorOverLife: curve3(
    [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.7, 0.75, 0.875, 0.95, 1],
    [
      [2.192, 1.256, 0.533],
      [2.843, 1.611, 0.77],
      [3.169, 1.893, 0.913],
      [2.873, 1.816, 0.882],
      [1.488, 0.732, 0.41],
      [0.231, 0.177, 0.165],
      [0.114, 0.111, 0.11],
      [0.116, 0.114, 0.115],
      [0.145, 0.144, 0.145],
      [0.14, 0.14, 0.14],
      [0.047, 0.048, 0.047],
    ],
  ),
  alphaOverLife: curve([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.7, 0.75, 0.875, 0.95, 1], [0.859, 0.859, 0.853, 0.851, 0.866, 0.91, 0.908, 0.899, 0.709, 0.314, 0]),
};

/** The flash: an additive 2048 uu sprite for 0.5 s, (4, 1, 0.2) x 3 at half alpha, peaking at a tenth of its life;
 *  FlashGradient_MAT's hot point: (1 - |uv - 0.5|)^12, squared (29 % at 5 % of its size) */
const FLASH: EmitterSpec = {
  name: "demolition flash",
  // (a soft particle: FlashGradient_MAT; RV-86)
  softDepth: 227.5,
  blend: "additive",
  falloff: 24,
  duration: 1,
  bursts: [{ time: 0, count: 1 }],
  lifetime: 0.5,
  size: 2048,
  color: [4, 1, 0.2],
  colorOverLife: 3,
  alpha: 0.5,
  alphaOverLife: curve(
    [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1],
    [0, 0.5, 1, 0.991, 0.966, 0.926, 0.874, 0.811, 0.741, 0.664, 0.583, 0.5, 0.417, 0.336, 0.259, 0.189, 0.126, 0.074, 0.034, 0.009, 0],
  ),
};

export const DEMOLITION: readonly EmitterSpec[] = [EMBERS, SMOKE, FIREBALL, PLUME, FLASH];

/** "BOOM!": from 0.1 s for 2 s, 600 uu 100 uu above the wreck, x 6 cooling to x 1 by 0.35; Boom_Text_Explosion's frames
 *  5-63 measured: the word's width in its frame, its colour and density */
const BOOM = {
  delay: 0.1,
  life: 2,
  size: 600,
  offset: 100,
  times: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
  width: [0.5, 0.602, 0.648, 0.711, 0.773, 0.844, 0.914, 0.227, 0],
  colour: [
    [0.87, 0.7, 0.28],
    [0.88, 0.73, 0.31],
    [0.84, 0.68, 0.29],
    [0.74, 0.53, 0.22],
    [0.37, 0.19, 0.16],
    [0.15, 0.15, 0.15],
    [0.16, 0.17, 0.16],
    [0.12, 0.12, 0.12],
    [0, 0, 0],
  ] as const,
  alpha: [0.728, 0.81, 0.838, 0.854, 0.849, 0.836, 0.563, 0.21, 0],
  heat: curve([0, 0.35], [6, 1]),
  /** A soft particle (Explosion_MAT, its DepthBias 0.75: 63.75 uu), fading where the floor is just behind it (RV-113) */
  softDepth: 63.75,
} as const;

// --- the husks ---

/** Collision is traced only within this of the camera; the first frame a husk is farther it falls through for good */
export const HUSK_COLLISION_RANGE = 1000;
export const HUSK_SECONDS = 3;

export type HuskKind = "engine" | "chassis" | "rim";

/** A husk's motion (a Cascade mesh particle): BaseVelocity and its acceleration, drawn at 3 x BaseVelocity */
export interface HuskMotion {
  readonly kind: HuskKind;
  pos: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  readonly fall: number;
  /** Turns per second about its x (roll) and y (pitch); its angles so far */
  readonly spin: { readonly roll: number; readonly pitch: number };
  angle: { roll: number; pitch: number };
  /** World contacts left before it freezes (engine and chassis: 1; rims 3 or 4, bouncing before the last) */
  contactsLeft: number;
  frozen: boolean;
  /** Still traced against the world (within range of the camera every frame so far) */
  colliding: boolean;
}

const uniform = (random: () => number, min: number, max: number): number => min + (max - min) * random();

/** A husk flung from the car's origin: 50 uu out along normalize(U(-1, 1)^3), BaseVelocity that direction x U(400,
 *  500), its acceleration -U(512, 600) in z, roll U(0, 1) turns/s, pitch U(0, 1) + U(0.5, 1) */
export function launchHusk(kind: HuskKind, at: Vec3, random: () => number = Math.random): HuskMotion {
  let d = { x: uniform(random, -1, 1), y: uniform(random, -1, 1), z: uniform(random, -1, 1) };
  const n = Math.hypot(d.x, d.y, d.z) || 1;
  d = { x: d.x / n, y: d.y / n, z: d.z / n };
  const speed = 50 * uniform(random, 8, 10);
  return {
    kind,
    pos: { x: at.x + d.x * 50, y: at.y + d.y * 50, z: at.z + d.z * 50 },
    base: { x: d.x * speed, y: d.y * speed, z: d.z * speed },
    fall: uniform(random, 512, 600),
    spin: { roll: random(), pitch: random() + uniform(random, 0.5, 1) },
    angle: { roll: 0, pitch: 0 },
    contactsLeft: kind === "rim" ? Math.round(uniform(random, 3, 4)) : 1,
    frozen: false,
    colliding: true,
  };
}

/** The arena as planes for the husks' point traces (the rounded edges and corners as their chords): inside when
 *  n.p >= d. In the field: the floor, ceiling, side walls, corners and back walls (open at the goal mouths); inside a
 *  goal: its floor, roof, sides and back. */
interface Plane {
  readonly n: readonly [number, number, number];
  readonly d: number;
}
const S = Math.SQRT1_2;
const FIELD: readonly Plane[] = [
  { n: [0, 0, 1], d: 0 },
  { n: [0, 0, -1], d: -2044 },
  { n: [-1, 0, 0], d: -4096 },
  { n: [1, 0, 0], d: -4096 },
  { n: [0, -1, 0], d: -5120 },
  { n: [0, 1, 0], d: -5120 },
  ...[
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([sx = 1, sy = 1]): Plane => ({ n: [-sx * S, -sy * S, 0], d: -7680 * S })),
];
const GOAL_HALF_WIDTH = 893;
const GOAL_HEIGHT = 642;
const GOAL_BACK = 6000;
const GOAL: readonly Plane[] = [
  { n: [0, 0, 1], d: 0 },
  { n: [0, 0, -1], d: -GOAL_HEIGHT },
  { n: [-1, 0, 0], d: -GOAL_HALF_WIDTH },
  { n: [1, 0, 0], d: -GOAL_HALF_WIDTH },
  { n: [0, -1, 0], d: -GOAL_BACK },
  { n: [0, 1, 0], d: -GOAL_BACK },
];

/** The first world contact on the segment from `p` to `q` (its fraction along and the surface normal), or null */
export function traceWorld(p: Vec3, q: Vec3): { readonly t: number; readonly n: readonly [number, number, number] } | null {
  const inGoal = Math.abs(p.y) > 5120;
  let best: { t: number; n: readonly [number, number, number] } | null = null;
  for (const plane of inGoal ? GOAL : FIELD) {
    const f = (v: Vec3): number => plane.n[0] * v.x + plane.n[1] * v.y + plane.n[2] * v.z - plane.d;
    const fp = f(p);
    const fq = f(q);
    if (fp < 0 || fq >= 0) continue; // (starting outside, as a husk flung under the floor: no contact)
    const t = fp / (fp - fq);
    // (the back walls are open at the goal mouths)
    if (!inGoal && plane.n[1] !== 0 && plane.n[0] === 0) {
      const x = p.x + (q.x - p.x) * t;
      const z = p.z + (q.z - p.z) * t;
      if (Math.abs(x) < GOAL_HALF_WIDTH && z < GOAL_HEIGHT) continue;
    }
    if (!best || t < best.t) best = { t, n: plane.n };
  }
  return best;
}

/** A frame of a husk (Cascade's order: BaseVelocity += a dt; Velocity = 3 BaseVelocity; collision; Location +=
 *  Velocity dt). `camera`: where the camera is (null: unknown, always in range) */
export function stepHusk(h: HuskMotion, dt: number, camera: Vec3 | null, random: () => number = Math.random): void {
  if (h.frozen || dt <= 0) return;
  h.base.z -= h.fall * dt;
  const v = { x: 3 * h.base.x, y: 3 * h.base.y, z: 3 * h.base.z };
  const next = { x: h.pos.x + v.x * dt, y: h.pos.y + v.y * dt, z: h.pos.z + v.z * dt };
  if (h.colliding && camera && Math.hypot(next.x - camera.x, next.y - camera.y, next.z - camera.z) > HUSK_COLLISION_RANGE) h.colliding = false;
  const hit = h.colliding ? traceWorld(h.pos, next) : null;
  h.angle.roll += h.spin.roll * dt;
  h.angle.pitch += h.spin.pitch * dt;
  if (!hit) {
    h.pos = next;
    return;
  }
  h.pos = { x: h.pos.x + v.x * dt * hit.t, y: h.pos.y + v.y * dt * hit.t, z: h.pos.z + v.z * dt * hit.t };
  h.contactsLeft -= 1;
  if (h.contactsLeft <= 0) {
    h.frozen = true; // (EPCC_FreezeMovement: stops dead, no more turning)
    return;
  }
  // A bounce: BaseVelocity reflected off the surface, each axis x U(0.25, 0.3)
  const [nx, ny, nz] = hit.n;
  const into = h.base.x * nx + h.base.y * ny + h.base.z * nz;
  h.base = {
    x: (h.base.x - 2 * into * nx) * uniform(random, 0.25, 0.3),
    y: (h.base.y - 2 * into * ny) * uniform(random, 0.25, 0.3),
    z: (h.base.z - 2 * into * nz) * uniform(random, 0.25, 0.3),
  };
  h.pos = { x: h.pos.x + nx * 0.01, y: h.pos.y + ny * 0.01, z: h.pos.z + nz * 0.01 };
}

/** The game's husk meshes on the dev server (out/bsim/assets_local/fx/demolition/meshes: their own burnt look baked),
 *  else boxes and wheels of their bounds, burnt grey (the baked textures' mean, unlit) */
let huskMeshes: Record<HuskKind, Object3D> | null = null;

/** Loads the game's husk meshes if the dev server has them; whether it did */
export async function loadDemolitionHusks(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const base = "/local-assets/fx/demolition/meshes/";
    const [engine, chassis, rim] = await Promise.all(
      ["Engine_Incinerator_SM", "Chassis01_SM", "rim_Caliber_SM"].map(async (name) => (await loader.loadAsync(`${base}${name}.glb`)).scene),
    );
    if (!engine || !chassis || !rim) return false;
    huskMeshes = { engine, chassis, rim };
    return true;
  } catch {
    return false;
  }
}

const BURNT = new MeshBasicMaterial({ color: 0x5d5e60 }); // (linear 0.11-0.14: sRGB about 0x5d)

/** Our own husks: boxes and a wheel of the game's meshes' bounds (UE: x forward, y right, z up; in Three's frame
 *  x, z, y), made once */
let fallbackGeometry: Record<HuskKind, BufferGeometry> | null = null;

function fallbackHusk(kind: HuskKind): Object3D {
  fallbackGeometry ??= {
    engine: new BoxGeometry(47.8, 28.5, 40.4),
    chassis: new BoxGeometry(124, 32.4, 73.5).translate(7, 1.3, 0),
    // (a rim: round in UE x-z, its axle along UE y: Three's z)
    rim: new CylinderGeometry(11.4, 11.4, 14.2, 14).rotateX(Math.PI / 2),
  };
  return new Mesh(fallbackGeometry[kind], BURNT);
}

function huskObject(kind: HuskKind): Object3D {
  const object = huskMeshes ? huskMeshes[kind].clone() : fallbackHusk(kind);
  const scale = kind === "rim" ? 1.5 : 1;
  object.scale.setScalar(scale);
  const group = new Group();
  group.add(object);
  return group;
}

// --- the effect ---

interface Source {
  pos: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  readonly fall: number;
  readonly life: number;
  readonly emitter: Emitter;
}

let boomTexture: CanvasTexture | null | undefined;

/** The sprite's material: soft against the floor as the particles are (src/render/particles.ts: the scene behind taken as
 *  the floor, Three's y = 0; the fade in view depth over BOOM.softDepth) */
export function boomMaterial(texture: CanvasTexture | null): SpriteMaterial {
  const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vSoftWorld;\n${shader.vertexShader.replace(
      "#include <fog_vertex>",
      "vSoftWorld = (inverse(viewMatrix) * mvPosition).xyz;\n#include <fog_vertex>",
    )}`;
    shader.fragmentShader = `varying vec3 vSoftWorld;\n${shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `{
        vec3 dir = normalize(vSoftWorld - cameraPosition);
        if (dir.y < -1e-4) {
          vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
          diffuseColor.a *= clamp(vSoftWorld.y / -dir.y * dot(dir, forward) / ${BOOM.softDepth.toFixed(2)}, 0.0, 1.0);
        }
      }
      #include <opaque_fragment>`,
    )}`;
  };
  material.customProgramCacheKey = () => "boom soft";
  return material;
}

/** "BOOM!" drawn once (our own lettering), white: the sprite's colour tints it */
function boom(): CanvasTexture | null {
  if (boomTexture !== undefined) return boomTexture;
  boomTexture = null;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = "900 132px Impact, 'Arial Black', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.strokeText("BOOM!", 256, 84);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("BOOM!", 256, 84);
  boomTexture = new CanvasTexture(canvas);
  return boomTexture;
}

export class Demolition {
  readonly #emitters: Emitter[];
  readonly #sources: Source[] = [];
  readonly #husks: { readonly motion: HuskMotion; readonly object: Object3D }[] = [];
  readonly #boom: Sprite | null;
  readonly #at: Vec3;
  readonly #random: () => number;
  #age = 0;

  /** At the car's origin (game frame); its velocity is not inherited */
  constructor(particles: Particles, scene: Object3D, at: Vec3, random: () => number = Math.random) {
    this.#at = at;
    this.#random = random;
    this.#emitters = DEMOLITION.map((spec) => {
      const e = new Emitter(particles, spec);
      e.start();
      return e;
    });
    for (let i = 0; i < SOURCES.count; i++) {
      const d = unitDirection(random); // (the game's: normalize(U(-1, 1)^3))
      const k = SOURCES.radius * uniform(random, SOURCES.speedScale.min, SOURCES.speedScale.max);
      const emitter = new Emitter(particles, STREAM);
      emitter.start();
      this.#sources.push({
        pos: { x: at.x + d.x * SOURCES.radius, y: at.y + d.y * SOURCES.radius, z: at.z + d.z * SOURCES.radius },
        base: { x: d.x * k, y: d.y * k, z: d.z * k },
        fall: uniform(random, SOURCES.fall.min, SOURCES.fall.max),
        life: uniform(random, SOURCES.life.min, SOURCES.life.max),
        emitter,
      });
    }
    for (const kind of ["engine", "chassis", "rim", "rim", "rim", "rim"] as const) {
      const object = huskObject(kind);
      const motion = launchHusk(kind, at, random);
      toThreeVector(motion.pos, object.position);
      scene.add(object);
      this.#husks.push({ motion, object });
    }
    const texture = boom();
    if (texture) {
      this.#boom = new Sprite(boomMaterial(texture));
      this.#boom.visible = false;
      toThreeVector({ x: at.x, y: at.y, z: at.z + BOOM.offset }, this.#boom.position);
      scene.add(this.#boom);
    } else this.#boom = null;
  }

  get done(): boolean {
    return this.#age >= HUSK_SECONDS;
  }

  /** `seconds` of world time; `camera`: where it is now (the husks' collision range), null: unknown */
  update(seconds: number, camera: Vec3 | null = null): void {
    const dt = Math.max(0, seconds);
    this.#age += dt;
    for (const e of this.#emitters) if (e.active) e.update(seconds, this.#at);
    for (const s of this.#sources) {
      if (this.#age > s.life) continue;
      s.base.z -= s.fall * dt;
      const [kx, ky, kz] = SOURCES.drawn;
      const v = { x: s.base.x * (kx ?? 1), y: s.base.y * (ky ?? 1), z: s.base.z * (kz ?? 1) };
      s.pos = { x: s.pos.x + v.x * dt, y: s.pos.y + v.y * dt, z: s.pos.z + v.z * dt };
      if (s.emitter.active) s.emitter.update(seconds, s.pos, undefined, v);
    }
    for (const { motion, object } of this.#husks) {
      stepHusk(motion, dt, camera, this.#random);
      toThreeVector(motion.pos, object.position);
      const axes = rotationAxes({ pitch: motion.angle.pitch * 65536, yaw: 0, roll: motion.angle.roll * 65536 });
      toThreeQuaternion(axes, object.quaternion);
      object.visible = this.#age < HUSK_SECONDS;
    }
    if (this.#boom) {
      const t = (this.#age - BOOM.delay) / BOOM.life;
      this.#boom.visible = t >= 0 && t < 1;
      if (this.#boom.visible) {
        const width = evaluate(curve(BOOM.times, BOOM.width), t);
        // (size over life: its height doubles; the word's width in its frame from the flipbook)
        this.#boom.scale.set(BOOM.size * width, BOOM.size * width * 0.31 * (1 + t), 1);
        const [r, g, b] = evaluate3(curve3(BOOM.times, BOOM.colour), t);
        const heat = evaluate(BOOM.heat, t);
        // (linear HDR: the post-processing tone-maps it, PP-17)
        const linear = (c: number): number => c * heat;
        this.#boom.material.color.setRGB(linear(r * FLIPBOOK_COLOR[0]), linear(g * FLIPBOOK_COLOR[1]), linear(b * FLIPBOOK_COLOR[2]));
        this.#boom.material.opacity = evaluate(curve(BOOM.times, BOOM.alpha), t);
      }
    }
  }

  dispose(): void {
    for (const { object } of this.#husks) object.removeFromParent();
    if (this.#boom) {
      this.#boom.removeFromParent();
      this.#boom.material.dispose();
    }
  }
}
