// The boost meter as a fuel gauge (ours): the needle's sweep from E to F, its damped spring, the dial's ticks and arcs
import { describe, expect, it } from "vitest";
import { GAUGE, NeedleSpring, arcPath, gaugePoint, gaugeTicks, needleAngle } from "./fuelGauge";

describe("the fuel gauge", () => {
  it("its needle from E (0, pointing left) over the top to F (100, pointing right), clamped", () => {
    expect([needleAngle(0), needleAngle(50), needleAngle(100), needleAngle(-5), needleAngle(130)]).toEqual([-90, 0, 90, -90, 90]);
    const [ex, ey] = gaugePoint(10, needleAngle(0));
    const [fx, fy] = gaugePoint(10, needleAngle(100));
    expect([ex - GAUGE.pivot[0], ey - GAUGE.pivot[1]].map((v) => Math.round(v))).toEqual([-10, 0]);
    expect([fx - GAUGE.pivot[0], fy - GAUGE.pivot[1]].map((v) => Math.round(v))).toEqual([10, 0]);
  });

  it("eleven ticks, every tenth, E, the half and F long", () => {
    const ticks = gaugeTicks();
    expect(ticks).toHaveLength(11);
    expect(ticks.filter((t) => t.major).map((t) => t.a)).toEqual([-90, 0, 90]);
    expect(arcPath(GAUGE.arc, -90, 90)).toMatch(/^M .* A 80 80 0 0 1 /);
  });

  it("its fuel pump inside the dial, above the hub and the number, clear of the needle at 15 and under", () => {
    const [x, y] = GAUGE.pump;
    expect(Math.hypot(x - GAUGE.pivot[0], y - GAUGE.pivot[1]) + 12).toBeLessThan(GAUGE.ticks.outer - GAUGE.ticks.major);
    expect(y + 11).toBeLessThan(GAUGE.pivot[1] - 6.5);
    // (the needle at 15: its line's distance from the pump's centre, more than the pump's half width and the line's)
    const a = (needleAngle(15) * Math.PI) / 180;
    const distance = Math.abs((x - GAUGE.pivot[0]) * Math.cos(a) + (y - GAUGE.pivot[1]) * Math.sin(a));
    expect(distance).toBeGreaterThan(12);
  });

  it("its spring: damped, settling on the target within half a second, hardly past it", () => {
    const spring = new NeedleSpring(0);
    let most = 0;
    for (let k = 0; k < 30; k++) most = Math.max(most, spring.step(100, 1 / 60));
    expect(spring.value).toBeGreaterThan(99);
    expect(most).toBeLessThan(100.5);
    // (a frame's hitch doesn't fling it)
    expect(new NeedleSpring(0).step(100, 5)).toBeLessThanOrEqual(100);
  });
});
