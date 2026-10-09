// The arena drawn around our generated collision mesh (requires out/arena).
import { describe, expect, it } from "vitest";
import { mergeMeshes, parseCmf } from "../engine/cmf";
import { arenaMeshes } from "../testing/arena";
import { type Vec3, cross, dot, sub, vec3 } from "../math/vec";
import { type BufferAttribute, BufferGeometry, Mesh } from "three";
import { ARENA, buildFieldMarkings } from "./arena";
import { floorOutline } from "./arenaSurface";

const mesh = mergeMeshes(arenaMeshes().map(parseCmf));

/** The nearest point where a ray from `origin` along the axis `axis` (0 +x, 1 +y) hits the mesh, or Infinity
 *  (Möller–Trumbore against every triangle; both sides count). */
function firstHit(origin: Vec3, axis: 0 | 1): number {
  const dir = axis === 0 ? vec3(1, 0, 0) : vec3(0, 1, 0);
  const vertex = (i: number): Vec3 => vec3(mesh.positions[i * 3] ?? 0, mesh.positions[i * 3 + 1] ?? 0, mesh.positions[i * 3 + 2] ?? 0);
  let best = Infinity;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = vertex(mesh.indices[t] ?? 0);
    const e1 = sub(vertex(mesh.indices[t + 1] ?? 0), a);
    const e2 = sub(vertex(mesh.indices[t + 2] ?? 0), a);
    const h = cross(dir, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-9) continue;
    const s = sub(origin, a);
    const u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) continue;
    const dist = dot(e2, q) / det;
    if (dist > 0) best = Math.min(best, (axis === 0 ? origin.x : origin.y) + dist);
  }
  return best;
}

describe("arena surfaces", () => {
  it("draws the flat side walls up to where the mesh's corner curves begin", () => {
    // Toward the side wall at mid height: before the corner curve the mesh is behind the wall's plane (or absent),
    // after it the curve is in front
    const before = firstHit(vec3(3800, ARENA.cornerTangentY - 50, 1000), 0);
    const after = firstHit(vec3(3800, ARENA.cornerTangentY + 50, 1000), 0);
    expect(before).toBeGreaterThanOrEqual(ARENA.sideX - 0.01);
    expect(after).toBeLessThan(ARENA.sideX - 0.1);
  });

  it("knows where the goals' own floors begin (the field's outline reaches under them)", () => {
    // Up-facing triangles of the goal's floor (its ramp), away from its sides: the nearest to the goal line
    let start = Infinity;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const v = [0, 1, 2].map((k) => (mesh.indices[t + k] ?? 0) * 3);
      const p = v.map((i) => [mesh.positions[i] ?? 0, mesh.positions[i + 1] ?? 0, mesh.positions[i + 2] ?? 0] as const);
      const cx = (p[0]?.[0] ?? 0) / 3 + (p[1]?.[0] ?? 0) / 3 + (p[2]?.[0] ?? 0) / 3;
      const cy = (p[0]?.[1] ?? 0) / 3 + (p[1]?.[1] ?? 0) / 3 + (p[2]?.[1] ?? 0) / 3;
      const cz = (p[0]?.[2] ?? 0) / 3 + (p[1]?.[2] ?? 0) / 3 + (p[2]?.[2] ?? 0) / 3;
      if (Math.abs(cx) < 700 && Math.abs(cy) > ARENA.backY && cz < 20) {
        for (const q of p) start = Math.min(start, Math.abs(q[1]) - ARENA.backY);
      }
    }
    expect(start).toBeCloseTo(ARENA.goalFloorStart, 1);
  });

  it("knows where the corner curves meet the back walls (the floor's outline follows them)", () => {
    const before = firstHit(vec3(ARENA.cornerTangentX - 50, 4900, 1000), 1);
    const after = firstHit(vec3(ARENA.cornerTangentX + 50, 4900, 1000), 1);
    expect(before).toBeGreaterThanOrEqual(ARENA.backY - 0.01);
    expect(after).toBeLessThan(ARENA.backY - 0.1);
  });

  it("keeps the field's markings on the floor (inside its outline: none running under or past the trim)", () => {
    const outline = floorOutline();
    const inside = (x: number, y: number): boolean => {
      let odd = false;
      for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const [ax, ay] = outline[i] ?? [0, 0];
        const [bx, by] = outline[j] ?? [0, 0];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) odd = !odd;
      }
      return odd;
    };
    const markings = buildFieldMarkings(null);
    markings.updateMatrixWorld(true);
    let checked = 0;
    markings.traverse((part) => {
      if (!(part instanceof Mesh)) return;
      const geometry: unknown = part.geometry;
      if (!(geometry instanceof BufferGeometry)) return;
      const position = geometry.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < position.count; i++) {
        // (Three's frame: x, up, the game's y)
        const x = position.getX(i);
        const y = position.getZ(i);
        // (a hair inside, so points on the outline itself count)
        expect.soft(inside(x * 0.9999, y * 0.9999), `${String(x)},${String(y)}`).toBe(true);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(100);
  });
});
