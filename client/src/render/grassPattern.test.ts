// The grass's pattern as AV-6a's rules (src/render/grassPattern.ts): its plaid's period, its generated traces' statistics
// and, pinned, the ones its fixed seed makes (RV-462)
import { describe, expect, it } from "vitest";
import { GRASS_PATTERN, grassPatternGlsl, grassTraces } from "./grassPattern";

describe("the grass's pattern (AV-6a)", () => {
  it("a plaid of 12 bands across the texture's 6172.84 uu, in the shader", () => {
    expect(GRASS_PATTERN.plaid.period * 12).toBeCloseTo(6172.84, 0);
    expect(grassPatternGlsl()).toMatch(/fract\(q\.x \/ 514\.40*\)/);
  });

  it("traces as AV-6a counts them: about 36 k uu a quadrant, about half of it vertical", () => {
    let total = 0;
    let vertical = 0;
    for (const [x0, y0, x1, y1] of grassTraces()) {
      const length = Math.hypot(x1 - x0, y1 - y0);
      total += length;
      if (Math.abs(x1 - x0) < 1e-6) vertical += length;
    }
    expect(total).toBeGreaterThan(33_000);
    expect(total).toBeLessThan(40_000);
    expect(vertical / total).toBeGreaterThan(0.4);
    expect(vertical / total).toBeLessThan(0.6);
  });

  it("the same every build, from seed 1 and a spawn gap of 8 g: 136 segments, 36262.2 uu (pinned)", () => {
    expect([GRASS_PATTERN.traces.seed, GRASS_PATTERN.traces.spawnGap]).toEqual([1, 8]);
    const traces = grassTraces();
    expect(traces.length).toBe(136);
    expect(traces.reduce((sum, [x0, y0, x1, y1]) => sum + Math.hypot(x1 - x0, y1 - y0), 0)).toBeCloseTo(36262.2, 0);
  });
});
