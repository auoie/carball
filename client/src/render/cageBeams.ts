// The cage's beams drawn (src/render/cage.ts) as the game's, on every map in its theme's team colours (the user's
// decision, 2026-10-16): each two crossed quads along its centre line, 8 uu wide, additive, coloured towards the team on
// that side and lit around the ball (notes/arena-visuals.md AV-14, H-8). Seen from far off a beam stays at least about a
// pixel wide, dimmer instead of thinner, so it doesn't break up or shimmer. Visible from both sides, as the game's.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DataUtils,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  LinearMipmapNearestFilter,
  RedFormat,
  RepeatWrapping,
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
import { ARENA_PRIORITY } from "./translucentSort";

/** The least half width on screen (pixels) */
const MIN_HALF_PIXELS = 0.75;

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
uniform sampler2D fire;
uniform sampler2D smoke;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vAcross;
varying float vFade;
#include <fog_pars_fragment>

float saturate1(float x) { return clamp(x, 0.0, 1.0); }
// The game's 1D gradients (Curve_Fire_01 R, Curve_Smoke_01 G), wrapped by the sampler: v continuous per pixel (the time
// term's frac taken on the CPU), so its mips are picked as the game's are and a far beam's stripes average out
float curve(sampler2D table, float v) { return texture2D(table, vec2(v, 0.5)).r; }

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
  // (blended by the normal: sat(64 (n.z - 0.5)), on |n.z| as the quads' signs aren't known: RV-70e)
  float up = saturate1(64.0 * (abs(normalize(vWorldNormal).y) - 0.5));
  float F = mix(curve(fire, z / 4.0 + fract(3.0 * time)), curve(fire, y / 4.0 + fract(3.0 * time)), up);
  float S = curve(smoke, 128.0 * (1.0 - d2) - time);
  float I = 24.0 * (prox2 * prox2 + 0.09375) * (w + 0.5) * opacity
    * ((1.0 - prox) * 0.25 * p + prox * p * (F * (S * (prox + 0.25) + 0.25) + 4.0 * ring * prox));
  I = clamp(I, 0.0, 5.0) * vFade;
  // (additive: linear HDR, through the post-processing's bloom and tone map: PP-17)
  gl_FragColor = vec4(I * colour, 1.0);
  #include <colorspace_fragment>
  // (fog only dims an additive beam, rgb x fog.w: no blend towards the fog's colour, RV-70d)
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      gl_FragColor.rgb *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
}
`;

/** Curve_Fire_01_Pack.R and Curve_Smoke_01_Pack.G (both sRGB: decoded, as the GPU reads them, RV-60) at 256 points
 *  (values measured from the game's 1-D gradients; 256 keeps the rings' sharp edge, RV-70f), drawn as small data textures */
export const FIRE_CURVE = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.0005, 0.0011, 0.0017, 0.0021, 0.0029, 0.0035,
  0.0044, 0.0056, 0.0068, 0.008, 0.0097, 0.0113, 0.0137, 0.0156, 0.0181, 0.0212, 0.0242, 0.0273, 0.0307, 0.0356,
  0.0396, 0.0452, 0.0505, 0.0561, 0.063, 0.0685, 0.0762, 0.0844, 0.0909, 0.0999, 0.1095, 0.117, 0.1275, 0.1384,
  0.1485, 0.162, 0.1715, 0.1845, 0.1981, 0.2122, 0.2251, 0.2384, 0.2542, 0.2705, 0.2832, 0.3006, 0.3186, 0.3348,
  0.3516, 0.3713, 0.389, 0.4073, 0.4233, 0.4452, 0.4649, 0.4822, 0.5029, 0.5241, 0.5457, 0.5647, 0.5808, 0.6005,
  0.624, 0.641, 0.6654, 0.6831, 0.7047, 0.7231, 0.7417, 0.7567, 0.7758, 0.7952, 0.8109, 0.8308, 0.8509, 0.8632,
  0.8796, 0.8963, 0.9089, 0.9216, 0.9344, 0.943, 0.956, 0.9647, 0.9734, 0.9823, 0.9867, 0.9911, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.9956, 0.9911, 0.9911, 0.9823, 0.9823, 0.9734, 0.9647,
  0.9603, 0.9516, 0.9387, 0.9301, 0.9216, 0.9047, 0.8921, 0.8796, 0.8591, 0.8428, 0.8228, 0.803, 0.7797, 0.753,
  0.7268, 0.6975, 0.6689, 0.6308, 0.6006, 0.5616, 0.518, 0.4736, 0.4288, 0.3763, 0.3233, 0.2687, 0.2106, 0.1578,
  0.1086, 0.0706, 0.044, 0.0264, 0.0157, 0.0092, 0.0056, 0.0034, 0.0018, 0.0005
];
const SMOKE_CURVE = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0.0003, 0.0003, 0.0003, 0.0003, 0.0006, 0.0006, 0.0006, 0.0009, 0.0009, 0.0009, 0.0009, 0.0012, 0.0012,
  0.0012, 0.0015, 0.0015, 0.0015, 0.0018, 0.0018, 0.0018, 0.0021, 0.0021, 0.0021, 0.0024, 0.0024, 0.0024, 0.0024,
  0.0027, 0.0027, 0.0027, 0.003, 0.003, 0.003, 0.0033, 0.0033, 0.0033, 0.0037, 0.0037, 0.004, 0.004, 0.004, 0.0044,
  0.0044, 0.0044, 0.0048, 0.0048, 0.0048, 0.0052, 0.0052, 0.0052, 0.0056, 0.0056, 0.006, 0.006, 0.006, 0.0065,
  0.0065, 0.007, 0.007, 0.007, 0.0075, 0.0075, 0.008, 0.008, 0.008, 0.0086, 0.0086, 0.0091, 0.0091, 0.0091, 0.0097,
  0.0097, 0.0103, 0.0103, 0.011, 0.011, 0.011, 0.0116, 0.0116, 0.0123, 0.0123, 0.013, 0.013, 0.0137, 0.0137, 0.0137,
  0.0144, 0.0144, 0.0152, 0.0152, 0.016, 0.016, 0.0168, 0.0168, 0.0176, 0.0176, 0.0185, 0.0185, 0.0194, 0.0194,
  0.0203, 0.0203, 0.0212, 0.0212, 0.0222, 0.0232, 0.0232, 0.0242, 0.0242, 0.0252, 0.0252, 0.0262, 0.0273, 0.0273,
  0.0284, 0.0284, 0.0296, 0.0307, 0.0307, 0.0319, 0.0331, 0.0331, 0.0343, 0.0356, 0.0356, 0.0369, 0.0382, 0.0395,
  0.0395, 0.0409, 0.0423, 0.0437, 0.0452, 0.0452, 0.0467, 0.0482, 0.0497, 0.0513, 0.0529, 0.0561, 0.0578, 0.0595,
  0.063, 0.0666, 0.0723, 0.0782, 0.0823, 0.0887, 0.0931, 0.0976, 0.1022, 0.1095, 0.1144, 0.1195, 0.1248, 0.1301,
  0.1384, 0.1441, 0.15, 0.1559, 0.162, 0.1683, 0.1746, 0.1845, 0.1912, 0.1981, 0.2051, 0.2122, 0.2195, 0.227, 0.2346,
  0.2462, 0.2542, 0.2623, 0.2705, 0.2789, 0.2874, 0.3005, 0.3095, 0.3185, 0.3278, 0.3372, 0.3467, 0.3613, 0.3712,
  0.3813, 0.3916, 0.4072, 0.4179, 0.4287, 0.4397, 0.4564, 0.4678, 0.4793, 0.4969, 0.5089, 0.5271, 0.5395, 0.552,
  0.5711, 0.5841, 0.6038, 0.624, 0.6376, 0.6584, 0.6795, 0.6939, 0.7157, 0.7379, 0.7605, 0.7835, 0.8148, 0.8388,
  0.8714, 0.9131, 0.956
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

/** `values` (a wrapping 1-D curve) at `n` texels, read as a linear filter reads it at each texel's centre */
export function resampleCurve(values: readonly number[], n: number): number[] {
  const m = values.length;
  return Array.from({ length: n }, (_, i) => {
    const u = ((i + 0.5) / n) * m - 0.5;
    const k = Math.floor(u);
    const f = u - k;
    return (values[((k % m) + m) % m] ?? 0) * (1 - f) + (values[(((k + 1) % m) + m) % m] ?? 0) * f;
  });
}

/** A 1-D curve's mips (its texels' box averages in linear space, halving to 1 texel: the game's) */
export function curveMips(values: readonly number[]): number[][] {
  const levels = [[...values]];
  for (let last = levels[0] ?? []; last.length > 1; ) {
    const next = Array.from({ length: Math.floor(last.length / 2) }, (_, i) => ((last[2 * i] ?? 0) + (last[2 * i + 1] ?? 0)) / 2);
    levels.push(next);
    last = next;
  }
  return levels;
}

/** Curve_Fire_01_Pack's width (1 x 512, 10 mips, BR1): ours resampled to it so its mips change where the game's do */
const FIRE_TEXELS = 512;

/** A 1-D curve as a texture (half floats: filterable everywhere WebGL2 is), wrapping, with its mips: linear in a mip, the
 *  nearest mip (the game's Effects group: point mip selection, anisotropy 4, BR1) */
function curveTexture(values: readonly number[]): DataTexture {
  const halves = (level: readonly number[]): Uint16Array => new Uint16Array(level.map((v) => DataUtils.toHalfFloat(v)));
  const levels = curveMips(values);
  const texture = new DataTexture(halves(values), values.length, 1, RedFormat, HalfFloatType);
  texture.mipmaps = levels.map((level) => ({ data: halves(level), width: level.length, height: 1 }));
  texture.generateMipmaps = false;
  texture.wrapS = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapNearestFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** The game frame (x, y, z up) to Three's (x, z up, y) */
const three = (v: readonly [number, number, number]): [number, number, number] => [v[0], v[2], v[1]];

export class CageBeams {
  readonly mesh: Mesh;
  /** The ball's centre (Three.js frame), read every frame */
  readonly ballPosition = new Vector3(0, -100_000, 0);
  readonly #uniforms: Record<string, { value: unknown }>;

  constructor(graph: CageGraph, style: Pick<WallStyle, "blue" | "orange">) {
    const positions: number[] = [];
    const sides: number[] = [];
    const acrosses: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    // The game's beams are two crossed quads (FFCage_Full, AV-14): one in the surface, one along its normal (additive:
    // it adds, and keeps a beam seen edge-on as wide: RV-62)
    for (const beam of graph.beams) for (const alongNormal of [false, true]) {
      const { points, normals: beamNormals } = beam;
      const n = points.length;
      points.forEach((point, k) => {
        const before = points[Math.max(0, k - 1)] ?? point;
        const after = points[Math.min(n - 1, k + 1)] ?? point;
        const tangent = new Vector3(...three(after)).sub(new Vector3(...three(before))).normalize();
        const normal = new Vector3(...three(beamNormals[k] ?? [0, 0, 1]));
        const inSurface = new Vector3().crossVectors(tangent, normal).normalize();
        const side = alongNormal ? normal.clone().normalize() : inSurface;
        // (each quad's own normal, as FFCage_Full's: the surface's for the quad in it, the in-surface side for the one
        // along the normal; the stripes' blend and the shockwave's push read it: RV-75)
        const own = alongNormal ? inSurface : normal;
        const centre = new Vector3(...three(point));
        const base = positions.length / 3;
        for (const across of [-1, 1]) {
          positions.push(centre.x, centre.y, centre.z);
          sides.push(side.x, side.y, side.z);
          acrosses.push(across);
          normals.push(own.x, own.y, own.z);
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
      fire: { value: curveTexture(resampleCurve(FIRE_CURVE, FIRE_TEXELS)) },
      smoke: { value: curveTexture(SMOKE_CURVE) },
    };
    const material = new ShaderMaterial({
      vertexShader: gameVertexShader,
      fragmentShader: gameFragmentShader,
      uniforms: this.#uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: true,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    // (the cage's lines right after its fill: the game's one primitive, FFCage_Full at 0 (TRN1), as our two)
    this.mesh.renderOrder = ARENA_PRIORITY.base + 0.001;
    this.mesh.onBeforeRender = (renderer: WebGLRenderer) => {
      renderer.getDrawingBufferSize(viewport);
    };
  }

  /** The goal explosion's shockwave (AV-15: -0.25 at rest, then to 1 over 2.5 s after the explosion) and the time
   *  (seconds) the beams animate by */
  set shockWave(value: number) {
    if (this.#uniforms["shockWave"]) this.#uniforms["shockWave"].value = value;
  }

  set time(seconds: number) {
    // (its whole seconds dropped: every use is periodic in a second, and the texture coordinates stay small: BR1's cb0[59])
    if (this.#uniforms["time"]) this.#uniforms["time"].value = seconds - Math.floor(seconds);
  }
}
