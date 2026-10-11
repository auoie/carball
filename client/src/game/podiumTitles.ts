// The podium titles (notes/match-stats.md §5.4a): the titles in the engine's order (engine/stats/PodiumTitles.cpp
// STAT_TITLES: the protocol's ids), their names and the stat line under them (GFxData_PRI_TA.InitStatTitle: "N label",
// plural when N > 1; speeds and distances in ft/s and ft unless metric). Verbatim podium text.
import type { PodiumTitle } from "../net/protocol";

type Unit = "count" | "speed" | "distance";

interface TitleText {
  /** The archetype (the engine's name) */
  readonly archetype: string;
  readonly title: string;
  /** The stat's Label and PluralLabel */
  readonly label: string;
  readonly plural: string;
  readonly unit: Unit;
}

const t = (archetype: string, title: string, label: string, plural: string, unit: Unit = "count"): TitleText => ({ archetype, title, label, plural, unit });

export const STAT_TITLES: readonly TitleText[] = [
  // StatSingleInstance
  t("OvertimeGoal", "Finisher", "Overtime Goal", "Overtime Goals"),
  // StatCompound
  t("Goals_10", "Force of Nature", "Goal", "Goals"),
  t("Goals_6_9", "Ace", "Goal", "Goals"),
  t("Goals_3_5", "Prodigy", "Goal", "Goals"),
  t("Saves_10", "Savior", "Save", "Saves"),
  t("Saves_6_9", "Protector", "Save", "Saves"),
  t("Saves_3_5", "Warden", "Save", "Saves"),
  t("EpicSaves", "Guardian Angel", "Epic Save", "Epic Saves"),
  t("PoolShots", "Calculator", "Pool Shot", "Pool Shots"),
  t("BackwardsGoal", "Show-off", "Backwards Goal", "Backwards Goals"),
  t("BicycleGoal", "Acrobat", "Bicycle Goal", "Bicycle Goals"),
  t("AerialGoal", "Aviator", "Aerial Goal", "Aerial Goals"),
  t("TurtleGoal", "Turtle", "Turtle Goal", "Turtle Goals"),
  t("OwnGoal", "Traitor", "Own Goal", "Own Goals"),
  t("Juggles", "Juggler", "Juggle", "Juggles"),
  // StatStandard
  t("Goals", "Scorer", "Goal", "Goals"),
  t("Saves", "Goalkeeper", "Save", "Saves"),
  t("Assists", "Playmaker", "Assist", "Assists"),
  t("Centers", "Tactician", "Center Ball", "Centered Balls"),
  t("Shots", "Striker", "Shot on Goal", "Shots on Goal"),
  t("FirstTouches", "Aggressor", "First Touch", "First Touches"),
  t("Demolitions", "Executioner", "Demolition", "Demolitions"),
  // StatTracking
  t("MostBoostPickups", "Speed Demon", "Boost Pickup", "Boost Pickups"),
  t("FewestBoostPickups", "Hoarder", "Boost Pickup", "Boost Pickups"),
  t("MostBallTouches", "Ball Hog", "Ball Touch", "Ball Touches"),
  t("FewestBallTouches", "Benchwarmer", "Ball Touch", "Ball Touches"),
  t("CarTouches", "Enforcer", "Car Touch", "Cars Bumped"),
  t("FurthestGoal", "Sniper", "Goal", "Goal", "distance"),
  t("FastestGoal", "Power Hitter", "Goal", "Goal", "speed"),
  t("SlowestGoal", "Slowpoke", "Goal", "Goal", "speed"),
];

const UNITS = { speed: { metric: "m/s", imperial: "ft/s" }, distance: { metric: "m", imperial: "ft" } } as const;

/** A title as shown: its name upper-cased and its stat line (null: an unknown id) */
export function titleText(title: PodiumTitle, metric = false): { readonly title: string; readonly line: string } | null {
  const text = STAT_TITLES[title.title];
  if (!text) return null;
  // (imperial: the whole metres or m/s times 3.28084 in float32, truncated again)
  const n = text.unit !== "count" && !metric ? Math.trunc(Math.fround(Math.fround(title.count) * Math.fround(3.28084))) : title.count;
  let postfix = n > 1 ? text.plural : text.label;
  if (text.unit !== "count") postfix = `${UNITS[text.unit][metric ? "metric" : "imperial"]} ${postfix}`;
  return { title: text.title.toUpperCase(), line: `${String(n)} ${postfix}` };
}

/** The titles a player shows: the primary, then the secondary only with a primary */
export function shownTitles(titles: readonly [PodiumTitle | null, PodiumTitle | null] | undefined, metric = false): { readonly title: string; readonly line: string }[] {
  const primary = titles?.[0] ? titleText(titles[0], metric) : null;
  if (!primary) return [];
  const secondary = titles?.[1] ? titleText(titles[1], metric) : null;
  return secondary ? [primary, secondary] : [primary];
}
