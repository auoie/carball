// The match's moments a bot reads (src/local/bots.ts matchMoments, from the protocol's phase and the ball): the kickoff's
// pause while play is on and the ball still on its spot, the match's end (RV-538 CM21, CM22; BM23, BM23b)
import { describe, expect, it } from "vitest";
import { matchMoments } from "./bots";

const still = { pos: { x: 0, y: 0, z: 93 }, vel: { x: 0, y: 0, z: 0 } };
const hit = { pos: { x: 0, y: 12, z: 93 }, vel: { x: 0, y: 900, z: 0 } };

describe("the match's moments for the bots", () => {
  it("the kickoff's pause: in play with the ball untouched alone, not the countdown's", () => {
    expect(matchMoments(1, still).kickoffPause).toBe(true);
    expect(matchMoments(0, still).kickoffPause).toBe(false);
    expect(matchMoments(1, hit).kickoffPause).toBe(false);
    expect(matchMoments(1, { ...still, vel: { x: 0, y: 0, z: -5 } }).kickoffPause).toBe(false);
    expect(matchMoments(null, still).kickoffPause).toBe(false);
  });

  it("the match's end: its pre-podium, podium and after (phases 4, 7, 8), nothing before", () => {
    expect([4, 7, 8].map((phase) => matchMoments(phase, hit).matchEnded)).toEqual([true, true, true]);
    expect([0, 1, 2, 3, 5, 6].some((phase) => matchMoments(phase, hit).matchEnded)).toBe(false);
    expect(matchMoments(null, hit).matchEnded).toBe(false);
  });
});
