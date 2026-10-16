// The boost meter's art (notes/hud-menus.md HUD-18), drawn fresh from the static session's measures of the game's: a
// dark disc with a wide soft edge; the tint's soft glow; a thin grey guide ring along the 225 degree sweep with six
// ticks and their nodes; 36 orange bars on a 5 degree pitch, thin to thick toward 80 %, deep orange to light along the
// sweep, with a soft halo; 9 white bars for 80-100 %; the ring and ticks lit cream where it's filled. Geometry in the
// meter's 200 x 200 box (centre (100, 100)); angles along the sweep, 0 at 6 o'clock, clockwise. The bars, ring and
// number are on a layer 20 px nearer than the disc (the movie's z -20).
//
// Its tilt (HUD-5: the meter turned in perspective) is drawn here, every point projected, not by a CSS 3D transform: a
// 3D layer is rastered once and resampled into its tilt, soft at any pixel ratio (the user's finding, 2026-10-16); flat
// vectors and text under a 2D matrix are drawn sharp. The number and label keep their HTML, each under the 2D matrix
// the tilt is at its middle.
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

/** The meter's tilt (HUD-5: HUD.updatePerspectiveProjection's focal length 500, its centre 50 left of and 100 above the
 *  meter's, so (50, 0) in its box; the meter turned rotateY(-15deg) rotateX(-2deg) about its centre) and how much nearer
 *  the bars' layer is than the disc's */
export const TILT = { perspective: 500, origin: [50, 0] as const, rotateY: -15, rotateX: -2, front: 20 } as const;

/** Where a point of the meter's box (x, y) on a layer `z` nearer than the disc's shows in the box: as CSS draws
 *  perspective(500) about (50, 0) of rotateY(-15deg) rotateX(-2deg) about the centre (rotateX first) */
export function project(x: number, y: number, z = 0): readonly [number, number] {
  const ay = (TILT.rotateY * Math.PI) / 180;
  const ax = (TILT.rotateX * Math.PI) / 180;
  const [x0, y0] = [x - C, y - C];
  const [y1, z1] = [y0 * Math.cos(ax) - z * Math.sin(ax), y0 * Math.sin(ax) + z * Math.cos(ax)];
  const [x2, z2] = [x0 * Math.cos(ay) + z1 * Math.sin(ay), -x0 * Math.sin(ay) + z1 * Math.cos(ay)];
  const k = TILT.perspective / (TILT.perspective - z2);
  const [ox, oy] = TILT.origin;
  return [ox + (x2 + C - ox) * k, oy + (y1 + C - oy) * k];
}

/** The tilt about a point (x, y) of a layer `z` as a 2D matrix: [a, b, c, d, e, f] (CSS matrix() and SVG's), mapping
 *  points near it as `project` does (exactly at it) */
export function tiltAt(x: number, y: number, z = 0): readonly [number, number, number, number, number, number] {
  const h = 0.5;
  const [px0, py0] = project(x - h, y, z);
  const [px1, py1] = project(x + h, y, z);
  const [qx0, qy0] = project(x, y - h, z);
  const [qx1, qy1] = project(x, y + h, z);
  const [a, b, c, d] = [(px1 - px0) / (2 * h), (py1 - py0) / (2 * h), (qx1 - qx0) / (2 * h), (qy1 - qy0) / (2 * h)];
  const [X, Y] = project(x, y, z);
  return [a, b, c, d, X - (a * x + c * y), Y - (b * x + d * y)];
}

/** A path through these meter points (on layer z), projected; closed if asked */
function projected(points: readonly (readonly [number, number])[], z: number, close: boolean): string {
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${project(x, y, z).map((v) => v.toFixed(2)).join(" ")}`).join(" ");
  return close ? `${d} Z` : d;
}

/** Points along the sweep at radius r from a0 to a1 (degrees), every `step` at most, both ends */
function along(r: number, a0: number, a1: number, step = 1.5): (readonly [number, number])[] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
  return Array.from({ length: n + 1 }, (_, i) => polar(r, a0 + ((a1 - a0) * i) / n));
}

/** barPath's shape, projected on layer z */
function tiltedBar(a0: number, a1: number, r0: number, r1: number, r1b: number, z: number): string {
  return projected([polar(r0, a0), polar(r1, a0), polar(r1b, a1), ...along(r0, a1, a0, 1)], z, true);
}

/** wedgePath's shape, projected on layer z */
function tiltedWedge(a: number, z: number): string {
  if (a <= 0) return "M 0 0 Z";
  return projected([[C, C], ...along(110, 0, Math.min(SWEEP, a), 2)], z, true);
}

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
  // (centred on the meter, under the tilt at its centre on the disc's layer: the soft disc's and glow's keystone too
  // small to see)
  const g = svg("radialGradient", { id, gradientUnits: "userSpaceOnUse", cx: "100", cy: "100", r: "100", gradientTransform: `matrix(${tiltAt(C, C, 0).map((v) => v.toFixed(5)).join(" ")})` }, defs);
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
  readonly #box: HTMLElement;
  /** The number and label, each turned with the bars' layer about its middle (their boxes read then) */
  readonly #text: readonly HTMLElement[];
  /** The fill's angles drawn: a frame with the same draws nothing (RV-469) */
  #fillDrawn = Number.NaN;
  #topDrawn = Number.NaN;

  /** `box`: the meter's box (#boost); `text`: its number and label in it, each turned with the bars' layer where it is */
  constructor(box: HTMLElement, text: readonly HTMLElement[] = []) {
    const id = `boost${String(meters++)}`;
    const Z = TILT.front;
    this.#box = box;
    this.#text = text;
    // (turned once laid out and again whenever the meter or their boxes change size, the fonts loaded, the HUD's scale or
    // the window's changed: never every frame, nothing read while hidden, RV-469)
    if (text.length > 0) {
      const observer = new ResizeObserver(() => { this.#turnText(); });
      for (const el of [box, ...text]) observer.observe(el);
    }
    const art = svg("svg", { viewBox: "0 0 200 200", "aria-hidden": "true", class: "boost-art" });
    box.prepend(art);
    const backSvg = art;
    const frontSvg = art;
    const defs = svg("defs", {}, art);
    const backDefs = defs;

    // The disc: black at 0.75 to r 56, then the soft edge to nothing by r 92
    radial(backDefs, `${id}-disc`, [[0, "#000", 0.75], [0.56, "#000", 0.75], [0.66, "#000", 0.68], [0.78, "#000", 0.45], [0.84, "#000", 0.22], [0.88, "#000", 0.07], [0.92, "#000", 0]]);
    svg("path", { d: projected(along(92, 0, 360, 5), 0, true), fill: `url(#${id}-disc)` }, backSvg);
    // The glow: the tint's soft blob (its colour and clip alpha from the CSS: team, plain, max), grown from its centre
    radial(backDefs, `${id}-glow`, [[0, "", 1], [0.48, "", 0.5], [0.59, "", 0.25], [0.7, "", 0.09], [0.76, "", 0]], "boost-glow-stop");
    this.#glow = svg("g", { class: "boost-glow" }, backSvg);
    const [gx, gy] = project(C, C, 0);
    this.#glow.style.transformOrigin = `${gx.toFixed(2)}px ${gy.toFixed(2)}px`;
    svg("path", { d: projected(along(76, 0, 360, 5), 0, true), fill: `url(#${id}-glow)` }, this.#glow);

    // The masks: the fill's wedge (0-80 %), the white part's (to 100 %), both together for the lit ring
    const mask = (name: string): SVGPathElement => {
      const m = svg("mask", { id: `${id}-${name}`, maskUnits: "userSpaceOnUse", x: "-50", y: "-50", width: "300", height: "300" }, defs);
      return svg("path", { d: tiltedWedge(0, Z), fill: "#fff" }, m);
    };
    this.#fill = mask("fill");
    this.#top = mask("top");
    this.#lit = mask("lit");

    // The guide ring and its ticks (grey), then the same lit cream where filled
    const guide = (className: string, parent: Element): void => {
      svg("path", { d: projected(along(RING, 0, SWEEP), Z, false), class: `${className} boost-ring` }, parent);
      for (const t of TICKS) {
        svg("path", { d: projected([polar(t.from, t.a), polar(t.to, t.a)], Z, false), class: `${className} boost-tick` }, parent);
        const [x, y] = project(...polar(RING, t.a), Z);
        svg("circle", { cx: x.toFixed(3), cy: y.toFixed(3), r: "1.5", class: `${className} boost-node` }, parent);
      }
    };
    guide("boost-guide", frontSvg);
    // (a dark line between the bars and the ring)
    svg("path", { d: projected(along(63.5, 0, SWEEP), Z, false), class: "boost-seam" }, frontSvg);

    // The orange bars (0-80 %): each its colour along the ramp, a soft halo outside, masked to the fill
    const orange = svg("g", { mask: `url(#${id}-fill)` }, frontSvg);
    const flashOrange: string[] = [];
    for (let i = 0; i < WHITE_FROM / PITCH; i++) {
      const a0 = i * PITCH;
      const a1 = a0 + ORANGE_BAR;
      const r0 = orangeOuter(a0);
      const r1 = orangeOuter(a1);
      const outer = (r0 + r1) / 2;
      // (its halo across the bar's end, outward: as the radial one it was, along the bar's middle)
      const [hx0, hy0] = project(...polar(outer - 0.5, (a0 + a1) / 2), Z);
      const [hx1, hy1] = project(...polar(outer + 5.5, (a0 + a1) / 2), Z);
      const halo = svg("linearGradient", { id: `${id}-halo${String(i)}`, gradientUnits: "userSpaceOnUse", x1: hx0.toFixed(2), y1: hy0.toFixed(2), x2: hx1.toFixed(2), y2: hy1.toFixed(2) }, defs);
      for (const [offset, alpha] of [[0, 0.25], [5.5 / 6, 0.08], [1, 0]] as const) svg("stop", { offset: offset.toFixed(4), "stop-color": "rgb(255,126,0)", "stop-opacity": String(alpha) }, halo);
      svg("path", { d: tiltedBar(a0, a1, outer - 0.5, r0 + 5.5, r1 + 5.5, Z), fill: `url(#${id}-halo${String(i)})` }, orange);
      const [r, g, b] = orangeColor((a0 + a1) / 2);
      const d = tiltedBar(a0, a1, INNER, r0, r1, Z);
      svg("path", { d, fill: `rgb(${String(r)},${String(g)},${String(b)})` }, orange);
      flashOrange.push(d);
    }
    // The white bars (80-100 %): full thickness, a thin dark line between them and a faint dark edge; recoloured by the
    // CSS (HUD-7), masked to the top part
    const white = svg("g", { mask: `url(#${id}-top)` }, frontSvg);
    const flashWhite: string[] = [];
    for (let i = 0; i < (SWEEP - WHITE_FROM) / PITCH; i++) {
      const a0 = WHITE_FROM + i * PITCH;
      const d = tiltedBar(a0, a0 + PITCH, INNER, 88, 88, Z);
      svg("path", { d, class: "boost-white" }, white);
      flashWhite.push(d);
      if (i > 0) svg("path", { d: projected([polar(INNER, a0), polar(88, a0)], Z, false), class: "boost-white-seam" }, white);
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

  /** The number and label: each under the tilt at its middle on the bars' layer, about that middle (CSS's origin); the
   *  meter laid out (a transform doesn't change the boxes read) */
  #turnText(): void {
    if (this.#box.offsetWidth === 0) return;
    for (const el of this.#text) {
      const [x, y] = [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2];
      const [a, b, c, d] = tiltAt(x, y, TILT.front);
      const [X, Y] = project(x, y, TILT.front);
      el.style.transform = `matrix(${[a, b, c, d, X - x, Y - y].map((v) => v.toFixed(5)).join(", ")})`;
    }
  }

  /** The fill's angles: the orange part (0-180) and the white (0-45) */
  set(fill: number, top: number): void {
    if (fill === this.#fillDrawn && top === this.#topDrawn) return;
    this.#fillDrawn = fill;
    this.#topDrawn = top;
    this.#fill.setAttribute("d", tiltedWedge(fill, TILT.front));
    this.#top.setAttribute("d", top > 0 ? tiltedWedge(WHITE_FROM + top, TILT.front) : tiltedWedge(0, TILT.front));
    this.#lit.setAttribute("d", tiltedWedge(fill + top, TILT.front));
  }

  /** A pickup: both bars flash white and ease back over 0.8 s, the glow from twice its size */
  flash(): void {
    const ease = { duration: 800, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
    this.#flash.animate([{ opacity: 1 }, { opacity: 0 }], ease);
    this.#glow.animate([{ transform: "scale(2)" }, { transform: "scale(1)" }], ease);
  }
}
