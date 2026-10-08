// The arena drawn around our generated collision mesh (requires out/arena).
import { describe, expect, it } from "vitest";
import { mergeMeshes, parseCmf } from "../engine/cmf";
import { arenaMeshes } from "../testing/arena";
import { ARENA } from "./arena";

const mesh = mergeMeshes(arenaMeshes().map(parseCmf));

describe("arena surfaces", () => {
  it("draws the flat side walls up to where the mesh's corner curves begin", () => {
    // The mesh's vertices on the side walls' plane, above the floor ramps: the curves start at the last of them
    let end = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] ?? 0;
      const y = mesh.positions[i + 1] ?? 0;
      const z = mesh.positions[i + 2] ?? 0;
      if (Math.abs(Math.abs(x) - ARENA.sideX) < 0.5 && z > 300) end = Math.max(end, Math.abs(y));
    }
    expect(end).toBeCloseTo(ARENA.cornerTangentY, 1);
  });

  it("knows where the goals' own floors begin (the field's outline reaches under them)", () => {
    // Floor-level, up-facing triangles in the goal, away from its sides: the nearest to the goal line
    let start = Infinity;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const v = [0, 1, 2].map((k) => (mesh.indices[t + k] ?? 0) * 3);
      const p = v.map((i) => [mesh.positions[i] ?? 0, mesh.positions[i + 1] ?? 0, mesh.positions[i + 2] ?? 0] as const);
      const cx = (p[0]?.[0] ?? 0) / 3 + (p[1]?.[0] ?? 0) / 3 + (p[2]?.[0] ?? 0) / 3;
      const cy = (p[0]?.[1] ?? 0) / 3 + (p[1]?.[1] ?? 0) / 3 + (p[2]?.[1] ?? 0) / 3;
      const cz = (p[0]?.[2] ?? 0) / 3 + (p[1]?.[2] ?? 0) / 3 + (p[2]?.[2] ?? 0) / 3;
      if (Math.abs(cx) < 700 && Math.abs(cy) > ARENA.backY && cz < 5) {
        for (const q of p) start = Math.min(start, Math.abs(q[1]) - ARENA.backY);
      }
    }
    expect(start).toBeCloseTo(ARENA.goalFloorStart, -1);
  });

  it("knows where the corner curves meet the back walls (the floor's outline follows them)", () => {
    let end = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] ?? 0;
      const y = mesh.positions[i + 1] ?? 0;
      const z = mesh.positions[i + 2] ?? 0;
      if (Math.abs(Math.abs(y) - ARENA.backY) < 0.5 && z > 300) end = Math.max(end, Math.abs(x));
    }
    expect(end).toBeCloseTo(ARENA.cornerTangentX, 1);
  });
});
