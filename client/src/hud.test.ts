// The HUD's numbers as the game's (notes/visual-timing.md).
import { describe, expect, it } from "vitest";
import { boostArc, boostShown, messageShown, replaySpeed, replayTime } from "./hud";

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

