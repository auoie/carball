// The arena with the game's materials (the stadium theme: notes/arena-visuals.md H-5, H-6, H-8, H-9, AV-15).
import { AdditiveBlending, type Material, Mesh, type Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ArenaView } from "./arena";
import { shockRing, shockWave } from "./cageBeams";
import { GlowStripMaterial, HexGlassMaterial, ForceFieldMaterial } from "./gameSurfaces";
import { HexWallMaterial } from "./hexWalls";
import { nightTheme } from "./themes/night";
import { stadiumTheme } from "./themes/stadium";

function materials(root: Object3D): Material[] {
  const out: Material[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(...(Array.isArray(o.material) ? (o.material as Material[]) : [o.material as Material]));
  });
  return out;
}

describe("the game's arena materials", () => {
  const stadium = new ArenaView(stadiumTheme());
  const night = new ArenaView(nightTheme());

  it("the stadium: the game's overlay on the walls, glass beside the goals and in them, glow sheets, additive beams", () => {
    const all = materials(stadium.root);
    expect(all.filter((m) => m instanceof ForceFieldMaterial)).toHaveLength(1);
    // (beside each goal, and the nets)
    expect(all.filter((m) => m instanceof HexGlassMaterial)).toHaveLength(3);
    // (each side wall, each team's half)
    expect(all.filter((m) => m instanceof GlowStripMaterial)).toHaveLength(4);
    expect(all.filter((m) => m instanceof HexWallMaterial)).toHaveLength(0);
    expect(all.filter((m) => m.blending === AdditiveBlending)).toHaveLength(1);
  });

  it("other themes keep our own look", () => {
    const all = materials(night.root);
    expect(all.filter((m) => m instanceof HexWallMaterial)).toHaveLength(2);
    expect(all.filter((m) => m instanceof GlowStripMaterial || m instanceof HexGlassMaterial || m instanceof ForceFieldMaterial)).toHaveLength(0);
    expect(all.filter((m) => m.blending === AdditiveBlending)).toHaveLength(0);
  });

  it("the shockwave: -0.25 at rest, to 1 over 2.5 s of world time after the explosion, back at rest for a new ball", () => {
    const ball = new Vector3();
    expect(stadium.shockWave).toBe(-0.25);
    stadium.explode();
    stadium.update(ball, 1.25);
    expect(stadium.shockWave).toBeCloseTo(0.375);
    stadium.update(ball, 5);
    expect(stadium.shockWave).toBe(1);
    stadium.newBall();
    expect(stadium.shockWave).toBe(-0.25);
    expect(shockWave(null)).toBe(-0.25);
  });

  it("its ring passes 4096 uu from the ball half a second after the explosion (H-8b)", () => {
    const d2 = (d: number): number => (d / 16384) ** 2;
    const wave = shockWave(0.5);
    expect(shockRing(d2(4096), wave)).toBeCloseTo(1);
    // (a ring over d2 in (SW, SW + 0.125): then 0-5793 uu, faint near the ball, none beyond; it appears at the ball
    // 0.25 s after the explosion, brightest there at 0.375 s)
    expect(shockRing(d2(1000), wave)).toBeLessThan(0.1);
    expect(shockRing(d2(5900), wave)).toBe(0);
    expect(shockRing(0, shockWave(0.24))).toBe(0);
    expect(shockRing(0, shockWave(0.375))).toBeCloseTo(1);
  });
});
