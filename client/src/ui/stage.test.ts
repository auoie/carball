import { describe, expect, it } from "vitest";
import { contentStage } from "./stage";

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
