// The game's cage as beams, as Stadium_P's FFCage is built: the lattice of src/render/arenaSurface.ts (CAGE) as a
// graph of beams on the drawn surface. Whole cells of the walls' lattice (up the walls, round the corners, on up the
// curve) and of the ceiling's (the side walls' carried on flat); along the side walls the two are one lattice. Where
// they meet without carrying on (along the ceiling's edge over the corners and the back walls) a gap is left and
// zipped shut with beams joining the two sides' loose ends, so the cells there come out as the game's do: pentagons,
// hexagons and heptagons of uneven sides, bigger ones in the corners. No beams below z 256, nor round the goal
// mouths below z 704 (the game's). On the dev server with the game's own cage exported locally (the static session's
// out/bsim/assets_local/cage/: game-derived, never in the repo or a build) that is drawn instead: loadGameCage().
import { type CageCharts, type ChartPoint, type Vec3Tuple, cageCharts, trimTop } from "./arenaSurface";

/** A beam: its centre line on the surface (points and the surface's normals there, game frame). */
export interface Beam {
  readonly points: readonly Vec3Tuple[];
  readonly normals: readonly Vec3Tuple[];
}

export interface CageGraph {
  /** The beams' meeting points (game frame) */
  readonly vertices: readonly Vec3Tuple[];
  /** Pairs of vertices, each a beam; `joins` mark the beams zipping a seam shut */
  readonly edges: readonly (readonly [number, number])[];
  readonly joins: readonly boolean[];
  readonly beams: readonly Beam[];
}

/** Each beam drawn as pieces at most this long (uu), so those on the curves follow them */
const BEAM_PIECE = 48;
/** The ceiling's cells kept this far (uu) inside its edge over the corners and back walls: room for the joins */
const SEAM_ROOM = 110;
/** The joins: none longer than this (uu); a loose end left unjoined costs as much as a join this long; two joins
 *  closing a cell of four sides (their ends neighbours on both sides) cost as much as one this long more */
const JOIN_MAX = 720;
const JOIN_SKIP = 380;
const JOIN_QUAD = 500;
/** The game's cage starts at z 256; round the goal mouths (|x| < 1140 on the back walls) at about z 704 */
const CAGE_FLOOR = 256;
const MOUTH_FLOOR = 704;
const MOUTH_HALF_WIDTH = 1140;

type Chart = "wall" | "ceiling";
type Lattice = readonly [number, number];

/** A cell's six corners round it, in lattice coordinates (flat sides across u1, 1 apart; see CAGE) */
function corners(c1: number, c2: number): Lattice[] {
  const a = 1 / (2 * Math.sqrt(3));
  const b = 1 / Math.sqrt(3);
  return [
    [c1 + 0.5, c2 - a],
    [c1 + 0.5, c2 + a],
    [c1, c2 + b],
    [c1 - 0.5, c2 + a],
    [c1 - 0.5, c2 - a],
    [c1, c2 - b],
  ];
}

/** Distance from p to the segment ab (2D) */
function segmentDistance(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const f = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - dx * f, p[1] - a[1] - dy * f);
}

export function buildCageGraph(charts: CageCharts = cageCharts()): CageGraph {
  const vertices: Vec3Tuple[] = [];
  const normals: Vec3Tuple[] = [];
  const byPlace = new Map<string, number>();
  const edges: [number, number][] = [];
  const joins: boolean[] = [];
  /** How to draw each lattice beam: its chart and its ends' lattice coordinates (joins: none) */
  const along: ({ chart: Chart; from: Lattice; to: Lattice } | null)[] = [];
  const byEnds = new Set<string>();
  const map = (chart: Chart, [u1, u2]: Lattice): ChartPoint => (chart === "wall" ? charts.wall(u1, u2) : charts.ceiling(u1, u2));
  const vertex = (point: ChartPoint): number => {
    const key = point.p.map((v) => Math.round(v)).join(",");
    const known = byPlace.get(key);
    if (known !== undefined) return known;
    vertices.push(point.p);
    normals.push(point.n);
    byPlace.set(key, vertices.length - 1);
    return vertices.length - 1;
  };
  const addCell = (chart: Chart, c1: number, c2: number): void => {
    const lattice = corners(c1, c2);
    const ids = lattice.map((l) => vertex(map(chart, l)));
    ids.forEach((a, k) => {
      const b = ids[(k + 1) % 6] ?? a;
      const key = a < b ? `${String(a)}-${String(b)}` : `${String(b)}-${String(a)}`;
      if (a === b || byEnds.has(key)) return;
      byEnds.add(key);
      edges.push([a, b]);
      joins.push(false);
      along.push({ chart, from: lattice[k] ?? [0, 0], to: lattice[(k + 1) % 6] ?? [0, 0] });
    });
  };

  // The walls' cells: whole ones from the row at z 256 up to the curve's top (along the side straights also those
  // reaching over the ceiling's edge, where the lattice carries on); round the goal mouths only above z 704
  const rowsUp = charts.edgeRow;
  const periods = Math.round(charts.loop / Math.sqrt(3));
  for (let k = 0; k < periods; k++) {
    for (let c1 = 1; c1 <= rowsUp + 1e-9; c1 += 0.5) {
      const odd = Math.round(c1 * 2) % 2 === 1;
      const c2 = k * Math.sqrt(3) + (odd ? Math.sqrt(3) / 2 : 0);
      const lattice = corners(c1, c2);
      const points = lattice.map((l) => charts.wall(l[0], l[1]).p);
      if (Math.min(...points.map((p) => p[2])) < CAGE_FLOOR - 1) continue;
      const nearMouth = points.some((p) => Math.abs(p[0]) < MOUTH_HALF_WIDTH && Math.abs(p[1]) > 4000);
      if (nearMouth && Math.min(...points.map((p) => p[2])) < MOUTH_FLOOR - 1) continue;
      // Past the curve's top: only where the walls' lattice carries on over the ceiling (the side straights)
      if (c1 + 0.5 > rowsUp + 1e-9 && !lattice.every((l) => charts.alongSide(l[1]) !== null)) continue;
      addCell("wall", c1, c2);
    }
  }

  // The ceiling's cells: whole ones inside it, kept SEAM_ROOM in from its edge over the corners and the back walls;
  // from the row past the walls' top on, to the one before the far side's (the walls' cells carry those)
  const { outline } = charts;
  const insideRoom = (p: Vec3Tuple): boolean => {
    if (Math.abs(p[0]) > (outline[0]?.p[0] ?? 0) + 1e-6) return false;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      if (!a || !b || a.side) continue;
      if (segmentDistance([p[0], p[1]], a.p, b.p) < SEAM_ROOM) return false;
    }
    // (inside the outline: it's convex and round the origin)
    return insideConvex([p[0], p[1]], outline.map((o) => o.p));
  };
  const farRow = 2 * (outline[0]?.p[0] ?? 0) / Math.abs(charts.ceiling(rowsUp + 1, 0).p[0] - charts.ceiling(rowsUp, 0).p[0]) + rowsUp;
  for (let c1 = rowsUp + 0.5; c1 <= farRow - 0.5 + 1e-9; c1 += 0.5) {
    const odd = Math.round(c1 * 2) % 2 === 1;
    for (let k = -8; k <= 8; k++) {
      const c2 = k * Math.sqrt(3) + (odd ? Math.sqrt(3) / 2 : 0);
      const points = corners(c1, c2).map((l) => charts.ceiling(l[0], l[1]).p);
      if (points.every(insideRoom)) addCell("ceiling", c1, c2);
    }
  }

  // The seams: each end's loose ends (beams meeting only two others) up at the ceiling, in order along the seam
  const degree = new Array<number>(vertices.length).fill(0);
  for (const [a, b] of edges) {
    degree[a] = (degree[a] ?? 0) + 1;
    degree[b] = (degree[b] ?? 0) + 1;
  }
  for (const end of [1, -1]) {
    const loose = vertices
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => degree[i] === 2 && p[2] > 2000 && Math.sign(p[1]) === end);
    // (along the seam: by the angle round a point inside it)
    const angle = (p: Vec3Tuple): number => Math.atan2((p[1] - end * 2000) * end, p[0]);
    const onWall = (i: number): boolean => Math.abs((normals[i] ?? [0, 0, 0])[2]) < 0.999 || isWallEdgePoint(vertices[i], outline);
    const wallEnds = loose.filter(({ i }) => onWall(i)).sort((a, b) => angle(a.p) - angle(b.p));
    const ceilingEnds = loose.filter(({ i }) => !onWall(i)).sort((a, b) => angle(a.p) - angle(b.p));
    for (const [w, c] of zip(wallEnds, ceilingEnds, (a, b) => byEnds.has(a < b ? `${String(a)}-${String(b)}` : `${String(b)}-${String(a)}`))) {
      const a = wallEnds[w]?.i;
      const b = ceilingEnds[c]?.i;
      if (a === undefined || b === undefined) continue;
      edges.push([a, b]);
      joins.push(true);
      along.push(null);
    }
  }

  // The beams' centre lines: the lattice's beams through their chart (following the curves), the joins straight
  const beams: Beam[] = edges.map(([a, b], e) => {
    const how = along[e];
    const pa = vertices[a] ?? [0, 0, 0];
    const pb = vertices[b] ?? [0, 0, 0];
    const pieces = Math.max(1, Math.ceil(Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) / BEAM_PIECE));
    const points: Vec3Tuple[] = [];
    const beamNormals: Vec3Tuple[] = [];
    for (let k = 0; k <= pieces; k++) {
      const f = k / pieces;
      if (how) {
        const point = map(how.chart, [how.from[0] + (how.to[0] - how.from[0]) * f, how.from[1] + (how.to[1] - how.from[1]) * f]);
        points.push(point.p);
        beamNormals.push(point.n);
      } else {
        points.push([pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f, pa[2] + (pb[2] - pa[2]) * f]);
        beamNormals.push([0, 0, -1]);
      }
    }
    return { points, normals: beamNormals };
  });
  return { vertices, edges, joins, beams };
}

/** The game's cage as exported (cage_lattice.json; its README.txt has the format): the beams' centre lines in the
 *  game's frame, the cage surface's outward normals at their points. */
export interface CageExport {
  readonly nodes: readonly Vec3Tuple[];
  readonly node_normals: readonly Vec3Tuple[];
  readonly edges: readonly { readonly nodes: readonly number[] }[];
  readonly cells?: readonly { readonly nodes: readonly number[]; readonly piece_main: string }[];
}

/** Under the game's cage its lower glass carries hexagons too (a texture there); we draw them as the cage's own cells
 *  carried on down, so they join it: the lattice repeats every 512 uu up the vertical walls. */
const WALL_PERIOD = 512;

/** Kept off the goal mouths: the opening (its top corners rounded, radius 104 round (800, 544)) and its frame round it */
const MOUTH_CLEAR = 70 + 4;

/** Whether a point is on the lower glass's hexagons' ground: above the trim (never behind it, where only seen from
 *  outside the arena it would show below the trim's line), off the goal mouths and their frames. */
function onGlass(p: Vec3Tuple): boolean {
  if (p[2] < trimTop(p[0], p[1])) return false;
  const backWall = Math.abs(p[1]) > 5000;
  if (!backWall) return true;
  const dx = Math.max(Math.abs(p[0]) - 800, 0);
  const dz = Math.max(p[2] - 544, 0);
  return Math.hypot(dx, dz) - 104 >= MOUTH_CLEAR;
}

/** The lower glass's beams for an exported cage: its wall cells repeated down by the wall's period where no cell is,
 *  their edges clipped to the glass (onGlass) and left out where a beam already runs. */
function glassBeams(cage: CageExport, existing: readonly Beam[]): Beam[] {
  const cells = cage.cells ?? [];
  const at = (i: number): Vec3Tuple => cage.nodes[i] ?? [0, 0, 0];
  const centroid = (loop: readonly number[]): Vec3Tuple => {
    const sum = loop.reduce<[number, number, number]>((s, i) => [s[0] + at(i)[0], s[1] + at(i)[1], s[2] + at(i)[2]], [0, 0, 0]);
    return [sum[0] / loop.length, sum[1] / loop.length, sum[2] / loop.length];
  };
  const taken = cells.map((c) => centroid(c.nodes));
  const near = (a: Vec3Tuple, b: Vec3Tuple, d: number): boolean => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < d;
  // The beams already there, by their pieces' ends
  const pieces = existing.flatMap((b) => b.points.slice(1).map((p, k): [Vec3Tuple, Vec3Tuple] => [b.points[k] ?? p, p]));
  const runs = (p: Vec3Tuple, q: Vec3Tuple): boolean =>
    pieces.some(([a, b]) => (near(a, p, 16) && near(b, q, 16)) || (near(a, q, 16) && near(b, p, 16)));
  const added = new Set<string>();
  const beams: Beam[] = [];
  for (let k = 1; k <= 3; k++) {
    for (const cell of cells) {
      if (!cell.piece_main.startsWith("wall")) continue;
      const shift = (i: number): Vec3Tuple => [at(i)[0], at(i)[1], at(i)[2] - k * WALL_PERIOD];
      const c = centroid(cell.nodes);
      const moved: Vec3Tuple = [c[0], c[1], c[2] - k * WALL_PERIOD];
      if (moved[2] < -WALL_PERIOD / 2 || taken.some((t) => near(t, moved, 100))) continue;
      taken.push(moved);
      cell.nodes.forEach((i, n) => {
        const j = cell.nodes[(n + 1) % cell.nodes.length] ?? i;
        const [p, q] = [shift(i), shift(j)];
        const key = [p, q].map((v) => v.map((x) => Math.round(x / 8)).join(",")).sort().join("|");
        if (added.has(key) || runs(p, q)) return;
        added.add(key);
        const normal = cage.node_normals[i] ?? [0, 0, 1];
        const inward: Vec3Tuple = [-normal[0], -normal[1], -normal[2]];
        for (const [from, to] of clip(p, q)) {
          // (not those only skimming the trim's top: beams lying along it)
          if (Math.max(from[2] - trimTop(from[0], from[1]), to[2] - trimTop(to[0], to[1])) < 2) continue;
          beams.push({ points: [from, to], normals: [inward, inward] });
        }
      });
    }
  }
  return beams;
}

/** The stretches of the segment pq on the glass (onGlass), found to a fraction of a uu. */
function clip(p: Vec3Tuple, q: Vec3Tuple): [Vec3Tuple, Vec3Tuple][] {
  const point = (t: number): Vec3Tuple => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const edge = (inside: number, outside: number): number => {
    let [a, b] = [inside, outside];
    for (let k = 0; k < 12; k++) {
      const m = (a + b) / 2;
      if (onGlass(point(m))) a = m;
      else b = m;
    }
    return a;
  };
  const steps = 32;
  const out: [Vec3Tuple, Vec3Tuple][] = [];
  let start: number | null = onGlass(p) ? 0 : null;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const inside = onGlass(point(t));
    const before = (s - 1) / steps;
    if (inside && start === null) start = edge(t, before);
    if (!inside && start !== null) {
      out.push([point(start), point(edge(before, t))]);
      start = null;
    }
  }
  if (start !== null) out.push([point(start), q]);
  return out.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 4);
}

/** The beams of an exported cage (one per cell edge, along its polyline; normals turned to face into the field), and
 *  its lower glass's (glassBeams). */
export function graphFromExport(cage: CageExport): CageGraph {
  const inward = (i: number): Vec3Tuple => {
    const n = cage.node_normals[i] ?? [0, 0, 1];
    return [-n[0], -n[1], -n[2]];
  };
  const edges: [number, number][] = [];
  const beams: Beam[] = [];
  for (const { nodes } of cage.edges) {
    const first = nodes[0];
    const last = nodes.at(-1);
    if (first === undefined || last === undefined || nodes.length < 2) continue;
    edges.push([first, last]);
    beams.push({ points: nodes.map((i) => cage.nodes[i] ?? [0, 0, 0]), normals: nodes.map(inward) });
  }
  // The glass's beams as vertices and edges of their own
  const vertices = [...cage.nodes];
  const glass = glassBeams(cage, beams);
  for (const beam of glass) {
    const [a, b] = [beam.points[0], beam.points.at(-1)];
    if (!a || !b) continue;
    vertices.push(a, b);
    edges.push([vertices.length - 2, vertices.length - 1]);
  }
  return { vertices, edges, joins: edges.map(() => false), beams: [...beams, ...glass] };
}

function isCageExport(data: unknown): data is CageExport {
  if (typeof data !== "object" || data === null) return false;
  const { nodes, node_normals: normals, edges } = data as Record<string, unknown>;
  return Array.isArray(nodes) && Array.isArray(normals) && Array.isArray(edges) && nodes.length === normals.length;
}

let gameCage: CageGraph | null = null;

/** Loads the game's own cage if the dev server has it (/local-assets/, vite.config.ts); whether it did. */
export async function loadGameCage(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const response = await fetch("/local-assets/cage/cage_lattice.json");
    if (!response.ok) return false;
    const data: unknown = await response.json();
    if (!isCageExport(data)) return false;
    gameCage = graphFromExport(data);
    return true;
  } catch {
    return false;
  }
}

/** The cage to draw: the game's where it is loaded (with its lower glass's hexagons as beams), else ours. */
export function cageGraph(): CageGraph {
  return gameCage ?? buildCageGraph();
}

/** Whether the game's own cage is loaded (its lower glass is in its beams then, not drawn on the walls) */
export function gameCageLoaded(): boolean {
  return gameCage !== null;
}

/** Whether a point at the ceiling's height is on its outline (the walls' top row ends there) */
function isWallEdgePoint(p: Vec3Tuple | undefined, outline: CageCharts["outline"]): boolean {
  if (!p) return false;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a && b && segmentDistance([p[0], p[1]], a.p, b.p) < 1) return true;
  }
  return false;
}

/** Whether p is inside a convex polygon round the origin (either winding) */
function insideConvex(p: readonly [number, number], polygon: readonly (readonly [number, number])[]): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b) continue;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** The joins along a seam: a matching between the walls' loose ends and the ceiling's, both in order along it, that
 *  never crosses (each pair after the last on both sides), shortest overall: each join costs its length squared, a
 *  loose end left alone JOIN_SKIP squared, two joins in a row closing a four-sided cell (`beam`: whether two points
 *  share one) JOIN_QUAD squared more; none longer than JOIN_MAX. Returns the pairs' indices. */
function zip(
  wall: readonly { readonly p: Vec3Tuple; readonly i: number }[],
  ceiling: readonly { readonly p: Vec3Tuple; readonly i: number }[],
  beam: (a: number, b: number) => boolean,
): [number, number][] {
  const n = wall.length;
  const m = ceiling.length;
  const skip = JOIN_SKIP * JOIN_SKIP;
  const quad = JOIN_QUAD * JOIN_QUAD;
  // Best costs of the first i and j loose ends: `joined` with the last of each joined to each other, `free` without
  const table = (): Float64Array[] => Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const joined = table();
  const free = table();
  const freeFrom = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1-4: which skip it came by
  const joinedFrom = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1: after a join, 2: after none
  const get = (t: Float64Array[], i: number, j: number): number => t[i]?.[j] ?? Infinity;
  const set = (t: Float64Array[], i: number, j: number, v: number): void => {
    const row = t[i];
    if (row) row[j] = v;
  };
  const mark = (t: Uint8Array[], i: number, j: number, v: number): void => {
    const row = t[i];
    if (row) row[j] = v;
  };
  set(free, 0, 0, 0);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      // Leaving the last wall end or the last ceiling end alone
      const skips = [get(joined, i - 1, j), get(free, i - 1, j), get(joined, i, j - 1), get(free, i, j - 1)];
      let best = Infinity;
      let from = 0;
      skips.forEach((c, k) => {
        if (c + skip < best) {
          best = c + skip;
          from = k + 1;
        }
      });
      set(free, i, j, best);
      mark(freeFrom, i, j, from);
      // Joining them
      const w = wall[i - 1];
      const c = ceiling[j - 1];
      if (!w || !c) continue;
      const length = Math.hypot(w.p[0] - c.p[0], w.p[1] - c.p[1], w.p[2] - c.p[2]);
      if (length > JOIN_MAX) continue;
      const pw = wall[i - 2];
      const pc = ceiling[j - 2];
      const closesQuad = pw !== undefined && pc !== undefined && beam(pw.i, w.i) && beam(pc.i, c.i);
      const afterJoin = get(joined, i - 1, j - 1) + (closesQuad ? quad : 0);
      const afterNone = get(free, i - 1, j - 1);
      set(joined, i, j, Math.min(afterJoin, afterNone) + length * length);
      mark(joinedFrom, i, j, afterJoin <= afterNone ? 1 : 2);
    }
  }
  const pairs: [number, number][] = [];
  let i = n;
  let j = m;
  let inJoined = get(joined, n, m) < get(free, n, m);
  while (i > 0 || j > 0) {
    if (inJoined) {
      pairs.push([i - 1, j - 1]);
      inJoined = joinedFrom[i]?.[j] === 1;
      i--;
      j--;
    } else {
      const from = freeFrom[i]?.[j] ?? 0;
      if (from === 1 || from === 2) i--;
      else j--;
      inJoined = from === 1 || from === 3;
    }
  }
  return pairs.reverse();
}
