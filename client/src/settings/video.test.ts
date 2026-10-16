// The Video tab's settings (MENU-19..21, GQ1) and the automatic default (the user's decisions, 2026-10-16)
import { describe, expect, it } from "vitest";
import {
  AUTO_GUARD,
  AutoVideoGuard,
  DEFAULT_VIDEO_SETTINGS,
  RENDER_QUALITY_SCALE,
  guardDecision,
  guardStep,
  guardWanted,
  type VideoState,
  isWeakGpu,
  readVideo,
  resolveVideo,
  withRenderDetail,
  withVideoChange,
} from "./video";

const fresh: VideoState = { video: DEFAULT_VIDEO_SETTINGS, bloom: true, depthOfField: true };

describe("the video settings", () => {
  it("Render Quality: 100, 85, 70 and 55 % of the view's resolution", () => {
    expect(Object.values(RENDER_QUALITY_SCALE)).toEqual([1, 0.85, 0.7, 0.55]);
  });

  it("Render Detail's presets set the switches as the game's (SetRenderDetailValue), Render Quality kept", () => {
    const quality = withRenderDetail({ ...fresh, video: { ...fresh.video, renderQuality: "quality" } }, "quality");
    expect(quality).toEqual({ video: { ...fresh.video, renderQuality: "quality", renderDetail: "quality", worldDetail: "quality", particleDetail: "highQuality", highQualityShaders: true, chosen: true }, bloom: false, depthOfField: false });
    const performance = withRenderDetail(fresh, "performance");
    expect(performance.video).toMatchObject({ worldDetail: "performance", particleDetail: "performance", highQualityShaders: false });
    expect([performance.bloom, performance.depthOfField]).toEqual([false, false]);
    expect(withRenderDetail(performance, "highQuality")).toEqual({ video: { ...fresh.video, chosen: true }, bloom: true, depthOfField: true });
    // (Custom itself changes no switch)
    expect(withRenderDetail(performance, "custom")).toEqual({ ...performance, video: { ...performance.video, renderDetail: "custom" } });
  });

  it("any advanced switch, Render Quality too, makes Render Detail Custom", () => {
    expect(withVideoChange(fresh, { bloom: false })).toEqual({ video: { ...fresh.video, renderDetail: "custom", chosen: true }, bloom: false, depthOfField: true });
    expect(withVideoChange(fresh, { renderQuality: "performance" }).video).toMatchObject({ renderQuality: "performance", renderDetail: "custom" });
    expect(withVideoChange(fresh, { worldDetail: "quality" }).video).toMatchObject({ worldDetail: "quality", renderDetail: "custom" });
  });

  it("a saved group read field by field, anything unexpected its default", () => {
    expect(readVideo(undefined)).toEqual(DEFAULT_VIDEO_SETTINGS);
    expect(readVideo({ renderQuality: "performance", renderDetail: "nonsense", highQualityShaders: false, chosen: true, autoLevel: 9, stepped: true })).toEqual({
      ...DEFAULT_VIDEO_SETTINGS,
      renderQuality: "performance",
      highQualityShaders: false,
      chosen: true,
      autoLevel: 2,
      stepped: true,
    });
  });
});

describe("the automatic default", () => {
  it("the game's maximum on a capable GPU; Performance (70 %) and Quality on a weak one; one step down to 55 % and Performance; the player's choice always", () => {
    expect(resolveVideo(fresh, false)).toEqual({ video: fresh.video, bloom: true, depthOfField: true });
    const weak = resolveVideo(fresh, true);
    expect(weak.video).toMatchObject({ renderQuality: "performance", renderDetail: "quality", worldDetail: "quality", highQualityShaders: true, chosen: false, autoLevel: 1 });
    expect([weak.bloom, weak.depthOfField]).toEqual([false, false]);
    const stepped = resolveVideo({ ...weak, video: { ...weak.video, autoLevel: 2 } }, true);
    expect(stepped.video).toMatchObject({ renderQuality: "highPerformance", renderDetail: "performance", highQualityShaders: false, autoLevel: 2 });
    // (a capable GPU's step down: the weak one's start)
    expect(resolveVideo({ ...fresh, video: { ...fresh.video, autoLevel: 1 } }, false).video).toMatchObject({ renderQuality: "performance", renderDetail: "quality" });
    const mine = withVideoChange(weak, { renderQuality: "highQuality" });
    expect(resolveVideo(mine, true)).toBe(mine);
  });

  /** A session's intervals: `base` s, varied as a GPU-bound page's are (a fixed pattern, ±15 %) unless `steady` */
  const run = (base: number, steady = false, visible = true): boolean[] => {
    const guard = new AutoVideoGuard();
    const decisions: boolean[] = [];
    const pattern = steady ? [1] : [0.85, 1.15, 1, 0.9, 1.1];
    for (let t = 0, i = 0; t < AUTO_GUARD.warmUp + AUTO_GUARD.measure + 2; i++) {
      const frame = base * (pattern[i % pattern.length] ?? 1);
      t += frame;
      decisions.push(guard.frame(frame, visible));
    }
    return decisions;
  };

  it("the guard: nothing in the warm-up, then the trimmed mean over its measure; once; the threshold 45 a second", () => {
    expect(run(1 / 60).filter(Boolean)).toEqual([]);
    expect(run(1 / 46).filter(Boolean)).toEqual([]);
    expect(run(1 / 44).filter(Boolean)).toEqual([true]);
    const slow = run(1 / 30);
    expect(slow.filter(Boolean)).toEqual([true]);
    // (decided at the measure's end, not in the warm-up)
    expect(slow.indexOf(true) / 30).toBeGreaterThanOrEqual(AUTO_GUARD.warmUp + AUTO_GUARD.measure - 1 / 30);
    // (a slow warm-up alone isn't counted)
    const guard = new AutoVideoGuard();
    let stepped = false;
    for (let t = 0; t < AUTO_GUARD.warmUp; t += 0.1) stepped ||= guard.frame(0.1);
    for (let t = 0; t < AUTO_GUARD.measure + 0.1; t += 1 / 60) stepped ||= guard.frame(1 / 60);
    expect(stepped).toBe(false);
    // (a hidden tab's frames not counted at all)
    expect(run(1 / 30, false, false).filter(Boolean)).toEqual([]);
  });

  it("not on a cap: intervals sitting on one value (a 30 Hz display, Energy Saver) are the display's or the browser's, not the GPU's (RV-500)", () => {
    expect(run(1 / 30, true).filter(Boolean)).toEqual([]);
    expect(guardDecision(Array.from({ length: 120 }, (_, i) => 1 / 30 + (i % 3) * 0.0004))).toMatchObject({ slow: true, capped: true, step: false });
    // (40 a second at 60 Hz, alternating one and two refreshes: the mean 25 ms whatever the window's parity, a step)
    for (const first of [1 / 60, 1 / 30]) {
      const frames = Array.from({ length: 160 }, (_, i) => (i % 2 === 0 ? first : first === 1 / 60 ? 1 / 30 : 1 / 60));
      expect(guardDecision(frames)).toMatchObject({ capped: false, step: true });
    }
  });

  it("hitches: a few long frames trimmed, none 0.25 s or longer counted", () => {
    const frames = Array.from({ length: 240 }, (_, i) => (i % 40 === 0 ? 0.2 : (1 / 60) * (i % 2 === 0 ? 0.9 : 1.1)));
    expect(guardDecision(frames).step).toBe(false);
    const guard = new AutoVideoGuard();
    expect(guard.frame(0.3)).toBe(false);
    expect(guard.frame(0.5)).toBe(false);
  });

  it("its gates: drawing, allowed, not chosen, not stepped before, a level left; the step itself once, never over a choice (RV-499, RV-504)", () => {
    const v = DEFAULT_VIDEO_SETTINGS;
    expect(guardWanted(v, true)).toBe(true);
    expect(guardWanted(v, false)).toBe(false);
    expect(guardWanted(v, true, false)).toBe(false);
    expect(guardWanted({ ...v, chosen: true }, true)).toBe(false);
    expect(guardWanted({ ...v, stepped: true }, true)).toBe(false);
    expect(guardWanted({ ...v, autoLevel: 2 }, true)).toBe(false);
    expect(guardStep(v)).toEqual({ ...v, autoLevel: 1, stepped: true });
    expect(guardStep({ ...v, autoLevel: 1 })).toEqual({ ...v, autoLevel: 2, stepped: true });
    expect(guardStep({ ...v, chosen: true })).toBeNull();
    expect(guardStep({ ...v, stepped: true })).toBeNull();
    // (stepped once: the next page's guard doesn't run, so a capable GPU never steps twice)
    const once = guardStep(v);
    expect(once && guardWanted(once, true)).toBe(false);
  });

  it("weak GPUs by their names: Intel's and AMD's integrated graphics, phones', software; discrete and Apple's not", () => {
    for (const name of [
      "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Mesa Intel(R) HD Graphics 520 (SKL GT2)",
      "ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "AMD Radeon Vega 8 Graphics",
      "Mali-G78",
      "Adreno (TM) 650",
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      // (RV-509: Meteor Lake's integrated Arc, Kaveri's and Carrizo's APUs)
      "ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (AMD, AMD Radeon(TM) R7 Graphics (0x00001313) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "AMD Radeon R5 Graphics",
    ]) expect(isWeakGpu(name), name).toBe(true);
    for (const name of [
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (Intel, Intel(R) Arc(TM) B580 Graphics (0x0000E20B) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "AMD Radeon R7 200 Series",
      "Apple GPU",
      "Apple M2",
      "",
    ]) expect(isWeakGpu(name), name).toBe(false);
  });
});
