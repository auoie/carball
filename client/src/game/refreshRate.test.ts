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

  it("the rate of late (the camera's feel): the highest of the last 10 s of frames, so it comes down; steady through doubled frames and a timer's jitter", () => {
    const meter = new RefreshMeter();
    expect(meter.recentHz).toBeNull();
    feed(meter, 1000 / 144, 432);
    expect(meter.recentHz).toBe(144);
    // (the window moved to a 60 Hz screen: 144 while a few of the recent frames are still that fast, 2 s, and for the
    // 10 s its measures count after; then 60; the latched one stays)
    feed(meter, 1000 / 60, 600);
    expect(meter.recentHz).toBe(144);
    feed(meter, 1000 / 60, 150);
    expect([meter.recentHz, meter.hz]).toEqual([60, 144]);
    // (most frames doubled, each one's time a millisecond off either way: still the screen's)
    const busy = new RefreshMeter();
    const seen = new Set<number | null>();
    for (let i = 0; i < 1800; i++) {
      busy.add((i % 10 < 8 ? 2000 / 60 : 1000 / 60) + ((i * 7) % 5) * 0.5 - 1);
      if (i > 120) seen.add(busy.recentHz);
    }
    expect([...seen]).toEqual([60]);
  });

  /** A seeded generator (the same frames each run) */
  const seeded = (seed: number): (() => number) => {
    let x = seed;
    return () => {
      x = (x * 1664525 + 1013904223) % 4294967296;
      return x / 4294967296;
    };
  };
  /** The feel's rate after each of the frames, from its first measure on */
  const feels = (frames: readonly number[]): number[] => {
    const meter = new RefreshMeter();
    return frames.flatMap((ms) => {
      meter.add(ms);
      return meter.recentHz ?? [];
    });
  };
  const changes = (v: readonly number[]): number => v.filter((hz, i) => i > 0 && hz !== v[i - 1]).length;

  it("a stall's catch-up burst isn't the screen's rate: neither the stall nor the frames just after it are counted (RV-1302)", () => {
    for (const burst of [8, 16, 24, 40]) {
      const meter = new RefreshMeter();
      const seen = new Set<number | null>();
      feed(meter, 1000 / 60, 300);
      for (const ms of [400, ...Array.from({ length: burst }, () => 3), ...Array.from({ length: 900 }, () => 1000 / 60)]) {
        meter.add(ms);
        seen.add(meter.recentHz);
      }
      expect([[...seen], meter.hz], `a burst of ${String(burst)}`).toEqual([[60], 60]);
    }
    // (a shorter stall too, one the meter counted before: 120 ms)
    const meter = new RefreshMeter();
    feed(meter, 1000 / 144, 432);
    for (const ms of [120, ...Array.from({ length: 24 }, () => 2), ...Array.from({ length: 600 }, () => 1000 / 144)]) meter.add(ms);
    expect([meter.recentHz, meter.hz]).toEqual([144, 144]);
  });

  it("comes down to a rate a little below it too: 75 to 60, 165 to 144, 144 to 120, within 13 s (RV-1318)", () => {
    for (const [from, to] of [
      [75, 60],
      [165, 144],
      [144, 120],
      [144, 60],
    ] as const) {
      const meter = new RefreshMeter();
      feed(meter, 1000 / from, from * 3);
      expect(meter.recentHz, `${String(from)} Hz`).toBe(from);
      feed(meter, 1000 / to, to * 9);
      expect(meter.recentHz, `${String(from)} to ${String(to)} Hz, 9 s on`).toBe(from);
      feed(meter, 1000 / to, to * 4);
      expect(meter.recentHz, `${String(from)} to ${String(to)} Hz, 13 s on`).toBe(to);
    }
  });

  it("a hidden tab's long frame, told like any other, starts the same skip: its burst isn't counted (RV-1320)", () => {
    const meter = new RefreshMeter();
    feed(meter, 1000 / 60, 300);
    for (const ms of [5000, ...Array.from({ length: 24 }, () => 3), ...Array.from({ length: 900 }, () => 1000 / 60)]) meter.add(ms);
    expect([meter.recentHz, meter.hz]).toEqual([60, 60]);
  });

  it("the latched refresh is the fast edge's, as the video guard reads it: a slow page on a variable-refresh screen isn't a 30 Hz display (RV-1321)", () => {
    const r = seeded(6);
    const meter = new RefreshMeter();
    for (let i = 0; i < 600; i++) meter.add(22 + 8 * r());
    expect(meter.hz).toBe(50);
    expect(meter.recentHz).toBeLessThan(50);
  });

  it("about nine frames in ten doubled: the feel settles on a rate once and stays, never back and forth (RV-1303)", () => {
    for (const [hz, share] of [
      [60, 0.85],
      [60, 0.9],
      [60, 0.95],
      [144, 0.9],
      [144, 0.95],
    ] as const) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const r = seeded(seed);
        const frames: number[] = [];
        for (let t = 0; t < 120_000; t += frames[frames.length - 1] ?? 0) frames.push((r() < share ? 2000 : 1000) / hz);
        const seen = feels(frames);
        const what = `${String(hz)} Hz, ${String(share * 100)} % doubled, seed ${String(seed)}`;
        expect(changes(seen), what).toBeLessThanOrEqual(1);
        expect(seen[seen.length - 1], what).toBeGreaterThanOrEqual(seen[0] ?? 0);
        expect(new Set(seen).size === 1 || seen[seen.length - 1] === hz, what).toBe(true);
      }
    }
  });

  it("a timer's jitter or a 1 ms clock reads the screen's rate, not one too high: the fast frames' middle, not their edge (RV-1305)", () => {
    for (const [hz, by] of [
      [60, 2],
      [75, 1],
      [90, 1],
      [120, 1],
      [144, 1],
      [165, 1],
      [240, 1],
    ] as const) {
      const r = seeded(4);
      const times = Array.from({ length: hz * 30 }, (_, i) => (i * 1000) / hz + (r() - 0.5) * 2 * by);
      expect([...new Set(feels(times.slice(1).map((t, i) => t - (times[i] ?? 0))))], `${String(hz)} Hz, each frame's time ±${String(by)} ms`).toEqual([hz]);
    }
    for (const hz of [60, 72, 75, 120, 144, 165, 240]) {
      const times = Array.from({ length: hz * 30 }, (_, i) => Math.floor((i * 1000) / hz));
      expect([...new Set(feels(times.slice(1).map((t, i) => t - (times[i] ?? 0))))], `${String(hz)} Hz on a 1 ms clock`).toEqual([hz]);
    }
  });
});
