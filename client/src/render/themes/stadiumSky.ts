// DFH Stadium's sky (SkyDome_MAT, notes/arena-visuals.md H-10 and its detail; SUR-25): the gradient G (the zenith, the
// warm horizon as q^4, pulled toward the horizon's colour on the sun's side, all times v), the brown clouds where the
// panning smoke noise's sum falls under v, and the stars. The game's three noise textures can't ship: ours are made
// here from their statistics (each channel's quantiles, the smoke's red against its green and blue, the feature sizes,
// the speckles' neighbour correlation), stored as the game's are (8-bit sRGB, mipmapped) and sampled by the game's
// formula. Values and formulas only.
import { withHeightFog } from "../heightFog";
import { BackSide, BufferGeometry, DataTexture, DoubleSide, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, Mesh, RepeatWrapping, RGBAFormat, SRGBColorSpace, ShaderMaterial, SphereGeometry, UnsignedByteType, Vector3 } from "three";
import { PRIORITY } from "../translucentSort";
import { lowQualityPath } from "../shaderQuality";

/** H-10's colours (linear): the zenith, the horizon's q^4 term, the sun side's pull target, the clouds' base */
export const SKY_COLOURS = {
  zenith: [0.0169880502, 0.0429870114, 0.0545922816],
  horizonAdd: [1.47885239, 1.10558987, 0.475965947],
  horizon: [1.49584043, 1.14857686, 0.530558228],
  cloud: [0.0472758897, 0.0372363701, 0.0182859525],
} as const;

/** The dome: SkySphere01, a 65536 uu hemisphere scaled (128, 128, 76.8) (RV-69, AV-20) */
export const DOME = { across: 8388608, up: 5033165 } as const;

/** The pans (cb0[58..60]): the first smoke layer's, the second's, the stars' (per second, wrapped) */
export const SKY_PANS = { smoke1: [1 / 64, 0.00625], smoke2: [0.0075, 0.00625], stars: [0.0009, 0.000781] } as const;

/** Each noise channel's quantiles at QUANTILE_P, as the textures' 8-bit sRGB levels (statistics of Noise_Smoke_03's
 *  RGB, Noise_Generic_01's RG and Noise_Fire_02's R, measured locally; decoded to linear where used) */
export const QUANTILE_P = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99, 99.9, 100] as const;
export const NOISE_QUANTILES = {
  smokeR: [25, 60, 71, 76, 82, 90, 95, 99, 107, 112, 117, 126, 132, 140, 150, 159, 167, 175, 186, 197, 206, 206, 214, 214],
  smokeG: [12, 40, 45, 49, 53, 55, 58, 61, 65, 67, 69, 73, 77, 79, 82, 86, 91, 97, 105, 117, 130, 146, 174, 206],
  smokeB: [8, 38, 43, 49, 52, 55, 58, 60, 65, 66, 68, 74, 74, 79, 82, 87, 90, 98, 106, 117, 131, 142, 165, 181],
  speckleR: [0, 10, 24, 36, 47, 57, 66, 74, 83, 90, 98, 106, 114, 123, 132, 142, 151, 165, 181, 204, 219, 233, 250, 255],
  speckleG: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 8, 14, 23, 35, 50, 70, 94, 133, 169, 203, 242, 255],
  fireR: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 8, 20, 37, 55, 76, 98, 123, 151, 184, 207, 227, 252, 255],
} as const;

/** The noises' structure (our own, to NOISE_MEASURES after the quantiles: RV-156, RV-186): the smoke's lattices (red's own
 *  part 8 cells a tile, green and blue 16; 4 octaves; blue given green's correlation smokeGBCorr; red = 1.1 (green + blue) +
 *  its own), the speckles' neighbour kernels
 *  [a, 1, a], the fire's lattice (110 cells) */
export const NOISE_SHAPE = { size: 512, smokeOwn: 8, smokeGB: 16, octaves: 4, smokeMix: 1.1, smokeGBCorr: -0.02, speckleR: 0.29, speckleG: 0.4, fire: 110 } as const;

/** The textures' own measures our noises are made to (after their quantiles: RV-156): the smoke's red against its
 *  green and blue, the speckles' and the fire's neighbour correlation */
export const NOISE_MEASURES = { smokeRG: 0.49, smokeRB: 0.51, smokeGB: -0.02, speckleRLag1: 0.45, speckleGLag1: 0.42, fireLag1: 0.87 } as const;

/** mulberry32: a seeded generator */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A field normalised to mean 0, standard deviation 1 */
function standardise(f: Float64Array): Float64Array {
  let mean = 0;
  for (const v of f) mean += v;
  mean /= f.length;
  let sq = 0;
  for (const v of f) sq += (v - mean) ** 2;
  const sd = Math.sqrt(sq / f.length) || 1;
  return f.map((v) => (v - mean) / sd);
}

/** Tileable value noise (a seeded lattice of `cells` a side, smoothstep between) over an n x n tile, standardised;
 *  `octaves` of it summed, halving */
function valueNoise(n: number, cells: number, octaves: number, seed: number): Float64Array {
  const out = new Float64Array(n * n);
  let amp = 1;
  const ix = new Int32Array(n);
  const sx = new Float64Array(n);
  for (let o = 0; o < octaves; o++) {
    const c = cells * 2 ** o;
    const next = generator(seed + 101 * o);
    const lattice = new Float64Array(c * c);
    for (let k = 0; k < lattice.length; k++) lattice[k] = next();
    // (each column's lattice cell and smoothstep weight, once)
    for (let x = 0; x < n; x++) {
      const f = ((x + 0.5) / n) * c;
      const i = Math.floor(f);
      const t = f - i;
      ix[x] = i;
      sx[x] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < n; y++) {
      const f = ((y + 0.5) / n) * c;
      const iy = Math.floor(f);
      const ty = f - iy;
      const sy = ty * ty * (3 - 2 * ty);
      const row0 = (iy % c) * c;
      const row1 = ((iy + 1) % c) * c;
      for (let x = 0; x < n; x++) {
        const i0 = (ix[x] ?? 0) % c;
        const i1 = ((ix[x] ?? 0) + 1) % c;
        const w = sx[x] ?? 0;
        const a0 = lattice[row0 + i0] ?? 0;
        const top = a0 + ((lattice[row0 + i1] ?? 0) - a0) * w;
        const b0 = lattice[row1 + i0] ?? 0;
        const bottom = b0 + ((lattice[row1 + i1] ?? 0) - b0) * w;
        out[y * n + x] = (out[y * n + x] ?? 0) + amp * (top + (bottom - top) * sy);
      }
    }
    amp *= 0.5;
  }
  return standardise(out);
}

/** Gaussian speckle: white noise per texel through the separable kernel [a, 1, a] (wrapped), standardised */
function speckle(n: number, a: number, seed: number): Float64Array {
  const next = generator(seed);
  const z = new Float64Array(n * n);
  for (let i = 0; i < z.length; i += 2) {
    // (Box-Muller)
    const r = Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12)));
    const t = 2 * Math.PI * next();
    z[i] = r * Math.cos(t);
    z[i + 1] = r * Math.sin(t);
  }
  const across = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      across[k] = (z[k] ?? 0) + a * ((z[y * n + ((x + n - 1) % n)] ?? 0) + (z[y * n + ((x + 1) % n)] ?? 0));
    }
  }
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const up = ((y + n - 1) % n) * n;
    const down = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) out[y * n + x] = (across[y * n + x] ?? 0) + a * ((across[up + x] ?? 0) + (across[down + x] ?? 0));
  }
  return standardise(out);
}

/** A field's values as their ranks, 0 to 1 (uniform whatever the field's own distribution): from a 65536-bin
 *  histogram's cumulative counts, each bin's values at its middle rank */
function ranks(f: Float64Array): Float64Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const bins = 65536;
  const scale = hi > lo ? (bins - 1) / (hi - lo) : 0;
  const bin = new Uint32Array(f.length);
  const counts = new Float64Array(bins);
  for (let k = 0; k < f.length; k++) {
    const i = Math.round(((f[k] ?? 0) - lo) * scale);
    bin[k] = i;
    counts[i] = (counts[i] ?? 0) + 1;
  }
  // (each bin's middle rank, 0 to 1)
  const middle = new Float64Array(bins);
  let below = 0;
  for (let i = 0; i < bins; i++) {
    const c = counts[i] ?? 0;
    middle[i] = (below + (c - 1) / 2) / (f.length - 1);
    below += c;
  }
  const out = new Float64Array(f.length);
  for (let k = 0; k < f.length; k++) out[k] = middle[bin[k] ?? 0] ?? 0;
  return out;
}

/** A channel's bytes by rank: its quantiles (decoded, interpolated linear) encoded back as 8-bit sRGB, at 65536 ranks */
function byteTable(levels: readonly number[]): Uint8Array {
  const table = levels.map(fromSrgbByte);
  const out = new Uint8Array(65536);
  for (let i = 0; i < out.length; i++) out[i] = toSrgbByte(quantile(table, i / (out.length - 1)));
  return out;
}

/** A uniform value through a channel's quantiles (`table`: its levels decoded, interpolated linear) */
function quantile(table: readonly number[], u: number): number {
  const p = u * 100;
  for (let k = 1; k < QUANTILE_P.length; k++) {
    const [p0 = 0, p1 = 100] = [QUANTILE_P[k - 1], QUANTILE_P[k]];
    if (p <= p1 || k === QUANTILE_P.length - 1) {
      const [v0 = 0, v1 = 0] = [table[k - 1], table[k]];
      return v0 + ((v1 - v0) * Math.min(Math.max(p - p0, 0), p1 - p0)) / (p1 - p0);
    }
  }
  return table.at(-1) ?? 0;
}

function toSrgbByte(v: number): number {
  const c = Math.min(Math.max(v, 0), 1);
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
}
/** An 8-bit sRGB level, decoded */
export function fromSrgbByte(b: number): number {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Our three noise textures (RGBA bytes, sRGB-encoded as the game's: smoke rgb; speckle r, g; fire r) */
export interface SkyNoise {
  readonly size: number;
  readonly smoke: Uint8Array;
  readonly speckle: Uint8Array;
  readonly fire: Uint8Array;
}

let made: SkyNoise | null = null;

/** The noises (deterministic: made once, the same textures every time) */
export function skyNoise(): SkyNoise {
  made ??= makeSkyNoise();
  return made;
}

/** `b` given `a`'s correlation `target` (both standardised): b + k a, k solved for it (a small shift of b's own pattern),
 *  standardised again */
function correlated(a: Float64Array, b: Float64Array, target: number): Float64Array {
  let c = 0;
  for (let i = 0; i < a.length; i++) c += (a[i] ?? 0) * (b[i] ?? 0);
  c /= a.length;
  // (corr(a, b + k a) = (c + k) / sqrt(1 + 2 k c + k²): bisection for k)
  const at = (k: number): number => (c + k) / Math.sqrt(1 + 2 * k * c + k * k);
  let [lo, hi] = [-1, 1];
  for (let step = 0; step < 60; step++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < target) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const out = Float64Array.from(b, (v, i) => v + k * (a[i] ?? 0));
  const scale = 1 / Math.sqrt(1 + 2 * k * c + k * k);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * scale;
  return out;
}

/** The noises' lattices' seeds */
export const NOISE_SEEDS = { own: 11, g: 22, b: 33 };

/** The noises made afresh (skyNoise keeps the first) */
export function makeSkyNoise(seeds: { own: number; g: number; b: number } = NOISE_SEEDS, mix: number = NOISE_SHAPE.smokeMix): SkyNoise {
  const { size: n, smokeOwn, smokeGB, octaves } = NOISE_SHAPE;
  const own = valueNoise(n, smokeOwn, octaves, seeds.own);
  const g = valueNoise(n, smokeGB, octaves, seeds.g);
  const b = correlated(g, valueNoise(n, smokeGB, octaves, seeds.b), NOISE_SHAPE.smokeGBCorr);
  const sr = speckle(n, NOISE_SHAPE.speckleR, 44);
  const sg = speckle(n, NOISE_SHAPE.speckleG, 55);
  const fire = valueNoise(n, NOISE_SHAPE.fire, 1, 66);
  const smoke = new Uint8Array(n * n * 4);
  const speck = new Uint8Array(n * n * 4);
  const fireBytes = new Uint8Array(n * n * 4);
  // (each field to its ranks, then through its channel's quantiles to bytes: the textures' distributions)
  const t = {
    smokeR: byteTable(NOISE_QUANTILES.smokeR),
    smokeG: byteTable(NOISE_QUANTILES.smokeG),
    smokeB: byteTable(NOISE_QUANTILES.smokeB),
    speckleR: byteTable(NOISE_QUANTILES.speckleR),
    speckleG: byteTable(NOISE_QUANTILES.speckleG),
    fireR: byteTable(NOISE_QUANTILES.fireR),
  };
  const red = new Float64Array(n * n);
  for (let k = 0; k < red.length; k++) red[k] = mix * ((g[k] ?? 0) + (b[k] ?? 0)) + (own[k] ?? 0);
  const [ur, ug, ub] = [ranks(red), ranks(g), ranks(b)];
  const [usr, usg, uf] = [ranks(sr), ranks(sg), ranks(fire)];
  const at = (u: Float64Array, k: number): number => Math.round((u[k] ?? 0) * 65535);
  for (let k = 0; k < n * n; k++) {
    const o = 4 * k;
    smoke[o] = t.smokeR[at(ur, k)] ?? 0;
    smoke[o + 1] = t.smokeG[at(ug, k)] ?? 0;
    smoke[o + 2] = t.smokeB[at(ub, k)] ?? 0;
    smoke[o + 3] = 255;
    speck[o] = t.speckleR[at(usr, k)] ?? 0;
    speck[o + 1] = t.speckleG[at(usg, k)] ?? 0;
    speck[o + 3] = 255;
    fireBytes[o] = t.fireR[at(uf, k)] ?? 0;
    fireBytes[o + 3] = 255;
  }
  return { size: n, smoke, speckle: speck, fire: fireBytes };
}

/** A noise texture's channels at uv, bilinear and wrapped, decoded (the GPU's sampling of its finest level) */
export function sampleNoise(bytes: Uint8Array, size: number, u: number, v: number): [number, number, number] {
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const [x0, y0] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [x - x0, y - y0];
  const at = (i: number, j: number, c: number): number => fromSrgbByte(bytes[4 * ((((j % size) + size) % size) * size + (((i % size) + size) % size)) + c] ?? 0);
  const ch = (c: number): number => {
    const top = at(x0, y0, c) + (at(x0 + 1, y0, c) - at(x0, y0, c)) * fx;
    const bottom = at(x0, y0 + 1, c) + (at(x0 + 1, y0 + 1, c) - at(x0, y0 + 1, c)) * fx;
    return top + (bottom - top) * fy;
  };
  return [ch(0), ch(1), ch(2)];
}

/** The dome's v and q at an elevation in degrees (RV-79): v = 1 - phi / 90 degrees, tan phi = tan(e) 128 / 76.8 */
export function skyVQ(elevation: number): { v: number; q: number } {
  const e = (Math.max(elevation, 0) * Math.PI) / 180;
  const phi = Math.atan2(Math.sin(e) * (DOME.across / DOME.up), Math.cos(e));
  const v = Math.min(Math.max(1 - phi / (Math.PI / 2), 0), 1);
  return { v, q: Math.min(Math.max(2 * (v - 0.5), 0), 1) };
}

const sat = (x: number): number => Math.min(Math.max(x, 0), 1);
const fract = (x: number): number => x - Math.floor(x);

/** The sky's linear colour in a direction (the game's frame: x, y, z up) at `time` s: H-10 in full (the shader's
 *  twin) */
export function skyColour(noise: SkyNoise, dir: readonly [number, number, number], time: number): [number, number, number] {
  const [x, y, z] = dir;
  const len = Math.hypot(x, y, z) || 1;
  const e = Math.asin(Math.max(z / len, 0));
  const { v, q } = skyVQ((e * 180) / Math.PI);
  const az = (Math.atan2(y, x) * 180) / Math.PI;
  const u = fract(-(az + 5.625) / 360);
  const phi = (1 - v) * (Math.PI / 2);
  const w = sat(-5.859e-8 * DOME.across * Math.cos(phi) * (x / (Math.hypot(x, y) || 1)));
  const pan = (p: readonly [number, number]): [number, number] => [fract(p[0] * time), fract(p[1] * time)];
  const [p1, p2, p3] = [pan(SKY_PANS.smoke1), pan(SKY_PANS.smoke2), pan(SKY_PANS.stars)];
  const n = noise.size;
  const c = sampleNoise(noise.smoke, n, u, v);
  const a = sampleNoise(noise.smoke, n, u * 8 + p1[0], v * 5.25 + p1[1]);
  const b = sampleNoise(noise.smoke, n, u * 6 + p2[0] + 0.2 * c[0], v * 5 + p2[1] + 0.2 * c[0]);
  const S = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
  const gb = (S[2] ?? 0) + w * ((S[1] ?? 0) - (S[2] ?? 0));
  const m0 = sat(6 * (v - (S[0] ?? 0) + 1 - 0.875));
  const bright = 1 + 16 * sat(2 * (gb - 0.125));
  const q4 = q ** 4;
  const s1 = sampleNoise(noise.speckle, n, u * 8 + p3[0], v * 4 + p3[1])[1];
  const s2 = sampleNoise(noise.speckle, n, u * 16, v * 8)[0];
  const s3 = sampleNoise(noise.fire, n, u * 2, v)[0];
  const stars = sat(8 * sat(s1 * s2 * (s3 + 0.5) - 1 / 64) - m0);
  return [0, 1, 2].map((k) => {
    const base = (SKY_COLOURS.zenith[k] ?? 0) + q4 * (SKY_COLOURS.horizonAdd[k] ?? 0);
    const G = v * (base + w * ((SKY_COLOURS.horizon[k] ?? 0) - base));
    const cloud = bright * (SKY_COLOURS.cloud[k] ?? 0);
    return G + (1 - q4) * m0 * ((1 - w) * cloud - G) + stars;
  }) as [number, number, number];
}

const vertexShader = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D smoke;
uniform sampler2D speckle;
uniform sampler2D fire;
uniform vec3 zenith;
uniform vec3 horizonAdd;
uniform vec3 horizon;
uniform vec3 cloudColour;
uniform vec2 pan1;
uniform vec2 pan2;
uniform vec2 pan3;
varying vec3 vDirection;
// (a texture at uv with the derivatives of the unwrapped uv times its scale: no mip spike at the u seam)
vec4 tex(sampler2D t, vec2 uv, vec2 dx, vec2 dy) { return textureGrad(t, uv, dx, dy); }
void main() {
  vec3 d = normalize(vDirection);
  // (the game's frame: x, Three's z, Three's y up)
  vec3 g = vec3(d.x, d.z, d.y);
  float phi = atan(max(g.z, 0.0) * ${(DOME.across / DOME.up).toFixed(6)}, length(g.xy));
  float v = clamp(1.0 - phi / 1.5707963, 0.0, 1.0);
  float q = clamp(2.0 * (v - 0.5), 0.0, 1.0);
  float q4 = q * q * q * q;
  float uRaw = -(degrees(atan(g.y, g.x)) + 5.625) / 360.0;
  vec2 uv = vec2(fract(uRaw), v);
  vec2 dx = vec2(dFdx(uRaw), dFdx(v));
  vec2 dy = vec2(dFdy(uRaw), dFdy(v));
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  float w = clamp(-5.859e-8 * ${DOME.across.toFixed(1)} * cos(phi) * g.x / max(length(g.xy), 1e-6), 0.0, 1.0);
  vec3 base = zenith + q4 * horizonAdd;
  vec3 G = v * mix(base, horizon, w);
#ifdef CARBALL_LQ
  // (High Quality Shaders off: the gradient alone, no clouds, no stars: QG-12, RV-497)
  gl_FragColor = vec4(G, 1.0);
#else
  vec3 c = tex(smoke, uv, dx, dy).rgb;
  vec3 a = tex(smoke, uv * vec2(8.0, 5.25) + pan1, dx * vec2(8.0, 5.25), dy * vec2(8.0, 5.25)).rgb;
  vec3 b = tex(smoke, uv * vec2(6.0, 5.0) + pan2 + 0.2 * c.r, dx * vec2(6.0, 5.0), dy * vec2(6.0, 5.0)).rgb;
  vec3 S = a + b + c;
  float gb = mix(S.b, S.g, w);
  float m0 = clamp(6.0 * (v - S.r + 1.0 - 0.875), 0.0, 1.0);
  vec3 cloud = (1.0 + 16.0 * clamp(2.0 * (gb - 0.125), 0.0, 1.0)) * cloudColour;
  vec3 col = mix(G, (1.0 - w) * cloud, (1.0 - q4) * m0);
  float s1 = tex(speckle, uv * vec2(8.0, 4.0) + pan3, dx * vec2(8.0, 4.0), dy * vec2(8.0, 4.0)).g;
  float s2 = tex(speckle, uv * vec2(16.0, 8.0), dx * vec2(16.0, 8.0), dy * vec2(16.0, 8.0)).r;
  float s3 = tex(fire, uv * vec2(2.0, 1.0), dx * vec2(2.0, 1.0), dy * vec2(2.0, 1.0)).r;
  float stars = clamp(8.0 * clamp(s1 * s2 * (s3 + 0.5) - 1.0 / 64.0, 0.0, 1.0) - m0, 0.0, 1.0);
  // (linear HDR: the post-processing's tone map, PP-4)
  gl_FragColor = vec4(col + stars, 1.0);
#endif
}
`;

const texture = (bytes: Uint8Array, size: number): DataTexture => {
  const t = new DataTexture(bytes, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
};

/** The sky dome (inside the camera's far plane from anywhere in the arena: RV-58) and its clock */
export function buildSkyDome(noise: SkyNoise = skyNoise()): { mesh: Mesh; update: (elapsedSeconds: number) => void } {
  const vec = (c: readonly number[]): Vector3 => new Vector3(c[0], c[1], c[2]);
  // (its CARBALL_LQ branch the gradient alone: QG-12)
  const material = lowQualityPath(new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      smoke: { value: texture(noise.smoke, noise.size) },
      speckle: { value: texture(noise.speckle, noise.size) },
      fire: { value: texture(noise.fire, noise.size) },
      zenith: { value: vec(SKY_COLOURS.zenith) },
      horizonAdd: { value: vec(SKY_COLOURS.horizonAdd) },
      horizon: { value: vec(SKY_COLOURS.horizon) },
      cloudColour: { value: vec(SKY_COLOURS.cloud) },
      pan1: { value: [0, 0] },
      pan2: { value: [0, 0] },
      pan3: { value: [0, 0] },
    },
    side: BackSide,
    depthWrite: false,
    fog: false,
  }));
  // (fogged as the sky: at the game's dome's distance, FOG-15)
  withHeightFog(material, "sky");
  const mesh = new Mesh(new SphereGeometry(32000, 48, 24), material);
  mesh.renderOrder = -1;
  mesh.name = "sky dome";
  let time = 0;
  const pan = (p: readonly [number, number]): number[] => [fract(p[0] * time), fract(p[1] * time)];
  return {
    mesh,
    update: (elapsedSeconds) => {
      time = elapsedSeconds;
      const u = material.uniforms;
      if (u["pan1"]) u["pan1"].value = pan(SKY_PANS.smoke1);
      if (u["pan2"]) u["pan2"].value = pan(SKY_PANS.smoke2);
      if (u["pan3"]) u["pan3"].value = pan(SKY_PANS.stars);
    },
  };
}

/** The fog bowl (FogHemisphere_V2 on SkySphere01, H-10, SUR-23, RV-189): a hemisphere pointing down, its rim at z 4054
 *  and 11,796 out, 5,898 deep; translucent, its colour nothing but the premultiplied vertex fog (a darkening layer),
 *  its alpha Curve_FogDusk.A by the mesh's v (0 at the pole, 1 at the rim) */
export const FOG_BOWL = {
  rim: 4054,
  radius: 11796,
  depth: 5898,
  alpha: [[0.56, 0.88], [0.63, 0.7], [0.69, 0.5], [0.75, 0.29], [0.81, 0.12], [0.88, 0.035], [1, 0]] as readonly (readonly [number, number])[],
  /** its painted vertex colour (SUR-23 v2): its alpha times 184/255 */
  vertex: [39, 39, 39, 184] as const,
} as const;

/** Curve_FogDusk.A at v (the shader's, for tests) */
export function fogBowlAlpha(v: number): number {
  const table = FOG_BOWL.alpha;
  if (v <= (table[0]?.[0] ?? 0)) return table[0]?.[1] ?? 0;
  for (let k = 1; k < table.length; k++) {
    const [v0 = 0, a0 = 0] = table[k - 1] ?? [];
    const [v1 = 1, a1 = 0] = table[k] ?? [];
    if (v <= v1) return a0 + ((a1 - a0) * (v - v0)) / (v1 - v0);
  }
  return 0;
}

/** The fog bowl's mesh: latitude rings from its rim (v 1) to its pole (v 0), 96 round, 24 deep */
export function buildFogBowl(): Mesh {
  const B = FOG_BOWL;
  const [round, deep] = [96, 24];
  const pos: number[] = [];
  const vs: number[] = [];
  const at = (k: number, j: number): [number[], number] => {
    const [lambda, phi] = [(k / round) * 2 * Math.PI, (j / deep) * (Math.PI / 2)];
    // (Three's frame: x, z up, the game's y)
    return [[B.radius * Math.cos(phi) * Math.cos(lambda), B.rim - B.depth * Math.sin(phi), B.radius * Math.cos(phi) * Math.sin(lambda)], 1 - j / deep];
  };
  for (let k = 0; k < round; k++) {
    for (let j = 0; j < deep; j++) {
      const quad = [at(k, j), at(k + 1, j), at(k + 1, j + 1), at(k, j), at(k + 1, j + 1), at(k, j + 1)];
      for (const [p, v] of quad) {
        pos.push(...p);
        vs.push(0, v);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(vs, 2));
  const knots = B.alpha.map(([v]) => v.toFixed(3));
  const alphas = B.alpha.map(([, a]) => a.toFixed(3));
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vV;
      void main() {
        vV = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vV;
      float fogDusk(float v) {
        float knots[7] = float[7](${knots.join(", ")});
        float alphas[7] = float[7](${alphas.join(", ")});
        if (v <= knots[0]) return alphas[0];
        for (int k = 1; k < 7; k++) {
          if (v <= knots[k]) return mix(alphas[k - 1], alphas[k], (v - knots[k - 1]) / (knots[k] - knots[k - 1]));
        }
        return 0.0;
      }
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, fogDusk(vV) * ${(FOG_BOWL.vertex[3] / 255).toFixed(4)});
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  // (its colour the vertex fog alone: c F + fog with c 0)
  withHeightFog(material, "translucent");
  const mesh = new Mesh(geometry, material);
  mesh.name = "sky: fog bowl";
  // (FogHemisphere_V2's TranslucencySortPriority: TRN1)
  mesh.renderOrder = PRIORITY.fogBowl;
  return mesh;
}
