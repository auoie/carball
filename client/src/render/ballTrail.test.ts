// The ball's speed trail (VT-10, VT-10a: BR1): its points' rate, life, opacity and colour as dropped, its curves, gone
// at once when cleared
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { BallTrail, TRAIL, TrailPoints, alphaOverLife, colourOverLife, whiteOverLife } from "./ballTrail";

const frames = (trail: TrailPoints, seconds: number, speed: number, dilation = 1, at = new Vector3()): void => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) trail.step(1 / 60, at, speed, dilation);
};

describe("the trail's points", () => {
  it("15 a game second, each living a second: about 15 kept in steady play", () => {
    const trail = new TrailPoints();
    frames(trail, 3, 2500);
    expect(trail.points.length).toBeGreaterThanOrEqual(14);
    expect(trail.points.length).toBeLessThanOrEqual(16);
    expect(trail.time - (trail.points[0]?.born ?? 0)).toBeLessThanOrEqual(TRAIL.life + 1e-9);
  });

  it("in slow motion more a game second: 1 / dilation, 3 at most (VT-10a)", () => {
    const slow = new TrailPoints();
    frames(slow, 1, 2500, 0.5);
    expect(slow.points.length).toBeGreaterThanOrEqual(29);
    expect(slow.points.length).toBeLessThanOrEqual(31);
    const slower = new TrailPoints();
    frames(slower, 1, 2500, 0.1875);
    expect(slower.points.length).toBeGreaterThanOrEqual(44);
    expect(slower.points.length).toBeLessThanOrEqual(46);
  });

  it("the opacity easing to 1 above 2000 uu/s at 3 a second, to 0 below; nothing shown before it's fast", () => {
    const trail = new TrailPoints();
    frames(trail, 1, 1500);
    expect(trail.opacity).toBe(0);
    expect(trail.points.every((p) => p.alpha === 0)).toBe(true);
    frames(trail, 1, 2500);
    // (1 - e^-3 after a second, about)
    expect(trail.opacity).toBeGreaterThan(0.93);
    expect(trail.opacity).toBeLessThan(0.97);
    frames(trail, 2, 1000);
    expect(trail.opacity).toBeLessThan(0.01);
  });

  it("a touch's colour and a slow-down only on the points dropped after (the old run down the trail)", () => {
    const trail = new TrailPoints();
    frames(trail, 1, 3000);
    const before = trail.points.length;
    trail.colour = [0.2, 0.5, 1];
    frames(trail, 0.4, 3000);
    expect(trail.points.slice(0, before - 6).every((p) => p.colour[0] === 1)).toBe(true);
    expect(trail.points.at(-1)?.colour).toEqual([0.2, 0.5, 1]);
  });

  it("cleared at once (the goal's explosion), its opacity 0 again (a reset)", () => {
    const trail = new TrailPoints();
    frames(trail, 1, 3000);
    trail.clear();
    expect(trail.points).toHaveLength(0);
    expect(trail.opacity).toBe(0);
  });
});

describe("the trail's curves (VT-10a)", () => {
  it("alpha: 0 at its birth, 1 by 0.05, down to 0 at its end; white-hot to 0.0625, half at 0.133, none from 0.2035; dimmed to (0.54, 0.52, 0.51) from 0.6", () => {
    expect([alphaOverLife(0), alphaOverLife(0.05), alphaOverLife(0.52), alphaOverLife(1)]).toEqual([0, 1, 0.51, 0]);
    expect([whiteOverLife(0), whiteOverLife(0.0625), whiteOverLife(0.2035), whiteOverLife(0.5)]).toEqual([1, 1, 0, 0]);
    expect(whiteOverLife(0.133)).toBeCloseTo(0.5, 6);
    expect(colourOverLife(0)).toEqual([1, 1, 1]);
    expect(colourOverLife(0.8)).toEqual([0.54, 0.52, 0.51]);
  });
});

describe("the trail drawn", () => {
  it("a strip through the ball's centre and its points, none before two stations; none once cleared", () => {
    const trail = new BallTrail();
    const ball = new Vector3();
    expect(trail.mesh.geometry.drawRange.count).toBe(0);
    for (let k = 0; k < 60; k++) {
      ball.set(0, 93, k * 50);
      trail.update(1 / 60, ball, 3000);
    }
    expect(trail.mesh.geometry.drawRange.count).toBeGreaterThan(0);
    trail.clear();
    expect(trail.mesh.geometry.drawRange.count).toBe(0);
  });
});
