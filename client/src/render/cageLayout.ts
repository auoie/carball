// The game's force-field cage laid out on our arena surface from its shippable topology (scripts/cage_topology.json:
// lattice addresses, beams as node chains, cells, a few layout rules; no coordinates). A port of the reference
// generator scripts/cage_layout.py (its docstring has the rules); the static session derived the topology from the
// game's Stadium_P cage and measured this layout against it: median 0.5 uu, p90 11, the 28 relaxed corner-fan nodes
// up to 66 (cells are ~600 uu across).
//
// The surface: our arena's (src/render/arenaSurface.ts: the plan contour, the 512 ceiling fillet, the 2048 ceiling)
// pushed `offset` (16) uu outward, as the game's cage sits behind its walls, fillet and ceiling. Every node is
//   wall (r, k)   row r, k steps (STEP = 896 / 6) along the row's own curve from the side wall's middle: rows 1..6 at
//                 z = 256 r, 7..9 on the fillet every 256 of arc, 10 on the ceiling; past the side straight the
//                 steps share the corner and the back wall between the measured half-period marks
//   ceil (c, n)   the ceiling: column c's x, n STEP along y
//   seam (c, j)   the back seam's rows on the ceiling
//   clip (r, k, nr, nk)  a beam end cut by the goal mouth
//   free          the corner fans: relaxed to their neighbours' mean in a flat chart (the ceiling as it is, the walls
//                 unrolled outward from its edge)
// in its quadrant (addresses are quadrant-local; q the quadrant's signs).
import topologyJson from "@scripts/cage_topology.json";
import {
  BACK_Y,
  CORNER_ARM,
  CORNER_BACK,
  CORNER_SIDE,
  H,
  type Pt,
  R_CEIL,
  SIDE_X,
  type Vec3Tuple,
  bezier,
  normalize,
} from "./arenaSurface";

export interface CageTopology {
  readonly params: {
    readonly offset: number;
    readonly row_height: number;
    readonly wall_rows: number;
    readonly row_arc: number;
    readonly side_steps: number;
    readonly col_step: number;
    readonly col_shift: number;
    readonly col_shift_range: readonly number[];
    readonly ceiling_row: number;
    readonly edge_row_inside: number;
    readonly seam_rows: readonly number[];
    readonly goal_cut: { readonly z: number; readonly x: number };
    readonly relax_iterations: number;
    readonly back_marks?: readonly number[];
  };
  readonly rows: Readonly<Record<string, { readonly k_back: number; readonly k_end: number; readonly corner_marks?: readonly number[] }>>;
  readonly nodes: readonly { readonly q: readonly number[]; readonly a: readonly (string | number)[] }[];
  readonly edges: readonly (readonly number[])[];
  readonly cells: readonly { readonly nodes: readonly number[]; readonly sides: number; readonly region: string }[];
}

export const CAGE_TOPOLOGY: CageTopology = topologyJson;

/** A third of a half period: half an edge's run (edges 2 STEP long, gaps 4 STEP) */
const STEP = 896 / 6;
const SAMPLES = 96;

/** Linear interpolation of ys over increasing xs at x, held at the ends (numpy's interp). */
function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (x <= (xs[0] ?? 0)) return ys[0] ?? 0;
  if (x >= (xs[n - 1] ?? 0)) return ys[n - 1] ?? 0;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] ?? 0) <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo] ?? 0;
  const x1 = xs[hi] ?? 0;
  const y0 = ys[lo] ?? 0;
  return y0 + ((ys[hi] ?? 0) - y0) * ((x - x0) / (x1 - x0 || 1));
}

/** Arc lengths along a polyline */
function cumulative(points: readonly Pt[]): number[] {
  const s = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] ?? [0, 0];
    const b = points[i] ?? [0, 0];
    s.push((s[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return s;
}

/** Our plan contour in a quadrant (x, y >= 0), dense: the side wall's middle round the corner to the back wall's
 *  middle, with inward normals, the arc length at each point, and that at the side's tangent and the back wall's start. */
function quarterContour(): { P: Pt[]; N: Pt[]; s: number[]; sSide: number; sBack: number } {
  const P: Pt[] = [];
  const N: Pt[] = [];
  const dSide: Pt = [0, 1];
  const dDiag: Pt = [-Math.SQRT1_2, Math.SQRT1_2];
  const dBack: Pt = [-1, 0];
  for (let i = 0; i < SAMPLES; i++) {
    P.push([SIDE_X, (CORNER_SIDE[0][1] * i) / SAMPLES]);
    N.push([-1, 0]);
  }
  for (let i = 0; i < SAMPLES; i++) {
    const { p, n } = bezier(CORNER_SIDE[0], dSide, CORNER_SIDE[1], dDiag, CORNER_ARM, i / SAMPLES);
    P.push(p);
    N.push(n);
  }
  const [a, b] = [CORNER_SIDE[1], CORNER_BACK[0]];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    P.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    N.push([-Math.SQRT1_2, -Math.SQRT1_2]);
  }
  for (let i = 0; i < SAMPLES; i++) {
    const { p, n } = bezier(CORNER_BACK[0], dDiag, CORNER_BACK[1], dBack, CORNER_ARM, i / SAMPLES);
    P.push(p);
    N.push(n);
  }
  for (let i = 0; i <= SAMPLES; i++) {
    P.push([CORNER_BACK[1][0] - (CORNER_BACK[1][0] * i) / SAMPLES, BACK_Y]);
    N.push([0, -1]);
  }
  const s = cumulative(P);
  return { P, N, s, sSide: s[SAMPLES] ?? 0, sBack: s[4 * SAMPLES] ?? 0 };
}

/** A node on the surface: its position and the surface's outward normal there (quadrant-local) */
interface Placed {
  readonly p: Vec3Tuple;
  readonly n: Vec3Tuple;
}

class Surface {
  readonly P: Pt[];
  readonly N: Pt[];
  readonly s: number[];
  readonly sSide: number;
  readonly sBack: number;
  readonly sEnd: number;
  /** The cage's fillet radius (about our fillet's centre) */
  readonly R: number;
  readonly columns: number[];
  readonly #rowLengths = new Map<number, number[]>();

  constructor(readonly params: CageTopology["params"]) {
    ({ P: this.P, N: this.N, s: this.s, sSide: this.sSide, sBack: this.sBack } = quarterContour());
    this.sEnd = this.s.at(-1) ?? 0;
    this.R = R_CEIL + params.offset;
    // The ceiling's columns: col_step apart from the middle, some shifted, the last on row 10's line
    const [shiftFrom = 0, shiftTo = -1] = params.col_shift_range;
    this.columns = Array.from({ length: 17 }, (_, c) => params.col_step * c + (c >= shiftFrom && c <= shiftTo ? params.col_shift : 0));
    this.columns[16] = SIDE_X - R_CEIL - params.edge_row_inside;
  }

  /** The contour point and inward normal at arc length s */
  at(sIn: number): { p: Pt; n: Pt } {
    const s = Math.min(Math.max(sIn, 0), this.sEnd);
    let lo = 0;
    let hi = this.s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.s[mid] ?? 0) <= s) lo = mid;
      else hi = mid;
    }
    const i = Math.min(lo, this.s.length - 2);
    const f = (s - (this.s[i] ?? 0)) / ((this.s[i + 1] ?? 1) - (this.s[i] ?? 0));
    const [p0, p1, n0, n1] = [this.P[i], this.P[i + 1], this.N[i], this.N[i + 1]] as [Pt, Pt, Pt, Pt];
    return {
      p: [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f],
      n: normalize([n0[0] + (n1[0] - n0[0]) * f, n0[1] + (n1[1] - n0[1]) * f]),
    };
  }

  /** Row r's angle on the fillet (0 at the wall's top), or null on the wall */
  theta(r: number): number | null {
    return r <= this.params.wall_rows ? null : ((r - this.params.wall_rows) * this.params.row_arc) / this.R;
  }

  /** Row r's plan offset from our wall line (inward; negative outside) and height */
  inset(r: number): [number, number] {
    const { offset, row_height, ceiling_row, edge_row_inside } = this.params;
    if (r === ceiling_row) return [R_CEIL + edge_row_inside, H + offset];
    const th = this.theta(r);
    if (th === null) return [-offset, row_height * r];
    return [R_CEIL - this.R * Math.cos(th), H - R_CEIL + this.R * Math.sin(th)];
  }

  /** The outward normal for a point at plan normal n: on the wall, at fillet angle th, or on the ceiling */
  static outward(n: Pt, th: number | null | "ceiling"): Vec3Tuple {
    if (th === "ceiling") return [0, 0, 1];
    if (th === null) return [-n[0], -n[1], 0];
    return [-n[0] * Math.cos(th), -n[1] * Math.cos(th), Math.sin(th)];
  }

  wallPoint(r: number, s: number): Placed {
    const { p, n } = this.at(s);
    const [o, z] = this.inset(r);
    const th = r === this.params.ceiling_row ? "ceiling" : this.theta(r);
    return { p: [p[0] + n[0] * o, p[1] + n[1] * o, z], n: Surface.outward(n, th) };
  }

  /** Arc length along row r's own curve (our contour offset by the row's inset), at each contour sample */
  rowLength(r: number): number[] {
    let L = this.#rowLengths.get(r);
    if (!L) {
      const [o] = this.inset(r);
      L = cumulative(this.P.map((p, i): Pt => [p[0] + (this.N[i]?.[0] ?? 0) * o, p[1] + (this.N[i]?.[1] ?? 0) * o]));
      this.#rowLengths.set(r, L);
    }
    return L;
  }

  /** Contour s of node k of wall row r: the side straight k STEP along the row; beyond it the row's steps share each
   *  region (round the corner, along the back wall) between the half-period marks, or evenly */
  along(r: number, row: CageTopology["rows"][string], k: number): number {
    const L = this.rowLength(r);
    const kSide = this.params.side_steps;
    const [lSide, lBack, lEnd] = [this.sSide, this.sBack, this.sEnd].map((x) => interp(x, this.s, L)) as [number, number, number];
    if (k <= kSide) return interp(k * STEP, L, this.s);
    let l: number;
    if (k <= row.k_back) l = lSide + Surface.region(k - kSide, row.k_back - kSide, row.corner_marks) * (lBack - lSide);
    else l = lBack + Surface.region(k - row.k_back, row.k_end - row.k_back, this.params.back_marks) * (lEnd - lBack);
    return interp(l, L, this.s);
  }

  /** The fraction of a region's length at dk of its steps: even, or between the marks (one every 3 steps) */
  static region(dk: number, steps: number, marks: readonly number[] | undefined): number {
    if (!marks || marks.length === 0) return dk / steps;
    return interp(dk, marks.map((_, j) => Math.min(3 * j, steps)), marks);
  }

  ceilPoint(c: number, n: number): Placed {
    return { p: [this.columns[c] ?? 0, n * STEP, H + this.params.offset], n: [0, 0, 1] };
  }

  seamPoint(c: number, j: number): Placed {
    return { p: [this.columns[c] ?? 0, BACK_Y - R_CEIL - (this.params.seam_rows[j] ?? 0), H + this.params.offset], n: [0, 0, 1] };
  }
}

/** The flat chart for relaxing the corner fans: the ceiling as it is (plan), the walls unrolled outward from the
 *  ceiling's edge E(s) = C(s) + n(s) R_CEIL, a point d down the profile at E(s) - n(s) d (quadrant-local). */
class Chart {
  readonly E: Pt[];
  readonly quarterArc: number;

  constructor(readonly S: Surface) {
    this.E = S.P.map((p, i): Pt => [p[0] + (S.N[i]?.[0] ?? 0) * R_CEIL, p[1] + (S.N[i]?.[1] ?? 0) * R_CEIL]);
    this.quarterArc = (S.R * Math.PI) / 2;
  }

  /** Down the profile from the ceiling's edge to fillet angle th, or to height z on the wall */
  down(zOrTheta: number, onFillet: boolean): number {
    return onFillet ? this.S.R * (Math.PI / 2 - zOrTheta) : this.quarterArc + (H - R_CEIL - zOrTheta);
  }

  wall(s: number, d: number): Pt {
    const { p, n } = this.S.at(s);
    return [p[0] + n[0] * R_CEIL - n[0] * d, p[1] + n[1] * R_CEIL - n[1] * d];
  }

  /** A chart point back on the surface: inside the ceiling's edge on the ceiling, outside it down the profile */
  toSurface(q: Pt): Placed {
    let best = Infinity;
    let at = 0;
    let atT = 0;
    let foot: Pt = [0, 0];
    for (let i = 0; i + 1 < this.E.length; i++) {
      const a = this.E[i] ?? [0, 0];
      const b = this.E[i + 1] ?? [0, 0];
      const ab: Pt = [b[0] - a[0], b[1] - a[1]];
      const t = Math.min(1, Math.max(0, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / Math.max(ab[0] * ab[0] + ab[1] * ab[1], 1e-12)));
      const f: Pt = [a[0] + ab[0] * t, a[1] + ab[1] * t];
      const d = Math.hypot(f[0] - q[0], f[1] - q[1]);
      if (d < best) {
        best = d;
        at = i;
        atT = t;
        foot = f;
      }
    }
    const s = (this.S.s[at] ?? 0) + atT * ((this.S.s[at + 1] ?? 0) - (this.S.s[at] ?? 0));
    const { p, n } = this.S.at(s);
    const d = (foot[0] - q[0]) * n[0] + (foot[1] - q[1]) * n[1];
    const { offset } = this.S.params;
    if (d <= 0) return { p: [q[0], q[1], H + offset], n: [0, 0, 1] };
    let o: number;
    let z: number;
    let th: number | null = null;
    if (d < this.quarterArc) {
      th = Math.PI / 2 - d / this.S.R;
      o = R_CEIL - this.S.R * Math.cos(th);
      z = H - R_CEIL + this.S.R * Math.sin(th);
    } else {
      o = -offset;
      z = H - R_CEIL - (d - this.quarterArc);
    }
    return { p: [p[0] + n[0] * o, p[1] + n[1] * o, z], n: Surface.outward(n, th) };
  }
}

export interface CageLayout {
  /** Every node's position (game frame, all four quadrants) and the cage surface's outward normal there */
  readonly positions: Vec3Tuple[];
  readonly normals: Vec3Tuple[];
}

/** Positions for every node of the topology, as scripts/cage_layout.py lays them out. */
export function layoutCage(topology: CageTopology = CAGE_TOPOLOGY): CageLayout {
  const params = topology.params;
  const S = new Surface(params);
  const C = new Chart(S);
  const count = topology.nodes.length;
  const chart: Pt[] = new Array<Pt>(count).fill([0, 0]); // signed: all quadrants
  const fixed = new Array<boolean>(count).fill(false);
  const positions: Vec3Tuple[] = new Array<Vec3Tuple>(count).fill([0, 0, 0]);
  const normals: Vec3Tuple[] = new Array<Vec3Tuple>(count).fill([0, 0, 1]);
  const row = (r: number): CageTopology["rows"][string] => {
    const found = topology.rows[String(r)];
    if (!found) throw new Error(`no cage row ${String(r)}`);
    return found;
  };
  topology.nodes.forEach((node, i) => {
    const [sx = 1, sy = 1] = node.q;
    const [kind, ...v] = node.a;
    const num = (j: number): number => Number(v[j]);
    let placed: Placed;
    let flat: Pt;
    if (kind === "wall") {
      const [r, k] = [num(0), num(1)];
      const s = S.along(r, row(r), k);
      placed = S.wallPoint(r, s);
      if (r === params.ceiling_row) flat = [placed.p[0], placed.p[1]];
      else {
        const th = S.theta(r);
        flat = C.wall(s, C.down(th ?? params.row_height * r, th !== null));
      }
    } else if (kind === "ceil") {
      placed = S.ceilPoint(num(0), num(1));
      flat = [placed.p[0], placed.p[1]];
    } else if (kind === "seam") {
      placed = S.seamPoint(num(0), num(1));
      flat = [placed.p[0], placed.p[1]];
    } else if (kind === "clip") {
      const [r, k, nr, nk] = [num(0), num(1), num(2), num(3)];
      const a = S.wallPoint(r, S.along(r, row(r), k));
      const b = S.wallPoint(nr, S.along(nr, row(nr), nk));
      const cut = params.goal_cut;
      let f = 1;
      if (a.p[2] > cut.z && cut.z > b.p[2] && b.p[0] < cut.x) f = Math.min(f, (a.p[2] - cut.z) / (a.p[2] - b.p[2]));
      if (a.p[0] > cut.x && cut.x > b.p[0]) f = Math.min(f, (a.p[0] - cut.x) / (a.p[0] - b.p[0]));
      placed = { p: [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f], n: a.n };
      flat = [placed.p[0], placed.p[1]];
    } else {
      return; // (free: relaxed below)
    }
    fixed[i] = true;
    chart[i] = [flat[0] * sx, flat[1] * sy];
    positions[i] = [placed.p[0] * sx, placed.p[1] * sy, placed.p[2]];
    normals[i] = [placed.n[0] * sx, placed.n[1] * sy, placed.n[2]];
  });
  // The corner fans: each the mean of its neighbours (the others held), in the signed chart
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  for (const chain of topology.edges) {
    for (let j = 0; j + 1 < chain.length; j++) {
      const [a = 0, b = 0] = [chain[j], chain[j + 1]];
      neighbours[a]?.push(b);
      neighbours[b]?.push(a);
    }
  }
  const mean = (ids: readonly number[]): Pt => {
    let x = 0;
    let y = 0;
    for (const j of ids) {
      x += chart[j]?.[0] ?? 0;
      y += chart[j]?.[1] ?? 0;
    }
    return ids.length > 0 ? [x / ids.length, y / ids.length] : [0, 0];
  };
  const free = fixed.flatMap((f, i) => (f ? [] : [i]));
  for (const i of free) chart[i] = mean((neighbours[i] ?? []).filter((j) => fixed[j]));
  for (let iteration = 0; iteration < params.relax_iterations; iteration++) {
    for (const i of free) chart[i] = mean(neighbours[i] ?? []);
  }
  for (const i of free) {
    const [x = 0, y = 0] = chart[i] ?? [];
    const placed = C.toSurface([Math.abs(x), Math.abs(y)]);
    const [sx, sy] = [x < 0 ? -1 : 1, y < 0 ? -1 : 1];
    positions[i] = [placed.p[0] * sx, placed.p[1] * sy, placed.p[2]];
    normals[i] = [placed.n[0] * sx, placed.n[1] * sy, placed.n[2]];
  }
  return { positions, normals };
}
