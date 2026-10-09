// The teams' colours as the game's arena takes them (notes/arena-visuals.md AV-2, AV-3): each team's primary P,
// linear, and its "full brightness" FB(P), which Team_TA hands every arena material with the primary.
import { Color } from "three";

/** The teams' primaries (Archetypes.Teams.Team0/1 DefaultColorList[0], linear) */
export const TEAM_PRIMARY_LINEAR: readonly (readonly [number, number, number])[] = [
  [0.098, 0.451, 1],
  [0.7647, 0.3922, 0.098],
];

/** FullBright (AV-2): the colour at full value (HSV V = 1), then scaled to (1 - its luminance) / 2 + 0.5, quantised to
 *  8-bit linear as the game stores it (RV-70b) */
export function fullBright([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const peak = Math.max(r, g, b, 1e-6);
  const [fr, fg, fb] = [r / peak, g / peak, b / peak];
  const v = (1 - (0.3 * fr + 0.59 * fg + 0.11 * fb)) / 2 + 0.5;
  const q = (c: number): number => Math.round(c * v * 255) / 255;
  return [q(fr), q(fg), q(fb)];
}

/** A linear triple as a three.js colour (its working space is linear) */
export function linear([r, g, b]: readonly [number, number, number]): Color {
  return new Color().setRGB(r, g, b);
}
