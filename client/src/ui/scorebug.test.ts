// The scoreboard drawn already projected (HUD-2, 2a, 4): the same points as the CSS 3D transforms it replaces
import { describe, expect, it } from "vitest";
import {
  CLOCK_BOX,
  SCOREBUG_REST,
  SCORE_INTRO,
  SCORE_INTRO_END,
  type ScoreFrame,
  type ScorebugPose,
  VIEW_BOX,
  clockOutline,
  cubicBezier,
  project,
  scoreIntroPose,
  textMatrix,
  tiltAt,
  viewOutline,
} from "./scorebug";

// CSS's matrices (column vectors, row-major here), composed as the old style sheet's elements were
type M4 = number[][];
const mul = (a: M4, b: M4): M4 => a.map((row) => b[0]?.map((_, j) => row.reduce((s, v, k) => s + v * (b[k]?.[j] ?? 0), 0)) ?? []);
const translate = (x: number, y: number, z = 0): M4 => [
  [1, 0, 0, x],
  [0, 1, 0, y],
  [0, 0, 1, z],
  [0, 0, 0, 1],
];
const rotateX = (deg: number): M4 => {
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  return [
    [1, 0, 0, 0],
    [0, c, -s, 0],
    [0, s, c, 0],
    [0, 0, 0, 1],
  ];
};
const rotateY = (deg: number): M4 => {
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  return [
    [c, 0, s, 0],
    [0, 1, 0, 0],
    [-s, 0, c, 0],
    [0, 0, 0, 1],
  ];
};
const perspective = (d: number): M4 => [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, -1 / d, 1],
];
/** #score's perspective(100px) about perspective-origin (0, 80px); #score-drop's translateY; #score-tilt's rotateX about
 *  its origin (0 0); a view at (left, -0.1) turned about its transform-origin, or the clock box at (-67.5, -1.1)
 *  translateZ(1px) */
function css(frame: ScoreFrame, pose: ScorebugPose): M4 {
  const board = mul(mul(mul(translate(0, 80), perspective(100)), translate(0, -80)), mul(translate(0, pose.drop), rotateX(pose.tilt)));
  if (frame === "clock") return mul(board, translate(-67.5, -1.1, 1));
  const [left, pivot, turn] = frame === "left" ? [-134.5, 67.5, -pose.turn] : [67, 0, pose.turn];
  return mul(board, mul(translate(left, -0.1), mul(mul(translate(pivot, 0.1), rotateY(turn)), translate(-pivot, -0.1))));
}
const apply = (m: M4, x: number, y: number): readonly [number, number] => {
  const v = m.map((row) => (row[0] ?? 0) * x + (row[1] ?? 0) * y + (row[3] ?? 0));
  const w = v[3] ?? 1;
  return [(v[0] ?? 0) / w, (v[1] ?? 0) / w];
};

const POSES: ScorebugPose[] = [SCOREBUG_REST, { drop: -20, tilt: -75, turn: 60, opacity: 0 }, scoreIntroPose(1.3), scoreIntroPose(1.7)];

describe("the scoreboard's projection", () => {
  it("puts every point where the CSS 3D transforms did: the views' boxes, the clock's, at rest and through the intro", () => {
    for (const pose of POSES) {
      for (const frame of ["left", "right", "clock"] as const) {
        const [w, h] = frame === "clock" ? [CLOCK_BOX.width, CLOCK_BOX.height] : [VIEW_BOX.width, VIEW_BOX.height];
        for (const [x, y] of [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
          [w / 3, h / 2],
        ] as const) {
          const [ex, ey] = apply(css(frame, pose), x, y);
          const [X, Y] = project(frame, x, y, pose);
          expect(X, `${frame} ${String(x)},${String(y)}`).toBeCloseTo(ex, 9);
          expect(Y, `${frame} ${String(x)},${String(y)}`).toBeCloseTo(ey, 9);
        }
      }
    }
  });

  it("at rest: the inner edges meet the clock's box, the outer edges smaller and nearer the top (turned away), the board's bottom narrower (tilted back)", () => {
    const pose = SCOREBUG_REST;
    const [innerX] = project("left", VIEW_BOX.width, 0, pose);
    expect(innerX).toBeCloseTo(-67, 1);
    const outerTop = project("left", 0, 0, pose);
    const outerBottom = project("left", 0, VIEW_BOX.height, pose);
    expect(outerTop[0]).toBeGreaterThan(-134.5);
    expect(outerBottom[1] - outerTop[1]).toBeLessThan(VIEW_BOX.height);
    const [topLeft] = project("clock", 0, 0, pose);
    const [bottomLeft] = project("clock", 0, CLOCK_BOX.height, pose);
    expect(bottomLeft).toBeGreaterThan(topLeft);
    // (mirror images: the boxes -134.5...-67 and 67...134.5, turned alike about their inner edges)
    const right = project("right", VIEW_BOX.width, VIEW_BOX.height, pose);
    expect(right[0]).toBeCloseTo(-outerBottom[0], 9);
    expect(right[1]).toBeCloseTo(outerBottom[1], 9);
  });

  it("the text's matrices: the middle where it shows, the tilt's derivative there", () => {
    for (const pose of POSES) {
      const [a, b, c, d, e, f] = textMatrix("left", 33.25, 28.1, pose);
      const [X, Y] = project("left", 33.25, 28.1, pose);
      // (laid out flat at (-134.5 + 33.25, -0.1 + 28.1); CSS's origin the element's middle)
      expect(-134.5 + 33.25 + e).toBeCloseTo(X, 9);
      expect(-0.1 + 28.1 + f).toBeCloseTo(Y, 9);
      const m = tiltAt("left", 33.25, 28.1, pose);
      expect([a, b, c, d]).toEqual(m.slice(0, 4));
      // (a point 3 px off the middle within 0.05 px of its projection)
      const [px, py] = project("left", 36.25, 30.1, pose);
      expect(Math.hypot(m[0] * 36.25 + m[2] * 30.1 + m[4] - px, m[1] * 36.25 + m[3] * 30.1 + m[5] - py)).toBeLessThan(0.05);
    }
  });

  it("the outlines: the views' outer corners rounded 5, the clock box's notch", () => {
    const left = viewOutline("left");
    const right = viewOutline("right");
    for (const [x, y] of [...left, ...right]) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(VIEW_BOX.width + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(VIEW_BOX.height + 1e-9);
    }
    // (the left one's square corners on its right, the right one's on its left; none at the rounded corners)
    expect(left).toContainEqual([VIEW_BOX.width, 0]);
    expect(right).toContainEqual([0, VIEW_BOX.height]);
    expect(left.some(([x, y]) => x === 0 && y === 0)).toBe(false);
    expect(right.some(([x, y]) => x === VIEW_BOX.width && y === 0)).toBe(false);
    expect(clockOutline()).toContainEqual([87.5, CLOCK_BOX.height - 2]);
  });
});

describe("the intro (HUD-4)", () => {
  it("CSS's cubic-bezier timing", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const x of [0, 0.25, 0.5, 0.9, 1]) expect(linear(x)).toBeCloseTo(x, 6);
    // (ease at the middle: 0.8024)
    expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
    // (Back.easeOut overshoots)
    const back = cubicBezier(0.175, 0.885, 0.32, 1.275);
    expect(Math.max(...Array.from({ length: 99 }, (_, i) => back((i + 1) / 100)))).toBeGreaterThan(1.05);
  });

  it("held at its start through the delay, at rest from its end, fading in as it tilts", () => {
    const start = { drop: SCORE_INTRO.drop.from, tilt: SCORE_INTRO.tilt.from, turn: SCORE_INTRO.turn.from, opacity: 0 };
    expect(scoreIntroPose(0)).toEqual(start);
    expect(scoreIntroPose(SCORE_INTRO.delay)).toEqual(start);
    expect(scoreIntroPose(SCORE_INTRO_END)).toEqual(SCOREBUG_REST);
    expect(SCORE_INTRO_END).toBe(2);
    const opacities = Array.from({ length: 11 }, (_, i) => scoreIntroPose(1 + i * 0.06).opacity);
    expect(opacities.every((v, i) => i === 0 || v >= (opacities[i - 1] ?? 0))).toBe(true);
    // (the views still turned well past half way at 0.3 s: Strong.easeIn; the tilt nearly there: Strong.easeOut)
    const half = scoreIntroPose(1.3);
    expect(half.turn).toBeGreaterThan(50);
    expect(half.tilt).toBeGreaterThan(-15);
  });
});
