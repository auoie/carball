import { describe, expect, it } from "vitest";
import { BALL_ARROW, ballArrowBrightness, ballArrowHaze, ballArrowPose, ballArrowShown } from "./ballArrow";

describe("the ball arrow (HUD-17)", () => {
  it("sits 75 uu toward the ball (100 uu away or nearer), 120 at 10000 or farther, linear between, 20 up", () => {
    const car = { x: 0, y: 0, z: 17 };
    const near = ballArrowPose(car, { x: 50, y: 0, z: 17 });
    expect(near?.pos).toEqual({ x: 75, y: 0, z: 37 });
    expect(near?.dir).toEqual({ x: 1, y: 0, z: 0 });
    const far = ballArrowPose(car, { x: 0, y: -20000, z: 17 });
    expect(far?.pos.y).toBeCloseTo(-120, 6);
    const mid = ballArrowPose(car, { x: 0, y: 5050, z: 17 });
    expect(mid?.pos.y).toBeCloseTo(BALL_ARROW.nearRadius + (BALL_ARROW.farRadius - BALL_ARROW.nearRadius) * 0.5, 6);
    // (in 3D: up toward a ball overhead)
    const up = ballArrowPose(car, { x: 0, y: 0, z: 1017 })?.pos;
    expect(up?.z).toBeCloseTo(17 + 75 + 45 * ((1000 - 100) / 9900) + 20, 9);
    expect([up?.x, up?.y]).toEqual([0, 0]);
    expect(ballArrowPose(car, car)).toBeNull();
  });

  it("shows with the setting on and the ball cam off, the car alive, in the round", () => {
    expect(ballArrowShown(true, false, true, true)).toBe(true);
    expect([ballArrowShown(false, false, true, true), ballArrowShown(true, true, true, true), ballArrowShown(true, false, false, true), ballArrowShown(true, false, true, false)]).toEqual([false, false, false, false]);
  });

  it("flashes twice a second, a 125 ms pulse sweeping tail to tip, and hazes a soft dark disc (ARW1)", () => {
    // (the base, and the peak at the tail at t = 0.25 + 0.5 k)
    expect(ballArrowBrightness(0.1, 0)).toBe(0.25);
    expect(ballArrowBrightness(0.25, 0)).toBeCloseTo(3.25, 6);
    expect(ballArrowBrightness(0.75, 0)).toBeCloseTo(3.25, 6);
    // (the tip 62.5 ms later)
    expect(ballArrowBrightness(0.25 + 0.0625, 1)).toBeCloseTo(3.25, 6);
    // (bright for 125 ms of every 500)
    const lit = Array.from({ length: 5000 }, (_, i) => ballArrowBrightness(i / 10000 + 1, 0.5)).filter((e) => e > 0.25).length;
    expect(lit / 5000).toBeCloseTo(0.25, 2);
    expect([0, 0.3, 0.5, 0.7, 0.9, 1].map((r) => Math.round(ballArrowHaze(r) * 100) / 100)).toEqual([1, 0.83, 0.56, 0.26, 0.04, 0]);
  });
});
