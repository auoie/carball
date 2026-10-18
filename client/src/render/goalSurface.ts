// The goals' insides for drawing, from the collision mesh's rules (scripts/arena_gen.py build_goal): the centre
// surface (the floor, the ramp, the back's curve and the roof: one profile swept across the goal), its rounded edges
// onto the flat side walls, the side walls, the chamfer round the mouth and the post bases (the floor fillet wrapped
// round each post's foot). Every vertex carries surface coordinates (u, v) in uu: u across the goal (0 on its centre
// line), going on round the rounded edge and into the side wall; v along the profile (from the mouth's floor round the
// back to the mouth's roof, 0 halfway). A pattern laid on them runs unbroken over the floor, the back and the roof and
// round onto the sides; on each side wall the patterns from its edges meet along its medial axis (the line midway
// between floor and roof, mirror-symmetric where both are flat). Positions in the game's frame; triangles face into
// the goal.
import {
  BEZIER_K,
  CHAMFER,
  type FoldEdge,
  type FoldLine,
  GOAL_TOP,
  GOAL_X,
  type Pt,
  R_GOAL,
  SEG90,
  bezier,
  foldInward,
  lerpEdge,
  mouthOutline,
  normalize,
  qc,
} from "./arenaSurface";

const BACK_Y = 5120;
const RAMP: readonly [Pt, Pt] = [
  [234.67, 0],
  [640, 16],
];
const BACK_C: Pt = [640, 256];
const BACK_R = 240;
const BACK_TOP_DEG = 67.5;
const ROOF_FLAT_END = 224;
/** The side fillet's offsets at the profile's kinks, measured on the game's mesh (scripts/arena_gen.py) */
const KINK_OFFSETS = { rampStart: [-0.017, 96.04], rampEnd: [-0.041, 96.121], roof: [-10.309, -96.0] } as const;
/** The post's edge vertices (z), shared by the wall, the chamfer and the goal's side */
const POST_LEVELS = [R_GOAL, 256, 512, GOAL_TOP - R_GOAL];
/** Across the centre surface: its columns (x, the x >= 0 half) */
const XS = [0, 200, 400, 600, GOAL_X - R_GOAL];
/** On the side walls: the most along their edge between columns, and between points down a column (uu) */
const SIDE_EDGE_STEP = 48;
const SIDE_DEPTH_STEP = 64;
/** Faces facing up with every corner below this height are floor (the goal's floor and ramp, the rounded edges' feet;
 *  by corners, not centres, so the floor's edge runs along the mesh's rows) */
const FLOOR_MAX_Z = 30;

type Pt3 = readonly [number, number, number];
const sub = (a: Pt3, b: Pt3): Pt3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Pt3, b: Pt3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Pt3, b: Pt3): Pt3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface GoalSurface {
  readonly positions: Float32Array; // game frame
  readonly uvs: Float32Array; // (u, v) in uu
  /** The see-through net (the centre surface above the floor, the rounded edges, the side walls) */
  readonly net: Uint32Array;
  /** Facing up near the floor: the goal's floor and the ramp, the rounded edges' feet */
  readonly floor: Uint32Array;
  /** The chamfer round the mouth (the opening's lip) */
  readonly lip: Uint32Array;
  /** The post bases (the floor fillet round the posts' feet, between the wall's trim and the goal's floor) */
  readonly postBase: Uint32Array;
  /** The hexagons' size for a pattern on (u, v) near `hexTarget` that is mirror-symmetric along the side walls'
   *  medial axis in front (and across the goal's centre line) */
  readonly hexSize: number;
}

/** Centre-line profile (y behind the goal line, z) of the goal's inside, from the mouth's floor round the back to the
 *  mouth's roof. */
export function goalPath(): Pt[] {
  const P: Pt[] = [[CHAMFER, 0], RAMP[0], RAMP[1]];
  for (let k = 1; k <= SEG90; k++) {
    const [c, s] = qc(k);
    P.push([BACK_C[0] + BACK_R * s, BACK_C[1] - BACK_R * c]); // lower back arc, -90° -> 0°
  }
  for (let k = 1; k <= Math.round(BACK_TOP_DEG / (90 / SEG90)); k++) {
    const [c, s] = qc(k);
    P.push([BACK_C[0] + BACK_R * c, BACK_C[1] + BACK_R * s]); // upper back arc, 0° -> ~67.5°
  }
  P.push([ROOF_FLAT_END, GOAL_TOP], [CHAMFER, GOAL_TOP]);
  return P;
}

const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Pt, f: number): Pt => [a[0] * f, a[1] * f];
const leftNormal = (a: Pt, b: Pt): Pt => normalize([-(b[1] - a[1]), b[0] - a[0]]);

/** The side fillet's offset (into the goal) at each profile vertex: mitred along the profile; on the back arc along
 *  the Bézier's own normal; at the kinks, measured (scripts/arena_gen.py build_goal). */
function goalOffsets(P: readonly Pt[]): Pt[] {
  const segment = P.slice(1).map((b, i) => leftNormal(P[i] ?? b, b));
  const off = P.map((_, i): Pt => {
    const before = segment[i - 1];
    const after = segment[i];
    if (!before && after) return scale(after, R_GOAL);
    if (before && !after) return scale(before, R_GOAL);
    if (!before || !after) return [0, 0];
    const mean = normalize(add(before, after));
    return scale(mean, R_GOAL / dot(mean, after));
  });
  const arm = BEZIER_K * BACK_R;
  const arcs: readonly (readonly [Pt, Pt, Pt, Pt])[] = [
    [RAMP[1], [1, 0], [BACK_C[0] + BACK_R, BACK_C[1]], [0, 1]],
    [
      [BACK_C[0] + BACK_R, BACK_C[1]],
      [0, 1],
      [BACK_C[0], BACK_C[1] + BACK_R],
      [-1, 0],
    ],
  ];
  const lastArc = P.length - 3;
  for (let i = 3; i <= lastArc; i++) {
    const [a, t] = i - 2 <= SEG90 ? [0, i - 2] : [1, i - 2 - SEG90];
    const arc = arcs[a];
    const p = P[i];
    const prev = P[i - 1];
    if (!arc || !p || !prev) continue;
    const { n } = bezier(...arc, arm, t / SEG90);
    const next = i < lastArc ? (P[i + 1] ?? p) : bezier(...arc, arm, (t + 1) / SEG90).p;
    const na = leftNormal(prev, p);
    const bisector = normalize(add(na, leftNormal(p, next)));
    off[i] = scale(n, R_GOAL / dot(bisector, na));
  }
  off[1] = KINK_OFFSETS.rampStart;
  off[2] = KINK_OFFSETS.rampEnd;
  off[P.length - 2] = KINK_OFFSETS.roof;
  return off;
}

/** The game's goal glass chart along the profile (RV-110): U a unit every 193.4 uu on the floor, 195.8 round the back,
 *  203.1 on the roof, 5.5 at the back's middle (the lower arc's end, z 256) */
export const GOAL_PROFILE_CHART = { floor: 193.4, back: 195.8, roof: 203.1, atBack: 5.5 } as const;

/** The profile's sections along it (arc length from the floor's front): the floor's end (the lower back arc's start),
 *  the back's middle (that arc's end), the back's end (the upper arc's); half its length */
let profileMarks: { floorEnd: number; middle: number; backEnd: number; half: number } | null = null;

/** The game's U at `v` along the profile (arc length, 0 halfway: GoalSurface's v) */
export function goalProfileU(v: number): number {
  if (!profileMarks) {
    const P = goalPath();
    const along: number[] = [0];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1] ?? [0, 0];
      const b = P[i] ?? a;
      along.push((along[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    profileMarks = { floorEnd: along[2] ?? 0, middle: along[2 + SEG90] ?? 0, backEnd: along[P.length - 3] ?? 0, half: (along.at(-1) ?? 0) / 2 };
  }
  const { floorEnd, middle, backEnd, half } = profileMarks;
  const s = v + half;
  const c = GOAL_PROFILE_CHART;
  if (s < floorEnd) return c.atBack + (floorEnd - middle) / c.back + (s - floorEnd) / c.floor;
  if (s > backEnd) return c.atBack + (backEnd - middle) / c.back + (s - backEnd) / c.roof;
  return c.atBack + (s - middle) / c.back;
}

/** Both goals' insides, their net's hexagon size near `hexTarget` (see GoalSurface.hexSize). */
export function buildGoalSurface(hexTarget: number): GoalSurface {
  const P = goalPath();
  const off = goalOffsets(P);
  // v: arc length along the profile, 0 halfway
  const along: number[] = [0];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    if (a && b) along.push((along[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const half = (along.at(-1) ?? 0) / 2;
  const v = along.map((l) => l - half);

  // One half (x >= 0) in the goal's own frame (y behind the goal line), then mirrored and placed
  const local: number[] = [];
  const uv: number[] = [];
  const vertex = (x: number, y: number, z: number, u: number, vv: number): number => {
    local.push(x, y, z);
    uv.push(u, vv);
    return local.length / 3 - 1;
  };
  const pieces = { net: [] as number[], floor: [] as number[], lip: [] as number[], postBase: [] as number[] };
  // (faces turned afterwards: towards `inward` of the centroid)
  const faces: { tri: [number, number, number]; piece: keyof typeof pieces; inward: (c: Pt3) => Pt3 }[] = [];
  const intoGoal = (c: Pt3): Pt3 => [-c[0], 450 - c[1], 320 - c[2]];
  const quad = (a: number, b: number, c: number, d: number, piece: keyof typeof pieces, inward: (c: Pt3) => Pt3): void => {
    faces.push({ tri: [a, b, c], piece, inward }, { tri: [a, c, d], piece, inward });
  };

  // The centre surface: the profile across the goal
  const centre = XS.map((x) => P.map((p, i) => vertex(x, p[0], p[1], x, v[i] ?? 0)));
  for (let j = 0; j + 1 < centre.length; j++) {
    for (let i = 0; i + 1 < P.length; i++) {
      const a = centre[j]?.[i];
      const b = centre[j]?.[i + 1];
      const c = centre[j + 1]?.[i + 1];
      const d = centre[j + 1]?.[i];
      if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) quad(a, b, c, d, "net", intoGoal);
    }
  }
  // The rounded edge onto the side wall: a quarter circle at each profile vertex, from the centre surface's last
  // column; u on round it by its arc length
  const ringEnd: number[] = [];
  const rings = P.map((p, i) => {
    const o = off[i] ?? [0, 0];
    let u = GOAL_X - R_GOAL;
    let last: Pt3 = [u, p[0], p[1]];
    return Array.from({ length: SEG90 + 1 }, (_, k) => {
      if (k === 0) return centre.at(-1)?.[i] ?? 0;
      const [c, s] = qc(k);
      const point: Pt3 = [GOAL_X - R_GOAL + R_GOAL * s, p[0] + o[0] * (1 - c), p[1] + o[1] * (1 - c)];
      u += Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2]);
      last = point;
      if (k === SEG90) ringEnd[i] = u;
      return vertex(...point, u, v[i] ?? 0);
    });
  });
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i] ?? [];
    const b = rings[i + 1] ?? [];
    for (let k = 0; k < SEG90; k++) {
      const a0 = a[k];
      const a1 = a[k + 1];
      const b0 = b[k];
      const b1 = b[k + 1];
      if (a0 !== undefined && a1 !== undefined && b0 !== undefined && b1 !== undefined) {
        quad(a0, b0, b1, a1, "net", intoGoal);
      }
    }
  }
  // The side wall (x = GOAL_X), folded in from the rounded edge's end: the edge points (y, z) with their normals
  // into the wall, u going on from the rounded edge's, v kept; the lines of its edge (the post's front edge isn't
  // one: nothing folds in from it, and the columns beside it run along it)
  const sideWall = (): Pt3 => [-1, 0, 0];
  const edgePoints: FoldEdge[] = P.map((p, i) => {
    const o = off[i] ?? [0, 0];
    const index = rings[i]?.[SEG90];
    if (index === undefined) throw new Error("a rounded edge without its end");
    return { p: add(p, o), n: normalize(o), s: v[i] ?? 0, t: ringEnd[i] ?? 0, index };
  });
  const lines: FoldLine[] = edgePoints.slice(1).map((b, i) => {
    const a = edgePoints[i] ?? b;
    return { p: a.p, n: leftNormal(a.p, b.p) };
  });
  const edges: FoldEdge[] = [];
  edgePoints.forEach((e, i) => {
    const prev = edgePoints[i - 1];
    const line = lines[i - 1];
    if (prev && line) {
      // Between vertices on a straight stretch: on its line, its normal (the vertices': mitred)
      const parts = Math.ceil(Math.hypot(e.p[0] - prev.p[0], e.p[1] - prev.p[1]) / SIDE_EDGE_STEP);
      for (let k = 1; k < parts; k++) edges.push({ ...lerpEdge(prev, e, k / parts), n: line.n });
    }
    edges.push(e);
  });
  foldInward(
    edges,
    lines,
    SIDE_DEPTH_STEP,
    (a, b, c) => faces.push({ tri: [a, b, c], piece: "net", inward: sideWall }),
    (p, s, t) => vertex(GOAL_X, p[0], p[1], t, s),
  );
  // The chamfer round the mouth: the wall's face outline (y 0) to the inside's (y CHAMFER), the post's edge first
  const outer = [...POST_LEVELS.slice(0, -1).map((z): Pt3 => [GOAL_X + CHAMFER, 0, z]), ...mouthOutline().map(([x, z]): Pt3 => [x, 0, z])];
  const inner = [...POST_LEVELS.slice(0, -1).map((z): Pt3 => [GOAL_X, CHAMFER, z]), ...mouthOutline(0).map(([x, z]): Pt3 => [x, CHAMFER, z])];
  const lipInward = (c: Pt3): Pt3 => (c[2] > GOAL_TOP - R_GOAL ? [-1, -1, -1] : [-1, -1, 0]);
  for (let k = 0; k + 1 < outer.length; k++) {
    const o0 = outer[k];
    const o1 = outer[k + 1];
    const i0 = inner[k];
    const i1 = inner[k + 1];
    if (o0 && o1 && i0 && i1) {
      quad(vertex(...o0, 0, 0), vertex(...o1, 0, 0), vertex(...i1, 0, 0), vertex(...i0, 0, 0), "lip", lipInward);
    }
  }
  // The post base: the floor fillet (R_GOAL) wrapped round the post's vertical axis, from facing the field to facing
  // into the goal; its last ring the chamfer's foot
  const axis: Pt = [GOAL_X + CHAMFER, CHAMFER];
  const wrapRings = Array.from({ length: SEG90 }, (_, k) => {
    const [c, s] = qc(k);
    const o = R_GOAL - R_GOAL * s;
    const z = R_GOAL - R_GOAL * c;
    const rho = CHAMFER + o;
    return Array.from({ length: SEG90 + 1 }, (_unused, j): Pt3 => [axis[0] - rho * qc(j)[1], axis[1] - rho * qc(j)[0], z]);
  });
  wrapRings.push([
    [GOAL_X + CHAMFER, 0, R_GOAL],
    [GOAL_X, CHAMFER, R_GOAL],
  ]);
  const postInward = (c: Pt3): Pt3 => [c[0] - axis[0], c[1] - axis[1], 0];
  for (let k = 0; k + 1 < wrapRings.length; k++) {
    const A = (wrapRings[k] ?? []).map((p) => ({ p, index: vertex(...p, 0, 0) }));
    const B = (wrapRings[k + 1] ?? []).map((p) => ({ p, index: vertex(...p, 0, 0) }));
    // (by the fraction of the way round: the last ring has 2 points)
    const fa = A.map((_, i) => i / Math.max(1, A.length - 1));
    const fb = B.map((_, i) => i / Math.max(1, B.length - 1));
    let i = 0;
    let j = 0;
    while (i < A.length - 1 || j < B.length - 1) {
      const a = A[i];
      const b = B[j];
      if (!a || !b) break;
      if (j === B.length - 1 || (i < A.length - 1 && (fa[i + 1] ?? 1) <= (fb[j + 1] ?? 1))) {
        const a1 = A[i + 1];
        if (a1) faces.push({ tri: [a.index, b.index, a1.index], piece: "postBase", inward: postInward });
        i++;
      } else {
        const b1 = B[j + 1];
        if (b1) faces.push({ tri: [a.index, b.index, b1.index], piece: "postBase", inward: postInward });
        j++;
      }
    }
  }

  // Each triangle turned to face its way; the centre surface's and rounded edges' faces near the floor are floor
  const at = (i: number): Pt3 => [local[i * 3] ?? 0, local[i * 3 + 1] ?? 0, local[i * 3 + 2] ?? 0];
  const oriented: { tri: [number, number, number]; piece: keyof typeof pieces }[] = faces.map(({ tri, piece, inward }) => {
    const [a, b, c] = tri.map(at) as [Pt3, Pt3, Pt3];
    const n = cross(sub(b, a), sub(c, a));
    const centroid: Pt3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const facing: [number, number, number] = dot3(n, inward(centroid)) < 0 ? [tri[0], tri[2], tri[1]] : tri;
    const length = Math.hypot(...n);
    const up = length > 0 ? Math.abs(n[2]) / length : 0;
    const isFloor = piece === "net" && up > 0.95 && Math.max(a[2], b[2], c[2]) < FLOOR_MAX_Z;
    return { tri: facing, piece: isFloor ? "floor" : piece };
  });

  // Both halves of both goals: x mirrored for the x < 0 halves, y mirrored for blue's goal (-y); an odd number of
  // mirrors turns a triangle's winding round
  const count = local.length / 3;
  const positions = new Float32Array(count * 12);
  const uvs = new Float32Array(count * 8);
  const copies: readonly [number, number][] = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  copies.forEach(([sx, sy], c) => {
    for (let i = 0; i < count; i++) {
      const [x, y, z] = at(i);
      positions.set([x * sx, (BACK_Y + y) * sy, z], (c * count + i) * 3);
      uvs.set([(uv[i * 2] ?? 0) * sx, uv[i * 2 + 1] ?? 0], (c * count + i) * 2);
    }
    for (const { tri, piece } of oriented) {
      const [a, b, d] = tri.map((i) => c * count + i) as [number, number, number];
      pieces[piece].push(...(sx * sy < 0 ? [a, d, b] : [a, b, d]));
    }
  });

  // The hexagons: half of one a whole number of times into u where the side wall's floor and roof patterns meet in
  // front (both flat there: midway between them), so that line and the goal's centre line are mirror lines; v is 0
  // halfway along the profile, where the floor's and the roof's v meet across that line
  const seam = (ringEnd[0] ?? 0) + (GOAL_TOP - 2 * R_GOAL) / 2;
  const hexSize = (2 * seam) / Math.round((2 * seam) / hexTarget);
  return {
    positions,
    uvs,
    net: new Uint32Array(pieces.net),
    floor: new Uint32Array(pieces.floor),
    lip: new Uint32Array(pieces.lip),
    postBase: new Uint32Array(pieces.postBase),
    hexSize,
  };
}
