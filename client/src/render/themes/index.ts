// The arena themes, chosen by name (?theme=… in the page URL). Each theme but the default is its own chunk of the
// build, downloaded only when chosen.
import { nightTheme } from "./night";
import type { Theme } from "./theme";

export const THEMES = ["night", "meadow", "forest", "city", "infested", "kawaii", "platformer"] as const;
export type ThemeName = (typeof THEMES)[number];

/** The theme called `value`, or the default (night). */
export function themeName(value: string | null): ThemeName {
  return THEMES.find((t) => t === value) ?? "night";
}

export async function createTheme(name: ThemeName): Promise<Theme> {
  switch (name) {
    case "night":
      return nightTheme();
    case "meadow":
      return (await import("./meadow")).meadowTheme();
    case "forest":
      return (await import("./forest")).forestTheme();
    case "city":
      return (await import("./city")).cityTheme();
    case "infested":
      return (await import("./infested")).infestedTheme();
    case "kawaii":
      return (await import("./kawaii")).kawaiiTheme();
    case "platformer":
      return (await import("./platformer")).platformerTheme();
  }
}
