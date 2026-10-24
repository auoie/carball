// The boost meter as a visor ring (ours: the user's design, 2026-10-24, after their reference HUD; in place of the fuel
// gauge; nothing of the game's meter): a glass disc with a faint rim, the ring's track between two thin outlines, and the
// filled arc in a pale gradient with a soft glow, all the way round (full at 100, empty at 0), running clockwise from 12
// o'clock so it empties back toward the top; the number inside it. Nothing else: no ticks, label or cues. Flat SVG in the
// meter's 200 x 200 box (the HUD's stage scales it); its colours style.css's (--hud-ice and the rest).
const NS = "http://www.w3.org/2000/svg";

/** The ring in the meter's box (uu of its 200): the glass disc's radius, the track's and the fill's (their strokes'
 *  middle) and widths, the outlines' radii */
export const RING = { disc: 92, radius: 73, track: 18, fill: 14.5, outlines: [82, 64] } as const;

/** The ring's filled share (0-1) for a boost of 0-100 */
export function ringFill(boost: number): number {
  return Math.min(100, Math.max(0, boost)) / 100;
}

/** The fill's dash for a boost of 0-100, along the circle's length taken as 100 from 3 o'clock clockwise, shifted a
 *  quarter (its offset, 25) to start at 12 o'clock: the filled length then the rest; full, none (the whole circle, no seam
 *  where the dash's ends would meet) */
export function ringDash(boost: number): string {
  const filled = ringFill(boost) * 100;
  return filled >= 100 ? "none" : `${filled.toFixed(2)} ${(100 - filled).toFixed(2)}`;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.append(el);
  return el;
}

let rings = 0;

export class BoostRing {
  readonly #fill: SVGCircleElement;
  #drawn = "";

  /** `box`: the meter's box (#boost), its number already in it */
  constructor(box: HTMLElement) {
    const id = `ring${String(rings++)}`;
    const art = svg("svg", { viewBox: "0 0 200 200", "aria-hidden": "true", class: "ring-art" });
    const defs = svg("defs", {}, art);
    // (the glass: lighter a little above the middle; the fill's gradient top to bottom)
    const glass = svg("radialGradient", { id: `${id}-glass`, cx: "50%", cy: "45%", r: "55%" }, defs);
    svg("stop", { offset: "0", class: "ring-glass-in" }, glass);
    svg("stop", { offset: "1", class: "ring-glass-out" }, glass);
    const fill = svg("linearGradient", { id: `${id}-fill`, x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    svg("stop", { offset: "0", class: "ring-fill-top" }, fill);
    svg("stop", { offset: "1", class: "ring-fill-bottom" }, fill);
    const at = (r: number): Record<string, string> => ({ cx: "100", cy: "100", r: String(r) });
    svg("circle", { ...at(RING.disc), fill: `url(#${id}-glass)`, class: "ring-disc" }, art);
    svg("circle", { ...at(RING.radius), "stroke-width": String(RING.track), class: "ring-track" }, art);
    for (const r of RING.outlines) svg("circle", { ...at(r), class: "ring-outline" }, art);
    this.#fill = svg(
      "circle",
      { ...at(RING.radius), "stroke-width": String(RING.fill), stroke: `url(#${id}-fill)`, pathLength: "100", "stroke-dashoffset": "25", class: "ring-fill" },
      art,
    );
    box.prepend(art);
    this.set(0);
  }

  /** The ring at `boost` (0-100: the meter's shown value as it tweens, so it fills and empties smoothly) */
  set(boost: number): void {
    const dash = ringDash(boost);
    if (dash === this.#drawn) return;
    this.#drawn = dash;
    this.#fill.setAttribute("stroke-dasharray", dash);
  }
}
