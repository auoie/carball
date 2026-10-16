// World Detail's gates on the stadium (QG-14/15): what each level draws
import type { Mesh, Object3D, ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { applyWorldDetail } from "./detail";
import { CITY_LIT_FROM } from "./themes/stadiumFarLayer";
import { stadiumTheme } from "./themes/stadium";

describe("World Detail on the stadium (QG-14/15)", () => {
  const theme = stadiumTheme();
  /** The named pieces drawn (each counted once, its parents shown too) */
  const drawn = (): Map<string, number> => {
    const names = new Map<string, number>();
    const walk = (o: Object3D): void => {
      if (!o.visible) return;
      if (o.name) names.set(o.name, (names.get(o.name) ?? 0) + 1);
      for (const c of o.children) walk(c);
    };
    walk(theme.root);
    return names;
  };

  it("High Quality draws everything; Quality drops the DetailMode High pieces; Performance the Medium ones too", () => {
    applyWorldDetail(theme.root, "highQuality");
    const all = drawn();
    expect(all.get("plaza: poplar")).toBe(9);
    expect(all.get("props: scaffold banner")).toBe(8);
    expect(all.get("lights: fog sheet")).toBe(6);
    for (const name of ["canopy", "lights: haze", "lights: flare sheets", "far layer: band"]) expect(all.has(name), name).toBe(true);
    expect(all.get("props: flag cloth")).toBe(20);

    applyWorldDetail(theme.root, "quality");
    const quality = drawn();
    // (the scaffolds, the small poplars and the far fog band gone; the three big poplars stay)
    expect(quality.get("plaza: poplar")).toBe(3);
    expect(quality.has("props: scaffold banner")).toBe(false);
    expect(quality.has("far layer: band")).toBe(false);
    expect(quality.get("lights: fog sheet")).toBe(6);
    expect(quality.has("canopy")).toBe(true);

    applyWorldDetail(theme.root, "performance");
    const performance = drawn();
    // (the canopy's glass, the haze, the flare sheets, the three big far fog sheets and the corner flags gone too)
    for (const name of ["canopy", "lights: haze", "lights: flare sheets", "props: flag cloth"]) expect(performance.has(name), name).toBe(false);
    expect(performance.get("lights: fog sheet")).toBe(3);
    expect(performance.get("plaza: poplar")).toBe(3);
    // (what's always drawn: the mullions, the crowd, the sky, the city, the country flags)
    for (const name of ["lights: mullions", "crowd", "sky dome", "far layer: city", "flags: country ring"]) expect(performance.has(name), name).toBe(true);

    applyWorldDetail(theme.root, "highQuality");
    expect(drawn()).toEqual(all);
  });
});

describe("the city's window lights at World Detail Performance (QG-14, RV-507)", () => {
  it("a quarter of the lit windows (the C lights) at Performance, all of them above, the towers drawn either way", () => {
    const theme = stadiumTheme();
    let city: Mesh | undefined;
    theme.root.traverse((o) => {
      if (o.name === "far layer: city") city = o as Mesh;
    });
    if (!city) throw new Error("no city");
    const litFrom = (): number => ((city?.material as ShaderMaterial).uniforms["litFrom"] as { value: number }).value;
    applyWorldDetail(theme.root, "performance");
    expect(litFrom()).toBeCloseTo(CITY_LIT_FROM.performance, 9);
    expect(city.visible).toBe(true);
    expect((1 - CITY_LIT_FROM.performance) / (1 - CITY_LIT_FROM.highQuality)).toBeCloseTo(0.25, 2);
    applyWorldDetail(theme.root, "quality");
    expect(litFrom()).toBe(CITY_LIT_FROM.highQuality);
  });
});

