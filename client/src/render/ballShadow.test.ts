// The ball's ground reticle (notes/visual-timing.md VT-30a, the static session's BR1): two white rings, the outer fixed at
// 93 uu, the inner contracting with the height of the ball's centre, a cross cutting the inner one into arcs
import { describe, expect, it } from "vitest";
import { RETICLE, reticle } from "./ballShadow";

/** The middle of the ring's brightest over these radii (uu; capped, a plateau), off the cross (at 45 degrees) */
function peak(altitude: number, from: number, to: number): number {
  const at = (r: number): number => reticle(r / RETICLE.half / Math.SQRT2, r / RETICLE.half / Math.SQRT2, altitude);
  const radii: number[] = [];
  for (let r = from; r <= to; r += 0.05) radii.push(r);
  const top = Math.max(...radii.map(at));
  const lit = radii.filter((r) => at(r) >= top - 1e-9);
  return ((lit[0] ?? 0) + (lit[lit.length - 1] ?? 0)) / 2;
}

describe("the ball's ground reticle (VT-30a)", () => {
  it("rings at the game's radii: the outer at 93 uu always, the inner 86.5 at Z 0, 82.4 at rest, contracting", () => {
    for (const z of [0, 92.75, 600, 2000]) expect(peak(z, 89, 97)).toBeCloseTo(92.95, 1);
    expect(peak(0, 70, 89)).toBeCloseTo(86.5, 1);
    expect(peak(92.75, 70, 89)).toBeCloseTo(82.4, 1);
    expect(peak(400, 40, 80)).toBeCloseTo(66.9, 0);
    expect(peak(800, 20, 60)).toBeCloseTo(38.2, 0);
    // (gone by Z 993: then a dot at the middle)
    expect(reticle(0, 0, 900)).toBe(0);
    expect(reticle(0.055, 0.055, 1100)).toBeGreaterThan(0); // (a petal, off the cross)
  });

  it("white, capped at 0.5; the cross cuts only the inner ring; nothing past the 192 uu square", () => {
    const rest = 92.75;
    const innerR = Math.sqrt(RETICLE.inner[0] - RETICLE.inner[1] * (rest / RETICLE.altitude));
    expect(reticle(innerR / Math.SQRT2, innerR / Math.SQRT2, rest)).toBe(RETICLE.max);
    expect(reticle(innerR, 0, rest)).toBe(0); // (on the cross: cut)
    expect(reticle(Math.sqrt(RETICLE.outer), 0, rest)).toBe(RETICLE.max); // (the outer ring isn't)
    expect(reticle(1.01, 0, rest)).toBe(0);
    expect(reticle(0.99, 0.99, rest)).toBe(0);
  });
});
