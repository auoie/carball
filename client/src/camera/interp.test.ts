import { describe, expect, it } from "vitest";
import { horizontalToVerticalFov } from "./interp";

describe("FOV", () => {
  it("converts Rocket League's horizontal FOV to Three's vertical FOV", () => {
    expect(horizontalToVerticalFov(90, 16 / 9)).toBeCloseTo(58.72, 2);
    expect(horizontalToVerticalFov(90, 1)).toBeCloseTo(90);
  });
});
