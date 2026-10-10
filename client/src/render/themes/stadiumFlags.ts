// The roof arch's ring of flags (notes/arena-surroundings.md SUR-11, FLG1): 49 banners hanging from the truss where
// the game's placement rule puts them, in our own flag designs matched to the game's atlas by its statistics (the atlas
// is flag artwork and stays local), with the material's baked light and its wind.
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3 } from "three";

/** The ring (game frame, uu, degrees from +x; FLG1's rule: low-order fits and four named corner banners) */
export const FLAG_RING = {
  /** The runs' azimuths from the field's centre: the +Y arm, the +Y end, the back (a cubic in i, -11 to 11), the -Y end
   *  (the +Y end's mirrored), the -Y arm (two more than the +Y's) */
  runs: {
    plusYArm: { az0: 57.9, step: 2.849, count: 7 },
    plusYEnd: { az0: 100.43, step: 4.0, count: 5 },
    back: { c: [3.9658, 4.55e-5, -0.003509] as const, from: -11, to: 11 },
    minusYArm: { az0: 285.16, step: 2.764, count: 9 },
  },
  /** The plan path of the banners' centres: along the back x = x0 + k y² (|y| to 9.4k), its top edge z = t0 + t1 |y| +
   *  t2 y²; along the ends and arms |y| = y0 + y1 x + y2 x², the top edge a cubic in x */
  back: { x0: -15183, k: 8.452e-6, top: [10596.6, 0.01609, -1.8337e-5] as const },
  sides: { y: [15667, 0.24035, -8.5665e-6] as const, top: [10202.2, -0.173054, -1.74096e-5, 1.4645e-10] as const },
  /** The back's corners, named (their run indices; centre, top edge, facing yaw) */
  corners: [
    { index: 12, at: [-13286, 10814] as const, top: 9157, yaw: 297.0 },
    { index: 13, at: [-14160, 10312] as const, top: 8885, yaw: 327.2 },
    { index: 33, at: [-14160, -10312] as const, top: 8885, yaw: 35.9 },
    { index: 34, at: [-13286, -10814] as const, top: 9157, yaw: 63.0 },
  ],
  /** A banner: flat, vertical, hanging from its top edge; its bottom corners trimmed (43 uu off the +u side, 18 off the
   *  -u, over its lowest 110 uu) */
  banner: { width: 439.6, height: 575.4, trim: { plus: 43, minus: 18, up: 110 } },
  /** The baked light (all 49 share one lightmap patch): Ldiff bottom to top, Lspec on the front (seen from the field) */
  light: { bottom: [1.85, 1.66, 0.94] as const, top: [1.44, 1.3, 0.74] as const, spec: [0.37, 0.34, 0.19] as const },
  /** The wind (WindInt 32, UV1.v², Time): its direction, the bounds' origin (the phase), the spatial rate, UV1.v by the
   *  height h above the banner's foot */
  wind: { amount: 32, dir: [0.7375, -0.1366, -0.0005] as const, origin: [-918.84, -29.53, 7653] as const, rate: 0.00293, v: [0.8858, -0.001172] as const },
} as const;

/** Our own flag palette (linear albedo a) and each colour's share of the ring's area, solved for the atlas's used
 *  cells: mean 2a (0.372, 0.246, 0.267), albedo luminance p10/p50/p90 0.021/0.074/0.315 (FLG1) */
export const FLAG_PALETTE = {
  colours: [
    [0.012, 0.012, 0.014],
    [0.01, 0.018, 0.07],
    [0.035, 0.07, 0.24],
    [0.2, 0.012, 0.018],
    [0.42, 0.03, 0.035],
    [0.02, 0.11, 0.04],
    [0.42, 0.27, 0.02],
    [0.38, 0.37, 0.36],
  ] as readonly (readonly [number, number, number])[],
  shares: [0.012, 0.192, 0.335, 0.016, 0.111, 0.036, 0.217, 0.081],
} as const;

/** A banner's place: its centre (game frame), top edge, facing (the inward horizontal normal) */
export interface Banner {
  readonly centre: readonly [number, number];
  readonly top: number;
  readonly normal: readonly [number, number];
}

const rad = Math.PI / 180;

/** The 49 banners' azimuths, in run order (the corners' indices count in it) */
export function flagAzimuths(): number[] {
  const R = FLAG_RING.runs;
  const run = (r: { az0: number; step: number; count: number }): number[] => Array.from({ length: r.count }, (_, i) => r.az0 + r.step * i);
  const plusEnd = run(R.plusYEnd);
  const back = Array.from({ length: R.back.to - R.back.from + 1 }, (_, k) => {
    const i = R.back.from + k;
    return 180 + R.back.c[0] * i + R.back.c[1] * i * i + R.back.c[2] * i * i * i;
  });
  return [...run(R.plusYArm), ...plusEnd, ...back, ...plusEnd.map((a) => 360 - a).reverse(), ...run(R.minusYArm)];
}

/** Where the ray from the centre at `az` meets a path (`gap(x, y)` changing sign along it), by bisection over r */
function along(az: number, gap: (x: number, y: number) => number): [number, number] {
  const [c, s] = [Math.cos(az * rad), Math.sin(az * rad)];
  let [lo, hi] = [5000, 40000];
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(gap(lo * c, lo * s)) === Math.sign(gap(mid * c, mid * s))) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  return [r * c, r * s];
}

/** The banners by the rule (game frame) */
export function flagBanners(): Banner[] {
  const F = FLAG_RING;
  const { back, sides } = F;
  return flagAzimuths().map((az, index) => {
    const corner = F.corners.find((c) => c.index === index);
    if (corner) return { centre: corner.at, top: corner.top, normal: [Math.cos(corner.yaw * rad), Math.sin(corner.yaw * rad)] };
    const onBack = index >= 12 && index <= 34;
    if (onBack) {
      const [x, y] = along(az, (px, py) => px - (back.x0 + back.k * py * py));
      // (x = x0 + k y²: the inward normal (1, -2 k y))
      const n = [1, -2 * back.k * y];
      const len = Math.hypot(n[0] ?? 0, n[1] ?? 0);
      const top = back.top[0] + back.top[1] * Math.abs(y) + back.top[2] * y * y;
      return { centre: [x, y], top, normal: [(n[0] ?? 0) / len, (n[1] ?? 0) / len] };
    }
    const f = (x: number): number => sides.y[0] + sides.y[1] * x + sides.y[2] * x * x;
    // (the +Y arm's first banner hangs about 130 lower and 170 further out than its mirror: the fits hold it)
    const [x, y] = along(az, (px, py) => Math.abs(py) - f(px));
    // (|y| = f(x): the inward normal (f'(x), -sign y))
    const slope = sides.y[1] + 2 * sides.y[2] * x;
    const sy = Math.sign(y);
    const len = Math.hypot(slope, 1);
    const normal: [number, number] = [slope / len, -sy / len];
    const top = sides.top[0] + sides.top[1] * x + sides.top[2] * x * x + sides.top[3] * x * x * x;
    return { centre: [x, y], top, normal };
  });
}

/** Each banner's three bands' palette colours (our own tricolours, across or up), dealt so the colours' areas take
 *  their shares, no band beside its own colour */
export function flagDesigns(count = 49): { across: boolean; bands: [number, number, number] }[] {
  const shares = FLAG_PALETTE.shares;
  const slots = 3 * count;
  const quota = shares.map((s) => Math.floor(s * slots));
  while (quota.reduce((a, b) => a + b, 0) < slots) {
    // (the largest remainders first)
    const k = shares.map((s, i) => s * slots - (quota[i] ?? 0)).reduce((best, r, i, all) => (r > (all[best] ?? -1) ? i : best), 0);
    quota[k] = (quota[k] ?? 0) + 1;
  }
  // (a seeded deal: each slot the colour with the most left, skipping its neighbour's; ties by a hash)
  let seed = 0x9e3779b9;
  const random = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, b) => {
    const bands: number[] = [];
    for (let j = 0; j < 3; j++) {
      const left = quota.map((q, i) => (i === bands[j - 1] ? -1 : q + random() * 0.9));
      const pick = left.indexOf(Math.max(...left));
      quota[pick] = (quota[pick] ?? 0) - 1;
      bands.push(pick);
    }
    return { across: b % 2 === 0, bands: bands as [number, number, number] };
  });
}

/** What the material shows (out = 2a Ldiff + (2a + 0.25) Lspec, Lspec on the front only), for an albedo at height v
 *  (0 foot, 1 top) */
export function flagColour(a: readonly number[], v: number, front: boolean): [number, number, number] {
  const L = FLAG_RING.light;
  return [0, 1, 2].map((c) => {
    const diffuse = (L.bottom[c] ?? 0) + ((L.top[c] ?? 0) - (L.bottom[c] ?? 0)) * v;
    return 2 * (a[c] ?? 0) * diffuse + (front ? (2 * (a[c] ?? 0) + 0.25) * (L.spec[c] ?? 0) : 0);
  }) as [number, number, number];
}

/** The wind's offset (game frame) of a vertex at `p` (game frame) `h` uu above its banner's foot, at `time` s */
export function flagWind(p: readonly [number, number, number], h: number, time: number): [number, number, number] {
  const W = FLAG_RING.wind;
  const lum = 0.3 * W.origin[0] + 0.59 * W.origin[1] + 0.11 * W.origin[2];
  const t = (lum + time) * 0.5;
  const sY = Math.sin(2 * Math.PI * (t + 1 - W.rate * p[1]));
  const sX = Math.sin(Math.PI * (W.rate * p[0] + t));
  const sZ = Math.sin(Math.PI * (W.rate * p[2] + t));
  const w = (2 * sY + sX + sZ) * (sY + 2 * sX + sZ) + 4 * (1 + Math.sin((Math.PI / 2) * t));
  const v = W.v[0] + W.v[1] * h;
  return [0, 1, 2].map((c) => W.amount * v * v * w * (W.dir[c] ?? 0)) as [number, number, number];
}

const f = (v: number): string => v.toPrecision(8);

const vertexShader = /* glsl */ `
uniform float time;
attribute vec2 flagUv;
attribute float foot;
attribute vec3 bandA;
attribute vec3 bandB;
attribute vec3 bandC;
attribute float across;
varying vec2 vUv;
varying vec3 vA;
varying vec3 vB;
varying vec3 vC;
varying float vAcross;
void main() {
  vUv = flagUv;
  vA = bandA;
  vB = bandB;
  vC = bandC;
  vAcross = across;
  vec4 world = modelMatrix * vec4(position, 1.0);
  // (the wind in the game's frame (x, y, z up: Three's x, z, y); its phase every 8 s, t' taken mod 4)
  vec3 p = vec3(world.x, world.z, world.y);
  float t = mod(${f(0.5 * (0.3 * FLAG_RING.wind.origin[0] + 0.59 * FLAG_RING.wind.origin[1] + 0.11 * FLAG_RING.wind.origin[2]))} + 0.5 * time, 4.0);
  float sY = sin(6.2831853 * (t + 1.0 - ${f(FLAG_RING.wind.rate)} * p.y));
  float sX = sin(3.1415927 * (${f(FLAG_RING.wind.rate)} * p.x + t));
  float sZ = sin(3.1415927 * (${f(FLAG_RING.wind.rate)} * p.z + t));
  float w = (2.0 * sY + sX + sZ) * (sY + 2.0 * sX + sZ) + 4.0 * (1.0 + sin(1.5707963 * t));
  float v1 = ${f(FLAG_RING.wind.v[0])} + ${f(FLAG_RING.wind.v[1])} * (world.y - foot);
  vec3 d = ${f(FLAG_RING.wind.amount)} * v1 * v1 * w * vec3(${FLAG_RING.wind.dir.map(f).join(", ")});
  world.xyz += vec3(d.x, d.z, d.y);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vA;
varying vec3 vB;
varying vec3 vC;
varying float vAcross;
void main() {
  // (our tricolour: three bands across or up; out = 2a Ldiff + (2a + 0.25) Lspec, Lspec on the front)
  float s = vAcross > 0.5 ? vUv.x : vUv.y;
  vec3 a = s < 1.0 / 3.0 ? vA : s < 2.0 / 3.0 ? vB : vC;
  vec3 diffuse = mix(vec3(${FLAG_RING.light.bottom.map(f).join(", ")}), vec3(${FLAG_RING.light.top.map(f).join(", ")}), vUv.y);
  vec3 spec = gl_FrontFacing ? vec3(${FLAG_RING.light.spec.map(f).join(", ")}) : vec3(0.0);
  gl_FragColor = vec4(2.0 * a * diffuse + (2.0 * a + 0.25) * spec, 1.0);
  #include <colorspace_fragment>
}
`;

/** The ring as one mesh (Three's frame), each banner in rows for the wind to bend it */
export function buildFlagRing(): Mesh {
  const F = FLAG_RING;
  const { width, height, trim } = F.banner;
  const rows = [0, 55, 110, 220, 330, 450, height];
  const position: number[] = [];
  const uv: number[] = [];
  const foot: number[] = [];
  const bands: [number[], number[], number[]] = [[], [], []];
  const across: number[] = [];
  const designs = flagDesigns();
  flagBanners().forEach((b, k) => {
    const design = designs[k] ?? { across: true, bands: [0, 0, 0] };
    const [nx, ny] = b.normal;
    // (along the banner, +u: the front's right, looking at it from the field)
    const [tx, ty] = [ny, -nx];
    const bottom = b.top - height;
    const corner = (u: number, h: number): number[] => {
      // (the trims: the +u side 43 in at the foot, the -u side 18, back to the full width 110 up)
      const cut = Math.max(0, 1 - h / trim.up);
      const half = u > 0 ? width / 2 - trim.plus * cut : width / 2 - trim.minus * cut;
      const offset = u * half;
      return [b.centre[0] + tx * offset, bottom + h, b.centre[1] + ty * offset];
    };
    for (let r = 0; r + 1 < rows.length; r++) {
      const [h0 = 0, h1 = 0] = [rows[r], rows[r + 1]];
      const quad = [corner(-1, h0), corner(1, h0), corner(1, h1), corner(-1, h1)];
      const uvs = [[0, h0 / height], [1, h0 / height], [1, h1 / height], [0, h1 / height]];
      // (two triangles facing the field: wound counter-clockwise seen from the inward side)
      for (const i of [0, 1, 2, 0, 2, 3]) {
        position.push(...(quad[i] ?? []));
        uv.push(...(uvs[i] ?? []));
        foot.push(bottom);
        design.bands.forEach((c, j) => bands[j]?.push(...(FLAG_PALETTE.colours[c] ?? [0, 0, 0])));
        across.push(design.across ? 1 : 0);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("flagUv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("foot", new Float32BufferAttribute(foot, 1));
  g.setAttribute("bandA", new Float32BufferAttribute(bands[0], 3));
  g.setAttribute("bandB", new Float32BufferAttribute(bands[1], 3));
  g.setAttribute("bandC", new Float32BufferAttribute(bands[2], 3));
  g.setAttribute("across", new Float32BufferAttribute(across, 1));
  g.computeBoundingSphere();
  const material = new ShaderMaterial({ vertexShader, fragmentShader, uniforms: { time: { value: 0 } }, side: DoubleSide });
  const mesh = new Mesh(g, material);
  mesh.name = "flags: country ring";
  // (the wind moves it up to 440 uu: its bounds as they are, never culled away by them)
  mesh.frustumCulled = false;
  return mesh;
}

/** The ring's clock (the wind) */
export function updateFlagRing(mesh: Mesh, elapsedSeconds: number): void {
  const u = (mesh.material as ShaderMaterial).uniforms["time"];
  if (u) u.value = elapsedSeconds;
}

/** (for tests: a vertex's normal side, the field's) */
export function flagFront(b: Banner): Vector3 {
  return new Vector3(b.normal[0], 0, b.normal[1]);
}
