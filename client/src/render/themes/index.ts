// The map: Night, the only one (the user's decision of 2026-10-17; the others are in the history, before it). A match's
// map on the wire is an index into THEMES: its one entry, 0.
import { nightTheme } from "./night";
import type { Theme } from "./theme";

/** The maps a match can be on, by their index on the wire (the server's protocol::MAP_COUNT is their number) */
export const THEMES = ["night"] as const;
export type ThemeName = (typeof THEMES)[number];

/** Each map's name, as the menus and the loading screen show it */
export const MAP_NAMES: Readonly<Record<ThemeName, string>> = {
  night: "Night",
};

/** A match's map (its index) as a theme: Night, whatever the index (a newer server's) */
export function themeOfMap(map: number): ThemeName {
  return THEMES[map] ?? "night";
}

export function createTheme(): Theme {
  return nightTheme();
}
