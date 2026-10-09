import { describe, expect, it } from "vitest";
import { TEAM_PRIMARY_LINEAR, fullBright } from "./teamColors";

describe("team colours", () => {
  it("FullBright of each team's primary is the game's (AV-2, to its 8-bit quantisation)", () => {
    const [p0 = [0, 0, 0], p1 = [0, 0, 0]] = TEAM_PRIMARY_LINEAR;
    const expected = [
      [fullBright(p0), [0.0784, 0.3608, 0.7961]],
      [fullBright(p1), [0.6902, 0.3529, 0.0902]],
    ] as const;
    for (const [got, want] of expected) {
      for (let i = 0; i < 3; i++) expect(Math.abs((got[i] ?? 0) - (want[i] ?? 0))).toBeLessThan(0.5 / 255 + 1e-4);
    }
  });

  it("keeps the hue: a colour at full value, scaled by (1 - luminance) / 2 + 0.5", () => {
    expect(fullBright([0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]); // (white at full value: luminance 1)
    const [r, g, b] = fullBright([0, 0, 0.25]);
    expect([r, g]).toEqual([0, 0]);
    expect(b).toBeCloseTo((1 - 0.11) / 2 + 0.5);
  });
});
