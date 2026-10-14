import { describe, expect, it } from "vitest";
import { BOURGEOIS_CAP_HEIGHT, NUMBERS_ADVANCE, NUMBERS_DIGIT_HEIGHT, capScale, numbersTrack } from "./hudFont";

describe("the header fonts' substitute", () => {
  it("is scaled to Bourgeois' cap height: Arial Narrow (cap 0.7158) at 0.793, 32 px drawing as 25.4", () => {
    expect(capScale(0.7158)).toBeCloseTo(0.7934, 4);
    expect(32 * capScale(0.7158)).toBeCloseTo(25.39, 2);
    expect(capScale(BOURGEOIS_CAP_HEIGHT)).toBe(1);
    expect(capScale(null)).toBe(1);
  });

  it("scales a stand-in for the numbers to Dashboard Numbers Wide's digits and spaces them to its advance", () => {
    // (a font with digits 0.70 em tall and 0.55 em wide: 0.826 x, then 0.796 - 0.454 em of the game size between)
    const scale = capScale(0.7, NUMBERS_DIGIT_HEIGHT);
    expect(scale).toBeCloseTo(0.5781 / 0.7, 6);
    expect(numbersTrack(0.55, scale) * scale + 0.55 * scale).toBeCloseTo(NUMBERS_ADVANCE, 6);
    expect(numbersTrack(null, scale)).toBe(0);
  });
});
