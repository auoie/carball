import { describe, expect, it } from "vitest";
import { arrowOnly, nameplateScale } from "./nameplates";

describe("nameplates (HUD-13)", () => {
  it("grow from 0.5 at the car to 9 at 10000 uu, by the FOV up to 90 degrees, times the setting", () => {
    expect(nameplateScale(0, 90, 1)).toBe(0.5);
    expect(nameplateScale(5000, 110, 1)).toBeCloseTo(4.75);
    expect(nameplateScale(20000, 110, 2)).toBe(18);
    expect(nameplateScale(10000, 45, 1)).toBeCloseTo(9 * 0.55);
  });

  it("show only the arrow beyond 7000 uu in Distance Fade, always in Simplified, never in Default", () => {
    expect(arrowOnly("default", 9000)).toBe(false);
    expect(arrowOnly("distanceFade", 7000)).toBe(false);
    expect(arrowOnly("distanceFade", 7001)).toBe(true);
    expect(arrowOnly("simplified", 100)).toBe(true);
  });
});
