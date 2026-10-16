// Boost pads (notes/visual-timing.md VT-11a/b/c, VT-12/13: the static session's PB1, 2026-10-16) as the game draws
// them, three parts to a pad:
// - the base: the level's dark metal (its baked light, the arena's capture reflected), grey line markings and a faint
//   flickering orange underglow under its panels. A pickup never changes it: a taken pad is its base alone (the "dark
//   pad"). A big pad's a thin arched plate of three arms (raised panels, its tips on the floor, open beneath), a small
//   pad's a low rounded triangle, each generated from PB1's named measures;
// - the pickup FX's unlit glow: the inlays (big pads' translucent, bands moving inward; a small pad's centre added, a
//   ring expanding once a second) and the orange light curtains (a tube, and walls over the windows: a bright band just
//   above the surface fading upward through a rising noise). A pickup fades its Brightness 1 -> 0 over 0.1 s, a return
//   0 -> 1;
// - a big pad's orb: a masked glowing billboard at z 84 (no spin, bob or pulse), a core glow and a dark backing (seen
//   only from far off) behind it; the 640 x 512 halo is High world detail's alone: not drawn. Gone at once on a pickup,
//   back at once on the return.
// While a big pad is down it warms up (VT-13): cream copies of its curtains revealed top down and of its inlays by a wipe
// round each arm, the curtains brightening to 4x (1 + 3 EaseInCirc(n)), white puffs in its last second; small pads don't.
// Values and rules only: the game's gradients as named curves, its noise our own of the measured statistics, nothing
// traced or sampled. Where PB1 leaves a shape open, ours is marked (ours).
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  type Texture,
  UniformsLib,
  UniformsUtils,
} from "three";
import type { BoostPadState } from "../engine/world";
import { GRASS_CUBE_BLUR_LOD } from "./grassCube";
import { FIELD_LIGHT } from "./stadiumFieldRules";

/** Seconds a taken pad stays down (VehiclePickup RespawnDelay x RespawnDelayScale 1): the engine's pad cooldown. */
export const PAD_RESPAWN_SECONDS = { big: 10, small: 4 } as const;
/** The game's second warm-up stage starts this long before a pad is back (VehiclePickup_Boost_TA AlmostSpawnedTime) */
export const PAD_ALMOST_SPAWNED_SECONDS = 1;
/** A pad's FX Brightness fades out on a pickup and in on its return over this long (VT-12/13) */
export const PAD_FADE_SECONDS = 0.1;

/** A curve by its points (x ascending): linear between them, held past its ends */
export type Curve = readonly (readonly [number, number])[];

export function curveAt(points: Curve, x: number): number {
  const first = points[0];
  if (!first || x <= first[0]) return first?.[1] ?? 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
  }
  return points[points.length - 1]?.[1] ?? 0;
}

const glf = (v: number): string => v.toFixed(5);
const vec3Glsl = (v: readonly number[]): string => `vec3(${v.map(glf).join(", ")})`;

function curveGlsl(name: string, points: Curve): string {
  const lines = [`float ${name}(float x) {`];
  points.forEach((b, i) => {
    const a = points[i - 1];
    if (!a) lines.push(`  if (x <= ${glf(b[0])}) return ${glf(b[1])};`);
    else lines.push(`  if (x <= ${glf(b[0])}) return mix(${glf(a[1])}, ${glf(b[1])}, (x - ${glf(a[0])}) / ${glf(b[0] - a[0])});`);
  });
  lines.push(`  return ${glf(points[points.length - 1]?.[1] ?? 0)};`, "}");
  return lines.join("\n");
}

/** VT-11a/b's curves: the curtains' band S(v) (v 1 at the bottom, 0 at the top); the Fire gradient's channels (of
 *  frac x: the big inlays' band is sat(4 Fire_R), a small inlay reads all three; Fire_G's 0.5 at x 0 its wrap's
 *  filtering); the orb backing's falloff Gp(r) */
export const PAD_CURVES = {
  curtain: [[0, 0], [0.25, 0.01], [0.5, 0.08], [0.625, 0.17], [0.75, 0.33], [0.81, 0.62], [0.857, 1], [0.875, 0.73], [0.906, 0.38], [0.94, 0.13], [0.97, 0.03], [1, 0]],
  fireR: [[0, 0], [0.2, 0], [0.25, 0.003], [0.3, 0.029], [0.35, 0.11], [0.4, 0.27], [0.45, 0.5], [0.5, 0.75], [0.55, 0.95], [0.6, 1], [0.8, 1], [0.85, 0.965], [0.9, 0.78], [0.95, 0.29], [1, 0]],
  fireG: [[0, 0.5], [0.004, 0], [0.85, 0], [0.9, 0.0057], [0.95, 0.068], [0.96, 0.12], [0.97, 0.24], [0.98, 0.6], [0.99, 0.94], [0.996, 1], [1, 0.5]],
  fireB: [[0, 0], [0.5, 0.014], [0.55, 0.049], [0.6, 0.3], [0.62, 0.5], [0.64, 0.76], [0.65, 0.93], [0.66, 0.88], [0.68, 0.53], [0.7, 0.3], [0.75, 0.149], [0.8, 0.084], [0.85, 0.056], [0.9, 0.038], [0.95, 0.012], [1, 0]],
  backing: [[0, 1], [0.25, 0.93], [0.5, 0.71], [0.625, 0.55], [0.75, 0.34], [0.875, 0.08], [0.94, 0]],
} as const satisfies Record<string, Curve>;

const frac = (x: number): number => x - Math.floor(x);

/** The big inlays' band (VT-11a): sat(4 Fire_R(frac x)) */
export function padBand(x: number): number {
  return Math.min(1, 4 * curveAt(PAD_CURVES.fireR, frac(x)));
}

/** VT-11c's colours (linear, team-independent) */
export const PAD_COLOURS = {
  curtain: [1, 0.4714, 0.0468],
  bigInlay: [[0.5, 0.031, -0.25], [8, 6, 1]],
  smallInlay: { a: [1.32, 0.63, 0.075], b: [1, 0.779, 0.2], c: [1, 0.877, 0.553] },
  underglow: [1, 0.366, 0.0127],
  orb: { dark: [0.221, 0.0773, 0.0147], range: [0.5856, 0.3506, 0.0344] },
  coreGlow: [2.5, 1.25, 0.1875],
  cream: [1, 0.84, 0.75],
  gold: [1, 0.75, 0.25],
} as const;

/** The base's lighting: the pad floor's baked light (the field plan's pad bases, src/render/stadiumFieldRules.ts) */
const BASE_LIGHT = FIELD_LIGHT.hexPads.rgb[0] ?? [1, 1, 1];

// ---- Each pad's frame and arms ----

/** The arms' spacing: the shapes repeat every 120 degrees */
const SECTOR = (2 * Math.PI) / 3;
const deg = (d: number): number => (d * Math.PI) / 180;

/** An angle folded into its arm's sector: [-60, 60] degrees about the nearest arm (ours at 0 and +-120: the pad's yaw
 *  turns them a quarter further, PADS_TURN) */
function folded(theta: number): number {
  return theta - SECTOR * Math.round(theta / SECTOR);
}

/** A region of a pad's top in its arm's frame (each arm alike): every bound given holds. `r` from the centre (a lower
 *  bound of 0: none), `angle` (degrees) off the arm's axis, `across` (|lateral|), `taper` an across bound linear in
 *  `along` through two (along, half-width) points, `along` the axis, `planes` half-planes a along + b across + c >= 0 */
export interface PadRegion {
  readonly r?: readonly [number, number];
  readonly angle?: number;
  readonly across?: number;
  readonly taper?: readonly [readonly [number, number], readonly [number, number]];
  readonly along?: readonly [number, number];
  readonly planes?: readonly (readonly [number, number, number])[];
}

const taperAt = (taper: NonNullable<PadRegion["taper"]>, along: number): number => {
  const [[a0, h0], [a1, h1]] = taper;
  return h0 + ((h1 - h0) * (along - a0)) / (a1 - a0);
};

/** A point of the pad's own frame (ours: arms at 0 and +-120) in its arm's frame: (r, signed angle off the arm, along,
 *  |across|) */
function armFrame(x: number, y: number): readonly [number, number, number, number] {
  const r = Math.hypot(x, y);
  const t = folded(Math.atan2(y, x));
  return [r, t, r * Math.cos(t), Math.abs(r * Math.sin(t))];
}

/** How far inside a region a point of the pad's top is (uu; negative outside) */
export function regionMargin(region: PadRegion, x: number, y: number): number {
  const [r, t, along, across] = armFrame(x, y);
  let m = Infinity;
  if (region.r) {
    if (region.r[0] > 0) m = Math.min(m, r - region.r[0]);
    m = Math.min(m, region.r[1] - r);
  }
  if (region.angle !== undefined) m = Math.min(m, (deg(region.angle) - Math.abs(t)) * r);
  if (region.across !== undefined) m = Math.min(m, region.across - across);
  if (region.taper) m = Math.min(m, taperAt(region.taper, along) - across);
  if (region.along) m = Math.min(m, along - region.along[0], region.along[1] - along);
  for (const [a, b, c] of region.planes ?? []) m = Math.min(m, (a * along + b * across + c) / Math.hypot(a, b));
  return m;
}

/** GLSL: `padArm(p)` = armFrame above */
const ARM_GLSL = /* glsl */ `
vec4 padArm(vec2 p) {
  float r = length(p);
  float th = atan(p.y, p.x);
  float t = th - ${glf(SECTOR)} * floor(th / ${glf(SECTOR)} + 0.5);
  return vec4(r, t, r * cos(t), abs(r * sin(t)));
}`;

/** GLSL: `float name(vec4 arm)`, regionMargin above */
function regionGlsl(name: string, region: PadRegion): string {
  const terms: string[] = [];
  if (region.r) {
    if (region.r[0] > 0) terms.push(`a.x - ${glf(region.r[0])}`);
    terms.push(`${glf(region.r[1])} - a.x`);
  }
  if (region.angle !== undefined) terms.push(`(${glf(deg(region.angle))} - abs(a.y)) * a.x`);
  if (region.across !== undefined) terms.push(`${glf(region.across)} - a.w`);
  if (region.taper) {
    const [[a0, h0], [a1, h1]] = region.taper;
    terms.push(`${glf(h0)} + ${glf((h1 - h0) / (a1 - a0))} * (a.z - ${glf(a0)}) - a.w`);
  }
  if (region.along) terms.push(`a.z - ${glf(region.along[0])}`, `${glf(region.along[1])} - a.z`);
  for (const [a, b, c] of region.planes ?? []) {
    const n = Math.hypot(a, b);
    terms.push(`${glf(a / n)} * a.z + ${glf(b / n)} * a.w + ${glf(c / n)}`);
  }
  const body = terms.reduce((acc, t) => (acc === "" ? t : `min(${acc}, ${t})`), "");
  return `float ${name}(vec4 a) {\n  return ${body === "" ? "1e6" : body};\n}`;
}

// ---- The shapes (VT-11a/b) ----

/** A big pad's base (VT-11a): a thin plate, its top the body's height along the arm falling `slope` uu per uu across,
 *  its plateaus (the panels: the centre's ending short of its marking, the ring zone's top the body's from 22.5; the
 *  outer's spanning its measured top, 72.5-82.5) raised `rise` with a `chamfer`; vertical side walls down to the
 *  underside, flat across, arched along (its tips on the floor) */
interface PlateBase {
  readonly kind: "plate";
  readonly body: Curve;
  readonly slope: number;
  readonly plateaus: readonly PadRegion[];
  readonly rise: number;
  readonly chamfer: number;
  readonly underside: Curve;
}

/** A small pad's base (VT-11b): a low dome, its height by r, the sides falling `edge` uu per uu inward (ours) */
interface DomeBase {
  readonly kind: "dome";
  readonly height: Curve;
  readonly edge: number;
}

export interface PadShape {
  readonly big: boolean;
  /** The outline's radius at an angle (radians, the pad's own frame) */
  readonly radius: (theta: number) => number;
  readonly base: PlateBase | DomeBase;
  /** The metal's (G, k): diffuse = G (1 + 32 k env); body, lines, panels (the panels' k the body's: ours) */
  readonly surface: { readonly body: readonly [number, number]; readonly line: readonly [number, number]; readonly panel: readonly [number, number] };
  readonly lines: readonly PadRegion[];
  readonly panels: readonly PadRegion[];
  /** The underglow: where and its peak B (emissive B (0.25 + f) x the underglow colour); its flicker f a held value per
   *  `step` s, lerped: `base`, else with `chance` a spike from `lo` to `hi` (ours: of the measured statistics) */
  readonly glow: { readonly regions: readonly PadRegion[]; readonly peak: number };
  readonly flicker: { readonly base: number; readonly chance: number; readonly lo: number; readonly hi: number; readonly step: number };
  /** The inlays (their kind is their index here) and how far above the top they lie */
  readonly inlays: readonly PadRegion[];
  readonly inlayLift: number;
  /** The curtains' tube: its radius and height (bottom, top), its v at the bottom (0 at the top) */
  readonly tube: { readonly r: readonly [number, number]; readonly z: readonly [number, number]; readonly v: number };
  /** The curtains' walls, one per arm each: rising from a window's outline (`loop`) to `top`, the top `flare` uu out
   *  from the window's centre or along `topLoop`, the bottom at `bottom` (null: on the top), `v` there */
  readonly walls: readonly {
    readonly loop: PadRegion;
    readonly topLoop?: PadRegion;
    readonly top: number;
    readonly flare: number;
    readonly bottom: number | null;
    readonly v: number;
  }[];
}

/** A big pad's plan (VT-11a's named measures; the sampled outline stays local): the tip an arc at r 89.7 over +-10
 *  degrees of the arm's axis; the arm's half-width along it (y), narrowing to a waist at 60-65 and rounding off to the
 *  tip; between the arms a smooth concave curve (ours: a cubic, leaving the arm's side at y 30 and square to the
 *  bisector there) reaching r 36.0 on the bisector */
export const BIG_PLAN = {
  tip: 89.7,
  tipHalf: 10,
  halfWidth: [[30, 25.6], [60, 20.4], [65, 20.4], [80, 21.9], [85, 18.4], [88, 15.4]],
  notch: 36,
} as const satisfies { halfWidth: Curve; [key: string]: unknown };

/** A polar outline (ours: arms at 0 and +-120) from points of one arm's half (along, across >= 0) out to its bisector,
 *  mirrored and repeated: its radius by angle, linear between the points */
function polarOutline(half: readonly (readonly [number, number])[]): (theta: number) => number {
  const points = [...half.map(([a, c]) => [Math.atan2(c, a), Math.hypot(a, c)] as const)].sort((p, q) => p[0] - q[0]);
  return (theta) => curveAt(points, Math.abs(folded(theta)));
}

function bigHalf(): [number, number][] {
  const { tip, tipHalf, halfWidth, notch } = BIG_PLAN;
  const out: [number, number][] = [];
  const end = halfWidth[halfWidth.length - 1] ?? [88, 15.4];
  const tipEnd = Math.min(deg(tipHalf), Math.atan2(end[1], end[0]));
  for (let i = 0; i <= 12; i++) out.push([tip * Math.cos((tipEnd * i) / 12), tip * Math.sin((tipEnd * i) / 12)]);
  const start = halfWidth[0];
  for (let y = end[0]; y >= start[0]; y -= 0.5) out.push([y, curveAt(halfWidth, y)]);
  // (between the arms: a cubic from the side's end, along it, to the bisector at r `notch`, square to it)
  const next = halfWidth[1];
  const side = (next[1] - start[1]) / (next[0] - start[0]);
  const [p0, p1] = [start, [notch * Math.cos(Math.PI / 3), notch * Math.sin(Math.PI / 3)] as const];
  const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const n0 = Math.hypot(1, side);
  const [t0, t1] = [[-chord / n0, (side * chord) / n0], [-chord * Math.sin(Math.PI / 3), chord * Math.cos(Math.PI / 3)]];
  for (let i = 1; i <= 24; i++) {
    const s = i / 24;
    const [h00, h10, h01, h11] = [2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2];
    out.push([0, 1].map((k) => h00 * (p0[k] ?? 0) + h10 * (t0[k] ?? 0) + h01 * (p1[k] ?? 0) + h11 * (t1[k] ?? 0)) as [number, number]);
  }
  return out;
}

/** VT-11b: lobes on 0 and +-120 degrees, an outer arc of r 48.3 over +-30, notches to r 36.1 on the bisectors (the
 *  notches' curve ours: a half cosine) */
const SMALL_OUTLINE = { lobe: 48.3, lobeHalf: 30, notch: 36.1 } as const;

function smallRadius(theta: number): number {
  const { lobe, lobeHalf, notch } = SMALL_OUTLINE;
  const t = Math.abs(folded(theta));
  if (t <= deg(lobeHalf)) return lobe;
  const f = (t - deg(lobeHalf)) / (Math.PI / 3 - deg(lobeHalf));
  return notch + ((lobe - notch) * (1 + Math.cos(Math.PI * f))) / 2;
}

/** VT-11a's chevrons: filled wedges on the bisectors pointing at the centre, their sides 37 degrees off the bisector,
 *  9.1 to a side at r 30.25 (from the ring line out to the plan's edge): the half-plane of one side, in the arm frame */
function chevronPlane(): readonly [number, number, number] {
  const [angle, half, at] = [deg(37), 9.1, 30.25];
  // across the bisector b = h + (along the bisector - at) tan(angle); the bisector's frame from the arm's: 60 degrees on
  const [c, s] = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)];
  const k = Math.tan(angle);
  return [k * c - s, k * s + c, half - at * k];
}

/** VT-11a's barbs: the arc line's ends flare into filled triangles out to the arm's side: from |x| 15.5, their lower
 *  edge falling 1.10 uu per uu from y 63.7, their upper rising 1.0 from y 66.6 at |x| 16.5 (arm frame: along = y) */
const BARB: PadRegion = { planes: [[0, 1, -15.5], [1, 1.1, -(63.7 + 1.1 * 15.5)], [-1, 1, 66.6 - 16.5]] };

/** The big pad's inner window (its plateau's half-width 12.25 at y 40, 9.4 at y 60, within 24 degrees) and outer
 *  (9.9 to a side, within 8) */
const BIG_INNER: PadRegion = { r: [34, 64], angle: 24, taper: [[40, 12.25], [60, 9.4]] };
const BIG_OUTER: PadRegion = { r: [70.5, 85], angle: 8, across: 9.9 };

export const BIG_PAD: PadShape = {
  big: true,
  radius: polarOutline(bigHalf()),
  base: {
    kind: "plate",
    // (the body along the arm's axis: VT-11a's top heights, less the rise on a plateau, and its wall tops plus the
    // cross-fall)
    body: [[0, 11.76], [20, 10.53], [22.5, 11.07], [32.5, 10.04], [40, 9.92], [60, 8.18], [65, 7.38], [70, 6.56], [80, 4.48], [85, 3.05], [87.5, 1.51], [89.5, 0]],
    slope: 0.03,
    plateaus: [{ r: [0, 22] }, BIG_INNER, { r: [71.5, 83.5], angle: 8, across: 9.9 }],
    rise: 1.3,
    chamfer: 1,
    underside: [[0, 7.6], [20, 7.6], [30, 7.4], [40, 6.98], [50, 6.26], [60, 5.29], [70, 3.9], [80, 1.56], [85, -0.36]],
  },
  surface: { body: [0.01, 1.12], line: [0.29, 0.127], panel: [0.028, 1.12] },
  lines: [{ r: [27, 30.25] }, { r: [30.25, 100], planes: [chevronPlane()] }, { r: [66, 69] }, BARB],
  panels: [{ r: [0, 23.5] }, BIG_INNER, BIG_OUTER],
  glow: { regions: [{ r: [0, 16.5] }, { r: [39, 58], angle: 24, taper: [[40, 11.25], [60, 8.4]] }, { r: [74, 81], angle: 6, across: 8.9 }], peak: 0.62 },
  flicker: { base: 0.006, chance: 0.09, lo: 0.006, hi: 0.36, step: 0.05 },
  inlays: [{ r: [0, 22.3] }, BIG_INNER, BIG_OUTER],
  inlayLift: 1.2,
  tube: { r: [21.1, 24.8], z: [11.4, 72], v: 0.93 },
  walls: [
    { loop: BIG_INNER, top: 40, flare: 3, bottom: null, v: 0.93 },
    { loop: BIG_OUTER, top: 31.5, flare: 5, bottom: null, v: 0.93 },
  ],
};

export const SMALL_PAD: PadShape = {
  big: false,
  radius: smallRadius,
  base: { kind: "dome", height: [[0, 6], [14, 5.2], [22, 4], [28, 3.6], [44, 3.6], [48, 0.1], [48.3, 0]], edge: 2 },
  surface: { body: [0.012, 1.12], line: [0.3, 0.127], panel: [0.032, 1.12] },
  lines: [{ r: [27.75, 30.75] }],
  panels: [{ r: [0, 23.5] }, { along: [34, 46], across: 14.7 }],
  glow: { regions: [{ r: [0, 19] }, { along: [35, 45], across: 13 }], peak: 0.49 },
  flicker: { base: 0.006, chance: 0.1, lo: 0.28, hi: 0.6, step: 0.05 },
  // (only the centre disc: the window inlays' own UVs mask them out, VT-11b)
  inlays: [{ r: [0, 22.5] }],
  inlayLift: 0.6,
  tube: { r: [21.2, 25.4], z: [3.6, 64.6], v: 1 },
  walls: [{ loop: { along: [36, 44], across: 12 }, topLoop: { along: [40, 47], across: 13.5 }, top: 33, flare: 0, bottom: 2.2, v: 1 }],
};

/** The outline as a closed polyline (game-local x, y), for a dome's falling sides */
const outlines = new Map<PadShape, Float64Array>();
function outline(shape: PadShape): Float64Array {
  let points = outlines.get(shape);
  if (!points) {
    const n = 720;
    points = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * i) / n;
      const r = shape.radius(th);
      points[2 * i] = r * Math.cos(th);
      points[2 * i + 1] = r * Math.sin(th);
    }
    outlines.set(shape, points);
  }
  return points;
}

function outlineDistance(shape: PadShape, x: number, y: number): number {
  const p = outline(shape);
  const n = p.length / 2;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = [p[2 * i] ?? 0, p[2 * i + 1] ?? 0];
    const j = (i + 1) % n;
    const [bx, by] = [p[2 * j] ?? 0, p[2 * j + 1] ?? 0];
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** The base's top (world z) at a point of the pad's own frame */
export function padTop(shape: PadShape, x: number, y: number): number {
  const { base } = shape;
  if (base.kind === "dome") return Math.max(0.1, Math.min(curveAt(base.height, Math.hypot(x, y)), base.edge * outlineDistance(shape, x, y)));
  const [, , along, across] = armFrame(x, y);
  const panel = Math.max(...base.plateaus.map((region) => regionMargin(region, x, y)));
  const raised = base.rise * Math.min(1, Math.max(0, panel / base.chamfer + 0.5));
  return Math.max(curveAt(base.underside, along) + 0.2, curveAt(base.body, along) - base.slope * across + raised);
}

/** The base's underside (a plate's; a dome sits on the floor) */
export function padUnder(shape: PadShape, x: number, y: number): number {
  return shape.base.kind === "plate" ? curveAt(shape.base.underside, armFrame(x, y)[2]) : 0;
}

// ---- Yaws (VT-11c) ----

/** A pad's yaw (degrees: its frame's x toward the game's (cos yaw, sin yaw), its first arm along its y), VT-11c's
 *  table */
export function padYaw(x: number, y: number, big: boolean): number {
  if (big) {
    if (Math.abs(y) < 8) return x > 0 ? -90 : 90;
    if (y > 0) return x > 0 ? -45 : 45;
    return x > 0 ? -15 : 15;
  }
  const exceptions = [
    [-1788, -2302, -45],
    [1788, -2302, 45],
    [0, -1024, 180],
    [1024, 0, -90],
    [-1024, 0, 90],
    [-1788, 2302, -135],
    [1788, 2302, 135],
    [0, 1024, 0],
  ] as const;
  for (const [px, py, yaw] of exceptions) if (Math.hypot(x - px, y - py) < 8) return yaw;
  return y < 0 ? 0 : 180;
}

/** Ours draw the first arm along x; the game's along its frame's y: a quarter turn more than its yaw */
export const PADS_TURN = 90;

/** The game direction a pad's first arm points (the instance's turn: yaw + PADS_TURN) */
export function padArmDirection(yaw: number): readonly [number, number] {
  return [Math.cos(deg(yaw + PADS_TURN)), Math.sin(deg(yaw + PADS_TURN))];
}

// ---- Hashing and noise (ours; the same in TypeScript and GLSL) ----

export function padHash(x: number, y: number): number {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const unit = (h: number): number => (h >>> 8) / 16777216;

/** Smooth value noise in [0, 1] on a unit lattice, periodic in x over `period` cells (0: not); q non-negative */
export function padNoise(qx: number, qy: number, period: number, seed: number): number {
  const [ix, iy] = [Math.floor(qx), Math.floor(qy)];
  const smooth = (w: number): number => w * w * (3 - 2 * w);
  const [wx, wy] = [smooth(qx - ix), smooth(qy - iy)];
  const wrap = (x: number): number => (period > 0 && x >= period ? x - period * Math.floor(x / period) : x);
  const at = (x: number, y: number): number => unit(padHash(wrap(x), (y ^ seed) >>> 0));
  const [a, b, c, d] = [at(ix, iy), at(ix + 1, iy), at(ix, iy + 1), at(ix + 1, iy + 1)];
  return a + (b - a) * wx + (c - a) * wy + (a - b - c + d) * wx * wy;
}

const HASH_GLSL = /* glsl */ `
uint padHash(uint x, uint y) {
  uint h = (x * 0x8da6b343u) ^ (y * 0xd8163841u);
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}
float padUnit(uint h) { return float(h >> 8u) / 16777216.0; }
int padWrap(int x, int period) { return period > 0 && x >= period ? x - period * (x / period) : x; }
float padNoise(vec2 q, float period, uint seed) {
  vec2 i = floor(q);
  vec2 w = q - i;
  w = w * w * (3.0 - 2.0 * w);
  int p = int(period + 0.5);
  int x0 = padWrap(int(i.x), p);
  int x1 = padWrap(int(i.x) + 1, p);
  uint y0 = uint(int(i.y)) ^ seed;
  uint y1 = uint(int(i.y) + 1) ^ seed;
  float a = padUnit(padHash(uint(x0), y0));
  float b = padUnit(padHash(uint(x1), y0));
  float c = padUnit(padHash(uint(x0), y1));
  float d = padUnit(padHash(uint(x1), y1));
  return a + (b - a) * w.x + (c - a) * w.y + (a - b - c + d) * w.x * w.y;
}
float padReveal(float s, float n) {
  return smoothstep(0.0, 1.0, clamp(20.0 * (0.5 * n - 0.5 * s), 0.0, 1.0));
}`;

/** The curtains' noise (VT-11a): a smooth cloud of mean 0.075 and deviation 0.055, cells of 5 uu, rising 0.5 curtain
 *  heights a second, warped by 0.125 of itself. `raw` padNoise's own deviation (measured: the tests) */
export const CURTAIN_NOISE = { mean: 0.075, sd: 0.055, cell: 5, rise: 0.5, warp: 0.125, raw: 0.2121 } as const;

export function curtainNoise(around: number, period: number, height: number, seed: number): number {
  const w = padNoise(around, height + 37, period, seed);
  const raw = padNoise(around + CURTAIN_NOISE.warp * w, height + CURTAIN_NOISE.warp * w, period, seed);
  return CURTAIN_NOISE.mean + (CURTAIN_NOISE.sd * (raw - 0.5)) / CURTAIN_NOISE.raw;
}

/** A small pad's inlay (VT-11b), at (x, y) uu from its centre, `t` s: linear rgb x the mask and Brightness.
 *  p = (x, y) / 22.5, s = |p|^2 / 4; (a + gb + gc) C, C = A'.(A' rb + (1 + sin 2 pi t) gb B + gc Cc), rb = Fire_R Fire_B
 *  at frac(3s + t), gb = Fire_G + Fire_B at frac(3s - t), a = Fire_R + Fire_B at frac(3s - 1.75), gc = exp(-7.5 |p|^2) */
export function smallInlay(x: number, y: number, t: number): [number, number, number] {
  const q = (x * x + y * y) / (22.5 * 22.5);
  const s = q / 4;
  const { fireR, fireG, fireB } = PAD_CURVES;
  const [x1, x2, x3] = [frac(3 * s + t), frac(3 * s - t), frac(3 * s - 1.75)];
  const rb = curveAt(fireR, x1) * curveAt(fireB, x1);
  const gb = curveAt(fireG, x2) + curveAt(fireB, x2);
  const a = curveAt(fireR, x3) + curveAt(fireB, x3);
  const gc = Math.exp(-7.5 * q);
  const mask = Math.min(1, Math.max(0, 8 * (1 - q)));
  const pulse = 1 + Math.sin(2 * Math.PI * t);
  const { a: A, b: B, c: Cc } = PAD_COLOURS.smallInlay;
  const channel = (i: 0 | 1 | 2): number => mask * (a + gb + gc) * A[i] * (A[i] * rb + pulse * gb * B[i] + gc * Cc[i]);
  return [channel(0), channel(1), channel(2)];
}

// ---- Geometry ----

/** A game-local point (x, y, z up) in Three's frame (x, z, y) */
const three = (x: number, y: number, z: number): [number, number, number] => [x, z, y];
/** An arm-frame point (along, across) turned to arm `k` (k x 120 degrees, counter-clockwise from above) */
function turned(along: number, across: number, k: number): [number, number] {
  const [c, s] = [Math.cos(k * SECTOR), Math.sin(k * SECTOR)];
  return [along * c - across * s, along * s + across * c];
}

function geometry(positions: number[], index: number[], extra: Record<string, { readonly data: number[]; readonly size: number }> = {}): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  for (const [name, { data, size }] of Object.entries(extra)) g.setAttribute(name, new Float32BufferAttribute(data, size));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** How finely the pads are drawn (RX19-A: 550k triangles at first): a base's angular steps and rings (fractions of the
 *  outline's radius), the inlays' disc and window grids, the curtains' segments and wall points a side. Their markings,
 *  soft edges and glows are drawn per pixel: the meshes need only the shapes' and heights' detail */
export const PAD_TESSELLATION = {
  plate: { steps: 64, rings: [0.12, 0.25, 0.38, 0.5, 0.62, 0.72, 0.8, 0.88, 0.94, 1], under: [0.5, 1] },
  dome: { steps: 40, rings: [0.4, 0.75, 0.93, 1] },
  disc: { steps: 32, rings: [0.35, 0.7, 0.9, 1] },
  window: [6, 3] as const,
  tube: 16,
  wall: 3,
} as const;

/** The base, each vertex its part (0 the top, 1 a side wall, 2 the underside): a polar grid out to the outline (rings at
 *  fractions of its radius); a plate's side walls and underside. (Counter-clockwise from above in the game's frame is
 *  clockwise in Three's: each upward triangle's last two swapped) */
export function padBaseGeometry(shape: PadShape): BufferGeometry {
  const T = PAD_TESSELLATION;
  const steps = shape.base.kind === "plate" ? T.plate.steps : T.dome.steps;
  const positions: number[] = [];
  const parts: number[] = [];
  const index: number[] = [];
  const vertex = (x: number, y: number, z: number, part: number): number => {
    positions.push(...three(x, y, z));
    parts.push(part);
    return parts.length - 1;
  };
  const outlineAt = (j: number): [number, number, number] => {
    const th = (2 * Math.PI * j) / steps;
    return [th, Math.cos(th), Math.sin(th)];
  };
  /** A polar grid: `ring(th)` the radii out at each angle, `z` the height; facing up or down */
  const grid = (rings: (th: number) => number[], z: (x: number, y: number) => number, part: number, up: boolean): void => {
    const centre = vertex(0, 0, z(0, 0), part);
    const first = parts.length;
    let count = 0;
    for (let j = 0; j < steps; j++) {
      const [th, c, s] = outlineAt(j);
      const radii = rings(th);
      count = radii.length;
      for (const r of radii) vertex(r * c, r * s, z(r * c, r * s), part);
    }
    const at = (ring: number, j: number): number => first + (j % steps) * count + ring;
    const tri = (a: number, b: number, c: number): void => {
      if (up) index.push(a, c, b);
      else index.push(a, b, c);
    };
    for (let j = 0; j < steps; j++) {
      tri(centre, at(0, j), at(0, j + 1));
      for (let i = 0; i + 1 < count; i++) {
        tri(at(i, j), at(i + 1, j), at(i + 1, j + 1));
        tri(at(i, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }
  };
  const top = (x: number, y: number): number => padTop(shape, x, y);
  if (shape.base.kind === "dome") {
    grid((th) => T.dome.rings.map((f) => f * shape.radius(th)), top, 0, true);
    return geometry(positions, index, { kind: { data: parts, size: 1 } });
  }
  grid((th) => T.plate.rings.map((f) => f * shape.radius(th)), top, 0, true);
  const under = (x: number, y: number): number => padUnder(shape, x, y);
  grid((th) => T.plate.under.map((f) => f * shape.radius(th)), under, 2, false);
  // The side walls: the top's edge down to the underside's, facing out
  const first = parts.length;
  for (let j = 0; j < steps; j++) {
    const [th, c, s] = outlineAt(j);
    const r = shape.radius(th);
    vertex(r * c, r * s, top(r * c, r * s), 1);
    vertex(r * c, r * s, under(r * c, r * s), 1);
  }
  for (let j = 0; j < steps; j++) {
    const [t0, d0, t1, d1] = [first + 2 * j, first + 2 * j + 1, first + 2 * ((j + 1) % steps), first + 2 * ((j + 1) % steps) + 1];
    index.push(t0, t1, d0, t1, d1, d0);
  }
  return geometry(positions, index, { kind: { data: parts, size: 1 } });
}

/** A region's points on a grid, arm-frame (along, across): `u` 0..1 out along it, `w` -1..1 across */
function regionPoint(region: PadRegion, u: number, w: number): [number, number] {
  if (region.along) return [region.along[0] + u * (region.along[1] - region.along[0]), w * (region.across ?? 0)];
  const [r0, r1] = region.r ?? [0, 0];
  const r = r0 + u * (r1 - r0);
  const half = (along: number): number =>
    Math.min(region.angle !== undefined ? r * Math.sin(deg(region.angle)) : r, region.across ?? Infinity, region.taper ? taperAt(region.taper, along) : Infinity);
  const across = w * half(Math.sqrt(Math.max(0, r * r - half(r) ** 2)));
  return [Math.sqrt(Math.max(0, r * r - across * across)), across];
}

/** A region's outline, counter-clockwise (arm frame), `n` points to a side */
function regionLoop(region: PadRegion, n: number): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < n; i++) loop.push(regionPoint(region, 0, 1 - (2 * i) / n)); // the inner side, across +1 -> -1
  for (let i = 0; i < n; i++) loop.push(regionPoint(region, i / n, -1)); // the right side, out
  for (let i = 0; i < n; i++) loop.push(regionPoint(region, 1, -1 + (2 * i) / n)); // the outer side
  for (let i = 0; i < n; i++) loop.push(regionPoint(region, 1 - i / n, 1)); // the left side, back in
  return loop.reverse(); // (the walk above runs clockwise in the arm's frame)
}

/** The inlays: a disc (a region from r 0) or a grid per arm, `lift` above the top, each vertex its kind (its index) */
export function padInlayGeometry(shape: PadShape): BufferGeometry {
  const positions: number[] = [];
  const kinds: number[] = [];
  const index: number[] = [];
  const vertex = (x: number, y: number, kind: number): number => {
    positions.push(...three(x, y, padTop(shape, x, y) + shape.inlayLift));
    kinds.push(kind);
    return kinds.length - 1;
  };
  shape.inlays.forEach((region, kind) => {
    if (region.r && region.r[0] <= 0 && region.angle === undefined && region.across === undefined) {
      const { steps } = PAD_TESSELLATION.disc;
      const rings = PAD_TESSELLATION.disc.rings.map((f) => f * (region.r?.[1] ?? 0));
      const centre = vertex(0, 0, kind);
      const first = kinds.length;
      for (const r of rings) for (let j = 0; j < steps; j++) vertex(r * Math.cos((2 * Math.PI * j) / steps), r * Math.sin((2 * Math.PI * j) / steps), kind);
      const at = (ring: number, j: number): number => first + ring * steps + (j % steps);
      for (let j = 0; j < steps; j++) index.push(centre, at(0, j + 1), at(0, j));
      for (let i = 0; i + 1 < rings.length; i++) {
        for (let j = 0; j < steps; j++) index.push(at(i, j), at(i + 1, j + 1), at(i + 1, j), at(i, j), at(i, j + 1), at(i + 1, j + 1));
      }
      return;
    }
    const [nu, nw] = PAD_TESSELLATION.window;
    for (let k = 0; k < 3; k++) {
      const first = kinds.length;
      for (let i = 0; i <= nu; i++) {
        for (let j = 0; j <= nw; j++) {
          const [a, c] = regionPoint(region, i / nu, -1 + (2 * j) / nw);
          vertex(...turned(a, c, k), kind);
        }
      }
      const at = (i: number, j: number): number => first + i * (nw + 1) + j;
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nw; j++) index.push(at(i, j), at(i + 1, j + 1), at(i + 1, j), at(i, j), at(i, j + 1), at(i + 1, j + 1));
      }
    }
  });
  return geometry(positions, index, { kind: { data: kinds, size: 1 } });
}

/** The curtains: the tube and the walls, each vertex its (around: noise cells, the period they wrap at, v, height in
 *  noise cells) */
export function padCurtainGeometry(shape: PadShape): BufferGeometry {
  const positions: number[] = [];
  const curtain: number[] = [];
  const index: number[] = [];
  const cell = CURTAIN_NOISE.cell;
  /** A band between two closed loops (game-local x, y, z each), the seam's point repeated at the period's end */
  const band = (bottom: readonly (readonly [number, number, number])[], top: readonly (readonly [number, number, number])[], vBottom: number): void => {
    let length = 0;
    const along = [0];
    for (let i = 1; i <= bottom.length; i++) {
      const [a, b] = [bottom[i - 1], bottom[i % bottom.length]];
      if (a && b) length += Math.hypot(b[0] - a[0], b[1] - a[1]);
      along.push(length);
    }
    const period = Math.max(1, Math.round(length / cell));
    const height = bottom.reduce((h, p, i) => h + ((top[i]?.[2] ?? 0) - p[2]), 0) / bottom.length / cell;
    const first = positions.length / 3;
    for (let i = 0; i <= bottom.length; i++) {
      const [b, t] = [bottom[i % bottom.length], top[i % top.length]];
      if (!b || !t) continue;
      const around = ((along[i] ?? 0) / length) * period;
      positions.push(...three(b[0], b[1], b[2]), ...three(t[0], t[1], t[2]));
      curtain.push(around, period, vBottom, height, around, period, 0, height);
    }
    for (let i = 0; i < bottom.length; i++) {
      const [b0, t0, b1, t1] = [first + 2 * i, first + 2 * i + 1, first + 2 * i + 2, first + 2 * i + 3];
      index.push(b0, b1, t1, b0, t1, t0);
    }
  };
  const { tube } = shape;
  const segments = PAD_TESSELLATION.tube;
  const ring = (r: number, z: number): [number, number, number][] =>
    Array.from({ length: segments }, (_, j) => [r * Math.cos((2 * Math.PI * j) / segments), r * Math.sin((2 * Math.PI * j) / segments), z]);
  band(ring(tube.r[0], tube.z[0]), ring(tube.r[1], tube.z[1]), tube.v);
  for (const wall of shape.walls) {
    for (let k = 0; k < 3; k++) {
      const loop = regionLoop(wall.loop, PAD_TESSELLATION.wall).map(([a, c]) => turned(a, c, k));
      const centre = loop.reduce(([sx, sy], [x, y]) => [sx + x / loop.length, sy + y / loop.length], [0, 0]);
      const bottom = loop.map(([x, y]): [number, number, number] => [x, y, wall.bottom ?? padTop(shape, x, y) - 0.2]);
      const top = (wall.topLoop ? regionLoop(wall.topLoop, PAD_TESSELLATION.wall).map(([a, c]) => turned(a, c, k)) : loop).map(([x, y]): [number, number, number] => {
        if (wall.topLoop) return [x, y, wall.top];
        const [dx, dy] = [x - centre[0], y - centre[1]];
        const d = Math.hypot(dx, dy) || 1;
        return [x + (wall.flare * dx) / d, y + (wall.flare * dy) / d, wall.top];
      });
      band(bottom, top, wall.v);
    }
  }
  return geometry(positions, index, { curtain: { data: curtain, size: 4 } });
}

// ---- Materials ----

/** The pad parts' shared vertex shader: the pad's own frame (game x, y) as vLocal, its instance colour as vPad
 *  (Brightness, the warm-up's n, the pad's seed) */
const LOCAL_VERTEX = /* glsl */ `
attribute float kind;
attribute vec4 curtain;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLocal;
varying vec3 vPad;
varying float vKind;
varying vec4 vCurtain;
#include <fog_pars_vertex>
void main() {
  vLocal = vec2(position.x, position.z);
  vKind = kind;
  vCurtain = curtain;
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vPad = instanceColor;
  #else
  vPad = vec3(1.0, 0.0, 0.0);
  #endif
  vec4 world = m * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(m) * normal;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const LOCAL_VARYINGS = /* glsl */ `
uniform float padTime;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLocal;
varying vec3 vPad;
varying float vKind;
varying vec4 vCurtain;`;

interface Uniform<T> {
  value: T;
}

function fogUniforms(): Record<string, Uniform<unknown>> {
  return UniformsUtils.clone(UniformsLib.fog);
}

/** The base (VT-11a/b: lit opaque metal): its markings' (G, k) blended at their edges (on its top), the capture
 *  reflected, the pad floor's baked light, the underglow under the centre and windows flickering per pad */
function baseMaterial(shape: PadShape, reflection: Uniform<Texture | null>, time: Uniform<number>): ShaderMaterial {
  const { surface, glow, flicker } = shape;
  const lines = shape.lines.map((r, i) => regionGlsl(`padLine${String(i)}`, r)).join("\n");
  const panels = shape.panels.map((r, i) => regionGlsl(`padPanel${String(i)}`, r)).join("\n");
  const glows = glow.regions.map((r, i) => regionGlsl(`padGlow${String(i)}`, r)).join("\n");
  const gk = (v: readonly [number, number]): string => `vec2(${glf(v[0])}, ${glf(v[1])})`;
  return new ShaderMaterial({
    vertexShader: LOCAL_VERTEX,
    fragmentShader: /* glsl */ `
      uniform samplerCube grassCube;
      ${LOCAL_VARYINGS}
      #include <fog_pars_fragment>
      ${ARM_GLSL}
      ${HASH_GLSL}
      ${lines}
      ${panels}
      ${glows}
      float padCover(float margin) { return clamp(0.5 + margin / max(fwidth(margin), 0.001), 0.0, 1.0); }
      float padFlickerAt(uint seed, float i) {
        uint h = padHash(uint(i), seed);
        float w = padUnit(padHash(h, 0x9e3779b9u));
        return padUnit(h) < ${glf(flicker.chance)} ? mix(${glf(flicker.lo)}, ${glf(flicker.hi)}, w) : ${glf(flicker.base)};
      }
      float padFlicker(float seed, float time) {
        float x = time / ${glf(flicker.step)};
        float i = floor(x);
        uint s = uint(seed * 65535.0);
        return mix(padFlickerAt(s, i), padFlickerAt(s, i + 1.0), x - i);
      }
      void main() {
        vec4 a = padArm(vLocal);
        float onTop = vKind < 0.5 ? 1.0 : 0.0;
        vec2 gk = ${gk(surface.body)};
        ${shape.lines.map((_, i) => `gk = mix(gk, ${gk(surface.line)}, onTop * padCover(padLine${String(i)}(a)));`).join("\n        ")}
        ${shape.panels.map((_, i) => `gk = mix(gk, ${gk(surface.panel)}, onTop * padCover(padPanel${String(i)}(a)));`).join("\n        ")}
        float glow = 0.0;
        ${glow.regions.map((_, i) => `glow += smoothstep(-0.75, 0.75, padGlow${String(i)}(a));`).join("\n        ")}
        glow = onTop * min(glow, 1.0) * ${glf(glow.peak)};
        vec3 toCamera = normalize(cameraPosition - vWorld);
        vec3 env = textureLod(grassCube, reflect(-toCamera, normalize(vNormal)), ${GRASS_CUBE_BLUR_LOD.toFixed(1)}).rgb;
        vec3 colour = gk.x * (1.0 + 32.0 * gk.y * env) * ${vec3Glsl(BASE_LIGHT)}
          + glow * (0.25 + padFlicker(vPad.b, padTime)) * ${vec3Glsl(PAD_COLOURS.underglow)};
        gl_FragColor = vec4(colour, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    uniforms: { ...fogUniforms(), grassCube: reflection, padTime: time },
    fog: true,
  });
}

/** A big pad's inlays (VT-11a: translucent): the edge mask x Brightness, bands moving inward; `warm` the warm-up's copy
 *  (VT-11c: cream to gold, revealed by a wipe round each arm toward the pad frame's +x: ours the arm's clockwise side
 *  in the game's numbers, its negative angle) */
function bigInlayMaterial(warm: boolean, time: Uniform<number>): ShaderMaterial {
  const [centre, inner, outer] = BIG_PAD.inlays;
  const [low, high] = PAD_COLOURS.bigInlay;
  return new ShaderMaterial({
    vertexShader: LOCAL_VERTEX,
    fragmentShader: /* glsl */ `
      ${LOCAL_VARYINGS}
      #include <fog_pars_fragment>
      ${ARM_GLSL}
      ${HASH_GLSL}
      ${regionGlsl("padCentre", centre ?? {})}
      ${regionGlsl("padInner", inner ?? {})}
      ${regionGlsl("padOuter", outer ?? {})}
      ${curveGlsl("padFireR", PAD_CURVES.fireR)}
      void main() {
        vec4 a = padArm(vLocal);
        float lateral = -a.x * sin(a.y);
        float margin;
        float v;
        float s;
        if (vKind < 0.5) {
          margin = padCentre(a);
          v = a.x <= 17.7 ? 0.67 * a.x / 17.7 : 0.1;
          s = 0.5 - 0.415 * a.y / ${glf(Math.PI / 3)};
        } else if (vKind < 1.5) {
          margin = padInner(a);
          v = 0.12 + 0.28 * clamp((a.x - 34.0) / 30.0, 0.0, 1.0);
          s = 0.5 + 0.0112 * lateral;
        } else {
          margin = padOuter(a);
          v = 0.12 + 0.28 * clamp((a.x - 70.5) / 14.5, 0.0, 1.0);
          s = 0.5 + 0.0062 * lateral;
        }
        float edge = clamp(margin / 2.0, 0.0, 1.0);
        float facing = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
        float band = min(1.0, 4.0 * padFireR(fract(2.0 * v + padTime)));
        float I = 1.5 * facing * band * v + 0.5 * pow(v, 4.0);
        ${
          warm
            ? `vec3 colour = mix(${vec3Glsl(PAD_COLOURS.cream)}, ${vec3Glsl(PAD_COLOURS.gold)}, I);
        float alpha = edge * padReveal(s, vPad.g);`
            : `vec3 colour = max(mix(${vec3Glsl(low)}, ${vec3Glsl(high)}, I), 0.0);
        float alpha = edge * vPad.r;`
        }
        gl_FragColor = vec4(colour, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    uniforms: { ...fogUniforms(), padTime: time },
    fog: true,
    transparent: true,
    depthWrite: false,
  });
}

/** A small pad's inlay (VT-11b: added): smallInlay above x Brightness */
function smallInlayMaterial(time: Uniform<number>): ShaderMaterial {
  const { a, b, c } = PAD_COLOURS.smallInlay;
  return new ShaderMaterial({
    vertexShader: LOCAL_VERTEX,
    fragmentShader: /* glsl */ `
      ${LOCAL_VARYINGS}
      ${curveGlsl("padFireR", PAD_CURVES.fireR)}
      ${curveGlsl("padFireG", PAD_CURVES.fireG)}
      ${curveGlsl("padFireB", PAD_CURVES.fireB)}
      void main() {
        vec2 p = vLocal / 22.5;
        float q = dot(p, p);
        float s = q / 4.0;
        float x1 = fract(3.0 * s + padTime);
        float x2 = fract(3.0 * s - padTime);
        float x3 = fract(3.0 * s - 1.75);
        float rb = padFireR(x1) * padFireB(x1);
        float gb = padFireG(x2) + padFireB(x2);
        float stay = padFireR(x3) + padFireB(x3);
        float gc = exp(-7.5 * q);
        float mask = clamp(8.0 * (1.0 - q), 0.0, 1.0);
        vec3 A = ${vec3Glsl(a)};
        vec3 C = A * (A * rb + (1.0 + sin(6.2831853 * padTime)) * gb * ${vec3Glsl(b)} + gc * ${vec3Glsl(c)});
        gl_FragColor = vec4(mask * vPad.r * (stay + gb + gc) * C, 1.0);
        #include <colorspace_fragment>
      }`,
    uniforms: { padTime: time },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** The light curtains (VT-11a: translucent, two-sided, no depth write): alpha sat(S(v) (2n + 0.0625) Brightness),
 *  colour (1 + S) x the curtain's; `warm` the warm-up's copy (VT-11c: revealed top down, cream, Brightness to 4) */
function curtainMaterial(warm: boolean, time: Uniform<number>): ShaderMaterial {
  const N = CURTAIN_NOISE;
  return new ShaderMaterial({
    vertexShader: LOCAL_VERTEX,
    fragmentShader: /* glsl */ `
      ${LOCAL_VARYINGS}
      #include <fog_pars_fragment>
      ${HASH_GLSL}
      ${curveGlsl("padCurtain", PAD_CURVES.curtain)}
      void main() {
        float v = vCurtain.z;
        float S = padCurtain(v);
        uint seed = uint(vPad.b * 65535.0);
        vec2 q = vec2(vCurtain.x, (v + ${glf(N.rise)} * padTime) * vCurtain.w);
        float w = padNoise(q + vec2(0.0, 37.0), vCurtain.y, seed);
        float raw = padNoise(q + ${glf(N.warp)} * vec2(w), vCurtain.y, seed);
        float n = ${glf(N.mean)} + ${glf(N.sd)} * (raw - 0.5) / ${glf(N.raw)};
        float alpha = clamp(S * (2.0 * n + 0.0625) * vPad.r, 0.0, 1.0);
        ${warm ? `alpha *= padReveal(v, vPad.g);\n        vec3 colour = (1.0 + S) * ${vec3Glsl(PAD_COLOURS.cream)};` : `vec3 colour = (1.0 + S) * ${vec3Glsl(PAD_COLOURS.curtain)};`}
        gl_FragColor = vec4(colour, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    uniforms: { ...fogUniforms(), padTime: time },
    fog: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** The orb's sprites (VT-11a): (a) the masked orb, (b) its core glow, (c) its far-only dark backing; and the warm-up's
 *  puffs (VT-11c). Billboards about each instance's place, their size the sprite's x the instance's scale, `away` uu
 *  farther from the camera (CameraOffset -8: the glows behind the orb) */
export const ORB = {
  z: 84,
  size: 40,
  edge: 0.9306,
  pans: [[0.185, 0.227], [0.135, 0.086]],
  noise: 0.25,
  coreGlow: 64,
  backing: 160,
  away: 8,
  far: 4096,
} as const;
/** The warm-up's last-second puffs (VT-11c): 2 a second, a second's life, 56 -> 280 uu, alpha 1 -> 0, at z 101 (the FX's
 *  z 8 + 93) */
export const PUFFS = { every: 0.5, life: 1, size: [56, 280], z: 101 } as const;

type SpriteKind = "orb" | "glow" | "backing" | "puff";

function spriteMaterial(kind: SpriteKind, time: Uniform<number>): ShaderMaterial {
  const size = { orb: ORB.size, glow: ORB.coreGlow, backing: ORB.backing, puff: 1 }[kind];
  const away = kind === "glow" || kind === "backing" ? ORB.away : 0;
  const [pan1, pan2] = ORB.pans;
  const fragment = {
    orb: /* glsl */ `
      float d = dot(p, p);
      if (d > ${glf(ORB.edge * ORB.edge)}) discard;
      float d2 = d * d;
      float rim = max(0.0, 2.0 * d2 - 1.0);
      float core = pow(max(0.0, 0.5 - 2.0 * d2), 2.0);
      vec2 q = ${glf(ORB.noise)} * p + 64.0;
      float n1 = padNoise(q + vec2(${glf(pan1[0])}, ${glf(pan1[1])}) * padTime, 0.0, 11u);
      float n2 = padNoise(q + vec2(${glf(pan2[0])}, ${glf(pan2[1])}) * padTime + 2.0 * n1, 0.0, 23u);
      float vein = clamp(8.0 * (abs(n1 - n2) - 0.03125), 0.0, 1.0);
      vec3 C = ${vec3Glsl(PAD_COLOURS.orb.dark)} + min(1.0, d2 + vein) * ${vec3Glsl(PAD_COLOURS.orb.range)};
      float lift = clamp(p.y, 0.0, 1.0) + vDepth / ${glf(ORB.far)};
      float I = 8.0 * lift * lift + 8.0 * core + rim + 0.25;
      float sheen = (1.0 - rim) * clamp(-p.y, 0.0, 1.0);
      gl_FragColor = vec4(I * C + vec3(sheen * sheen), 1.0);`,
    glow: /* glsl */ `
      float r = min(1.0, length(p));
      gl_FragColor = vec4(${vec3Glsl(PAD_COLOURS.coreGlow)} * pow(1.0 - r, 2.2), 1.0);`,
    backing: /* glsl */ `
      float r = length(p);
      gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(padBacking(r) - 1.0 + min(1.0, vDepth / ${glf(ORB.far)}), 0.0, 1.0));`,
    puff: /* glsl */ `
      float r = length(p);
      gl_FragColor = vec4(1.0, 1.0, 1.0, vPad.r * exp(-7.5 * r * r));`,
  }[kind];
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying float vDepth;
      varying vec3 vPad;
      #include <fog_pars_vertex>
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
        m = m * instanceMatrix;
        #endif
        #ifdef USE_INSTANCING_COLOR
        vPad = instanceColor;
        #else
        vPad = vec3(1.0);
        #endif
        float scale = length(m[0].xyz);
        vec4 centre = viewMatrix * m * vec4(0.0, 0.0, 0.0, 1.0);
        if (scale > 0.0) centre.xyz += normalize(centre.xyz) * ${glf(away)};
        vec4 mvPosition = centre + vec4(position.xy * ${glf(size)} * scale, 0.0, 0.0);
        vP = vec2(position.x, -position.y) * 2.0;
        vDepth = -centre.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float padTime;
      varying vec2 vP;
      varying float vDepth;
      varying vec3 vPad;
      #include <fog_pars_fragment>
      ${HASH_GLSL}
      ${curveGlsl("padBacking", PAD_CURVES.backing)}
      void main() {
        vec2 p = vP;
        ${fragment}
        #include <colorspace_fragment>
        ${kind === "orb" ? "#include <fog_fragment>" : ""}
      }`,
    uniforms: { ...fogUniforms(), padTime: time },
    fog: kind === "orb",
    transparent: kind !== "orb",
    depthWrite: kind === "orb",
    ...(kind === "glow" ? { blending: AdditiveBlending } : {}),
  });
}

// ---- The view ----

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** The translucent parts' order among themselves (VT-11c: inlays, curtains, glows; within the pads' priority 0) */
const ORDER = { inlays: 0, curtains: 0.01, warmInlays: 0.02, warmCurtains: 0.03, puffs: 0.035, glow: 0.04, backing: 0.05 } as const;

/** A shape's geometries, built once (every view of the pads shares them) */
const geometries = new Map<PadShape, { readonly base: BufferGeometry; readonly inlays: BufferGeometry; readonly curtains: BufferGeometry }>();
function padGeometries(shape: PadShape): { readonly base: BufferGeometry; readonly inlays: BufferGeometry; readonly curtains: BufferGeometry } {
  let g = geometries.get(shape);
  if (!g) {
    g = { base: padBaseGeometry(shape), inlays: padInlayGeometry(shape), curtains: padCurtainGeometry(shape) };
    geometries.set(shape, g);
  }
  return g;
}

/** One size of pad's meshes, instanced (one draw call each for all of its pads) */
class PadMeshes {
  readonly base: InstancedMesh;
  readonly inlays: InstancedMesh;
  readonly curtains: InstancedMesh;
  readonly warm: { readonly inlays: InstancedMesh; readonly curtains: InstancedMesh; readonly puffs: InstancedMesh } | null;
  readonly orb: { readonly orb: InstancedMesh; readonly glow: InstancedMesh; readonly backing: InstancedMesh } | null;

  constructor(shape: PadShape, count: number, reflection: Uniform<Texture | null>, time: Uniform<number>) {
    const name = shape.big ? "big" : "small";
    const make = (part: string, g: BufferGeometry, material: ShaderMaterial, n = count, order: number | null = null, hidden = false): InstancedMesh => {
      const mesh = new InstancedMesh(g, material, n);
      mesh.name = `${name} ${part}`;
      mesh.frustumCulled = false; // (spread over the whole field)
      if (order !== null) mesh.renderOrder = order;
      if (hidden) for (let i = 0; i < n; i++) mesh.setMatrixAt(i, HIDDEN);
      return mesh;
    };
    const { base, inlays, curtains } = padGeometries(shape);
    this.base = make("base", base, baseMaterial(shape, reflection, time));
    this.inlays = make("inlays", inlays, shape.big ? bigInlayMaterial(false, time) : smallInlayMaterial(time), count, ORDER.inlays);
    this.curtains = make("curtains", curtains, curtainMaterial(false, time), count, ORDER.curtains);
    if (!shape.big) {
      this.warm = null;
      this.orb = null;
      return;
    }
    const sprite = new PlaneGeometry(1, 1);
    this.warm = {
      inlays: make("warm-up inlays", inlays, bigInlayMaterial(true, time), count, ORDER.warmInlays, true),
      curtains: make("warm-up curtains", curtains, curtainMaterial(true, time), count, ORDER.warmCurtains, true),
      puffs: make("warm-up puffs", sprite, spriteMaterial("puff", time), 2 * count, ORDER.puffs, true),
    };
    this.orb = {
      orb: make("orb", sprite, spriteMaterial("orb", time)),
      glow: make("orb glow", sprite, spriteMaterial("glow", time), count, ORDER.glow),
      backing: make("orb backing", sprite, spriteMaterial("backing", time), count, ORDER.backing),
    };
  }

  get all(): InstancedMesh[] {
    const { warm, orb } = this;
    return [this.base, ...(orb ? [orb.orb] : []), this.inlays, this.curtains, ...(warm ? [warm.inlays, warm.curtains, warm.puffs] : []), ...(orb ? [orb.glow, orb.backing] : [])];
  }
}

interface PadSlot {
  readonly meshes: PadMeshes;
  readonly big: boolean;
  readonly slot: number;
  /** The base's and the FX's place and turn; the orb's place; the puffs' (Three's frame) */
  readonly matrix: Matrix4;
  readonly orb: Matrix4;
  readonly puff: readonly [number, number, number];
  readonly delay: number;
  readonly seed: number;
}

/** Boost pads, as the game draws them (the file's header): instanced, a handful of draw calls for all of them */
export class BoostPadsView {
  readonly root = new Group();
  readonly #pads: readonly PadSlot[];
  readonly #shown: (boolean | null)[];
  /** Seconds left of each pad's Brightness fading (out after a pickup, in after its return) */
  readonly #fading: number[];
  /** The FX's clock (s): the bands, rings, noise and flicker */
  readonly #time: Uniform<number> = { value: 0 };
  readonly #color = new Color();
  readonly #m = new Matrix4();
  readonly #fx: InstancedMesh[];

  /** `reflection`: the arena's capture (ArenaView.reflection; none: black) */
  constructor(pads: readonly BoostPadState[], reflection: Uniform<Texture | null> = { value: null }) {
    const count = (big: boolean): number => pads.filter((p) => p.big === big).length;
    const big = new PadMeshes(BIG_PAD, count(true), reflection, this.#time);
    const small = new PadMeshes(SMALL_PAD, count(false), reflection, this.#time);
    const slots = { big: 0, small: 0 };
    this.#pads = pads.map((pad) => {
      const turn = deg(padYaw(pad.pos.x, pad.pos.y, pad.big) + PADS_TURN);
      // (a turn from the game's x toward its y is Three's y-turn the other way: its z is the game's y)
      const matrix = new Matrix4().makeRotationY(-turn).setPosition(pad.pos.x, 0, pad.pos.y);
      return {
        meshes: pad.big ? big : small,
        big: pad.big,
        slot: pad.big ? slots.big++ : slots.small++,
        matrix,
        orb: new Matrix4().makeTranslation(pad.pos.x, ORB.z, pad.pos.y),
        puff: [pad.pos.x, PUFFS.z, pad.pos.y] as const,
        delay: pad.big ? PAD_RESPAWN_SECONDS.big : PAD_RESPAWN_SECONDS.small,
        seed: unit(padHash(Math.round(pad.pos.x), Math.round(pad.pos.y))),
      };
    });
    for (const p of this.#pads) {
      const { base, inlays, curtains } = p.meshes;
      for (const mesh of [base, inlays, curtains]) {
        mesh.setMatrixAt(p.slot, p.matrix);
        mesh.setColorAt(p.slot, this.#color.setRGB(1, 0, p.seed));
      }
    }
    for (const m of [big, small]) this.root.add(...m.all);
    this.#fx = [big, small].flatMap((m) => m.all.filter((mesh) => mesh !== m.base));
    this.#shown = pads.map(() => null);
    this.#fading = pads.map(() => 0);
    this.update(pads);
  }

  /** Every part but the bases shown (the debug shader probe's look at a pad's base alone) */
  set fxVisible(on: boolean) {
    for (const mesh of this.#fx) mesh.visible = on;
  }

  /** `seconds`: since the last update (the fades, the FX's clock; none given: the fades at their end at once) */
  update(pads: readonly BoostPadState[], seconds = Infinity): void {
    if (Number.isFinite(seconds)) this.#time.value += Math.max(0, seconds);
    // (the warm-up's meshes drawn only while a big pad is down, its puffs only in one's last second)
    const warmUp = this.#pads.find((p) => p.meshes.warm)?.meshes.warm;
    if (warmUp) {
      const down = pads.filter((pad, i) => this.#pads[i]?.big === true && !pad.active);
      warmUp.inlays.visible = warmUp.curtains.visible = down.length > 0;
      warmUp.puffs.visible = down.some((pad) => pad.cooldown <= PAD_ALMOST_SPAWNED_SECONDS);
    }
    pads.forEach((pad, i) => {
      const p = this.#pads[i];
      if (!p) return;
      const { inlays, curtains, warm, orb } = p.meshes;
      const changed = this.#shown[i] !== pad.active;
      const first = this.#shown[i] === null;
      if (changed) {
        this.#shown[i] = pad.active;
        this.#fading[i] = first ? 0 : PAD_FADE_SECONDS;
        // Taken: the orb goes at once, the FX fade out; back: the orb at once, the warm-up gone at once, the FX fading in
        if (orb) for (const mesh of [orb.orb, orb.glow, orb.backing]) this.#place(mesh, p.slot, pad.active ? p.orb : HIDDEN);
        if (pad.active && warm) {
          for (const mesh of [warm.inlays, warm.curtains]) this.#place(mesh, p.slot, HIDDEN);
          for (const k of [0, 1]) this.#place(warm.puffs, 2 * p.slot + k, HIDDEN);
        }
      }
      const fading = this.#fading[i] ?? 0;
      if (fading > 0 || changed) {
        const left = Math.max(0, fading - seconds);
        this.#fading[i] = left;
        const light = pad.active ? 1 - left / PAD_FADE_SECONDS : left / PAD_FADE_SECONDS;
        for (const mesh of [inlays, curtains]) this.#colour(mesh, p.slot, light, 0, p.seed);
      }
      if (pad.active || !warm) return;
      // The warm-up (VT-13): n through the delay, the copies revealed by it, the curtains' Brightness 1 + 3 EaseInCirc(n)
      const n = Math.min(1, Math.max(0, 1 - pad.cooldown / p.delay));
      const brightness = 1 + 3 * (1 - Math.sqrt(1 - n * n));
      for (const mesh of [warm.inlays, warm.curtains]) {
        this.#place(mesh, p.slot, p.matrix);
        this.#colour(mesh, p.slot, brightness, n, p.seed);
      }
      // (the last second's puffs: two a second, each a second's life)
      for (const k of [0, 1]) {
        const age = PAD_ALMOST_SPAWNED_SECONDS - pad.cooldown - k * PUFFS.every;
        const slot = 2 * p.slot + k;
        if (age < 0 || age >= PUFFS.life) {
          this.#place(warm.puffs, slot, HIDDEN);
          continue;
        }
        const size = PUFFS.size[0] + (PUFFS.size[1] - PUFFS.size[0]) * (age / PUFFS.life);
        this.#place(warm.puffs, slot, this.#m.makeScale(size, size, size).setPosition(...p.puff));
        this.#colour(warm.puffs, slot, 1 - age / PUFFS.life, 0, p.seed);
      }
    });
  }

  #place(mesh: InstancedMesh, slot: number, matrix: Matrix4): void {
    mesh.setMatrixAt(slot, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  #colour(mesh: InstancedMesh, slot: number, r: number, g: number, b: number): void {
    mesh.setColorAt(slot, this.#color.setRGB(r, g, b));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
