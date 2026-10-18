// A training pack's run (notes/custom-training.md §2): the countdown until input, the timer, the striker's and goalie's
// rules, progress that only rises, the playlist's navigation, shuffle and mirror, the pack's end
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import type { Shot, TrainingPack } from "./pack";
import { ShotStatus, TrainingRun, launchVelocity, movingTowardGoal, shuffled } from "./run";

const shot = (timeLimit: number, x = 0): Shot => ({
  timeLimit,
  ball: { location: vec3(x, 2000, 300), launch: { pitch: 0, yaw: 16384, roll: 0 }, speed: 1500 },
  car: { location: vec3(0, 0, 17), rotation: { pitch: 0, yaw: 16384, roll: 0 }, startSpeed: 0 },
});
const pack = (n: number, type: TrainingPack["type"] = "striker", timeLimit = 10): TrainingPack => ({
  id: "p",
  name: "P",
  type,
  difficulty: "easy",
  tags: [],
  description: "",
  creator: "",
  shots: Array.from({ length: n }, (_, i) => shot(timeLimit, i)),
});

describe("a shot's countdown and timer (CTR-5, CTR-7)", () => {
  it("held until input after the input delay; the timer runs from the start on game time, out at 0", () => {
    const run = new TrainingRun(pack(2));
    expect([run.state, run.timeLeft]).toEqual(["countdown", 10]);
    run.tick(5);
    expect(run.timeLeft).toBe(10);
    expect(run.canStart(0.1)).toBe(true);
    run.retry();
    expect(run.canStart(0.1)).toBe(false);
    run.tick(0.1);
    expect(run.canStart(0.1)).toBe(true);
    run.begin();
    expect([run.state, run.status[0]]).toEqual(["active", ShotStatus.Attempted]);
    run.tick(9.5);
    expect([run.timeLeft, run.timedOut]).toEqual([0.5, false]);
    run.tick(0.5);
    expect([run.timeLeft, run.timedOut]).toEqual([0, true]);
  });

  it("a time limit of 0 never runs out", () => {
    const run = new TrainingRun(pack(1, "striker", 0));
    run.begin();
    run.tick(1000);
    expect([run.timeLeft, run.timedOut]).toEqual([null, false]);
  });

  it("the ball launched along vector(launch) at its speed, no spin", () => {
    const v = launchVelocity(shot(10));
    expect([Math.round(v.x), Math.round(v.y), Math.round(v.z)]).toEqual([0, 1500, 0]);
  });
});

describe("the rules (CTR-8, CTR-9)", () => {
  it("striker: the orange goal counts once the car has touched the ball; untouched entries ignored", () => {
    const run = new TrainingRun(pack(1));
    run.begin();
    expect(run.scoringGoal()).toBeNull();
    run.touch();
    expect(run.scoringGoal()).toBe(1);
  });

  it("goalie: any ball into the own (blue) goal; a save when touched over a second ago and not heading for it", () => {
    const run = new TrainingRun(pack(1, "goalie"));
    run.begin();
    expect(run.scoringGoal()).toBe(-1);
    const away = { pos: vec3(0, -4000, 100), vel: vec3(0, 1500, 0) };
    expect(run.saved(away)).toBe(false);
    run.touch();
    run.tick(0.9);
    expect(run.saved(away)).toBe(false);
    run.tick(0.2);
    expect(run.saved(away)).toBe(true);
    expect(run.saved({ pos: vec3(0, -4000, 100), vel: vec3(0, -1500, 0) })).toBe(false);
  });

  it("heading for a goal: toward its back past both posts' lines, faster than 200 uu/s (IsBallMovingTowardsGoal)", () => {
    expect(movingTowardGoal(vec3(0, -3000, 100), vec3(0, -1500, 0), -1)).toBe(true);
    expect(movingTowardGoal(vec3(0, -3000, 100), vec3(0, 1500, 0), -1)).toBe(false);
    expect(movingTowardGoal(vec3(0, -3000, 100), vec3(0, -150, 0), -1)).toBe(false);
    expect(movingTowardGoal(vec3(0, -3000, 100), vec3(1500, -200, 0), -1)).toBe(false);
    expect(movingTowardGoal(vec3(2000, -4000, 100), vec3(-1500, -800, 0), -1)).toBe(true);
    expect(movingTowardGoal(vec3(0, 3000, 100), vec3(0, 1500, 0), 1)).toBe(true);
  });
});

describe("progress and the pack's end (CTR-10, CTR-12)", () => {
  it("a success completes the shot, a failure doesn't; progress only rises; each end goes on to the next shot, wrapping", () => {
    const run = new TrainingRun(pack(2));
    run.begin();
    run.end("failure");
    expect([run.state, run.result, run.status[0]]).toEqual(["ended", "failure", ShotStatus.Attempted]);
    run.advance();
    expect([run.shotIndex, run.state]).toEqual([1, "countdown"]);
    run.begin();
    run.touch();
    run.end("success");
    expect(run.status[1]).toBe(ShotStatus.Completed);
    run.advance();
    expect(run.shotIndex).toBe(0);
    expect(run.completion).toBe(50);
  });

  it("the last shot completed for the first time: the pack finishes at the next start; kept progress short of Completed starts over", () => {
    const run = new TrainingRun(pack(2), [ShotStatus.Completed, ShotStatus.Attempted]);
    expect(run.status).toEqual([ShotStatus.Completed, ShotStatus.NotAttempted]);
    run.navigate(1);
    run.begin();
    run.end("success");
    run.advance();
    expect(run.state).toBe("finished");
    run.restart();
    expect([run.state, run.shotIndex, run.completion]).toEqual(["countdown", 0, 100]);
    run.restart(true);
    expect(run.completion).toBe(0);
  });
});

describe("navigation, shuffle and mirror (CTR-13)", () => {
  it("next and previous wrap, from any state, the mirror off on a new shot", () => {
    const run = new TrainingRun(pack(3));
    run.navigate(-1);
    expect(run.shotIndex).toBe(2);
    run.toggleMirror();
    expect([run.mirror, run.shot.ball.location.x]).toEqual([true, -2]);
    run.begin();
    run.navigate(1);
    expect([run.shotIndex, run.state, run.mirror]).toEqual([0, "countdown", false]);
    run.select(1);
    expect(run.shotIndex).toBe(1);
  });

  it("shuffle: the pack's order shuffled Fisher-Yates from its end, the current shot kept; off: the pack's order", () => {
    const draws = [0.9, 0.1, 0.5, 0];
    let k = 0;
    // (i = 4: j = 3; i = 3: j = 0; i = 2: j = 1; i = 1: j = 0)
    expect(shuffled([0, 1, 2, 3], () => draws[k++] ?? 0)).toEqual([2, 1, 0, 3]);
    const run = new TrainingRun(pack(10));
    run.navigate(1);
    run.navigate(1);
    run.toggleShuffle(() => 0.37);
    expect(run.shuffle).toBe(true);
    expect(run.shotIndex).toBe(2);
    const seen = new Set<number>();
    for (let i = 0; i < 10; i++) {
      seen.add(run.shotIndex);
      run.navigate(1);
    }
    expect(seen.size).toBe(10);
    run.toggleShuffle();
    expect(run.shuffle).toBe(false);
  });
});

describe("the editor's tests (notes/training-editor.md §1.2, §1.4, TE-2)", () => {
  it("Test Shot: the same shot again after every end, no shot completed, never finished", () => {
    const run = new TrainingRun(pack(3), [ShotStatus.Completed, ShotStatus.Completed], "shot");
    expect(run.test).toBe("shot");
    expect(run.status).toEqual([0, 0, 0]);
    run.select(1);
    for (let i = 0; i < 3; i++) {
      run.begin();
      run.end("success");
      expect(run.state).toBe("ended");
      run.advance();
      expect([run.state, run.shotIndex]).toEqual(["countdown", 1]);
    }
    expect(run.status).toEqual([0, 0, 0]);
    expect(run.completion).toBe(0);
  });

  it("Test Sequence: the pack from its first shot, looping forever, every shot a success or not", () => {
    const run = new TrainingRun(pack(2), [], "sequence");
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(run.shotIndex);
      run.begin();
      run.end("success");
      run.advance();
    }
    expect(seen).toEqual([0, 1, 0, 1, 0]);
    expect(run.state).toBe("countdown");
    expect(run.status).toEqual([0, 0]);
  });
});
