// The boost ring's fill (src/ui/boostRing.ts): full at 100, empty at 0, its share of the ring in between, from 12 o'clock
import { describe, expect, it } from "vitest";
import { ringDash, ringFill } from "./boostRing";

describe("the boost ring", () => {
  it("full at 100, empty at 0, half at 50; never past either end", () => {
    expect([0, 50, 100].map(ringFill)).toEqual([0, 0.5, 1]);
    expect([ringFill(-5), ringFill(120)]).toEqual([0, 1]);
    expect(ringFill(33.4)).toBeCloseTo(0.334, 6);
  });

  it("its dash: the filled length then the rest, one period of the circle's 100; full the whole circle undashed", () => {
    expect([ringDash(0), ringDash(33), ringDash(99.5), ringDash(100)]).toEqual(["0.00 100.00", "33.00 67.00", "99.50 0.50", "none"]);
  });
});
