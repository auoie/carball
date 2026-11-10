import { afterEach, describe, expect, it, vi } from "vitest";
import { contentStage, insetStage } from "./stage";

describe("the HUD's content stage (HUD-1)", () => {
  it("keeps 720 of height at wide aspects and 1120 of width at narrow ones, 0.5 the smallest scale", () => {
    expect(contentStage(1920, 1080, 1, 1)).toEqual({ scale: 1.5, width: 1280, height: 720, left: 0, top: 0 });
    expect(contentStage(1120, 900, 1, 1)).toMatchObject({ scale: 1, width: 1120, height: 900 });
    expect(contentStage(400, 300, 1, 1).scale).toBe(0.5);
  });

  it("scales by Interface Scale and Display Scale, the Display Scale's border round it", () => {
    const s = contentStage(1920, 1080, 0.5, 1);
    expect([s.scale, s.width, s.height]).toEqual([0.75, 2560, 1440]);
    const d = contentStage(1920, 1080, 1, 0.9);
    expect(d.scale).toBeCloseTo(1.35);
    expect(d.width).toBeCloseTo(1280);
    expect(d.height).toBeCloseTo(720);
    expect(d.left).toBeCloseTo(96);
    expect(d.top).toBeCloseTo(54);
  });
});

describe("the stage within a phone's safe area (RV-1212)", () => {
  it("laid out in the window less the insets, placed from the safe area's corner; no insets, the plain stage", () => {
    const plain = contentStage(844, 390);
    expect(insetStage(844, 390, { left: 0, right: 0, top: 0, bottom: 0 })).toEqual(plain);
    const notched = insetStage(844, 390, { left: 47, right: 47, top: 0, bottom: 21 });
    expect(notched).toEqual({ ...contentStage(750, 369), left: contentStage(750, 369).left + 47, top: contentStage(750, 369).top });
    expect(notched.left).toBeGreaterThanOrEqual(47);
  });
});

describe("the safe area's insets, read once until the window changes (RV-1229)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("one style read for any number of stages; a resize reads again", async () => {
    const listeners = new Map<string, () => void>();
    const reads = vi.fn(() => ({ paddingLeft: "47px", paddingRight: "47px", paddingTop: "0px", paddingBottom: "21px" }));
    vi.stubGlobal("document", { createElement: () => ({ style: {} }), body: { append: () => undefined } });
    vi.stubGlobal("window", {
      innerWidth: 844,
      innerHeight: 390,
      addEventListener: (type: string, f: () => void) => listeners.set(type, f),
      visualViewport: null,
    });
    vi.stubGlobal("getComputedStyle", reads);
    const stage = await import("./stage");
    expect(stage.safeInsets()).toEqual({ left: 47, right: 47, top: 0, bottom: 21 });
    stage.windowStage();
    stage.windowStage();
    expect(reads).toHaveBeenCalledTimes(1);
    listeners.get("resize")?.();
    stage.windowStage();
    expect(reads).toHaveBeenCalledTimes(2);
  });
});
