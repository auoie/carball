// DFH Stadium's surroundings (notes/arena-surroundings.md, SUR-1..44): what's outside the cage. Built from the spec's
// numbers (placements, measures, formulas, statistics) and rules; nothing traced from the game's meshes, no game
// artwork (the user's rule: SUR-37..44's stand-ins). This part: the reflection capture's hotspots (SUR-33).
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  type Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { GRASS_CUBE_AT } from "../grassCube";
import { fullBright } from "../teamColors";
import { seededRandom } from "./random";

/** A glow seen from the capture point: its direction (az = atan2(y, x), el, degrees), its angular half sizes across and
 *  up (degrees), its distance (uu) */
export interface Hotspot {
  readonly az: number;
  readonly el: number;
  readonly radius: readonly [number, number];
  readonly distance: number;
}

/** CubeMap_HotSpot_Mat's glows (SUR-33: ten Circle_Sprites the game shows only to its cube capture), the ones our fog
 *  doesn't swallow (the +X horizon's at 150k, and HotSpot_Mat's at 490k, are fogged out in the game too): over the back
 *  (-X) two, over each end one, one each side of the open +X */
export const HOTSPOTS: readonly Hotspot[] = [
  { az: 180, el: 7, radius: [63, 63], distance: 25000 },
  { az: 180, el: 7, radius: [30, 30], distance: 37000 },
  { az: 107, el: 22, radius: [61, 27], distance: 14000 },
  { az: -108, el: 26, radius: [50, 50], distance: 15000 },
  { az: 35, el: 15, radius: [21, 21], distance: 15000 },
  { az: -35, el: 15, radius: [21, 21], distance: 15000 },
];
/** Their colour: 8 (0.533, 0.686, 0.725) (clamped by the capture's 8 bits); alpha sat(8 FillFlare.G) */
export const HOTSPOT_COLOR = [4.27, 5.49, 5.8] as const;
/** The team hotspots (additive, 8 FillFlare.G FB(team)): low over each goal, 8k out */
export const TEAM_HOTSPOTS: readonly (Hotspot & { readonly team: 0 | 1 })[] = [
  { team: 0, az: -90, el: 9, radius: [27, 27], distance: 8000 },
  { team: 1, az: 90, el: 8, radius: [24, 24], distance: 8000 },
];
/** FillFlare's G by radius r = 0, 0.1, ... 0.9 (a statistic: SUR-41; 0 beyond) */
export const FILL_FLARE_G = [1.0, 0.97, 0.91, 0.81, 0.67, 0.49, 0.31, 0.15, 0.04, 0.01];

const vertexShader = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 colour;
uniform float flare[10];
uniform bool additive;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float x = length(vUv - 0.5) * 20.0;
  int i = int(min(floor(x), 9.0));
  float g = x >= 10.0 ? 0.0 : mix(flare[i], i < 9 ? flare[i + 1] : 0.0, x - float(i));
  if (additive) gl_FragColor = vec4(8.0 * g * colour, 1.0);
  else gl_FragColor = vec4(colour, clamp(8.0 * g, 0.0, 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** A glow's sprite: a quad at `distance` from the capture point along (az, el), facing it, `radius` across and up */
function hotspotMesh(spot: Hotspot, colour: readonly [number, number, number], additive: boolean): Mesh {
  const rad = Math.PI / 180;
  const [az, el] = [spot.az * rad, spot.el * rad];
  const [ax, ay] = [spot.radius[0] * rad, spot.radius[1] * rad];
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), colour: { value: new Vector3(...colour) }, flare: { value: FILL_FLARE_G }, additive: { value: additive } },
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    side: DoubleSide,
    fog: true,
  });
  const mesh = new Mesh(new PlaneGeometry(2 * spot.distance * Math.tan(ax), 2 * spot.distance * Math.tan(ay)), material);
  // (the game's frame (x, y, z up) as Three's (x, z up, y))
  const centre = new Vector3(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y);
  const dir = new Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  mesh.position.copy(centre).addScaledVector(dir, spot.distance);
  mesh.lookAt(centre);
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
  /** a card's centre over its row's tread */
  seat: 80,
  /** a tier's parapet over its last tread; the upper tiers' front fascia under their first */
  parapet: 150,
  fascia: 350,
  /** The lower bowl (az 27-171): the front wall from the inner radius up to its TV strip (SUR-17's placement), the four
   *  front rows, the walkway and its step, the main rake, the back wall */
  lower: {
    az: [27, 171] as const,
    innerR: 11200,
    strip: { r: 12000, z: [512, 797] as const },
    front: { rows: 4, first: [12250, 948], last: [13000, 1119], growth: 1 } as Tier,
    main: { rows: 34, first: [13520, 1834], last: [21380, 3985], growth: 1.5 } as Tier,
  },
  /** The upper tiers over each end and the -X corner (az 76-139): the mid tier (its TV strip, SUR-3's placement; its
   *  front section and the back one behind a step), the top tier over it */
  upper: {
    az: [76, 139] as const,
    strip: { r: 14750, z: [3160, 3360] as const },
    mid: { rows: 12, first: [15250, 3710], last: [17470, 4965], growth: 1 } as Tier,
    midBack: { rows: 10, first: [18130, 5656], last: [20220, 6949], growth: 1 } as Tier,
    top: { rows: 21, first: [15415, 5958], last: [19116, 8975], growth: 1 } as Tier,
  },
  /** The back wall behind the stands, the concourse out to the outer wall (inside the camera's reach: 30k) */
  backR: 21500,
  concourse: { r: [21500, 30000] as const, z: 500, wallTop: 8000 },
} as const;

/** The structures over the stands: each edge a low-order fit in t = (az - 110) / 70 (coefficients from t^0 up), fitted
 *  to the per-azimuth statistics (each mesh's radius and height at its 1st and 99th percentiles every 10 degrees):
 *  rules with a few coefficients, not the tables (within 0.3k but the roof's outer edges, 0.5-1k) */
export const STRUCTURES = {
  /** Stadium_Top, the roof's band (SUR-5): its inner edge high, its outer low (the low edge no lower than 1.3k) */
  roof: {
    az: [45, 180] as const,
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
  /** The steel trusses (Stadium_Supports, SUR-7): from the ground at r 25.6k (z 1.4k) up to the roof at r 15.2k (z
   *  10.7k), every 10 degrees over the roof's span */
  supports: { foot: [25600, 1400] as RZ, head: [15200, 10700] as RZ, every: 10, az: [45, 175] as const, width: 160 },
} as const;

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
function seenMaterial(rgb: readonly [number, number, number], noise = 0.09): ShaderMaterial {
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
 *  turn along them, a generic emblem on the dark ones (ours: no ad artwork) */
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
        float cell = vUv.x * 120.0;
        float light = mod(floor(cell), 2.0) < 1.0 ? 0.8 : 0.07;
        vec2 q = vec2(fract(cell) - 0.5, vUv.y - 0.5);
        if (light < 0.5 && length(q * vec2(1.0, 2.0)) < 0.28) light = 0.8;
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

/** SUR-12: the floodlight banks, E = (1 - y)^2 tri 16 max((0.5, 0.483, 0.381) - y, 0) sat(2 (D + 1/32)), y = |2v - 1|,
 *  tri = 1 - |2 frac(5v) - 1|: three rows of bulbs (v 0.3, 0.5, 0.7; the middle's peak (8, 7.7, 6.1)); D our bulb
 *  cells (11 % bright, 0.04 between: SUR-41). Warm white, not team-coloured */
function floodlightMaterial(): ShaderMaterial {
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
        float y = abs(2.0 * vUv.y - 1.0);
        float tri = 1.0 - abs(2.0 * fract(5.0 * vUv.y) - 1.0);
        vec2 cell = fract(vec2(vUv.x * 160.0, vUv.y * 5.0)) - 0.5;
        float d = length(cell * vec2(1.0, 1.6)) < 0.19 ? 1.0 : 0.04;
        vec3 e = (1.0 - y) * (1.0 - y) * tri * 16.0 * max(vec3(0.5, 0.48274, 0.38116) - y, 0.0) * clamp(2.0 * (d + 1.0 / 32.0), 0.0, 1.0);
        // (and the bank's own face, lightmapped: its total from the capture point 0.1 over the emissive mean)
        gl_FragColor = vec4(e + vec3(0.1, 0.09, 0.07), 1.0);
        #include <colorspace_fragment>
      }`,
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
  const { lower, upper, concourse, backR, parapet, fascia, seat } = STANDS;
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
  add(sweep(az0, az1, 72, fixed([[L.innerR, 0], [L.strip.r, L.strip.z[0]]])), concrete(), "bowl: front wall");
  add(sweep(az0, az1, 72, fixed([[L.strip.r, L.strip.z[0]], [L.strip.r, L.strip.z[1]]])), stripMaterial(), "bowl: lower strip");
  add(sweep(az0, az1, 72, fixed(stepTo([[L.strip.r, L.strip.z[1]]], stepTo(treads(L.front), treads(L.main))))), seats(), "bowl: lower tiers");
  add(sweep(az0, az1, 72, fixed([[back(L.main), tread(L.main)], [back(L.main), lowerTop], [backR, lowerTop], [backR, 0]])), concrete(), "bowl: lower back");
  // The upper tiers: the mid tier's TV strip, its two sections, its underside back to the lower bowl's back; the top tier
  // over it (its fascia, rows, parapet; its underside along its rake)
  const U = upper;
  const midTop = tread(U.midBack) + parapet;
  const topEnd = back(U.top);
  const topFront = (U.top.first[0] - (back(U.top) - U.top.last[0]));
  const topLow = U.top.first[1] - seat - fascia;
  const topTop = tread(U.top) + parapet;
  const u = (points: readonly RZ[], material: ShaderMaterial, name: string): void => {
    add(sweep(U.az[0], U.az[1], 32, fixed(points)), material, name);
  };
  u([[U.strip.r, U.strip.z[0]], [U.strip.r, U.strip.z[1]]], stripMaterial(), "bowl: mid strip");
  u([...stepTo([[U.strip.r, U.strip.z[1]]], stepTo(treads(U.mid), treads(U.midBack))), [back(U.midBack), midTop], [backR, midTop]], seats(), "bowl: mid tier");
  u([[U.strip.r, U.strip.z[0]], [backR, lowerTop]], concrete(), "bowl: mid underside");
  u([[topFront, topLow], ...treads(U.top), [topEnd, topTop], [backR, topTop]], seats(), "bowl: top tier");
  u([[topFront, topLow], [topEnd, tread(U.top) - fascia], [topEnd, tread(U.top)]], concrete(), "bowl: top underside");
  u([[backR, lowerTop], [backR, topTop]], concrete(), "bowl: upper back");
  // The concourse and the outer wall (round the back, the stands' ends)
  add(sweep(az0, 180, 48, fixed([[concourse.r[0], concourse.z], [concourse.r[1], concourse.z], [concourse.r[1], concourse.wallTop]])), seenMaterial(BOWL_COLOURS.sidewalk, 0.1), "bowl: concourse");
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
  add(sweep(lights.az[0], lights.az[1], 30, (az) => [
    [edgeAt(lights.rOut, az), edgeAt(lights.zLo, az)],
    [edgeAt(lights.rIn, az), edgeAt(lights.zHi, az)],
  ]), floodlightMaterial(), "bowl: floodlights");
  // The trusses: thin ribs from the ground up to the roof
  const { foot, head, every, az: span, width } = STRUCTURES.supports;
  const ribs: number[] = [];
  for (let az: number = span[0]; az <= span[1]; az += every) {
    for (const sign of [1, -1]) {
      const a = (sign * az * Math.PI) / 180;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      const [tx, tz] = [-s * (width / 2), c * (width / 2)];
      const p = (r: number, z: number, side: number): number[] => [r * c + tx * side, z, r * s + tz * side];
      ribs.push(...p(foot[0], foot[1], -1), ...p(foot[0], foot[1], 1), ...p(head[0], head[1], 1), ...p(foot[0], foot[1], -1), ...p(head[0], head[1], 1), ...p(head[0], head[1], -1));
    }
  }
  const ribGeometry = new BufferGeometry();
  ribGeometry.setAttribute("position", new Float32BufferAttribute(ribs, 3));
  add(ribGeometry, seenMaterial(BOWL_COLOURS.steel, 0.02), "bowl: supports");
  return group;
}

// --- The crowd (SUR-26..31) ------------------------------------------------------------------------------------------

/** The cards: 126 x 146.8 uu, 144 apart along a row, facing the centre; rows on the tiers (card centres, r and z):
 *  the lower bowl's 4 front rows and its main rake (az 27-171), the upper tiers' (az 76-139). No gaps but the open +X
 *  (|az| < 27) and the back's plaza (beyond 171); an aisle every 12 degrees */
export const CROWD = {
  card: [126, 146.8] as const,
  pitch: 144,
  aisle: { every: 12, width: 1.2 },
  /** The stands' tiers the cards sit on (their rows: STANDS) */
  tiers: [
    { az: STANDS.lower.az, tier: STANDS.lower.front },
    { az: STANDS.lower.az, tier: STANDS.lower.main },
    { az: STANDS.upper.az, tier: STANDS.upper.mid },
    { az: STANDS.upper.az, tier: STANDS.upper.midBack },
    { az: STANDS.upper.az, tier: STANDS.upper.top },
  ],
  /** Baked light (a flat normal): 0.18 round most of the bowl, 0.48 on the +X ends (Crowd_03, az 27-72: sunlit) */
  light: { base: 0.18, sunlit: 0.48, sunlitAz: [27, 72] as const },
  /** CrowdSize (SUR-28, 29) and the bob (SUR-30: 48 Cheer, Cheer stuck at 0.25) */
  size: 1.25,
  bob: 12,
} as const;

/** The teams' secondaries (AV-2) */
const SECONDARY = [
  [0.5216, 0.8078, 0.902],
  [0.902, 0.2353, 0.098],
] as const;

const crowdVertex = /* glsl */ `
attribute vec3 card;
attribute vec3 seat; // (UV1.x, UV1.y, light)
uniform float time;
uniform float crowdSize;
uniform float bob;
varying vec2 vUv;
varying vec3 vCard;
varying vec2 vSeat;
varying float vTeam;
void main() {
  vUv = uv;
  vCard = card;
  vSeat = seat.yz;
  // (each card's instance matrix: its seat, facing the centre)
  vTeam = instanceMatrix[3].z < 0.0 ? 0.0 : 1.0;
  // Presence: x = 0.5 (lum + b - 0.5) + 0.35 UV1.y + CrowdSize - 1.375; the card sinks 128 where x < 1/32 (SUR-28)
  float lum = dot(card, vec3(0.3, 0.59, 0.11));
  float x = 0.5 * (lum + card.b - 0.5) + 0.35 * seat.y + crowdSize - 1.375;
  float sink = (1.0 - clamp(32.0 * x, 0.0, 1.0)) * 128.0;
  float bobbing = bob * sin(4.66943 * (time * (card.r + 0.5) + seat.x));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position.x, position.y + bobbing - sink, 0.0, 1.0);
}
`;

const crowdFragment = /* glsl */ `
uniform vec3 primary0;
uniform vec3 primary1;
uniform vec3 secondary0;
uniform vec3 secondary1;
uniform vec3 bright0;
uniform vec3 bright1;
uniform vec3 brightS0;
uniform vec3 brightS1;
uniform float crowdSize;
varying vec2 vUv;
varying vec3 vCard;
varying vec2 vSeat;
varying float vTeam;
void main() {
  // The ellipse (SUR-27): q = 2 uv - 1, |q|^2 <= 0.9; shaded as a sphere facing the sky
  vec2 q = 2.0 * vUv - 1.0;
  float q2 = dot(q, q);
  if (q2 > 0.9) discard;
  float nz = sqrt(max(0.0, 1.0 - 0.767 * q2));
  // The team rule (SUR-29)
  vec3 rgb = vCard;
  float p = clamp(32.0 * (0.912 * fract(2.19298 * (rgb.r + rgb.g)) + 0.35 * vSeat.x + crowdSize - 2.0), 0.0, 1.0);
  float m = clamp(32.0 * (rgb.g - 0.75), 0.0, 1.0);
  vec3 P = vTeam < 0.5 ? primary0 : primary1;
  vec3 S = vTeam < 0.5 ? secondary0 : secondary1;
  vec3 FP = vTeam < 0.5 ? bright0 : bright1;
  vec3 FS = vTeam < 0.5 ? brightS0 : brightS1;
  vec3 C = mix(mix(P, S, m), mix(FP, FS, m), rgb.b);
  vec3 team = clamp(8.0 * clamp(C, 0.0425, 1.0), 0.0, 2.0);
  vec3 neutral = 1.5 * (rgb + 0.25);
  vec3 albedo = clamp(mix(neutral, team, p), 0.0, 2.0) * vUv.y;
  // (baked light on the sphere normal, its directional lightmap lighting the top: 0.65 of the flat normal's on average,
  // so the discs' means come to SUR-31's, 0.15 round the bowl and 0.2-0.3 on the sunlit ends)
  gl_FragColor = vec4(albedo * vSeat.y * (0.3 + 0.5 * nz * nz), 1.0);
  #include <colorspace_fragment>
}
`;

/** The crowd: one instanced draw of every card; `update(seconds)` bobs them */
export function buildCrowd(primary0: Color, primary1: Color, seed = 7): { mesh: InstancedMesh; update(seconds: number): void } {
  const random = seededRandom(seed);
  const seatings: Matrix4[] = [];
  const cards: number[] = [];
  const seats: number[] = [];
  const { card, pitch, aisle, tiers, light } = CROWD;
  for (const { az: span, tier } of tiers) {
    for (const [r, z] of tierRows(tier)) {
      const step = (pitch / r) * (180 / Math.PI);
      for (const sign of [1, -1]) {
        for (let az = span[0] + step / 2; az < span[1]; az += step) {
          // (the aisles)
          if (az % aisle.every < aisle.width) continue;
          const a = (sign * az * Math.PI) / 180;
          // (Three's frame: x, z up, the game's y; the card's right along the row, its face toward the centre)
          seatings.push(new Matrix4().makeRotationY(-a - Math.PI / 2).setPosition(r * Math.cos(a), z, r * Math.sin(a)));
          cards.push(random(), random(), random());
          const sunlit = az >= light.sunlitAz[0] && az <= light.sunlitAz[1];
          // UV1: x 1.19 - az/144 (the phase), y 1.0986 - 1.0994e-4 z (the height ramp)
          seats.push(1.19 - (sign * az) / 144, 1.0986 - 1.0994e-4 * z, sunlit ? light.sunlit : light.base);
        }
      }
    }
  }
  const geometry = new PlaneGeometry(card[0], card[1]);
  geometry.setAttribute("card", new InstancedBufferAttribute(new Float32Array(cards), 3));
  geometry.setAttribute("seat", new InstancedBufferAttribute(new Float32Array(seats), 3));
  const v3 = (c: readonly number[]): Vector3 => new Vector3(c[0], c[1], c[2]);
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: crowdVertex,
    fragmentShader: crowdFragment,
    uniforms: {
      time,
      crowdSize: { value: CROWD.size },
      bob: { value: CROWD.bob },
      primary0: { value: primary0 },
      primary1: { value: primary1 },
      secondary0: { value: v3(SECONDARY[0]) },
      secondary1: { value: v3(SECONDARY[1]) },
      bright0: { value: v3(fullBright([primary0.r, primary0.g, primary0.b])) },
      bright1: { value: v3(fullBright([primary1.r, primary1.g, primary1.b])) },
      brightS0: { value: v3(fullBright(SECONDARY[0])) },
      brightS1: { value: v3(fullBright(SECONDARY[1])) },
    },
    side: DoubleSide,
  });
  const mesh = new InstancedMesh(geometry, material, seatings.length);
  seatings.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
  });
  mesh.name = "crowd";
  // (the bob above each card's seat)
  mesh.userData["reach"] = CROWD.bob;
  // (all round the camera)
  mesh.frustumCulled = false;
  return {
    mesh,
    update: (seconds: number) => {
      time.value = seconds;
    },
  };
}

// --- Screens, ads, the near-field props (SUR-9, 10, 13, 17..19) -----------------------------------------------------

/** A panel's placement (game frame): its centre, size (uu), and tilt down (degrees); it faces the arena's centre */
interface Panel {
  readonly at: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly tilt?: number;
}

export const PANELS = {
  /** The big screens (Scoreboard_MIC): low over the back, high over the ends */
  screens: [
    { at: [-21851, 5448, 3670], size: [2279, 1152] },
    { at: [-21851, -5448, 3670], size: [2279, 1152] },
    { at: [-5765, 17700, 10260], size: [3038, 1536], tilt: 34 },
    { at: [-5765, -17700, 10260], size: [3038, 1536], tilt: 34 },
  ] as readonly Panel[],
  /** The ads (2x1 and 4x1: the offline default, a dark panel and a small emblem: SUR-18) */
  ads: [
    { at: [18453, 13440, 6900], size: [5697, 2880] },
    { at: [18453, -13440, 6900], size: [5317, 2688] },
  ] as readonly Panel[],
  billboards: [
    { at: [12160, 19300, 5040], size: [2560, 640] },
    { at: [12160, -19300, 5040], size: [2560, 640] },
    { at: [-20600, 8600, 5104], size: [2560, 640] },
    { at: [-20600, -8600, 5104], size: [2560, 640] },
  ] as readonly Panel[],
} as const;

/** The near-field props (SUR-10): banner scaffolds (273 x 273 x 1049) behind the goals and beside the side walls,
 *  corner flags (2000 x 790, z 360 up) and the corners' arrow arrays (z 384-512) */
export const PROPS = {
  scaffolds: [[2048, 6144], [-2048, 6144], [2048, -6144], [-2048, -6144], [4736, 1024], [-4736, 1024], [4736, -1024], [-4736, -1024]] as readonly (readonly [number, number])[],
  scaffold: [273, 1049] as const,
  flags: [[3450, 4850], [-3450, 4850], [3450, -4850], [-3450, -4850]] as readonly (readonly [number, number])[],
  flag: { size: [2000, 790] as const, z: 360 },
  arrows: [[3312, 4352], [-3312, 4352], [3312, -4352], [-3312, -4352]] as readonly (readonly [number, number])[],
  arrow: { z: [384, 512] as const, width: 600, behindWall: 5870 },
} as const;

const panelVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** SUR-17 and 18: D = 0.5 (1.1875 - (2v - 1)^4)(base + 0.35 noise), shown D (1 + L). A screen's base: lerp(0.125 + e C,
 *  logo) with C = 8/3 (FB + P) - 0.125 by the side and e = sat(32 (|2v - 1| - 0.75)) (team bars over the top and
 *  bottom eighths), our emblem (14 % of it, (0.67, 0.76, 0.85)); an ad's: 0.053 with a centred 0.59 emblem */
const panelFragment = /* glsl */ `
uniform bool screen;
uniform float emblem;
uniform vec3 primary0;
uniform vec3 primary1;
uniform vec3 bright0;
uniform vec3 bright1;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float v = 2.0 * vUv.y - 1.0;
  vec3 base;
  if (screen) {
    float t = clamp(vWorld.z / 256.0 + 0.5, 0.0, 1.0);
    vec3 C = (8.0 / 3.0) * (mix(bright0, bright1, t) + mix(primary0, primary1, t)) - 0.125;
    float e = clamp(32.0 * (abs(v) - 0.75), 0.0, 1.0);
    // (our emblem: a ring and a bar across it, in uv 0.09-0.93 x 0.35-0.65)
    vec2 q = (vUv - vec2(0.51, 0.5)) / vec2(0.42, 0.15);
    float ring = abs(length(q * vec2(2.8, 1.0)) - 0.75) < 0.16 ? 1.0 : 0.0;
    float bar = abs(q.y) < 0.12 && abs(q.x) < 0.9 ? 1.0 : 0.0;
    float logo = max(ring, bar);
    base = mix(vec3(0.125) + e * C, vec3(0.67, 0.76, 0.85), logo);
  } else {
    vec2 q = (vUv - 0.5) * vec2(2.0, 1.0);
    base = vec3(length(q) < emblem ? 0.59 : 0.053);
  }
  vec3 d = 0.5 * (1.1875 - v * v * v * v) * (base + 0.35 * 0.225);
  gl_FragColor = vec4(d * 2.2, 1.0);
  #include <colorspace_fragment>
}
`;

/** SUR-19: the scaffolds' banners (Basic_Orange_Mat), the team's colour, T = P + (FB - P)/16, doubled and clamped at 1.5
 *  (blue (0.29, 1.03, 1.5), orange (1.5, 0.9, 0.27)); the corner flags the team's with a light stripe (SUR-43's stand-in;
 *  the game's flag art can't ship); the arrows pulse once a second */
const propFragment = /* glsl */ `
uniform vec3 colour;
uniform float pulse;
uniform bool stripe;
uniform float time;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float glow = pulse > 0.0 ? 0.5 * (1.0 + sin(6.2831853 * (time + pulse))) : 1.0;
  // (an arrow's chevrons along it)
  if (pulse > 0.0 && abs(fract(vUv.x * 4.0 + abs(vUv.y - 0.5)) - 0.5) > 0.2) discard;
  vec3 c = colour;
  if (stripe) c = abs(vUv.y - 0.5) < 0.12 ? vec3(0.85, 0.85, 0.8) : 0.6 * colour;
  gl_FragColor = vec4(c * glow, 1.0);
  #include <colorspace_fragment>
}
`;

/** A panel facing the arena's centre (its normal level, tilted down by `tilt`) */
function panelMesh(panel: Panel, material: ShaderMaterial): Mesh {
  const mesh = new Mesh(new PlaneGeometry(panel.size[0], panel.size[1]), material);
  const [x, y, z] = panel.at;
  // (Three's frame: x, z up, the game's y)
  mesh.position.set(x, z, y);
  mesh.lookAt(0, z, 0);
  if (panel.tilt) mesh.rotateX((-panel.tilt * Math.PI) / 180);
  return mesh;
}

/** The screens, ads, billboards and near-field props; `update(seconds)` pulses the arrows */
export function buildScreensAndProps(primary0: Color, primary1: Color): { group: Group; update(seconds: number): void } {
  const group = new Group();
  group.name = "stadium screens and props";
  const b = (c: Color): Vector3 => new Vector3(...fullBright([c.r, c.g, c.b]));
  const panelMaterial = (screen: boolean, emblem: number): ShaderMaterial =>
    new ShaderMaterial({
      vertexShader: panelVertex,
      fragmentShader: panelFragment,
      uniforms: {
        screen: { value: screen },
        emblem: { value: emblem },
        primary0: { value: primary0 },
        primary1: { value: primary1 },
        bright0: { value: b(primary0) },
        bright1: { value: b(primary1) },
      },
      side: DoubleSide,
    });
  const screenMaterial = panelMaterial(true, 0);
  // (the emblems' radii for 11 % of a 2x1 ad and 21 % of a 4x1 billboard, in the panel's half-width units)
  const adMaterial = panelMaterial(false, Math.sqrt((0.11 * 2) / Math.PI));
  const billboardMaterial = panelMaterial(false, Math.sqrt((0.21 * 2) / Math.PI));
  for (const s of PANELS.screens) group.add(panelMesh(s, screenMaterial));
  for (const a of PANELS.ads) group.add(panelMesh(a, adMaterial));
  for (const bb of PANELS.billboards) group.add(panelMesh(bb, billboardMaterial));
  // The props: team-coloured by side (y < 0 blue)
  const time = { value: 0 };
  const teamColour = (c: Color): Vector3 => {
    const f = b(c);
    const t = [c.r + (f.x - c.r) / 16, c.g + (f.y - c.g) / 16, c.b + (f.z - c.b) / 16];
    return new Vector3(...t.map((v) => Math.min(1.5, 2 * v)));
  };
  const propMaterial = (colour: Vector3, pulse = 0, stripe = false): ShaderMaterial =>
    new ShaderMaterial({
      vertexShader: panelVertex,
      fragmentShader: propFragment,
      uniforms: { colour: { value: colour }, pulse: { value: pulse }, stripe: { value: stripe }, time },
      side: DoubleSide,
    });
  const metal = seenMaterial(BOWL_COLOURS.steel, 0.02);
  const [w, h] = PROPS.scaffold;
  PROPS.scaffolds.forEach(([x, y]) => {
    const tower = new Mesh(new BoxGeometry(w, h, w), metal);
    tower.position.set(x, h / 2, y);
    const banner = new Mesh(new PlaneGeometry(w * 0.9, h * 0.6), propMaterial(teamColour(y < 0 ? primary0 : primary1)));
    banner.position.set(x, h * 0.55, y - Math.sign(y) * (w / 2 + 2));
    banner.lookAt(0, h * 0.55, 0);
    group.add(tower, banner);
  });
  PROPS.flags.forEach(([x, y]) => {
    const flag = new Mesh(new PlaneGeometry(PROPS.flag.size[0], PROPS.flag.size[1]), propMaterial(teamColour(y < 0 ? primary0 : primary1), 0, true));
    flag.position.set(x, PROPS.flag.z + PROPS.flag.size[1] / 2, y);
    flag.lookAt(0, PROPS.flag.z + PROPS.flag.size[1] / 2, 0);
    group.add(flag);
  });
  PROPS.arrows.forEach(([x, y], k) => {
    const [z0, z1] = PROPS.arrow.z;
    const arrow = new Mesh(new PlaneGeometry(PROPS.arrow.width, z1 - z0), propMaterial(new Vector3(1.2, 1.1, 0.8), 0.25 * k + 0.001));
    // (behind the corner's wall: the placement's point falls inside our wall's line, 5748 out along it; 5870 clears
    // the corner's cut, |x| + |y| = 8064, by 150)
    const r = Math.max(Math.hypot(x, y), PROPS.arrow.behindWall);
    const a = Math.atan2(y, x);
    arrow.position.set(r * Math.cos(a), (z0 + z1) / 2, r * Math.sin(a));
    // (along the corner's cut, facing in)
    arrow.lookAt(arrow.position.x - Math.sign(x), arrow.position.y, arrow.position.z - Math.sign(y));
    group.add(arrow);
  });
  return {
    group,
    update: (seconds) => {
      time.value = seconds;
    },
  };
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
  bool minusY = az >= -176.0 && az <= -5.0;
  bool plusY = az >= 3.0 && az <= 176.0;
  if ((minusY || plusY) && el > -2.0) {
    float bin = floor(az / 2.5);
    float u = hash1(bin + (minusY ? 17.0 : 0.0));
    float top = 10.0 + (minusY ? 41.0 : 55.0) * u * u * u;
    if (el < top) {
      // (windows: columns 0.18 degrees, rows 0.3; a third lit, warm)
      vec2 cell = vec2(floor(az / 0.18), floor(el / 0.3));
      float lit = step(0.66, hash2(cell));
      vec2 f = fract(vec2(az / 0.18, el / 0.3));
      float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.85);
      colour = vec3(0.022, 0.02, 0.018) + lit * pane * windows * 5.2;
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
