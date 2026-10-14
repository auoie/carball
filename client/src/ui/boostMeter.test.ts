import { describe, expect, it } from "vitest";
import { TICKS, orangeColor, orangeOuter, polar, wedgePath } from "./boostMeter";

describe("the boost meter's art (HUD-18)", () => {
  it("sweeps clockwise from 6 o'clock: 9 o'clock at 90 degrees, 12 at 180", () => {
    const at = (r: number, a: number): number[] => polar(r, a).map((v) => Math.round(v * 1000) / 1000);
    expect(at(50, 0)).toEqual([100, 150]);
    expect(at(50, 90)).toEqual([50, 100]);
    expect(at(50, 180)).toEqual([100, 50]);
  });

  it("tapers the orange bars from 69 to 87 and ramps their colour deep to light orange", () => {
    expect([orangeOuter(0), orangeOuter(90), orangeOuter(180), orangeOuter(200)]).toEqual([69, 78, 87, 87]);
    expect(orangeColor(0)).toEqual([255, 130, 5]);
    expect(orangeColor(90)).toEqual([255, 174, 49]);
    expect(orangeColor(180)).toEqual([255, 212, 86]);
  });

  it("has six ticks from the ring to the bars' outer edge, and an empty fill at 0", () => {
    expect(TICKS.map((t) => t.a)).toEqual([0, 45, 90, 135, 180, 225]);
    expect(TICKS.every((t) => t.from >= 61 && t.to <= 90 && t.to > t.from)).toBe(true);
    expect(wedgePath(0)).toBe("M 100 100 Z");
    expect(wedgePath(200)).toMatch(/ 1 1 /); // (past 180: the large arc)
  });
});
