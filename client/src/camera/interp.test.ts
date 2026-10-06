import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { fInterpTo, horizontalToVerticalFov, vInterpTo } from "./interp";

describe("Unreal interpolation", () => {
  it("FInterpTo moves dt*speed of the remaining distance", () => {
    expect(fInterpTo(0, 10, 0.1, 2)).toBeCloseTo(2);
    expect(fInterpTo(0, 10, 1, 2)).toBe(10); // capped at the target
    expect(fInterpTo(3, 10, 0.1, 0)).toBe(10); // speed 0 snaps
  });

  it("VInterpTo does the same for vectors", () => {
    const v = vInterpTo(vec3(0, 0, 0), vec3(10, 0, -10), 0.25, 2);
    expect(v.x).toBeCloseTo(5);
    expect(v.z).toBeCloseTo(-5);
  });
});

describe("FOV", () => {
  it("converts Rocket League's horizontal FOV to Three's vertical FOV", () => {
    expect(horizontalToVerticalFov(90, 16 / 9)).toBeCloseTo(58.72, 2);
    expect(horizontalToVerticalFov(90, 1)).toBeCloseTo(90);
  });
});
