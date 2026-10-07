// The arena drawn around our generated collision mesh (requires out/arena).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCmf } from "../engine/cmf";
import { ARENA } from "./arena";

const arenaPath = fileURLToPath(new URL("../../../out/arena/collision_meshes/soccar/soccar_arena.cmf", import.meta.url));
const mesh = parseCmf(new Uint8Array(readFileSync(arenaPath)));

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
});
