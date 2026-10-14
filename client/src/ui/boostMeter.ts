// The boost meter's art (notes/hud-menus.md HUD-18), drawn fresh from the static session's measures of the game's: a
// dark disc with a wide soft edge; the tint's soft glow; a thin grey guide ring along the 225 degree sweep with six
// ticks and their nodes; 36 orange bars on a 5 degree pitch, thin to thick toward 80 %, deep orange to light along the
// sweep, with a soft halo; 9 white bars for 80-100 %; the ring and ticks lit cream where it's filled. Geometry in the
// meter's 200 x 200 box (centre (100, 100)); angles along the sweep, 0 at 6 o'clock, clockwise. The bars and ring are on
// a layer 20 px nearer than the disc (the movie's z -20).
const NS = "http://www.w3.org/2000/svg";
const C = 100;

/** The sweep (degrees) and where the white part starts (80 %: HUD-6's 2.25 degrees a point) */
export const SWEEP = 225;
export const WHITE_FROM = 180;
const PITCH = 5;
const ORANGE_BAR = 3.3;
const INNER = 65;
const RING = 61.5;

/** A point at radius r and sweep angle a (degrees) */
export function polar(r: number, a: number): readonly [number, number] {
  const t = (a * Math.PI) / 180;
  return [C - r * Math.sin(t), C + r * Math.cos(t)];
}

const pt = (r: number, a: number): string => polar(r, a).map((v) => v.toFixed(3)).join(" ");

/** The orange bar's outer edge at angle a: 69 at 0 % to 87 at 80 %, linear in angle */
export function orangeOuter(a: number): number {
  return 69 + (18 * Math.min(WHITE_FROM, Math.max(0, a))) / WHITE_FROM;
}

/** The orange bars' colour at angle a: (255, 130, 5) at the start, (255, 174, 49) at 40 %, (255, 212, 86) at 80 % */
export function orangeColor(a: number): readonly [number, number, number] {
  const mix = (p: readonly number[], q: readonly number[], t: number): [number, number, number] => [
    Math.round((p[0] ?? 0) + ((q[0] ?? 0) - (p[0] ?? 0)) * t),
    Math.round((p[1] ?? 0) + ((q[1] ?? 0) - (p[1] ?? 0)) * t),
    Math.round((p[2] ?? 0) + ((q[2] ?? 0) - (p[2] ?? 0)) * t),
  ];
  const start = [255, 130, 5];
  const middle = [255, 174, 49];
  const end = [255, 212, 86];
  const half = WHITE_FROM / 2;
  return a <= half ? mix(start, middle, Math.max(0, a) / half) : mix(middle, end, Math.min(1, (a - half) / half));
}

/** The six ticks (0/20/40/60/80/100 %): their angle and radial extent (the ring out to the bar's outer edge there) */
export const TICKS: readonly { readonly a: number; readonly from: number; readonly to: number }[] = [
  { a: 0, from: 62, to: 68 },
  { a: 45, from: 62, to: 72 },
  { a: 90, from: 63, to: 79 },
  { a: 135, from: 64, to: 82 },
  { a: 180, from: 63, to: 89 },
  { a: 225, from: 62, to: 89 },
];

/** A ring segment (an annulus' piece) from angle a0 to a1, inner radius r0, outer r1 at a0 and r1b at a1 */
export function barPath(a0: number, a1: number, r0: number, r1: number, r1b = r1): string {
  return `M ${pt(r0, a0)} L ${pt(r1, a0)} L ${pt(r1b, a1)} L ${pt(r0, a1)} A ${String(r0)} ${String(r0)} 0 0 0 ${pt(r0, a0)} Z`;
}

/** An arc along the sweep from a0 to a1 at radius r */
function arcPath(r: number, a0: number, a1: number): string {
  return `M ${pt(r, a0)} A ${String(r)} ${String(r)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(r, a1)}`;
}

/** The fill's mask: a wedge from the sweep's start to angle a (empty at 0) */
export function wedgePath(a: number): string {
  if (a <= 0) return "M 100 100 Z";
  const end = Math.min(SWEEP, a);
  return `M 100 100 L ${pt(110, 0)} A 110 110 0 ${end > 180 ? 1 : 0} 1 ${pt(110, end)} Z`;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.appendChild(el);
  return el;
}

function radial(defs: SVGDefsElement, id: string, stops: readonly (readonly [number, string, number])[], className = ""): void {
  const g = svg("radialGradient", { id, gradientUnits: "userSpaceOnUse", cx: "100", cy: "100", r: "100" }, defs);
  for (const [offset, color, alpha] of stops) {
    const stop = svg("stop", { offset: offset.toFixed(4), "stop-opacity": String(alpha) }, g);
    if (className) stop.setAttribute("class", className);
    else stop.setAttribute("stop-color", color);
  }
}

let meters = 0;

export class BoostMeterArt {
  readonly #fill: SVGPathElement;
  readonly #top: SVGPathElement;
  readonly #lit: SVGPathElement;
  readonly #glow: SVGGElement;
  readonly #flash: SVGGElement;

  /** `back`: the disc's layer, `front`: the bars' (nearer) */
  constructor(back: HTMLElement, front: HTMLElement) {
    const id = `boost${String(meters++)}`;
    const backSvg = svg("svg", { viewBox: "0 0 200 200", "aria-hidden": "true", class: "boost-art" });
    const frontSvg = svg("svg", { viewBox: "0 0 200 200", "aria-hidden": "true", class: "boost-art" });
    back.prepend(backSvg);
    front.prepend(frontSvg);
    const backDefs = svg("defs", {}, backSvg);
    const defs = svg("defs", {}, frontSvg);

    // The disc: black at 0.75 to r 56, then the soft edge to nothing by r 92
    radial(backDefs, `${id}-disc`, [[0, "#000", 0.75], [0.56, "#000", 0.75], [0.66, "#000", 0.68], [0.78, "#000", 0.45], [0.84, "#000", 0.22], [0.88, "#000", 0.07], [0.92, "#000", 0]]);
    svg("circle", { cx: "100", cy: "100", r: "92", fill: `url(#${id}-disc)` }, backSvg);
    // The glow: the tint's soft blob (its colour and clip alpha from the CSS: team, plain, max)
    radial(backDefs, `${id}-glow`, [[0, "", 1], [0.48, "", 0.5], [0.59, "", 0.25], [0.7, "", 0.09], [0.76, "", 0]], "boost-glow-stop");
    this.#glow = svg("g", { class: "boost-glow" }, backSvg);
    svg("circle", { cx: "100", cy: "100", r: "76", fill: `url(#${id}-glow)` }, this.#glow);

    // The masks: the fill's wedge (0-80 %), the white part's (to 100 %), both together for the lit ring
    const mask = (name: string): SVGPathElement => {
      const m = svg("mask", { id: `${id}-${name}`, maskUnits: "userSpaceOnUse", x: "0", y: "0", width: "200", height: "200" }, defs);
      return svg("path", { d: wedgePath(0), fill: "#fff" }, m);
    };
    this.#fill = mask("fill");
    this.#top = mask("top");
    this.#lit = mask("lit");

    // The guide ring and its ticks (grey), then the same lit cream where filled
    const guide = (className: string, parent: Element): void => {
      svg("path", { d: arcPath(RING, 0, SWEEP), class: `${className} boost-ring` }, parent);
      for (const t of TICKS) {
        svg("path", { d: `M ${pt(t.from, t.a)} L ${pt(t.to, t.a)}`, class: `${className} boost-tick` }, parent);
        const [x, y] = polar(RING, t.a);
        svg("circle", { cx: x.toFixed(3), cy: y.toFixed(3), r: "1.5", class: `${className} boost-node` }, parent);
      }
    };
    guide("boost-guide", frontSvg);
    // (a dark line between the bars and the ring)
    svg("path", { d: arcPath(63.5, 0, SWEEP), class: "boost-seam" }, frontSvg);

    // The orange bars (0-80 %): each its colour along the ramp, a soft halo outside, masked to the fill
    const orange = svg("g", { mask: `url(#${id}-fill)` }, frontSvg);
    const flashOrange: string[] = [];
    for (let i = 0; i < WHITE_FROM / PITCH; i++) {
      const a0 = i * PITCH;
      const a1 = a0 + ORANGE_BAR;
      const r0 = orangeOuter(a0);
      const r1 = orangeOuter(a1);
      const outer = (r0 + r1) / 2;
      radial(defs, `${id}-halo${String(i)}`, [[(outer - 0.5) / 100, "rgb(255,126,0)", 0.25], [(outer + 5) / 100, "rgb(255,126,0)", 0.08], [(outer + 5.5) / 100, "rgb(255,126,0)", 0]]);
      svg("path", { d: barPath(a0, a1, outer - 0.5, r0 + 5.5, r1 + 5.5), fill: `url(#${id}-halo${String(i)})` }, orange);
      const [r, g, b] = orangeColor((a0 + a1) / 2);
      const d = barPath(a0, a1, INNER, r0, r1);
      svg("path", { d, fill: `rgb(${String(r)},${String(g)},${String(b)})` }, orange);
      flashOrange.push(d);
    }
    // The white bars (80-100 %): full thickness, a thin dark line between them and a faint dark edge; recoloured by the
    // CSS (HUD-7), masked to the top part
    const white = svg("g", { mask: `url(#${id}-top)` }, frontSvg);
    const flashWhite: string[] = [];
    for (let i = 0; i < (SWEEP - WHITE_FROM) / PITCH; i++) {
      const a0 = WHITE_FROM + i * PITCH;
      const d = barPath(a0, a0 + PITCH, INNER, 88);
      svg("path", { d, class: "boost-white" }, white);
      flashWhite.push(d);
      if (i > 0) svg("path", { d: `M ${pt(INNER, a0)} L ${pt(88, a0)}`, class: "boost-white-seam" }, white);
    }
    // The lit ring and ticks
    const lit = svg("g", { mask: `url(#${id}-lit)` }, frontSvg);
    guide("boost-lit", lit);
    // The pickup's flash: both bars white, fading back (HUD-6)
    this.#flash = svg("g", { class: "boost-flash" }, frontSvg);
    const flashFill = svg("g", { mask: `url(#${id}-fill)` }, this.#flash);
    for (const d of flashOrange) svg("path", { d, fill: "#fff" }, flashFill);
    const flashTop = svg("g", { mask: `url(#${id}-top)` }, this.#flash);
    for (const d of flashWhite) svg("path", { d, fill: "#fff" }, flashTop);
  }

  /** The fill's angles: the orange part (0-180) and the white (0-45) */
  set(fill: number, top: number): void {
    this.#fill.setAttribute("d", wedgePath(fill));
    this.#top.setAttribute("d", top > 0 ? wedgePath(WHITE_FROM + top) : wedgePath(0));
    this.#lit.setAttribute("d", wedgePath(fill + top));
  }

  /** A pickup: both bars flash white and ease back over 0.8 s, the glow from twice its size */
  flash(): void {
    const ease = { duration: 800, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
    this.#flash.animate([{ opacity: 1 }, { opacity: 0 }], ease);
    this.#glow.animate([{ transform: "scale(2)" }, { transform: "scale(1)" }], ease);
  }
}
