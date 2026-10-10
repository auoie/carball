// DFH Stadium's field plan (notes/arena-visuals.md AV-5, AV-7, AV-13, RV-72/76/77): the floor's regions, the frame's
// lines, the painted markings, the goals' glows and the glass beside each goal. Builds draw it built from measurements
// and rules (`shippableFieldPlan`: rectangles, 45-degree chamfers, arcs, outsets and insets of these, ribbons along our
// own arena's goal: the measures named below), as the arena's walls are. The shapes traced from the game's meshes
// (scripts/field_plan.py -> out/bsim/assets_local/arena/field_plan.json) are a local asset: the dev server serves them
// at /local-assets/ and they're drawn instead when present (`loadGameFieldPlan`); never committed or shipped.
// Points are the game's (x, y) (or (x, y, z) for the glows); `mirror` says which images make the whole: "xy" four ways
// from x, y >= 0, "y" across y = 0 (a piece across x = 0), "x" across x = 0 (a piece across y = 0), "none" itself.
import { mouthOutline } from "./arenaSurface";
import { goalPath } from "./goalSurface";

export interface FieldRegion {
  readonly mirror: "xy" | "x" | "y" | "none";
  readonly outline: readonly number[];
  readonly holes?: readonly (readonly number[])[];
}

/** The frame pieces' stripes (FrameTexture_PACK's, H-4): "E" emissive (the glowing team lines), "D" the team colour lit;
 *  on which piece (its baked light), its width (uu) and centreline */
export interface FrameLine {
  readonly kind: "E" | "D";
  readonly piece: "trim" | "centreTrim" | "centreStrip" | "halfway";
  readonly mirror: FieldRegion["mirror"];
  readonly width: number;
  readonly points: readonly number[];
}

/** A glow ribbon (TrimLight_Glow, H-5): its attached edge (glow 1) and free edge (glow 0), (x, y, z) polylines the same
 *  way round, the +y goal's (the -y goal's mirrors it) */
export interface GlowRibbon {
  readonly attached: readonly number[];
  readonly free: readonly number[];
}

/** The painted markings by mesh (each its own baked light): Goal_Lines, Field_Side_Lines, Field_Center_Lines */
export type MarkingGroup = "goal" | "side" | "centre";

export interface FieldPlan {
  /** The grass (Grass_Base_Team1_MIC); drawn first, the rest over it */
  readonly grass: readonly FieldRegion[];
  /** The frame's seams round and between the regions (Field_STD_Trim/TrimB), drawn over the grass (none: the floor under
   *  the field shows through the grass's own gaps) */
  readonly seams?: readonly FieldRegion[];
  /** The metal hex floor (Reflective_Floor_V2): the side bays, the pad bases and markers, the goal ends */
  readonly hexSide: readonly FieldRegion[];
  readonly hexPads: readonly FieldRegion[];
  readonly goalEnds: readonly FieldRegion[];
  /** The goal mouths' piece (Reflective_Floor_B_Mat) */
  readonly goalMouths: readonly FieldRegion[];
  readonly centreDisc: readonly FieldRegion[];
  /** The centre's raised trim (Frame_01_V2, z 1) */
  readonly centreTrim: readonly FieldRegion[];
  /** The frame's strips: the centre-field strips, the halfway strip's flat part */
  readonly centreStrips: readonly FieldRegion[];
  readonly halfway: readonly FieldRegion[];
  readonly frameLines: readonly FrameLine[];
  /** x, y >= 0 (mirrored four ways): [width, x0, y0, x1, y1, ...] along each strip's centreline */
  readonly markings: Readonly<Record<MarkingGroup, readonly (readonly number[])[]>>;
  readonly goalGlow: readonly GlowRibbon[];
  /** The glass panel beside each goal mouth (Goal_STD_Glass, y +-5124): its outline in (|x|, z) */
  readonly goalSideGlass: readonly (readonly [number, number])[];
}

/** Each floor piece's baked light (Stadium_P's lightmaps: the static session's statistics, linear, a flat face facing
 *  up; out/bsim/agents/LMP/lm_stats.json, `scripts/field_plan.py --light`): RGB in bins along the game's x or |y| from `start`, `bin` uu each (one entry,
 *  no axis: the piece's mean) */
export interface LightProfile {
  readonly axis: "x" | "|y|" | null;
  readonly start: number;
  readonly bin: number;
  readonly rgb: readonly (readonly [number, number, number])[];
}

export type FloorPiece = "hexSide" | "hexPads" | "disc" | "goalEnd" | "goalMouth" | "centreStrip" | "halfway" | "trim" | "trimB" | "centreTrim";

export const FIELD_LIGHT: Readonly<Record<FloorPiece, LightProfile>> = {
  hexSide: { axis: "|y|", start: 0, bin: 512, rgb: [[0.5832, 0.5455, 0.4319], [0.6817, 0.631, 0.494], [0.7043, 0.6515, 0.5024], [0.807, 0.7406, 0.5617], [0.8661, 0.7904, 0.5994], [0.8718, 0.7991, 0.6106], [0.8772, 0.8159, 0.5899], [1.057, 0.9685, 0.7311], [1.03, 0.946, 0.716]] },
  hexPads: { axis: null, start: 0, bin: 1, rgb: [[1.095, 0.9971, 0.7515]] },
  disc: { axis: null, start: 0, bin: 1, rgb: [[0.8924, 0.8258, 0.6421]] },
  goalEnd: { axis: "x", start: -2048, bin: 512, rgb: [[1.355, 1.221, 0.9252], [1.291, 1.169, 0.889], [1.219, 1.109, 0.846], [1.163, 1.062, 0.818], [1.151, 1.055, 0.814], [1.168, 1.071, 0.8192], [1.12, 1.026, 0.7831], [1.183, 1.08, 0.8204]] },
  goalMouth: { axis: "|y|", start: 4096, bin: 256, rgb: [[1.162, 1.056, 0.8211], [1.14, 1.035, 0.807], [1.254, 1.132, 0.8911], [1.562, 1.403, 1.109]] },
  centreStrip: { axis: "|y|", start: 512, bin: 512, rgb: [[0.9081, 0.8391, 0.6464], [0.9136, 0.8442, 0.6507], [0.9271, 0.8567, 0.6608], [0.9796, 0.9011, 0.6961], [1.06, 0.9711, 0.7497], [1.092, 1, 0.7698]] },
  halfway: { axis: "x", start: -4096, bin: 512, rgb: [[0.3466, 0.3539, 0.3083], [0.4838, 0.4766, 0.4038], [0.6388, 0.617, 0.5086], [0.7163, 0.6858, 0.5582], [0.8306, 0.783, 0.6243], [0.8368, 0.7822, 0.617], [0.831, 0.7747, 0.6065], [0.8271, 0.7711, 0.6037], [0.8232, 0.7674, 0.6008], [0.8193, 0.7638, 0.598], [0.7943, 0.745, 0.5845], [0.7613, 0.716, 0.5654], [0.7302, 0.6915, 0.545], [0.7009, 0.6651, 0.527], [0.6771, 0.6425, 0.5091], [0.7145, 0.6715, 0.5236]] },
  trim: { axis: "|y|", start: 0, bin: 512, rgb: [[0.6766, 0.6306, 0.4918], [0.7656, 0.7139, 0.5619], [0.8288, 0.7645, 0.5956], [0.8649, 0.7903, 0.6093], [0.9144, 0.8315, 0.6339], [0.9924, 0.9022, 0.6867], [1.1, 0.993, 0.7462], [1.146, 1.031, 0.7752], [1.174, 1.052, 0.793], [1.151, 1.034, 0.7798]] },
  trimB: { axis: "|y|", start: 0, bin: 512, rgb: [[0.7172, 0.6717, 0.5279], [0.802, 0.7414, 0.5761], [0.824, 0.7616, 0.5927], [0.9005, 0.8321, 0.6508], [1.014, 0.9309, 0.7159], [1.08, 0.9892, 0.7612], [1.126, 1.03, 0.7946], [0.9454, 0.8616, 0.6579], [0.8303, 0.7606, 0.5875]] },
  centreTrim: { axis: null, start: 0, bin: 1, rgb: [[0.8125, 0.7551, 0.5899]] },
};

type P2 = readonly [number, number];
type P3 = readonly [number, number, number];

/** The measures the shippable plan is built from (the game's frame, uu; measured on the game's meshes and the spec's
 *  AV-5/AV-7/AV-13 numbers): each region a few corners, the rest rules (45-degree chamfers, arcs, offsets) */
export const FIELD_MEASURES = {
  /** The grass: out to |x| 3806 and |y| 4830, its corners cut along the arena's corner (45 degrees, rounded) */
  grass: { x: 3806, y: 4830, cornerFrom: 3650, cornerTo: 2626, diagonal: [3635, 4019, 2995, 4658] as const },
  /** A side bay (x, y >= 0): from the wall (x 3840) in to x 3330, |y| 146-3076, a bump out to x 3458 over |y| 1088-1856 */
  sideBay: { x0: 3330, x1: 3840, y0: 146, y1: 3076, bumpX: 3458, bumpY: [1088, 1856] as const, bottomChamfer: 414, topFrom: 2480 },
  /** A pad base: a pentagon at (1850, 2362), 172 to a corner, one corner at 69 degrees */
  padBase: { at: [1850, 2362] as const, r: 172, corner: 69 },
  /** The markers: a triangle (point at (2048, 924), base y 1100, 200 wide) and one by the corner */
  markers: [[[2048, 924], [2148, 1100], [1948, 1100]], [[3100, 3990], [3155, 4175], [2960, 4126]]] as readonly (readonly P2[])[],
  /** A goal end (x >= 0 half): its front at y 3106 from x 424 to 896 (a 45-degree notch in to y 3360 at the centre), its
   *  side out along 45 degrees to x 2013, back to y 4864, round the mouth piece (x 962 down to y 4580) */
  goalEnd: { front: 3106, notchX: 424, notchY: 3360, frontX: 896, sideX: 2013, back: 4864, mouthX: 962, mouthY: 4580 },
  /** The mouth piece's front, shared with the goal end's notch: from x 928 at y 4583 round to the centre (y 4350) */
  mouthFront: [[928, 4583], [850, 4462], [520, 4300], [260, 4260], [160, 4340], [0, 4350]] as readonly P2[],
  /** The mouth piece: |x| 928, to the back wall (y 5120), its back corners rounded r 270 about (928, 5120) */
  goalMouth: { x: 928, back: 5120, cornerR: 270 },
  /** The centre (RV-102): the disc (r 746, its hole r 288, the arcs on it), the raised trim's band r 752-776 (bent in over
   *  the strips' ends to r 628 for |x| 146), the vent's trim ring r 260-288 */
  centre: { disc: 746, hole: 288, trim: [752, 776] as const, trimNotch: { r: 628, half: 146 }, ventTrim: [260, 288] as const },
  /** A centre-field strip's half width along y (and the halfway strip's along x): wide at the disc, 32 between, flared at
   *  the goal end (to 233, its end flat at y 3326: RV-103d) or the wall (to 269) */
  centreStrip: [[658, 110], [700, 155], [760, 100], [1000, 100], [1160, 32], [2660, 32], [2800, 95], [3060, 95], [3223, 233], [3326, 110]] as readonly P2[],
  halfway: [[659, 110], [700, 155], [760, 100], [1000, 100], [1160, 32], [2920, 32], [3080, 95], [3330, 105], [3514, 269], [3620, 160], [3700, 120], [3842, 110]] as readonly P2[],
  /** The seams: 32 uu round the regions, and between the grass's pieces */
  seam: 32,
  seams: [[[1190, 3238], [1555, 2873], [1570, 2600], [1700, 2470]], [[1990, 2190], [2160, 2064], [3330, 2064]]] as readonly (readonly P2[])[],
  /** The glowing trim line round the panels: this far out from their edge, 9.2 wide; the centre trim's E rings (r 764 on
   *  the raised trim, 272 on the vent's: RV-102) */
  trimLine: { out: 17, width: 9.2, rings: [764, 272] as const, ringWidth: 9.4 },
  /** The team-coloured lines on the strips: at |x| 67.5 (the halfway strip's |y|), 31 wide, along the wide sections */
  stripLines: { at: 67.5, width: 31, centre: [[700, 1000], [2860, 3230]] as const, halfway: [[700, 1000], [3080, 3480]] as const },
  /** The markings: 16 wide (the hatch bars 16.3: RV-103c), the panels' outlines 64 in; the centre's arcs r 714.25,
   *  ending where their 45-degree legs run on |y - x| = 441 (19.1-70.9 degrees: RV-103a), the +y leg to x 128 then
   *  doubling back (to y 527.6, out to (96, 536), down to y 504), the +x leg to x 611.5 then the hook to (553, 32) */
  marking: {
    width: 16,
    hatch: 16.3,
    inset: 64,
    arc: { r: 714.25, from: 19.1, to: 70.9, leg: 441 },
    hookY: [[128, 527.6], [96, 536], [96, 504]] as readonly P2[],
    hookX: { to: 611.5, tail: [[590, 64], [580, 48], [553, 32]] as readonly P2[] },
  },
  /** A goal end's dashes (x 832, 31 long every 62 from y 3264, 17) and hatches (45 degrees, every 48: 11 along the back
   *  from (1232, 4736), 8 by the notch from (128, 3584)); its "=" marks */
  goalMarks: {
    dashes: { x: 832, from: 3264, length: 31, step: 62, count: 17 },
    hatches: [
      { from: [1232, 4736] as const, step: [48, 0] as const, bar: [72, 72] as const, count: 11 },
      { from: [128, 3584] as const, step: [0, 48] as const, bar: [80, 80] as const, count: 8 },
    ],
    equals: [[[1120, 3360], [1184, 3360]], [[1152, 3392], [1216, 3392]], [[1664, 3904], [1728, 3904]], [[1696, 3936], [1760, 3936]]] as readonly (readonly P2[])[],
  },
  /** A side bay's hatches: 14 along the wall from (3712, 656); three clusters of three from (3704, 1672), 272 apart */
  sideMarks: {
    hatches: [
      { from: [3712, 656] as const, step: [0, 48] as const, bar: [72, 72] as const, count: 14 },
      { from: [3704, 1672] as const, step: [0, 272] as const, bar: [86, 86] as const, count: 3 },
      { from: [3720, 1832] as const, step: [0, 272] as const, bar: [80, 80] as const, count: 3 },
      { from: [3728, 1744] as const, step: [0, 272] as const, bar: [56, 56] as const, count: 3 },
      { from: [3384, 680] as const, step: [0, 48] as const, bar: [56, 56] as const, count: 2 },
      { from: [3384, 2200] as const, step: [0, 48] as const, bar: [56, 56] as const, count: 2 },
    ],
  },
  /** The goals' glows (H-5, RV-77, RV-108; the +y goal), 63 wide: round the mouth on the back wall's plane (y 5136), its
   *  free edge in toward the opening, and a band along the floor (z 1 up); on its field side (y 5119, 51 out from the
   *  opening); along the mouth piece's front on the floor; under the crossbar (z 639, |x| 704); the back wall's stepped
   *  outline (z 272.8 out to |x| 2048, up z = 1591.5 - |x|, z 720.8 across the top), its free edge 128 out in the wall's
   *  plane; low beside the goal; inside, its front bands across the floor (z -16) and the roof (z 656) from y 5281 back
   *  to 5344 over |x| 672, rounding into the sides along the goal's profile at |x| 735 (15 out) from y 5344 */
  glow: {
    width: 63,
    wallY: 5136,
    fieldY: 5119,
    out: 51,
    crossbar: { z: 639, x: 704 },
    stepped: { low: 272.8, top: 720.8, slant: 1591.5, to: 2048, out: 128 },
    /** low beside the goal: from |x| 960 to 2048, 14 behind the back wall's face, rising from z 36 to 72, leaning back
     *  116 and up 28 (named measures: RV-114's detector found the old copy of two traced points) */
    beside: { x: [960, 2048], y: 5150, z: [36, 72], lean: [116, 28] },
    inside: { x: 735, out: 15, front: 5281, frontX: 672, floorZ: -16, roofZ: 656 },
  },
  /** The glass beside each goal (RV-72): (|x|, z) from (960, 127) to (1536, 127), up to 256, back to 1408, round via
   *  (1344, 265) onto FF_Goal's line z = 1584 - |x| and up it to |x| 960 */
  sideGlass: { x: [960, 1536] as const, bottom: 127, top: 256, roundTo: [1408, 1344, 265] as const, line: 1584 },
} as const;

// --- Small geometry helpers ------------------------------------------------------------------------------------------

const flat = (pts: readonly P2[]): number[] => pts.flatMap(([x, y]) => [x, y]);
const flat3 = (pts: readonly P3[]): number[] => pts.flatMap(([x, y, z]) => [x, y, z]);

/** A circle's points (anticlockwise; or clockwise for a hole) */
function circle(r: number, segments = 96, clockwise = false): P2[] {
  return Array.from({ length: segments }, (_, k): P2 => {
    const a = ((clockwise ? -k : k) / segments) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/** A closed polygon pushed out by `d` (in for d < 0): each edge moved along its outward normal, corners mitred (the
 *  mitre capped at 4) */
export function offsetPolygon(pts: readonly P2[], d: number): P2[] {
  const n = pts.length;
  const area = pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % n] ?? p;
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const outwardSign = area > 0 ? -1 : 1; // (anticlockwise: the left normal points in)
  const normal = (a: P2, b: P2): P2 => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dy) || 1;
    return [(-dy / l) * outwardSign, (dx / l) * outwardSign];
  };
  return pts.map((p, i): P2 => {
    const a = pts[(i + n - 1) % n] ?? p;
    const b = pts[(i + 1) % n] ?? p;
    const n1 = normal(a, p);
    const n2 = normal(p, b);
    const [mx, my] = [n1[0] + n2[0], n1[1] + n2[1]];
    const l = Math.hypot(mx, my);
    if (l < 1e-6) return [p[0] + n1[0] * d, p[1] + n1[1] * d];
    const k = d / Math.max(0.25, (n1[0] * mx + n1[1] * my) / l);
    return [p[0] + (mx / l) * k, p[1] + (my / l) * k];
  });
}

/** A strip's polygon: `width` round a polyline (open: square ends) */
function stripPolygon(line: readonly P2[], width: number): P2[] {
  const left: P2[] = [];
  const right: P2[] = [];
  line.forEach((p, k) => {
    const a = line[k - 1] ?? p;
    const b = line[k + 1] ?? p;
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dy) || 1;
    const [nx, ny] = [(-dy / l) * (width / 2), (dx / l) * (width / 2)];
    left.push([p[0] + nx, p[1] + ny]);
    right.push([p[0] - nx, p[1] - ny]);
  });
  return [...left, ...right.reverse()];
}

/** A region from a polygon (and holes) */
const region = (mirror: FieldRegion["mirror"], outline: readonly P2[], holes: readonly (readonly P2[])[] = []): FieldRegion =>
  holes.length > 0 ? { mirror, outline: flat(outline), holes: holes.map(flat) } : { mirror, outline: flat(outline) };

/** A ring round a polygon: its outline pushed out by `width`, the polygon its hole */
const ring = (mirror: FieldRegion["mirror"], pts: readonly P2[], width: number): FieldRegion =>
  region(mirror, offsetPolygon(pts, width), [[...pts].reverse()]);

/** A strip shape symmetric about an axis from its half widths along it: `along` "y" (the centre-field strips, x mirrored)
 *  or "x" (the halfway strip, y mirrored) */
function symmetricStrip(half: readonly P2[], along: "x" | "y"): P2[] {
  const side = half.map(([s, w]): P2 => (along === "y" ? [w, s] : [s, w]));
  const other = [...half].reverse().map(([s, w]): P2 => (along === "y" ? [-w, s] : [s, -w]));
  return [...side, ...other];
}

// --- The shippable plan ----------------------------------------------------------------------------------------------

function sideBay(): P2[] {
  const m = FIELD_MEASURES.sideBay;
  const [b0, b1] = m.bumpY;
  const t = m.bumpX - m.x0;
  return [
    [m.x1, m.y0],
    [m.x0 + m.bottomChamfer, m.y0],
    [m.x0, m.y0 + m.bottomChamfer],
    [m.x0, b0 - t],
    [m.bumpX, b0],
    [m.bumpX, b1],
    [m.x0, b1 + t],
    [m.x0, m.topFrom],
    [m.x0 + 70, m.topFrom + 180],
    [m.x1, m.y1],
  ];
}

function padBase(): P2[] {
  const { at, r, corner } = FIELD_MEASURES.padBase;
  return Array.from({ length: 5 }, (_, k): P2 => {
    const a = ((corner + 72 * k) * Math.PI) / 180;
    return [at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)];
  });
}

/** A goal end, whole (both halves: it spans x 0) */
function goalEnd(): P2[] {
  const m = FIELD_MEASURES.goalEnd;
  // (its side: 45 degrees out from the front's corner until x 2013)
  const half: P2[] = [
    [0, m.notchY],
    [m.notchX - (m.notchY - m.front), m.notchY],
    [m.notchX, m.front],
    [m.frontX, m.front],
    [m.sideX, m.front + (m.sideX - m.frontX)],
    [m.sideX, m.back],
    [m.mouthX, m.back],
    [m.mouthX, m.mouthY],
    // (round the mouth piece's front, a seam's width clear of it)
    ...FIELD_MEASURES.mouthFront.slice(1).map(([x, y]): P2 => [x * (m.mouthX / FIELD_MEASURES.goalMouth.x), y - 40]),
  ];
  const mirrored = [...half].reverse().map(([x, y]): P2 => [-x, y]);
  // (half runs from the centre front round to the centre back; the other half back again)
  return [...half, ...mirrored.slice(1, -1)];
}

function goalMouth(): P2[] {
  const m = FIELD_MEASURES.goalMouth;
  const front = FIELD_MEASURES.mouthFront;
  // (its back corner: a quarter circle about (928, 5120), from straight below it round to straight left of it)
  const corner: P2[] = Array.from({ length: 9 }, (_, k): P2 => {
    const a = -Math.PI / 2 - (k / 8) * (Math.PI / 2);
    return [m.x + m.cornerR * Math.cos(a), m.back + m.cornerR * Math.sin(a)];
  });
  const half: P2[] = [...[...front].reverse(), ...corner];
  const mirrored = [...half].reverse().map(([x, y]): P2 => [-x, y]);
  // (the half starts on x 0 at the front and ends at the back wall: only the front's point is shared)
  return [...half, ...mirrored.slice(0, -1)];
}

function grass(): P2[] {
  const g = FIELD_MEASURES.grass;
  const [d0x, d0y, d1x, d1y] = g.diagonal;
  return [
    [0, 0],
    [g.x, 0],
    [g.x, g.cornerFrom],
    [d0x, d0y],
    [d1x, d1y],
    [g.cornerTo, g.y],
    [0, g.y],
  ];
}

function arcPoints(r: number, from: number, to: number, steps = 24): P2[] {
  return Array.from({ length: steps + 1 }, (_, k): P2 => {
    const a = ((from + ((to - from) * k) / steps) * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/** A hatch group: bars (each `bar` long from its start), the starts `step` apart */
function hatches(group: { readonly from: P2; readonly step: P2; readonly bar: P2; readonly count: number }, width: number): number[][] {
  return Array.from({ length: group.count }, (_, k) => {
    const [x, y] = [group.from[0] + group.step[0] * k, group.from[1] + group.step[1] * k];
    return [width, x, y, x + group.bar[0], y + group.bar[1]];
  });
}

/** A closed loop's points as a marking (the first point repeated) */
const loop = (width: number, pts: readonly P2[]): number[] => [width, ...flat([...pts, pts[0] ?? [0, 0]])];

/** The plan builds draw: from FIELD_MEASURES and rules */
export function shippableFieldPlan(): FieldPlan {
  const M = FIELD_MEASURES;
  const bay = sideBay();
  const end = goalEnd();
  const mouth = goalMouth();
  const pad = padBase();
  const markers = M.markers.map((t) => [...t]);
  const centreStrip = symmetricStrip(M.centreStrip, "y");
  const halfway = symmetricStrip(M.halfway, "x");
  const { disc, hole, trim, trimNotch, ventTrim } = M.centre;
  // The centre's trim: its band, and over each strip's end a block in to r 628
  const notches = [0, 1, 2, 3].map((k): P2[] => {
    const a = (k * Math.PI) / 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const h = trimNotch.half;
    const at = (along: number, across: number): P2 => [c * along - s * across, s * along + c * across];
    return [at(trimNotch.r, -h), at(trim[1] - 4, -h), at(trim[1] - 4, h), at(trimNotch.r, h)];
  });
  const markWidth = M.marking.width;
  const glow = goalGlowRibbons();
  return {
    grass: [region("xy", grass())],
    seams: [
      ring("xy", bay, M.seam),
      ring("y", end, M.seam),
      ring("xy", pad, M.seam),
      ...markers.map((t) => ring("xy", t, M.seam)),
      ring("y", centreStrip, M.seam),
      ring("x", halfway, M.seam),
      region("none", circle(trim[1] + M.seam), [circle(disc - 1, 96, true)]),
      ...M.seams.map((line) => region("xy", stripPolygon(line, M.seam))),
    ],
    hexSide: [region("xy", bay)],
    hexPads: [region("xy", pad), ...markers.map((t) => region("xy", t))],
    goalEnds: [region("y", end)],
    goalMouths: [region("y", mouth)],
    centreDisc: [region("none", circle(disc), [circle(hole, 64, true)])],
    centreTrim: [region("none", circle(trim[1]), [circle(trim[0], 96, true)]), ...notches.map((n) => region("none", n)), region("none", circle(ventTrim[1], 64), [circle(ventTrim[0], 64, true)])],
    centreStrips: [region("y", centreStrip)],
    halfway: [region("x", halfway)],
    frameLines: [
      { kind: "E", piece: "trim", mirror: "xy", width: M.trimLine.width, points: flat([...offsetPolygon(bay, M.trimLine.out), offsetPolygon(bay, M.trimLine.out)[0] ?? [0, 0]]) },
      { kind: "E", piece: "trim", mirror: "y", width: M.trimLine.width, points: flat([...offsetPolygon(end, M.trimLine.out), offsetPolygon(end, M.trimLine.out)[0] ?? [0, 0]]) },
      ...M.trimLine.rings.map((r): FrameLine => ({ kind: "E", piece: "centreTrim", mirror: "none", width: M.trimLine.ringWidth, points: flat([...circle(r), [r, 0]]) })),
      ...M.stripLines.centre.map(([y0, y1]): FrameLine => ({ kind: "D", piece: "centreStrip", mirror: "xy", width: M.stripLines.width, points: [M.stripLines.at, y0, M.stripLines.at, y1] })),
      ...M.stripLines.halfway.map(([x0, x1]): FrameLine => ({ kind: "D", piece: "halfway", mirror: "xy", width: M.stripLines.width, points: [x0, M.stripLines.at, x1, M.stripLines.at] })),
    ],
    markings: {
      goal: [
        // (the goal end's outline 64 in: its x >= 0 half, the piece mirrored four ways)
        [markWidth, ...flat(offsetPolygon(end, -M.marking.inset).filter(([x]) => x >= 0))],
        ...Array.from({ length: M.goalMarks.dashes.count }, (_, k) => {
          const d = M.goalMarks.dashes;
          const y = d.from + d.step * k;
          return [markWidth, d.x, y, d.x, y + d.length];
        }),
        ...M.goalMarks.hatches.flatMap((g) => hatches(g, M.marking.hatch)),
        ...M.goalMarks.equals.map(([a, b]) => [M.marking.hatch, ...(a ?? [0, 0]), ...(b ?? [0, 0])]),
      ],
      side: [loop(markWidth, offsetPolygon(bay, -M.marking.inset)), ...M.sideMarks.hatches.flatMap((g) => hatches(g, M.marking.hatch))],
      centre: [[markWidth, ...flat(centreArcMarking())]],
    },
    goalGlow: glow,
    goalSideGlass: sideGlass(),
  };
}

/** The centre's painted arc (AV-7, RV-103a): FIELD_MEASURES.marking's arc, legs and hooks */
function centreArcMarking(): P2[] {
  const m = FIELD_MEASURES.marking;
  const { r, from, to, leg } = m.arc;
  const arc = arcPoints(r, from, to);
  // (the legs along 45 degrees: the +x one on x - y = 441 in to x 611.5, the +y one on y - x = 441 in to x 128)
  const toX: P2[] = [...[...m.hookX.tail].reverse(), [m.hookX.to, m.hookX.to - leg]];
  const toY: P2[] = [[128, 128 + leg], ...m.hookY];
  return [...toX, ...arc, ...toY];
}

/** The glass beside a goal's mouth: (|x|, z) round from the bottom inside corner */
function sideGlass(): (readonly [number, number])[] {
  const g = FIELD_MEASURES.sideGlass;
  const [x0, x1] = g.x;
  const [roundEnd, roundMid, roundZ] = g.roundTo;
  const onLine = (x: number): number => g.line - x;
  return [
    [x0, g.bottom],
    [x1, g.bottom],
    [x1, g.top],
    [roundEnd, g.top],
    [roundMid, roundZ],
    [1280, onLine(1280)],
    [x0, onLine(x0)],
  ];
}

/** The goal's glows (the +y goal's), built along our own arena's goal (src/render/arenaSurface.ts mouthOutline,
 *  src/render/goalSurface.ts goalPath) with FIELD_MEASURES.glow's widths */
function goalGlowRibbons(): GlowRibbon[] {
  const g = FIELD_MEASURES.glow;
  const ribbons: GlowRibbon[] = [];
  const push = (attached: readonly P3[], free: readonly P3[]): void => {
    ribbons.push({ attached: flat3(attached), free: flat3(free) });
  };
  // The opening's outline (x, z), whole: one post up from the floor, the crossbar, the other post down
  const half = mouthOutline(0);
  const [firstHalf] = half;
  const opening: P2[] = [...(firstHalf ? [[firstHalf[0], 0] as P2] : []), ...half];
  const whole: P2[] = [...opening, ...[...opening].reverse().slice(1).map(([x, z]): P2 => [-x, z])];
  // its outward normals (away from the opening, in its plane)
  const outward = whole.map((p, k): P2 => {
    const a = whole[k - 1] ?? p;
    const b = whole[k + 1] ?? p;
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dz) || 1;
    const n: P2 = [dz / l, -dx / l];
    // (pointing away from the opening's centre (0, 300))
    return n[0] * p[0] + n[1] * (p[1] - 300) >= 0 ? n : [-n[0], -n[1]];
  });
  // Round the opening on the back wall's plane: its free edge 63 in toward the opening; along the floor, a band up
  push(
    whole.map(([x, z]): P3 => [x, g.wallY, z]),
    whole.map(([x, z], k): P3 => [x - (outward[k]?.[0] ?? 0) * g.width, g.wallY, Math.max(0, z - (outward[k]?.[1] ?? 0) * g.width)]),
  );
  const postX = (firstHalf?.[0] ?? 893) - g.width;
  push(
    [[-postX, g.wallY, 1], [postX, g.wallY, 1]],
    [[-postX, g.wallY, 1 + g.width], [postX, g.wallY, 1 + g.width]],
  );
  // On its field side, 51 out from the opening: toward the field
  push(
    whole.map(([x, z], k): P3 => [x + (outward[k]?.[0] ?? 0) * g.out, g.fieldY, Math.max(0, z + (outward[k]?.[1] ?? 0) * g.out)]),
    whole.map(([x, z], k): P3 => [x + (outward[k]?.[0] ?? 0) * g.out, g.fieldY - g.width, Math.max(0, z + (outward[k]?.[1] ?? 0) * g.out)]),
  );
  // Under the crossbar
  push(
    [[-g.crossbar.x, g.wallY, g.crossbar.z], [g.crossbar.x, g.wallY, g.crossbar.z]],
    [[-g.crossbar.x, g.wallY, g.crossbar.z - g.width], [g.crossbar.x, g.wallY, g.crossbar.z - g.width]],
  );
  // Along the mouth piece's front on the floor, standing up
  const front = FIELD_MEASURES.mouthFront;
  const frontWhole: P2[] = [...front.map(([x, y]): P2 => [x, y]), ...[...front].reverse().slice(1).map(([x, y]): P2 => [-x, y])];
  push(
    frontWhole.map(([x, y]): P3 => [x, y, 1]),
    frontWhole.map(([x, y]): P3 => [x, y, 1 + g.width]),
  );
  // The back wall's stepped outline: low out to |x| 2048, up the slant, across the top; its free edge 128 out in the
  // wall's plane (mitred: up from the low and top parts, out along the slant's normal)
  const st = g.stepped;
  const corner = [st.slant - st.low, st.slant - st.top];
  const mitre = st.out * (Math.SQRT2 - 1);
  const attachedSteps: P3[] = [];
  const freeSteps: P3[] = [];
  for (const [x, z, dx] of [[-st.to, st.low, 0], [-(corner[0] ?? 0), st.low, -mitre], [-(corner[1] ?? 0), st.top, -mitre], [corner[1] ?? 0, st.top, mitre], [corner[0] ?? 0, st.low, mitre], [st.to, st.low, 0]] as const) {
    attachedSteps.push([x, g.wallY, z]);
    // (at the slant's corners the free edge's lines meet 128 (sqrt 2 - 1) further out)
    freeSteps.push([x + dx, g.wallY, z + st.out]);
  }
  push(attachedSteps, freeSteps);
  // Low beside the goal, leaning back
  const bs = g.beside;
  for (const s of [-1, 1]) {
    push(
      [[s * bs.x[1], bs.y, bs.z[1]], [s * bs.x[0], bs.y, bs.z[0]]],
      [[s * bs.x[1], bs.y + bs.lean[0], bs.z[1] + bs.lean[1]], [s * bs.x[0], bs.y + bs.lean[0], bs.z[0] + bs.lean[1]]],
    );
  }
  // Inside: along the goal's profile at |x| 735 (15 out into the net), 63 toward the centre, from y 5344; and the front
  // bands across the floor and the roof, from y 5281 back to 5344 over |x| 672, rounding (r 63) into the sides
  const i = g.inside;
  const sideFrom = i.front + g.width;
  const profile = goalPath().map(([behind, z]): P2 => [5120 + behind, z]);
  const outProfile = profile
    .map(([y, z], k): P2 => {
      const a = profile[k - 1] ?? [y, z];
      const b = profile[k + 1] ?? [y, z];
      const [dy, dz] = [b[0] - a[0], b[1] - a[1]];
      const l = Math.hypot(dy, dz) || 1;
      // (the profile runs from the floor round the back to the roof: its right normal points out of the goal)
      return [y + (dz / l) * i.out, z - (dy / l) * i.out];
    })
    .filter(([y]) => y >= sideFrom);
  const sides: P2[] = [[sideFrom, i.floorZ], ...outProfile, [sideFrom, i.roofZ]];
  for (const sx of [-1, 1]) {
    push(
      sides.map(([y, z]): P3 => [sx * i.x, y, z]),
      sides.map(([y, z]): P3 => [sx * (i.x - g.width), y, z]),
    );
  }
  for (const z of [i.floorZ, i.roofZ]) {
    const attached: P3[] = [];
    const free: P3[] = [];
    // (the left corner's arc, the straight front, the right corner's arc: the free edge the arcs' centres)
    for (let k = 0; k <= 4; k++) {
      const a = (Math.PI / 2) * (k / 4);
      attached.push([-(i.frontX + g.width * Math.cos(a)), sideFrom - g.width * Math.sin(a), z]);
      free.push([-i.frontX, sideFrom, z]);
    }
    for (let k = 4; k >= 0; k--) {
      const a = (Math.PI / 2) * (k / 4);
      attached.push([i.frontX + g.width * Math.cos(a), sideFrom - g.width * Math.sin(a), z]);
      free.push([i.frontX, sideFrom, z]);
    }
    push(attached, free);
  }
  return ribbons;
}

// --- The local plan (dev only) ---------------------------------------------------------------------------------------

function isFieldPlan(data: unknown): data is FieldPlan {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  const keys: (keyof FieldPlan)[] = ["grass", "hexSide", "hexPads", "goalEnds", "goalMouths", "centreDisc", "centreTrim", "centreStrips", "halfway", "frameLines", "goalGlow", "goalSideGlass"];
  return keys.every((k) => Array.isArray(d[k])) && typeof d["markings"] === "object" && d["markings"] !== null;
}

let gamePlan: FieldPlan | null = null;
let shippable: FieldPlan | null = null;

/** Loads the shapes traced from the game's meshes if the dev server has them (/local-assets/, vite.config.ts); whether
 *  it did. `?field=rules` keeps the plan builds draw, for comparing */
export async function loadGameFieldPlan(): Promise<boolean> {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get("field") === "rules") return false;
  try {
    const response = await fetch("/local-assets/arena/field_plan.json");
    if (!response.ok) return false;
    const data: unknown = await response.json();
    if (!isFieldPlan(data)) return false;
    gamePlan = data;
    return true;
  } catch {
    return false;
  }
}

/** The plan to draw: the game's traced shapes where loaded (the dev server), else the one built from measurements */
export function fieldPlan(): FieldPlan {
  if (gamePlan) return gamePlan;
  shippable ??= shippableFieldPlan();
  return shippable;
}
