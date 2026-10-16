// The HUD's numbers as the game's (notes/visual-timing.md).
import { describe, expect, it } from "vitest";
import { EASE_IN_QUAD, EASE_OUT_QUAD, RESPAWN_LATE_PCT, RESPAWN_TEXT, boostArc, boostShown, messageShown, replaySpeed, replayTime, respawnHud } from "./hud";

describe("the boost meter's number (VT-21)", () => {
  it("is floor(pct · 100), at least 1 while any boost is left", () => {
    expect(boostShown(0)).toBe(0);
    expect(boostShown(0.4)).toBe(1);
    expect(boostShown(33.333)).toBe(33);
    expect(boostShown(99.6)).toBe(99);
    expect(boostShown(100)).toBe(100);
  });
});

describe("the boost meter's arc (HUD-5/6)", () => {
  it("2.25 degrees a point past the first, empty at 0 and 1, 225 at 100; the white top segment past 180 (80 %)", () => {
    expect(boostArc(0)).toEqual({ fill: 0, top: 0 });
    expect(boostArc(1)).toEqual({ fill: 0, top: 0 });
    expect(boostArc(2)).toEqual({ fill: 2.25, top: 0 });
    expect(boostArc(33)).toEqual({ fill: 72, top: 0 });
    expect(boostArc(81)).toEqual({ fill: 180, top: 0 });
    expect(boostArc(99)).toEqual({ fill: 180, top: 40.5 });
    expect(boostArc(100)).toEqual({ fill: 180, top: 45 });
  });
});

describe("the centre messages' filter (Match Notifications, HUD-10)", () => {
  it("All shows every level; Time Updates Only the time updates and the essential ones; Kickoffs Only the essential (HT-7)", () => {
    expect([0, 1, 2].map((l) => messageShown(l as 0 | 1 | 2, "all"))).toEqual([true, true, true]);
    expect([0, 1, 2].map((l) => messageShown(l as 0 | 1 | 2, "gameUpdates"))).toEqual([false, true, true]);
    expect([0, 1, 2].map((l) => messageShown(l as 0 | 1 | 2, "kickoff"))).toEqual([false, false, true]);
  });
});

describe("the replay's goal speed and time (HUD-11, HT-6)", () => {
  it("the speed rounded to uu/s, then round(x 0.036) KPH when metric, round(x 0.0223694) MPH otherwise", () => {
    expect(replaySpeed(2850, true)).toEqual({ value: 103, unit: "KPH" });
    expect(replaySpeed(2850, false)).toEqual({ value: 64, unit: "MPH" });
    expect(replaySpeed(1374.6, true)).toEqual({ value: 50, unit: "KPH" }); // (1375 x 0.036 = 49.5: up)
  });

  it("the round's age at the goal in whole seconds, minutes unpadded", () => {
    expect(replayTime(67.4)).toBe("1:07");
    expect(replayTime(4.5)).toBe("0:05");
    expect(replayTime(605)).toBe("10:05");
  });
});

describe("BOOST's fade past 80 % (HUD-7: GSAP's default ease, Power1)", () => {
  // (a CSS cubic-bezier's y at time x: its parameter solved by bisection)
  const bezier = (css: string, x: number): number => {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = (css.match(/[\d.]+/g) ?? []).map(Number);
    const at = (a: number, b: number, t: number): number => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };

  it("rises as 1 - (1 - s)^2 and falls back as the same tween reversed, 1 - s^2", () => {
    for (const s of [0.1, 0.3, 0.5, 0.8]) {
      expect(bezier(EASE_OUT_QUAD, s)).toBeCloseTo(1 - (1 - s) ** 2, 5);
      expect(1 - bezier(EASE_IN_QUAD, s)).toBeCloseTo(1 - s * s, 5);
    }
  });
});

describe("the respawn view (HUD-20, RH1)", () => {
  const car = (demoRespawnTimer: number, side: "left" | "right" | null = null, index = 0): Parameters<typeof respawnHud>[0] => ({ demoed: true, demoRespawnTimer, spawnSelection: { side, index } });
  it("the pick's share in 1 % steps over the 2.5 s before the prespawn; gone at the prespawn and when not demolished; no seconds", () => {
    expect(respawnHud(car(3))?.pct).toBe(100);
    expect(respawnHud(car(2.0))?.pct).toBe(60);
    expect(respawnHud(car(1.0))?.pct).toBe(20);
    expect(respawnHud(car(0.5))).toBeNull();
    expect(respawnHud({ ...car(2), demoed: false })).toBeNull();
    expect(Object.keys(respawnHud(car(2)) ?? {})).toEqual(["pct", "side", "inner", "keys"]);
    // (orange from 60 %: about a second after the demolition)
    expect(RESPAWN_LATE_PCT).toBe(60);
    expect(respawnHud(car(2.03))?.pct).toBeGreaterThan(RESPAWN_LATE_PCT);
  });

  it("the side picked and its spot (inner first), each side's key; the game's prompts", () => {
    const keys = { left: { kind: "word", text: "A" } as const, right: { kind: "word", text: "D" } as const };
    expect(respawnHud(car(2, "left", 0), keys)).toMatchObject({ side: "left", inner: true, keys });
    expect(respawnHud(car(2, "right", 1))).toMatchObject({ side: "right", inner: false, keys: { left: null, right: null } });
    expect(RESPAWN_TEXT).toEqual({ left: "Respawn Left", right: "Respawn Right" });
  });
});

