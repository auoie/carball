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
  /** The attached edge's glow (UV0.x: 1 unless said, the beside ribbon's 0.969: AV-11) */
  readonly glow?: number;
  /** Which of the goal's glows (the rules' plan says; a traced one doesn't) */
  readonly part?: GlowPart;
}

/** The goal's glows by part: round the mouth on the back wall, its field side's fin, under the crossbar, the back wall's
 *  stepped outline, beside the goal, inside it */
export type GlowPart = "mouth" | "fieldSide" | "crossbar" | "stepped" | "beside" | "inside";

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
  /** A goal end (x >= 0 half): its front at y 3106 from x 424 (a 45-degree notch in to y 3360 at the centre); its side
   *  out along y - x = 2096.1 with a middle run 2201.5 between two jogs (symmetric about x + y = 5120: RV-103e), its
   *  corners r 275, the jogs' r 59 and 95; out to x 2014, back to y 4864, round the mouth piece (x 962 down to y 4580) */
  goalEnd: {
    front: 3106,
    notchX: 424,
    notchY: 3360,
    run: 2096.1,
    jogs: [[1262.0, 3358.1], [1262.0, 3463.5], [1656.5, 3858.0], [1761.9, 3858.0]] as readonly P2[],
    jogR: [59, 95] as const,
    cornerR: 275,
    outerX: 2014,
    back: 4864,
    mouthX: 962,
    mouthY: 4580,
  },
  /** The mouth piece's front, shared with the goal end's notch: from x 928 at y 4583 round to the centre (y 4350) */
  mouthFront: [[928, 4583], [850, 4462], [520, 4300], [260, 4260], [160, 4340], [0, 4350]] as readonly P2[],
  /** The mouth piece: |x| 928, to the back wall (y 5120), its back corners rounded r 270 about (928, 5120) */
  goalMouth: { x: 928, back: 5120, cornerR: 270 },
  /** The centre (RV-102): the disc (r 746, its hole r 288, the arcs on it), the raised trim's band r 752-776 (bent in over
   *  the strips' ends to r 628 for |x| 146), the vent's trim ring r 260-288 */
  centre: { disc: 746, hole: 288, trim: [752, 776] as const, trimNotch: { r: 628, half: 146 }, ventTrim: [260, 288] as const },
  /** A centre-field strip's half width along y (and the halfway strip's along x): wide at the disc, 32 between, flared at
   *  the goal end (to 233, its end flat at y 3326, 96 each side: RV-103d) or the wall (to 269) */
  centreStrip: [[658, 110], [700, 155], [760, 100], [1000, 100], [1160, 32], [2660, 32], [2800, 95], [3060, 95], [3223, 233], [3326, 96]] as readonly P2[],
  halfway: [[659, 110], [700, 155], [760, 100], [1000, 100], [1160, 32], [2920, 32], [3080, 95], [3330, 105], [3514, 269], [3620, 160], [3700, 120], [3842, 110]] as readonly P2[],
  /** The seams: 32 uu round the regions, and between the grass's pieces */
  seam: 32,
  seams: [[[1190, 3238], [1555, 2873], [1570, 2600], [1700, 2470]], [[1990, 2190], [2160, 2064], [3330, 2064]]] as readonly (readonly P2[])[],
  /** The glowing trim line (E, RV-103f): one 9.1-wide strip a quadrant, from the wall at y 127 round the boost bay 19
   *  outside (y 127, x + y = 3806.5, x 3311, y - x = -2382.5, the bump x 3439, x + y = 5326.5, x 3311, y - x = -698), up
   *  the wall at x 3823, curving (r 655) onto the corner's diagonal x + y = 7678 and onto the back, y 4847, to x 2064, round
   *  the goal end 19 outside (x 2033, y - x = 2069, the jogs at y 3839 and x 1281 with the middle run 2174.5, the front y
   *  3087, the notch's diagonal x + y = 3477, its top y 3343 to the centre); the centre trim's E rings (r 764 on the
   *  raised trim, 272 on the vent's: RV-102) */
  trimLine: {
    width: 9.1,
    start: [3840, 127] as P2,
    bay: { low: 3806.5, x: 3311, rampLow: -2382.5, bump: 3439, rampHigh: 5326.5, top: -698 },
    wallX: 3823,
    corner: { diag: 7678, r: 655 },
    back: 4847,
    goal: { backX: 2064, outerX: 2033, run: 2069, jogY: 3839, middle: 2174.5, jogX: 1281, front: 3087, notch: 3477, notchTop: 3343 },
    radius: 30,
    rings: [764, 272] as const,
    ringWidth: 9.4,
  },
  /** The team-coloured lines on the strips: at |x| 67.5 (the halfway strip's |y|), 31 wide, along the wide sections */
  stripLines: { at: 67.5, width: 31, centre: [[700, 1000], [2860, 3230]] as const, halfway: [[700, 1000], [3080, 3480]] as const },
  /** The markings: 16 wide (the hatch bars 16.3: RV-103c), the panels' outlines 64 in; the centre's arcs r 714.25,
   *  ending where their 45-degree legs run on |y - x| = 441 (19.1-70.9 degrees: RV-103a), the +y leg on to x 96 (y 537)
   *  then down it to y 504, the +x leg on to x 590 (y 149) then down it and round to (553, 32) (RV-141) */
  marking: {
    width: 16,
    hatch: 16.3,
    inset: 64,
    arc: { r: 714.25, from: 19.1, to: 70.9, leg: 441 },
    hookY: { to: 96, end: 504 },
    hookX: { to: 590, tail: [[590, 64], [580, 48], [553, 32]] as readonly P2[] },
    /** the joins' radii on the centreline: where the legs meet the arc, and where they turn down x 96 and 590 (RV-141:
     *  raster IoU 0.928 against Field_Center_Lines, from 0.861 unrounded; the short down along x 96 fits r 79 at most) */
    joins: { arc: 50, downX: 110, downY: 75 },
  },
  /** A goal end's painted lines (Goal_Lines, RV-103b): three open pieces (the centre's x 128, the notch's diagonal x + y
   *  = 3594.6, the front y 3170, the side y - x = 2187, the outer x 1950, the back y 4800, the mouth's x 1026, its slope y
   *  = x / 2 + 3926, its front y 4158; their corners' radii), between them rows of 45-degree strokes (by the notch: y - x
   *  = 3408 + 48 k from x 128 to 208; along the back: from (1184 + 48 k, 4736), 72 by 72), the outermost of each a piece's
   *  hook; the "=" marks (x from y - 2240 to y - 2176), the outermost two hooks too; the dashes (x 832, y 3264-4288 in 33
   *  parts, the even ones painted) */
  goalLines: {
    centreX: 128,
    notchDiag: 3594.6,
    front: 3170,
    sideDiag: 2187,
    outerX: 1950,
    back: 4800,
    mouthX: 1026,
    mouthSlope: 3926,
    mouthFront: 4158,
    radii: { square: 32, frontSide: 211, sideOuter: 211, notchFront: 57, mouthX: 270, mouthFront: 589, uTurn: 12 },
    notchRow: { x: [128, 208] as const, diag0: 3408, step: 48, count: 10 },
    backRow: { y: [4736, 4808] as const, x0: 1184, step: 48, count: 12 },
    equals: { ys: [3328, 3360, 3392, 3904, 3936, 3968] as const, diag: [2176, 2240] as const },
    dashes: { x: 832, y: [3264, 4288] as const, parts: 33 },
  },
  /** A side bay's painted lines (Field_Side_Lines, RV-103b): three open pieces (the wall's x 3776, the inner x 3394, the
   *  bottom y 338, the low diagonal x + y = 3924, the top's y - x = -829.3; each ending in a 45-degree stroke, y - x the
   *  given), the wall's row of strokes (from (3712, 656 + 48 k), 72 by 72), the inner rows' (from (3384, y), 56 by 56), the
   *  clusters (every 272 from y 1400: strokes a-d, [x, dy, length]) */
  sideLines: {
    wallX: 3776,
    innerX: 3394,
    bottom: 338,
    lowDiag: 3924,
    topDiag: -829.3,
    radii: { wallBottom: 32, low: 72, wallTop: 26.5, topInner: 243, uTurn: 12 },
    ends: { s1Wall: -3107, s1Inner: -2752, s2Wall: -2432, s2End: -2160, s3Wall: -1216, s3Inner: -1088 },
    wallRow: { x: [3712, 3784] as const, y0: 656, step: 48, count: 13 },
    innerRows: { x: [3384, 3440] as const, ys: [680, 728, 2200, 2248] as const },
    clusters: { y0: 1400, step: 272, count: 5, strokes: [[3704, 0, 86], [3728, 72, 56], [3728, 120, 56], [3720, 160, 80]] as readonly (readonly [number, number, number])[] },
  },
  /** The goals' glows (H-5, RV-77, RV-108; the +y goal), 63 wide: round the mouth on the back wall's plane (y 5136), its
   *  free edge in toward the opening, and a band along the floor (z 1 up); on its field side one loop (RV-143): 51 out
   *  from the opening up the posts and over (y 5119), down each post to z 96, round a fillet (r 95 about y 5024, z 96)
   *  onto the floor, and on the floor round the mouth piece's front: along |x| 944, onto y = |x| / 2 + 4018 (r 191), onto
   *  y 4240 (r 525), onto y = 4480 - |x| (r 77), onto y 4336 across (r 78); under the crossbar (z 639, |x| 704); the back
   *  wall's stepped outline (z 272.8 out to |x| 2048, up z = 1591.5 - |x|, z 720.8 across the top), its free edge 128 out
   *  in the wall's plane; low beside the goal; inside, its front bands across the floor (z -16) and the roof (z 656) from
   *  y 5281 back to 5344 over |x| 672, rounding into the sides along the goal's profile at |x| 735 (15 out) from y 5344 */
  glow: {
    width: 63,
    wallY: 5136,
    fieldY: 5119,
    out: 51,
    /** the field side's loop up the posts and over (RV-168c: its own measures, not the opening's outline offset): the
     *  posts at |x| 944, the top at z 688, its corners r 144 */
    fieldSide: { x: 944, top: 688, cornerR: 144 },
    crossbar: { z: 639, x: 704 },
    /** the field side's loop on the floor (RV-143): the fillet onto it, the lines round the mouth piece's front (y = a |x|
     *  + b) and their fillets' radii */
    mouthFloor: { fillet: { y: 5024, z: 96, r: 95 }, diagonal: [0.5, 4018] as const, front: 4240, slant: [-1, 4480] as const, centre: 4336, radii: [191, 525, 77, 78] as const },
    /** the back wall's stepped outline (AV-11): z 272.8 to |x| 1360, a bend of r 96, the 45 degree line z = 1591.5 - |x|,
     *  a bend of r 128, across at z 720.8; its free edge 128 out in the wall's plane */
    stepped: { low: 272.8, top: 720.8, slant: 1591.5, to: 2048, out: 128, bends: [96, 128] as const },
    /** low beside the goal: from |x| 960 to 2048, 14 behind the back wall's face, leaning back 116 and up 28; at z 72 from
     *  2048 in, down a slope of 0.148 (through |x| 1088, z 44) to z 34 by 960, its bends r 900 and 800 (named measures:
     *  RV-114's detector found the old copy of two traced points; RV-143) */
    beside: { x: [960, 2048], y: 5150, z: [34, 72], slope: { at: [1088, 44], rise: 0.148 }, radii: [900, 800], lean: [116, 28], glow: 0.969 },
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
  // (its side: the run from the front's corner, the jogs and the middle run, the run out to x 2014; rounded)
  const [j0, j1, j2, j3] = m.jogs;
  const side = rounded(
    [[m.notchX, m.front], [m.front - m.run, m.front], j0 ?? [0, 0], j1 ?? [0, 0], j2 ?? [0, 0], j3 ?? [0, 0], [m.outerX, m.outerX + m.run], [m.outerX, m.back]],
    [0, m.cornerR, m.jogR[0], m.jogR[1], m.jogR[1], m.jogR[0], m.cornerR, 0],
  );
  const half: P2[] = [
    [0, m.notchY],
    [m.notchX - (m.notchY - m.front), m.notchY],
    ...side,
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

/** An open polyline with its corners rounded: `radii[i]` at `points[i]` (0, and at its ends: sharp) */
function rounded(points: readonly P2[], radii: readonly number[]): P2[] {
  const out: P2[] = [];
  points.forEach((p, i) => {
    const [a, b, r] = [points[i - 1], points[i + 1], radii[i] ?? 0];
    if (!a || !b || r <= 0) {
      out.push(p);
      return;
    }
    const unit = (u: P2, v: P2): P2 => {
      const l = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
      return [(v[0] - u[0]) / l, (v[1] - u[1]) / l];
    };
    const [d1, d2] = [unit(a, p), unit(p, b)];
    const turn = Math.acos(Math.min(Math.max(d1[0] * d2[0] + d1[1] * d2[1], -1), 1));
    if (turn < 1e-6) {
      out.push(p);
      return;
    }
    // (the arc's ends where it meets each side, its centre r from both toward the turn)
    const t = r * Math.tan(turn / 2);
    const side = d1[0] * d2[1] - d1[1] * d2[0] > 0 ? 1 : -1;
    const start: P2 = [p[0] - d1[0] * t, p[1] - d1[1] * t];
    const centre: P2 = [start[0] - side * d1[1] * r, start[1] + side * d1[0] * r];
    const a0 = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
    const steps = Math.max(2, Math.ceil(turn / (Math.PI / 24)));
    for (let k = 0; k <= steps; k++) {
      const angle = a0 + side * turn * (k / steps);
      out.push([centre[0] + r * Math.cos(angle), centre[1] + r * Math.sin(angle)]);
    }
  });
  return out;
}

/** A 45-degree stroke from (x, y), `size` up and across: as a marking */
const stroke = (width: number, x: number, y: number, size: number): number[] => [width, x, y, x + size, y + size];

/** Goal_Lines (RV-103b): its three open pieces, the stroke rows between them, the "=" marks, the dashes */
function goalLineMarkings(width: number, strokeWidth: number): number[][] {
  const g = FIELD_MEASURES.goalLines;
  const r = g.radii;
  const notch = (k: number): [P2, P2] => {
    const c = g.notchRow.diag0 + g.notchRow.step * k;
    return [[g.notchRow.x[0], g.notchRow.x[0] + c], [g.notchRow.x[1], g.notchRow.x[1] + c]];
  };
  const backStroke = (k: number): [P2, P2] => {
    const x = g.backRow.x0 + g.backRow.step * k;
    const size = g.backRow.y[1] - g.backRow.y[0];
    return [[x, g.backRow.y[0]], [x + size, g.backRow.y[1]]];
  };
  const bar = (y: number): [P2, P2] => [[y - g.equals.diag[1], y], [y - g.equals.diag[0], y]];
  const [n0, n9] = [notch(0), notch(g.notchRow.count - 1)];
  const [b0, b11] = [backStroke(0), backStroke(g.backRow.count - 1)];
  const [e0, e5] = [bar(g.equals.ys[0]), bar(g.equals.ys[5])];
  const mouthAt = (x: number): number => x / 2 + g.mouthSlope;
  // A: the notch's first stroke, down the centre, the notch's diagonal, the front, up the side to the first "=" mark
  const a = rounded(
    [n0[1], n0[0], [g.centreX, g.notchDiag - g.centreX], [g.notchDiag - g.front, g.front], [g.front - g.sideDiag, g.front], [e0[0][1] - g.sideDiag, e0[0][1]], e0[0]],
    [0, r.square, r.square, r.notchFront, r.frontSide, r.uTurn, 0],
  );
  // B: the last "=" mark, up the side, the outer edge, the back, down the back row's last stroke
  const b = rounded(
    [e5[0], [e5[0][1] - g.sideDiag, e5[0][1]], [g.outerX, g.outerX + g.sideDiag], [g.outerX, g.back], [g.back - (b11[0][1] - b11[0][0]), g.back], b11[0]],
    [0, r.uTurn, r.sideOuter, r.square, r.uTurn, 0],
  );
  // C: the back row's first stroke, the back, the mouth's side, its slope, its front, down the centre to the notch's
  // last stroke
  const c = rounded(
    [b0[0], [g.back - (b0[0][1] - b0[0][0]), g.back], [g.mouthX, g.back], [g.mouthX, mouthAt(g.mouthX)], [2 * (g.mouthFront - g.mouthSlope), g.mouthFront], [g.centreX, g.mouthFront], n9[0], n9[1]],
    [0, r.uTurn, r.square, r.mouthX, r.mouthFront, r.square, r.uTurn, 0],
  );
  const pieces = [a, b, c].map((pts) => [width, ...flat(pts)]);
  const rows = [
    ...Array.from({ length: g.notchRow.count - 2 }, (_, k) => [strokeWidth, ...flat(notch(k + 1))]),
    ...Array.from({ length: g.backRow.count - 2 }, (_, k) => [strokeWidth, ...flat(backStroke(k + 1))]),
    ...g.equals.ys.slice(1, -1).map((y) => [strokeWidth, ...flat(bar(y))]),
  ];
  const part = (g.dashes.y[1] - g.dashes.y[0]) / g.dashes.parts;
  const dashes = Array.from({ length: Math.ceil(g.dashes.parts / 2) }, (_, k) => {
    const y = g.dashes.y[0] + 2 * k * part;
    return [width, g.dashes.x, y, g.dashes.x, y + part];
  });
  return [...pieces, ...rows, ...dashes];
}

/** Field_Side_Lines (RV-103b): its three open pieces, the wall's row, the inner rows, the clusters */
function sideLineMarkings(width: number, strokeWidth: number): number[][] {
  const s = FIELD_MEASURES.sideLines;
  const r = s.radii;
  const e = s.ends;
  // (a piece's end stroke on y - x = c from x0 to x1)
  const onEnd = (c: number, x: number): P2 => [x, x + c];
  const wallIn = s.wallRow.x[0];
  const innerOut = s.innerRows.x[1];
  const one = rounded(
    [onEnd(e.s1Wall, wallIn), onEnd(e.s1Wall, s.wallX), [s.wallX, s.bottom], [s.lowDiag - s.bottom, s.bottom], [s.innerX, s.lowDiag - s.innerX], onEnd(e.s1Inner, s.innerX), onEnd(e.s1Inner, innerOut)],
    [0, r.uTurn, r.wallBottom, r.low, r.low, r.uTurn, 0],
  );
  const two = rounded([onEnd(e.s2Wall, wallIn), onEnd(e.s2Wall, s.wallX), onEnd(e.s2End, s.wallX), onEnd(e.s2End, wallIn)], [0, r.uTurn, r.uTurn, 0]);
  const three = rounded(
    [onEnd(e.s3Wall, wallIn), onEnd(e.s3Wall, s.wallX), [s.wallX, s.wallX + s.topDiag], [s.innerX, s.innerX + s.topDiag], onEnd(e.s3Inner, s.innerX), onEnd(e.s3Inner, innerOut)],
    [0, r.uTurn, r.wallTop, r.topInner, r.uTurn, 0],
  );
  const wallSize = s.wallRow.x[1] - s.wallRow.x[0];
  const innerSize = s.innerRows.x[1] - s.innerRows.x[0];
  return [
    ...[one, two, three].map((pts) => [width, ...flat(pts)]),
    ...Array.from({ length: s.wallRow.count }, (_, k) => stroke(strokeWidth, s.wallRow.x[0], s.wallRow.y0 + s.wallRow.step * k, wallSize)),
    ...s.innerRows.ys.map((y) => stroke(strokeWidth, s.innerRows.x[0], y, innerSize)),
    ...Array.from({ length: s.clusters.count }, (_, k) => s.clusters.strokes.map(([x, dy, size]) => stroke(strokeWidth, x, s.clusters.y0 + s.clusters.step * k + dy, size))).flat(),
  ];
}

/** The E trim line's path in a quadrant (RV-103f), from the wall at y 127 to the goal end's notch on the centre */
function trimEPath(): P2[] {
  const t = FIELD_MEASURES.trimLine;
  const b = t.bay;
  const g = t.goal;
  const R = t.radius;
  const points: P2[] = [
    t.start,
    [b.low - t.start[1], t.start[1]],
    [b.x, b.low - b.x],
    [b.x, b.x + b.rampLow],
    [b.bump, b.bump + b.rampLow],
    [b.bump, b.rampHigh - b.bump],
    [b.x, b.rampHigh - b.x],
    [b.x, b.x + b.top],
    [t.wallX, t.wallX + b.top],
    [t.wallX, t.corner.diag - t.wallX],
    [t.corner.diag - t.back, t.back],
    [g.backX, t.back],
    [g.outerX, t.back - (g.backX - g.outerX)],
    [g.outerX, g.outerX + g.run],
    [g.jogY - g.run, g.jogY],
    [g.jogY - g.middle, g.jogY],
    [g.jogX, g.jogX + g.middle],
    [g.jogX, g.jogX + g.run],
    [g.front - g.run, g.front],
    [g.notch - g.front, g.front],
    [g.notch - g.notchTop, g.notchTop],
    [0, g.notchTop],
  ];
  const radii = points.map((_, i) => (i === 9 || i === 10 ? t.corner.r : R));
  return rounded(points, radii);
}


/** The pieces the grass leaves holes for, by the rules (AV-6a: its edges): each polygon with its mirror */
export function grassHoles(): readonly { readonly mirror: FieldRegion["mirror"]; readonly pts: readonly P2[] }[] {
  const M = FIELD_MEASURES;
  return [
    { mirror: "xy", pts: sideBay() },
    { mirror: "y", pts: goalEnd() },
    { mirror: "y", pts: goalMouth() },
    { mirror: "xy", pts: padBase() },
    ...M.markers.map((t) => ({ mirror: "xy" as const, pts: [...t] })),
    { mirror: "y", pts: symmetricStrip(M.centreStrip, "y") },
    { mirror: "x", pts: symmetricStrip(M.halfway, "x") },
  ];
}

/** The grass's outline (its quadrant) and its centre edge's radius (AV-6a: r 782) */
export function grassOutline(): { readonly outline: readonly P2[]; readonly centre: number } {
  return { outline: grass(), centre: 782 };
}

/** The grass's rim (AV-6a): a band `width` wide inside every grass edge: round each hole, the centre's (r 782 out), and
 *  along its straight outer sides (none along the 45 degree corner cut) */
export function grassRim(width: number): FieldRegion[] {
  const g = FIELD_MEASURES.grass;
  const { centre } = grassOutline();
  return [
    ...grassHoles().map((h) => ring(h.mirror, h.pts, width)),
    region("none", circle(centre + width, 128), [circle(centre, 128, true)]),
    region("xy", [[g.x - width, 0], [g.x, 0], [g.x, g.cornerFrom], [g.x - width, g.cornerFrom]]),
    region("xy", [[0, g.y - width], [g.cornerTo, g.y - width], [g.cornerTo, g.y], [0, g.y]]),
  ];
}

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
      { kind: "E", piece: "trim", mirror: "xy", width: M.trimLine.width, points: flat(trimEPath()) },
      ...M.trimLine.rings.map((r): FrameLine => ({ kind: "E", piece: "centreTrim", mirror: "none", width: M.trimLine.ringWidth, points: flat([...circle(r), [r, 0]]) })),
      ...M.stripLines.centre.map(([y0, y1]): FrameLine => ({ kind: "D", piece: "centreStrip", mirror: "xy", width: M.stripLines.width, points: [M.stripLines.at, y0, M.stripLines.at, y1] })),
      ...M.stripLines.halfway.map(([x0, x1]): FrameLine => ({ kind: "D", piece: "halfway", mirror: "xy", width: M.stripLines.width, points: [x0, M.stripLines.at, x1, M.stripLines.at] })),
    ],
    markings: {
      goal: goalLineMarkings(markWidth, M.marking.hatch),
      side: sideLineMarkings(markWidth, M.marking.hatch),
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
  // (the legs along 45 degrees: the +x one on x - y = 441 in to x 590 and down it, the +y one on y - x = 441 in to x 96
  // and down it; their joins rounded: RV-141)
  const toX: P2[] = [...[...m.hookX.tail].reverse(), [m.hookX.to, m.hookX.to - leg]];
  const toY: P2[] = [[m.hookY.to, m.hookY.to + leg], [m.hookY.to, m.hookY.end]];
  // (the joins rounded: the legs into the arc's ends, and into the downs)
  const points = [...toX, ...arc, ...toY];
  const radii = points.map((_, k) => (k === toX.length - 1 ? m.joins.downX : k === toX.length + arc.length ? m.joins.downY : k === toX.length || k === toX.length + arc.length - 1 ? m.joins.arc : 0));
  return rounded(points, radii);
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
/** The goal's glows by the rules (the +y goal's), each with its part */
export function goalGlowRibbons(): GlowRibbon[] {
  const g = FIELD_MEASURES.glow;
  const ribbons: GlowRibbon[] = [];
  let part: GlowPart = "mouth";
  const push = (attached: readonly P3[], free: readonly P3[], glow?: number): void => {
    ribbons.push({ attached: flat3(attached), free: flat3(free), part, ...(glow === undefined ? {} : { glow }) });
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
  // Round the opening on the back wall's plane, one loop (RV-143): down each post to z 96, round the fillet (r 95) onto
  // the floor and across it; its free edge 63 in toward the opening, the fillet's concentric arc (r 32), 63 up on the
  // floor
  const mf = g.mouthFloor;
  const inner = mf.fillet.r - g.width;
  const floorZ = mf.fillet.z - mf.fillet.r;
  /** A quarter circle about (cx, cz) of radius r, from its side (cx + side r, cz) down to its foot (cx, cz - r), or
   *  back up */
  const quarter = (cx: number, cz: number, r: number, side: number, down: boolean): P2[] =>
    Array.from({ length: 9 }, (_, k) => {
      const t = ((down ? k : 8 - k) / 8) * (Math.PI / 2);
      return [cx + side * r * Math.cos(t), cz - r * Math.sin(t)];
    });
  const ringKeep = whole.map(([, z]) => z > mf.fillet.z);
  const ringOver = whole.filter((_, k) => ringKeep[k]);
  const ringFree = whole.map(([x, z], k): P2 => [x - (outward[k]?.[0] ?? 0) * g.width, z - (outward[k]?.[1] ?? 0) * g.width]).filter((_, k) => ringKeep[k]);
  const postIn = Math.abs(ringOver[0]?.[0] ?? firstHalf?.[0] ?? 893);
  const footX = postIn - mf.fillet.r;
  push(
    [
      [postIn, g.wallY, mf.fillet.z],
      ...ringOver.map(([x, z]): P3 => [x, g.wallY, z]),
      ...quarter(-footX, mf.fillet.z, mf.fillet.r, -1, true).map(([x, z]): P3 => [x, g.wallY, z]),
      ...quarter(footX, mf.fillet.z, mf.fillet.r, 1, false).map(([x, z]): P3 => [x, g.wallY, z]),
    ],
    [
      [postIn - g.width, g.wallY, mf.fillet.z],
      ...ringFree.map(([x, z]): P3 => [x, g.wallY, z]),
      ...quarter(-footX, mf.fillet.z, inner, -1, true).map(([x, z]): P3 => [x, g.wallY, z]),
      ...quarter(footX, mf.fillet.z, inner, 1, false).map(([x, z]): P3 => [x, g.wallY, z]),
    ],
  );
  // On its field side, one loop (RV-143): 51 out from the opening up the posts and over, down to the fillet, onto the
  // floor and round the mouth piece's front; its free edge 63 toward the field on the wall, the fillet's concentric arc
  // (r 32) round it, 63 up on the floor
  part = "fieldSide";
  const fs = g.fieldSide;
  const sideX = fs.x;
  // (up the +x post, round its corner, across the top, round the other, down the -x post to the fillet)
  const postCorner = (cx: number, sx: number): P2[] =>
    Array.from({ length: 13 }, (_, k): P2 => {
      const t = (k / 12) * (Math.PI / 2);
      return sx > 0 ? [cx + fs.cornerR * Math.cos(t), fs.top - fs.cornerR + fs.cornerR * Math.sin(t)] : [cx - fs.cornerR * Math.sin(t), fs.top - fs.cornerR + fs.cornerR * Math.cos(t)];
    });
  const postsAndTop: P2[] = [[sideX, mf.fillet.z], ...postCorner(sideX - fs.cornerR, 1), ...postCorner(-(sideX - fs.cornerR), -1), [-sideX, mf.fillet.z]];
  // (the floor's path, the -x side's end to the +x side's: its corners where its lines meet, rounded)
  const [diagonalSlope, diagonalAt] = mf.diagonal;
  const [slantSlope, slantAt] = mf.slant;
  const corners: P2[] = [
    [sideX, diagonalSlope * sideX + diagonalAt],
    [(mf.front - diagonalAt) / diagonalSlope, mf.front],
    [(mf.front - slantAt) / slantSlope, mf.front],
    [(mf.centre - slantAt) / slantSlope, mf.centre],
  ];
  const halfFloor: P2[] = [[sideX, mf.fillet.y], ...corners, [0, mf.centre]];
  const floorPath = rounded(
    [...halfFloor.map(([x, y]): P2 => [-x, y]), ...[...halfFloor].reverse().slice(1)],
    [0, ...mf.radii, 0, ...[...mf.radii].reverse(), 0],
  );
  // (the fillet: a quarter circle in (y, z), from the wall down onto the floor)
  const fillet = (r: number, down: boolean): P2[] =>
    Array.from({ length: 9 }, (_, k) => {
      const t = ((down ? k : 8 - k) / 8) * (Math.PI / 2);
      return [mf.fillet.y + r * Math.cos(t), mf.fillet.z - r * Math.sin(t)];
    });
  const loopAttached: P3[] = [
    ...postsAndTop.map(([x, z]): P3 => [x, g.fieldY, z]),
    ...fillet(mf.fillet.r, true).slice(1).map(([y, z]): P3 => [-sideX, y, z]),
    ...floorPath.slice(1, -1).map(([x, y]): P3 => [x, y, floorZ]),
    ...fillet(mf.fillet.r, false).map(([y, z]): P3 => [sideX, y, z]),
  ];
  const loopFree: P3[] = [
    ...postsAndTop.map(([x, z]): P3 => [x, g.fieldY - g.width, z]),
    ...fillet(inner, true).slice(1).map(([y, z]): P3 => [-sideX, y, z]),
    ...floorPath.slice(1, -1).map(([x, y]): P3 => [x, y, mf.fillet.z - inner]),
    ...fillet(inner, false).map(([y, z]): P3 => [sideX, y, z]),
  ];
  push(loopAttached, loopFree);
  // Under the crossbar
  part = "crossbar";
  push(
    [[-g.crossbar.x, g.wallY, g.crossbar.z], [g.crossbar.x, g.wallY, g.crossbar.z]],
    [[-g.crossbar.x, g.wallY, g.crossbar.z - g.width], [g.crossbar.x, g.wallY, g.crossbar.z - g.width]],
  );
  // The back wall's stepped outline (AV-11): low out to |x| 2048, up the slant, across the top, its bends the game's
  // (r 96, then r 128), not mitres; its free edge 128 out in the wall's plane: at the first bend (r 96, under the 128) the
  // free edge's lines meet in a corner, at the second its arc is the attached one's, 128 further out
  part = "stepped";
  const st = g.stepped;
  const [r1, r2] = st.bends;
  const tan22 = Math.tan(Math.PI / 8);
  const c1: P2 = [st.slant - st.low, st.low];
  const c2: P2 = [st.slant - st.top, st.top];
  const arc = (cx: number, cz: number, r: number, from: number, to: number): P2[] =>
    Array.from({ length: 7 }, (_, k): P2 => {
      const a = from + ((to - from) * k) / 6;
      return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    });
  // (bend 1: centre r1 above the low line's tangent point; bend 2: centre r2 below the top line's)
  const t1 = r1 * tan22;
  const t2 = r2 * tan22;
  const bend1 = arc(c1[0] + t1, st.low + r1, r1, -Math.PI / 2, (-3 * Math.PI) / 4);
  const centre2: P2 = [c2[0] - t2, st.top - r2];
  const bend2 = arc(centre2[0], centre2[1], r2, Math.PI / 4, Math.PI / 2);
  const freeCorner: P2 = [st.slant + st.out * Math.SQRT2 - (st.low + st.out), st.low + st.out];
  const bend2Free = arc(centre2[0], centre2[1], r2 + st.out, Math.PI / 4, Math.PI / 2);
  // (the +x half, from |x| 2048 in to the centre line)
  const attachedHalf: P2[] = [[st.to, st.low], ...bend1, ...bend2, [0, st.top]];
  const freeHalf: P2[] = [[st.to, st.low + st.out], ...bend1.map(() => freeCorner), ...bend2Free, [0, st.top + st.out]];
  const across = (h: readonly P2[]): P3[] => [...h.map(([x, z]): P3 => [-x, g.wallY, z]), ...[...h].reverse().slice(1).map(([x, z]): P3 => [x, g.wallY, z])];
  push(across(attachedHalf), across(freeHalf));
  // Low beside the goal, leaning back
  part = "beside";
  const bs = g.beside;
  // (its (|x|, z) profile: flat, the slope's line through its point, flat; the bends where they meet, rounded)
  const slopeAt = (z: number): number => bs.slope.at[0] + (z - bs.slope.at[1]) / bs.slope.rise;
  const besideProfile = rounded(
    [[bs.x[1], bs.z[1]], [slopeAt(bs.z[1]), bs.z[1]], [slopeAt(bs.z[0]), bs.z[0]], [bs.x[0], bs.z[0]]],
    [0, bs.radii[0], bs.radii[1], 0],
  );
  for (const s of [-1, 1]) {
    push(
      besideProfile.map(([x, z]): P3 => [s * x, bs.y, z]),
      besideProfile.map(([x, z]): P3 => [s * x, bs.y + bs.lean[0], z + bs.lean[1]]),
      bs.glow,
    );
  }
  // Inside: along the goal's profile at |x| 735 (15 out into the net), 63 toward the centre, from y 5344; and the front
  // bands across the floor and the roof, from y 5281 back to 5344 over |x| 672, rounding (r 63) into the sides
  part = "inside";
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
