// The cage's beams (src/render/cage.ts, cageLayout.ts) against the game's (scripts/cage_topology.json; where the
// static session's local export is, its lattice) and our drawn surface.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Vec3Tuple, buildArenaSurface, trimTop } from "./arenaSurface";
import { type CageExport, graphFromExport, shippableCage } from "./cage";
import { CAGE_TOPOLOGY, layoutCage } from "./cageLayout";

const shipped = shippableCage();
const graph = graphFromExport(shipped);
const surface = buildArenaSurface();
// (the static session's export of the game's own lattice: game-derived, local only; tests using it skip without it)
const file = new URL("../../../out/bsim/assets_local/cage/cage_lattice.json", import.meta.url);

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

describe("the cage laid out from its shippable topology", () => {
  it("has the game's cells: 603 of five, six and seven sides (24 pentagons, 18 heptagons), one disc", () => {
    const sides = CAGE_TOPOLOGY.cells.map((c) => c.sides);
    expect(sides.length).toBe(603);
    expect(sides.filter((n) => n === 5).length).toBe(24);
    expect(sides.filter((n) => n === 7).length).toBe(18);
    expect(sides.filter((n) => n === 6).length).toBe(561);
    // Euler: joints (nodes at chain ends) - beams + cells = 1 for a disc with its outer face left out... counted with
    // the rim's open ends as joints: V - E + F = 2 including the outer face
    const joints = new Set(CAGE_TOPOLOGY.edges.flatMap((chain) => [chain[0], chain.at(-1)]));
    expect(joints.size - CAGE_TOPOLOGY.edges.length + (CAGE_TOPOLOGY.cells.length + 1)).toBe(2);
    expect(graph.beams.length).toBeGreaterThan(CAGE_TOPOLOGY.edges.length); // (and the lower glass's)
  });

  it("lies on our arena surface pushed 16 uu out, as the game's cage sits behind its walls, fillet and ceiling", () => {
    const cell = (v: number): number => Math.floor(v / 256);
    const grid = new Map<string, number[]>();
    for (let t = 0; t < surface.indices.length; t += 3) {
      const tri = [0, 1, 2].map((k) => at(surface.indices[t + k] ?? 0));
      const lo = [0, 1, 2].map((k) => cell(Math.min(...tri.map((p) => p[k] ?? 0)) - 24));
      const hi = [0, 1, 2].map((k) => cell(Math.max(...tri.map((p) => p[k] ?? 0)) + 24));
      for (let x = lo[0] ?? 0; x <= (hi[0] ?? 0); x++)
        for (let y = lo[1] ?? 0; y <= (hi[1] ?? 0); y++)
          for (let z = lo[2] ?? 0; z <= (hi[2] ?? 0); z++) {
            const key = `${String(x)},${String(y)},${String(z)}`;
            grid.set(key, [...(grid.get(key) ?? []), t]);
          }
    }
    let nearest = Infinity;
    let farthest = 0;
    for (const p of shipped.nodes) {
      let d = Infinity;
      for (const t of grid.get(`${String(cell(p[0]))},${String(cell(p[1]))},${String(cell(p[2]))}`) ?? []) {
        const [a, b, c] = [0, 1, 2].map((k) => at(surface.indices[t + k] ?? 0)) as [Vec3Tuple, Vec3Tuple, Vec3Tuple];
        d = Math.min(d, pointTriangle(p, a, b, c));
      }
      nearest = Math.min(nearest, d);
      farthest = Math.max(farthest, d);
    }
    // (16, and up to the sag of our curves' chords more: ~3 uu where the corner's and the fillet's add up)
    expect(nearest).toBeGreaterThan(15.5);
    expect(farthest).toBeLessThan(20);
  });

  it("puts the side walls' rows where the game's are: z 256 r, a third of a half period (896 / 6) a step along", () => {
    let checked = 0;
    CAGE_TOPOLOGY.nodes.forEach((node, i) => {
      const [kind, r, k] = node.a;
      if (kind !== "wall" || Number(r) > 6 || Number(k) > 24) return;
      const [sx = 1, sy = 1] = node.q;
      const p = shipped.nodes[i] ?? [0, 0, 0];
      expect.soft(p[0]).toBeCloseTo(4112 * sx, 3);
      expect.soft(p[1]).toBeCloseTo(((Number(k) * 896) / 6) * sy, 2);
      expect.soft(p[2]).toBeCloseTo(256 * Number(r), 4);
      checked++;
    });
    expect(checked).toBeGreaterThan(100);
  });

  it("is mirror-symmetric across both middle lines (as the game's quadrant placed four times)", () => {
    const key = (p: Vec3Tuple): string => p.map((v) => Math.round(v)).join(",");
    const places = new Set(shipped.nodes.map(key));
    let missing = 0;
    for (const p of shipped.nodes) for (const q of [[-p[0], p[1], p[2]], [p[0], -p[1], p[2]]] as Vec3Tuple[]) missing += places.has(key(q)) ? 0 : 1;
    expect(missing).toBe(0);
  });

  it("has beams only where the game's are: from z 256 up, off the goal mouths below z 704; carried down to the trim", () => {
    const own = graph.beams.slice(0, CAGE_TOPOLOGY.edges.length);
    for (const beam of own) {
      for (const p of beam.points) {
        expect.soft(p[2]).toBeGreaterThan(255.5);
        if (Math.abs(p[1]) > 5000 && Math.abs(p[0]) < 1100) expect.soft(p[2], p.join(",")).toBeGreaterThan(703);
      }
    }
    const glass = graph.beams.slice(CAGE_TOPOLOGY.edges.length);
    expect(glass.length).toBeGreaterThan(30);
    for (const beam of glass) {
      for (const p of beam.points) {
        expect.soft(p[2], p.join(",")).toBeGreaterThan(trimTop(p[0], p[1]) - 0.5);
        if (Math.abs(p[1]) > 5000 && Math.abs(p[0]) < 960) expect.soft(p[2], p.join(",")).toBeGreaterThan(640 + 70);
      }
    }
  });

  it.skipIf(!existsSync(file))("lands on the game's own lattice: median under 1 uu, p90 under 15, none over 70", () => {
    const game = (JSON.parse(readFileSync(file, "utf8")) as CageExport).nodes;
    const { positions } = layoutCage();
    expect(positions.length).toBe(game.length); // (the topology keeps the export's node order)
    const errors = positions.map((p, i) => {
      const g = game[i] ?? [0, 0, 0];
      return Math.hypot(p[0] - g[0], p[1] - g[1], p[2] - g[2]);
    });
    errors.sort((x, y) => x - y);
    const quantile = (q: number): number => errors[Math.floor(q * (errors.length - 1))] ?? Infinity;
    expect(quantile(0.5)).toBeLessThan(1);
    expect(quantile(0.9)).toBeLessThan(15);
    expect(quantile(1)).toBeLessThan(70);
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
