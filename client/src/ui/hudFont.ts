// The HUD's fonts (notes/hud-menus.md): the game draws $HeaderFont and $HeaderThinFont in Bourgeois Medium and Thin,
// its numbers ($NumbersWideFont) in Dashboard Numbers Wide, which we don't ship. The local substitutes (Bahnschrift
// SemiCondensed, Arial Narrow, ...; Bahnschrift, ...) have taller capitals and digits at the same size, so every size is
// scaled by the game font's cap (digit) height over the substitute's, measured here on the font the browser actually
// draws the stack with: the CSS variables --hud-header-scale, --hud-thin-scale and --hud-numbers-scale; and the digits'
// advance matched with letter-spacing, --hud-numbers-track (em of the scaled size).

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
function measured(stack: string, glyph: string): { readonly height: number; readonly advance: number } | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || stack === "") return null;
  ctx.font = `100px ${stack}`;
  const metrics = ctx.measureText(glyph);
  return metrics.actualBoundingBoxAscent > 0 ? { height: metrics.actualBoundingBoxAscent / 100, advance: metrics.width / 100 } : null;
}

/** Sets the fonts' scales on the page (once the stack's fonts are in) */
export function fitHudFonts(root: HTMLElement = document.documentElement): void {
  const stack = (name: string): string => getComputedStyle(root).getPropertyValue(`--hud-${name}`).trim();
  for (const name of ["header", "thin"]) root.style.setProperty(`--hud-${name}-scale`, capScale(measured(stack(name), "H")?.height ?? null).toFixed(4));
  const zero = measured(stack("numbers"), "0");
  const scale = capScale(zero?.height ?? null, NUMBERS_DIGIT_HEIGHT);
  root.style.setProperty("--hud-numbers-scale", scale.toFixed(4));
  root.style.setProperty("--hud-numbers-track", numbersTrack(zero?.advance ?? null, scale).toFixed(4));
}
