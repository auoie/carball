import { describe, expect, it } from "vitest";
import { BALL_RADIUS, patchedBallGeometry } from "./entities";

describe("ball", () => {
  it("has twelve five-triangle patches, so its spin shows", () => {
    const geometry = patchedBallGeometry();
    const colors = geometry.getAttribute("color");
    const positions = geometry.getAttribute("position");
    let dark = 0;
    for (let i = 0; i < colors.count; i += 3) if (colors.getX(i) < 0.1) dark++;
    expect(dark).toBe(12 * 5);
    for (let i = 0; i < positions.count; i++) {
      const r = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      expect(r).toBeCloseTo(BALL_RADIUS, 3);
    }
  });
});
