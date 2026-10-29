// The match's moments a bot reads (src/local/bots.ts matchMoments, from the protocol's phase): a goal's aftermath (its
// post-goal and replay), the match's end (RV-538 CM22; BM23b)
import { describe, expect, it } from "vitest";
import { matchMoments } from "./bots";

describe("the match's moments for the bots", () => {
  it("a goal's aftermath: post-goal and its replay (phases 2, 5), nothing else", () => {
    expect([2, 5].map((phase) => matchMoments(phase).goalScored)).toEqual([true, true]);
    expect([0, 1, 3, 4, 6, 7, 8].some((phase) => matchMoments(phase).goalScored)).toBe(false);
    expect(matchMoments(null).goalScored).toBe(false);
  });

  it("the match's end: its pre-podium, podium and after (phases 4, 7, 8), nothing before", () => {
    expect([4, 7, 8].map((phase) => matchMoments(phase).matchEnded)).toEqual([true, true, true]);
    expect([0, 1, 2, 3, 5, 6].some((phase) => matchMoments(phase).matchEnded)).toBe(false);
    expect(matchMoments(null).matchEnded).toBe(false);
  });
});
