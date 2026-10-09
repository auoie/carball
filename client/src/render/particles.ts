// Particles, after the game's Cascade emitters as the static session described them (notes/visual-timing.md; its
// rl-fx/1 summaries: spawn rate, bursts and spawning per distance; lifetime; start size, colour and alpha and their
// curves over life; start velocity, the velocity a spawn sphere gives, acceleration). The values are the game's; the
// look is our own (a soft procedural sprite). Positions in the game's frame (x, y, z up); HDR colours, tone-mapped in
// the shader (1 - e^-c) as there is no bloom. One instanced quad per particle, two draw calls (additive, translucent).
import {
  AdditiveBlending,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from "three";
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
  /** Spawning by distance: `count` per `unit` uu the emitter moves, at most `maxFrame` uu counted a frame */
  readonly perUnit?: { readonly unit: number; readonly count: number; readonly maxFrame?: number };
  readonly lifetime: Range;
  /** Start size (uu): width, and the length for a sprite stretched along its velocity */
  readonly size: Range;
  readonly length?: Range;
  readonly sizeOverLife?: Curve;
  /** The length's own curve (a stretched sprite's size over life per axis; else sizeOverLife) */
  readonly lengthOverLife?: Curve;
  /** Start velocity (uu/s), in the emitter's frame (`local`) or the world's */
  readonly velocity?: VecRange;
  readonly local?: boolean;
  /** A spawn sphere: radius (or a curve over emitter time), only on its surface; its offset times `velocityScale` as a
   *  start velocity */
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
  readonly alpha?: Range;
  readonly alphaOverLife?: Curve;
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

const vertexShader = /* glsl */ `
attribute vec3 center;
attribute vec2 size; // width, length (stretched along axis when axis is set)
attribute vec3 axis;
attribute vec4 tint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vUv = uv;
  vTint = tint;
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
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec4 vTint;
uniform bool additive;
void main() {
  // A soft round sprite (translucent ones softer and thinner: the game's smoke textures cover about half their quad);
  // the HDR colour tone-mapped (there's no bloom)
  float r = length(vUv - 0.5) * 2.0;
  float shape = clamp(1.0 - r, 0.0, 1.0);
  shape = additive ? shape * shape : shape * shape * shape * 0.5;
  vec3 colour = 1.0 - exp(-max(vTint.rgb, 0.0));
  float alpha = clamp(vTint.a * shape, 0.0, 1.0);
  gl_FragColor = additive ? vec4(colour * alpha, 1.0) : vec4(colour, alpha);
  #include <colorspace_fragment>
}
`;

/** One draw call's particles (additive or translucent) */
class Pool {
  readonly mesh: Mesh;
  readonly #center: InstancedBufferAttribute;
  readonly #size: InstancedBufferAttribute;
  readonly #axis: InstancedBufferAttribute;
  readonly #tint: InstancedBufferAttribute;
  readonly #geometry: InstancedBufferGeometry;
  // Per particle (structure of arrays)
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
    for (const [name, a] of [
      ["center", this.#center],
      ["size", this.#size],
      ["axis", this.#axis],
      ["tint", this.#tint],
    ] as const) {
      a.setUsage(35048); // (DynamicDrawUsage)
      g.setAttribute(name, a);
    }
    g.instanceCount = 0;
    this.#geometry = g;
    this.mesh = new Mesh(
      g,
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { additive: { value: additive } },
        transparent: true,
        depthWrite: false,
        blending: additive ? AdditiveBlending : NormalBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  spawn(spec: EmitterSpec, p: Vec3, v: Vec3, a: Vec3, life: number, width: number, length: number, alpha: number, color: readonly number[]): void {
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
  }

  update(dt: number): void {
    let n = this.count;
    for (let i = 0; i < n; ) {
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

  #move(from: number, to: number): void {
    if (from === to) return;
    for (const a of [this.pos, this.vel, this.acc, this.startVel, this.color]) a.copyWithin(to * 3, from * 3, from * 3 + 3);
    for (const a of [this.age, this.life, this.width, this.length, this.alpha]) a[to] = a[from] ?? 0;
    this.spec[to] = this.spec[from];
  }

  #write(): void {
    const n = this.count;
    const center = this.#center.array as Float32Array;
    const size = this.#size.array as Float32Array;
    const axis = this.#axis.array as Float32Array;
    const tint = this.#tint.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const spec = this.spec[i];
      const t = (this.age[i] ?? 0) / (this.life[i] ?? 1);
      const grow = spec?.sizeOverLife ? evaluate(spec.sizeOverLife, t) : 1;
      const stretch = spec?.lengthOverLife ? evaluate(spec.lengthOverLife, t) : grow;
      const over = spec?.colorOverLife;
      const colourScale = over === undefined ? ([1, 1, 1] as const) : typeof over === "number" ? ([over, over, over] as const) : channels(over, t);
      const alphaScale = spec?.alphaOverLife ? evaluate(spec.alphaOverLife, t) : 1;
      const k = i * 3;
      // (to Three's frame: (x, z, y))
      center[k] = this.pos[k] ?? 0;
      center[k + 1] = this.pos[k + 2] ?? 0;
      center[k + 2] = this.pos[k + 1] ?? 0;
      const length = this.length[i] ?? 0;
      const width = (this.width[i] ?? 0) * grow;
      size[i * 2] = width;
      size[i * 2 + 1] = length > 0 ? length * stretch : width;
      if (length > 0) {
        axis[k] = this.vel[k] ?? 0;
        axis[k + 1] = this.vel[k + 2] ?? 0;
        axis[k + 2] = this.vel[k + 1] ?? 0;
      } else {
        axis[k] = axis[k + 1] = axis[k + 2] = 0;
      }
      tint[i * 4] = (this.color[k] ?? 1) * colourScale[0];
      tint[i * 4 + 1] = (this.color[k + 1] ?? 1) * colourScale[1];
      tint[i * 4 + 2] = (this.color[k + 2] ?? 1) * colourScale[2];
      tint[i * 4 + 3] = (this.alpha[i] ?? 1) * alphaScale;
    }
    for (const a of [this.#center, this.#size, this.#axis, this.#tint]) {
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.#geometry.instanceCount = n;
  }
}

/** The scene's particles: emitters spawn into it, it moves and draws them. */
export class Particles {
  readonly root = new Group();
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

  /** `seconds`: the world's time (slowed after a goal) */
  update(seconds: number): void {
    const dt = Math.max(0, seconds);
    this.#additive.update(dt);
    this.#translucent.update(dt);
  }

  pool(spec: EmitterSpec): Pool {
    return spec.blend === "additive" ? this.#additive : this.#translucent;
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
  #unitDebt = 0;
  #last: Vec3 | null = null;
  #burstsDone = 0;
  #sourceVelocity: Vec3 | null = null;
  readonly #color: readonly number[];

  /** `color`: the emitter's colour parameter (linear HDR; else the spec's) */
  constructor(
    readonly particles: Particles,
    readonly spec: EmitterSpec,
    color?: readonly [number, number, number],
  ) {
    this.#color = color ?? spec.color;
  }

  /** Starts it over (a one-shot) */
  start(): void {
    this.active = true;
    this.#time = 0;
    this.#rateDebt = 0;
    this.#burstsDone = 0;
    this.#last = null;
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
    const { spec } = this;
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
      this.#unitDebt += (Math.min(moved, spec.perUnit.maxFrame ?? Infinity) / spec.perUnit.unit) * spec.perUnit.count;
      const n = Math.floor(this.#unitDebt);
      this.#unitDebt -= n;
      // (spread along the way it moved this frame)
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / n;
        this.#spawnOne({ x: last.x + (at.x - last.x) * f, y: last.y + (at.y - last.y) * f, z: last.z + (at.z - last.z) * f }, frame, local);
      }
    }
    for (let k = 0; k < count; k++) this.#spawnOne(at, frame, local);
    if (this.done) this.active = false;
  }

  #spawnOne(at: Vec3, frame: EmitterFrame, emitterTime: number): void {
    const { spec, particles } = this;
    const random = particles.random;
    const toWorld = (v: readonly number[]): Vec3 =>
      spec.local
        ? {
            x: frame.forward.x * (v[0] ?? 0) + frame.right.x * (v[1] ?? 0) + frame.up.x * (v[2] ?? 0),
            y: frame.forward.y * (v[0] ?? 0) + frame.right.y * (v[1] ?? 0) + frame.up.y * (v[2] ?? 0),
            z: frame.forward.z * (v[0] ?? 0) + frame.right.z * (v[1] ?? 0) + frame.up.z * (v[2] ?? 0),
          }
        : { x: v[0] ?? 0, y: v[1] ?? 0, z: v[2] ?? 0 };
    const between = (r: VecRange): number[] => [0, 1, 2].map((c) => (r.min[c] ?? 0) + ((r.max[c] ?? 0) - (r.min[c] ?? 0)) * random());
    const offset = spec.offset ? toWorld(spec.offset) : { x: 0, y: 0, z: 0 };
    let p = { x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z };
    let v = spec.velocity ? toWorld(between(spec.velocity)) : { x: 0, y: 0, z: 0 };
    const source = this.#sourceVelocity;
    if (spec.inheritVelocity && source) {
      const k = spec.inheritVelocity;
      v = { x: v.x + source.x * k, y: v.y + source.y * k, z: v.z + source.z * k };
    }
    if (spec.sphere) {
      // A random direction, on the sphere's surface or inside it
      const u = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const radius = typeof spec.sphere.radius === "number" ? spec.sphere.radius : evaluate(spec.sphere.radius, Math.max(0, emitterTime));
      const r = radius * (spec.sphere.surface ? 1 : Math.cbrt(random()));
      const d = { x: s * Math.cos(theta) * r, y: s * Math.sin(theta) * r, z: u * r };
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
    particles.pool(spec).spawn(spec, p, v, a, pick(spec.lifetime, random), width, length, pick(spec.alpha ?? 1, random), this.#color);
  }
}
