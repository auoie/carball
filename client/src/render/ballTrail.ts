// The ball's speed trail (notes/visual-timing.md VT-10, VT-10a, VT-15, VT-17: the static session's BR1, 2026-10-17; our
// own drawing of its rules): one camera-facing ribbon 64 uu wide from the ball's centre through points dropped 15 a game
// second (more in slow motion), each living a game second, each keeping the colour and opacity it was dropped with: the
// team colour of the last touch at full brightness (white before any), the opacity easing to 1 above 2000 uu/s and to 0
// below. A white-hot head, dimming and fading down its life; a bright 16 uu core with a faint halo; its last quarter
// fading; clear near the camera. Gone at once at the goal's explosion, started again (unseen) at a reset. At World Detail
// High four side ribbons too (emitters 3-6, SIDE_TRAIL: the static session's answer to RV-536): 8 uu wide, from points
// 72 uu off the ball's centre along its own y and z, 15 a game second at every dilation, each living half a second, the
// same material, colour, opacity and curves over their life.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, NormalBlending, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";

/** The trail's measures (VT-10a): its width (uu), points a game second (times the spawn rate), a point's life (game
 *  s), the speed it shows above (uu/s), its opacity's easing rate (/s), the depth it's clear within (uu), the slow
 *  motion's spawn rate's cap, the spline's pieces a segment at most */
export const TRAIL = { width: 64, perSecond: 15, life: 1, showAbove: 2000, ease: 3, nearClear: 800, spawnCap: 3, pieces: 25 } as const;

/** A ribbon's own measures: its width (uu), a point's life (game s), its spawn rate's cap in slow motion */
export interface RibbonMeasures {
  readonly width: number;
  readonly life: number;
  readonly spawnCap: number;
}

/** The main ribbon's (emitter 0) */
export const MAIN_TRAIL: RibbonMeasures = { width: TRAIL.width, life: TRAIL.life, spawnCap: TRAIL.spawnCap };

/** The side ribbons' (emitters 3-6, World Detail High alone): 8 uu wide, half a second, their spawn rate's input
 *  clamped to 0-1 (15 a game second whatever the dilation); each from its offset (the game's frame, the ball's own
 *  axes: StartLocation, emitters 3, 4, 5, 6) */
export const SIDE_TRAIL: RibbonMeasures & { readonly offsets: readonly (readonly [number, number, number])[] } = {
  width: 8,
  life: 0.5,
  spawnCap: 1,
  offsets: [
    [0, 72, 0],
    [0, -72, 0],
    [0, 0, 72],
    [0, 0, -72],
  ],
};

/** A piecewise-linear curve through (t, value) keys, flat past its ends */
function curve(keys: readonly (readonly [number, number])[]): (t: number) => number {
  return (t) => {
    const first = keys[0];
    if (!first || t <= first[0]) return first?.[1] ?? 0;
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i] ?? [1, 0];
      const [t0, v0] = keys[i - 1] ?? [0, 0];
      if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
    }
    return keys[keys.length - 1]?.[1] ?? 0;
  };
}

/** A point's alpha over its life (AlphaScaleOverLife, VT-10a) */
export const alphaOverLife = curve([
  [0, 0],
  [0.05, 1],
  [0.21, 0.94],
  [0.31, 0.82],
  [0.42, 0.67],
  [0.52, 0.51],
  [0.63, 0.34],
  [0.73, 0.19],
  [0.84, 0.075],
  [1, 0],
]);

/** How white a point is over its life (Param1: the white-hot head) */
export const whiteOverLife = curve([
  [0.0625, 1],
  [0.133, 0.5],
  [0.2035, 0],
]);

/** A point's colour's scale over its life (ColorScaleOverLife, each channel) */
const COLOUR_KEYS: readonly (readonly [number, readonly [number, number, number]])[] = [
  [0.03, [1, 1, 1]],
  [0.18, [0.92, 0.67, 0.91]],
  [0.34, [0.74, 0.54, 0.72]],
  [0.5, [0.58, 0.52, 0.55]],
  [0.6, [0.54, 0.52, 0.51]],
];
const colourChannels = [0, 1, 2].map((c) => curve(COLOUR_KEYS.map(([t, v]) => [t, v[c] ?? 1] as const)));
export function colourOverLife(t: number): [number, number, number] {
  return [colourChannels[0]?.(t) ?? 1, colourChannels[1]?.(t) ?? 1, colourChannels[2]?.(t) ?? 1];
}

/** A dropped point: where (Three's frame), when (game s), its colour and opacity as dropped */
export interface TrailPoint {
  readonly at: Vector3;
  readonly born: number;
  readonly colour: readonly [number, number, number];
  readonly alpha: number;
}

/** The trail's points over time (no drawing: the tests') */
export class TrailPoints {
  readonly points: TrailPoint[] = [];
  readonly measures: RibbonMeasures;
  /** TrailOpacity: what a new point takes */
  opacity = 0;
  /** The colour a new point takes (linear) */
  colour: readonly [number, number, number] = [1, 1, 1];
  #time = 0;
  #due = 0;

  constructor(measures: RibbonMeasures = MAIN_TRAIL) {
    this.measures = measures;
  }

  /** Game time since the trail began (s) */
  get time(): number {
    return this.#time;
  }

  /** A frame: `seconds` of game time with the ball at `at` moving at `speed` (uu/s); `dilation` the game's time
   *  dilation (1, or the goal's slow motion) */
  step(seconds: number, at: Vector3, speed: number, dilation = 1): void {
    if (!(seconds > 0)) return;
    this.#time += seconds;
    this.opacity += ((speed > TRAIL.showAbove ? 1 : 0) - this.opacity) * Math.min(1, TRAIL.ease * seconds);
    // (dropped at the ball's centre now, the rate's due count carried over frames)
    const rate = TRAIL.perSecond * Math.min(this.measures.spawnCap, Math.max(1, 1 / Math.max(dilation, 1e-3)));
    this.#due += seconds * rate;
    for (; this.#due >= 1; this.#due -= 1) this.points.push({ at: at.clone(), born: this.#time, colour: this.colour, alpha: this.opacity });
    while (this.points.length > 0 && this.#time - (this.points[0]?.born ?? 0) > this.measures.life) this.points.shift();
  }

  /** Gone at once (the goal's explosion), or started again at a reset (its opacity 0 again) */
  clear(): void {
    this.points.length = 0;
    this.opacity = 0;
    this.#due = 0;
  }
}

/** The most vertices a ribbon's strip needs: two for each spline piece of each segment, the head's too */
const maxVertices = (m: RibbonMeasures): number => 2 * ((Math.ceil(TRAIL.perSecond * m.spawnCap * m.life) + 2) * TRAIL.pieces + 1);

const vertexShader = (width: number): string => /* glsl */ `
  attribute vec3 tangent;
  attribute vec3 trail; // (across: -1 or 1; u along the ribbon, 0 at the ball; unused)
  attribute vec4 tint; // (rgb, alpha before the profile)
  varying vec2 vTrail;
  varying vec4 vTint;
  varying float vDepth;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 side = normalize(cross(tangent, cameraPosition - world.xyz));
    world.xyz += side * trail.x * ${(width / 2).toFixed(1)};
    vTrail = trail.xy;
    vTint = tint;
    vec4 mvPosition = viewMatrix * world;
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAGMENT = /* glsl */ `
  varying vec2 vTrail;
  varying vec4 vTint;
  varying float vDepth;
  #include <fog_pars_fragment>
  void main() {
    float d = abs(vTrail.x);
    float profile = (1.0 - d) * (0.125 + max(0.0, 1.0 - 4.0 * d));
    float tail = clamp(4.0 * (1.0 - vTrail.y), 0.0, 1.0);
    float near = clamp(vDepth / ${TRAIL.nearClear.toFixed(1)}, 0.0, 1.0);
    gl_FragColor = vec4(vTint.rgb, clamp(vTint.a * profile * tail * near, 0.0, 1.0));
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/** The trail drawn: a strip through its head (the ball's centre, or its offset point) and its points, newest first,
 *  rebuilt each frame */
export class BallTrail {
  readonly mesh: Mesh;
  readonly state: TrailPoints;
  readonly #geometry = new BufferGeometry();
  readonly #maxVertices: number;
  readonly #position: BufferAttribute;
  readonly #tangent: BufferAttribute;
  readonly #trail: BufferAttribute;
  readonly #tint: BufferAttribute;

  constructor(measures: RibbonMeasures = MAIN_TRAIL) {
    this.state = new TrailPoints(measures);
    const count = (this.#maxVertices = maxVertices(measures));
    this.#position = new BufferAttribute(new Float32Array(count * 3), 3);
    this.#tangent = new BufferAttribute(new Float32Array(count * 3), 3);
    this.#trail = new BufferAttribute(new Float32Array(count * 3), 3);
    this.#tint = new BufferAttribute(new Float32Array(count * 4), 4);
    for (const a of [this.#position, this.#tangent, this.#trail, this.#tint]) a.setUsage(DynamicDrawUsage);
    this.#geometry.setAttribute("position", this.#position);
    this.#geometry.setAttribute("tangent", this.#tangent);
    this.#geometry.setAttribute("trail", this.#trail);
    this.#geometry.setAttribute("tint", this.#tint);
    const index: number[] = [];
    for (let k = 0; k + 1 < count / 2; k++) index.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
    this.#geometry.setIndex(index);
    this.#geometry.setDrawRange(0, 0);
    const material = new ShaderMaterial({
      vertexShader: vertexShader(measures.width),
      fragmentShader: FRAGMENT,
      uniforms: UniformsUtils.clone(UniformsLib.fog),
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: true,
    });
    this.mesh = new Mesh(this.#geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = "ball trail";
  }

  /** The colour new points take: the last touch's team colour at full brightness (linear), white before any */
  set colour(colour: readonly [number, number, number]) {
    this.state.colour = colour;
  }

  /** A frame (game seconds), the ribbon's head (Three's frame: the ball's centre, or its offset point there), the ball's
   *  speed, the time dilation; the strip rebuilt */
  update(seconds: number, head: Vector3, speed: number, dilation = 1): void {
    this.state.step(seconds, head, speed, dilation);
    this.#rebuild(head);
  }

  /** Gone at once (the goal's explosion), or begun again at a reset */
  clear(): void {
    this.state.clear();
    this.#geometry.setDrawRange(0, 0);
  }

  #rebuild(ball: Vector3): void {
    const { points, time } = this.state;
    // (the ribbon's stations: the ball's centre (age 0, as the newest point's colour and opacity), then the points newest
    // first)
    const newest = points[points.length - 1];
    const stations: TrailPoint[] = [{ at: ball, born: time, colour: newest?.colour ?? this.state.colour, alpha: newest?.alpha ?? 0 }];
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      if (p) stations.push(p);
    }
    if (stations.length < 2) {
      this.#geometry.setDrawRange(0, 0);
      return;
    }
    // (Catmull-Rom through the stations, each segment in pieces by its length)
    const samples: { at: Vector3; tangent: Vector3; age: number; colour: readonly [number, number, number]; alpha: number }[] = [];
    const at = (i: number): Vector3 => stations[Math.min(Math.max(i, 0), stations.length - 1)]?.at ?? ball;
    const p = new Vector3();
    const tangent = new Vector3();
    for (let i = 0; i + 1 < stations.length; i++) {
      const a = stations[i];
      const b = stations[i + 1];
      if (!a || !b) continue;
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const pieces = Math.min(TRAIL.pieces, Math.max(1, Math.ceil(p1.distanceTo(p2) / 24)));
      for (let k = 0; k < pieces || (i + 2 === stations.length && k === pieces); k++) {
        const s = k / pieces;
        const [s2, s3] = [s * s, s * s * s];
        p.set(0, 0, 0)
          .addScaledVector(p0, -0.5 * s3 + s2 - 0.5 * s)
          .addScaledVector(p1, 1.5 * s3 - 2.5 * s2 + 1)
          .addScaledVector(p2, -1.5 * s3 + 2 * s2 + 0.5 * s)
          .addScaledVector(p3, 0.5 * s3 - 0.5 * s2);
        tangent
          .set(0, 0, 0)
          .addScaledVector(p0, -1.5 * s2 + 2 * s - 0.5)
          .addScaledVector(p1, 4.5 * s2 - 5 * s)
          .addScaledVector(p2, -4.5 * s2 + 4 * s + 0.5)
          .addScaledVector(p3, 1.5 * s2 - s);
        if (tangent.lengthSq() < 1e-6) tangent.subVectors(p2, p1);
        if (tangent.lengthSq() < 1e-6) tangent.set(0, 0, 1);
        const mix = (x: number, y: number): number => x + (y - x) * s;
        samples.push({
          at: p.clone(),
          tangent: tangent.clone().normalize(),
          age: time - mix(a.born, b.born),
          colour: [mix(a.colour[0], b.colour[0]), mix(a.colour[1], b.colour[1]), mix(a.colour[2], b.colour[2])],
          alpha: mix(a.alpha, b.alpha),
        });
      }
    }
    const count = Math.min(samples.length, this.#maxVertices / 2);
    let length = 0;
    const along: number[] = [0];
    for (let k = 1; k < count; k++) along.push((length += (samples[k]?.at ?? p).distanceTo(samples[k - 1]?.at ?? p)));
    for (let k = 0; k < count; k++) {
      const sample = samples[k];
      if (!sample) continue;
      const t = Math.min(1, Math.max(0, sample.age / this.state.measures.life));
      const scale = colourOverLife(t);
      const white = whiteOverLife(t);
      const rgb = [0, 1, 2].map((c) => (sample.colour[c] ?? 1) * (scale[c] ?? 1) * (1 - white) + white);
      const alpha = sample.alpha * alphaOverLife(t);
      const u = length > 0 ? (along[k] ?? 0) / length : 0;
      for (const [j, across] of [
        [0, -1],
        [1, 1],
      ] as const) {
        const v = 2 * k + j;
        this.#position.setXYZ(v, sample.at.x, sample.at.y, sample.at.z);
        this.#tangent.setXYZ(v, sample.tangent.x, sample.tangent.y, sample.tangent.z);
        this.#trail.setXYZ(v, across, u, 0);
        this.#tint.setXYZW(v, rgb[0] ?? 1, rgb[1] ?? 1, rgb[2] ?? 1, alpha);
      }
    }
    for (const a of [this.#position, this.#tangent, this.#trail, this.#tint]) a.needsUpdate = true;
    this.#geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
  }
}
