// The materials' constant tables in one shared texture (the user's decision, 2026-10-16): its layout, and no material
// sending them as uniform arrays any more
import { Mesh, type ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { ArenaView } from "./arena";
import { ENV_RADIAL, FIELD_TABLES, GRASS_LIGHT, PACK_G, PB_A, TABLE_WIDTH, tableTexels, tablesUniform } from "./constTables";
import { nightTheme } from "./themes/night";
import { stadiumTheme } from "./themes/stadium";

describe("the constant tables' texture", () => {
  it("each table in its row and channel, as float32", () => {
    const t = tableTexels(FIELD_TABLES);
    const at = (row: number, i: number, c: number): number => t[(row * TABLE_WIDTH + i) * 4 + c] ?? NaN;
    expect(PB_A.map((_, i) => at(0, i, 0))).toEqual(PB_A.map((v) => Math.fround(v)));
    expect(PACK_G.map((_, i) => at(1, i, 2))).toEqual(PACK_G.map((v) => Math.fround(v)));
    expect(ENV_RADIAL.map((_, i) => at(2, i, 0))).toEqual(ENV_RADIAL.map((v) => Math.fround(v)));
    expect(GRASS_LIGHT.y.map((_, i) => [at(4, i, 0), at(4, i, 1), at(4, i, 2)])).toEqual(GRASS_LIGHT.y.map((rgb) => rgb.map((v) => Math.fround(v))));
  });

  it("one texture for every material: none of the Night arena's sends the tables as uniform arrays", () => {
    expect(tablesUniform().value).toBe(tablesUniform().value);
    const arena = new ArenaView(nightTheme());
    const arrays = new Set<string>();
    let sharing = 0;
    arena.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const u = (o.material as ShaderMaterial).uniforms as Record<string, { value: unknown }> | undefined;
      if (!u) return;
      for (const k of ["pbA", "pbB", "pbG", "pbR", "hpR", "hpA", "packG", "envRadial", "envSpread", "lightX", "lightY"]) if (k in u) arrays.add(k);
      if (u["constTables"]?.value === tablesUniform().value) sharing++;
    });
    expect([...arrays]).toEqual([]);
    expect(sharing).toBeGreaterThan(5);
  });

  it("every shader reading the tables declares their sampler first (the stadium's goal floor read envG before it: RV, 2026-10-16)", () => {
    let checked = 0;
    for (const arena of [new ArenaView(nightTheme()), new ArenaView(stadiumTheme())]) {
      arena.root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const shader = (o.material as Partial<ShaderMaterial>).fragmentShader;
        if (typeof shader !== "string" || !/tableAt\(|tableProfile\(/.test(shader)) return;
        checked++;
        const sampler = shader.indexOf("uniform sampler2D constTables;");
        expect(sampler, o.name).toBeGreaterThanOrEqual(0);
        for (const use of ["float envG(", "tableProfile(T_", "tableAt(3"]) {
          const at = shader.indexOf(use);
          if (at >= 0) expect(at, `${o.name}: ${use}`).toBeGreaterThan(sampler);
        }
      });
    }
    expect(checked).toBeGreaterThan(5);
  });
});
