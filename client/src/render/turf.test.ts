// The turf's grain (src/render/turf.ts): a seamless tile, the same on every load, its mean and spread as the pitch's
// shader assumes (a fetch's sum about 1 either way of its middle)
import { describe, expect, it } from "vitest";
import { TURF_TEXELS, turfGrain } from "./turf";

describe("the turf's grain", () => {
  const tile = turfGrain();
  const at = (x: number, y: number): number =>
    tile[(((y % TURF_TEXELS) + TURF_TEXELS) % TURF_TEXELS) * TURF_TEXELS + (((x % TURF_TEXELS) + TURF_TEXELS) % TURF_TEXELS)] ?? 0;
  /** The largest step between neighbouring texels across a column boundary (x - 1 to x), over every row */
  const step = (x: number): number => Math.max(...Array.from({ length: TURF_TEXELS }, (_, y) => Math.abs(at(x, y) - at(x - 1, y))));
  const rowStep = (y: number): number => Math.max(...Array.from({ length: TURF_TEXELS }, (_, x) => Math.abs(at(x, y) - at(x, y - 1))));

  it("seamless: across its edges no larger a step than between any two of its inner columns or rows", () => {
    const inner = Math.max(...[1, 64, 128, 200].map(step), ...[1, 64, 128, 200].map(rowStep));
    expect(step(0), "the left edge against the right").toBeLessThanOrEqual(inner * 1.25);
    expect(rowStep(0), "the top edge against the bottom").toBeLessThanOrEqual(inner * 1.25);
  });

  it("its mean 128 and its spread about 40 either way, the same on every load", () => {
    const mean = tile.reduce((a, v) => a + v, 0) / tile.length;
    const sd = Math.sqrt(tile.reduce((a, v) => a + (v - mean) ** 2, 0) / tile.length);
    expect(mean).toBeGreaterThan(126);
    expect(mean).toBeLessThan(130);
    expect(sd).toBeGreaterThan(36);
    expect(sd).toBeLessThan(44);
    expect(turfGrain()).toEqual(tile);
  });
});
