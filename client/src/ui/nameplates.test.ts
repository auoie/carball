import { describe, expect, it } from "vitest";
import { NAMEPLATE_UU, NAMEPLATE_YOU, arrowOnly, nameplateScale, platesAt, plateSize } from "./nameplates";

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

  it("stand NAMEPLATE_UU high at scale 1 in the world, as wide as their texture says", () => {
    expect(plateSize(4, 1)).toEqual({ width: 4 * NAMEPLATE_UU, height: NAMEPLATE_UU });
    expect(plateSize(4, 2.5).height).toBe(2.5 * NAMEPLATE_UU);
  });

  it("sit 60 uu over their cars, the player's own saying YOU (the replay shows every car's: RV-288)", () => {
    const cars = new Map([
      [1, { pos: { x: 0, y: 0, z: 17 }, team: 0 }],
      [2, { pos: { x: 500, y: 100, z: 17 }, team: 1 }],
    ]);
    const plates = platesAt(cars, 1, (car) => `P${String(car)}`, (top) => ({ x: top.x, y: top.z, pxPerUnit: 1, distance: 1000, horizontalFov: 90 }));
    expect(plates.map((p) => [p.name, p.team, p.at?.x, p.at?.y, p.top.z])).toEqual([
      [NAMEPLATE_YOU, 0, 0, 77, 77],
      ["P2", 1, 500, 77, 77],
    ]);
  });
});
