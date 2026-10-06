import { describe, expect, it } from "vitest";
import { FixedStep, TICK_SECONDS } from "./fixedStep";

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

  it("drops the backlog after a stall instead of catching up", () => {
    const clock = new FixedStep(TICK_SECONDS, 12);
    expect(clock.advance(5)).toBe(12);
    expect(clock.advance(TICK_SECONDS)).toBe(1);
  });

  it("ignores negative frame times", () => {
    const clock = new FixedStep();
    expect(clock.advance(-1)).toBe(0);
  });
});
