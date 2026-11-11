// The display's refresh as the page's frames show it (game/refreshRate.ts: RV-514, RV-519)
import { describe, expect, it } from "vitest";
import { RefreshMeter, nearestRate, refreshOf } from "./refreshRate";

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

describe("a screen's refresh from animation frames' intervals (refreshOf)", () => {
  const of = (...parts: [number, number][]): number[] => parts.flatMap(([ms, n]) => Array.from({ length: n }, () => ms));
  const hz = (intervals: number[]): number => 1000 / refreshOf(intervals);

  it("even frames; dropped ones (two refreshes), most of them too (RV-1268); a timer's jitter averaged", () => {
    expect(hz(of([1000 / 60, 120]))).toBeCloseTo(60, 6);
    expect(hz(of([1000 / 144, 90], [2000 / 144, 30]))).toBeCloseTo(144, 6);
    expect(hz(of([1000 / 60, 40], [2000 / 60, 80]))).toBeCloseTo(60, 6);
    const jittered = Array.from({ length: 120 }, (_, i) => 1000 / 144 + (i % 2 ? 1.5 : -1.5));
    expect(hz(jittered)).toBeCloseTo(144, 3);
  });

  it("a page too busy for every refresh's frame: frames two refreshes apart and some three, never one, still the screen's (a 120 Hz phone, a 144 Hz desktop)", () => {
    expect(hz(of([2000 / 120, 108], [3000 / 120, 12]))).toBeCloseTo(120, 6);
    expect(hz(of([2000 / 120, 70], [3000 / 120, 50]))).toBeCloseTo(120, 6);
    expect(hz(of([2000 / 144, 100], [3000 / 144, 20]))).toBeCloseTo(144, 6);
    // (three and four refreshes apart: a third of the usual)
    expect(hz(of([3000 / 144, 100], [4000 / 144, 20]))).toBeCloseTo(144, 6);
    // (a frame or two off in 120, a hitch's, changes nothing: all two refreshes apart is a 60 Hz grid, every frame on it)
    expect(hz(of([2000 / 120, 118], [3000 / 120, 2]))).toBeCloseTo(60, 0);
  });

  it("two screens' frames mixed (a window on its way from one to the other) never a rate far above both", () => {
    for (const [a, b] of [
      [60, 144],
      [75, 60],
      [144, 165],
      [144, 120],
      [60, 120],
    ] as const) {
      for (const share of [0.25, 0.5, 0.75]) {
        const read = hz(of([1000 / a, Math.round(120 * share)], [1000 / b, 120 - Math.round(120 * share)]));
        expect(read, `${String(a)} and ${String(b)}`).toBeLessThanOrEqual(Math.max(a, b) * 1.05);
      }
    }
  });
});
