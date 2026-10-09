// The cage's beams drawn (src/render/cage.ts): each a ribbon on the surface along its centre line, an 8 uu core (the
// game's beams' width) in a glow,
// tinted towards each team's colour at its end of the field (colours and strengths from the theme, as the walls'),
// lighting up around the ball, fainter on the ceiling. Seen from far off a beam stays at least about a pixel wide,
// dimmer instead of thinner, so it doesn't break up or shimmer. Visible from both sides, as the game's.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { CageGraph } from "./cage";
import type { WallStyle } from "./themes/theme";
import { fullBright, linear } from "./teamColors";

/** The ribbon's half width (uu): the beam's core (the game's beams are 8 uu wide) and its glow round it */
const HALF_WIDTH = 10;
const CORE_HALF_WIDTH = 4;
/** The glow's strength next to the core, and the beams' against the walls' lines (themes' `lines`) */
const GLOW = 0.45;
const STRENGTH = 1.3;
/** The least half width on screen (pixels) */
const MIN_HALF_PIXELS = 0.75;

const vertexShader = /* glsl */ `
attribute vec3 side;
attribute float across;
attribute vec3 beamNormal;
uniform float halfWidth;
uniform float minHalfPixels;
uniform vec2 viewport;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vAcross;
varying float vFade;
#include <fog_pars_vertex>

void main() {
  // How many pixels the beam's half width is here: widened to the least, and dimmed by as much
  mat4 toClip = projectionMatrix * viewMatrix * modelMatrix;
  vec4 centre = toClip * vec4(position, 1.0);
  vec4 edge = toClip * vec4(position + side * halfWidth, 1.0);
  float widen = 1.0;
  if (centre.w > 0.0 && edge.w > 0.0) {
    float pixels = length((edge.xy / edge.w - centre.xy / centre.w) * 0.5 * viewport);
    widen = max(1.0, minHalfPixels / max(pixels, 1e-4));
  }
  vec4 world = modelMatrix * vec4(position + side * (halfWidth * widen * across), 1.0);
  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * beamNormal);
  vAcross = across;
  vFade = 1.0 / widen;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 ballPosition;
uniform float ballRadius;
uniform vec3 neutralColor;
uniform vec3 blueColor;
uniform vec3 orangeColor;
uniform float lineStrength;
uniform float ceilingLineStrength;
uniform float halfWidth;
uniform float coreHalfWidth;
uniform float glow;
uniform float strength;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vAcross;
varying float vFade;
#include <fog_pars_fragment>

void main() {
  // The core, anti-aliased, in its glow (uu from the centre line)
  float d = abs(vAcross) * halfWidth;
  float aa = max(fwidth(d), 1e-3);
  float core = 1.0 - smoothstep(coreHalfWidth - aa, coreHalfWidth + aa, d);
  float profile = max(core, glow * (1.0 - smoothstep(coreHalfWidth, halfWidth, d)));
  // Team tint towards each end (Three z = the game's y; blue defends -y)
  float end = vWorldPosition.z;
  vec3 team = end < 0.0 ? blueColor : orangeColor;
  vec3 tint = mix(neutralColor, team, smoothstep(1000.0, 4800.0, abs(end)));
  float near = 1.0 - smoothstep(ballRadius, ballRadius + 1100.0, length(ballPosition - vWorldPosition));
  float ceiling = smoothstep(0.5, 0.9, -normalize(vWorldNormal).y);
  float alpha = profile * vFade * (strength * mix(lineStrength, ceilingLineStrength, ceiling) + 0.75 * near);
  gl_FragColor = vec4(mix(tint, vec3(1.0), 0.2 + 0.6 * near), clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The game's beams (notes/arena-visuals.md AV-14, H-8, H-8b): additive, 8 uu wide with the profile
 *  p = 1 - (2u - 1)^2; coloured by the height on the wall w (1 at its foot, 0 on the ceiling) towards
 *  (2 FB(P) + P) / 6 of the team on that side; bright as their formula has it round the ball (radii 4096 and 8192 uu),
 *  with scan stripes and rings contracting towards it, and the goal explosion's shockwave ring rippling them. */
const gameVertexShader = /* glsl */ `
attribute vec3 side;
attribute float across;
attribute vec3 beamNormal;
uniform float halfWidth;
uniform float minHalfPixels;
uniform vec2 viewport;
uniform vec3 ballPosition;
uniform float shockWave;
uniform float time;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vAcross;
varying float vFade;
#include <fog_pars_vertex>

float saturate1(float x) { return clamp(x, 0.0, 1.0); }

void main() {
  mat4 toClip = projectionMatrix * viewMatrix * modelMatrix;
  vec4 centre = toClip * vec4(position, 1.0);
  vec4 edge = toClip * vec4(position + side * halfWidth, 1.0);
  float widen = 1.0;
  if (centre.w > 0.0 && edge.w > 0.0) {
    float pixels = length((edge.xy / edge.w - centre.xy / centre.w) * 0.5 * viewport);
    widen = max(1.0, minHalfPixels / max(pixels, 1e-4));
  }
  vec3 p = position + side * (halfWidth * widen * across);
  // The shockwave ripples the beams (H-8b): out along the normal and swaying, where its ring is
  vec3 toBall = p - ballPosition;
  float d2 = dot(toBall, toBall) / (16384.0 * 16384.0);
  float prox = max(0.0, 1.0 - 4.0 * d2);
  float ring = 1.0 - abs(1.0 - 2.0 * max(0.0, 8.0 * (saturate1(1.0 - d2 + shockWave) - 0.875)));
  // ((128, 0, 128) in the game's frame: its x and z, Three's x and y)
  p += ring * prox * (32.0 * normalize(beamNormal) + sin(6.2831853 * (32.0 * (1.0 - d2) + time)) * vec3(128.0, 128.0, 0.0));
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * beamNormal);
  vAcross = across;
  vFade = 1.0 / widen;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const gameFragmentShader = /* glsl */ `
uniform vec3 ballPosition;
uniform vec3 primary0;
uniform vec3 primary1;
uniform vec3 bright0;
uniform vec3 bright1;
uniform float opacity;
uniform float shockWave;
uniform float time;
uniform float fire[32];
uniform float smoke[32];
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vAcross;
varying float vFade;
#include <fog_pars_fragment>

float saturate1(float x) { return clamp(x, 0.0, 1.0); }
// The game's 1D gradient textures (Curve_Fire_01 R, Curve_Smoke_01 G), sampled at 32 points, wrapping
float curve32(float table[32], float v) {
  float x = fract(v) * 32.0 - 0.5;
  int i = int(floor(x));
  float f = x - float(i);
  int a = i < 0 ? 31 : i;
  int b = i + 1 > 31 ? 0 : i + 1;
  return mix(table[a], table[b], f);
}

void main() {
  // (Three's frame: y up, z the game's y)
  float z = vWorldPosition.y;
  float y = vWorldPosition.z;
  float w = saturate1((2068.6 - z) / 1816.0);
  float t = saturate1(y / 256.0 + 0.5);
  vec3 primary = mix(primary0, primary1, t);
  vec3 bright = mix(bright0, bright1, t);
  vec3 colour = vec3(0.0625) + w * ((2.0 * bright + primary) / 6.0 - vec3(0.0625));
  float p = 1.0 - vAcross * vAcross;
  vec3 toBall = vWorldPosition - ballPosition;
  float d2 = dot(toBall, toBall) / (16384.0 * 16384.0);
  float prox = max(0.0, 1.0 - 4.0 * d2);
  float prox2 = max(0.0, 0.75 - 12.0 * d2);
  float ring = 1.0 - abs(1.0 - 2.0 * max(0.0, 8.0 * (saturate1(1.0 - d2 + shockWave) - 0.875)));
  // Scan stripes up the walls (along y on surfaces facing up or down), rings contracting towards the ball
  bool facesUp = abs(normalize(vWorldNormal).y) > 0.52;
  float F = curve32(fire, (facesUp ? y : z) / 4.0 + fract(3.0 * time));
  float S = curve32(smoke, 128.0 * (1.0 - d2) - time);
  float I = 24.0 * (prox2 * prox2 + 0.09375) * (w + 0.5) * opacity
    * ((1.0 - prox) * 0.25 * p + prox * p * (F * (S * (prox + 0.25) + 0.25) + 4.0 * ring * prox));
  I = clamp(I, 0.0, 5.0) * vFade;
  // (additive: HDR, tone-mapped here as there's no bloom)
  gl_FragColor = vec4(1.0 - exp(-I * colour), 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Curve_Fire_01_Pack.R and Curve_Smoke_01_Pack.G at 32 points (values measured from the game's textures) */
const FIRE_CURVE = [
  0, 0, 0, 0, 0, 0, 0, 0.012, 0.082, 0.176, 0.286, 0.404, 0.522, 0.639, 0.749, 0.843, 0.918, 0.973, 1, 1, 1, 1, 1, 1, 1, 1, 0.996,
  0.973, 0.922, 0.804, 0.51, 0.075,
];
const SMOKE_CURVE = [
  0, 0, 0, 0, 0, 0.008, 0.016, 0.027, 0.035, 0.047, 0.059, 0.071, 0.082, 0.094, 0.106, 0.122, 0.137, 0.153, 0.169, 0.188, 0.208, 0.235,
  0.267, 0.337, 0.408, 0.475, 0.541, 0.608, 0.678, 0.753, 0.831, 0.925,
];

/** The goal explosion's ShockWave (AV-15) `sinceExplosion` world seconds after it (null: no explosion): -0.25 at rest,
 *  then lerp(-0.25, 1, min(1, t / 2.5)) */
export function shockWave(sinceExplosion: number | null): number {
  return sinceExplosion === null ? -0.25 : -0.25 + 1.25 * Math.min(1, Math.max(0, sinceExplosion) / 2.5);
}

/** The shockwave's ring (H-8b) at d2 = |P - ball|^2 / 16384^2: 1 - |1 - 2 max(0, 8 (sat(1 - d2 + SW) - 0.875))|, a
 *  ring over d2 in (SW, SW + 0.125) (as the beams' shaders have it) */
export function shockRing(d2: number, wave: number): number {
  const x = Math.min(1, Math.max(0, 1 - d2 + wave));
  return 1 - Math.abs(1 - 2 * Math.max(0, 8 * (x - 0.875)));
}

/** The game frame (x, y, z up) to Three's (x, z up, y) */
const three = (v: readonly [number, number, number]): [number, number, number] => [v[0], v[2], v[1]];

export class CageBeams {
  readonly mesh: Mesh;
  /** The ball's centre (Three.js frame), read every frame */
  readonly ballPosition = new Vector3(0, -100_000, 0);
  readonly #uniforms: Record<string, { value: unknown }>;

  constructor(graph: CageGraph, ballRadius: number, style: WallStyle) {
    const positions: number[] = [];
    const sides: number[] = [];
    const acrosses: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const beam of graph.beams) {
      const { points, normals: beamNormals } = beam;
      const n = points.length;
      points.forEach((point, k) => {
        const before = points[Math.max(0, k - 1)] ?? point;
        const after = points[Math.min(n - 1, k + 1)] ?? point;
        const tangent = new Vector3(...three(after)).sub(new Vector3(...three(before))).normalize();
        const normal = new Vector3(...three(beamNormals[k] ?? [0, 0, 1]));
        const side = new Vector3().crossVectors(tangent, normal).normalize();
        // (the ends reach a core's half width on, so beams meeting at a point overlap there instead of leaving a notch)
        const reach = style.game ? 0 : k === 0 ? -CORE_HALF_WIDTH : k === n - 1 ? CORE_HALF_WIDTH : 0;
        const centre = new Vector3(...three(point)).addScaledVector(tangent, reach);
        const base = positions.length / 3;
        for (const across of [-1, 1]) {
          positions.push(centre.x, centre.y, centre.z);
          sides.push(side.x, side.y, side.z);
          acrosses.push(across);
          normals.push(normal.x, normal.y, normal.z);
        }
        if (k > 0) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
      });
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("side", new BufferAttribute(new Float32Array(sides), 3));
    geometry.setAttribute("across", new BufferAttribute(new Float32Array(acrosses), 1));
    geometry.setAttribute("beamNormal", new BufferAttribute(new Float32Array(normals), 3));
    geometry.setIndex(indices);
    const viewport = new Vector2(1280, 720);
    if (style.game) {
      // The game's: additive, 8 uu wide, its colour and brightness formula (with the teams' primaries)
      const p0 = [style.blue.r, style.blue.g, style.blue.b] as const;
      const p1 = [style.orange.r, style.orange.g, style.orange.b] as const;
      this.#uniforms = {
        ...UniformsUtils.clone(UniformsLib.fog),
        ballPosition: { value: this.ballPosition },
        halfWidth: { value: 4 },
        minHalfPixels: { value: MIN_HALF_PIXELS },
        viewport: { value: viewport },
        primary0: { value: style.blue },
        primary1: { value: style.orange },
        bright0: { value: linear(fullBright(p0)) },
        bright1: { value: linear(fullBright(p1)) },
        opacity: { value: 1 },
        shockWave: { value: -0.25 },
        time: { value: 0 },
        fire: { value: FIRE_CURVE },
        smoke: { value: SMOKE_CURVE },
      };
      const gameMaterial = new ShaderMaterial({
        vertexShader: gameVertexShader,
        fragmentShader: gameFragmentShader,
        uniforms: this.#uniforms,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        fog: true,
      });
      this.mesh = new Mesh(geometry, gameMaterial);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 2;
      this.mesh.onBeforeRender = (renderer: WebGLRenderer) => {
        renderer.getDrawingBufferSize(viewport);
      };
      return;
    }
    this.#uniforms = {};
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ballPosition: { value: this.ballPosition },
        ballRadius: { value: ballRadius },
        halfWidth: { value: HALF_WIDTH },
        coreHalfWidth: { value: CORE_HALF_WIDTH },
        glow: { value: GLOW },
        strength: { value: STRENGTH },
        minHalfPixels: { value: MIN_HALF_PIXELS },
        viewport: { value: viewport },
        neutralColor: { value: style.neutral },
        blueColor: { value: style.blue },
        orangeColor: { value: style.orange },
        lineStrength: { value: style.lines },
        ceilingLineStrength: { value: style.ceilingLines },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false; // (it surrounds the field: always in view)
    this.mesh.renderOrder = 2; // (over the walls' see-through fill)
    this.mesh.onBeforeRender = (renderer: WebGLRenderer) => {
      renderer.getDrawingBufferSize(viewport);
    };
  }

  /** The goal explosion's shockwave (AV-15: -0.25 at rest, then to 1 over 2.5 s after the explosion) and the time
   *  (seconds) the game's beams animate by; nothing for our own look */
  set shockWave(value: number) {
    if (this.#uniforms["shockWave"]) this.#uniforms["shockWave"].value = value;
  }

  set time(seconds: number) {
    if (this.#uniforms["time"]) this.#uniforms["time"].value = seconds;
  }
}
