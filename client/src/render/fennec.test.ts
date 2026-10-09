// The plain Fennec's recolour against the game's combine (notes/car-paint.md PNT-6/7/15; review RV-14).
import { describe, expect, it } from "vitest";
import { fennecAlbedo } from "./fennec";

const BLUE = [0.001343, 0.25301, 0.978132] as const;
const DIFFUSE = [0.4, 0.3, 0.2] as const;

describe("the Fennec's paint", () => {
  it("the paint area takes the team's colour itself, shaded 0.734 (not the diffuse times it)", () => {
    const albedo = fennecAlbedo(DIFFUSE, [1, 0, 0], BLUE);
    BLUE.forEach((c, k) => {
      expect(albedo[k]).toBeCloseTo(c * 0.734, 9);
    });
  });

  it("the trim 0.09 grey (rubber, facing), the glass black, the rest its diffuse shaded", () => {
    expect(fennecAlbedo(DIFFUSE, [0, 1, 0], BLUE)).toEqual([0.09, 0.09, 0.09].map((v) => expect.closeTo(v, 9) as number));
    expect(fennecAlbedo(DIFFUSE, [1, 0, 1], BLUE)).toEqual([0, 0, 0]);
    const plain = fennecAlbedo(DIFFUSE, [0, 0, 0], BLUE);
    DIFFUSE.forEach((c, k) => {
      expect(plain[k]).toBeCloseTo(c * 0.734, 9);
    });
  });
});
