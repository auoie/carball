// The scoreboard at the top centre (notes/hud-menus.md HUD-2, 2a, 4): seen in perspective (focal 100 at (0, 80) from its
// origin, the stage's (W/2, 0)), tilted 5 degrees back about its origin, the score views turned 10 degrees about their
// inner edges, the clock's box 1 px nearer; dropping and turning in as it first shows.
//
// Drawn here already projected (not by CSS 3D transforms): a 3D layer is rastered
// once and resampled into its tilt, soft at any pixel ratio (the user's finding, 2026-10-16); flat vectors and text under
// a 2D matrix are drawn sharp. The boxes are an SVG of projected points (perspective keeps lines straight: only the rounded
// corners are sampled); their gradients and the scorer's glow lie under the tilt at the box's middle; the digits, the
// clock and OVERTIME keep their HTML, each under the 2D matrix the tilt is at its middle.
const NS = "http://www.w3.org/2000/svg";

/** The board's pose: the drop (px), the tilt about x (degrees, CSS rotateX), the views' turn (degrees: the right one's
 *  rotateY, the left one's its negative), the opacity */
export interface ScorebugPose {
  readonly drop: number;
  readonly tilt: number;
  readonly turn: number;
  readonly opacity: number;
}

export const SCOREBUG_REST: ScorebugPose = { drop: 0, tilt: -5, turn: 10, opacity: 1 };

/** The perspective (HUD-2: focal length 100, its centre 80 below the board's origin) */
const FOCAL = 100;
const ORIGIN_Y = 80;

/** The score views' boxes (HUD-2a: 67.5 x 56.2 from y -0.1, the outer corners rounded 5; the left one's at x -134.5
 *  turned about its inner edge, x 67.5 of its box; the right one's at 67 about its inner edge, x 0) */
export const VIEW_BOX = {
  width: 67.5,
  height: 56.2,
  top: -0.1,
  radius: 5,
  left: { x: -134.5, pivot: 67.5 },
  right: { x: 67, pivot: 0 },
} as const;

/** The clock's black box (HUD-2a: 135 x 56.2 at (-67.5, -1.1), square, hard edges, a notch at the bottom centre 44 px
 *  wide and 2 deep, its ends 45 degrees; 1 px nearer than the views) */
export const CLOCK_BOX = { x: -67.5, y: -1.1, width: 135, height: 56.2, z: 1 } as const;

export type Side = "left" | "right";

/** A place on the board: a score view's box (by its side) or the clock's */
export type ScoreFrame = Side | "clock";

type P3 = readonly [number, number, number];
type P2 = readonly [number, number];
export type Matrix2D = readonly [number, number, number, number, number, number];

const RAD = Math.PI / 180;

/** A point of the tilt's frame (the board's origin, z toward the viewer) where it shows from the board's origin: tilted
 *  about x, dropped, seen in perspective (CSS: perspective(100) about (0, 80) of translateY(drop) rotateX(tilt)) */
export function projectBoard([x, y, z]: P3, pose: ScorebugPose): P2 {
  const t = pose.tilt * RAD;
  const y1 = y * Math.cos(t) - z * Math.sin(t);
  const z1 = y * Math.sin(t) + z * Math.cos(t);
  const k = FOCAL / (FOCAL - z1);
  return [x * k, ORIGIN_Y + (y1 + pose.drop - ORIGIN_Y) * k];
}

/** A point (x, y) of a frame's box in the tilt's frame (a view turned about its inner edge: CSS rotateY) */
export function framePoint(frame: ScoreFrame, x: number, y: number, pose: ScorebugPose): P3 {
  if (frame === "clock") return [CLOCK_BOX.x + x, CLOCK_BOX.y + y, CLOCK_BOX.z];
  const box = VIEW_BOX[frame];
  const a = (frame === "left" ? -pose.turn : pose.turn) * RAD;
  const dx = x - box.pivot;
  return [box.x + box.pivot + dx * Math.cos(a), VIEW_BOX.top + y, -dx * Math.sin(a)];
}

/** Where a point of a frame's box shows from the board's origin */
export function project(frame: ScoreFrame, x: number, y: number, pose: ScorebugPose): P2 {
  return projectBoard(framePoint(frame, x, y, pose), pose);
}

/** Where a point of a frame's box is laid out flat (the HTML's place, before its matrix) */
function laidOut(frame: ScoreFrame, x: number, y: number): P2 {
  return frame === "clock" ? [CLOCK_BOX.x + x, CLOCK_BOX.y + y] : [VIEW_BOX[frame].x + x, VIEW_BOX.top + y];
}

/** The projection about a point (x, y) of a frame's box as a 2D matrix from the box's coordinates to the board's: exact
 *  at the point, its derivative there */
export function tiltAt(frame: ScoreFrame, x: number, y: number, pose: ScorebugPose): Matrix2D {
  const h = 0.5;
  const [px0, py0] = project(frame, x - h, y, pose);
  const [px1, py1] = project(frame, x + h, y, pose);
  const [qx0, qy0] = project(frame, x, y - h, pose);
  const [qx1, qy1] = project(frame, x, y + h, pose);
  const [a, b, c, d] = [(px1 - px0) / (2 * h), (py1 - py0) / (2 * h), (qx1 - qx0) / (2 * h), (qy1 - qy0) / (2 * h)];
  const [X, Y] = project(frame, x, y, pose);
  return [a, b, c, d, X - (a * x + c * y), Y - (b * x + d * y)];
}

/** The CSS matrix for an element whose middle is (x, y) of its frame's box, about that middle (CSS's default origin):
 *  the tilt there, moved from where it's laid out to where it shows */
export function textMatrix(frame: ScoreFrame, x: number, y: number, pose: ScorebugPose): Matrix2D {
  const [a, b, c, d] = tiltAt(frame, x, y, pose);
  const [X, Y] = project(frame, x, y, pose);
  const [lx, ly] = laidOut(frame, x, y);
  return [a, b, c, d, X - lx, Y - ly];
}

/** A score view's outline in its box: the outer corners rounded (a quarter circle each, every `step` degrees) */
export function viewOutline(side: Side, step = 10): P2[] {
  const { width: w, height: h, radius: r } = VIEW_BOX;
  const arc = (cx: number, cy: number, from: number): P2[] =>
    Array.from({ length: 90 / step + 1 }, (_, i) => {
      const a = (from + i * step) * RAD;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
    });
  // (clockwise from the top left, y down)
  return side === "left" ? [...arc(r, h - r, 90), ...arc(r, r, 180), [w, 0], [w, h]] : [[0, 0], ...arc(w - r, r, 270), ...arc(w - r, h - r, 0), [0, h]];
}

/** The clock box's outline in its box */
export function clockOutline(): P2[] {
  const { width: w, height: h } = CLOCK_BOX;
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [89.5, h],
    [87.5, h - 2],
    [47.5, h - 2],
    [45.5, h],
    [0, h],
  ];
}

/** A closed path through these points of a frame's box, projected */
export function projectedPath(frame: ScoreFrame, points: readonly P2[], pose: ScorebugPose): string {
  return `${points
    .map(
      ([x, y], i) =>
        `${i === 0 ? "M" : "L"} ${project(frame, x, y, pose)
          .map((v) => v.toFixed(3))
          .join(" ")}`,
    )
    .join(" ")} Z`;
}

/** A CSS cubic-bezier timing function */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-7) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let [lo, hi] = [0, 1];
    t = x;
    for (let i = 0; i < 50 && hi - lo > 1e-9; i++) {
      if (sampleX(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** HUD-4's intro, 1 s after the board shows: down 20 over 1 s (Back.easeOut), tilting from 75 degrees and fading in over
 *  0.6 s (Strong.easeOut), the views turning from 60 degrees (Strong.easeIn) */
export const SCORE_INTRO = { delay: 1, drop: { from: -20, seconds: 1 }, tilt: { from: -75, seconds: 0.6 }, turn: { from: 60, seconds: 0.6 } } as const;
const DROP_EASE = cubicBezier(0.175, 0.885, 0.32, 1.275);
const TILT_EASE = cubicBezier(0.23, 1, 0.32, 1);
const TURN_EASE = cubicBezier(0.755, 0.05, 0.855, 0.06);

/** The intro's end (s after the board shows) */
export const SCORE_INTRO_END = SCORE_INTRO.delay + Math.max(SCORE_INTRO.drop.seconds, SCORE_INTRO.tilt.seconds, SCORE_INTRO.turn.seconds);

/** The pose `t` s after the board shows (its start held through the delay; at rest from the end) */
export function scoreIntroPose(t: number): ScorebugPose {
  const u = t - SCORE_INTRO.delay;
  const at = (seconds: number): number => Math.min(1, Math.max(0, u / seconds));
  const { drop, tilt, turn } = SCORE_INTRO;
  const r = SCOREBUG_REST;
  const tilted = TILT_EASE(at(tilt.seconds));
  return {
    drop: drop.from + (r.drop - drop.from) * DROP_EASE(at(drop.seconds)),
    tilt: tilt.from + (r.tilt - tilt.from) * tilted,
    turn: turn.from + (r.turn - turn.from) * TURN_EASE(at(turn.seconds)),
    opacity: tilted,
  };
}

/** The views' backgrounds (TeamScoreView_Background: (18, 19, 18) at 0.8 on its outer ~40 %, then a grey ramp to the
 *  inner edge (1, 10, 29, 48, 70 at 45, 55, 70, 80, 90 %), its alpha rising to 0.89; the team's tint added, HUD-2a), from
 *  the outer edge to the inner */
export const VIEW_GRADIENTS: readonly (readonly (readonly [number, string])[])[] = [
  [
    [0, "rgba(18, 64, 209, 0.800)"],
    [0.4, "rgba(18, 64, 209, 0.800)"],
    [0.45, "rgba(1, 46, 192, 0.800)"],
    [0.55, "rgba(10, 55, 201, 0.816)"],
    [0.7, "rgba(29, 74, 220, 0.841)"],
    [0.8, "rgba(48, 93, 239, 0.857)"],
    [0.9, "rgba(70, 115, 255, 0.874)"],
    [1, "rgba(70, 115, 255, 0.890)"],
  ],
  [
    [0, "rgba(196, 80, 18, 0.800)"],
    [0.4, "rgba(196, 80, 18, 0.800)"],
    [0.45, "rgba(179, 62, 1, 0.800)"],
    [0.55, "rgba(188, 71, 10, 0.816)"],
    [0.7, "rgba(207, 90, 29, 0.841)"],
    [0.8, "rgba(226, 109, 48, 0.857)"],
    [0.9, "rgba(248, 131, 70, 0.874)"],
    [1, "rgba(248, 131, 70, 0.890)"],
  ],
];

/** The art's box on the board (from its origin): round the board and its intro's drop and tilt (style.css .score-art) */
const ART_BOX = { x: -200, y: -60, width: 400, height: 200 } as const;

const matrixText = (m: Matrix2D): string => m.map((v) => v.toFixed(5)).join(" ");

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.append(el);
  return el;
}

let nextId = 0;

/** A team's view: its background, glow and their gradients */
interface TeamArt {
  readonly bg: SVGPathElement;
  readonly glow: SVGPathElement;
  readonly bgGradient: SVGLinearGradientElement;
  readonly glowGradient: SVGRadialGradientElement;
}

/** The text drawn under the board's tilt: each element in its frame's box (a team's digits in that team's view) */
export interface ScorebugText {
  readonly digits: readonly [HTMLElement, HTMLElement];
  readonly clock: readonly HTMLElement[];
}

/** The board's art (an SVG under its HTML in the tilt's frame) and its text's matrices */
export class ScorebugArt {
  readonly root: SVGSVGElement;
  readonly #teams: readonly [TeamArt, TeamArt];
  readonly #clockBox: SVGPathElement;
  readonly #text: ScorebugText;

  constructor(parent: HTMLElement, text: ScorebugText) {
    this.#text = text;
    const id = `scorebug${String(nextId++)}`;
    // (a box round the board and its intro: the style sheet's .score-art)
    const { x, y, width, height } = ART_BOX;
    this.root = svg(
      "svg",
      {
        class: "score-art",
        viewBox: `${String(x)} ${String(y)} ${String(width)} ${String(height)}`,
        width: String(width),
        height: String(height),
        "aria-hidden": "true",
      },
      parent,
    );
    parent.prepend(this.root);
    const defs = svg("defs", {}, this.root);
    const team = (t: 0 | 1): TeamArt => {
      const bgGradient = svg("linearGradient", { id: `${id}-bg${String(t)}`, gradientUnits: "userSpaceOnUse" }, defs);
      for (const [offset, color] of VIEW_GRADIENTS[t] ?? []) svg("stop", { offset: String(offset), "stop-color": color }, bgGradient);
      // (HUD-4's glow: white at 0.9, the team's tint at 0.6 at 60 %, gone by 75 % of the box's half diagonal; faded in
      // the tint's own colour, as CSS's premultiplied gradient)
      const glowGradient = svg("radialGradient", { id: `${id}-glow${String(t)}`, gradientUnits: "userSpaceOnUse" }, defs);
      svg("stop", { offset: "0", "stop-color": "#fff", "stop-opacity": "0.9" }, glowGradient);
      for (const [offset, opacity] of [
        ["0.6", "0.6"],
        ["0.75", "0"],
      ] as const) {
        const stop = svg("stop", { offset, "stop-opacity": opacity }, glowGradient);
        stop.style.setProperty("stop-color", `rgb(var(--tint-${String(t)}))`);
      }
      // (its glow screened over its background alone)
      const group = svg("g", { class: `score-art-view team-${String(t)}` }, this.root);
      const bg = svg("path", { fill: `url(#${id}-bg${String(t)})` }, group);
      const glow = svg("path", { class: "score-glow", fill: `url(#${id}-glow${String(t)})` }, group);
      return { bg, glow, bgGradient, glowGradient };
    };
    this.#teams = [team(0), team(1)];
    this.#clockBox = svg("path", { class: "score-art-clock" }, this.root);
  }

  /** A team's glow (HUD-4: flashed when it scores) */
  glow(team: 0 | 1): SVGPathElement {
    return this.#teams[team].glow;
  }

  /** Drawn at a pose, your team's view on the left (`swapped`: orange's); the text placed (those laid out: a hidden
   *  element is placed when next drawn) */
  draw(pose: ScorebugPose, swapped: boolean): void {
    const { width: w, height: h } = VIEW_BOX;
    for (const t of [0, 1] as const) {
      const side: Side = (t === 0) !== swapped ? "left" : "right";
      const art = this.#teams[t];
      const outline = projectedPath(side, viewOutline(side), pose);
      art.bg.setAttribute("d", outline);
      art.glow.setAttribute("d", outline);
      const m = matrixText(tiltAt(side, w / 2, h / 2, pose));
      const [outer, inner] = side === "left" ? [0, w] : [w, 0];
      for (const [k, v] of Object.entries({ x1: outer, y1: h / 2, x2: inner, y2: h / 2 })) art.bgGradient.setAttribute(k, v.toFixed(3));
      art.bgGradient.setAttribute("gradientTransform", `matrix(${m})`);
      for (const [k, v] of Object.entries({ cx: w / 2, cy: h / 2, r: Math.hypot(w / 2, h / 2) })) art.glowGradient.setAttribute(k, v.toFixed(3));
      art.glowGradient.setAttribute("gradientTransform", `matrix(${m})`);
    }
    this.#clockBox.setAttribute("d", projectedPath("clock", clockOutline(), pose));
    this.#placeText(pose, swapped);
  }

  /** Each element under the tilt at its middle (its box read flat: no transform changes the boxes read) */
  #placeText(pose: ScorebugPose, swapped: boolean): void {
    const place = (el: HTMLElement, frame: ScoreFrame): void => {
      if (el.offsetWidth === 0) return;
      const m = textMatrix(frame, el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2, pose);
      el.style.transform = `matrix(${m.map((v) => v.toFixed(5)).join(", ")})`;
    };
    this.#text.digits.forEach((el, t) => {
      place(el, (t === 0) !== swapped ? "left" : "right");
    });
    for (const el of this.#text.clock) place(el, "clock");
  }
}
