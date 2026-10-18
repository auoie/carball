import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAT_TITLES, shownTitles, titleText } from "./podiumTitles";

describe("podium titles (notes/match-stats.md §5.4a)", () => {
  it("has the engine's 30 titles in its order", () => {
    const engine = readFileSync(new URL("../../../engine/stats/PodiumTitles.cpp", import.meta.url), "utf8");
    const order = [...engine.matchAll(/\{ "(\w+)", C::/gu)].map((m) => m[1]);
    expect(STAT_TITLES.map((x) => x.archetype)).toEqual(order);
    expect(STAT_TITLES).toHaveLength(30);
    expect(STAT_TITLES[0]?.archetype).toBe("OvertimeGoal");
    expect(STAT_TITLES[3]?.archetype).toBe("Goals_3_5");
    expect(STAT_TITLES[19]?.archetype).toBe("Shots");
    expect(STAT_TITLES[22]?.archetype).toBe("MostBoostPickups");
    expect(STAT_TITLES[29]?.archetype).toBe("SlowestGoal");
  });

  it("shows the title upper-cased over 'N label', plural past 1 (A.6 and A.7's lines)", () => {
    expect(titleText({ title: 3, count: 3 })).toEqual({ title: "PRODIGY", line: "3 Goals" });
    expect(titleText({ title: 19, count: 4 })).toEqual({ title: "STRIKER", line: "4 Shots on Goal" });
    expect(titleText({ title: 15, count: 1 })).toEqual({ title: "SCORER", line: "1 Goal" });
    expect(titleText({ title: 0, count: 1 })).toEqual({ title: "FINISHER", line: "1 Overtime Goal" });
    expect(titleText({ title: 26, count: 25 })?.line).toBe("25 Cars Bumped");
    expect(titleText({ title: 22, count: 1 })?.line).toBe("1 Boost Pickup");
  });

  it("gives speeds and distances in ft/s and ft (int(N x 3.28084)), metric on request", () => {
    expect(titleText({ title: 28, count: 28 })).toEqual({ title: "POWER HITTER", line: "91 ft/s Goal" });
    expect(titleText({ title: 28, count: 28 }, true)?.line).toBe("28 m/s Goal");
    expect(titleText({ title: 27, count: 57 })?.line).toBe("187 ft Goal");
    expect(titleText({ title: 27, count: 57 }, true)?.line).toBe("57 m Goal");
    expect(titleText({ title: 29, count: 6 })?.line).toBe("19 ft/s Goal");
  });

  it("shows the secondary only with a primary", () => {
    expect(shownTitles([null, { title: 15, count: 1 }])).toEqual([]);
    expect(shownTitles([{ title: 16, count: 2 }, null]).map((x) => x.title)).toEqual(["GOALKEEPER"]);
    expect(
      shownTitles([
        { title: 16, count: 2 },
        { title: 15, count: 1 },
      ]).map((x) => x.line),
    ).toEqual(["2 Saves", "1 Goal"]);
    expect(titleText({ title: 99, count: 1 })).toBeNull();
  });
});
