// The menus' scale from the window: their own size up to 1536 x 864, then growing with the window, the smaller side's
// share
import { describe, expect, it } from "vitest";
import { menuScale } from "./menuScale";

describe("the menus' scale", () => {
  it("is 1 up to 1536 x 864, 1.25 at 1920 x 1080, 1.67 at 2560 x 1440", () => {
    expect(menuScale(1280, 720)).toBe(1);
    expect(menuScale(1366, 768)).toBe(1);
    expect(menuScale(1536, 864)).toBe(1);
    expect(menuScale(1920, 1080)).toBe(1.25);
    expect(menuScale(2560, 1440)).toBeCloseTo(5 / 3, 9);
  });

  it("follows the smaller side's share: a wide or a tall window grows by its short side", () => {
    expect(menuScale(3440, 1440)).toBeCloseTo(1440 / 864, 9);
    expect(menuScale(1920, 1200)).toBe(1.25);
    expect(menuScale(1080, 1920)).toBe(1);
  });
});
