import { describe, expect, it } from "vitest";
import { TouchLog, type Touch, planReplay } from "./replayPlan";
import { replaySeconds } from "./goalSequence";

const touch = (car: number, team: number, tick: number): Touch => ({ car, team, tick });

describe("the goal replay's plan (the server's: server/src/game.rs)", () => {
  it("no touch: from 10 s before the goal, not before the ball's spawn, to 3 s after it, no slow motion or focus", () => {
    const plan = planReplay([], 5000, 0, 1000, false);
    expect(plan).toEqual({ startTick: 3800, goalTick: 5000, endTick: 5360, scoringTeam: 0, slomo: [], focus: [] });
    expect(planReplay([], 1500, 0, 1000, false).startTick).toBe(1000);
  });

  it("starts two seconds before the scoring touch, slows round it, follows the touches from the start", () => {
    const [blue, orange] = [7, 9];
    // Blue, orange, blue twice (one run), orange (after the scoring touch): blue scores
    const touches = [touch(blue, 0, 3000), touch(orange, 1, 4000), touch(blue, 0, 4700), touch(orange, 1, 4900)];
    const plan = planReplay(touches, 5000, 0, 1000, false);
    // min(4700, goal - 4 s = 4520) - 2 s = 4280
    expect(plan.startTick).toBe(4280);
    expect(plan.endTick).toBe(5360);
    expect(plan.slomo).toEqual([[4670, 4712]]);
    expect(plan.focus).toEqual([{ car: blue, tick: 4700 }]); // (orange's touch at 4000 is before the start)
  });

  it("a touch long before: capped at 10 s; the defender's stretch before the goal", () => {
    const plan = planReplay([touch(7, 0, 2000)], 5000, 0, 1000, true);
    expect(plan.startTick).toBe(3800);
    expect(plan.slomo).toEqual([[4970, 5000]]); // (the hit's stretch is before the start)
    expect(plan.focus).toEqual([]);
  });

  it("an own goal: the newest touch is the scoring one", () => {
    const plan = planReplay([touch(7, 0, 4800)], 5000, 1, 0, false);
    expect(plan.slomo).toEqual([[4770, 4812]]);
    expect(plan.focus).toEqual([{ car: 7, tick: 4800 }]);
  });

  it("its real length: 9 s shown with 0.35 s of it slowed lasts 10.05 s", () => {
    expect(replaySeconds({ startTick: 0, goalTick: 0, endTick: 1080, scoringTeam: 0, slomo: [[100, 142]], focus: [] })).toBeCloseTo(10.05, 9);
  });
});

describe("the ball's touches", () => {
  it("runs per car: a car's new touch extends its run, another car's starts one; the same tick counts once", () => {
    const log = new TouchLog();
    log.update(1, 0, null);
    log.update(1, 0, 100);
    log.update(1, 0, 100);
    log.update(1, 0, 130);
    log.update(2, 1, 150);
    log.update(1, 0, 170);
    expect(log.touches).toEqual([touch(1, 0, 130), touch(2, 1, 150), touch(1, 0, 170)]);
    log.clear();
    expect(log.touches).toEqual([]);
    log.update(1, 0, 170); // (the car's last touch, from before the reset: not a new one)
    expect(log.touches).toEqual([]);
  });

  it("keeps the newest 50", () => {
    const log = new TouchLog();
    for (let i = 0; i < 60; i++) log.update(i % 2, i % 2, i + 1);
    expect(log.touches).toHaveLength(50);
    expect(log.touches[0]?.tick).toBe(11);
  });
});
