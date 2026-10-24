// The goal's explosion against the demolition's (src/audio/synth.ts): the user's "a little" quieter goal, most of it from
// the sub-bass boom (measured offline: the goal's loudest 400 ms, K-weighted, 4.4 dB down, 2.8 dB under a demolition's)
import { describe, expect, it } from "vitest";
import { EXPLOSION, GOAL_EXPLOSION } from "./synth";

const db = (ratio: number): number => 20 * Math.log10(ratio);

describe("the goal's explosion", () => {
  it("its boom 8 dB under the demolition's, its roar 3 dB: most of the cut the boom's", () => {
    expect(db(GOAL_EXPLOSION.boom / EXPLOSION.boom)).toBeCloseTo(-7.96, 1);
    expect(db(GOAL_EXPLOSION.roar / EXPLOSION.roar)).toBeCloseTo(-2.92, 1);
  });
});
