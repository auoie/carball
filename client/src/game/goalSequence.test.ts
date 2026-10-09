// The goal sequence's timing against the static session's figures (notes/camera-respawn-goal.md §3; its
// out/bsim/agents/K2/work/gs_slomo.py).
import { describe, expect, it } from "vitest";
import type { ReplayPlan } from "../net/protocol";
import { FixedStep } from "../loop/fixedStep";
import {
  POST_GOAL_TICKS,
  PostGoalClock,
  postGoalDilation,
  postGoalTickSeconds,
  replayDilation,
  replaySeconds,
  scoreSlomo,
} from "./goalSequence";

describe("the slow motion after a goal", () => {
  it("follows ScoreSlomoCurve: 1 until 0.125 s, down to 0.1875 at 0.225 s, back to 1 at 0.625 s, clamped", () => {
    expect(scoreSlomo(0)).toBe(1);
    expect(scoreSlomo(0.125)).toBe(1);
    expect(scoreSlomo(0.225)).toBeCloseTo(0.1875, 12);
    expect(scoreSlomo(0.175)).toBeCloseTo((1 + 0.1875) / 2, 12);
    expect(scoreSlomo(0.425)).toBeCloseTo((0.1875 + 1) / 2, 12);
    expect(scoreSlomo(0.625)).toBe(1);
    expect(scoreSlomo(2)).toBe(1);
  });

  it("slows the 17th to the 75th tick after the goal (gs_slomo.py counts from 0: 16..74), the 28th the most", () => {
    const slowed = Array.from({ length: POST_GOAL_TICKS + 10 }, (_, i) => i + 1).filter((n) => postGoalDilation(n) < 1);
    expect(slowed[0]).toBe(17); // (the 17th tick starts at game 16/120 > 0.125 s)
    expect(slowed.at(-1)).toBe(75);
    expect(postGoalDilation(28)).toBeCloseTo(0.1875, 12);
    expect(postGoalDilation(0)).toBe(1);
    expect(postGoalDilation(POST_GOAL_TICKS + 1)).toBe(1);
  });

  it("takes 3.53 real seconds for the 360 ticks to the replay or the kickoff (gs_slomo.py: 3.5317 per tick)", () => {
    let real = 0;
    for (let n = 1; n <= POST_GOAL_TICKS; n++) real += postGoalTickSeconds(n);
    expect(real).toBeCloseTo(3.5317, 4);
  });
});

describe("the goal replay's length", () => {
  const plan = (slomo: ReplayPlan["slomo"]): ReplayPlan => ({
    startTick: 120 * 94,
    goalTick: 120 * 100,
    endTick: 120 * 103,
    slomo,
    focus: [],
    scoringTeam: 0,
  });

  it("is its length plus three times each slowed stretch (gs_slomo.py: a hit 1 s before the goal, 10.05 s)", () => {
    const hit = 120 * 99;
    const p = plan([[hit - 30, hit + 12]]);
    expect(replaySeconds(p)).toBeCloseTo(10.05, 10);
    expect(replayDilation(p, hit)).toBe(0.25);
    expect(replayDilation(p, hit - 30)).toBe(1);
    expect(replayDilation(p, hit + 40)).toBe(1);
  });

  it("with the defender's stretch too: 10.8 s", () => {
    const hit = 120 * 99;
    expect(replaySeconds(plan([[hit - 30, hit + 12], [120 * 100 - 30, 120 * 100]]))).toBeCloseTo(10.8, 10);
  });
});

describe("freeplay's goal clock on game time (RV-1)", () => {
  /** Frames of the given raw times from a goal: ticks run until PostGoalTime is up, and how many were slowed */
  const run = (frames: (i: number) => number): { ticks: number; slowed: number } => {
    const clock = new PostGoalClock();
    const step = new FixedStep();
    clock.start();
    let ticks = 0;
    let slowed = 0;
    for (let i = 0; i < 10_000; i++) {
      const { world, done } = clock.frame(frames(i));
      if (done) return { ticks, slowed };
      const n = step.advance(world);
      ticks += n;
      if (world < frames(i) - 1e-12) slowed += n;
    }
    throw new Error("PostGoalTime never came");
  };

  it("at 60 fps: 360 ticks, as the server's", () => {
    expect(Math.abs(run(() => 1 / 60).ticks - 360)).toBeLessThanOrEqual(2);
  });

  it("at 10 fps (5 ticks a frame at most) the 3 s pass in about 174 ticks, not 360", () => {
    expect(run(() => 0.1).ticks).toBeGreaterThan(165);
    expect(run(() => 0.1).ticks).toBeLessThan(180);
  });

  it("a 1 s hitch 0.15 s after the goal ends the slow motion at once: under 20 slowed ticks", () => {
    expect(run((i) => (i === 9 ? 1 : 1 / 60)).slowed).toBeLessThan(20);
  });
});


