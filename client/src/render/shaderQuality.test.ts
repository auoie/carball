// High Quality Shaders (QG-5..20): the materials with a low-quality branch on the Night arena and the pads, switched
import { Group, type Material, type Mesh, type ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { ArenaView } from "./arena";
import { BoostPadsView } from "./boostPads";
import { applyShaderQuality } from "./shaderQuality";
import { nightTheme } from "./themes/night";

describe("High Quality Shaders off: the materials' low-quality branches (QG-5..20)", () => {
  it("the grass, frames, trims, lower glass, ball overlay, cage beams and pad curtains switch; the rest don't; on again restores them", () => {
    const root = new Group();
    const arena = new ArenaView(nightTheme());
    const pads = new BoostPadsView([{ pos: vec3(-3584, 0, 72), big: true, active: true, cooldown: 0 }, { pos: vec3(0, -4240, 64), big: false, active: true, cooldown: 0 }]);
    root.add(arena.root, pads.root);
    /** The low-quality materials: their classes and their meshes' names */
    const low = (): Set<string> => {
      const names = new Set<string>();
      root.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined;
        const defines = (m as ShaderMaterial | undefined)?.defines;
        if (m && defines && "CARBALL_LQ" in defines) names.add(`${m.constructor.name}: ${o.name}`);
      });
      return names;
    };
    expect(low()).toEqual(new Set());
    const changed = applyShaderQuality(root, false);
    expect(changed).toBeGreaterThan(5);
    const names = [...low()];
    for (const part of ["GrassMaterial", "FrameMaterial", "SideTrimMaterial", "HexGlassMaterial", "ForceFieldMaterial", "curtains"]) {
      expect(names.some((n) => n.includes(part)), `${part}: ${names.join(", ")}`).toBe(true);
    }
    // (the pads' bases, the orb and the hex floor have no low-quality resource that changes them: QG-7, QG-21)
    expect(names.some((n) => n.endsWith(" base") || n.includes("orb"))).toBe(false);
    expect(applyShaderQuality(root, false)).toBe(0);
    expect(applyShaderQuality(root, true)).toBe(changed);
    expect(low()).toEqual(new Set());
  });
});
