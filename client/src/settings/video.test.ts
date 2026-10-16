// The Video tab's settings (MENU-19..21, GQ1) and the automatic default (the user's decisions, 2026-10-16)
import { describe, expect, it } from "vitest";
import {
  AUTO_GUARD,
  AutoVideoGuard,
  DEFAULT_VIDEO_SETTINGS,
  RENDER_QUALITY_SCALE,
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
    expect(readVideo({ renderQuality: "performance", renderDetail: "nonsense", highQualityShaders: false, chosen: true, autoLevel: 9 })).toEqual({
      ...DEFAULT_VIDEO_SETTINGS,
      renderQuality: "performance",
      highQualityShaders: false,
      chosen: true,
      autoLevel: 2,
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

  it("the guard: nothing in the warm-up, then the median frame over its measure; once", () => {
    const run = (frame: number): boolean[] => {
      const guard = new AutoVideoGuard();
      const decisions: boolean[] = [];
      for (let t = 0; t < AUTO_GUARD.warmUp + AUTO_GUARD.measure + 2; t += frame) decisions.push(guard.frame(frame));
      return decisions;
    };
    expect(run(1 / 60).filter(Boolean)).toEqual([]);
    expect(run(1 / 50).filter(Boolean)).toEqual([]);
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
    ]) expect(isWeakGpu(name), name).toBe(true);
    for (const name of [
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Apple M2",
      "",
    ]) expect(isWeakGpu(name), name).toBe(false);
  });
});
