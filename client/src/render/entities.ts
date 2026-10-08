// Visuals built from the physics shapes: the car is a body around its hitbox (src/render/carModel.ts), the ball is
// its collision sphere. Real models come later (roadmap §10).
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import type { BoostPadState, CarConfig, Team } from "../engine/world";
import { buildCarModel } from "./carModel";
import { SonicBoom, Trail } from "./supersonic";
import { toThreeVector } from "./coords";
import { vec3 } from "../math/vec";

export const BALL_RADIUS = 91.25;
const TEAM_CAR_COLORS = [new Color(0x1f6fff), new Color(0xff7a12)] as const;

/** A car: the boxy model built around its hitbox (src/render/carModel.ts) and a boost flame, in the car's local
 *  frame (x forward, y up, z right); and, in the world, its supersonic trails and shockwave (src/render/supersonic.ts). */
export class CarView {
  /** Add this to the scene: the car and its effects */
  readonly root = new Group();
  readonly #body = new Group(); // posed as the car
  readonly #flame: Mesh;
  readonly #trails: readonly [Trail, Trail] = [new Trail(), new Trail()];
  /** Where the trails leave the car: its rear corners, a little above the middle (local frame) */
  readonly #trailFrom: readonly [Vector3, Vector3];
  readonly #boom = new SonicBoom();
  #supersonic = false;
  readonly #point = new Vector3();

  constructor(config: CarConfig, team: Team) {
    this.#body.add(buildCarModel(config, TEAM_CAR_COLORS[team]));
    this.root.add(this.#body, ...this.#trails.map((t) => t.mesh), this.#boom.mesh);
    const rear = config.hitboxOffset.x - config.hitboxSize.x / 2 + 4;
    const height = config.hitboxOffset.z + config.hitboxSize.z * 0.1;
    const side = config.hitboxSize.y / 2 - 10;
    this.#trailFrom = [new Vector3(rear, height, -side), new Vector3(rear, height, side)];

    this.#flame = new Mesh(
      new ConeGeometry(14, 70, 12),
      new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85 }),
    );
    this.#flame.rotation.z = Math.PI / 2; // point backwards (-x)
    this.#flame.position.copy(
      toThreeVector(vec3(config.hitboxOffset.x - config.hitboxSize.x / 2 - 35, 0, config.hitboxOffset.z)),
    );
    this.#body.add(this.#flame);
  }

  /** A frame: the car's pose and state; `seconds` since the last frame (for the trails). */
  update(position: Vector3, rotation: Quaternion, boosting: boolean, demoed: boolean, supersonic = false, seconds = 0): void {
    this.#body.position.copy(position);
    this.#body.quaternion.copy(rotation);
    this.#flame.visible = boosting;
    this.root.visible = !demoed;
    const sonic = supersonic && !demoed;
    this.#trails.forEach((trail, i) => {
      const from = this.#trailFrom[i];
      if (from) trail.update(this.#point.copy(from).applyQuaternion(rotation).add(position), sonic, seconds);
    });
    if (sonic && !this.#supersonic) this.#boom.start(position, this.#point.set(1, 0, 0).applyQuaternion(rotation));
    this.#supersonic = sonic;
    this.#boom.update(seconds);
  }

  /** How many points the trails have (for tests). */
  get trailLength(): number {
    return Math.max(...this.#trails.map((t) => t.length));
  }
}

/** The ball, faceted and patched so its spin is visible, plus its marker on the floor straight below it. */
export class BallView {
  readonly root = new Group();
  readonly #ball: Mesh;
  readonly #marker: Mesh;
  readonly #fade = { value: 1 };

  constructor() {
    this.#ball = new Mesh(
      patchedBallGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, flatShading: true }),
    );
    // The ball's size, so it shows where the ball will come down; a plane a little bigger, to hold the rim
    this.#marker = new Mesh(
      new PlaneGeometry(BALL_RADIUS * 2 * MARKER_SPAN, BALL_RADIUS * 2 * MARKER_SPAN),
      new ShaderMaterial({
        vertexShader: MARKER_VERTEX,
        fragmentShader: MARKER_FRAGMENT,
        uniforms: { fade: this.#fade },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.#marker.rotation.x = -Math.PI / 2;
    this.#marker.renderOrder = 1; // (over the floor and its markings)
    this.root.add(this.#ball, this.#marker);
  }

  update(position: Vector3, rotation: Quaternion): void {
    this.#ball.position.copy(position);
    this.#ball.quaternion.copy(rotation);
    // On the floor straight below the ball, the ball's size at any height; a little fainter the higher it is
    this.#marker.position.set(position.x, 1, position.z);
    this.#fade.value = markerFade(Math.max(0, position.y - BALL_RADIUS));
  }

  /** The marker's place on the floor, and how strongly it shows (for tests). */
  get marker(): { readonly x: number; readonly z: number; readonly fade: number } {
    return { x: this.#marker.position.x, z: this.#marker.position.z, fade: this.#fade.value };
  }
}

/** The marker's plane, in ball radii from its centre to its edge. */
const MARKER_SPAN = 1.3;

/** How strongly the marker shows with the ball `height` uu off the floor: fully on the floor, never below 0.45. */
export function markerFade(height: number): number {
  return Math.max(0.45, 1 - height / 3000);
}

const MARKER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A soft dark disc the ball's size with a light rim round it: one or the other shows on any floor, dark or light
const MARKER_FRAGMENT = /* glsl */ `
uniform float fade;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0) * ${MARKER_SPAN.toFixed(2)}; // 1 at the ball's radius
  float core = (1.0 - smoothstep(0.5, 1.0, r)) * 0.6 * fade;
  // The rim stays at least a pixel and a half wide however far away (it would vanish into the floor otherwise)
  float width = max(0.09, fwidth(r) * 1.5);
  float rim = (1.0 - smoothstep(width * 0.5, width, abs(r - 0.97))) * 0.8 * (0.4 + 0.6 * fade);
  // The rim over the core
  float alpha = rim + core * (1.0 - rim);
  vec3 color = vec3(1.0, 0.97, 0.9) * rim / max(alpha, 1e-4);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

/** An icosphere with a dark pentagon around each of the 12 icosahedron vertices, like a football. */
export function patchedBallGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(BALL_RADIUS, 2); // non-indexed: three vertices per triangle
  const t = (1 + Math.sqrt(5)) / 2;
  const corners = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x = 0, y = 0, z = 0]) => new Vector3(x, y, z).normalize());
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const light = new Color(0xe8e8e8);
  const dark = new Color(0x30343c);
  const centre = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    centre.set(0, 0, 0);
    for (let k = 0; k < 3; k++) centre.add(v.fromBufferAttribute(position, i + k));
    centre.normalize();
    // The five triangles around a corner have their centres within about 13 degrees of it
    const patch = corners.some((c) => c.dot(centre) > Math.cos((18 * Math.PI) / 180));
    const color = patch ? dark : light;
    for (let k = 0; k < 3; k++) colors.set([color.r, color.g, color.b], (i + k) * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

/** Seconds a taken pad stays down (VehiclePickup RespawnDelay x RespawnDelayScale 1): the engine's pad cooldown. */
export const PAD_RESPAWN_SECONDS = { big: 10, small: 4 } as const;
/** The game's second warm-up stage starts this long before a pad is back (VehiclePickup_Boost_TA AlmostSpawnedTime) */
export const PAD_ALMOST_SPAWNED_SECONDS = 1;

/** Boost pads, instanced (ten draw calls for all of them): flat discs, big pads with an orb, small ones with a low
 *  cylinder; dimmed while respawning, with a warm-up as the game's: a ghost of the orb growing over the whole delay
 *  (its glow eases in: EaseInCirc), and in the last second a brighter, pulsing one (AlmostSpawnedEvent). */
export class BoostPadsView {
  readonly root = new Group();
  readonly #pads: readonly {
    readonly meshes: PadMeshes;
    readonly slot: number;
    readonly base: Matrix4;
    readonly orb: Matrix4;
    readonly delay: number;
  }[];
  readonly #shown: (boolean | null)[];
  readonly #scale = new Matrix4();
  readonly #m = new Matrix4();

  constructor(pads: readonly BoostPadState[]) {
    const active = new MeshStandardMaterial({ color: 0xffc533, emissive: 0x996a00, roughness: 0.4 });
    const inactive = new MeshStandardMaterial({ color: 0x4a4130, roughness: 0.9 });
    const warmup = new MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.3, depthWrite: false });
    const almost = new MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.65, depthWrite: false });
    const count = (big: boolean): number => pads.filter((p) => p.big === big).length;
    const big = padMeshes(new CylinderGeometry(80, 90, 6, 24), new IcosahedronGeometry(45, 1), count(true), active, inactive, warmup, almost);
    const small = padMeshes(new CylinderGeometry(50, 55, 6, 24), new CylinderGeometry(18, 18, 8, 12), count(false), active, inactive, warmup, almost);
    const slots = { big: 0, small: 0 };
    this.#pads = pads.map((pad) => {
      const at = toThreeVector(pad.pos);
      return {
        meshes: pad.big ? big : small,
        slot: pad.big ? slots.big++ : slots.small++,
        base: new Matrix4().makeTranslation(at.x, 3, at.z),
        orb: new Matrix4().makeTranslation(at.x, pad.big ? 70 : 12, at.z),
        delay: pad.big ? PAD_RESPAWN_SECONDS.big : PAD_RESPAWN_SECONDS.small,
      };
    });
    for (const m of [big, small]) this.root.add(m.active, m.inactive, m.orb);
    for (const m of [big, small]) this.root.add(m.warmup, m.almost);
    this.#shown = pads.map(() => null);
    this.update(pads);
  }

  update(pads: readonly BoostPadState[]): void {
    pads.forEach((pad, i) => {
      const p = this.#pads[i];
      if (!p) return;
      if (this.#shown[i] !== pad.active) {
        this.#shown[i] = pad.active;
        p.meshes.active.setMatrixAt(p.slot, pad.active ? p.base : HIDDEN);
        p.meshes.inactive.setMatrixAt(p.slot, pad.active ? HIDDEN : p.base);
        p.meshes.orb.setMatrixAt(p.slot, pad.active ? p.orb : HIDDEN);
        for (const mesh of [p.meshes.active, p.meshes.inactive, p.meshes.orb]) mesh.instanceMatrix.needsUpdate = true;
        if (pad.active) {
          p.meshes.warmup.setMatrixAt(p.slot, HIDDEN);
          p.meshes.almost.setMatrixAt(p.slot, HIDDEN);
          p.meshes.warmup.instanceMatrix.needsUpdate = p.meshes.almost.instanceMatrix.needsUpdate = true;
        }
      }
      if (pad.active) return;
      // The warm-up: how far through the delay (the game's normalized time), the glow easing in
      const t = Math.min(1, Math.max(0, 1 - pad.cooldown / p.delay));
      const glow = 1 - Math.sqrt(1 - t * t);
      this.#setScaled(p.meshes.warmup, p.slot, p.orb, 0.2 + 0.8 * glow);
      if (pad.cooldown <= PAD_ALMOST_SPAWNED_SECONDS) {
        const pulse = Math.sin((PAD_ALMOST_SPAWNED_SECONDS - pad.cooldown) * 2 * Math.PI * 3); // three pulses
        this.#setScaled(p.meshes.almost, p.slot, p.orb, 1 + 0.12 * pulse);
      } else {
        p.meshes.almost.setMatrixAt(p.slot, HIDDEN);
        p.meshes.almost.instanceMatrix.needsUpdate = true;
      }
    });
  }

  #setScaled(mesh: InstancedMesh, slot: number, at: Matrix4, scale: number): void {
    mesh.setMatrixAt(slot, this.#m.copy(at).multiply(this.#scale.makeScale(scale, scale, scale)));
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/** One size of pad: its disc lit and dimmed, its orb (only shown while lit) and the orb's warm-up ghosts (while down).
 *  Unused instances are scaled to 0. */
interface PadMeshes {
  readonly active: InstancedMesh;
  readonly inactive: InstancedMesh;
  readonly orb: InstancedMesh;
  readonly warmup: InstancedMesh;
  readonly almost: InstancedMesh;
}
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

function padMeshes(
  base: BufferGeometry,
  orb: BufferGeometry,
  count: number,
  active: MeshStandardMaterial,
  inactive: MeshStandardMaterial,
  warmup: MeshBasicMaterial,
  almost: MeshBasicMaterial,
): PadMeshes {
  const make = (geometry: BufferGeometry, material: MeshStandardMaterial | MeshBasicMaterial, hidden = false): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false; // (spread over the whole field)
    if (hidden) for (let i = 0; i < count; i++) mesh.setMatrixAt(i, HIDDEN);
    return mesh;
  };
  return {
    active: make(base, active),
    inactive: make(base, inactive),
    orb: make(orb, active),
    warmup: make(orb, warmup, true),
    almost: make(orb, almost, true),
  };
}
