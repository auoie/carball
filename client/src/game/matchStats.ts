// Match stats as the player sees them (notes/match-stats.md §5-6, notes/scoreboard.md): the stat events' names (the
// game's StatEvents.int labels and [Scoreboard] column headers, cleared to ship verbatim), which awards pop up and reach
// the feed, the scoreboard's columns, rows and order, the ping's bands, and the goal banner. The server computes the
// stats (engine/stats); this is display only.
import type { MatchPhase, RosterEntry, ScoreboardEntry } from "../net/protocol";
import { TEAM_FONT_COLOURS } from "./quickChat";

/** The server's match counters, in its order (engine/stats/StatFactory.h Counter) */
export const COUNTERS = {
  score: 0,
  goals: 1,
  assists: 2,
  saves: 3,
  shots: 4,
  demolishes: 5,
  epicSaves: 6,
  centers: 7,
  clears: 8,
  aerialHits: 9,
  bicycleHits: 10,
  juggleHits: 11,
  firstTouches: 12,
  poolShots: 13,
  lowFives: 14,
  highFives: 15,
  timesDemolished: 16,
  crossbarHits: 17,
  ownGoals: 18,
  ballTouches: 19,
} as const;
export type Counter = keyof typeof COUNTERS;

/** The icons drawn for stat events (ui/statIcons.ts) */
export type StatIcon = "goal" | "assist" | "save" | "epicSave" | "shot" | "demolish" | "mvp" | "win" | "generic";

export interface StatEventInfo {
  /** StatEvent_TA.Label (shown upper-cased); "" for the ones never shown */
  readonly label: string;
  /** bPrimaryStat: shown at the default display level */
  readonly primary: boolean;
  /** bShowOnHUD: has a popup */
  readonly popup: boolean;
  /** bNotifyTicker: every player's feed */
  readonly ticker: boolean;
  readonly icon: StatIcon;
}

const ev = (label: string, primary: boolean, popup: boolean, ticker: boolean, icon: StatIcon = "generic"): StatEventInfo => ({ label, primary, popup, ticker, icon });

/** By the protocol's ids (protocol/README.md, the server's `stat` ids): match-stats.md §2 and "Stat text" */
export const STAT_EVENTS: readonly StatEventInfo[] = [
  ev("Goal", true, true, true, "goal"), // 0
  ev("Aerial Goal", false, true, true),
  ev("Backwards Goal", false, true, true),
  ev("Bicycle Goal", false, true, true),
  ev("Turtle Goal", false, true, true),
  ev("Long Goal", false, true, true), // 5
  ev("Overtime Goal", false, true, true),
  ev("Hat Trick", false, true, true),
  ev("Assist", true, true, true, "assist"),
  ev("Playmaker", false, true, true),
  ev("Pool Shot", false, true, true), // 10
  ev("Shot on Goal", true, true, true, "shot"),
  ev("Save", true, true, true, "save"),
  ev("Epic Save", true, true, true, "epicSave"),
  ev("Savior", false, true, true),
  ev("Clear Ball", false, true, false), // 15
  ev("Center Ball", false, true, false),
  ev("First Touch", false, true, false),
  ev("", false, false, false), // BallHit (its package label is never shown)
  ev("", false, false, false), // CrossbarHits
  ev("Aerial Hit", false, false, false), // 20
  ev("Bicycle Hit", false, false, true),
  ev("Juggle", false, false, false),
  ev("Demolition", true, true, true, "demolish"),
  ev("", false, false, false), // Demolished
  ev("Extermination", false, true, true), // 25
  ev("Low Five", false, true, true),
  ev("High Five", false, true, true),
  ev("Own Goal", false, false, false),
  ev("MVP", true, true, true, "mvp"),
  ev("Win", true, true, true, "win"), // 30
  ev("Completed Match", false, true, false), // Loss
  ev("", false, false, false), // DemolitionRespawn
];

/** StatEventDisplayLevel ("In-game stats"): None, Primary (the default), All */
export type StatDisplayLevel = "none" | "primary" | "all";

/** CanDisplayStatEvent: by the display level (Primary: primary events only) */
function displayed(info: StatEventInfo, level: StatDisplayLevel): boolean {
  return level === "all" || (level === "primary" && info.primary);
}

export interface StatPopup {
  /** The label, upper-cased */
  readonly label: string;
  /** "+N" (null: none, for 0 points) */
  readonly points: string | null;
  readonly icon: StatIcon;
}

/** The popup for one of the player's own awards (GFxHUD_TA.HandleStatEvent), or null when it isn't shown */
export function statPopup(event: number, points: number, level: StatDisplayLevel = "primary"): StatPopup | null {
  const info = STAT_EVENTS[event];
  if (!info?.popup || !displayed(info, level) || info.label === "") return null;
  return { label: info.label.toUpperCase(), points: points > 0 ? `+${String(points)}` : null, icon: info.icon };
}

/** How long each popup shows (frame 80's notifyPopupComplete at 30 fps: the next starts 79/30 s later) */
export const POPUP_SECONDS = 79 / 30;

export interface TickerName {
  /** The name, upper-cased; the local player's "YOU" */
  readonly text: string;
  readonly team: number;
}

export interface TickerRow {
  readonly receiver: TickerName;
  readonly victim: TickerName | null;
  readonly icon: StatIcon;
}

/** The feed's row for an award (GFxHUD_TA.HandleStatTickerMessage), or null when it isn't shown (the label isn't) */
export function tickerRow(
  m: { readonly event: number; readonly receiver: number; readonly victim: number },
  roster: ReadonlyMap<number, RosterEntry>,
  localCar: number,
  level: StatDisplayLevel = "primary",
): TickerRow | null {
  const info = STAT_EVENTS[m.event];
  if (!info?.ticker || !displayed(info, level)) return null;
  const name = (car: number): TickerName => {
    const p = roster.get(car);
    return { text: car === localCar ? "YOU" : (p?.name ?? "").toUpperCase(), team: p?.team === 1 ? 1 : 0 };
  };
  return { receiver: name(m.receiver), victim: m.victim === 0 ? null : name(m.victim), icon: info.icon };
}

/** The feed: 6 rows at most, each 4 s */
export const TICKER = { rows: 6, seconds: 4 } as const;

/** Team names (Team_TA TeamName0/1, cleared with the match intro/outro text) */
export const TEAM_NAMES = ["Blue", "Orange"] as const;

/** The goal banner (TAGame.int [Messages] GoalScored, "{Player} scored!", verbatim): the scorer's name, else the
 *  team's, upper-cased as the HUD draws its messages */
export function goalBanner(goal: { readonly team: number; readonly scorer: number }, roster: ReadonlyMap<number, RosterEntry> | null): string {
  const name = goal.scorer === 0 ? undefined : roster?.get(goal.scorer)?.name;
  return `${name ?? TEAM_NAMES[goal.team === 1 ? 1 : 0]} scored!`.toUpperCase();
}

/** A selectable scoreboard column (ECustomScoreboardStat with its [Scoreboard] CSStat label, verbatim) */
export interface ScoreboardColumn {
  readonly id: string;
  readonly label: string;
  readonly counter: Counter;
}

/** The columns this clone can fill (the game's others need counters it doesn't keep: flip resets, damage, dodges, car
 *  bumps, boost pickups, power-ups), sorted by label as the settings list them */
export const SCOREBOARD_COLUMNS: readonly ScoreboardColumn[] = (
  [
    { id: "goals", label: "GOALS", counter: "goals" },
    { id: "assists", label: "ASSISTS", counter: "assists" },
    { id: "saves", label: "SAVES", counter: "saves" },
    { id: "shots", label: "SHOTS", counter: "shots" },
    { id: "epicSaves", label: "EPIC SAVES", counter: "epicSaves" },
    { id: "centers", label: "CENTERS", counter: "centers" },
    { id: "clears", label: "CLEARS", counter: "clears" },
    { id: "aerialHits", label: "AERIAL HITS", counter: "aerialHits" },
    { id: "bicycleHits", label: "BICYCLE HITS", counter: "bicycleHits" },
    { id: "juggles", label: "JUGGLES", counter: "juggleHits" },
    { id: "demos", label: "DEMOS", counter: "demolishes" },
    { id: "firstTouches", label: "FIRST TOUCHES", counter: "firstTouches" },
    { id: "poolShots", label: "POOL SHOTS", counter: "poolShots" },
    { id: "lowFives", label: "LOW FIVES", counter: "lowFives" },
    { id: "highFives", label: "HIGH FIVES", counter: "highFives" },
    { id: "ballHits", label: "BALL HITS", counter: "ballTouches" },
    { id: "booms", label: "BOOMS", counter: "timesDemolished" },
    { id: "crossbarHits", label: "CROSSBAR HITS", counter: "crossbarHits" },
  ] as const
).toSorted((a, b) => a.label.localeCompare(b.label));

/** Soccar's default columns (Default__ProfileScoreboardSave_TA): also in 1v1 (SB-9) */
export const DEFAULT_COLUMNS: readonly string[] = ["goals", "assists", "saves", "shots"];

/** The first column (always MatchScore) and the ping's header */
export const SCOREBOARD_TEXT = { score: "SCORE", ping: "PING" } as const;

export interface ScoreboardRow {
  readonly car: number;
  readonly name: string;
  readonly local: boolean;
  readonly mvp: boolean;
  /** Ready for the next match (the end screen's ready check) */
  readonly ready: boolean;
  /** MatchScore, then the four columns' values */
  readonly values: readonly number[];
  readonly ping: number;
}

/** The two teams' rows (blue first, always: SB-2), each sorted as the game's ScoreboardSort (MVPSort: score, goals,
 *  assists, saves, each descending; full ties in the server's order); only players in the roster */
export function scoreboardTeams(
  entries: readonly ScoreboardEntry[],
  roster: ReadonlyMap<number, RosterEntry>,
  localCar: number,
  columns: readonly string[],
): readonly [ScoreboardRow[], ScoreboardRow[]] {
  const counters = columns.map((id) => COUNTERS[SCOREBOARD_COLUMNS.find((c) => c.id === id)?.counter ?? "goals"]);
  const teams: [{ row: ScoreboardRow; key: readonly number[] }[], { row: ScoreboardRow; key: readonly number[] }[]] = [[], []];
  for (const e of entries) {
    const p = roster.get(e.car);
    if (!p) continue;
    const c = (i: number): number => e.counters[i] ?? 0;
    const row = { car: e.car, name: p.name, local: e.car === localCar, mvp: e.mvp, ready: e.ready, values: [c(COUNTERS.score), ...counters.map(c)], ping: e.ping };
    teams[p.team === 1 ? 1 : 0].push({ row, key: [c(COUNTERS.score), c(COUNTERS.goals), c(COUNTERS.assists), c(COUNTERS.saves)] });
  }
  const order = (a: { key: readonly number[] }, b: { key: readonly number[] }): number => {
    for (let i = 0; i < 4; i++) if ((a.key[i] ?? 0) !== (b.key[i] ?? 0)) return (b.key[i] ?? 0) - (a.key[i] ?? 0);
    return 0;
  };
  return [teams[0].toSorted(order).map((t) => t.row), teams[1].toSorted(order).map((t) => t.row)];
}

/** The ping as shown (min(ceil, 999)) and its strength: 4 bars up to 100 ms, 3 to 200, 2 to 250, 1 above (SB-7) */
export function pingBars(ms: number): { readonly text: string; readonly bars: 1 | 2 | 3 | 4; readonly colour: string } {
  const shown = Math.min(Math.ceil(ms), 999);
  if (shown > 250) return { text: String(shown), bars: 1, colour: "#FF0000" };
  if (shown > 200) return { text: String(shown), bars: 2, colour: "#FF6700" };
  if (shown > 100) return { text: String(shown), bars: 3, colour: "#FFF800" };
  return { text: String(shown), bars: 4, colour: "#89FF00" };
}

/** The scoreboard's text colour for a row (multiplyColor(team, 2, 80); the local player's white: SB-6) */
export function rowColour(team: number, local: boolean): string {
  if (local) return "#FFFFFF";
  const hex = (TEAM_FONT_COLOURS[team === 1 ? 1 : 0] as readonly number[]).map((c) => Math.min(255, (c + 80) * 2).toString(16).padStart(2, "0"));
  return `#${hex.join("").toUpperCase()}`;
}

/** The scoreboard may show (SB-10): online, in every phase but the match's end (pre-podium, podium, end screen) */
export function scoreboardAllowed(phase: MatchPhase | undefined): boolean {
  return phase !== undefined && phase !== "prePodium" && phase !== "podium" && phase !== "finished";
}
