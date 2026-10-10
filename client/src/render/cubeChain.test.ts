// The capture chain's rules (notes/arena-surroundings.md SUR-32 CAP1): the store's transfer, the blur's kernel and its
// weight channel at the face's edges, GL's face table.
import { describe, expect, it } from "vitest";
import { CUBE_BLUR_SIZE, CUBE_BLUR_WEIGHTS, blurFace, cubeStore, faceDirection } from "./cubeChain";

describe("the reflection capture's chain (CAP1)", () => {
  it("the store: 0.01 -> 0.0137, 0.18 -> 0.1779, 0.5 -> 0.491, 1 and over -> 1, nothing below 0", () => {
    expect(cubeStore(0.01)).toBeCloseTo(0.0137, 3);
    expect(cubeStore(0.18)).toBeCloseTo(0.1779, 3);
    expect(cubeStore(0.5)).toBeCloseTo(0.491, 3);
    expect(cubeStore(3)).toBe(1);
    expect(cubeStore(-1)).toBe(0);
  });

  it("the kernel: exp(-i² / 6.4) normalised (the exe's r = 3.2), summing to 1", () => {
    const raw = [0, 1, 2, 3, 4].map((i) => Math.exp((-i * i) / 6.4));
    const total = 1 + 2 * raw.slice(1).reduce((s, v) => s + v, 0);
    expect(CUBE_BLUR_WEIGHTS[0] + 2 * (CUBE_BLUR_WEIGHTS[1] + CUBE_BLUR_WEIGHTS[2] + CUBE_BLUR_WEIGHTS[3] + CUBE_BLUR_WEIGHTS[4])).toBeCloseTo(1, 4);
    raw.forEach((v, i) => {
      expect(CUBE_BLUR_WEIGHTS[i]).toBeCloseTo(v / total, 4);
    });
  });

  it("the blur within its face: a flat face stays flat to its edges (the weight divided out, no dark border); a spot spreads as the kernel's variance (3.2's Gaussian cut at 4: 2.94)", () => {
    const n = CUBE_BLUR_SIZE;
    const flat = blurFace(Array.from({ length: n * n }, () => [0.5, 0.25, 1, 1]));
    for (const k of [0, n - 1, n * n - 1, (n / 2) * n + n / 2]) expect(flat[k]?.[0]).toBeCloseTo(0.5, 9);
    const spot = blurFace(Array.from({ length: n * n }, (_, k) => (k === (n / 2) * n + n / 2 ? [1, 1, 1, 1] : [0, 0, 0, 1])));
    let [sum, second] = [0, 0];
    spot.forEach((c, k) => {
      const dx = (k % n) - n / 2;
      sum += c[0] ?? 0;
      second += (c[0] ?? 0) * dx * dx;
    });
    // (over the weights' own sum: rounded, 1.00002)
    const weightSum = CUBE_BLUR_WEIGHTS[0] + 2 * CUBE_BLUR_WEIGHTS.slice(1).reduce((s, w) => s + w, 0);
    const kernel = (2 * CUBE_BLUR_WEIGHTS.reduce((s, w, i) => s + w * i * i, 0)) / weightSum;
    expect(kernel).toBeCloseTo(2.94, 2);
    expect(second / sum).toBeCloseTo(kernel, 6);
  });

  it("GL's faces: each texel's direction falls back on its face, the centre on its axis", () => {
    const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let f = 0; f < 6; f++) {
      expect(faceDirection(f, 0.5, 0.5).map((v) => v + 0)).toEqual(axes[f]);
      for (const [s, t] of [[0.1, 0.2], [0.9, 0.7], [0.4, 0.95]] as const) {
        const d = faceDirection(f, s, t);
        const major = d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs)));
        expect(2 * major + ((d[major] ?? 0) > 0 ? 0 : 1)).toBe(f);
      }
    }
  });
});
