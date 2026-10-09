import { describe, expect, it } from "vitest";
import { TEAM_PRIMARY_LINEAR, fullBright } from "./teamColors";

describe("team colours", () => {
  it("the primaries, and their FullBright exactly as the game's (AV-2, quantised to 8 bits: RV-70b)", () => {
    expect(TEAM_PRIMARY_LINEAR).toEqual([
      [0.098, 0.451, 1],
      [0.7647, 0.3922, 0.098],
    ]);
    const [p0 = [0, 0, 0], p1 = [0, 0, 0]] = TEAM_PRIMARY_LINEAR;
    expect(fullBright(p0)).toEqual([20 / 255, 92 / 255, 203 / 255]);
    expect(fullBright(p1)).toEqual([176 / 255, 90 / 255, 23 / 255]);
  });

  it("keeps the hue: a colour at full value, scaled by (1 - luminance) / 2 + 0.5", () => {
    expect(fullBright([0.5, 0.5, 0.5])).toEqual([128 / 255, 128 / 255, 128 / 255]); // (white at full value: luminance 1)
    const [r, g, b] = fullBright([0, 0, 0.25]);
    expect([r, g]).toEqual([0, 0]);
    expect(b).toBeCloseTo((1 - 0.11) / 2 + 0.5, 2);
  });
});
