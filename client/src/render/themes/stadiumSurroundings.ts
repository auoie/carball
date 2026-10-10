// DFH Stadium's surroundings (notes/arena-surroundings.md, SUR-1..44): what's outside the cage. Built from the spec's
// numbers (placements, measures, formulas, statistics) and rules; nothing traced from the game's meshes, no game
// artwork (the user's rule: SUR-37..44's stand-ins). Here: the reflection capture's hotspots (SUR-33), the stands and the
// structures over them (SUR-2..8, 12, 15, 16), the far layer (SUR-11, 22, 23); the crowd in stadiumCrowd.ts, the
// screens, ads and props in stadiumProps.ts.
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  type Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  NormalBlending,
  Path,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from "three";
import { GRASS_CUBE_AT } from "../grassCube";
import { fullBright } from "../teamColors";

/** A glow seen from the capture point: its direction (az = atan2(y, x), el, degrees), its angular half sizes across and
 *  up (degrees: atan(256 Scale3D.y / d) x atan(256 Scale3D.z / d)), its distance (uu), its world pitch (degrees, its top
 *  toward the arena: the instances' rotation, RV-119); `clear`: unfogged, faded instead by elevation (clearFade) */
export interface Hotspot {
  readonly az: number;
  readonly el: number;
  readonly radius: readonly [number, number];
  readonly distance: number;
  readonly pitch?: number;
  readonly clear?: boolean;
}

/** The +X hotspot's pass through the haze by elevation (RV-120: min(1, 0.07 e^(0.12 el)), within 0.04 of the game's
 *  pass fractions 0.07, 0.12, 0.16, 0.27, 0.56, 0.89 at el 0-25) */
export const CLEAR_FADE = { at0: 0.07, rate: 0.12 } as const;
export function clearFade(el: number): number {
  return Math.min(1, CLEAR_FADE.at0 * Math.exp(CLEAR_FADE.rate * el));
}

/** CubeMap_HotSpot_Mat's glows (SUR-33, corrected: ellipses; ten Circle_Sprites the game shows only to its cube
 *  capture): the +X horizon's (fogged only near the horizon: RV-120), two over the back (-X), one over each end, one
 *  each side of the open +X. HotSpot_Mat's at 490k is fogged out in the game */
export const HOTSPOTS: readonly Hotspot[] = [
  { az: 2, el: 2, radius: [52.7, 30.4], distance: 150000, pitch: 35.7, clear: true },
  { az: 180, el: 7, radius: [63.1, 33.3], distance: 25000, pitch: 14.7 },
  { az: 180, el: 7, radius: [6.1, 33.7], distance: 37000, pitch: 35.7 },
  { az: 107, el: 22, radius: [60.8, 30.8], distance: 14000, pitch: 14.7 },
  { az: -108, el: 26, radius: [50.5, 22.0], distance: 15000, pitch: 9.7 },
  { az: 35, el: 15, radius: [21, 21], distance: 15000, pitch: 9.7 },
  { az: -35, el: 15, radius: [21, 21], distance: 15000, pitch: 9.7 },
];
/** The farthest a sprite is placed (inside the concourse's wall and the sky's dome; its angular size kept, its fog
 *  its own distance's) */
export const HOTSPOT_PLACE_MAX = 29000;
/** Their colour: 8 (0.533, 0.686, 0.725) (clamped by the capture's 8 bits); alpha sat(8 FillFlare.G) */
export const HOTSPOT_COLOR = [4.27, 5.49, 5.8] as const;
/** The team hotspots (additive, 8 FillFlare.G FB(team)): low over each goal, 8k out */
export const TEAM_HOTSPOTS: readonly (Hotspot & { readonly team: 0 | 1 })[] = [
  { team: 0, az: -90, el: 9, radius: [26.9, 20.8], distance: 8087, pitch: 35.7 },
  { team: 1, az: 90, el: 8, radius: [23.5, 18.1], distance: 9421, pitch: 35.7 },
];
/** FillFlare's G by radius r = 0, 0.1, ... 0.9 (a statistic: SUR-41; 0 beyond) */
export const FILL_FLARE_G = [1.0, 0.97, 0.91, 0.81, 0.67, 0.49, 0.31, 0.15, 0.04, 0.01];

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** The sprite: FillFlare's G by radius; fogged by its own distance (the scene's linear fog, not where it's placed), or
 *  for a `clear` one faded by elevation from the capture point */
const fragmentShader = /* glsl */ `
uniform vec3 colour;
uniform float flare[10];
uniform bool additive;
uniform float gameDistance;
uniform bool clear;
uniform vec3 from;
varying vec2 vUv;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  float x = length(vUv - 0.5) * 20.0;
  int i = int(min(floor(x), 9.0));
  float g = x >= 10.0 ? 0.0 : mix(flare[i], i < 9 ? flare[i + 1] : 0.0, x - float(i));
  float pass = 1.0;
  if (clear) {
    float el = degrees(asin(clamp(normalize(vWorld - from).y, -1.0, 1.0)));
    pass = min(1.0, ${CLEAR_FADE.at0} * exp(${CLEAR_FADE.rate} * el));
  }
  if (additive) gl_FragColor = vec4(8.0 * g * colour * pass, 1.0);
  else gl_FragColor = vec4(colour, clamp(8.0 * g, 0.0, 1.0) * pass);
  #include <colorspace_fragment>
  #ifdef USE_FOG
    if (!clear) gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, gameDistance));
  #endif
}
`;

/** A glow's sprite: a quad along (az, el) from the capture point (at its distance, or HOTSPOT_PLACE_MAX if nearer),
 *  facing it, `radius` across and up there, rolled by `tilt` */
function hotspotMesh(spot: Hotspot, colour: readonly [number, number, number], additive: boolean): Mesh {
  const rad = Math.PI / 180;
  const [az, el] = [spot.az * rad, spot.el * rad];
  const [ax, ay] = [spot.radius[0] * rad, spot.radius[1] * rad];
  const at = Math.min(spot.distance, HOTSPOT_PLACE_MAX);
  // (the game's frame (x, y, z up) as Three's (x, z up, y))
  const centre = new Vector3(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y);
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      colour: { value: new Vector3(...colour) },
      flare: { value: FILL_FLARE_G },
      additive: { value: additive },
      gameDistance: { value: spot.distance },
      clear: { value: spot.clear ?? false },
      from: { value: centre },
    },
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    side: DoubleSide,
    fog: !spot.clear,
  });
  const mesh = new Mesh(new PlaneGeometry(2 * at * Math.tan(ax), 2 * at * Math.tan(ay)), material);
  const dir = new Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  mesh.position.copy(centre).addScaledVector(dir, at);
  mesh.lookAt(centre);
  // (drawn over the canopy and the rest of the translucent surroundings, which sort as near: their geometry's in world
  // space round the origin; the glows are in front of them in the game)
  mesh.renderOrder = 2;
  // (its top toward the arena: the instance's world pitch, so to the line of sight that less the sight line's
  // elevation, RV-149)
  if (spot.pitch) mesh.rotateX((spot.pitch - spot.el) * rad);
  return mesh;
}

/** The hotspots, for the reflection capture only (the theme's `captureOnly`: hidden from the game's view) */
export function buildCaptureHotspots(primary0: Color, primary1: Color): Group {
  const group = new Group();
  group.name = "capture hotspots";
  for (const spot of HOTSPOTS) group.add(hotspotMesh(spot, HOTSPOT_COLOR, false));
  for (const spot of TEAM_HOTSPOTS) {
    const p = spot.team === 0 ? primary0 : primary1;
    group.add(hotspotMesh(spot, fullBright([p.r, p.g, p.b]), true));
  }
  group.visible = false;
  return group;
}

// --- The bowl and its structures (SUR-1..9, 12, 15..21) -------------------------------------------------------------

type RZ = readonly [number, number];

/** A tier of seats: its rows' card centres from the crowd's statistics (surroundings_geometry crowd_tiers: each
 *  section's row count and first and last rows, rounded), the rise per row growing `growth` times from the front row
 *  to the back (a parabolic rake; 1: a straight one) */
export interface Tier {
  readonly rows: number;
  readonly first: RZ;
  readonly last: RZ;
  readonly growth: number;
}

/** The stands as rules and a few named measures (the spec's traced SUR-2/3 profiles are local only: none of their
 *  points here). Each surface follows its tier's rows: a tread a row's pitch deep, `seat` under the row's cards, a
 *  riser up to the next; uu, az = atan2(y, x) in degrees on the y >= 0 half (y < 0 mirrors it) */
export const STANDS = {
  /** a card's centre over its row's tread (SUR-28: about 93, p5-p95 91-100) */
  seat: 93,
  /** a tier's parapet over its last tread (the upper tiers': 100, the stands' top at their ends under 7k, RV-123); the
   *  upper tiers' front fascia under their first */
  parapet: 150,
  upperParapet: 100,
  fascia: 350,
  /** The lower bowl (az 27-171): the front wall from the inner radius up to its TV strip (SUR-17's placement), the four
   *  front rows, the walkway and its step, the main rake, the back wall. At the -X end (RV-123): from az 153 one rake
   *  without a walkway, (11.8k, 1.03k) to (17.5k, 2.48k), from 164 its first 20 rows tapering to 7 by 171; behind it a wedge out to (23.2k,
   *  4.7k), its outermost 4 rows from az 137 growing to all 24 by 153, to 164 (the main rake beside it to r 17.45k) */
  lower: {
    az: [27, 171] as const,
    innerR: 11200,
    strip: { r: 12000, z: [512, 797] as const, az: [[48, 98], [118, 167]] as const },
    front: { rows: 4, first: [12250, 948], last: [13000, 1119], growth: 1 } as Tier,
    main: { rows: 34, first: [13520, 1834], last: [21380, 3985], growth: 1.5 } as Tier,
    back: { rows: 25, first: [11800, 1030], last: [17500, 2480], growth: 1 } as Tier,
    backAz: { from: 153, full: 164, to: 171, taperRows: 20, endRows: 7 },
    wedge: { rows: 24, first: [17726, 2600], last: [23200, 4700], growth: 1 } as Tier,
    wedgeAz: { from: 137, full: 153, to: 164, fromRows: 4 },
    mainToBesideWedge: 17450,
  },
  /** The upper tiers over each end (az 76-140): the mid tier (its TV strip, SUR-3's placement; its front section and the
   *  back one behind a step), the top tier over it, to z 9.7k (26 rows) over the end's centre */
  upper: {
    az: [76, 140] as const,
    strip: { r: 14750, z: [3160, 3360] as const, az: [83, 137] as const },
    /** the top tier's front strip (SUR-16, RV-135) */
    topStrip: { r: 15200, z: [5400, 5700] as const, az: [93, 122] as const },
    mid: { rows: 12, first: [15250, 3710], last: [17470, 4965], growth: 1 } as Tier,
    midBack: { rows: 10, first: [18130, 5656], last: [20220, 6949], growth: 1 } as Tier,
    top: { rows: 26, first: [15415, 5958], last: [20041, 9729], growth: 1 } as Tier,
  },
  /** Where the tiers have seats and cards (RV-123, the cards' statistics by azimuth): the front rows over az 45-98.9
   *  and 117-153; the main rake's first rows at the +X ends from r 17.9k (to az 38), 16.9k (to 42), 16.1k (to 46); the mid tier's
   *  front rows only its last 8 over the end's centre (az 96-120), under the top tier; the top tier over az 88.9-126.9,
   *  all 26 rows over the centre (az 100.5-115.5), its first 12 elsewhere */
  seating: {
    frontAz: [[45, 98.9], [117, 153]] as const,
    plusXCut: [[38, 17900], [42, 16900], [46, 16100]] as const,
    midCentre: { az: [96, 120] as const, rows: 8 },
    topAz: [88.9, 126.9] as const,
    topFull: { az: [100.5, 115.5] as const, rows: 12 },
  },
  /** The back wall behind the stands, the concourse out to the outer wall (inside the camera's reach: 30k) */
  backR: 21500,
  concourse: { r: [21500, 30000] as const, z: 500, wallTop: 8000, plaza: { az: [166, 172] as const, wallTop: 1260 } },
  /** The ground between the cage and the stands (Stadium_Base's apron, z just under the field's), to the front wall, 12k
   *  across the open +X (|az| < 27) and the -X plaza (beyond 171); the plaza's ground there, z 1.2k at r 12k to 1.31k at
   *  19.2k (SUR-4, corrected: RV-154e) */
  apron: { z: -2, out: 12000, openAz: 27, plazaAz: 171 },
  plaza: { from: [12000, 1200] as RZ, to: [19200, 1310] as RZ },
} as const;

/** The structures over the stands: each edge a low-order fit in t = (az - 110) / 70 (coefficients from t^0 up), fitted
 *  to the per-azimuth statistics (each mesh's radius and height at its 1st and 99th percentiles every 10 degrees):
 *  rules with a few coefficients, not the tables (within 0.3k but the roof's outer edges, 0.5-1k) */
export const STRUCTURES = {
  /** Stadium_Top, the roof's band (SUR-5): its inner edge high, its outer low (the low edge no lower than 1.3k) */
  roof: {
    az: [45, 176] as const,
    rIn: [15391, 811, 6528, -922, 1607],
    rOut: [17440, 3148, 14606, -2063, -4894],
    zLo: [11369, -1432, -10847, 246],
    zHi: [12584, 43, -2718, -994, -5325],
    zMin: 1300,
  },
  /** The glass canopy (SUR-6): from its inner high edge down to its outer low edge (r 25.9k, z 2.6k); over the end's
   *  centre (az 95-115) only its top strip, 2.1k deep and 1.4k down */
  canopy: {
    az: [55, 165] as const,
    rIn: [14551, 570, 9214],
    zHi: [11776, -409, -5555],
    outer: [25900, 2600] as RZ,
    strip: { az: [95, 115] as const, depth: 2100, drop: 1400, blend: 5 },
  },
  /** The floodlight banks (Stadium_Lights, SUR-8), over each end */
  lights: {
    az: [75, 135] as const,
    rIn: [14763, 217, 5542],
    rOut: [15395, 567, 7117],
    zLo: [9709, -450, -5250],
    zHi: [10434, -183, -4083],
  },
  /** The steel trusses (Stadium_Supports, SUR-7, RV-128a): from the ground at r 25.6k (z 1.4k) up to under the roof's
   *  inner edge, 2.25k below its top to az 145; from there onto the supports' ring by 155 (r 15.6k, z 10.6k: the game's
   *  15.2-16.0k and 10.2-10.75k, not the receding roof's edge, RV-151); every 10 degrees from 45 to 165; the ring on
   *  round over the -X plaza (crossing it at el 32 from the capture point: the game's 31.6-32.9; no rib there: the game
   *  shows its supports only at el 2.4-3.6 and 32, RV-151) */
  supports: { foot: [25600, 1400] as RZ, every: 10, az: [45, 165] as const, below: 2250, ring: { from: 145, to: 155, r: 15600, z: 10600 }, width: 160 },
} as const;

/** A support's head (r, z) at az: under the roof's inner edge, then onto the ring (RV-151) */
export function supportHead(az: number): RZ {
  const { below, ring } = STRUCTURES.supports;
  const { roof } = STRUCTURES;
  const f = Math.min(Math.max((az - ring.from) / (ring.to - ring.from), 0), 1);
  const edge = Math.min(az, ring.from);
  return [(1 - f) * edgeAt(roof.rIn, edge) + f * ring.r, (1 - f) * (edgeAt(roof.zHi, edge) - below) + f * ring.z];
}

/** A fit's value at az */
export function edgeAt(coefficients: readonly number[], az: number): number {
  const t = (az - 110) / 70;
  return coefficients.reduceRight((sum, c) => sum * t + c, 0);
}

/** A tier's rows' card centres, front to back */
export function tierRows(tier: Tier): RZ[] {
  const steps = tier.rows - 1;
  const weights = Array.from({ length: steps }, (_, k) => 1 + (tier.growth - 1) * (steps > 1 ? k / (steps - 1) : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const rows: RZ[] = [];
  let z = tier.first[1];
  for (let k = 0; k <= steps; k++) {
    rows.push([tier.first[0] + ((tier.last[0] - tier.first[0]) * k) / Math.max(steps, 1), z]);
    z += ((tier.last[1] - tier.first[1]) * (weights[k] ?? 0)) / (total || 1);
  }
  return rows;
}

/** The stepped surface under a tier's rows: each row's tread (from half a pitch before its cards to half after) */
function treads(tier: Tier): RZ[] {
  const pitch = (tier.last[0] - tier.first[0]) / Math.max(tier.rows - 1, 1);
  return tierRows(tier).flatMap(([r, z]): RZ[] => [
    [r - pitch / 2, z - STANDS.seat],
    [r + pitch / 2, z - STANDS.seat],
  ]);
}

export type TierName = "front" | "main" | "back" | "wedge" | "mid" | "midBack" | "top";

/** A tier by name */
export function tierOf(name: TierName): Tier {
  return name === "front" || name === "main" || name === "back" || name === "wedge" ? STANDS.lower[name] : STANDS.upper[name];
}

/** The rows of a tier with seats and cards at `az`: [first, end) (STANDS.seating) */
export function rowsAt(name: TierName, az: number): readonly [number, number] {
  const { lower, upper, seating } = STANDS;
  const within = (span: readonly [number, number]): boolean => az >= span[0] && az <= span[1];
  const isLower = name === "front" || name === "main" || name === "back" || name === "wedge";
  const tier = tierOf(name);
  if (!within(isLower ? lower.az : upper.az)) return [0, 0];
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(Math.max(t, 0), 1);
  switch (name) {
    case "front":
      return seating.frontAz.some(within) ? [0, tier.rows] : [0, 0];
    case "main": {
      if (az >= lower.backAz.from) return [0, 0];
      const rows = tierRows(tier);
      const cutR = seating.plusXCut.find(([until]) => az < until)?.[1] ?? 0;
      const first = rows.findIndex(([r]) => r >= cutR);
      const end = az >= lower.wedgeAz.from ? rows.filter(([r]) => r <= lower.mainToBesideWedge).length : tier.rows;
      return [Math.max(first, 0), end];
    }
    case "back": {
      const b = lower.backAz;
      if (az < b.from) return [0, 0];
      return [0, Math.round(az <= b.full ? tier.rows : lerp(b.taperRows, b.endRows, (az - b.full) / (b.to - b.full)))];
    }
    case "wedge": {
      const w = lower.wedgeAz;
      if (az < w.from || az > w.to) return [0, 0];
      const n = Math.round(lerp(w.fromRows, tier.rows, (az - w.from) / (w.full - w.from)));
      return [tier.rows - n, tier.rows];
    }
    case "mid":
      return within(seating.midCentre.az) ? [tier.rows - seating.midCentre.rows, tier.rows] : [0, tier.rows];
    case "midBack":
      return [0, tier.rows];
    case "top":
      return within(seating.topAz) ? [0, within(seating.topFull.az) ? tier.rows : seating.topFull.rows] : [0, 0];
  }
}

/** Joins two runs of points with a flat then a riser (a walkway, a step) */
function stepTo(from: readonly RZ[], to: readonly RZ[]): RZ[] {
  const end = from.at(-1) ?? [0, 0];
  const start = to[0] ?? end;
  return [...from, [start[0], end[1]], ...to];
}

/** The seen colours (SUR-20, 21: baked light included; lit surroundings are lightmap-only, so drawn unlit) */
export const BOWL_COLOURS = {
  concrete: [0.156, 0.15, 0.108],
  seats: [0.071, 0.07, 0.055],
  roof: [0.161, 0.143, 0.095],
  sidewalk: [0.1, 0.1, 0.1],
  steel: [0.19, 0.19, 0.19],
} as const;

/** A surface swept round the centre: at each az from `from` to `to` (degrees, the y >= 0 half; mirrored to y < 0 when
 *  `mirror`), a cross-section of (r, z) points from `section(az)`; uv: (az fraction, along the section 0..1) */
function sweep(from: number, to: number, steps: number, section: (az: number) => readonly RZ[], mirror = true): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const sign of mirror ? [1, -1] : [1]) {
    let n = 0;
    const base = pos.length / 3;
    for (let s = 0; s <= steps; s++) {
      const az = from + ((to - from) * s) / steps;
      const a = (sign * az * Math.PI) / 180;
      const pts = section(az);
      n = pts.length;
      pts.forEach(([r, z], k) => {
        // (Three's frame: x, z up, the game's y)
        pos.push(r * Math.cos(a), z, r * Math.sin(a));
        uv.push(s / steps, n > 1 ? k / (n - 1) : 0);
      });
    }
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k + 1 < n; k++) {
        const i = base + s * n + k;
        const j = i + n;
        idx.push(i, j, i + 1, j, j + 1, i + 1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An unlit surface in a seen colour, with a little smooth value noise (relative: concrete's 0.04 on its 0.433 albedo,
 *  about 9 %: SUR-38) */
export function seenMaterial(rgb: readonly [number, number, number], noise = 0.09): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 colour;
      uniform float noise;
      varying vec3 vWorld;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float valueNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y);
        float b = mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y);
        return mix(a, b, f.z);
      }
      void main() {
        // (two octaves, about +-1.7 standard deviations: the relative spread, noise)
        float n = 0.65 * valueNoise(vWorld / 400.0) + 0.35 * valueNoise(vWorld / 97.0) - 0.5;
        gl_FragColor = vec4(colour * (1.0 + 3.4 * noise * n), 1.0);
        #include <colorspace_fragment>
      }`,
    uniforms: { colour: { value: new Vector3(...rgb) }, noise: { value: noise } },
    side: DoubleSide,
  });
}

/** SUR-16: the TV strips, E = 0.5 (1 - (2 frac(2v) - 1)^2)(panels + 0.35 noise): light (0.8) and dark (0.07) panels in
 *  turn along both rows, a generic emblem on the dark ones (ours: no ad artwork); mean E 0.20 */
function stripMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        // (two rows, v 0-0.5 and 0.5-1, light and dark panels in turn, the rows opposite: L D L D over D L D L; a dark
        // panel's emblem at its middle, a quarter of it: RV-127b)
        float cell = vUv.x * 120.0;
        float row = floor(2.0 * vUv.y);
        float light = mod(floor(cell) + row, 2.0) < 1.0 ? 0.8 : 0.07;
        vec2 q = vec2(fract(cell), fract(2.0 * vUv.y)) - 0.5;
        if (light < 0.5 && length(q) < 0.2821) light = 0.8;
        float v = 2.0 * fract(2.0 * vUv.y) - 1.0;
        float e = 0.5 * (1.0 - v * v) * (light + 0.35 * 0.225);
        gl_FragColor = vec4(vec3(e), 1.0);
        #include <colorspace_fragment>
      }`,
    side: DoubleSide,
  });
}

/** SUR-15: the glass canopy, unlit, alpha 0.5, emissive 2 (R^2 + R + 1/16) FB(team), R = sat(1.12 - 1.13e-4 z) (the
 *  team's at its low outer edge, 0.125 FB at its top); the team by the side (y < 0 blue) */
function canopyMaterial(bright0: readonly [number, number, number], bright1: readonly [number, number, number]): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 bright0;
      uniform vec3 bright1;
      varying vec3 vWorld;
      void main() {
        float r = clamp(1.12 - 1.13e-4 * vWorld.y, 0.0, 1.0);
        vec3 fb = vWorld.z < 0.0 ? bright0 : bright1;
        gl_FragColor = vec4(2.0 * (r * r + r + 0.0625) * fb, 0.5);
        #include <colorspace_fragment>
      }`,
    uniforms: { bright0: { value: new Vector3(...bright0) }, bright1: { value: new Vector3(...bright1) } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** SUR-12, RV-125: the floodlight banks: 42 fixtures a bank in 6 groups of 7 (each half three: from 2592, 4787 and 6950
 *  out from the end's centre along the bank, pitch 241, 237.8, 233.2), the halves over az 77.6-98.07 and 117.96-138.4
 *  (nothing in the 5184 between); E = (1 - y)^2 tri 16 max((0.5, 0.483, 0.381) - y, 0) sat(2 (D + 1/32)), warm white,
 *  not team-coloured. Drawn from its v-profile across the bank (the static session's statistic of the front faces: mean
 *  E per 1/32 from v 0.25, none outside 0.25-0.75), its lens rows (v 0.406-0.469, 0.531-0.594) only at the fixtures
 *  (within 32 uu of one, none beyond 96), their means kept */
export const FLOODLIGHT = {
  halves: [[77.6, 98.07], [117.96, 138.4]] as const,
  groups: [[2592, 241], [4787, 237.8], [6950, 233.2]] as const,
  perGroup: 7,
  centre: 108,
  profile: [
    [0.081, 0.045, 0.0], [0.38, 0.311, 0.001], [0.584, 0.519, 0.136], [0.542, 0.498, 0.244], [0.211, 0.198, 0.118], [0.691, 0.657, 0.458],
    [2.17, 2.08, 1.54], [4.41, 4.25, 3.3], [4.3, 4.14, 3.21], [1.99, 1.9, 1.41], [0.597, 0.568, 0.395], [0.177, 0.165, 0.099],
    [0.454, 0.418, 0.203], [0.504, 0.448, 0.116], [0.348, 0.285, 0.001], [0.077, 0.042, 0.0],
  ] as readonly (readonly [number, number, number])[],
  lens: { rows: [[0.406, 0.469], [0.531, 0.594]] as const, full: 32, none: 96 },
} as const;

/** The fixtures' azimuths on a half (degrees off the end's centre: their along-bank offsets spread linearly over the
 *  half's span) */
export function fixtureOffsets(): number[] {
  const F = FLOODLIGHT;
  const along = F.groups.flatMap(([from, pitch]) => Array.from({ length: F.perGroup }, (_, k) => from + pitch * k));
  const [first, last] = [along[0] ?? 0, along.at(-1) ?? 1];
  // (the nearer half, az 77.6-98.07: its near end 98.07, its far end 77.6; the other half mirrors it)
  const near = Math.abs(F.centre - F.halves[0][1]);
  const far = Math.abs(F.centre - F.halves[0][0]);
  return along.map((s) => -(near + (far - near) * ((s - first) / (last - first))));
}

/** The lens rows' mask along the bank at `d` uu from the nearest fixture (1 within 32, none beyond 96) */
const lensMask = (d: number): number => Math.min(Math.max((FLOODLIGHT.lens.none - d) / (FLOODLIGHT.lens.none - FLOODLIGHT.lens.full), 0), 1);

/** The floodlights' emissive at v across the bank, `d` uu along it from the nearest fixture, `mean` the lens mask's mean
 *  over the half (the shader's, for tests) */
export function floodlightE(v: number, d: number, mean: number): [number, number, number] {
  const F = FLOODLIGHT;
  if (v < 0.25 || v >= 0.75) return [0, 0, 0];
  const bin = F.profile[Math.floor((v - 0.25) * 32)] ?? [0, 0, 0];
  const lens = F.lens.rows.some(([a, b]) => v >= a && v < b);
  const k = lens ? lensMask(d) / mean : 1;
  return [bin[0] * k, bin[1] * k, bin[2] * k];
}

/** The lens mask's mean along a half (for the shader's normalisation) */
export function lensMean(r: number): number {
  const offsets = fixtureOffsets();
  const half = FLOODLIGHT.halves[0];
  let sum = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const az = half[0] + ((half[1] - half[0]) * (i + 0.5)) / n;
    const d = Math.min(...offsets.map((o) => Math.abs(az - (FLOODLIGHT.centre + o)))) * (Math.PI / 180) * r;
    sum += lensMask(d);
  }
  return sum / n;
}

function floodlightMaterial(r: number): ShaderMaterial {
  const F = FLOODLIGHT;
  const offsets = fixtureOffsets();
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 profile[16];
      uniform float offsets[${String(offsets.length)}];
      uniform float lensMean;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        float v = vUv.y;
        if (v < 0.25 || v >= 0.75) { gl_FragColor = vec4(vec3(0.1, 0.09, 0.07), 1.0); return; }
        vec3 e = profile[int(clamp(floor((v - 0.25) * 32.0), 0.0, 15.0))];
        bool lens = (v >= ${F.lens.rows[0][0]} && v < ${F.lens.rows[0][1]}) || (v >= ${F.lens.rows[1][0]} && v < ${F.lens.rows[1][1]});
        if (lens) {
          // (the nearest fixture, along the bank in uu; the game's az of this point, both halves mirrored)
          float az = degrees(atan(abs(vWorld.z), vWorld.x));
          float best = 1e9;
          for (int i = 0; i < ${String(offsets.length)}; i++) {
            best = min(best, abs(az - (${F.centre.toFixed(1)} + offsets[i])));
            best = min(best, abs(az - (${F.centre.toFixed(1)} - offsets[i])));
          }
          float d = radians(best) * ${r.toFixed(1)};
          e *= clamp((${F.lens.none.toFixed(1)} - d) / ${(F.lens.none - F.lens.full).toFixed(1)}, 0.0, 1.0) / lensMean;
        }
        // (and the bank's own face, lightmapped: its total from the capture point 0.1 over the emissive mean)
        gl_FragColor = vec4(e + vec3(0.1, 0.09, 0.07), 1.0);
        #include <colorspace_fragment>
      }`,
    uniforms: {
      profile: { value: F.profile.map((c) => new Vector3(c[0], c[1], c[2])) },
      offsets: { value: offsets },
      lensMean: { value: lensMean(r) },
    },
    side: DoubleSide,
  });
}

/** The bowl and its structures */
export function buildBowl(primary0: Color, primary1: Color): Group {
  const group = new Group();
  group.name = "stadium bowl";
  const add = (geometry: BufferGeometry, material: ShaderMaterial, name: string): void => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    group.add(mesh);
  };
  const { lower, upper, concourse, backR, parapet, upperParapet, fascia, seat } = STANDS;
  const seats = (): ShaderMaterial => seenMaterial(BOWL_COLOURS.seats);
  const concrete = (): ShaderMaterial => seenMaterial(BOWL_COLOURS.concrete);
  const fixed = (points: readonly RZ[]) => (): readonly RZ[] => points;
  const tread = (tier: Tier): number => (tier.last[1] - seat);
  const back = (tier: Tier): number => tier.last[0] + (tier.last[0] - tier.first[0]) / Math.max(tier.rows - 1, 1) / 2;
  // The lower bowl: the front wall up to its TV strip, the front rows, the walkway, the main rake, the back wall
  const L = lower;
  const lowerTop = tread(L.main) + parapet;
  const az0 = L.az[0];
  const az1 = L.az[1];
  // (from the front rows' start, az 42: before it, at the +X ends, the stands begin further out with the main rake's
  // first seated row, a wall up to it: RV-123's cut, the surfaces too)
  const frontFrom = STANDS.seating.frontAz[0][0];
  add(sweep(frontFrom, az1, 66, fixed([[L.innerR, 0], [L.strip.r, L.strip.z[0]]])), concrete(), "bowl: front wall");
  // (the strips over their extents, plain concrete between: RV-135)
  const stripSpan = (spans: readonly (readonly [number, number])[], from: number, to: number, section: readonly RZ[], name: string): void => {
    let at = from;
    for (const [a, b] of spans) {
      if (a > at) add(sweep(at, a, Math.max(2, Math.round(a - at)), fixed(section)), concrete(), `${name} (between)`);
      add(sweep(a, b, Math.max(2, Math.round(b - a)), fixed(section)), stripMaterial(), name);
      at = b;
    }
    if (to > at) add(sweep(at, to, Math.max(2, Math.round(to - at)), fixed(section)), concrete(), `${name} (between)`);
  };
  stripSpan(L.strip.az, frontFrom, az1, [[L.strip.r, L.strip.z[0]], [L.strip.r, L.strip.z[1]]], "bowl: lower strip");
  const backFrom = L.backAz.from;
  add(sweep(frontFrom, backFrom, 54, fixed(stepTo([[L.strip.r, L.strip.z[1]]], stepTo(treads(L.front), treads(L.main))))), seats(), "bowl: lower tiers");
  // (a section's rows at az, padded at its far end: the same count of points at every az)
  const padded = (pts: readonly RZ[], count: number, atStart = false): RZ[] => {
    const fill = Array.from({ length: Math.max(count - pts.length, 0) }, (): RZ => (atStart ? (pts[0] ?? [0, 0]) : (pts.at(-1) ?? [0, 0])));
    return atStart ? [...fill, ...pts] : [...pts, ...fill];
  };
  // The -X end: one rake from just behind the front wall, no walkway, tapering toward the plaza
  add(sweep(backFrom, az1, 18, (az) => {
    const all = treads(L.back);
    return padded(stepTo([[L.strip.r, L.strip.z[1]]], all.slice(0, 2 * rowsAt("back", az)[1])), all.length + 2);
  }), seats(), "bowl: lower tiers, -X end");
  const mainPitch = (L.main.last[0] - L.main.first[0]) / (L.main.rows - 1);
  const plusXStart = (az: number): RZ => {
    const first = rowsAt("main", az)[0];
    const row = tierRows(L.main)[first] ?? L.main.first;
    return [row[0] - mainPitch / 2, row[1] - seat];
  };
  add(sweep(az0, frontFrom, 15, (az) => {
    const all = treads(L.main);
    const rows = all.slice(2 * rowsAt("main", az)[0]);
    const foot: RZ = [plusXStart(az)[0], 0];
    // (padded at the foot: the same count of points at every az)
    return [...Array.from({ length: all.length - rows.length }, () => foot), foot, ...rows];
  }), seats(), "bowl: lower tiers, +X ends");
  add(sweep(az0, az1, 72, fixed([[back(L.main), tread(L.main)], [back(L.main), lowerTop], [backR, lowerTop], [backR, 0]])), concrete(), "bowl: lower back");
  // The -X corner's wedge behind the rakes: its rows present at az (the outermost first), a riser down at its front,
  // its parapet, its back down to the concourse
  const wedgeTop = tread(L.wedge) + parapet;
  add(sweep(L.wedgeAz.from, L.wedgeAz.to, 27, (az) => {
    const all = treads(L.wedge);
    const rows = all.slice(2 * rowsAt("wedge", az)[0]);
    const first = rows[0] ?? [back(L.wedge), tread(L.wedge)];
    return padded([[first[0], first[1] - 600], ...rows, [back(L.wedge), wedgeTop], [back(L.wedge), concourse.z]], all.length + 3, true);
  }), seats(), "bowl: corner wedge");
  // The upper tiers: the mid tier's TV strip, its two sections, its underside back to the lower bowl's back; the top tier
  // over it (its fascia, rows, parapet; its underside along its rake)
  const U = upper;
  const midTop = tread(U.midBack) + upperParapet;
  const topPitch = (U.top.last[0] - U.top.first[0]) / (U.top.rows - 1);
  const topFront = U.top.first[0] - topPitch / 2;
  const topLow = U.top.first[1] - seat - fascia;
  // (the top tier's rows at az: its last row's tread and back; the rest of its section padded on its last point)
  const topAt = (az: number): { rows: RZ[]; end: number; tread: number; top: number } => {
    const n = rowsAt("top", az)[1];
    const all = treads(U.top);
    const rows = all.slice(0, 2 * n);
    const last = rows.at(-1) ?? [topFront, topLow];
    while (rows.length < all.length) rows.push(last);
    return { rows, end: last[0], tread: last[1], top: last[1] + upperParapet };
  };
  const { topAz } = STANDS.seating;
  const u = (points: readonly RZ[], material: ShaderMaterial, name: string): void => {
    add(sweep(U.az[0], U.az[1], 32, fixed(points)), material, name);
  };
  stripSpan([U.strip.az], U.az[0], U.az[1], [[U.strip.r, U.strip.z[0]], [U.strip.r, U.strip.z[1]]], "bowl: mid strip");
  add(sweep(U.topStrip.az[0], U.topStrip.az[1], 29, fixed([[U.topStrip.r, U.topStrip.z[0]], [U.topStrip.r, U.topStrip.z[1]]])), stripMaterial(), "bowl: top strip");
  u([...stepTo([[U.strip.r, U.strip.z[1]]], stepTo(treads(U.mid), treads(U.midBack))), [back(U.midBack), midTop], [backR, midTop]], seats(), "bowl: mid tier");
  u([[U.strip.r, U.strip.z[0]], [backR, lowerTop]], concrete(), "bowl: mid underside");
  add(sweep(topAz[0], topAz[1], 43, (az) => {
    const t = topAt(az);
    return [[topFront, topLow], ...t.rows, [t.end, t.top], [backR, t.top]];
  }), seats(), "bowl: top tier");
  add(sweep(topAz[0], topAz[1], 43, (az) => {
    const t = topAt(az);
    return [[topFront, topLow], [t.end, t.tread - fascia], [t.end, t.tread]];
  }), concrete(), "bowl: top underside");
  // (the back wall up to the top tier's parapet where it is, the mid tier's elsewhere)
  add(sweep(U.az[0], U.az[1], 64, (az) => [[backR, lowerTop], [backR, rowsAt("top", az)[1] > 0 ? topAt(az).top : midTop]]), concrete(), "bowl: upper back");
  // The apron round the cage (its hole the cage's footprint: the field with its cut corners, the goals), out to the
  // stands' front wall, and the -X plaza's sidewalk
  const { apron, plaza: walk } = STANDS;
  const outline = new Shape();
  for (let k = 0; k <= 360; k++) {
    const az = k === 360 ? 0 : k;
    const at = Math.abs(az > 180 ? az - 360 : az);
    // (to the stands: their front wall, the +X ends' first seated row, 12k where there are none)
    const r = at < apron.openAz || at > apron.plazaAz ? apron.out : at < frontFrom ? plusXStart(at)[0] : L.innerR;
    const a = (az * Math.PI) / 180;
    if (k === 0) outline.moveTo(r * Math.cos(a), r * Math.sin(a));
    else outline.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  // (the cage's footprint, the game's frame: x, y; walked the other way round for a hole)
  const cage: [number, number][] = [[4096, 0], [4096, 3968], [2944, 5120], [900, 5120], [900, 6150], [-900, 6150], [-900, 5120], [-2944, 5120], [-4096, 3968]];
  const footprint = [...cage, ...cage.map(([x, y]): [number, number] => [-x, -y])];
  outline.holes.push(new Path(footprint.reverse().map(([x, y]) => new Vector2(x, y))));
  const apronGeometry = new ShapeGeometry(outline);
  // (the shape's x, y are the game's: laid flat, its y to Three's z)
  apronGeometry.rotateX(Math.PI / 2).translate(0, apron.z, 0);
  add(apronGeometry, concrete(), "bowl: apron");
  add(sweep(apron.plazaAz, 180, 6, fixed([[walk.from[0], 0], walk.from, walk.to, [concourse.r[0], walk.to[1]], [concourse.r[0], concourse.z]])), concrete(), "bowl: plaza");
  // The concourse and the outer wall (round the back, the stands' ends; low over the -X plaza, RV-124)
  const { plaza } = concourse;
  add(sweep(az0, 180, 76, (az) => {
    const f = Math.min(Math.max((az - plaza.az[0]) / (plaza.az[1] - plaza.az[0]), 0), 1);
    return [[concourse.r[0], concourse.z], [concourse.r[1], concourse.z], [concourse.r[1], concourse.wallTop + (plaza.wallTop - concourse.wallTop) * f]];
  }), seenMaterial(BOWL_COLOURS.sidewalk, 0.1), "bowl: concourse");
  // The roof's band (inner edge high, outer low), the canopy, the floodlight banks
  const { roof, canopy, lights } = STRUCTURES;
  add(sweep(roof.az[0], roof.az[1], 54, (az) => [
    [edgeAt(roof.rIn, az), edgeAt(roof.zHi, az)],
    [edgeAt(roof.rOut, az), Math.max(edgeAt(roof.zLo, az), roof.zMin)],
  ]), seenMaterial(BOWL_COLOURS.roof), "bowl: roof");
  const bright = (c: Color): [number, number, number] => fullBright([c.r, c.g, c.b]);
  add(sweep(canopy.az[0], canopy.az[1], 88, (az) => {
    const inner: RZ = [edgeAt(canopy.rIn, az), edgeAt(canopy.zHi, az)];
    // (over the end's centre only the top strip: blended over a few degrees at its sides)
    const { strip } = canopy;
    const inStrip = Math.min(Math.max(Math.min(az - strip.az[0], strip.az[1] - az) / strip.blend + 0.5, 0), 1);
    const full = canopy.outer;
    const short: RZ = [inner[0] + strip.depth, inner[1] - strip.drop];
    return [inner, [full[0] + (short[0] - full[0]) * inStrip, full[1] + (short[1] - full[1]) * inStrip]];
  }), canopyMaterial(bright(primary0), bright(primary1)), "bowl: canopy");
  // (the two halves of each end's bank, the fixtures' radius for their along-bank distances)
  const bankR = (edgeAt(lights.rIn, FLOODLIGHT.centre) + edgeAt(lights.rOut, FLOODLIGHT.centre)) / 2;
  const banks = floodlightMaterial(bankR);
  for (const [from, to] of FLOODLIGHT.halves) {
    add(sweep(from, to, 24, (az) => [
      [edgeAt(lights.rOut, az), edgeAt(lights.zLo, az)],
      [edgeAt(lights.rIn, az), edgeAt(lights.zHi, az)],
    ]), banks, "bowl: floodlights");
  }
  // The trusses: thin ribs from the ground up under the roof's inner edge (RV-128a)
  const sup = STRUCTURES.supports;
  const { foot, every, az: span, width } = sup;
  const ribs: number[] = [];
  const ribAz: number[] = [];
  for (let az: number = span[0]; az <= span[1]; az += every) ribAz.push(az);
  for (const az of ribAz) {
    const head = supportHead(az);
    for (const sign of [1, -1]) {
      const a = (sign * az * Math.PI) / 180;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      const [tx, tz] = [-s * (width / 2), c * (width / 2)];
      const p = (r: number, z: number, side: number): number[] => [r * c + tx * side, z, r * s + tz * side];
      ribs.push(...p(foot[0], foot[1], -1), ...p(foot[0], foot[1], 1), ...p(head[0], head[1], 1), ...p(foot[0], foot[1], -1), ...p(head[0], head[1], 1), ...p(head[0], head[1], -1));
    }
  }
  // (the ring on round over the plaza, from where the heads reach it: a band `width` tall)
  const { ring } = sup;
  for (let az = ring.to; az < 360 - ring.to; az += 2) {
    const [a0, a1] = [(az * Math.PI) / 180, (Math.min(az + 2, 360 - ring.to) * Math.PI) / 180];
    const p = (a: number, z: number): number[] => [ring.r * Math.cos(a), z, ring.r * Math.sin(a)];
    const [lo, hi] = [ring.z - width / 2, ring.z + width / 2];
    ribs.push(...p(a0, lo), ...p(a1, lo), ...p(a1, hi), ...p(a0, lo), ...p(a1, hi), ...p(a0, hi));
  }
  const ribGeometry = new BufferGeometry();
  ribGeometry.setAttribute("position", new Float32BufferAttribute(ribs, 3));
  add(ribGeometry, seenMaterial(BOWL_COLOURS.steel, 0.02), "bowl: supports");
  return group;
}

// --- The far layer: the skyline, the city's glow, the horizon's fog band (SUR-11, 22, 23) -----------------------------

/** The skyline (SkyScrapers_01 on the -Y side, _02 on the +Y side: az -176..-5 and 3..176 from the capture point, their
 *  tops up to el 51 and 65 degrees; most of them lower: SUR-34's city fraction 0.29 at el 20-25, 0.07 at 50-65), drawn on
 *  a layer just inside the sky's dome (the real towers are 57-200k out, past the camera's reach) with our own window
 *  grid at its mean (0.20, 0.17, 0.11). Below the horizon the city's warm glow, v (0.748, 0.574, 0.265) toward the rim;
 *  over the horizon FogCylinder's white band, alpha by elevation (SUR-23: 0.9 at 0, 0.73 at 7.5, 0.43 at 12.5, 0.19 at
 *  17.5, 0.06 at 22.5, none from 30) */
export const FAR_LAYER = {
  radius: 31600,
  skyline: { minusY: [-176, -5] as const, plusY: [3, 176] as const, maxEl: [51, 65] as const },
  windows: [0.2, 0.17, 0.11] as const,
  ground: [0.748, 0.574, 0.265] as const,
  fogBand: [[0, 0.9], [7.5, 0.73], [12.5, 0.43], [17.5, 0.19], [22.5, 0.06], [30, 0]] as readonly (readonly [number, number])[],
} as const;

const farVertex = /* glsl */ `
uniform vec3 from;
varying vec3 vDirection;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDirection = world.xyz - from;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** The city over the -X plaza (City_OOB_A, SUR-1, RV-154a): from az 180.5 (the -Y side of the gap: none over 177-180),
 *  its tops el 8 to 181.5, then 14.9 to 188.5 (the game's first open sky there: 8.6 at 181, about 15 at 182-188) */
export const PLAZA_CITY = { from: 180.5, step: 181.5, to: 188.5, low: 8, high: 14.9 } as const;

/** Its top at az (degrees, 0-360; none outside it: the shader's, for tests) */
export function plazaCityTop(az: number): number | null {
  const C = PLAZA_CITY;
  return az >= C.from && az < C.to ? (az < C.step ? C.low : C.high) : null;
}

const farFragment = /* glsl */ `
uniform vec3 windows;
uniform vec3 ground;
uniform float fogEl[6];
uniform float fogAlpha[6];
varying vec3 vDirection;
float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDirection);
  // (the game's az = atan2(y, x), el; Three's y is up, its z the game's y)
  float az = degrees(atan(d.z, d.x));
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  vec3 colour = vec3(0.0);
  float alpha = 0.0;
  // The skyline: towers 1-4 degrees wide; their tops mostly low, a few tall
  bool minusY = az >= -${(360 - PLAZA_CITY.to).toFixed(1)} && az <= -5.0;
  bool plusY = az >= 3.0 && az <= 176.0;
  // (and over the -X plaza, beyond the gap in the stands, City_OOB_A, by rule: plazaCityTop)
  float g = az < 0.0 ? az + 360.0 : az;
  bool plaza = g >= ${PLAZA_CITY.from.toFixed(1)} && g < ${PLAZA_CITY.to.toFixed(1)};
  if ((minusY || plusY || plaza) && el > -2.0) {
    float bin = floor(az / 2.5);
    float u = hash1(bin + (minusY ? 17.0 : 0.0));
    float top = plaza ? (g < ${PLAZA_CITY.step.toFixed(1)} ? ${PLAZA_CITY.low.toFixed(1)} : ${PLAZA_CITY.high.toFixed(1)}) : 10.0 + (minusY ? 41.0 : 55.0) * u * u * u;
    if (el < top) {
      // (windows: columns 0.18 degrees, rows 0.3; a third lit, warm)
      vec2 cell = vec2(floor(az / 0.18), floor(el / 0.3));
      float lit = step(0.66, hash2(cell));
      vec2 f = fract(vec2(az / 0.18, el / 0.3));
      float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.85);
      // (lit panes 0.12 of the face: their mean the windows' (0.20, 0.17, 0.11), RV-127c)
      colour = vec3(0.022, 0.02, 0.018) + lit * pane * windows * 7.3;
      alpha = 1.0;
    }
  }
  // Below the horizon: the city's glow toward the rim
  if (el < 0.0 && alpha < 1.0) {
    float v = 0.95 * exp(el / 1.5);
    float sparkle = step(0.97, hash2(floor(vec2(az * 3.0, el * 6.0)))) * (1.0 - v);
    colour = v * ground + sparkle * vec3(0.9, 0.7, 0.4);
    alpha = 1.0;
  }
  // The horizon's fog band over it all (white)
  float e = abs(el);
  float fog = 0.0;
  for (int i = 0; i < 5; i++) {
    if (e >= fogEl[i] && e < fogEl[i + 1]) fog = mix(fogAlpha[i], fogAlpha[i + 1], (e - fogEl[i]) / (fogEl[i + 1] - fogEl[i]));
  }
  // (the band's light: the game's horizon reads about 0.17 from the field, its white fogged and dim: SUR-35 mainview)
  colour = mix(colour, vec3(0.2, 0.19, 0.17), fog);
  alpha = max(alpha, fog);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}
`;

/** The far layer (drawn after the stands, behind them, over the sky's dome; centred on the field, inside the dome and the
 *  camera's far plane from anywhere in the arena) */
export function buildFarLayer(): Mesh {
  const L = FAR_LAYER;
  const material = new ShaderMaterial({
    vertexShader: farVertex,
    fragmentShader: farFragment,
    uniforms: {
      // (its elevations as seen from the capture point; Three's frame)
      from: { value: new Vector3(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y) },
      windows: { value: new Vector3(...L.windows) },
      ground: { value: new Vector3(...L.ground) },
      fogEl: { value: L.fogBand.map(([e]) => e) },
      fogAlpha: { value: L.fogBand.map(([, a]) => a) },
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(new SphereGeometry(L.radius, 96, 48), material);
  mesh.name = "far layer";
  mesh.renderOrder = -1;
  return mesh;
}
