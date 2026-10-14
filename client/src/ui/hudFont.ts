// The HUD's fonts (notes/hud-menus.md): the game draws $HeaderFont and $HeaderThinFont in Bourgeois Medium and Thin,
// its numbers ($NumbersWideFont) in Dashboard Numbers Wide, which we don't ship. The local substitutes (Bahnschrift
// SemiCondensed, Arial Narrow, ...; Bahnschrift, ...) have taller capitals and digits at the same size, so every size is
// scaled by the game font's cap (digit) height over the substitute's, measured here on the font the browser actually
// draws the stack with: the CSS variables --hud-header-scale, --hud-thin-scale and --hud-numbers-scale; the digits'
// advance matched with letter-spacing, --hud-numbers-track (em of the scaled size), and each number glyph's ink fitted to
// the game's (--num-s-KEY, --num-x-KEY: ui/numberCells.ts). The fonts are ours, bundled (style.css); measured once
// they're in.
import { NUMBERS_INK, glyphKey, inkFit } from "./numberCells";

/** Bourgeois Medium's and Thin's cap height (em: GFX_Fonts' DefineFont3 outlines, the static session's measure) */
export const BOURGEOIS_CAP_HEIGHT = 0.5679;

/** Dashboard Numbers Wide's digit height and digit advance (em: HT-12; '1' and ':' are narrower, proportional) */
export const NUMBERS_DIGIT_HEIGHT = 0.5781;
export const NUMBERS_ADVANCE = 0.796;

/** The size scale that gives a font of cap height `cap` (em) Bourgeois' capitals (1 if not measured) */
export function capScale(cap: number | null, target = BOURGEOIS_CAP_HEIGHT): number {
  return cap && cap > 0 ? target / cap : 1;
}

/** The letter-spacing (em of the scaled font) that gives a font of digit advance `advance` (em), scaled by `scale`,
 *  Dashboard Numbers Wide's advance */
export function numbersTrack(advance: number | null, scale: number): number {
  return advance && advance > 0 && scale > 0 ? (NUMBERS_ADVANCE - advance * scale) / scale : 0;
}

/** The cap height (em) of the font a CSS font stack draws with in this browser (a canvas resolves the stack as CSS
 *  does), or null */
function measured(stack: string, glyph: string): { readonly height: number; readonly advance: number; readonly left: number; readonly right: number } | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || stack === "") return null;
  ctx.font = `100px ${stack}`;
  ctx.textAlign = "left";
  const metrics = ctx.measureText(glyph);
  return metrics.actualBoundingBoxAscent > 0
    ? { height: metrics.actualBoundingBoxAscent / 100, advance: metrics.width / 100, left: -metrics.actualBoundingBoxLeft / 100, right: metrics.actualBoundingBoxRight / 100 }
    : null;
}

/** Loads the HUD's fonts (they load when first drawn otherwise: measured before that, the fallback's would be taken),
 *  then fits them */
export async function loadHudFonts(root: HTMLElement = document.documentElement): Promise<void> {
  const stack = (name: string): string => getComputedStyle(root).getPropertyValue(`--hud-${name}`).trim();
  await Promise.all(["header", "thin", "numbers"].map((name) => document.fonts.load(`100px ${stack(name)}`, "0123456789:+HB").catch(() => [])));
  fitHudFonts(root);
}

/** Sets the fonts' scales on the page (once the stack's fonts are in) */
export function fitHudFonts(root: HTMLElement = document.documentElement): void {
  const stack = (name: string): string => getComputedStyle(root).getPropertyValue(`--hud-${name}`).trim();
  for (const name of ["header", "thin"]) {
    const cap = measured(stack(name), "H")?.height ?? null;
    root.style.setProperty(`--hud-${name}-scale`, capScale(cap).toFixed(4));
    // (the drawn font's own cap height, em: what the red dot centres on, HUD-12)
    if (cap) root.style.setProperty(`--hud-${name}-cap`, cap.toFixed(4));
  }
  const zero = measured(stack("numbers"), "0");
  const scale = capScale(zero?.height ?? null, NUMBERS_DIGIT_HEIGHT);
  root.style.setProperty("--hud-numbers-scale", scale.toFixed(4));
  root.style.setProperty("--hud-numbers-track", numbersTrack(zero?.advance ?? null, scale).toFixed(4));
  for (const [c, game] of Object.entries(NUMBERS_INK)) {
    const ink = measured(stack("numbers"), c);
    const key = glyphKey(c);
    if (!key) continue;
    const fit = ink ? inkFit(game, ink, scale) : { scale: 1, shift: 0 };
    root.style.setProperty(`--num-s-${key}`, fit.scale.toFixed(4));
    root.style.setProperty(`--num-x-${key}`, fit.shift.toFixed(4));
  }
}
