// The arena's walls and ceiling for drawing: one continuous surface swept round the field (the floor fillet, the wall,
// the ceiling fillet) and the ceiling inside it, as the game's arena reads as one cage. Built from the same rules as
// the collision mesh (scripts/arena_gen.py: the plan contour's stations and each one's profile), but without the
// collision pieces' overlaps and hidden skirts (the cage's beams are laid out on it too: src/render/cageLayout.ts).
// `band`: on the floor fillet (the game wraps the wall's foot in a grey trim) how far up it the point is, 0 at the
// floor to 1 at the wall; -1 above it. Positions in the game's frame (x, y, z up); triangles face into the field.

export const H = 2048; // ceiling
export const SIDE_X = 4096;
export const BACK_Y = 5120;
const R_SIDE_FLOOR = 256;
export const R_CEIL = 512;
const R_BACK_FLOOR = 160;
export const CORNER_SIDE: readonly [Pt, Pt] = [[SIDE_X, 3584], [3840.471, 4223.529]];
export const CORNER_BACK: readonly [Pt, Pt] = [[3200, 4864], [2560, BACK_Y]];
export const CORNER_ARM = 245.85;
const CORNER_BACK_FLOOR_R = [256.0, 251.668, 240.628, 225.399, 208.13, 190.816, 175.483, 164.355, 160.0];
const BACK_TAPER: Pt = [960, 1344];
/** The goal mouth: the opening's half width with its chamfer, the crossbar's underside, the radius inside the goal */
export const GOAL_X = 896;
export const CHAMFER = 8;
export const GOAL_TOP = 640;
export const R_GOAL = 96;
export const SEG90 = 8;
export const BEZIER_K = 0.5518;
const WALL_LEVELS = [256, 512, 768, 1024, 1280];
/** Over the ceiling: the most along its edge between columns, and between points down a column (uu) */
const CEILING_EDGE_STEP = 128;
const CEILING_DEPTH_STEP = 256;

export type Pt = readonly [number, number];

interface Station {
  readonly p: Pt; // on the wall line
  readonly n: Pt; // inward
  readonly rf: number; // floor fillet radius
  readonly m: number; // mitre factor for profile offsets (inside an arc)
  /** Where the column starts: the floor (with its fillet), or the mouth outline's height (above the goal) */
  readonly bottom: number | null;
}

/** Point k of SEG90 on the game's quarter circle (a cubic Bézier with controls at BEZIER_K): (cos-like, sin-like). */
export function qc(k: number): Pt {
  const t = k / SEG90;
  const u = 1 - t;
  return [u ** 3 + 3 * u * u * t + 3 * u * t * t * BEZIER_K, 3 * u * u * t * BEZIER_K + 3 * u * t * t + t ** 3];
}

export function normalize([x, y]: Pt): Pt {
  const l = Math.hypot(x, y);
  return [x / l, y / l];
}

/** Point and inward normal (the tangent turned left) of the corner Bézier from p0 (along d0) to p3 (along d3). */
export function bezier(p0: Pt, d0: Pt, p3: Pt, d3: Pt, arm: number, t: number): { p: Pt; n: Pt } {
  const p1: Pt = [p0[0] + arm * d0[0], p0[1] + arm * d0[1]];
  const p2: Pt = [p3[0] - arm * d3[0], p3[1] - arm * d3[1]];
  const u = 1 - t;
  const at = (i: 0 | 1): number => u ** 3 * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t ** 3 * p3[i];
  const dt = (i: 0 | 1): number => 3 * u * u * (p1[i] - p0[i]) + 6 * u * t * (p2[i] - p1[i]) + 3 * t * t * (p3[i] - p2[i]);
  const tan = normalize([dt(0), dt(1)]);
  return { p: [at(0), at(1)], n: [-tan[1], tan[0]] };
}

function smoothstep(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

function backFloorRadius(x: number): number {
  const [lo, hi] = BACK_TAPER;
  return R_GOAL + (R_BACK_FLOOR - R_GOAL) * smoothstep((x - lo) / (hi - lo));
}

/** The mouth outline (x, z) from the post's top to the centre line: on the wall's face (the chamfer's outer edge), or
 *  with `extra` 0 inside the goal (its inner edge, CHAMFER behind the face). */
export function mouthOutline(extra = CHAMFER): Pt[] {
  const r = R_GOAL + extra;
  const [cx, cz] = [GOAL_X - R_GOAL, GOAL_TOP - R_GOAL];
  const arc: Pt[] = [];
  for (let k = 0; k <= SEG90; k++) {
    const [c, s] = qc(k);
    arc.push([cx + r * c, cz + r * s]);
  }
  return [...arc, ...[600, 400, 200, 0].map((x): Pt => [x, GOAL_TOP + extra])];
}

/** The plan contour of one quadrant (x, y >= 0), from the side wall's middle to the centre line above the goal. */
function stations(): Station[] {
  const S: { p: Pt; n: Pt; rf: number; arc?: boolean; bottom: number | null }[] = [];
  for (const y of [0, 512, 1024, 1536, 2048, 2560, 3072, CORNER_SIDE[0][1]]) {
    S.push({ p: [SIDE_X, y], n: [-1, 0], rf: R_SIDE_FLOOR, bottom: 0 });
  }
  const dSide: Pt = [0, 1];
  const dDiag: Pt = [-Math.SQRT1_2, Math.SQRT1_2];
  const dBack: Pt = [-1, 0];
  for (let k = 1; k <= SEG90; k++) {
    S.push({ ...bezier(CORNER_SIDE[0], dSide, CORNER_SIDE[1], dDiag, CORNER_ARM, k / SEG90), rf: R_SIDE_FLOOR, arc: k < SEG90, bottom: 0 });
  }
  const nDiag: Pt = [-Math.SQRT1_2, -Math.SQRT1_2];
  for (let k = 1; k < 4; k++) {
    const p: Pt = [
      CORNER_SIDE[1][0] + ((CORNER_BACK[0][0] - CORNER_SIDE[1][0]) * k) / 4,
      CORNER_SIDE[1][1] + ((CORNER_BACK[0][1] - CORNER_SIDE[1][1]) * k) / 4,
    ];
    S.push({ p, n: nDiag, rf: R_SIDE_FLOOR, bottom: 0 });
  }
  for (let k = 0; k <= SEG90; k++) {
    S.push({
      ...bezier(CORNER_BACK[0], dDiag, CORNER_BACK[1], dBack, CORNER_ARM, k / SEG90),
      rf: CORNER_BACK_FLOOR_R[k] ?? R_BACK_FLOOR,
      arc: k > 0 && k < SEG90,
      bottom: 0,
    });
  }
  for (const x of [2304, 2048, 1792, 1536, 1344, 1280, 1216, 1152, 1088, 1024, 960, GOAL_X + CHAMFER]) {
    S.push({ p: [x, BACK_Y], n: [0, -1], rf: backFloorRadius(x), bottom: 0 });
  }
  // Above the mouth: columns from the outline up (the post's top arc, then the crossbar to the centre line)
  for (const [x, z] of mouthOutline().slice(1)) S.push({ p: [x, BACK_Y], n: [0, -1], rf: R_GOAL, bottom: z });
  // The game sweeps its profiles mitred inside each arc: offsets along the normal / cos(half the chord angle)
  return S.map((s, i) => {
    let m = 1;
    const a = S[i - 1];
    const c = S[i + 1];
    if (s.arc && a && c) {
      const c1 = normalize([s.p[0] - a.p[0], s.p[1] - a.p[1]]);
      const c2 = normalize([c.p[0] - s.p[0], c.p[1] - s.p[1]]);
      m = 1 / Math.cos(Math.acos(Math.max(-1, Math.min(1, c1[0] * c2[0] + c1[1] * c2[1]))) / 2);
    }
    return { p: s.p, n: s.n, rf: s.rf, m, bottom: s.bottom };
  });
}

/** Profile points (offset from the wall, z, t = arc length from the floor tangent, band) for a station's column. */
function profile(s: Station): { o: number; z: number; t: number; band: number }[] {
  const pts: { o: number; z: number; band: number }[] = [];
  const r = s.rf;
  if (s.bottom === 0) {
    for (let k = 0; k <= SEG90; k++) {
      const [c, sn] = qc(k);
      pts.push({ o: r - r * sn, z: r - r * c, band: k / SEG90 }); // floor tangent (o r, z 0) -> wall tangent (o 0, z r)
    }
  }
  const bottom = s.bottom === 0 ? r : (s.bottom ?? 0);
  for (const z of [bottom, ...WALL_LEVELS.filter((level) => level > bottom + 1 && level < H - R_CEIL), H - R_CEIL]) {
    if (s.bottom === 0 && z === bottom) continue; // (the fillet's last point)
    pts.push({ o: 0, z, band: -1 });
  }
  for (let k = 1; k <= SEG90; k++) {
    const [c, sn] = qc(k);
    pts.push({ o: R_CEIL - R_CEIL * c, z: H - R_CEIL + R_CEIL * sn, band: -1 }); // wall tangent -> ceiling tangent
  }
  // t: arc length up the profile; above the mouth, from where a column with the goal's fillet would have it
  const floorArc = (rf: number): number => rf * (Math.PI / 2);
  let t = s.bottom === 0 ? 0 : floorArc(R_GOAL) + (bottom - R_GOAL);
  return pts.map((p, i) => {
    const prev = pts[i - 1];
    if (prev) t += Math.hypot(p.o - prev.o, p.z - prev.z);
    return { ...p, t };
  });
}

export interface ArenaSurface {
  readonly positions: Float32Array; // game frame
  readonly bands: Float32Array;
  readonly indices: Uint32Array;
}

/** The swept surface, all four quadrants: triangles between consecutive stations' columns, then over the ceiling,
 *  facing inward. */
export function buildArenaSurface(): ArenaSurface {
  const S = stations();
  const positions: number[] = [];
  const bands: number[] = [];
  const indices: number[] = [];
  const quadrants: readonly { sx: number; sy: number }[] = [
    { sx: 1, sy: 1 },
    { sx: -1, sy: 1 },
    { sx: -1, sy: -1 },
    { sx: 1, sy: -1 },
  ];
  for (const q of quadrants) {
    const columns = S.map((s) =>
      profile(s).map((pt) => {
        const index = positions.length / 3;
        const x = s.p[0] + s.n[0] * pt.o * s.m;
        const y = s.p[1] + s.n[1] * pt.o * s.m;
        positions.push(x * q.sx, y * q.sy, pt.z);
        bands.push(pt.band);
        return { index, t: pt.t, band: pt.band };
      }),
    );
    // A mirrored quadrant flips the winding
    const flip = q.sx * q.sy < 0;
    const tri = (a: number, b: number, c: number): void => {
      indices.push(...(flip ? [a, c, b] : [a, b, c]));
    };
    for (let i = 0; i + 1 < columns.length; i++) {
      const A = columns[i] ?? [];
      const B = columns[i + 1] ?? [];
      // Both with a floor fillet: the fillets joined point for point (the trim stays whole where the radius changes),
      // then the rest from the fillets' tops up
      const fa = A.filter((p) => p.band >= 0).length;
      const fb = B.filter((p) => p.band >= 0).length;
      if (fa > 0 && fa === fb) {
        for (let k = 0; k + 1 < fa; k++) {
          const a0 = A[k];
          const a1 = A[k + 1];
          const b0 = B[k];
          const b1 = B[k + 1];
          if (a0 && a1 && b0 && b1) {
            tri(a0.index, a1.index, b0.index);
            tri(a1.index, b1.index, b0.index);
          }
        }
        strip(A.slice(fa - 1), B.slice(fb - 1), tri);
      } else if (fa > 0 && fb === 0) {
        // The post's column (from the floor) beside one over the mouth (from the crossbar's height): only from that
        // height up, the opening's edge below it
        strip(fromHeight(A, B[0]?.t ?? 0), B, tri);
      } else if (fb > 0 && fa === 0) {
        strip(A, fromHeight(B, A[0]?.t ?? 0), tri);
      } else {
        strip(A, B, tri);
      }
    }
    // The ceiling, triangulated by folding it in from the ceiling fillet's top edge (each column's last point) in
    // the quadrant's own coordinates; its vertices its own, its lattice the side walls' carried on flat (the
    // pattern breaks along its edge over the corners and the back walls)
    const edges: FoldEdge[] = [];
    S.forEach((s, i) => {
      const top = columns[i]?.at(-1);
      if (!top) return;
      const e: FoldEdge = {
        p: [s.p[0] + s.n[0] * R_CEIL * s.m, s.p[1] + s.n[1] * R_CEIL * s.m],
        n: s.n,
        s: 0,
        t: 0,
      };
      const prev = edges.at(-1);
      if (prev) {
        const parts = Math.ceil(Math.hypot(e.p[0] - prev.p[0], e.p[1] - prev.p[1]) / CEILING_EDGE_STEP);
        for (let k = 1; k < parts; k++) edges.push(lerpEdge(prev, e, k / parts));
      }
      edges.push(e);
    });
    foldInward(edges, CEILING_LINES, CEILING_DEPTH_STEP, tri, (p) => {
      positions.push(p[0] * q.sx, p[1] * q.sy, H);
      bands.push(-1);
      return positions.length / 3 - 1;
    });
  }
  return {
    positions: new Float32Array(positions),
    bands: new Float32Array(bands),
    indices: new Uint32Array(indices),
  };
}

let footStations: Station[] | undefined;

/** How high the trim reaches up the wall nearest (x, y) (game frame; uu): its floor fillet's radius there (256 along the
 *  side walls and corners, 160 along the back walls, 96 beside the posts). */
export function trimTop(x: number, y: number): number {
  let best = Infinity;
  let radius = R_SIDE_FLOOR;
  footStations ??= stations().filter((s) => s.bottom === 0);
  for (const s of footStations) {
    const d = Math.hypot(Math.abs(x) - s.p[0], Math.abs(y) - s.p[1]);
    if (d < best) {
      best = d;
      radius = s.rf;
    }
  }
  return radius;
}

/** The floor's outline (game frame (x, y), once round, anticlockwise from the +x side's middle): the trim's foot, where
 *  the floor fillet leaves the floor; round each post the post base's (the fillet wrapped round its foot,
 *  src/render/goalSurface.ts), then straight across the mouth where the goal's own floor begins. */
export function floorOutline(): Pt[] {
  const S = stations().filter((s) => s.bottom === 0);
  const quarter: Pt[] = S.map((s) => [s.p[0] + s.n[0] * s.rf * s.m, s.p[1] + s.n[1] * s.rf * s.m]);
  // Round the post's foot (its axis at the chamfer's inner corner): from facing the field to facing into the goal
  const axis: Pt = [GOAL_X + CHAMFER, BACK_Y + CHAMFER];
  const rho = CHAMFER + R_GOAL;
  for (let j = 1; j <= SEG90; j++) {
    const [c, s] = qc(j);
    quarter.push([axis[0] - rho * s, axis[1] - rho * c]);
  }
  quarter.push([0, BACK_Y + CHAMFER]);
  const loop: Pt[] = [];
  const signs: readonly (readonly [number, number])[] = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  signs.forEach(([sx, sy], q) => {
    const ordered = q % 2 === 0 ? quarter : [...quarter].reverse();
    ordered.forEach((p, k) => {
      if (k > 0 || loop.length === 0) loop.push([p[0] * sx, p[1] * sy]);
    });
  });
  loop.pop(); // (the first point again)
  return loop;
}

export type Vec3Tuple = readonly [number, number, number];

/** The ceiling's edge lines in a quadrant (x, y >= 0), at the ceiling fillet's top, with the mirrored side and back
 *  walls' (where the columns from the other quadrants come in: the ridge and the far end) */
const CEILING_LINES: readonly FoldLine[] = (() => {
  const nDiag: Pt = [-Math.SQRT1_2, -Math.SQRT1_2];
  return [
    { p: [SIDE_X - R_CEIL, 0], n: [-1, 0] },
    { p: [-(SIDE_X - R_CEIL), 0], n: [1, 0] },
    { p: [0, BACK_Y - R_CEIL], n: [0, -1] },
    { p: [0, -(BACK_Y - R_CEIL)], n: [0, 1] },
    { p: [CORNER_SIDE[1][0] + nDiag[0] * R_CEIL, CORNER_SIDE[1][1] + nDiag[1] * R_CEIL], n: nDiag },
  ];
})();

/** A point on the edge a flat surface is folded in from: position in the surface's plane, unit normal into it,
 *  surface coordinates (`s` along the edge, `t` across it, growing by the distance folded in), its vertex if made. */
export interface FoldEdge {
  readonly p: Pt;
  readonly n: Pt;
  readonly s: number;
  readonly t: number;
  readonly index?: number;
}

/** One of a region's edge lines: a point on it and its unit normal into the region */
export interface FoldLine {
  readonly p: Pt;
  readonly n: Pt;
}

export function lerpEdge(a: FoldEdge, b: FoldEdge, f: number): FoldEdge {
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f],
    n: normalize([a.n[0] + (b.n[0] - a.n[0]) * f, a.n[1] + (b.n[1] - a.n[1]) * f]),
    s: a.s + (b.s - a.s) * f,
    t: a.t + (b.t - a.t) * f,
  };
}

/** How far in from `e` (along its normal) the line is as near as the edge: d with the line's distance from
 *  e + n d equal to d (Infinity for the lines through e, its own, and those it runs away from). */
function lineLength(e: FoldEdge, line: FoldLine): number {
  const distance = line.n[0] * (e.p[0] - line.p[0]) + line.n[1] * (e.p[1] - line.p[1]);
  const closing = 1 - (line.n[0] * e.n[0] + line.n[1] * e.n[1]);
  return distance > 0.01 && closing > 1e-9 ? distance / closing : Infinity;
}

/** Where a column from `e` meets the region's medial axis (the nearest of the other lines), and which line. */
function medialLength(e: FoldEdge, lines: readonly FoldLine[]): { length: number; line: number } {
  let length = Infinity;
  let line = -1;
  lines.forEach((l, j) => {
    const d = lineLength(e, l);
    if (d < length) {
      length = d;
      line = j;
    }
  });
  return { length, line };
}

/** A flat convex region folded in from its edge: from each edge point a column straight in (s kept, t growing with
 *  the distance) until it meets the columns from another edge, along the region's medial axis (its edges' lines'
 *  bisectors; the pattern's seams), triangulated between neighbouring columns with strip(). `edges` in order along
 *  the edge as strip() takes columns (A then B); where two neighbours' columns end on different lines, a column is
 *  added between them that ends where those meet, so the triangles reach the axis's corners. Round a curve of the
 *  edge (points on none of the lines) the columns fan in to one point, where one of the straight stretches' columns
 *  beside it ends (a circle's would meet at its centre; along their normals, a curve that isn't quite one would have
 *  them cross on the way): the end that lies on the curve's side of the other column, so none crosses it. */
export function foldInward(
  edges: readonly FoldEdge[],
  lines: readonly FoldLine[],
  depthStep: number,
  tri: (a: number, b: number, c: number) => void,
  vertex: (p: Pt, s: number, t: number) => number,
): void {
  const refined: FoldEdge[] = [];
  const refine = (a: FoldEdge, b: FoldEdge, depth: number): void => {
    const la = lines[medialLength(a, lines).line];
    const lb = lines[medialLength(b, lines).line];
    if (!la || !lb || la === lb || depth === 0) return;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      const e = lerpEdge(a, b, mid);
      if (lineLength(e, la) <= lineLength(e, lb)) lo = mid;
      else hi = mid;
    }
    if (lo < 1e-4 || lo > 1 - 1e-4) return;
    const m = lerpEdge(a, b, lo);
    refine(a, m, depth - 1);
    refined.push(m);
    refine(m, b, depth - 1);
  };
  edges.forEach((e, i) => {
    const prev = edges[i - 1];
    if (prev) refine(prev, e, 3);
    refined.push(e);
  });
  // Where each column ends: on the axis, along its normal from a straight stretch; round a curve, at the end of one
  // of the straight stretches' columns beside it
  const straight = (e: FoldEdge): boolean => lines.some((l) => 1 - (l.n[0] * e.n[0] + l.n[1] * e.n[1]) < 1e-9);
  const alongNormal = (e: FoldEdge): Pt => {
    const { length } = medialLength(e, lines);
    if (!Number.isFinite(length)) throw new Error("a fold column that never meets another edge");
    return [e.p[0] + e.n[0] * length, e.p[1] + e.n[1] * length];
  };
  const ends: (Pt | null)[] = refined.map((e) => (straight(e) ? alongNormal(e) : null));
  for (let i = 0; i < refined.length; i++) {
    if (ends[i]) continue;
    let j = i;
    while (j < refined.length && !ends[j]) j++;
    const from = ends[i - 1];
    const to = ends[j];
    const before = refined[i - 1];
    const curve = refined[i];
    let meet: Pt | null = null;
    if (from && to && before && curve) {
      // (which side of the column before the curve a point is on)
      const side = (q: Pt): number =>
        (from[0] - before.p[0]) * (q[1] - before.p[1]) - (from[1] - before.p[1]) * (q[0] - before.p[0]);
      meet = side(to) * side(curve.p) > 0 ? to : from;
    }
    for (let k = i; k < j; k++) {
      const e = refined[k];
      if (e) ends[k] = meet ?? alongNormal(e);
    }
    i = j;
  }
  // (columns meeting at one point leave triangles of no area between their ends: left out)
  const where = new Map<number, Pt>();
  const nonDegenerate = (a: number, b: number, c: number): void => {
    const [pa, pb, pc] = [where.get(a), where.get(b), where.get(c)];
    if (pa && pb && pc && Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])) < 1e-6) return;
    tri(a, b, c);
  };
  let previous: { index: number; t: number }[] | null = null;
  refined.forEach((e, i) => {
    const end = ends[i] ?? e.p;
    const length = Math.hypot(end[0] - e.p[0], end[1] - e.p[1]);
    const first = e.index ?? vertex(e.p, e.s, e.t);
    where.set(first, e.p);
    const column = [{ index: first, t: e.t }];
    const count = Math.max(1, Math.round(length / depthStep));
    for (let k = 1; k <= count; k++) {
      const f = k / count;
      const p: Pt = [e.p[0] + (end[0] - e.p[0]) * f, e.p[1] + (end[1] - e.p[1]) * f];
      const index = vertex(p, e.s, e.t + length * f);
      where.set(index, p);
      column.push({ index, t: e.t + length * f });
    }
    if (previous) strip(previous, column, nonDegenerate);
    previous = column;
  });
}

/** A column's points from the last at or below `t` up the profile. */
function fromHeight<P extends { readonly t: number }>(column: readonly P[], t: number): P[] {
  let start = 0;
  for (let i = 0; i < column.length; i++) if ((column[i]?.t ?? Infinity) <= t) start = i;
  return column.slice(start);
}

/** Triangles between two columns (bottom to top), by their heights up the profile: A and B side by side, A first. */
export function strip(
  A: readonly { index: number; t: number }[],
  B: readonly { index: number; t: number }[],
  tri: (a: number, b: number, c: number) => void,
): void {
  let i = 0;
  let j = 0;
  // Columns of different starts (beside the mouth): their heights compared as they are (both are arc lengths)
  while (i < A.length - 1 || j < B.length - 1) {
    const a = A[i];
    const b = B[j];
    const a1 = A[i + 1];
    const b1 = B[j + 1];
    if (!a || !b) break;
    if (!b1 || (a1 && a1.t <= b1.t)) {
      if (!a1) break;
      tri(a.index, a1.index, b.index);
      i++;
    } else {
      tri(a.index, b1.index, b.index);
      j++;
    }
  }
}
