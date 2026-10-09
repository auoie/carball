import { describe, expect, it } from "vitest";
import { FixedStep, TICK_SECONDS, worldSeconds } from "./fixedStep";

describe("FixedStep", () => {
  it("runs 120 ticks per second regardless of frame rate", () => {
    for (const fps of [30, 60, 144, 240]) {
      const clock = new FixedStep();
      let ticks = 0;
      for (let i = 0; i < fps * 10; i++) ticks += clock.advance(1 / fps);
      expect(Math.abs(ticks - 1200)).toBeLessThanOrEqual(1);
    }
  });

  it("reports how far rendering is between ticks", () => {
    const clock = new FixedStep();
    expect(clock.advance(TICK_SECONDS * 1.25)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0.25);
  });

  it("runs at most 5 ticks a frame, dropping the rest but keeping the fraction (LT-2)", () => {
    const clock = new FixedStep();
    for (let i = 0; i < 4; i++) expect(clock.advance(0.05)).toBe(5); // (20 fps: 6 ticks' time, 5 run)
    const stalled = new FixedStep();
    expect(stalled.advance(5 + TICK_SECONDS * 0.6)).toBe(5);
    expect(stalled.alpha).toBeCloseTo(0.6, 3);
    expect(stalled.advance(TICK_SECONDS * 0.5)).toBe(1);
  });

  it("at 20 fps the simulation runs at 83 % of real time, as the game's", () => {
    const clock = new FixedStep();
    let ticks = 0;
    for (let i = 0; i < 200; i++) ticks += clock.advance(worldSeconds(0.05));
    expect(ticks / (200 * 0.05 * 120)).toBeCloseTo(5 / 6, 6);
  });

  it("ignores negative frame times", () => {
    const clock = new FixedStep();
    expect(clock.advance(-1)).toBe(0);
  });

  it("takes the frame's world time: dilated, clamped to 0.0005 .. 0.4 s (LT-3)", () => {
    expect(worldSeconds(1 / 60)).toBe(1 / 60);
    expect(worldSeconds(1 / 60, 0.25)).toBe(1 / 240);
    expect(worldSeconds(2)).toBe(0.4);
    expect(worldSeconds(0)).toBe(0.0005);
  });
});
