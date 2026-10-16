// The loading screen's steps and its map and mode line (src/ui/loadingScreen.ts)
import { describe, expect, it } from "vitest";
import { LOADING_STEPS, placeText } from "./loadingScreen";

describe("the loading screen", () => {
  it("its steps in order along the bar, short of full till the game's first frame", () => {
    const at = Object.values(LOADING_STEPS).map((s) => s.at);
    expect(at.every((v, i) => i === 0 || v > (at[i - 1] ?? 0))).toBe(true);
    expect(Math.max(...at)).toBeLessThan(1);
    expect(LOADING_STEPS.shaders.text).toBe("Preparing shaders");
  });

  it("the map and the mode, either alone, nothing without both", () => {
    expect(placeText("Night", "Free Play")).toBe("Night · Free Play");
    expect(placeText("Meadow", null)).toBe("Meadow");
    expect(placeText(null, "2v2")).toBe("2v2");
    expect(placeText(null, null)).toBe("");
  });
});
