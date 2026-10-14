import { describe, expect, it } from "vitest";
import { arrowOnly, nameplateScale, plateTransform } from "./nameplates";

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

  it("keep the plate's bottom-centre on its point at any scale (the pivot, RV-280)", () => {
    // (CSS applies a transform list right to left on the element's points, origin top left)
    const image = (transform: string, w: number, h: number, px: number, py: number): [number, number] => {
      const ops = [...transform.matchAll(/(translate|scale)\(([^)]*)\)/g)].map((m) => ({ op: m[1], args: (m[2] ?? "").split(",").map((a) => a.trim()) }));
      let [x, y] = [px, py];
      for (const { op, args } of ops.reverse()) {
        const value = (a: string | undefined, size: number): number => (a?.endsWith("%") ? (parseFloat(a) / 100) * size : parseFloat(a ?? "0"));
        if (op === "scale") {
          const k = value(args[0], 1);
          [x, y] = [x * k, y * k];
        } else {
          [x, y] = [x + value(args[0], w), y + value(args[1], h)];
        }
      }
      return [x, y];
    };
    for (const k of [0.5, 1, 2]) {
      const [x, y] = image(plateTransform(300, 200, k), 140, 40, 70, 40);
      expect(x).toBeCloseTo(300, 9);
      expect(y).toBeCloseTo(200, 9);
    }
  });
});
