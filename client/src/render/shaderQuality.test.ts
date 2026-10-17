// High Quality Shaders (QG-5..20): the materials with a low-quality branch on the arena, switched
import { type Material, type Mesh, type ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { ArenaView } from "./arena";
import { applyShaderQuality } from "./shaderQuality";
import { nightTheme } from "./themes/night";

describe("High Quality Shaders off: the materials' low-quality branches (QG-5..20)", () => {
  it("the glasshouse's glass and the nets' hex glass switch; on again restores them", () => {
    const arena = new ArenaView(nightTheme());
    /** The low-quality materials: their classes and their meshes' names */
    const low = (): Set<string> => {
      const names = new Set<string>();
      arena.root.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined;
        const defines = (m as ShaderMaterial | undefined)?.defines;
        if (m && defines && "CARBALL_LQ" in defines) names.add(`${m.constructor.name}: ${o.name}`);
      });
      return names;
    };
    expect(low()).toEqual(new Set());
    const changed = applyShaderQuality(arena.root, false);
    expect(changed).toBeGreaterThan(0);
    const names = [...low()];
    for (const part of ["GreenhouseGlassMaterial", "HexGlassMaterial"]) {
      expect(names.some((n) => n.includes(part)), `${part}: ${names.join(", ")}`).toBe(true);
    }
    expect(applyShaderQuality(arena.root, false)).toBe(0);
    expect(applyShaderQuality(arena.root, true)).toBe(changed);
    expect(low()).toEqual(new Set());
  });
});
