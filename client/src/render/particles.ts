// Particles, after the game's Cascade emitters as the static session described them (notes/visual-timing.md; its
// rl-fx/1 summaries: spawn rate, bursts and spawning per distance; lifetime; start size, colour and alpha and their
// curves over life; start velocity, the velocity a spawn sphere gives, acceleration; local-space emitters, whose
// particles move with them). The values are the game's; the look is our own (a soft procedural sprite, with the
// materials' colour over life where the data gives the formula). Positions in the game's frame (x, y, z up); HDR
// colours, tone-mapped in the shader (1 - e^-c) as there is no bloom: additive ones as I = colour x alpha x shape,
// unclamped (the game's rgb = I C.rgb C.a). One instanced quad per particle, two draw calls (additive, translucent).
import { AdditiveBlending, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial } from "three";
import type { Vec3 } from "../math/vec";

/** A value or a uniform range */
export type Range = number | { readonly min: number; readonly max: number };
/** A curve over a particle's life (t = age / lifetime) or an emitter's time: linear, clamped */
export interface Curve {
  readonly times: readonly number[];
  readonly values: readonly number[];
}
/** A curve of three channels (colour, or velocity per axis) */
export interface Curve3 {
  readonly times: readonly number[];
  readonly values: readonly (readonly [number, number, number])[];
}
export interface VecRange {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface EmitterSpec {
  readonly name: string;
  readonly blend: "additive" | "translucent";
  /** Seconds it spawns for after its delay (rate and per-distance); its bursts at their times */
  readonly duration: number;
  readonly delay?: number;
  /** Spawns over and over while active (false: once, then done) */
  readonly loops?: boolean;
  readonly rate?: number;
  readonly bursts?: readonly { readonly time: number; readonly count: number }[];
  /** Spawning by distance (GetSpawnAmount 0x140ad5550: RV-85): each frame floor((d + L) count / unit) for a move of d uu,
   *  `count` drawn each frame, the leftover L = max(0, d + L - n unit) a distance (so a rate over 1 a unit spawns at most
   *  what the move covers); a frame's move over `maxFrame` uu (a teleport) spawns none and drops the leftover */
  readonly perUnit?: { readonly unit: number; readonly count: Range; readonly maxFrame?: number };
  /** Its second LOD (UE3's: what Particle Detail Performance draws, ParticleLODBias 1; and at any setting beyond `beyond`
   *  uu of the camera: notes/post-processing.md QG-24/25) */
  readonly lod?: { readonly beyond: number; readonly spec: EmitterSpec };
  readonly lifetime: Range;
  /** Start size (uu): width, and the length for a sprite stretched along its velocity */
  readonly size: Range;
  readonly length?: Range;
  readonly sizeOverLife?: Curve;
  /** The length's own curve (a stretched sprite's size over life per axis; else sizeOverLife) */
  readonly lengthOverLife?: Curve;
  /** Start velocity (uu/s), in the emitter's frame (`local`) or the world's */
  readonly velocity?: VecRange;
  /** A local-space emitter: its particles live in its frame and move with it (bUseLocalSpace) */
  readonly local?: boolean;
  /** A spawn sphere: radius (or a curve over emitter time), only on its surface; its offset times `velocityScale` as a
   *  start velocity. Directions as the game draws them: normalize(U(-1, 1)^3), biased towards the cube's corners */
  readonly sphere?: { readonly radius: number | Curve; readonly surface?: boolean; readonly velocityScale?: Range };
  readonly offset?: readonly [number, number, number];
  readonly velocityOverLife?: Curve | Curve3;
  readonly acceleration?: readonly VecRange[];
  /** The acceleration's scale over life (AccelerationOverLifetime: none before its first key) */
  readonly accelerationOverLife?: Curve;
  /** The share of the source's velocity a particle starts with (a source moving: Emitter.update's `velocity`) */
  readonly inheritVelocity?: number;
  /** Linear HDR colour (the emitter's colour parameter's default; `colour` at the emitter overrides) */
  readonly color: readonly [number, number, number];
  readonly colorOverLife?: Curve | Curve3 | number;
  /** The material's colour over life: P C + (1 - P) `to` (x `toScale`), P the material's parameter curve (SmokePuff:
   *  lerp(0.5, C, P1); Smoke_Explosion: P1 C + (1 - P1) P2 (0.558, 0.502, 0.401)) */
  readonly colorFade?: { readonly to: readonly [number, number, number]; readonly param: Curve; readonly toScale?: Curve };
  readonly alpha?: Range;
  readonly alphaOverLife?: Curve;
  /** The sprite's falloff: (1 - |uv - 0.5|)^falloff (FlashGradient: 24, a hot point); else our soft disc */
  readonly falloff?: number;
  /** A soft particle's fade, sat((SceneDepth - PixelDepth) / softDepth) (uu: FlashGradient's 227.5, Explosion_MAT's 255 (1 -
   *  DepthBias)): the scene behind it taken as the floor (no depth texture here: RV-86) */
  readonly softDepth?: number;
}

const MAX_PARTICLES = 4096;

export function evaluate(curve: Curve, t: number): number {
  const { times, values } = curve;
  const n = times.length;
  if (n === 0) return 1;
  if (t <= (times[0] ?? 0)) return values[0] ?? 1;
  for (let i = 1; i < n; i++) {
    const t1 = times[i] ?? 0;
    if (t <= t1) {
      const t0 = times[i - 1] ?? 0;
      const v0 = values[i - 1] ?? 1;
      const v1 = values[i] ?? 1;
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return values[n - 1] ?? 1;
}

const pick = (r: Range, random: () => number): number => (typeof r === "number" ? r : r.min + (r.max - r.min) * random());

function isCurve3(curve: Curve | Curve3): curve is Curve3 {
  return typeof curve.values[0] === "object";
}

/** A three-channel curve at `t` (linear, clamped) */
export function evaluate3(curve: Curve3, t: number): readonly [number, number, number] {
  const channel = (c: number): number => evaluate({ times: curve.times, values: curve.values.map((v) => v[c] ?? 1) }, t);
  return [channel(0), channel(1), channel(2)];
}

/** Either kind of curve, per channel */
function channels(curve: Curve | Curve3, t: number): readonly [number, number, number] {
  if (isCurve3(curve)) return evaluate3(curve, t);
  const v = evaluate(curve, t);
  return [v, v, v];
}

/** A particle's linear HDR colour at `t` of its life: its start colour, the colour scale over life, the material's
 *  fade (for tests and the shader's input) */
export function particleColor(spec: EmitterSpec, start: readonly number[], t: number): readonly [number, number, number] {
  const over = spec.colorOverLife;
  const scale = over === undefined ? ([1, 1, 1] as const) : typeof over === "number" ? ([over, over, over] as const) : channels(over, t);
  const c = [0, 1, 2].map((k) => (start[k] ?? 1) * (scale[k] ?? 1));
  const fade = spec.colorFade;
  if (!fade) return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  const p = evaluate(fade.param, t);
  const s = fade.toScale ? evaluate(fade.toScale, t) : 1;
  const mix = (k: number): number => p * (c[k] ?? 0) + (1 - p) * (fade.to[k] ?? 0) * s;
  return [mix(0), mix(1), mix(2)];
}

/** An additive sprite's output at `t` of its life, as the shader has it: colour x alpha x the sprite's shape there (1 at
 *  its centre), linear HDR (the post-processing tone-maps it: PP-17); the alpha an intensity, unclamped (the game's rgb
 *  = I C.rgb C.a) */
export function additiveOutput(spec: EmitterSpec, start: readonly number[], alpha: number, t: number, shape = 1): readonly [number, number, number] {
  const c = particleColor(spec, start, t);
  const a = alpha * (spec.alphaOverLife ? evaluate(spec.alphaOverLife, t) : 1);
  const linear = (v: number): number => Math.max(0, v) * Math.max(0, a) * shape;
  return [linear(c[0]), linear(c[1]), linear(c[2])];
}

/** A spawn sphere's offset (SpawnEx 0x140ac6130: RV-82): on the surface, a unit direction times the radius; in the
 *  volume, u = U(-1, 1)^3 times the radius, clamped to the sphere along u (so uniform in the ball when |u| <= 1, and
 *  on its surface otherwise: 1 - pi/6 of the draws) */
export function spherePoint(random: () => number, radius: number, surface: boolean): Vec3 {
  if (surface) {
    const dir = unitDirection(random);
    return { x: dir.x * radius, y: dir.y * radius, z: dir.z * radius };
  }
  const u = { x: random() * 2 - 1, y: random() * 2 - 1, z: random() * 2 - 1 };
  const k = radius / Math.max(1, Math.hypot(u.x, u.y, u.z));
  return { x: u.x * k, y: u.y * k, z: u.z * k };
}

/** A random unit direction as the game's draws are (RV-52d): normalize(U(-1, 1)^3) (a zero draw: straight up). The
 *  game's DetermineUnitDirection (live 0x140ab5310) draws U(-1, 1)^3 without normalising it; SpawnEx's SurfaceOnly
 *  spheres (0x140ac6130) normalise it before scaling by the radius, which is what the demolition's emitters use
 *  (RV-113) */
export function unitDirection(random: () => number): Vec3 {
  const v = { x: random() * 2 - 1, y: random() * 2 - 1, z: random() * 2 - 1 };
  const n = Math.hypot(v.x, v.y, v.z);
  return n > 1e-6 ? { x: v.x / n, y: v.y / n, z: v.z / n } : { x: 0, y: 0, z: 1 };
}

const vertexShader = /* glsl */ `
attribute vec3 center;
attribute vec2 size; // width, length (stretched along axis when axis is set)
attribute vec3 axis;
attribute vec4 tint;
attribute float falloff;
attribute float soft;
varying vec2 vUv;
varying vec4 vTint;
varying float vFalloff;
varying float vSoft;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vTint = tint;
  vFalloff = falloff;
  vSoft = soft;
  vec3 toCamera = normalize(cameraPosition - center);
  vec3 right;
  vec3 up;
  if (dot(axis, axis) > 1e-6) {
    up = normalize(axis);
    right = cross(up, toCamera);
    float l = length(right);
    right = l > 1e-4 ? right / l : vec3(1.0, 0.0, 0.0);
  } else {
    vec3 worldUp = abs(toCamera.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    right = normalize(cross(worldUp, toCamera));
    up = cross(toCamera, right);
  }
  vec3 world = center + right * position.x * size.x + up * position.y * size.y;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec4 vTint;
varying float vFalloff;
varying float vSoft;
varying vec3 vWorld;
uniform bool additive;
void main() {
  // A soft round sprite (translucent ones softer and thinner: the game's smoke textures cover about half their quad),
  // or the material's own falloff; the HDR colour tone-mapped (there's no bloom)
  float r = length(vUv - 0.5);
  float shape = clamp(1.0 - 2.0 * r, 0.0, 1.0);
  shape = additive ? shape * shape : shape * shape * shape * 0.5;
  if (vFalloff > 0.0) shape = pow(clamp(1.0 - r, 0.0, 1.0), vFalloff);
  // A soft particle fades where the scene is just behind it: here the floor (Three's y = 0), how far behind along the
  // view, in view depth
  if (vSoft > 0.0) {
    vec3 dir = normalize(vWorld - cameraPosition);
    if (dir.y < -1e-4) {
      vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
      shape *= clamp(vWorld.y / -dir.y * dot(dir, forward) / vSoft, 0.0, 1.0);
    }
  }
  vec3 rgb = max(vTint.rgb, 0.0);
  if (additive) {
    // (rgb = I C.rgb C.a: the alpha an intensity, unclamped: linear HDR for the post-processing's tone map, PP-17)
    gl_FragColor = vec4(rgb * max(vTint.a, 0.0) * shape, 1.0);
  } else {
    gl_FragColor = vec4(rgb, clamp(vTint.a * shape, 0.0, 1.0));
  }
  #include <colorspace_fragment>
}
`;

/** Where a local-space emitter is: its particles are placed by it every frame */
interface FrameRef {
  origin: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

const toWorld = (f: FrameRef, x: number, y: number, z: number): Vec3 => ({
  x: f.origin.x + f.forward.x * x + f.right.x * y + f.up.x * z,
  y: f.origin.y + f.forward.y * x + f.right.y * y + f.up.y * z,
  z: f.origin.z + f.forward.z * x + f.right.z * y + f.up.z * z,
});

/** One draw call's particles (additive or translucent) */
class Pool {
  readonly mesh: Mesh;
  readonly #center: InstancedBufferAttribute;
  readonly #size: InstancedBufferAttribute;
  readonly #axis: InstancedBufferAttribute;
  readonly #tint: InstancedBufferAttribute;
  readonly #falloff: InstancedBufferAttribute;
  readonly #soft: InstancedBufferAttribute;
  readonly #geometry: InstancedBufferGeometry;
  // Per particle (structure of arrays); a local-space particle's position, velocity and acceleration in its frame
  count = 0;
  readonly pos = new Float32Array(MAX_PARTICLES * 3);
  readonly vel = new Float32Array(MAX_PARTICLES * 3);
  readonly acc = new Float32Array(MAX_PARTICLES * 3);
  readonly startVel = new Float32Array(MAX_PARTICLES * 3); // (velocity over life scales the start velocity)
  readonly age = new Float32Array(MAX_PARTICLES);
  readonly life = new Float32Array(MAX_PARTICLES);
  readonly width = new Float32Array(MAX_PARTICLES);
  readonly length = new Float32Array(MAX_PARTICLES); // 0: a round sprite
  readonly alpha = new Float32Array(MAX_PARTICLES);
  readonly color = new Float32Array(MAX_PARTICLES * 3);
  readonly spec: (EmitterSpec | undefined)[] = new Array<EmitterSpec | undefined>(MAX_PARTICLES);
  readonly frame: (FrameRef | null)[] = new Array<FrameRef | null>(MAX_PARTICLES).fill(null);
  readonly owner: (object | null)[] = new Array<object | null>(MAX_PARTICLES).fill(null);

  constructor(additive: boolean) {
    const quad = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    this.#center = new InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.#size = new InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 2), 2);
    this.#axis = new InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.#tint = new InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4);
    this.#falloff = new InstancedBufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    this.#soft = new InstancedBufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    for (const [name, a] of [
      ["center", this.#center],
      ["size", this.#size],
      ["axis", this.#axis],
      ["tint", this.#tint],
      ["falloff", this.#falloff],
      ["soft", this.#soft],
    ] as const) {
      a.setUsage(35048); // (DynamicDrawUsage)
      g.setAttribute(name, a);
    }
    g.instanceCount = 0;
    this.#geometry = g;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { additive: { value: additive } },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  spawn(
    spec: EmitterSpec,
    p: Vec3,
    v: Vec3,
    a: Vec3,
    life: number,
    width: number,
    length: number,
    alpha: number,
    color: readonly number[],
    frame: FrameRef | null,
    owner: object | null,
  ): void {
    if (this.count >= MAX_PARTICLES) return;
    const i = this.count++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.startVel.set([v.x, v.y, v.z], i * 3);
    this.acc.set([a.x, a.y, a.z], i * 3);
    this.age[i] = 0;
    this.life[i] = Math.max(1e-3, life);
    this.width[i] = width;
    this.length[i] = length;
    this.alpha[i] = alpha;
    this.color.set([color[0] ?? 1, color[1] ?? 1, color[2] ?? 1], i * 3);
    this.spec[i] = spec;
    this.frame[i] = frame;
    this.owner[i] = owner;
  }

  update(dt: number): void {
    let n = this.count;
    for (let i = 0; i < n;) {
      const age = (this.age[i] ?? 0) + dt;
      const life = this.life[i] ?? 1;
      if (age >= life) {
        this.#move(n - 1, i);
        n--;
        continue;
      }
      this.age[i] = age;
      const spec = this.spec[i];
      const k = i * 3;
      // Acceleration (scaled over life) into the velocity; velocity over life scales it
      const t = age / life;
      const accel = spec?.accelerationOverLife ? evaluate(spec.accelerationOverLife, t) : 1;
      for (let c = 0; c < 3; c++) this.startVel[k + c] = (this.startVel[k + c] ?? 0) + (this.acc[k + c] ?? 0) * accel * dt;
      const scale = spec?.velocityOverLife ? channels(spec.velocityOverLife, t) : ([1, 1, 1] as const);
      for (let c = 0; c < 3; c++) {
        this.vel[k + c] = (this.startVel[k + c] ?? 0) * (scale[c] ?? 1);
        this.pos[k + c] = (this.pos[k + c] ?? 0) + (this.vel[k + c] ?? 0) * dt;
      }
      i++;
    }
    this.count = n;
    this.#write();
  }

  /** Every particle of `owner` gone at once (KillParticlesForced) */
  kill(owner: object): void {
    let n = this.count;
    for (let i = 0; i < n;) {
      if (this.owner[i] === owner) {
        this.#move(n - 1, i);
        n--;
      } else i++;
    }
    this.count = n;
    this.#write();
  }

  /** The particle's position in the world (game frame) */
  worldPosition(i: number): Vec3 {
    const k = i * 3;
    const [x, y, z] = [this.pos[k] ?? 0, this.pos[k + 1] ?? 0, this.pos[k + 2] ?? 0];
    const f = this.frame[i];
    return f ? toWorld(f, x, y, z) : { x, y, z };
  }

  #move(from: number, to: number): void {
    if (from === to) return;
    for (const a of [this.pos, this.vel, this.acc, this.startVel, this.color]) a.copyWithin(to * 3, from * 3, from * 3 + 3);
    for (const a of [this.age, this.life, this.width, this.length, this.alpha]) a[to] = a[from] ?? 0;
    this.spec[to] = this.spec[from];
    this.frame[to] = this.frame[from] ?? null;
    this.owner[to] = this.owner[from] ?? null;
  }

  /** How many particles the buffers last held (none, and none again: nothing to upload) */
  #written = -1;

  #write(): void {
    const n = this.count;
    if (n === 0 && this.#written === 0) return;
    this.#written = n;
    const center = this.#center.array as Float32Array;
    const size = this.#size.array as Float32Array;
    const axis = this.#axis.array as Float32Array;
    const tint = this.#tint.array as Float32Array;
    const falloff = this.#falloff.array as Float32Array;
    const soft = this.#soft.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const spec = this.spec[i];
      const t = (this.age[i] ?? 0) / (this.life[i] ?? 1);
      const grow = spec?.sizeOverLife ? evaluate(spec.sizeOverLife, t) : 1;
      const stretch = spec?.lengthOverLife ? evaluate(spec.lengthOverLife, t) : grow;
      const alphaScale = spec?.alphaOverLife ? evaluate(spec.alphaOverLife, t) : 1;
      const k = i * 3;
      const p = this.worldPosition(i);
      // (to Three's frame: (x, z, y))
      center[k] = p.x;
      center[k + 1] = p.z;
      center[k + 2] = p.y;
      const length = this.length[i] ?? 0;
      const width = (this.width[i] ?? 0) * grow;
      size[i * 2] = width;
      size[i * 2 + 1] = length > 0 ? length * stretch : width;
      if (length > 0) {
        const f = this.frame[i];
        const [vx, vy, vz] = [this.vel[k] ?? 0, this.vel[k + 1] ?? 0, this.vel[k + 2] ?? 0];
        const v = f
          ? {
              x: f.forward.x * vx + f.right.x * vy + f.up.x * vz,
              y: f.forward.y * vx + f.right.y * vy + f.up.y * vz,
              z: f.forward.z * vx + f.right.z * vy + f.up.z * vz,
            }
          : { x: vx, y: vy, z: vz };
        axis[k] = v.x;
        axis[k + 1] = v.z;
        axis[k + 2] = v.y;
      } else {
        axis[k] = axis[k + 1] = axis[k + 2] = 0;
      }
      const colour: readonly [number, number, number] = spec
        ? particleColor(spec, [this.color[k] ?? 1, this.color[k + 1] ?? 1, this.color[k + 2] ?? 1], t)
        : [1, 1, 1];
      tint[i * 4] = colour[0];
      tint[i * 4 + 1] = colour[1];
      tint[i * 4 + 2] = colour[2];
      tint[i * 4 + 3] = (this.alpha[i] ?? 1) * alphaScale;
      falloff[i] = spec?.falloff ?? 0;
      soft[i] = spec?.softDepth ?? 0;
    }
    for (const a of [this.#center, this.#size, this.#axis, this.#tint, this.#falloff, this.#soft]) {
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.#geometry.instanceCount = n;
  }
}

/** The scene's particles: emitters spawn into it, it moves and draws them. */
/** Particle Detail (settings/video.ts): Performance, the emitters' second LOD everywhere (a system setting, the game's
 *  too) */
export const particleDetail = { performance: false };

export class Particles {
  readonly root = new Group();
  /** Where the camera is (game frame; last drawn): an emitter's LOD by its distance */
  eye: Vec3 | null = null;
  readonly #additive = new Pool(true);
  readonly #translucent = new Pool(false);
  readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.root.add(this.#translucent.mesh, this.#additive.mesh);
  }

  /** Live particles (for tests) */
  get count(): number {
    return this.#additive.count + this.#translucent.count;
  }

  /** Every live particle: its emitter's spec, position in the world (game frame) and start width (for tests) */
  list(): { readonly spec: EmitterSpec | undefined; readonly pos: Vec3; readonly width: number }[] {
    const out: { spec: EmitterSpec | undefined; pos: Vec3; width: number }[] = [];
    for (const pool of [this.#additive, this.#translucent]) {
      for (let i = 0; i < pool.count; i++) out.push({ spec: pool.spec[i], pos: pool.worldPosition(i), width: pool.width[i] ?? 0 });
    }
    return out;
  }

  /** `seconds`: the world's time (slowed after a goal) */
  update(seconds: number): void {
    const dt = Math.max(0, seconds);
    this.#additive.update(dt);
    this.#translucent.update(dt);
  }

  pool(spec: EmitterSpec): Pool {
    return spec.blend === "additive" ? this.#additive : this.#translucent;
  }

  /** Every particle an emitter spawned, gone now */
  kill(owner: object): void {
    this.#additive.kill(owner);
    this.#translucent.kill(owner);
  }
}

/** The emitter's frame: its axes (forward, right, up) in the world, for its local velocities and offsets */
export interface EmitterFrame {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}
const WORLD: EmitterFrame = { forward: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } };

/** One emitter at work: spawning by rate, bursts and distance moved, from where it is told to be each frame. */
export class Emitter {
  /** Spawning (a continuous emitter's switch; a one-shot runs its course once started) */
  active = false;
  #time = 0;
  #rateDebt = 0;
  /** The per-distance spawning's leftover, uu */
  #unitDebt = 0;
  #last: Vec3 | null = null;
  #burstsDone = 0;
  #sourceVelocity: Vec3 | null = null;
  /** The spec this frame spawns from (its LOD's) */
  #spec: EmitterSpec;
  /** A local-space emitter's frame, which its particles follow */
  readonly #frame: FrameRef | null;
  readonly #color: readonly number[];

  /** `color`: the emitter's colour parameter (linear HDR; else the spec's) */
  constructor(
    readonly particles: Particles,
    readonly spec: EmitterSpec,
    color?: readonly [number, number, number],
  ) {
    this.#color = color ?? spec.color;
    this.#frame = spec.local ? { origin: { x: 0, y: 0, z: 0 }, ...WORLD } : null;
    this.#spec = spec;
  }

  /** Starts it over (a one-shot) */
  start(): void {
    this.active = true;
    this.#time = 0;
    this.#rateDebt = 0;
    this.#burstsDone = 0;
    this.#last = null;
  }

  /** Its particles gone at once (KillParticlesForced: the car demolished) */
  kill(): void {
    this.active = false;
    this.particles.kill(this);
  }

  /** Whether a one-shot has spawned all it will */
  get done(): boolean {
    const { spec } = this;
    return !spec.loops && this.#time > (spec.delay ?? 0) + spec.duration && this.#burstsDone >= (spec.bursts?.length ?? 0);
  }

  /** A frame: `seconds` of world time; `at` where it is now (game frame), `frame` its axes; `velocity` its own (for
   *  the spec's inheritVelocity) */
  update(seconds: number, at: Vec3, frame: EmitterFrame = WORLD, velocity: Vec3 | null = null): void {
    this.#sourceVelocity = velocity;
    const spec = this.#lod(at);
    this.#spec = spec;
    if (this.#frame) {
      // (its particles move with it, spawning or not)
      this.#frame.origin = at;
      this.#frame.forward = frame.forward;
      this.#frame.right = frame.right;
      this.#frame.up = frame.up;
    }
    const last = this.#last;
    this.#last = at;
    if (!this.active) {
      this.#unitDebt = 0;
      return;
    }
    const before = this.#time;
    this.#time += Math.max(0, seconds);
    const delay = spec.delay ?? 0;
    let local = this.#time - delay;
    if (spec.loops && spec.duration > 0) local %= spec.duration;
    const spawning = spec.loops === true || (local >= 0 && local <= spec.duration);
    let count = 0;
    // Bursts at their times (once a cycle)
    const bursts = spec.bursts ?? [];
    while (this.#burstsDone < bursts.length && (bursts[this.#burstsDone]?.time ?? 0) + delay <= this.#time) {
      count += bursts[this.#burstsDone]?.count ?? 0;
      this.#burstsDone++;
    }
    // (the rate over the part of this frame inside the spawning window)
    if (spec.rate && this.#time > delay) {
      const span = Math.min(this.#time, delay + (spec.loops ? Infinity : spec.duration)) - Math.max(before, delay);
      this.#rateDebt += Math.max(0, span) * spec.rate;
      const n = Math.floor(this.#rateDebt + 1e-9);
      this.#rateDebt -= n;
      count += n;
    }
    if (spawning && spec.perUnit && last) {
      const moved = Math.hypot(at.x - last.x, at.y - last.y, at.z - last.z);
      // (a move over the frame's limit is a teleport: not filled, the leftover dropped; no move: none, the leftover kept)
      if (moved > (spec.perUnit.maxFrame ?? Infinity)) this.#unitDebt = 0;
      else if (moved > 0) {
        const { unit } = spec.perUnit;
        const along = moved + this.#unitDebt;
        const n = Math.floor((along * pick(spec.perUnit.count, this.particles.random)) / unit);
        this.#unitDebt = Math.max(0, along - n * unit);
        // (spread along the way it moved this frame)
        for (let k = 0; k < n; k++) {
          const f = (k + 1) / n;
          this.#spawnOne({ x: last.x + (at.x - last.x) * f, y: last.y + (at.y - last.y) * f, z: last.z + (at.z - last.z) * f }, frame, local);
        }
      }
    }
    for (let k = 0; k < count; k++) this.#spawnOne(at, frame, local);
    if (this.done) this.active = false;
  }

  /** The spec it spawns from here: its second LOD at Particle Detail Performance or beyond its distance */
  #lod(at: Vec3): EmitterSpec {
    const { lod } = this.spec;
    if (!lod) return this.spec;
    const eye = this.particles.eye;
    const far = eye !== null && Math.hypot(at.x - eye.x, at.y - eye.y, at.z - eye.z) > lod.beyond;
    return particleDetail.performance || far ? lod.spec : this.spec;
  }

  #spawnOne(at: Vec3, frame: EmitterFrame, emitterTime: number): void {
    const { particles } = this;
    const spec = this.#spec;
    const random = particles.random;
    // A local-space particle keeps its own coordinates in the emitter's frame; a world one is turned into the world
    const local = this.#frame !== null;
    const axes = (v: readonly number[]): Vec3 =>
      spec.local && !local
        ? {
            x: frame.forward.x * (v[0] ?? 0) + frame.right.x * (v[1] ?? 0) + frame.up.x * (v[2] ?? 0),
            y: frame.forward.y * (v[0] ?? 0) + frame.right.y * (v[1] ?? 0) + frame.up.y * (v[2] ?? 0),
            z: frame.forward.z * (v[0] ?? 0) + frame.right.z * (v[1] ?? 0) + frame.up.z * (v[2] ?? 0),
          }
        : { x: v[0] ?? 0, y: v[1] ?? 0, z: v[2] ?? 0 };
    const between = (r: VecRange): number[] => [0, 1, 2].map((c) => (r.min[c] ?? 0) + ((r.max[c] ?? 0) - (r.min[c] ?? 0)) * random());
    const offset = spec.offset ? axes(spec.offset) : { x: 0, y: 0, z: 0 };
    const origin = local ? { x: 0, y: 0, z: 0 } : at;
    let p = { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z };
    let v = spec.velocity ? axes(between(spec.velocity)) : { x: 0, y: 0, z: 0 };
    const source = this.#sourceVelocity;
    if (spec.inheritVelocity && source) {
      const k = spec.inheritVelocity;
      v = { x: v.x + source.x * k, y: v.y + source.y * k, z: v.z + source.z * k };
    }
    if (spec.sphere) {
      const radius = typeof spec.sphere.radius === "number" ? spec.sphere.radius : evaluate(spec.sphere.radius, Math.max(0, emitterTime));
      const d = spherePoint(random, radius, spec.sphere.surface ?? false);
      p = { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
      if (spec.sphere.velocityScale !== undefined) {
        const k = pick(spec.sphere.velocityScale, random);
        v = { x: v.x + d.x * k, y: v.y + d.y * k, z: v.z + d.z * k };
      }
    }
    let a = { x: 0, y: 0, z: 0 };
    for (const range of spec.acceleration ?? []) {
      const [ax, ay, az] = between(range);
      a = { x: a.x + (ax ?? 0), y: a.y + (ay ?? 0), z: a.z + (az ?? 0) };
    }
    const width = pick(spec.size, random);
    const length = spec.length === undefined ? 0 : pick(spec.length, random);
    particles.pool(spec).spawn(spec, p, v, a, pick(spec.lifetime, random), width, length, pick(spec.alpha ?? 1, random), this.#color, this.#frame, this);
  }
}
