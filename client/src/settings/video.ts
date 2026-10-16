// The Video tab's settings (notes/hud-menus.md MENU-19..21, notes/post-processing.md §13: GQ1) as Carball builds them:
// Render Quality (the 3D view's resolution, the HUD and menus kept full: ScreenPercentage with upscale), Render Detail's
// presets over the advanced switches that change what we draw (World Detail, Particle Detail, High Quality Shaders,
// Depth of Field, Bloom; the game's other rows change nothing here and aren't shown), and our automatic default (the
// user's decisions, 2026-10-16: on a detected integrated or weak GPU, Performance (70 %) and Quality; after a warm-up in
// free play a frame rate still too low steps down once more; never mid-match; any choice of the player's wins from then
// on; elsewhere the PC game's maximum).

/** Render Quality (ScreenPercentage) and the advanced detail lists' values, in the game's order */
export type QualityLevel = "highQuality" | "quality" | "performance" | "highPerformance";
export type RenderDetail = "highQuality" | "quality" | "performance" | "custom";
export type WorldDetail = "highQuality" | "quality" | "performance";
export type ParticleDetail = "highQuality" | "performance";

export interface VideoSettings {
  readonly renderQuality: QualityLevel;
  readonly renderDetail: RenderDetail;
  readonly worldDetail: WorldDetail;
  readonly particleDetail: ParticleDetail;
  readonly highQualityShaders: boolean;
  /** The player set a video setting: the automatic default no longer applies */
  readonly chosen: boolean;
  /** The automatic default's level (AUTO_LEVELS), while the player hasn't chosen */
  readonly autoLevel: number;
  /** The frame-rate guard has stepped it down: once, not again on a later page (MENU-21's "once", RV-504) */
  readonly stepped: boolean;
}

/** Render Quality's share of the view's resolution each way (TA: ScreenPercentage 100 / 85 / 70 / 55) */
export const RENDER_QUALITY_SCALE: Readonly<Record<QualityLevel, number>> = { highQuality: 1, quality: 0.85, performance: 0.7, highPerformance: 0.55 };

/** The switches a Render Detail preset sets (SetRenderDetailValue, TA:55234-55282: the ones Carball builds; Bloom and
 *  Depth of Field are the options') */
export interface DetailSwitches {
  readonly worldDetail: WorldDetail;
  readonly particleDetail: ParticleDetail;
  readonly highQualityShaders: boolean;
  readonly bloom: boolean;
  readonly depthOfField: boolean;
}

export const RENDER_DETAIL_PRESETS: Readonly<Record<Exclude<RenderDetail, "custom">, DetailSwitches>> = {
  highQuality: { worldDetail: "highQuality", particleDetail: "highQuality", highQualityShaders: true, bloom: true, depthOfField: true },
  quality: { worldDetail: "quality", particleDetail: "highQuality", highQualityShaders: true, bloom: false, depthOfField: false },
  performance: { worldDetail: "performance", particleDetail: "performance", highQualityShaders: false, bloom: false, depthOfField: false },
};

/** The game's labels (UserSettings.int: MENU-19) */
export const VIDEO_TEXT = {
  basic: "Basic Settings",
  advanced: "Advanced Settings",
  renderQuality: "Render Quality",
  renderDetail: "Render Detail",
  worldDetail: "World Detail",
  particleDetail: "Particle Detail",
  highQualityShaders: "High Quality Shaders",
  depthOfField: "Depth of Field",
  bloom: "Bloom",
  levels: { highQuality: "High Quality", quality: "Quality", performance: "Performance", highPerformance: "High Performance", custom: "Custom" },
} as const;

/** The PC game's first run: everything at its highest (MENU-21) */
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  renderQuality: "highQuality",
  renderDetail: "highQuality",
  worldDetail: "highQuality",
  particleDetail: "highQuality",
  highQualityShaders: true,
  chosen: false,
  autoLevel: 0,
  stepped: false,
};

/** The automatic default's levels: the game's maximum; a weak GPU's start (Performance 70 %, Quality); one step down */
export const AUTO_LEVELS: readonly { readonly renderQuality: QualityLevel; readonly renderDetail: Exclude<RenderDetail, "custom"> }[] = [
  { renderQuality: "highQuality", renderDetail: "highQuality" },
  { renderQuality: "performance", renderDetail: "quality" },
  { renderQuality: "highPerformance", renderDetail: "performance" },
];

const QUALITY_LEVELS: readonly QualityLevel[] = ["highQuality", "quality", "performance", "highPerformance"];
const DETAILS: readonly RenderDetail[] = ["highQuality", "quality", "performance", "custom"];
const WORLD: readonly WorldDetail[] = ["highQuality", "quality", "performance"];
const PARTICLES: readonly ParticleDetail[] = ["highQuality", "performance"];

const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);

/** A saved video group, field by field (anything unexpected: its default) */
export function readVideo(v: unknown): VideoSettings {
  const src = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const d = DEFAULT_VIDEO_SETTINGS;
  const level = src["autoLevel"];
  return {
    renderQuality: oneOf(src["renderQuality"], QUALITY_LEVELS, d.renderQuality),
    renderDetail: oneOf(src["renderDetail"], DETAILS, d.renderDetail),
    worldDetail: oneOf(src["worldDetail"], WORLD, d.worldDetail),
    particleDetail: oneOf(src["particleDetail"], PARTICLES, d.particleDetail),
    highQualityShaders: typeof src["highQualityShaders"] === "boolean" ? src["highQualityShaders"] : d.highQualityShaders,
    chosen: src["chosen"] === true,
    stepped: src["stepped"] === true,
    autoLevel: typeof level === "number" && Number.isInteger(level) ? Math.min(AUTO_LEVELS.length - 1, Math.max(0, level)) : d.autoLevel,
  };
}

/** What the video settings set, with the options they share (Bloom, Depth of Field) */
export interface VideoState {
  readonly video: VideoSettings;
  readonly bloom: boolean;
  readonly depthOfField: boolean;
}

/** A Render Detail preset chosen: its switches, Render Quality kept */
export function withRenderDetail(s: VideoState, detail: RenderDetail, chosen = true): VideoState {
  if (detail === "custom") return { ...s, video: { ...s.video, renderDetail: "custom", chosen } };
  const { bloom, depthOfField, ...switches } = RENDER_DETAIL_PRESETS[detail];
  return { video: { ...s.video, ...switches, renderDetail: detail, chosen }, bloom, depthOfField };
}

/** An advanced switch or Render Quality changed by the player: Render Detail becomes Custom (as the game's: any of these,
 *  Render Quality too, TA:55148-55199) */
export function withVideoChange(s: VideoState, change: Partial<Omit<VideoSettings, "chosen" | "autoLevel" | "renderDetail">> & { readonly bloom?: boolean; readonly depthOfField?: boolean }): VideoState {
  const { bloom = s.bloom, depthOfField = s.depthOfField, ...video } = change;
  return { video: { ...s.video, ...video, renderDetail: "custom", chosen: true }, bloom, depthOfField };
}

/** The automatic default at `level` (the player not having chosen) */
export function autoVideo(s: VideoState, level: number): VideoState {
  const at = Math.min(AUTO_LEVELS.length - 1, Math.max(0, level));
  const pick = AUTO_LEVELS[at] ?? AUTO_LEVELS[0];
  if (!pick) return s;
  const preset = withRenderDetail({ ...s, video: { ...s.video, renderQuality: pick.renderQuality, autoLevel: at } }, pick.renderDetail, false);
  return preset;
}

/** The settings as they apply: the player's own once chosen; else the automatic default's level, a weak GPU's start at
 *  least */
export function resolveVideo(s: VideoState, weakGpu: boolean): VideoState {
  if (s.video.chosen) return s;
  return autoVideo(s, Math.max(s.video.autoLevel, weakGpu ? 1 : 0));
}

/** The automatic default's frame-rate guard (ours): a warm-up, then this long measured, stepping down once when the
 *  mean frame (its slowest 5 % left out as hitches: RV-500, a median of vsync-quantised intervals swings on the window's
 *  parity) took longer than `slowFrame` s (under ~45 a second: a 60 Hz display's frames missed often), unless the
 *  intervals sit on one value (their 90th percentile within `capSpread` of their 10th): a display's or the browser's cap
 *  (a 30 Hz display, Energy Saver), not the GPU's load. A frame `hitch` s or longer, or one in a hidden tab, isn't counted */
export const AUTO_GUARD = { warmUp: 3, measure: 4, slowFrame: 1 / 45, trim: 0.05, capSpread: 1.08, hitch: 0.25 } as const;

/** The step's decision from the measured intervals (s) */
export function guardDecision(frames: readonly number[]): { readonly slow: boolean; readonly capped: boolean; readonly step: boolean } {
  const sorted = [...frames].sort((a, b) => a - b);
  const kept = sorted.slice(0, Math.max(1, Math.floor(sorted.length * (1 - AUTO_GUARD.trim))));
  const mean = kept.reduce((s, v) => s + v, 0) / kept.length;
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const capped = at(0.9) <= at(0.1) * AUTO_GUARD.capSpread;
  const slow = mean > AUTO_GUARD.slowFrame;
  return { slow, capped, step: slow && !capped };
}

/** Whether the guard runs on this page: drawing, not turned off (the browser tests'), the player not having chosen, not
 *  stepped before, a lower level left */
export function guardWanted(video: VideoSettings, draws: boolean, allowed = true): boolean {
  return draws && allowed && !video.chosen && !video.stepped && video.autoLevel < AUTO_LEVELS.length - 1;
}

/** The step itself, decided now (null: the player chose meanwhile, or it stepped already) */
export function guardStep(video: VideoSettings): VideoSettings | null {
  if (video.chosen || video.stepped || video.autoLevel >= AUTO_LEVELS.length - 1) return null;
  return { ...video, autoLevel: video.autoLevel + 1, stepped: true };
}

/** The guard over one free-play session: fed each frame's interval (s) and whether the tab is seen; `step` once when it
 *  decides to step down */
export class AutoVideoGuard {
  #time = 0;
  readonly #frames: number[] = [];
  #done = false;

  /** Whether this frame decided a step down (once at most) */
  frame(seconds: number, visible = true): boolean {
    if (this.#done || !(seconds > 0) || !visible || seconds >= AUTO_GUARD.hitch) return false;
    this.#time += seconds;
    if (this.#time <= AUTO_GUARD.warmUp) return false;
    this.#frames.push(seconds);
    if (this.#time < AUTO_GUARD.warmUp + AUTO_GUARD.measure) return false;
    this.#done = true;
    return guardDecision(this.#frames).step;
  }

  get done(): boolean {
    return this.#done;
  }
}

/** A WebGL renderer's name (the unmasked one where the browser gives it) */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name: unknown = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof name === "string" ? name : "";
}

/** Whether a renderer's name is an integrated or weak GPU's (ours: Intel's integrated graphics, its Arc ones too, AMD's
 *  APUs, phones' and tablets' GPUs, software renderers); a discrete GPU, or a name the browser hides or shares between
 *  kinds (Safari's "Apple GPU", an M-series' and an Intel Mac's alike: RV-509), not */
export function isWeakGpu(name: string): boolean {
  if (/\bArc\b(\(TM\))?\s+[AB]\d{3}/i.test(name)) return false; // (Intel's discrete A- and B-series; "Arc Graphics" is integrated)
  return [
    /Intel.*(HD|UHD|Iris|Graphics)/i,
    /Radeon\(TM\) Graphics|Radeon Graphics|Radeon.*Vega \d+ (Mobile )?Graphics|Radeon\(TM\) (Vega )?\d+M|Radeon \d{3}M\b|Radeon(\(TM\))? R[2-7] Graphics/i,
    /Mali|Adreno|PowerVR|Immortalis|Xclipse/i,
    /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i,
  ].some((pattern) => pattern.test(name));
}
