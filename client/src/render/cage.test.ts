// The cage's beams (src/render/cage.ts) against the game's (notes/arena.md, "The cage's hexagon layout") and the drawn
// surface: on it, where the game has beams, one structure with the seams zipped shut.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Vec3Tuple, buildArenaSurface, trimTop } from "./arenaSurface";
import { type CageExport, buildCageGraph, graphFromExport } from "./cage";

const graph = buildCageGraph();
const surface = buildArenaSurface();

/** Distance from p to the triangle abc (closest point by barycentric clamping on its plane, then its edges). */
function pointTriangle(p: Vec3Tuple, a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple): number {
  const sub = (u: Vec3Tuple, v: Vec3Tuple): Vec3Tuple => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: Vec3Tuple, v: Vec3Tuple): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const segment = (u: Vec3Tuple, v: Vec3Tuple): number => {
    const d = sub(v, u);
    const f = Math.max(0, Math.min(1, dot(sub(p, u), d) / (dot(d, d) || 1)));
    return Math.hypot(...sub(p, [u[0] + d[0] * f, u[1] + d[1] * f, u[2] + d[2] * f]));
  };
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n: Vec3Tuple = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const len = Math.hypot(...n);
  if (len > 1e-9) {
    const h = dot(sub(p, a), n) / len;
    const q: Vec3Tuple = [p[0] - (n[0] / len) * h, p[1] - (n[1] / len) * h, p[2] - (n[2] / len) * h];
    // (inside the triangle: barycentric signs)
    const inside = [
      [a, b],
      [b, c],
      [c, a],
    ].every(([u, v]) => {
      if (!u || !v) return false;
      const e = sub(v, u);
      const w = sub(q, u);
      return dot([e[1] * w[2] - e[2] * w[1], e[2] * w[0] - e[0] * w[2], e[0] * w[1] - e[1] * w[0]], n) >= 0;
    });
    if (inside) return Math.abs(h);
  }
  return Math.min(segment(a, b), segment(b, c), segment(c, a));
}

const at = (i: number): Vec3Tuple => [surface.positions[i * 3] ?? 0, surface.positions[i * 3 + 1] ?? 0, surface.positions[i * 3 + 2] ?? 0];

describe("the cage's beams", () => {
  it("lie on the drawn surface (within the curve's chords' sag)", () => {
    // The surface's triangles by 256 uu cells
    const cell = (v: number): number => Math.floor(v / 256);
    const grid = new Map<string, number[]>();
    for (let t = 0; t < surface.indices.length; t += 3) {
      const tri = [0, 1, 2].map((k) => at(surface.indices[t + k] ?? 0));
      const lo = [0, 1, 2].map((k) => cell(Math.min(...tri.map((p) => p[k] ?? 0)) - 4));
      const hi = [0, 1, 2].map((k) => cell(Math.max(...tri.map((p) => p[k] ?? 0)) + 4));
      for (let x = lo[0] ?? 0; x <= (hi[0] ?? 0); x++)
        for (let y = lo[1] ?? 0; y <= (hi[1] ?? 0); y++)
          for (let z = lo[2] ?? 0; z <= (hi[2] ?? 0); z++) {
            const key = `${String(x)},${String(y)},${String(z)}`;
            grid.set(key, [...(grid.get(key) ?? []), t]);
          }
    }
    let worst = 0;
    for (const beam of graph.beams) {
      for (const p of beam.points) {
        let d = Infinity;
        for (const t of grid.get(`${String(cell(p[0]))},${String(cell(p[1]))},${String(cell(p[2]))}`) ?? []) {
          const [a, b, c] = [0, 1, 2].map((k) => at(surface.indices[t + k] ?? 0)) as [Vec3Tuple, Vec3Tuple, Vec3Tuple];
          d = Math.min(d, pointTriangle(p, a, b, c));
        }
        worst = Math.max(worst, d);
      }
    }
    expect(worst).toBeLessThan(4);
  });

  it("are only where the game's are: from z 256 up, round the goal mouths from z 704", () => {
    for (const p of graph.vertices) {
      expect.soft(p[2]).toBeGreaterThan(255);
      if (Math.abs(p[0]) < 1100 && Math.abs(p[1]) > 4000) expect.soft(p[2]).toBeGreaterThan(703);
    }
    expect(graph.edges.length).toBeGreaterThan(1500);
  });

  it("are mirror-symmetric across both middle lines (as the game's quadrant placed four times)", () => {
    const key = (p: Vec3Tuple): string => p.map((v) => Math.round(v / 4)).join(",");
    const places = new Set(graph.vertices.map(key));
    let missing = 0;
    for (const p of graph.vertices) {
      for (const q of [[-p[0], p[1], p[2]], [p[0], -p[1], p[2]]] as Vec3Tuple[]) {
        if (!places.has(key(q))) missing++;
      }
    }
    expect(missing).toBe(0);
  });

  it("meet three at a point, as a lattice's, but for the seams' joins and the open bottom", () => {
    const degree = new Array<number>(graph.vertices.length).fill(0);
    for (const [a, b] of graph.edges) {
      degree[a] = (degree[a] ?? 0) + 1;
      degree[b] = (degree[b] ?? 0) + 1;
    }
    expect(Math.max(...degree)).toBeLessThanOrEqual(4);
    // Up at the ceiling (the seams): most loose ends joined (two per period along the back walls and corners), the
    // rest in the corners (their cells bigger, as the game's)
    const loose = graph.vertices.filter((p, i) => p[2] > 2000 && (degree[i] ?? 0) < 3);
    const joined = graph.joins.filter(Boolean).length;
    expect(joined).toBeGreaterThan(30);
    expect(loose.length).toBeLessThan(joined * 0.4);
    for (const p of loose) expect.soft(Math.abs(p[0]) > 2500 && Math.abs(p[1]) > 3500, p.join(",")).toBe(true);
  });

  it("zip the seams without crossing the ceiling's beams", () => {
    type P2 = readonly [number, number];
    const crosses = (a: P2, b: P2, c: P2, d: P2): boolean => {
      const o = (p: P2, q: P2, r: P2): number => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    const flat = graph.edges
      .map(([a, b], e) => ({ a: graph.vertices[a], b: graph.vertices[b], join: graph.joins[e] ?? false }))
      .filter((e) => e.a !== undefined && e.b !== undefined && e.a[2] > 2047 && e.b[2] > 2047);
    let crossings = 0;
    for (const j of flat.filter((e) => e.join)) {
      for (const e of flat) {
        if (e === j || !j.a || !j.b || !e.a || !e.b) continue;
        if (crosses([j.a[0], j.a[1]], [j.b[0], j.b[1]], [e.a[0], e.a[1]], [e.b[0], e.b[1]])) crossings++;
      }
    }
    expect(crossings).toBe(0);
  });

  it("close the seams' cells as pentagons, hexagons and heptagons", () => {
    // The faces of the beams on the ceiling (with the walls' top row seen from above): walking each beam's sides,
    // turning as far right as possible at every point; those touching a join are the seams' cells
    // (the walls' top two rows: down to the notches' feet at z 1979)
    const top = graph.edges
      .map(([a, b], e) => ({ a, b, join: graph.joins[e] ?? false }))
      .filter(({ a, b }) => (graph.vertices[a]?.[2] ?? 0) > 1900 && (graph.vertices[b]?.[2] ?? 0) > 1900);
    const out = new Map<number, number[]>();
    for (const { a, b } of top) {
      out.set(a, [...(out.get(a) ?? []), b]);
      out.set(b, [...(out.get(b) ?? []), a]);
    }
    const isJoin = new Set(top.filter((e) => e.join).flatMap(({ a, b }) => [`${String(a)}>${String(b)}`, `${String(b)}>${String(a)}`]));
    const angle = (from: number, to: number): number => {
      const p = graph.vertices[from] ?? [0, 0, 0];
      const q = graph.vertices[to] ?? [0, 0, 0];
      return Math.atan2(q[1] - p[1], q[0] - p[0]);
    };
    const seen = new Set<string>();
    const sides: number[] = [];
    for (const { a, b, join } of top) {
      if (!join) continue;
      for (const [u0, v0] of [
        [a, b],
        [b, a],
      ] as const) {
        if (seen.has(`${String(u0)}>${String(v0)}`)) continue;
        let [u, v] = [u0, v0];
        let count = 0;
        let touchesJoin = false;
        while (count < 20) {
          seen.add(`${String(u)}>${String(v)}`);
          if (isJoin.has(`${String(u)}>${String(v)}`)) touchesJoin = true;
          count++;
          // At v, the next beam turning most to the right from where we came
          const back = angle(v, u);
          const next = (out.get(v) ?? [])
            .filter((w) => w !== u || (out.get(v) ?? []).length === 1)
            .map((w) => ({ w, turn: (((angle(v, w) - back) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) }))
            .sort((p, q) => p.turn - q.turn)[0]?.w;
          if (next === undefined) break;
          [u, v] = [v, next];
          if (u === u0 && v === v0) break;
        }
        // (the outer face, round the whole ceiling, is far bigger)
        if (touchesJoin && count < 20) sides.push(count);
      }
    }
    const share = (pred: (n: number) => boolean): number => sides.filter(pred).length / sides.length;
    expect(sides.length).toBeGreaterThan(30);
    expect(share((n) => n >= 5 && n <= 7), sides.join(" ")).toBeGreaterThan(0.8);
    expect(sides.filter((n) => n === 5).length).toBeGreaterThan(5);
  });
});

describe("the game's own cage, where exported locally", () => {
  it("draws each exported cell edge as a beam along its polyline, facing into the field", () => {
    const cage: CageExport = {
      nodes: [
        [0, 0, 2064],
        [100, 0, 2064],
        [200, 50, 2064],
        [300, 0, 2064],
      ],
      node_normals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      edges: [{ nodes: [0, 1] }, { nodes: [1, 2, 3] }],
    };
    const exported = graphFromExport(cage);
    expect(exported.edges).toEqual([
      [0, 1],
      [1, 3],
    ]);
    expect(exported.beams[1]?.points).toEqual([cage.nodes[1], cage.nodes[2], cage.nodes[3]]);
    expect(exported.beams[0]?.normals[0]).toEqual([-0, -0, -1]);
  });

  // (the static session's export: game-derived, local only; skipped where it isn't)
  const file = new URL("../../../out/bsim/assets_local/cage/cage_lattice.json", import.meta.url);
  it.skipIf(!existsSync(file))("reads the export: every cell edge a beam, round the whole field", () => {
    const cage = JSON.parse(readFileSync(file, "utf8")) as CageExport;
    const exported = graphFromExport(cage);
    // (the export's own beams first, the lower glass's after them)
    const own = exported.beams.slice(0, cage.edges.length);
    expect(own.length).toBe(1966);
    const xs = cage.nodes.map((p) => p[0]);
    const zs = cage.nodes.map((p) => p[2]);
    expect(Math.max(...xs)).toBeCloseTo(4112, 0);
    expect(Math.min(...zs)).toBeGreaterThan(255);
    // (the ceiling at z 2064, its beams' centre lines within a few uu)
    expect(Math.max(...zs)).toBeGreaterThan(2060);
    expect(Math.max(...zs)).toBeLessThan(2070);
  });

  it.skipIf(!existsSync(file))("carries the cage's wall cells down to the trim (never behind it), joined to it, off the goal mouths", () => {
    const cage = JSON.parse(readFileSync(file, "utf8")) as CageExport;
    const glass = graphFromExport(cage).beams.slice(cage.edges.length);
    // (only where the trim stops short of the cage's foot: the back walls, round the goals)
    expect(glass.length).toBeGreaterThan(30);
    // On the cage's own walls (its plane: the beams' ends at the cage's x or y, or round its corners), above the
    // glass's foot, below its lowest cells, and clear of the openings and their frames
    const nodeAt = new Set(cage.nodes.map((p) => `${String(Math.round(p[0]))},${String(Math.round(p[1]))}`));
    for (const beam of glass) {
      for (const p of beam.points) {
        expect.soft(p[2], p.join(",")).toBeGreaterThan(trimTop(p[0], p[1]) - 0.5);
        expect.soft(Math.abs(p[1]), p.join(",")).toBeGreaterThan(4000);
        expect.soft(p[2]).toBeLessThan(1300);
        if (Math.abs(p[1]) > 5000 && Math.abs(p[0]) < 960) expect.soft(p[2], p.join(",")).toBeGreaterThan(640 + 70);
      }
    }
    // Joined: most glass beams' top ends at one of the cage's joints (same x, y; the lattice repeats down the wall)
    const joined = glass.filter((b) => b.points.some((p) => nodeAt.has(`${String(Math.round(p[0]))},${String(Math.round(p[1]))}`)));
    expect(joined.length / glass.length).toBeGreaterThan(0.6);
  });
});
