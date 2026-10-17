// The arena themes: a match's map is one (its index on the wire: protocol/README.md), free play's the map select's pick
// (src/ui/mainMenu.ts), and ?theme=… in the page URL overrides either (development). Each theme but the default is its
// own chunk of the build, downloaded only when chosen.
import { nightTheme } from "./night";
import type { Theme } from "./theme";

/** The themes in their order: a map's index on the wire (MatchFound, Welcome) names one, so the list is only ever
 *  appended to (its length is the server's protocol::MAP_COUNT) */
export const THEMES = [
  "night",
  "stadium",
  "meadow",
  "forest",
  "city",
  "infested",
  "kawaii",
  "platformer",
  "haunted",
  "ghosts",
  "dimension",
  "summit",
  "crater",
  "temple",
  "island",
  "lake",
  // (Night's greenhouse: on the wire from protocol 25, appended so every other index keeps its map)
  "greenhouse",
] as const;

/** The map select's maps (in its order): every match map, Night's greenhouse beside Night. Unused since the user's decision
 *  of 2026-10-17 (AVAILABLE_MAP alone is offered), kept */
export const MAP_CHOICES = [THEMES[0], THEMES[16], ...THEMES.slice(1, 16)] as const;

/** The one map offered (the user's decision, 2026-10-17): free play's, every match's (the server's pick) and the bots';
 *  the others' code kept, unused (?theme= still loads one: development) */
export const AVAILABLE_MAP: ThemeName = "greenhouse";
export type ThemeName = (typeof MAP_CHOICES)[number];

/** Each map's name in the map select (none of the game's arenas') */
export const MAP_NAMES: Readonly<Record<ThemeName, string>> = {
  night: "Night",
  greenhouse: "Night · Greenhouse",
  stadium: "Stadium",
  meadow: "Meadow",
  forest: "Forest",
  city: "City",
  infested: "Infested",
  kawaii: "Kawaii",
  platformer: "Platformer",
  haunted: "Haunted",
  ghosts: "Ghosts",
  dimension: "Dimension",
  summit: "Summit",
  crater: "Crater",
  temple: "Temple",
  island: "Island",
  lake: "Lake",
};

/** The theme called `value`, or the default (night). */
export function themeName(value: string | null): ThemeName {
  return MAP_CHOICES.find((t) => t === value) ?? "night";
}

/** A match's map (its index) as a theme; an index this page doesn't know (a newer server's) is the default */
export function themeOfMap(map: number): ThemeName {
  return THEMES[map] ?? "night";
}

/** Each theme's module but the default's (its own chunk), downloaded when first asked for */
const MODULES: Readonly<Record<Exclude<ThemeName, "night">, () => Promise<() => Theme>>> = {
  greenhouse: async () => (await import("./greenhouse")).greenhouseTheme,
  stadium: async () => (await import("./stadium")).stadiumTheme,
  meadow: async () => (await import("./meadow")).meadowTheme,
  forest: async () => (await import("./forest")).forestTheme,
  city: async () => (await import("./city")).cityTheme,
  infested: async () => (await import("./infested")).infestedTheme,
  kawaii: async () => (await import("./kawaii")).kawaiiTheme,
  platformer: async () => (await import("./platformer")).platformerTheme,
  haunted: async () => (await import("./haunted")).hauntedTheme,
  ghosts: async () => (await import("./ghosts")).ghostsTheme,
  dimension: async () => (await import("./dimension")).dimensionTheme,
  summit: async () => (await import("./summit")).summitTheme,
  crater: async () => (await import("./crater")).craterTheme,
  temple: async () => (await import("./temple")).templeTheme,
  island: async () => (await import("./island")).islandTheme,
  lake: async () => (await import("./lake")).lakeTheme,
};

export async function createTheme(name: ThemeName): Promise<Theme> {
  return name === "night" ? nightTheme() : (await MODULES[name]())();
}

/** A theme, or night's (in the main bundle) if its chunk can't be fetched (a network blip, a redeploy meanwhile): themes
 *  are looks only, so the match plays on in night's (RV-445); the name of the one made */
export async function createThemeOrNight(name: ThemeName): Promise<{ name: ThemeName; theme: Theme }> {
  try {
    return { name, theme: await createTheme(name) };
  } catch (e) {
    console.warn(`the ${name} arena didn't load, night's instead:`, e);
    return { name: "night", theme: nightTheme() };
  }
}

/** A theme's chunk downloaded ahead, not built (a found match's map, during the join's countdown) */
export async function preloadTheme(name: ThemeName): Promise<void> {
  if (name !== "night") await MODULES[name]();
}
