// The drawn walls, ceiling and goals against the collision mesh (requires out/arena): the same surfaces the ball
// bounces off, facing into the field (or the goal) everywhere, covering the ceiling and the goals' side walls once
// (no gaps or overlaps where the pattern's parts meet).
import { describe, expect, it } from "vitest";
import { mergeMeshes, parseCmf } from "../engine/cmf";
import { arenaMeshes } from "../testing/arena";
import { buildArenaSurface, floorOutline } from "./arenaSurface";
import { buildGoalSurface } from "./goalSurface";

const surface = buildArenaSurface();
const goals = buildGoalSurface(180);
const collision = mergeMeshes(arenaMeshes().map(parseCmf));

type V = [number, number, number];
const at = (p: ArrayLike<number>, i: number): V => [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Distance from p to the triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriangle(p: V, a: V, b: V, c: V): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const closest = (q: V): number => Math.hypot(...sub(p, q));
  if (d1 <= 0 && d2 <= 0) return closest(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return closest(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return closest([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]);
  }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return closest(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return closest([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return closest([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return closest([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

/** The largest distance from any of `positions`' vertices to the collision mesh, or to the planes the physics adds
 *  (the side walls, the floor, the ceiling). */
function farthestFromCollision(positions: Float32Array): number {
  // Collision triangles by 256 uu cells of their bounds (a few uu wider)
  const cell = (v: number): number => Math.floor(v / 256);
  const grid = new Map<string, number[]>();
  for (let t = 0; t < collision.indices.length; t += 3) {
    const tri = [0, 1, 2].map((k) => at(collision.positions, collision.indices[t + k] ?? 0));
    const lo = [0, 1, 2].map((k) => cell(Math.min(...tri.map((p) => p[k] ?? 0)) - 3));
    const hi = [0, 1, 2].map((k) => cell(Math.max(...tri.map((p) => p[k] ?? 0)) + 3));
    for (let x = lo[0] ?? 0; x <= (hi[0] ?? 0); x++)
      for (let y = lo[1] ?? 0; y <= (hi[1] ?? 0); y++)
        for (let z = lo[2] ?? 0; z <= (hi[2] ?? 0); z++) {
          const key = `${String(x)},${String(y)},${String(z)}`;
          const list = grid.get(key) ?? [];
          list.push(t);
          grid.set(key, list);
        }
  }
  let worst = 0;
  for (let i = 0; i < positions.length / 3; i++) {
    const p = at(positions, i);
    let d = Math.min(Math.abs(Math.abs(p[0]) - 4096), Math.abs(p[2]), Math.abs(p[2] - 2048));
    for (const t of grid.get(`${String(cell(p[0]))},${String(cell(p[1]))},${String(cell(p[2]))}`) ?? []) {
      const [a, b, c] = [0, 1, 2].map((k) => at(collision.positions, collision.indices[t + k] ?? 0)) as [V, V, V];
      d = Math.min(d, pointTriangle(p, a, b, c));
    }
    worst = Math.max(worst, d);
  }
  return worst;
}

type P2 = readonly [number, number];

/** How many of the triangles (2D) each point lies inside (points within 0.5 uu of a triangle's edge: -1, unsure). */
function coverage(triangles: readonly (readonly [P2, P2, P2])[], points: readonly P2[]): number[] {
  const cell = (v: number): number => Math.floor(v / 200);
  const grid = new Map<string, number[]>();
  triangles.forEach((tri, i) => {
    const xs = tri.map((p) => p[0]);
    const ys = tri.map((p) => p[1]);
    for (let x = cell(Math.min(...xs)); x <= cell(Math.max(...xs)); x++)
      for (let y = cell(Math.min(...ys)); y <= cell(Math.max(...ys)); y++) {
        const key = `${String(x)},${String(y)}`;
        grid.set(key, [...(grid.get(key) ?? []), i]);
      }
  });
  return points.map((p) => {
    let inside = 0;
    for (const i of grid.get(`${String(cell(p[0]))},${String(cell(p[1]))}`) ?? []) {
      const tri = triangles[i];
      if (!tri) continue;
      const area = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
      if (Math.abs(area) < 1e-6) continue;
      // Signed distances to the edges (positive inside)
      const sides = [0, 1, 2].map((k) => {
        const a = tri[k] ?? p;
        const b = tri[(k + 1) % 3] ?? p;
        return (Math.sign(area) * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      });
      if (sides.every((d) => d > 0.5)) inside++;
      else if (sides.every((d) => d > -0.5)) return -1;
    }
    return inside;
  });
}

/** The surface's vertices in the walls' triangles (any of whose corners is below the ceiling), the rest the ceiling's */
const wallVertices = (() => {
  const set = new Set<number>();
  for (let t = 0; t < surface.indices.length; t += 3) {
    const tri = [0, 1, 2].map((k) => surface.indices[t + k] ?? 0);
    if (tri.some((i) => at(surface.positions, i)[2] < 2048 - 1e-3)) for (const i of tri) set.add(i);
  }
  return set;
})();
const onCeiling = (i: number): boolean => !wallVertices.has(i);

/** Whether p is inside the polygon (even-odd). */
function insidePolygon(p: P2, polygon: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] ?? p;
    const b = polygon[j] ?? p;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

describe("the drawn arena walls", () => {
  it("face into the field everywhere", () => {
    let outward = 0;
    for (let t = 0; t < surface.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => at(surface.positions, surface.indices[t + k] ?? 0)) as [V, V, V];
      const n = cross(sub(b, a), sub(c, a));
      const centroid: V = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      // (the middle of the field, halfway up: in front of every wall, floor fillet and ceiling fillet)
      if (dot(n, sub([0, 0, 1024], centroid)) <= 0) outward++;
    }
    expect(outward).toBe(0);
  });

  it("lie on the collision surface (the mesh, or the planes the physics adds: side walls, floor, ceiling)", () => {
    expect(farthestFromCollision(surface.positions)).toBeLessThan(2);
  });

  it("cover the ceiling once: its parts from different walls meet without gaps or overlaps", () => {
    const H = 2048;
    const ceiling: [P2, P2, P2][] = [];
    for (let t = 0; t < surface.indices.length; t += 3) {
      const tri = [0, 1, 2].map((k) => surface.indices[t + k] ?? 0);
      if (tri.every(onCeiling)) ceiling.push(tri.map((i): P2 => [at(surface.positions, i)[0], at(surface.positions, i)[1]]) as [P2, P2, P2]);
    }
    // Its outline: the ceiling fillet's top edge (the walls' vertices at the ceiling's height), by angle
    const edge = [...wallVertices].filter((i) => Math.abs(at(surface.positions, i)[2] - H) < 1e-3);
    const outline = edge
      .map((i): P2 => [at(surface.positions, i)[0], at(surface.positions, i)[1]])
      .sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
    const points: P2[] = [];
    for (let x = -4096 + 13.7; x < 4096; x += 61.3)
      for (let y = -5120 + 7.9; y < 5120; y += 59.1) if (insidePolygon([x, y], outline)) points.push([x, y]);
    const counts = coverage(ceiling, points);
    expect(points.length).toBeGreaterThan(15000);
    expect(counts.filter((c) => c === 0).length, "gaps").toBe(0);
    expect(counts.filter((c) => c > 1).length, "overlaps").toBe(0);
  });
});

describe("the floor's outline", () => {
  const outline = floorOutline();

  it("is the trim's foot (where the floor fillet leaves the floor), round the posts and across the mouths", () => {
    const foot = [];
    for (let i = 0; i < surface.positions.length / 3; i++) if (surface.bands[i] === 0) foot.push(at(surface.positions, i));
    for (const [x, y] of outline) {
      const nearest = Math.min(...foot.map((p) => Math.hypot(p[0] - x, p[1] - y)));
      // (round the posts and across the mouths: the post bases' foot and the goals' floors' edge, y 5128)
      if (Math.abs(x) <= 904 && Math.abs(y) > 5000) expect.soft(Math.hypot(Math.abs(x) - 904, Math.abs(y) - 5128) <= 104.1 || Math.abs(Math.abs(y) - 5128) < 1e-6, `${String(x)},${String(y)}`).toBe(true);
      else expect.soft(nearest, `${String(x)},${String(y)}`).toBeLessThan(0.5);
    }
  });

  it("goes round anticlockwise (the floor faces up) and stays inside the walls", () => {
    let area = 0;
    outline.forEach(([x, y], i) => {
      const [nx, ny] = outline[(i + 1) % outline.length] ?? [x, y];
      area += x * ny - nx * y;
    });
    expect(area).toBeGreaterThan(0);
    for (const [x, y] of outline) {
      expect.soft(Math.abs(x)).toBeLessThanOrEqual(4096 - 96);
      expect.soft(Math.abs(y)).toBeLessThanOrEqual(5128 + 1e-6);
    }
  });
});

describe("the drawn goals", () => {
  const triangles = (indices: Uint32Array): [V, V, V][] => {
    const out: [V, V, V][] = [];
    for (let t = 0; t < indices.length; t += 3) {
      out.push([0, 1, 2].map((k) => at(goals.positions, indices[t + k] ?? 0)) as [V, V, V]);
    }
    return out;
  };

  it("lie on the collision surface", () => {
    expect(farthestFromCollision(goals.positions)).toBeLessThan(1);
  });

  it("face into the goal: the net, the floor, the mouth's lip, and the post bases away from the posts", () => {
    let wrong = 0;
    for (const [indices, inward] of [
      [goals.net, (c: V): V => (Math.abs(c[0]) > 895.9 ? [-Math.sign(c[0]), 0, 0] : [-c[0], Math.sign(c[1]) * 5570 - c[1], 320 - c[2]])],
      [goals.floor, (): V => [0, 0, 1]],
      [goals.lip, (c: V): V => [-Math.sign(c[0]) * (Math.abs(c[0]) > 880 ? 1 : 0), -Math.sign(c[1]), c[2] > 544 ? -1 : 0]],
      [goals.postBase, (c: V): V => [c[0] - Math.sign(c[0]) * 904, c[1] - Math.sign(c[1]) * 5128, c[2] > 0.1 ? 0 : 1]],
    ] as const) {
      for (const [a, b, c] of triangles(indices)) {
        const centroid: V = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        if (dot(cross(sub(b, a), sub(c, a)), inward(centroid)) <= 0) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });

  it("cover each side wall once: its parts from the floor, the back and the roof meet without gaps or overlaps", () => {
    // Orange's goal, its +x side wall (y, z)
    const side = triangles(goals.net)
      .filter((tri) => tri.every((p) => Math.abs(p[0] - 896) < 1e-3 && p[1] > 0))
      .map((tri) => tri.map((p): P2 => [p[1], p[2]]) as [P2, P2, P2]);
    // Its outline: where the rounded edges end (their vertices on the wall) and the post's front edge
    const edge = new Set<string>();
    for (const tri of triangles(goals.net)) {
      if (tri.some((p) => p[0] < 895.9) && tri.every((p) => p[0] > 0 && p[1] > 0)) {
        for (const p of tri) if (Math.abs(p[0] - 896) < 1e-3) edge.add(`${String(p[1])},${String(p[2])}`);
      }
    }
    const centre: P2 = [500, 320];
    const outline = [...edge]
      .map((k): P2 => k.split(",").map(Number) as unknown as P2)
      .sort((a, b) => Math.atan2(a[1] - centre[1], a[0] - centre[0]) - Math.atan2(b[1] - centre[1], b[0] - centre[0]));
    const points: P2[] = [];
    for (let y = 5120 + 3.3; y < 6100; y += 9.7)
      for (let z = 1.9; z < 650; z += 9.1) if (insidePolygon([y, z], outline)) points.push([y, z]);
    const counts = coverage(side, points);
    expect(points.length).toBeGreaterThan(2500);
    expect(counts.filter((c) => c === 0).length, "gaps").toBe(0);
    expect(counts.filter((c) => c > 1).length, "overlaps").toBe(0);
  });
});
