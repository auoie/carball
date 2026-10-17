// The display's refresh as the page's frames show it (game/refreshRate.ts: RV-514, RV-519)
import { describe, expect, it } from "vitest";
import { RefreshMeter, nearestRate } from "./refreshRate";

const feed = (meter: RefreshMeter, ms: number, n: number): void => {
  for (let i = 0; i < n; i++) meter.add(ms);
};

describe("the refresh meter", () => {
  it("the fastest frames' rate as a common one, the highest kept: steady 33 ms frames after a 16.7 ms spell still 60 (RV-514)", () => {
    const meter = new RefreshMeter();
    expect(meter.hz).toBeNull();
    feed(meter, 1000 / 60, 120);
    expect(meter.hz).toBe(60);
    feed(meter, 1000 / 30, 600);
    expect(meter.hz).toBe(60);
  });

  it("a 144 Hz display; a 30 Hz one (or a browser's 30 cap) 30; a stray short interval not a higher rate; a stall not counted", () => {
    const fast = new RefreshMeter();
    for (let i = 0; i < 240; i++) fast.add(1000 / 144 + (i % 3) * 0.2);
    expect(fast.hz).toBe(144);
    const slow = new RefreshMeter();
    for (let i = 0; i < 240; i++) slow.add(i % 50 === 0 ? 4 : i % 10 === 0 ? 66.7 : 33.3);
    expect(slow.hz).toBe(30);
    const stalled = new RefreshMeter();
    feed(stalled, 300, 60);
    expect(stalled.hz).toBeNull();
    expect([nearestRate(59.4), nearestRate(143), nearestRate(47)]).toEqual([60, 144, 50]);
  });
});
