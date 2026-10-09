// The game's force-field cage as beams, as Stadium_P's FFCage is built: one beam per cell edge, cells of five, six and
// seven sides as the game's (pentagons and heptagons where its lattices meet: in the corners and along the ceiling's
// edge over the back walls). Laid out on our arena surface from the shippable topology (src/render/cageLayout.ts,
// scripts/cage_topology.json); on the dev server, where the static session's local export of the game's own lattice
// is (out/bsim/assets_local/cage/: game-derived, never in the repo or a build), that one: loadGameCage(). Both are
// carried on down over the lower glass to the trim (glassBeams). No beams below z 256, nor round the goal mouths
// below z ~704 (the game's).
import { type Vec3Tuple, trimTop } from "./arenaSurface";
import { CAGE_TOPOLOGY, layoutCage } from "./cageLayout";

/** A beam: its centre line on the surface (points and the surface's normals there, game frame). */
export interface Beam {
  readonly points: readonly Vec3Tuple[];
  readonly normals: readonly Vec3Tuple[];
}

export interface CageGraph {
  /** The beams' meeting points (game frame) */
  readonly vertices: readonly Vec3Tuple[];
  /** Pairs of vertices, each a beam's ends */
  readonly edges: readonly (readonly [number, number])[];
  readonly beams: readonly Beam[];
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
 *  unless `glass` is false its lower glass's (glassBeams: the game draws hex glass there, gameSurfaces.ts). */
export function graphFromExport(cage: CageExport, glass = true): CageGraph {
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
  const below = glass ? glassBeams(cage, beams) : [];
  for (const beam of below) {
    const [a, b] = [beam.points[0], beam.points.at(-1)];
    if (!a || !b) continue;
    vertices.push(a, b);
    edges.push([vertices.length - 2, vertices.length - 1]);
  }
  return { vertices, edges, beams: [...beams, ...below] };
}

function isCageExport(data: unknown): data is CageExport {
  if (typeof data !== "object" || data === null) return false;
  const { nodes, node_normals: normals, edges } = data as Record<string, unknown>;
  return Array.isArray(nodes) && Array.isArray(normals) && Array.isArray(edges) && nodes.length === normals.length;
}

let gameCage: CageExport | null = null;

/** Loads the game's own cage if the dev server has it (/local-assets/, vite.config.ts); whether it did. `?cage=topology`
 *  keeps the one laid out from the shippable topology (what builds draw), for comparing. */
export async function loadGameCage(): Promise<boolean> {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get("cage") === "topology") return false;
  try {
    const response = await fetch("/local-assets/cage/cage_lattice.json");
    if (!response.ok) return false;
    const data: unknown = await response.json();
    if (!isCageExport(data)) return false;
    gameCage = data;
    graphs.clear();
    return true;
  } catch {
    return false;
  }
}

/** The game's cage laid out from the shippable topology, in the export's form: positions and normals from the layout,
 *  the beams' node chains, the cells with their region (the export's main piece). */
export function shippableCage(): CageExport {
  const { positions, normals } = layoutCage();
  return {
    nodes: positions,
    node_normals: normals,
    edges: CAGE_TOPOLOGY.edges.map((chain) => ({ nodes: chain })),
    cells: CAGE_TOPOLOGY.cells.map((cell) => ({ nodes: cell.nodes, piece_main: cell.region })),
  };
}

const graphs = new Map<boolean, CageGraph>();

/** The cage to draw: the game's own where it is loaded (the dev server), else laid out from the topology; with its
 *  beams carried down over the lower glass unless `glass` is false. */
export function cageGraph(glass = true): CageGraph {
  let graph = graphs.get(glass);
  if (!graph) {
    graph = graphFromExport(gameCage ?? shippableCage(), glass);
    graphs.set(glass, graph);
  }
  return graph;
}
