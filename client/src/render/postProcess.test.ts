// The post-processing chain's rules against the static session's spec (notes/post-processing.md): the tone map's
// verification table, the remap's nodes, the display values of its sample colours, the Gaussian taps, the blur radii
// and the depth of field's amounts.
import { describe, expect, it } from "vitest";
import { BLOOM, TONEMAP, blurRadii, display, dofBlur, gaussTaps, remap, remapNodes, tonemap } from "./postProcess";

describe("the tone map (PP-4)", () => {
  it("has Stadium's constants: A 0.22, B 1.0275, Z 0.255447, W 1, T 0.5", () => {
    expect(TONEMAP.a).toBeCloseTo(0.22, 9);
    expect(TONEMAP.b).toBeCloseTo(1.0275, 9);
    expect(TONEMAP.z).toBeCloseTo(0.255447, 6);
    expect(TONEMAP.w).toBe(1);
    expect(TONEMAP.t).toBe(0.5);
  });

  it("maps linear to display as the table (§4)", () => {
    const table: [number, number][] = [
      [0, 0],
      [0.001, 0.024],
      [0.005, 0.0564],
      [0.01, 0.084],
      [0.05, 0.2233],
      [0.18, 0.4605],
      [0.25, 0.5395],
      [0.26, 0.5566],
      [0.5, 0.7135],
      [0.774, 0.8001],
      [1, 0.8422],
      [2, 0.9257],
      [4, 0.9739],
      [8, 1],
    ];
    for (const [x, out] of table) expect(tonemap(x), `x ${String(x)}`).toBeCloseTo(out, 4);
  });

  it("steps at Z (0.545 to 0.552 within 1e-4), white at 8", () => {
    expect(tonemap(TONEMAP.z - 1e-6)).toBeCloseTo(0.545, 3);
    expect(tonemap(TONEMAP.z + 1e-3)).toBeCloseTo(0.552, 2);
    expect(tonemap(100)).toBe(1);
  });
});

describe("the colour remap (PP-5, §5.6)", () => {
  it("has the spec's 16 nodes, red and green, and blue's", () => {
    const rg = [0, 0.03954, 0.09737, 0.16494, 0.23974, 0.32042, 0.40613, 0.49624, 0.59031, 0.68799, 0.78898, 0.89305, 1, 1, 1, 1];
    const b = [0.0007, 0.04187, 0.10022, 0.16816, 0.24325, 0.32418, 0.41009, 0.50039, 0.59463, 0.69246, 0.7936, 0.8978, 1, 1, 1, 1];
    remapNodes(0).forEach((v, i) => { expect(v).toBeCloseTo(rg[i] ?? 0, 4); });
    remapNodes(1).forEach((v, i) => { expect(v).toBeCloseTo(rg[i] ?? 0, 4); });
    remapNodes(2).forEach((v, i) => { expect(v).toBeCloseTo(b[i] ?? 0, 4); });
  });

  it("the full display mapping as the table's float LUT columns: grey 0.18 at 0.4879 (blue 0.4921), white from linear 0.774", () => {
    const table: [number, number, number][] = [
      [0.01, 0.0546, 0.057],
      [0.1, 0.324, 0.3278],
      [0.18, 0.4879, 0.4921],
      [0.4, 0.7833, 0.7879],
      [0.5, 0.8622, 0.8669],
      [0.7, 0.9708, 0.9756],
    ];
    // (blue between its nodes 11 and 12 within 0.005: the listed nodes are stored clipped to 1, the table's float LUT
    // leaves node 12 at 1.0049; the spec's open question 4, at most 0.0046)
    for (const [x, rg, b] of table) {
      expect(remap(tonemap(x), 0), `x ${String(x)}`).toBeCloseTo(rg, 3);
      expect(Math.abs(remap(tonemap(x), 2) - b), `x ${String(x)}`).toBeLessThan(x === 0.7 ? 0.005 : 0.0005);
    }
    expect(display([0.774, 0.774, 0.774])[0]).toBeGreaterThan(0.999);
  });

  it("the sample colours (0-255): grey (124, 124, 125), orange (255, 153, 24), blue (23, 133, 255)", () => {
    const bytes = (rgb: [number, number, number]): number[] => display(rgb).map((v) => Math.round(v * 255));
    const near = (got: number[], want: number[]): void => { got.forEach((v, i) => { expect(Math.abs(v - (want[i] ?? 0))).toBeLessThanOrEqual(1); }); };
    near(bytes([0.18, 0.18, 0.18]), [124, 124, 125]);
    near(bytes([1, 0.25, 0.02]), [255, 153, 24]);
    near(bytes([0.02, 0.2, 1]), [23, 133, 255]);
  });
});

describe("the bloom and depth of field's rules (PP-7..10)", () => {
  it("the bloom's sizes 8, 64, 128 and weights 0.0833, 0.25, 0.6667", () => {
    expect(BLOOM.sizes).toEqual([8, 64, 128]);
    BLOOM.weights.forEach((w, i) => { expect(w).toBeCloseTo([1 / 12, 0.25, 2 / 3][i] ?? 0, 9); });
  });

  it("the Gaussian's taps as the game's (§5.4): at 1920 the small blur's (r 4.5, K 5)", () => {
    const { offsets, weights } = gaussTaps(4.5);
    const want = { offsets: [-4.2689, -2.3646, -0.4723, 1.4174, 3.3148, 5.0], weights: [0.04387, 0.19147, 0.35954, 0.29145, 0.10187, 0.0118] };
    expect(offsets).toHaveLength(6);
    offsets.forEach((o, i) => { expect(o).toBeCloseTo(want.offsets[i] ?? 0, 3); });
    weights.forEach((w, i) => { expect(w).toBeCloseTo(want.weights[i] ?? 0, 4); });
    expect(gaussTaps(0.1).offsets).toEqual([]);
    // (clamped to 15: K never past it)
    expect(Math.max(...gaussTaps(100).offsets.map(Math.abs))).toBeLessThanOrEqual(15);
  });

  it("the blurs' radii at common widths (§5.3, before the clamp to 15)", () => {
    const r1280 = blurRadii(1280);
    expect([r1280.small, r1280.medium, r1280.large, r1280.dof]).toEqual([2, 7, 7.5, 1]);
    const r1920 = blurRadii(1920);
    expect(r1920.small).toBeCloseTo(4.5, 9);
    expect(r1920.medium).toBeCloseTo(15.75, 9);
    expect(r1920.dof).toBeCloseTo(2.25, 9);
  });

  it("the depth of field: 0.25 all through the arena, more from 27970 uu, 0.6 from 30800 and the sky", () => {
    expect(dofBlur(100)).toBe(0.25);
    expect(dofBlur(16000)).toBe(0.25);
    expect(dofBlur(27000)).toBe(0.25);
    expect(dofBlur(29000)).toBeGreaterThan(0.25);
    expect(dofBlur(29000)).toBeLessThan(0.6);
    expect(dofBlur(31000)).toBe(0.6);
    expect(dofBlur(65504)).toBe(0.6);
  });
});
