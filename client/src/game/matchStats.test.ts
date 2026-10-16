import { describe, expect, it } from "vitest";
import type { RosterEntry, ScoreboardEntry } from "../net/protocol";
import {
  COUNTERS,
  DEFAULT_COLUMNS,
  SCOREBOARD_COLUMNS,
  STAT_EVENTS,
  goalBanner,
  pingBars,
  rowColour,
  scoreboardAllowed,
  scoreboardTeams,
  statPopup,
  tickerRow,
} from "./matchStats";

const roster = new Map<number, RosterEntry>([
  [1, { car: 1, team: 0, model: 0, name: "Mercury" }],
  [2, { car: 2, team: 0, model: 0, name: "Venus" }],
  [3, { car: 3, team: 1, model: 0, name: "Mars" }],
]);

const entry = (car: number, counters: Partial<Record<keyof typeof COUNTERS, number>>, extra: Partial<ScoreboardEntry> = {}): ScoreboardEntry => {
  const values = Array.from({ length: 20 }, () => 0);
  for (const [k, v] of Object.entries(counters)) values[COUNTERS[k as keyof typeof COUNTERS]] = v;
  return { car, ping: 40, mvp: false, ready: false, counters: values, titles: [null, null], ...extra };
};

describe("match stats on the HUD", () => {
  it("pops up the player's primary awards upper-cased with their points; the rest only at All (§6.1)", () => {
    expect(statPopup(0, 100)).toEqual({ label: "GOAL", points: "+100", icon: "goal" });
    expect(statPopup(11, 10)).toEqual({ label: "SHOT ON GOAL", points: "+10", icon: "shot" });
    expect(statPopup(23, 0)).toEqual({ label: "DEMOLITION", points: null, icon: "demolish" }); // (no "+0")
    expect(statPopup(1, 20)).toBeNull(); // (Aerial Goal: not primary)
    expect(statPopup(1, 20, "all")).toMatchObject({ label: "AERIAL GOAL", points: "+20" });
    expect(statPopup(18, 2, "all")).toBeNull(); // (BallHit: never on the HUD)
    expect(statPopup(0, 100, "none")).toBeNull();
    expect(statPopup(99, 1, "all")).toBeNull();
  });

  it("feeds everyone's primary awards with the names upper-cased, 'YOU' for the player, the victim's too", () => {
    expect(tickerRow({ event: 0, receiver: 2, victim: 0 }, roster, 1)).toEqual({ receiver: { text: "VENUS", team: 0 }, victim: null, icon: "goal" });
    expect(tickerRow({ event: 23, receiver: 1, victim: 3 }, roster, 1)).toEqual({ receiver: { text: "YOU", team: 0 }, victim: { text: "MARS", team: 1 }, icon: "demolish" });
    expect(tickerRow({ event: 15, receiver: 1, victim: 0 }, roster, 1, "all")).toBeNull(); // (Clear: no ticker)
    expect(tickerRow({ event: 21, receiver: 1, victim: 0 }, roster, 1)).toBeNull(); // (Bicycle Hit: at All only)
  });

  it("has a label for every shown event and the primaries the game's eight", () => {
    const primaries = STAT_EVENTS.filter((e) => e.primary).map((e) => e.label);
    expect(primaries).toEqual(["Goal", "Assist", "Shot on Goal", "Save", "Epic Save", "Demolition", "MVP", "Win"]);
    for (const e of STAT_EVENTS) if (e.popup || e.ticker) expect(e.label).not.toBe("");
  });

  it("banners a goal with the scorer's name, else the team's", () => {
    expect(goalBanner({ team: 0, scorer: 2 }, roster)).toBe("VENUS SCORED!");
    expect(goalBanner({ team: 1, scorer: 0 }, roster)).toBe("ORANGE SCORED!");
    expect(goalBanner({ team: 0, scorer: 9 }, null)).toBe("BLUE SCORED!");
  });
});

describe("the scoreboard", () => {
  it("lists blue then orange, each sorted by score, goals, assists, saves; only rostered players (SB-2, SB-8)", () => {
    const entries = [entry(1, { score: 120, goals: 1 }), entry(2, { score: 120, goals: 1, assists: 1 }), entry(3, { score: 40 }), entry(9, { score: 999 })];
    const [blue, orange] = scoreboardTeams(entries, roster, 1, DEFAULT_COLUMNS);
    expect(blue.map((r) => r.car)).toEqual([2, 1]);
    expect(orange.map((r) => r.car)).toEqual([3]);
    expect(blue[1]).toMatchObject({ name: "Mercury", local: true, values: [120, 1, 0, 0, 0], ping: 40 });
  });

  it("fills the chosen columns from their counters", () => {
    const [blue] = scoreboardTeams([entry(1, { score: 5, demolishes: 3, ballTouches: 7 })], roster, 1, ["demos", "ballHits", "goals", "saves"]);
    expect(blue[0]?.values).toEqual([5, 3, 7, 0, 0]);
  });

  it("offers its columns sorted by their labels, the defaults among them", () => {
    const labels = SCOREBOARD_COLUMNS.map((c) => c.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    for (const id of DEFAULT_COLUMNS) expect(SCOREBOARD_COLUMNS.some((c) => c.id === id)).toBe(true);
  });

  it("bands the ping at 100, 200 and 250 ms, capped at 999 (SB-7)", () => {
    expect(pingBars(100)).toMatchObject({ text: "100", bars: 4 });
    expect(pingBars(100.2)).toMatchObject({ text: "101", bars: 3 });
    expect(pingBars(250)).toMatchObject({ bars: 2, colour: "#FF6700" });
    expect(pingBars(251)).toMatchObject({ bars: 1, colour: "#FF0000" });
    expect(pingBars(5000).text).toBe("999");
  });

  it("draws others in their pale team colour and the player in white (SB-6)", () => {
    expect(rowColour(0, false)).toBe("#A0FAFF");
    expect(rowColour(1, false)).toBe("#FFFFA0");
    expect(rowColour(1, true)).toBe("#FFFFFF");
  });

  it("shows in every phase but the match's end", () => {
    expect(scoreboardAllowed("replay")).toBe(true);
    expect(scoreboardAllowed("prePodium") || scoreboardAllowed("podium") || scoreboardAllowed("finished")).toBe(false);
    expect(scoreboardAllowed("waiting")).toBe(true);
    expect(scoreboardAllowed(undefined)).toBe(false);
  });
});
