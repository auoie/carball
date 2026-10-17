// The ball arrow (notes/hud-menus.md HUD-17; Interface "Ball Arrow", default on): a small round 3D arrow by the
// player's own car, pointing at the ball, seen only by its owner and drawn over everything (TargetIndicator_TA: a mesh
// component on the car, no depth test). BallLocatorArrow_SM along +X: the shaft r 2.25 from x -6.8 to 0.5, the head
// r 4.31 from 0.5 to the tip at 7.8, and a sphere r 12 round its origin. It sits 75 uu from the car's origin toward the
// ball with the ball 100 uu away or nearer, 120 uu at 10000 or farther (linear between), 20 uu up; it turns in 3D to
// the ball. Its materials, from the compiled shaders (ARW1): the sphere a black haze, alpha (N.V)^4 on its far inner
// side (inward normals): a soft dark disc; the arrow neutral grey, unlit, a flash sweeping tail to tip twice a second.
import {
  BackSide,
  ConeGeometry,
  CylinderGeometry,
  FrontSide,
  Group,
  Mesh,
  Quaternion,
  ShaderMaterial,
  type Side,
  SphereGeometry,
  Vector3,
} from "three";
import { type Vec3, length, scale, sub } from "../math/vec";
import { toThreeVector } from "./coords";

export const BALL_ARROW = { nearRadius: 75, farRadius: 120, nearDistance: 100, farDistance: 10000, up: 20 } as const;

/** Where the arrow goes for a car at `car` and the ball at `ball` (game coordinates), and which way it points; null
 *  when they're at one place */
export function ballArrowPose(car: Vec3, ball: Vec3): { readonly pos: Vec3; readonly dir: Vec3 } | null {
  const to = sub(ball, car);
  const distance = length(to);
  if (distance < 1e-3) return null;
  const dir = scale(to, 1 / distance);
  const { nearRadius, farRadius, nearDistance, farDistance, up } = BALL_ARROW;
  const t = Math.min(1, Math.max(0, (distance - nearDistance) / (farDistance - nearDistance)));
  const r = nearRadius + (farRadius - nearRadius) * t;
  return { pos: { x: car.x + dir.x * r, y: car.y + dir.y * r, z: car.z + dir.z * r + up }, dir };
}

const X_AXIS = new Vector3(1, 0, 0);
/** The arrow's length along x: the tail and the tip (its texture coordinate u: 0 at the tail, 1 at the tip) */
const TAIL = -6.8;
const TIP = 7.8;
const HAZE_RADIUS = 12;

/** The arrow's brightness (linear, R = G = B) at game time t (s) and u along it: 0.25, and a 125 ms triangle pulse to
 *  3.25 every 0.5 s that sweeps tail to tip in 62.5 ms (BallLocatorArrow_Mat: ARW1) */
export function ballArrowBrightness(t: number, u: number): number {
  const x = 4 * t - u / 4 + 1;
  const wrapped = x - 2 * Math.floor(x / 2); // (fmod, x > 0 in play; floored to stay in 0..2)
  return 0.25 + 12 * Math.min(1, Math.max(0, Math.abs(wrapped - 1) - 0.75));
}

/** The haze's opacity at ρ (the distance from its centre on screen over its radius): (N.V)^4 on the far side of the
 *  inward sphere, (1 - ρ^2)^2 */
export function ballArrowHaze(rho: number): number {
  return rho >= 1 ? 0 : (1 - rho * rho) ** 2;
}

const VIEW_NORMAL = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vU;
  uniform float uInward;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal) * uInward;
    vView = -view.xyz;
    vU = (position.x - (${TAIL.toFixed(2)})) / ${(TIP - TAIL).toFixed(2)};
    gl_Position = projectionMatrix * view;
  }`;

/** The haze: black, alpha (N.V)^4 */
const HAZE_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float nv = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    float a = nv * nv;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a * a);
  }`;

/** The arrow: E grey, opacity min(4 N.V, 1) (N.V^2 + 0.125) (not clamped: 1.125 face-on, as the game's float target) */
const ARROW_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vU;
  uniform float uTime;
  void main() {
    float nv = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    float x = 4.0 * uTime - vU / 4.0 + 1.0;
    float e = 0.25 + 12.0 * clamp(abs(x - 2.0 * floor(x / 2.0) - 1.0) - 0.75, 0.0, 1.0);
    gl_FragColor = vec4(vec3(e), min(4.0 * nv, 1.0) * (nv * nv + 0.125));
  }`;

function material(fragmentShader: string, side: Side, inward: number): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader: VIEW_NORMAL,
    fragmentShader,
    uniforms: { uTime: { value: 0 }, uInward: { value: inward } },
    side,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return m;
}

export class BallArrow {
  readonly root = new Group();
  readonly #dir = new Vector3();
  readonly #turn = new Quaternion();
  readonly #arrow: ShaderMaterial;
  #time = 0;
  /** The pose's offset from the car and its direction, kept while the ball is exploded (a goal: it freezes) */
  #offset: Vec3 | null = null;
  #pointing: Vec3 | null = null;

  constructor() {
    // The haze: the sphere with inward normals, so only its far inner side draws (the near side's faces turn away)
    // (24 x 12: its opacity (N.V)^4, nothing at its silhouette, so no facet shows: the integrated-graphics trims)
    const haze = new Mesh(new SphereGeometry(HAZE_RADIUS, 24, 12), material(HAZE_FRAGMENT, BackSide, -1));
    haze.renderOrder = 1000; // (over the world and the translucents, the haze first: the sphere is the mesh's slot 0)
    this.root.add(haze);
    this.#arrow = material(ARROW_FRAGMENT, FrontSide, 1);
    // (the cylinder and cone along y, turned to x; the shaft open where the head's base covers it)
    const shaft = new CylinderGeometry(2.25, 2.25, 0.5 - TAIL, 16, 1, false).rotateZ(-Math.PI / 2).translate((TAIL + 0.5) / 2, 0, 0);
    const head = new ConeGeometry(4.31, TIP - 0.5, 16).rotateZ(-Math.PI / 2).translate((TIP + 0.5) / 2, 0, 0);
    for (const geometry of [shaft, head]) {
      const mesh = new Mesh(geometry, this.#arrow);
      mesh.renderOrder = 1001;
      this.root.add(mesh);
    }
    this.root.visible = false;
  }

  /** Each frame: the drawn car and ball (game coordinates), or null to hide it; the frame's game time (s: slowed after
   *  a goal); whether the ball is exploded (a goal: the arrow stops updating, frozen by the car) */
  update(car: Vec3 | null, ball: Vec3 | null, frameSeconds = 0, exploded = false): void {
    this.#time += frameSeconds;
    const time = this.#arrow.uniforms["uTime"];
    if (time) time.value = this.#time;
    if (!car || !ball) {
      this.root.visible = false;
      this.#offset = null;
      this.#pointing = null;
      return;
    }
    if (!exploded || !this.#offset || !this.#pointing) {
      const pose = ballArrowPose(car, ball);
      this.#offset = pose ? sub(pose.pos, car) : null;
      this.#pointing = pose?.dir ?? null;
    }
    this.root.visible = this.#offset !== null;
    if (!this.#offset || !this.#pointing) return;
    toThreeVector({ x: car.x + this.#offset.x, y: car.y + this.#offset.y, z: car.z + this.#offset.z }, this.root.position);
    toThreeVector(this.#pointing, this.#dir).normalize();
    this.root.quaternion.copy(this.#turn.setFromUnitVectors(X_AXIS, this.#dir));
  }
}

/** Whether the arrow shows (Car_TA.RefreshTargetIndicators): the setting on, the ball cam off, the car alive and its
 *  own view, in a running round (the countdown, play, after a goal; not in a replay, not before or after the match) */
export function ballArrowShown(setting: boolean, ballCam: boolean, carAlive: boolean, roundShown: boolean): boolean {
  return setting && !ballCam && carAlive && roundShown;
}
