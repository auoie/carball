// DFH Stadium's sky (SkyDome_MAT, notes/arena-visuals.md H-10 and its detail; SUR-25): the gradient G (the zenith, the
// warm horizon as q^4, pulled toward the horizon's colour on the sun's side, all times v), the brown clouds where the
// panning smoke noise's sum falls under v, and the stars. The game's three noise textures can't ship: ours are made
// here from their statistics (each channel's quantiles, the smoke's red against its green and blue, the feature sizes,
// the speckles' neighbour correlation), stored as the game's are (8-bit sRGB, mipmapped) and sampled by the game's
// formula. Values and formulas only.
import { BackSide, DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, RepeatWrapping, RGBAFormat, SRGBColorSpace, ShaderMaterial, SphereGeometry, UnsignedByteType, Vector3 } from "three";

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

/** The noises' structure (our own, to the textures' measures): the smoke's lattices (red's own part 8 cells a tile, green
 *  and blue 16; 4 octaves; red = (green + blue + sqrt 2 own) / 2, so 0.5 with each: the textures' 0.49 and 0.51), the
 *  speckles' neighbour kernels [a, 1, a] (lag-1 correlation 0.44 and 0.42), the fire's lattice (80 cells: its 0.87 at a
 *  texel) */
export const NOISE_SHAPE = { size: 512, smokeOwn: 8, smokeGB: 16, octaves: 4, speckleR: 0.2468, speckleG: 0.4, fire: 80 } as const;

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
  for (let o = 0; o < octaves; o++) {
    const c = cells * 2 ** o;
    const next = generator(seed + 101 * o);
    const lattice = Float64Array.from({ length: c * c }, () => next());
    for (let y = 0; y < n; y++) {
      const fy0 = ((y + 0.5) / n) * c;
      const iy = Math.floor(fy0);
      const ty = fy0 - iy;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < n; x++) {
        const fx0 = ((x + 0.5) / n) * c;
        const ix = Math.floor(fx0);
        const tx = fx0 - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const at = (i: number, j: number): number => lattice[((j % c) * c + (i % c)) % (c * c)] ?? 0;
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
        const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
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
  const pass = (f: Float64Array, dx: number, dy: number): Float64Array =>
    f.map((v, k) => {
      const [x, y] = [k % n, Math.floor(k / n)];
      const at = (i: number, j: number): number => f[((j + n) % n) * n + ((i + n) % n)] ?? 0;
      return v + a * (at(x - dx, y - dy) + at(x + dx, y + dy));
    });
  return standardise(pass(pass(z, 1, 0), 0, 1));
}

/** A field's values as their ranks, 0 to 1 (uniform whatever the field's own distribution) */
function ranks(f: Float64Array): Float64Array {
  const order = Array.from(f.keys()).sort((i, j) => (f[i] ?? 0) - (f[j] ?? 0));
  const out = new Float64Array(f.length);
  order.forEach((k, r) => {
    out[k] = r / (f.length - 1);
  });
  return out;
}

/** A uniform value through a channel's quantiles (its levels decoded: interpolated linear) */
function quantile(levels: readonly number[], u: number): number {
  const table = levels.map(fromSrgbByte);
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

/** Makes the noises (deterministic: the same textures every time) */
export function skyNoise(): SkyNoise {
  const { size: n, smokeOwn, smokeGB, octaves } = NOISE_SHAPE;
  const own = valueNoise(n, smokeOwn, octaves, 11);
  const g = valueNoise(n, smokeGB, octaves, 22);
  const b = valueNoise(n, smokeGB, octaves, 33);
  const sr = speckle(n, NOISE_SHAPE.speckleR, 44);
  const sg = speckle(n, NOISE_SHAPE.speckleG, 55);
  const fire = valueNoise(n, NOISE_SHAPE.fire, 1, 66);
  const smoke = new Uint8Array(n * n * 4);
  const speck = new Uint8Array(n * n * 4);
  const fireBytes = new Uint8Array(n * n * 4);
  // (each field to its ranks, then through its channel's quantiles: the textures' distributions exactly)
  const [ur, ug, ub] = [ranks(g.map((v, k) => (v + (b[k] ?? 0) + Math.SQRT2 * (own[k] ?? 0)) / 2)), ranks(g), ranks(b)];
  const [usr, usg, uf] = [ranks(sr), ranks(sg), ranks(fire)];
  for (let k = 0; k < n * n; k++) {
    smoke.set([toSrgbByte(quantile(NOISE_QUANTILES.smokeR, ur[k] ?? 0)), toSrgbByte(quantile(NOISE_QUANTILES.smokeG, ug[k] ?? 0)), toSrgbByte(quantile(NOISE_QUANTILES.smokeB, ub[k] ?? 0)), 255], 4 * k);
    speck.set([toSrgbByte(quantile(NOISE_QUANTILES.speckleR, usr[k] ?? 0)), toSrgbByte(quantile(NOISE_QUANTILES.speckleG, usg[k] ?? 0)), 0, 255], 4 * k);
    fireBytes.set([toSrgbByte(quantile(NOISE_QUANTILES.fireR, uf[k] ?? 0)), 0, 0, 255], 4 * k);
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
  vec3 c = tex(smoke, uv, dx, dy).rgb;
  vec3 a = tex(smoke, uv * vec2(8.0, 5.25) + pan1, dx * vec2(8.0, 5.25), dy * vec2(8.0, 5.25)).rgb;
  vec3 b = tex(smoke, uv * vec2(6.0, 5.0) + pan2 + 0.2 * c.r, dx * vec2(6.0, 5.0), dy * vec2(6.0, 5.0)).rgb;
  vec3 S = a + b + c;
  float gb = mix(S.b, S.g, w);
  float m0 = clamp(6.0 * (v - S.r + 1.0 - 0.875), 0.0, 1.0);
  vec3 cloud = (1.0 + 16.0 * clamp(2.0 * (gb - 0.125), 0.0, 1.0)) * cloudColour;
  vec3 base = zenith + q4 * horizonAdd;
  vec3 G = v * mix(base, horizon, w);
  vec3 col = mix(G, (1.0 - w) * cloud, (1.0 - q4) * m0);
  float s1 = tex(speckle, uv * vec2(8.0, 4.0) + pan3, dx * vec2(8.0, 4.0), dy * vec2(8.0, 4.0)).g;
  float s2 = tex(speckle, uv * vec2(16.0, 8.0), dx * vec2(16.0, 8.0), dy * vec2(16.0, 8.0)).r;
  float s3 = tex(fire, uv * vec2(2.0, 1.0), dx * vec2(2.0, 1.0), dy * vec2(2.0, 1.0)).r;
  float stars = clamp(8.0 * clamp(s1 * s2 * (s3 + 0.5) - 1.0 / 64.0, 0.0, 1.0) - m0, 0.0, 1.0);
  // (linear HDR: the post-processing's tone map, PP-4)
  gl_FragColor = vec4(col + stars, 1.0);
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
export function buildSkyDome(noise: SkyNoise = skyNoise()): { mesh: Mesh; update: (seconds: number) => void } {
  const vec = (c: readonly number[]): Vector3 => new Vector3(c[0], c[1], c[2]);
  const material = new ShaderMaterial({
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
  });
  const mesh = new Mesh(new SphereGeometry(32000, 48, 24), material);
  mesh.renderOrder = -1;
  mesh.name = "sky dome";
  let time = 0;
  const pan = (p: readonly [number, number]): number[] => [fract(p[0] * time), fract(p[1] * time)];
  return {
    mesh,
    update: (seconds) => {
      time += seconds;
      const u = material.uniforms;
      if (u["pan1"]) u["pan1"].value = pan(SKY_PANS.smoke1);
      if (u["pan2"]) u["pan2"].value = pan(SKY_PANS.smoke2);
      if (u["pan3"]) u["pan3"].value = pan(SKY_PANS.stars);
    },
  };
}
