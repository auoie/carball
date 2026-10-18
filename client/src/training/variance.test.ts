// Custom training's variance (notes/custom-training.md §4.2, CTR-14): each axis drawn within its modifier, the moves
// capped inside the arena, the speed scaled; a shot's roll kept through retries and the mirror, drawn again by a
// countdown's reset or a new shot
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import type { Shot, TrainingPack } from "./pack";
import { TrainingRun } from "./run";
import { TRAINING_DEFAULTS } from "./settings";
import { NO_VARIANCE, type Variance, applyVariance, rollVariance } from "./variance";

const SHOT: Shot = {
  timeLimit: 10,
  ball: { location: vec3(0, 3000, 500), launch: { pitch: 0, yaw: 16384, roll: 0 }, speed: 2000 },
  car: { location: vec3(0, 0, 17), rotation: { pitch: 0, yaw: 16384, roll: 0 }, startSpeed: 0 },
};
const MODIFIERS = {
  ...TRAINING_DEFAULTS,
  ballLocationModifier: 500,
  ballHeightModifier: 200,
  ballSpeedModifier: 25,
  carLocationModifier: 300,
  carRotationModifier: 30,
};

describe("the variance", () => {
  it("each axis within its modifier: the ball's place and height, its speed's share, the car's place and yaw", () => {
    const low = rollVariance(MODIFIERS, () => 0);
    const high = rollVariance(MODIFIERS, () => 0.999999);
    expect([low.ball.x, low.ball.y, low.ball.z, low.speed, low.car.x, low.car.y]).toEqual([-500, -500, -200, 0.75, -300, -300]);
    expect(low.yaw).toBeCloseTo((-30 * 65536) / 360, 6);
    expect(high.ball.x).toBeCloseTo(500, 2);
    expect(high.speed).toBeCloseTo(1.25, 5);
    // (no modifiers: nothing moves, whatever is drawn)
    expect(rollVariance(TRAINING_DEFAULTS, () => 0.3)).toEqual({ ball: vec3(0, 0, 0), speed: 1, car: vec3(0, 0, 0), yaw: 0 });
  });

  it("applied in the world's axes, capped inside the arena (no further out than the start), the speed scaled, the yaw wrapped", () => {
    const v: Variance = { ball: vec3(5000, 3000, -900), speed: 1.5, car: vec3(-200, 100, 0), yaw: 60000 };
    const s = applyVariance(SHOT, v);
    expect([s.ball.location.x, s.ball.location.y, s.ball.location.z]).toEqual([4096 - 92.75, 5120 - 92.75, 92.75]);
    expect(s.ball.speed).toBe(3000);
    expect([s.car.location.x, s.car.location.y, s.car.location.z]).toEqual([-200, 100, 17]);
    expect(s.car.rotation.yaw).toBe((16384 + 60000) % 65536);
    // (a ball starting inside the goal stays as far out as it was)
    const inGoal = { ...SHOT, ball: { ...SHOT.ball, location: vec3(0, 5400, 300) } };
    expect(applyVariance(inGoal, { ...v, ball: vec3(0, 400, 0) }).ball.location.y).toBe(5400);
    expect(applyVariance(SHOT, NO_VARIANCE)).toBe(SHOT);
  });

  it("a shot's roll kept through a retry during or after it and the mirror; drawn again by a countdown's reset or a new shot", () => {
    const pack: TrainingPack = { id: "v", name: "V", type: "striker", difficulty: "easy", tags: [], description: "", creator: "", shots: [SHOT, SHOT] };
    const run = new TrainingRun(pack);
    let rolls = 0;
    const roll = (): Variance => {
      rolls += 1;
      return { ...NO_VARIANCE, speed: rolls };
    };
    expect(run.variance(roll).speed).toBe(1);
    run.begin();
    run.retry();
    expect(run.variance(roll).speed).toBe(1);
    run.toggleMirror();
    expect(run.variance(roll).speed).toBe(1);
    run.retry();
    expect(run.variance(roll).speed).toBe(2);
    run.navigate(1);
    expect(run.variance(roll).speed).toBe(3);
  });
});
