// The HUD's numbers as the game's (notes/visual-timing.md).
import { describe, expect, it } from "vitest";
import { RESPAWN_LATE_PCT, RESPAWN_TEXT, boostShown, messageShown, replaySpeed, replayTime, respawnHud, respawnLate, respawnView } from "./hud";

describe("the boost meter's number (VT-21)", () => {
  it("is floor(pct · 100), at least 1 while any boost is left", () => {
    expect(boostShown(0)).toBe(0);
    expect(boostShown(0.4)).toBe(1);
    expect(boostShown(33.333)).toBe(33);
    expect(boostShown(99.6)).toBe(99);
    expect(boostShown(100)).toBe(100);
    expect([boostShown(Number.NaN), boostShown(Number.POSITIVE_INFINITY)], "not a number: none (RV-1140)").toEqual([0, 0]);
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

describe("the respawn view (HUD-20, RH1)", () => {
  const car = (demoRespawnTimer: number, side: "left" | "right" | null = null, index = 0): Parameters<typeof respawnHud>[0] => ({
    demoed: true,
    demoRespawnTimer,
    spawnSelection: { side, index },
  });
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
    // (floored, not rounded: 59.6 % reads 59; orange at 60 itself, not 61: RV-529's CM22, CM23)
    expect(respawnHud(car(1.99))?.pct).toBe(59);
    expect([respawnLate(61), respawnLate(60), respawnLate(0)]).toEqual([false, true, true]);
  });

  it("shown in a match only in Active and at 0:00 with the ball up; free play always (RV-529's CM26)", () => {
    const keys = { left: null, right: null };
    expect(respawnView(car(2), null, keys)?.pct).toBe(60);
    expect(respawnView(car(2), { phase: "active" }, keys)?.pct).toBe(60);
    expect(respawnView(car(2), { phase: "timeUp" }, keys)?.pct).toBe(60);
    for (const phase of ["countdown", "postGoal", "replay", "prePodium", "waiting", "podium", "finished"] as const)
      expect(respawnView(car(2), { phase }, keys), phase).toBeNull();
    expect(respawnView(null, { phase: "active" }, keys)).toBeNull();
  });

  it("the side picked and its spot (inner first), each side's key; the game's prompts", () => {
    const keys = { left: { kind: "word", text: "A" } as const, right: { kind: "word", text: "D" } as const };
    expect(respawnHud(car(2, "left", 0), keys)).toMatchObject({ side: "left", inner: true, keys });
    expect(respawnHud(car(2, "right", 1))).toMatchObject({ side: "right", inner: false, keys: { left: null, right: null } });
    expect(RESPAWN_TEXT).toEqual({ left: "Respawn Left", right: "Respawn Right" });
  });
});
