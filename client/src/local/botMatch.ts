// The offline match against bots, as the menu sets it up: a team size, a bot (a package's) and its difficulty level in
// each teammate's and opponent's slot, kept between visits; the player on the garage's team (on Night, the one map). The menu page hands the match
// page its setup in this tab's sessionStorage (as a queue match's claim, net/pages.ts), kept so a reload plays it again.
import type { Team } from "../engine/world";
import type { BotListing } from "../bots/listing";
import { BOT_ID } from "../bots/manifest";
import type { BotSlot, LocalMatchSetup } from "./hostMessages";

export type TeamSize = 1 | 2 | 3;

/** A slot's bot (a package's id) and its level (bots/listing.ts BotLevel's id) */
export interface BotPick {
  readonly bot: string;
  readonly level: string;
}

/** Each slot's pick: teammates (team size less one), opponents (team size) */
export interface BotChoices {
  readonly teamSize: TeamSize;
  readonly teammates: readonly BotPick[];
  readonly opponents: readonly BotPick[];
}

const CHOICES_KEY = "carball.botChoices";
const MATCH_KEY = "carball.botMatch";

type Store = Pick<Storage, "getItem" | "setItem">;

const playable = (listings: readonly BotListing[], teamSize: number): BotListing[] => listings.filter((l) => l.playable && l.teamSizes.includes(teamSize));

/** The team sizes some playable bot plays */
export function botTeamSizes(listings: readonly BotListing[]): TeamSize[] {
  return ([1, 2, 3] as const).filter((n) => playable(listings, n).length > 0);
}

/** The choices made to fit what's there: a team size some bot plays (the nearest smaller, else the smallest), each slot
 *  its bot if that plays the size, else the first that does, at its level if that bot offers it, else full; null with no
 *  playable bot */
export function fitChoices(choices: BotChoices | null, listings: readonly BotListing[]): BotChoices | null {
  const sizes = botTeamSizes(listings);
  const wanted = choices?.teamSize ?? 1;
  const teamSize = [...sizes].reverse().find((n) => n <= wanted) ?? sizes[0];
  if (teamSize === undefined) return null;
  const bots = playable(listings, teamSize);
  const first = bots[0]?.id ?? "";
  const slot = (picked: readonly BotPick[] | undefined, i: number): BotPick => {
    const pick = picked?.[i];
    const listing = bots.find((l) => l.id === pick?.bot) ?? bots[0];
    const bot = listing?.id ?? first;
    // (its level kept for the same bot, if it offers it; a bot put in its place starts at full)
    const level = pick && listing?.id === pick.bot && listing.levels.some((l) => l.id === pick.level) ? pick.level : "full";
    return { bot, level };
  };
  return {
    teamSize,
    teammates: Array.from({ length: teamSize - 1 }, (_, i) => slot(choices?.teammates, i)),
    opponents: Array.from({ length: teamSize }, (_, i) => slot(choices?.opponents, i)),
  };
}

/** The match's setup: the teammates on the player's team, the opponents on the other, each named after its bot (its
 *  level's name after it below full; a number after a name used twice), at its level's strength */
export function botMatchSetup(choices: BotChoices, listings: readonly BotListing[], team: Team, seed: number): LocalMatchSetup {
  const picks = [...choices.teammates, ...choices.opponents];
  const level = (pick: BotPick): { readonly name: string; readonly strength: number } | undefined =>
    listings.find((l) => l.id === pick.bot)?.levels.find((v) => v.id === pick.level);
  const name = (pick: BotPick): string => {
    const base = listings.find((l) => l.id === pick.bot)?.name ?? pick.bot;
    return pick.level === "full" ? base : `${base} ${level(pick)?.name ?? pick.level}`;
  };
  const counts = new Map<string, number>();
  const bots: BotSlot[] = picks.map((pick, i) => {
    const base = name(pick);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const repeated = picks.filter((other) => name(other) === base).length > 1;
    const strength = level(pick)?.strength ?? 1;
    return {
      team: i < choices.teammates.length ? team : ((1 - team) as Team),
      name: repeated ? `${base} ${String(n)}` : base,
      brain: pick.bot,
      ...(strength < 1 ? { strength } : {}),
    };
  });
  return { teamSize: choices.teamSize, seed, bots };
}

const isPick = (v: unknown): v is BotPick =>
  typeof v === "object" && v !== null && "bot" in v && typeof v.bot === "string" && "level" in v && typeof v.level === "string";

/** The kept choices (their slots' picks checked; fitChoices fits them to the bots there are), or null */
export function storedChoices(storage: Store | null = typeof localStorage === "undefined" ? null : localStorage): BotChoices | null {
  try {
    const v = JSON.parse(storage?.getItem(CHOICES_KEY) ?? "null") as { teamSize?: unknown; teammates?: unknown; opponents?: unknown } | null;
    if (!v || (v.teamSize !== 1 && v.teamSize !== 2 && v.teamSize !== 3) || !Array.isArray(v.teammates) || !Array.isArray(v.opponents)) return null;
    const picks = (list: readonly unknown[]): BotPick[] => list.filter(isPick);
    return { teamSize: v.teamSize, teammates: picks(v.teammates), opponents: picks(v.opponents) };
  } catch {
    return null;
  }
}

export function storeChoices(choices: BotChoices, storage: Store | null = typeof localStorage === "undefined" ? null : localStorage): void {
  try {
    storage?.setItem(CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // (not kept)
  }
}

const session = (): Store | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

export function storeBotMatch(setup: LocalMatchSetup, storage: Store | null = session()): void {
  try {
    storage?.setItem(MATCH_KEY, JSON.stringify(setup));
  } catch {
    // (not kept: the match page goes back to the menu)
  }
}

/** The match page's setup (kept: a reload plays it again), checked; null for none or a broken one */
export function readBotMatch(storage: Store | null = session()): LocalMatchSetup | null {
  try {
    const v = JSON.parse(storage?.getItem(MATCH_KEY) ?? "null") as { teamSize?: unknown; seed?: unknown; bots?: unknown } | null;
    if (!v || (v.teamSize !== 1 && v.teamSize !== 2 && v.teamSize !== 3) || typeof v.seed !== "number" || !Array.isArray(v.bots)) return null;
    const slots = v.bots as readonly Partial<Record<keyof BotSlot, unknown>>[];
    const strength = (s: unknown): boolean => s === undefined || (typeof s === "number" && s >= 0 && s <= 1);
    // (a brain a bot's id, before the worker fetches its package by it: RV-546)
    const bots = slots.filter(
      (b): b is BotSlot =>
        (b.team === 0 || b.team === 1) && typeof b.name === "string" && typeof b.brain === "string" && BOT_ID.test(b.brain) && strength(b.strength),
    );
    if (bots.length !== v.teamSize * 2 - 1) return null;
    return { teamSize: v.teamSize, seed: v.seed, bots };
  } catch {
    return null;
  }
}
