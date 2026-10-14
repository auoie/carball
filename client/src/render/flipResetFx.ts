// The flip reset's effect (notes/hud-menus.md HUD-19; FXActor_FlipReset_TA, FX_FlipReset.FlipReset_P, decoded by the
// static session's FR1): our own, built to its description. It's attached to the car in the car's frame (all of it,
// sparks in flight too, moves and turns with the car), 12 uu below its origin along its up axis, flat parallel to its
// floor. One colour, linear (0.574, 0.594, 0.996) x 3, unlit, no fade (each part just ends): a glow disc (additive,
// (1 - r)^4 to 75 uu), a ring (additive, a thin line at 37 uu with a sharp edge at 38 and a soft glow in to 30, peak
// 0.34), a shallow dome (blended, 145 uu across and 16 deep, bulging toward the roof, opaque at its rim fading in:
// (1 - V)^5), all three from 10 % of their size to full, linearly, over 0.15-0.2 s; and 25 sparks at 0.05 s from a
// 20 uu ring, out at 240 uu/s and down 50-100, velocity-aligned streaks shrinking from 2-3 x 20-30 to 0.4-0.6 x 2-3,
// gone 0.15-0.2 s later. A new reset starts it over. Only for the player's own car, by the Flip Reset Indicator setting.
import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
} from "three";

export const FLIP_RESET_FX = {
  /** The colour, linear, and its HDR multiplier */
  color: [0.574, 0.594, 0.996] as const,
  intensity: 3,
  /** Below the car's origin along its up axis (uu) */
  below: 12,
  /** The parts' full sizes (uu): the glow disc's radius, the ring's outer edge, its line, its glow's inner end */
  glowRadius: 75,
  ringOuter: 38,
  ringLine: 37,
  ringGlowInner: 30,
  ringPeak: 0.34,
  /** The dome: its rim's radius, its rim and top under the car's origin */
  domeRadius: 72.6,
  domeRimBelow: 26.6,
  domeTopBelow: 10.3,
  /** The growth: from this fraction of the size, over a time in this range (s) */
  startSize: 0.1,
  grow: [0.15, 0.2] as const,
  /** The sparks */
  sparks: 25,
  sparkAt: 0.05,
  sparkRing: 20,
  sparkRingJitter: 5,
  sparkOut: 240,
  sparkDown: [50, 100] as const,
  sparkLife: [0.15, 0.2] as const,
  sparkStart: { width: [2, 3], length: [20, 30] } as const,
  sparkEnd: { width: [0.4, 0.6], length: [2, 3] } as const,
} as const;

/** A part's size (fraction of its full size) `t` s after the reset, growing over `grow` s; null once it's gone */
export function partSize(t: number, grow: number): number | null {
  if (t < 0 || t >= grow) return null;
  return FLIP_RESET_FX.startSize + (1 - FLIP_RESET_FX.startSize) * (t / grow);
}

/** The ring's brightness (of its peak) at `r` uu from the centre at full size */
export function ringProfile(r: number): number {
  const { ringOuter, ringLine, ringGlowInner } = FLIP_RESET_FX;
  if (r > ringOuter || r < ringGlowInner) return 0;
  const lineInner = ringLine - 0.75;
  if (r >= lineInner) return 1;
  const s = (r - ringGlowInner) / (lineInner - ringGlowInner);
  return 0.5 * s * s;
}

/** The dome's opacity at V (0 at its rim, 1 at its middle) */
export function domeOpacity(v: number): number {
  return (1 - Math.min(1, Math.max(0, v))) ** 5;
}

const COLOR = FLIP_RESET_FX.color.map((c) => (c * FLIP_RESET_FX.intensity).toFixed(4)).join(", ");

const FLAT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** The glow: (1 - r)^4, r from the centre to the disc's edge */
const GLOW_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float r = min(1.0, length(vUv - 0.5) * 2.0);
    float k = pow(1.0 - r, 4.0);
    gl_FragColor = vec4(vec3(${COLOR}) * k, 1.0);
  }`;

/** The ring: its line, a sharp outer edge, a soft glow inward (ringProfile), at its peak's brightness */
const RING_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0 * ${FLIP_RESET_FX.ringOuter.toFixed(1)};
    float lineInner = ${(FLIP_RESET_FX.ringLine - 0.75).toFixed(2)};
    float glowInner = ${FLIP_RESET_FX.ringGlowInner.toFixed(1)};
    float s = clamp((r - glowInner) / (lineInner - glowInner), 0.0, 1.0);
    float k = r > ${FLIP_RESET_FX.ringOuter.toFixed(1)} || r < glowInner ? 0.0 : (r >= lineInner ? 1.0 : 0.5 * s * s);
    gl_FragColor = vec4(vec3(${COLOR}) * k * ${FLIP_RESET_FX.ringPeak.toFixed(2)}, 1.0);
  }`;

/** The dome: (1 - V)^5 opaque, V 0 at its rim */
const DOME_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(vec3(${COLOR}), pow(1.0 - clamp(vUv.y, 0.0, 1.0), 5.0));
  }`;

/** The sparks: each instance's start, velocity, sizes and life; a quad along its velocity, turned to the camera */
const SPARK_VERTEX = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aVelocity;
  attribute vec4 aSize;
  attribute float aLife;
  uniform float uAge;
  varying vec2 vQuad;
  void main() {
    float t = uAge / aLife;
    vQuad = position.xy;
    if (uAge < 0.0 || t >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 size = mix(aSize.xy, aSize.zw, t);
    vec4 centre = modelViewMatrix * vec4(aStart + aVelocity * uAge, 1.0);
    vec3 along = normalize((modelViewMatrix * vec4(aVelocity, 0.0)).xyz);
    vec3 across = normalize(cross(along, normalize(centre.xyz)));
    centre.xyz += along * position.x * size.y + across * position.y * size.x;
    gl_Position = projectionMatrix * centre;
  }`;

const SPARK_FRAGMENT = /* glsl */ `
  varying vec2 vQuad;
  void main() {
    float k = (1.0 - 4.0 * vQuad.y * vQuad.y) * (1.0 - 4.0 * vQuad.x * vQuad.x);
    gl_FragColor = vec4(vec3(${COLOR}) * max(k, 0.0), 1.0);
  }`;

function material(vertexShader: string, fragmentShader: string, blending: typeof AdditiveBlending | typeof NormalBlending): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uAge: { value: -1 } },
    transparent: true,
    depthWrite: false,
    blending,
    side: DoubleSide,
  });
  m.userData = { heightFog: "none" };
  return m;
}

const between = ([low, high]: readonly [number, number]): number => low + Math.random() * (high - low);

export class FlipResetFx {
  /** Attach it to the car's body (the car's frame: x forward, y up, z right) */
  readonly root = new Group();
  readonly #glow: Mesh;
  readonly #ring: Mesh;
  readonly #dome: Mesh;
  readonly #sparks: InstancedMesh;
  readonly #sparkAge: { value: number };
  #age = Infinity;
  #grow = { glow: 0.2, ring: 0.2, dome: 0.2 };
  #sparkEnd = 0;

  constructor() {
    const fx = FLIP_RESET_FX;
    this.root.position.set(0, -fx.below, 0);
    this.root.visible = false;
    // (the flat parts in the car's floor plane: the xz plane)
    this.#glow = new Mesh(new CircleGeometry(fx.glowRadius, 48).rotateX(-Math.PI / 2), material(FLAT_VERTEX, GLOW_FRAGMENT, AdditiveBlending));
    this.#ring = new Mesh(new CircleGeometry(fx.ringOuter, 64).rotateX(-Math.PI / 2), material(FLAT_VERTEX, RING_FRAGMENT, AdditiveBlending));
    // The dome: a spherical cap through its rim and top, V 0 at the rim, 1 at the top (three's sphere: uv.y 1 at the pole)
    const depth = fx.domeRimBelow - fx.domeTopBelow;
    const sphere = (fx.domeRadius ** 2 + depth ** 2) / (2 * depth);
    const cap = new SphereGeometry(sphere, 48, 8, 0, Math.PI * 2, 0, Math.asin(fx.domeRadius / sphere));
    cap.translate(0, fx.below - fx.domeTopBelow - sphere, 0);
    this.#dome = new Mesh(cap, material(FLAT_VERTEX, DOME_FRAGMENT, NormalBlending));
    // The sparks: a unit quad along x (length) and y (width) per instance
    const sparkMaterial = material(SPARK_VERTEX, SPARK_FRAGMENT, AdditiveBlending);
    this.#sparkAge = sparkMaterial.uniforms["uAge"] as { value: number };
    this.#sparks = new InstancedMesh(new PlaneGeometry(1, 1), sparkMaterial, fx.sparks);
    this.#sparks.frustumCulled = false;
    const identity = new Matrix4();
    for (let i = 0; i < fx.sparks; i++) this.#sparks.setMatrixAt(i, identity);
    const geometry = this.#sparks.geometry;
    geometry.setAttribute("aStart", new InstancedBufferAttribute(new Float32Array(fx.sparks * 3), 3));
    geometry.setAttribute("aVelocity", new InstancedBufferAttribute(new Float32Array(fx.sparks * 3), 3));
    geometry.setAttribute("aSize", new InstancedBufferAttribute(new Float32Array(fx.sparks * 4), 4));
    geometry.setAttribute("aLife", new InstancedBufferAttribute(new Float32Array(fx.sparks), 1));
    for (const part of [this.#glow, this.#ring, this.#dome, this.#sparks]) {
      part.renderOrder = 10;
      this.root.add(part);
    }
  }

  /** A flip reset: the effect starts over */
  trigger(): void {
    const fx = FLIP_RESET_FX;
    this.#age = 0;
    this.#grow = { glow: between(fx.grow), ring: between(fx.grow), dome: between(fx.grow) };
    const attr = (name: string): InstancedBufferAttribute => this.#sparks.geometry.getAttribute(name) as InstancedBufferAttribute;
    const start = attr("aStart");
    const velocity = attr("aVelocity");
    const size = attr("aSize");
    const life = attr("aLife");
    let longest = 0;
    for (let i = 0; i < fx.sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = fx.sparkRing + (Math.random() * 2 - 1) * fx.sparkRingJitter;
      const [x, z] = [Math.cos(a), Math.sin(a)];
      start.setXYZ(i, x * r, 0, z * r);
      velocity.setXYZ(i, x * fx.sparkOut, -between(fx.sparkDown), z * fx.sparkOut);
      size.setXYZW(i, between(fx.sparkStart.width), between(fx.sparkStart.length), between(fx.sparkEnd.width), between(fx.sparkEnd.length));
      const l = between(fx.sparkLife);
      life.setX(i, l);
      longest = Math.max(longest, l);
    }
    for (const a of [start, velocity, size, life]) a.needsUpdate = true;
    this.#sparkEnd = fx.sparkAt + longest;
  }

  /** Each frame: the frame's game time (s) */
  update(seconds: number): void {
    if (!Number.isFinite(this.#age)) return;
    this.#age += seconds;
    const t = this.#age;
    const fx = FLIP_RESET_FX;
    const place = (mesh: Mesh, grow: number): void => {
      const k = partSize(t, grow);
      mesh.visible = k !== null;
      if (k !== null) mesh.scale.setScalar(k);
    };
    place(this.#glow, this.#grow.glow);
    place(this.#ring, this.#grow.ring);
    place(this.#dome, this.#grow.dome);
    this.#sparkAge.value = t - fx.sparkAt;
    this.#sparks.visible = t < this.#sparkEnd;
    this.root.visible = t < Math.max(this.#sparkEnd, this.#grow.glow, this.#grow.ring, this.#grow.dome);
    if (!this.root.visible) this.#age = Infinity;
  }
}
