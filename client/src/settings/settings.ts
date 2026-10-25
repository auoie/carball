// Player settings: bindings, camera, controller and audio. Saved in the browser (localStorage).
import { DEFAULT_VIDEO_SETTINGS, type VideoSettings, readVideo, resolveVideo } from "./video";
import { DEFAULT_COLUMNS, SCOREBOARD_COLUMNS } from "../game/matchStats";
import { DEFAULT_CAMERA_SETTINGS, type CameraSettings } from "../camera/carballCamera";
import { ACTIONS, type Action, type Binding, type Bindings, DEFAULT_BINDINGS, type GamepadInput, type KeyboardInput, exclusiveGroups } from "../input/bindings";
import { DEFAULT_SLOTS, POOLS } from "../game/quickChat";
import type { ChatFilter } from "../net/protocol";
import { TRAINING_DEFAULTS, TRAINING_LIMITS, type TrainingNumbers, type TrainingSettings } from "../training/settings";

/** The game's Controls menu (ProfileGamepadSave_TA). The engine applies everything but the deadzone. */
export interface ControllerSettings {
  readonly deadzone: number; // controller deadzone, per stick axis (PlayerInput_X.GamepadDeadzone)
  readonly dodgeDeadzone: number; // DodgeInputThreshold
  readonly steeringSensitivity: number;
  readonly aerialSensitivity: number; // AirControlSensitivity
  readonly freeLookDeadzone: number; // ControllerFreeLookDeadzone: a hard cut after the stick's deadzone
  readonly mouseSensitivity: number; // MouseSensitivity (free look: counts × this × FOV/90)
}

/** The camera's per-input settings (ProfileCameraInputSettings: CameraKBM and CameraController); the one for the
 *  input in use applies (notes/camera-respawn-goal.md CAM-17) */
export interface InputCameraSettings {
  readonly freeLook: boolean; // bUnconstrainRotation: the view turns only by the look input
  readonly ballCamToggle: boolean; // bToggleSecondaryCamera: press toggles (else hold)
  readonly invertPitch: boolean; // bInvertSwivelPitch
  readonly smoothing: boolean; // bFreeLookSmoothing
  readonly accelRate: number; // CameraAccelRate: the free look's speed eases in at this rate (1/s)
  readonly decelRate: number; // CameraDecelRate: and out at this
  readonly freeLookSpeed: number; // FreeLookSpeed
}

/** On/off options (ProfileCameraSave_TA, ProfilePCSave_TA). */
export interface Options {
  readonly rearCameraToggle: boolean; // bToggleRearCamera
  readonly cameraShake: boolean; // bEnableCameraShake: on with the Default camera preset, off with Modern
  readonly airPitchSafety: boolean; // bAirPitchSafetyEnabled (keyboard and mouse)
  readonly muted: boolean; // all sound off
  readonly autoSkipReplay: boolean; // bAutoSkipGoalReplay: always ready to skip goal replays
  readonly unlimitedBoost: boolean; // Unlimited boost in free play (MENU-9): on, the tank stays full (and a full car takes no pads)
  readonly bloom: boolean; // the video option Bloom (system setting Bloom; on in the High preset, PP-16)
  readonly depthOfField: boolean; // the video option Depth of Field (on in High: the arena's 25 % softening, PP-10)
  readonly fullscreen: boolean; // the video option Display Mode: Fullscreen (the page's full screen, its keyboard locked), else Windowed (RV-1091)
}

/** Volumes, 0..1. */
export interface AudioSettings {
  readonly master: number;
  readonly effects: number; // hits, jumps, pickups, goals
  readonly cars: number; // engines and boost
  readonly ambience: number; // the arena's soundscape
}

/** Chat: the quick-chat filters (ProfileGameplaySave_TA QuickChatFilter, bFilterNonTacticalQuickChat: CHAT-18) and the
 *  24 quick-chat slots (ProfileQuickChatSave_TA: CHAT-5). (No name: an online player's is their account's; a save's old
 *  chat.name is ignored) */
export interface ChatSettings {
  readonly quickChatFilter: ChatFilter;
  readonly blockNonTactical: boolean;
  /** Preset keys: slots 0-15 (rows 1-4) from the match pool, 16-19 post game, 20-23 pre game */
  readonly slots: readonly string[];
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = { quickChatFilter: "everyone", blockNonTactical: false, slots: DEFAULT_SLOTS };

/** The pool a quick-chat slot takes its preset from */
export function slotPool(slot: number): readonly string[] {
  return slot < 16 ? POOLS.match : slot < 20 ? POOLS.post : POOLS.pre;
}

/** The Gameplay tab's lists (MENU-9): Game Stat Display Level (StatEventDisplayLevel: the stat popups and feed) and
 *  Flip Reset Indicator (its sound, its look: our flip ring with them); and ours, free play's goals (off: the ball stays
 *  in play in the net, no explosion, no reset) */
export type StatDisplayLevel = "none" | "primary" | "all";
export type FlipResetIndicator = "off" | "audio" | "visual" | "on";
export interface GameplaySettings {
  readonly statDisplayLevel: StatDisplayLevel;
  readonly flipResetIndicator: FlipResetIndicator;
  readonly freePlayGoals: boolean;
}

export const DEFAULT_GAMEPLAY_SETTINGS: GameplaySettings = { statDisplayLevel: "primary", flipResetIndicator: "on", freePlayGoals: true };

/** (saved before the list: the old flip indicator's checkbox, off, is Off) */
function readGameplay(v: unknown, oldOptions: Record<string, unknown>): GameplaySettings {
  const src = isRecord(v) ? v : {};
  const level = src["statDisplayLevel"];
  const flip = src["flipResetIndicator"];
  const old = oldOptions["flipIndicator"] === false ? "off" : DEFAULT_GAMEPLAY_SETTINGS.flipResetIndicator;
  return {
    statDisplayLevel: level === "none" || level === "primary" || level === "all" ? level : DEFAULT_GAMEPLAY_SETTINGS.statDisplayLevel,
    flipResetIndicator: flip === "off" || flip === "audio" || flip === "visual" || flip === "on" ? flip : old,
    freePlayGoals: typeof src["freePlayGoals"] === "boolean" ? src["freePlayGoals"] : DEFAULT_GAMEPLAY_SETTINGS.freePlayGoals,
  };
}

/** The Interface tab (MENU-6, notes/hud-menus.md; GFxData_Settings_TA's Interface rows) */
export type NameplateMode = "distanceFade" | "default" | "simplified";
export type MatchNotifications = "all" | "gameUpdates" | "kickoff";
/** Stat Graphs (MENU-6: the game's overlay, its ten options in order; None its default) */
export const STAT_GRAPHS = [
  "none",
  "performanceSummary",
  "performanceShort",
  "performanceLong",
  "networkSummary",
  "networkShort",
  "networkLong",
  "speedSummary",
  "speedShort",
  "speedLong",
] as const;
export type StatGraphs = (typeof STAT_GRAPHS)[number];
export interface InterfaceSettings {
  /** Interface Scale (UIScale) and Display Scale (SafeZoneRatio: the platform's default, 1 here): the HUD's stage */
  readonly scale: number;
  readonly displayScale: number;
  readonly nameplateScale: number;
  readonly nameplateMode: NameplateMode;
  /** Match Notifications (HUDMessageLevel): which centre messages show */
  readonly matchNotifications: MatchNotifications;
  /** Stat Graphs: the overlay of the frame rate, the network or the speed (None: a clean screen, the game's default) */
  readonly statGraphs: StatGraphs;
  /** Metric (else imperial): the replay's speed, the podium titles' units; on by default (GetMetricDefaultValue: on
   *  unless the build's region is the US) */
  readonly metric: boolean;
  readonly ballCamIndicator: boolean;
  /** Ball Arrow (BallIndicator): the arrow by the car toward the ball while the ball cam is off (HUD-17) */
  readonly ballArrow: boolean;
  /** Hide In-Game HUD */
  readonly hideHud: boolean;
}

export const INTERFACE_LIMITS: Readonly<Record<"scale" | "displayScale" | "nameplateScale", Range>> = {
  scale: { min: 0.5, max: 1, step: 0.01 },
  displayScale: { min: 0.9, max: 1, step: 0.01 },
  nameplateScale: { min: 0.5, max: 2, step: 0.1 },
};

export const DEFAULT_INTERFACE_SETTINGS: InterfaceSettings = {
  scale: 1,
  displayScale: 1,
  nameplateScale: 1,
  nameplateMode: "default",
  matchNotifications: "all",
  statGraphs: "none",
  metric: true,
  ballCamIndicator: true,
  ballArrow: true,
  hideHud: false,
};

function readInterface(v: unknown): InterfaceSettings {
  const src = isRecord(v) ? v : {};
  const d = DEFAULT_INTERFACE_SETTINGS;
  const mode = src["nameplateMode"];
  const notifications = src["matchNotifications"];
  const flag = (k: "metric" | "ballCamIndicator" | "ballArrow" | "hideHud"): boolean => (typeof src[k] === "boolean" ? src[k] : d[k]);
  return {
    scale: readNumber(src["scale"], d.scale, INTERFACE_LIMITS.scale),
    displayScale: readNumber(src["displayScale"], d.displayScale, INTERFACE_LIMITS.displayScale),
    nameplateScale: readNumber(src["nameplateScale"], d.nameplateScale, INTERFACE_LIMITS.nameplateScale),
    nameplateMode: mode === "distanceFade" || mode === "default" || mode === "simplified" ? mode : d.nameplateMode,
    matchNotifications: notifications === "all" || notifications === "gameUpdates" || notifications === "kickoff" ? notifications : d.matchNotifications,
    statGraphs: STAT_GRAPHS.find((g) => g === src["statGraphs"]) ?? d.statGraphs,
    metric: flag("metric"),
    ballCamIndicator: flag("ballCamIndicator"),
    ballArrow: flag("ballArrow"),
    hideHud: flag("hideHud"),
  };
}

export interface Settings {
  readonly bindings: Bindings;
  readonly camera: CameraSettings;
  readonly cameraKbm: InputCameraSettings;
  readonly cameraPad: InputCameraSettings;
  readonly controller: ControllerSettings;
  readonly options: Options;
  readonly audio: AudioSettings;
  readonly chat: ChatSettings;
  readonly scoreboard: ScoreboardSettings;
  readonly interface: InterfaceSettings;
  readonly gameplay: GameplaySettings;
  /** The Video tab's (settings/video.ts; Bloom and Depth of Field in the options) */
  readonly video: VideoSettings;
  /** Custom training's (training/settings.ts) */
  readonly training: TrainingSettings;
}

/** The scoreboard's four columns after SCORE (ProfileScoreboardSave_TA, Soccar's group: SB-17), by column id */
export interface ScoreboardSettings {
  readonly columns: readonly string[];
}

export const DEFAULT_SCOREBOARD_SETTINGS: ScoreboardSettings = { columns: DEFAULT_COLUMNS };

function readScoreboard(v: unknown): ScoreboardSettings {
  const src = isRecord(v) ? v : {};
  const columns = Array.isArray(src["columns"]) ? (src["columns"] as unknown[]) : [];
  return {
    columns: DEFAULT_COLUMNS.map((fallback, i) => {
      const id = columns[i];
      return typeof id === "string" && SCOREBOARD_COLUMNS.some((c) => c.id === id) ? id : fallback;
    }),
  };
}

export interface Range {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Camera slider limits from the game (TAGame Default__Camera_TA *Limits). */
export const CAMERA_LIMITS: Readonly<Record<keyof CameraSettings, Range>> = {
  fov: { min: 60, max: 110, step: 1 },
  distance: { min: 100, max: 400, step: 10 },
  height: { min: 40, max: 200, step: 10 },
  pitch: { min: -15, max: 0, step: 1 },
  stiffness: { min: 0, max: 1, step: 0.05 },
  swivelSpeed: { min: 1, max: 10, step: 0.1 },
  transitionSpeed: { min: 1, max: 2, step: 0.1 },
};

/** Slider limits from the game (GFxData_Settings_TA *Limits). */
export const CONTROLLER_LIMITS: Readonly<Record<keyof ControllerSettings, Range>> = {
  deadzone: { min: 0, max: 0.75, step: 0.01 },
  dodgeDeadzone: { min: 0.1, max: 1, step: 0.01 },
  steeringSensitivity: { min: 1, max: 10, step: 0.01 },
  aerialSensitivity: { min: 1, max: 10, step: 0.01 },
  freeLookDeadzone: { min: 0, max: 0.75, step: 0.01 },
  mouseSensitivity: { min: 1, max: 100, step: 1 },
};

/** The per-input camera sliders' limits (the menu's: accel and decel 1–15, speed 1–10) */
export const INPUT_CAMERA_LIMITS: Readonly<Record<"accelRate" | "decelRate" | "freeLookSpeed", Range>> = {
  accelRate: { min: 1, max: 15, step: 0.1 },
  decelRate: { min: 1, max: 15, step: 0.1 },
  freeLookSpeed: { min: 1, max: 10, step: 0.1 },
};

/** A per-input camera's defaults (Default__ProfileCameraInputSettings): classic, no free look */
const INPUT_CAMERA_DEFAULTS: InputCameraSettings = {
  freeLook: false,
  ballCamToggle: true,
  invertPitch: false,
  smoothing: true,
  accelRate: 5.8,
  decelRate: 10.8,
  freeLookSpeed: 2.5,
};

/** The Modern preset (a new profile's: ProfileCameraSave_TA.OnCreate → ApplyCameraPreset(Modern)): distance 290, and
 *  per input (RegisterPresetInputOverrides) keyboard and mouse with free look, the ball cam held, accel 10.8; the
 *  controller classic, the ball cam toggled (notes/camera-update-audit.md CAM-3) */
export const MODERN_CAMERA: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS, distance: 290 };
export const MODERN_CAMERA_KBM: InputCameraSettings = { ...INPUT_CAMERA_DEFAULTS, freeLook: true, ballCamToggle: false, accelRate: 10.8 };
export const MODERN_CAMERA_PAD: InputCameraSettings = { ...INPUT_CAMERA_DEFAULTS };

/** The Default preset (and Balanced, Wide, Legacy alike): the camera's defaults, free look off for both inputs */
export const DEFAULT_PRESET = { camera: DEFAULT_CAMERA_SETTINGS, cameraKbm: INPUT_CAMERA_DEFAULTS, cameraPad: INPUT_CAMERA_DEFAULTS } as const;
export const MODERN_PRESET = { camera: MODERN_CAMERA, cameraKbm: MODERN_CAMERA_KBM, cameraPad: MODERN_CAMERA_PAD } as const;
/** Camera shake per preset (ProfileCameraSave_TA.ApplyCameraPreset: bEnableCameraShake = preset == Default) */
export const PRESET_CAMERA_SHAKE = { default: true, modern: false } as const;

export const AUDIO_LIMITS: Readonly<Record<keyof AudioSettings, Range>> = {
  master: { min: 0, max: 1, step: 0.05 },
  effects: { min: 0, max: 1, step: 0.05 },
  cars: { min: 0, max: 1, step: 0.05 },
  ambience: { min: 0, max: 1, step: 0.05 },
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { master: 0.8, effects: 1, cars: 0.7, ambience: 0.6 };

/** Default__ProfileGamepadSave_TA. */
export const DEFAULT_CONTROLLER_SETTINGS: ControllerSettings = {
  deadzone: 0.2,
  dodgeDeadzone: 0.8,
  steeringSensitivity: 1,
  aerialSensitivity: 1,
  freeLookDeadzone: 0.1,
  mouseSensitivity: 10,
};

/** Default__ProfileCameraSave_TA, Default__ProfilePCSave_TA. */
export const DEFAULT_OPTIONS: Options = {
  rearCameraToggle: false,
  cameraShake: false,
  airPitchSafety: true,
  muted: false,
  autoSkipReplay: false,
  unlimitedBoost: true,
  bloom: true,
  depthOfField: true,
  fullscreen: false,
};

export const DEFAULT_SETTINGS: Settings = {
  bindings: DEFAULT_BINDINGS,
  ...MODERN_PRESET,
  controller: DEFAULT_CONTROLLER_SETTINGS,
  options: DEFAULT_OPTIONS,
  audio: DEFAULT_AUDIO_SETTINGS,
  chat: DEFAULT_CHAT_SETTINGS,
  scoreboard: DEFAULT_SCOREBOARD_SETTINGS,
  interface: DEFAULT_INTERFACE_SETTINGS,
  gameplay: DEFAULT_GAMEPLAY_SETTINGS,
  video: DEFAULT_VIDEO_SETTINGS,
  training: TRAINING_DEFAULTS,
};

/** The settings as they apply: the video settings' automatic default resolved (settings/video.ts resolveVideo: the
 *  player's own once chosen) */
export function resolveSettings(s: Settings, weakGpu: boolean): Settings {
  const r = resolveVideo({ video: s.video, bloom: s.options.bloom, depthOfField: s.options.depthOfField }, weakGpu);
  return r.video === s.video && r.bloom === s.options.bloom && r.depthOfField === s.options.depthOfField
    ? s
    : { ...s, video: r.video, options: { ...s.options, bloom: r.bloom, depthOfField: r.depthOfField } };
}

const STORAGE_KEY = "carball.settings.v1";

// --- validation: anything unexpected falls back to the default, field by field ---

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readNumber(v: unknown, fallback: number, range: Range): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : fallback;
}

function readNumbers<T extends object>(v: unknown, defaults: T, limits: Readonly<Record<keyof T, Range>>): T {
  const src = isRecord(v) ? v : {};
  const out = { ...defaults };
  for (const k of Object.keys(limits) as (keyof T & string)[]) {
    out[k] = readNumber(src[k], defaults[k] as number, limits[k]) as T[keyof T & string];
  }
  return out;
}

function readBooleans<T extends object>(v: unknown, defaults: T): T {
  const src = isRecord(v) ? v : {};
  const out = { ...defaults };
  for (const k of Object.keys(defaults) as (keyof T & string)[]) {
    const value = src[k];
    if (typeof value === "boolean") out[k] = value as T[keyof T & string];
  }
  return out;
}

const isIndex = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < max;

function readKeyboardInput(v: unknown): KeyboardInput | null | undefined {
  if (v === null) return null;
  if (!isRecord(v)) return undefined;
  const code = v["code"];
  const button = v["button"];
  if (v["kind"] === "key" && typeof code === "string" && code.length > 0) return { kind: "key", code };
  if (v["kind"] === "mouse" && isIndex(button, 16)) return { kind: "mouse", button };
  return undefined;
}

function readGamepadInput(v: unknown): GamepadInput | null | undefined {
  if (v === null) return null;
  if (!isRecord(v)) return undefined;
  const button = v["button"];
  const axis = v["axis"];
  const sign = v["sign"];
  if (v["kind"] === "padButton" && isIndex(button, 32)) return { kind: "padButton", button };
  if (v["kind"] === "padAxis" && isIndex(axis, 16) && (sign === 1 || sign === -1)) return { kind: "padAxis", axis, sign };
  return undefined;
}

function readBindings(v: unknown): Bindings {
  const src = isRecord(v) ? v : {};
  const out = { ...DEFAULT_BINDINGS } as Record<Action, Binding>;
  const saved = new Set<Action>();
  for (const { id } of ACTIONS) {
    const b = src[id];
    if (!isRecord(b)) continue;
    saved.add(id);
    // A missing slot keeps the default; an invalid one is cleared
    out[id] = {
      keyboard: "keyboard" in b ? (readKeyboardInput(b["keyboard"]) ?? null) : DEFAULT_BINDINGS[id].keyboard,
      gamepad: "gamepad" in b ? (readGamepadInput(b["gamepad"]) ?? null) : DEFAULT_BINDINGS[id].gamepad,
    };
  }
  // An action the saved bindings don't know (added since) doesn't take its default where they already use that input
  // (saved before the Modern layout, left mouse is boost: not also the alternative jump)
  if (saved.size > 0) {
    const same = (a: KeyboardInput | GamepadInput | null, b: KeyboardInput | GamepadInput | null): boolean =>
      a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
    for (const { id } of ACTIONS) {
      if (saved.has(id)) continue;
      const used = [...saved].filter((s) => !exclusiveGroups(s, id)).map((s) => out[s]);
      out[id] = {
        keyboard: used.some((b) => same(b.keyboard, out[id].keyboard)) ? null : out[id].keyboard,
        gamepad: used.some((b) => same(b.gamepad, out[id].gamepad)) ? null : out[id].gamepad,
      };
    }
  }
  return out;
}

function readChat(v: unknown): ChatSettings {
  const src = isRecord(v) ? v : {};
  const filter = src["quickChatFilter"];
  const slots = Array.isArray(src["slots"]) ? (src["slots"] as unknown[]) : [];
  return {
    quickChatFilter: filter === "everyone" || filter === "team" || filter === "friends" || filter === "off" ? filter : DEFAULT_CHAT_SETTINGS.quickChatFilter,
    blockNonTactical: typeof src["blockNonTactical"] === "boolean" ? src["blockNonTactical"] : DEFAULT_CHAT_SETTINGS.blockNonTactical,
    slots: DEFAULT_SLOTS.map((fallback, i) => {
      const key = slots[i];
      return typeof key === "string" && slotPool(i).includes(key) ? key : fallback;
    }),
  };
}

/** Settings from untrusted data (storage, imports): every invalid or missing field takes its default. */
export function parseSettings(v: unknown): Settings {
  const src = isRecord(v) ? v : {};
  // Saved before the per-input cameras: migrated as the game migrates its old profiles (free look off for both
  // inputs; the old single ball-cam toggle and swivel inversion, which defaulted to on, kept for both)
  const old = isRecord(src["options"]) ? src["options"] : {};
  const migrated: InputCameraSettings = {
    ...INPUT_CAMERA_DEFAULTS,
    ballCamToggle: typeof old["ballCamToggle"] === "boolean" ? old["ballCamToggle"] : true,
    invertPitch: typeof old["invertSwivelPitch"] === "boolean" ? old["invertSwivelPitch"] : true,
  };
  const saved = Object.keys(src).length > 0;
  const inputCamera = (key: string, fresh: InputCameraSettings): InputCameraSettings => {
    const value = src[key];
    const base = readBooleans(value, isRecord(value) || !saved ? fresh : migrated);
    const numbers = isRecord(value) ? value : {};
    const limited = (k: keyof typeof INPUT_CAMERA_LIMITS): number => readNumber(numbers[k], base[k], INPUT_CAMERA_LIMITS[k]);
    return { ...base, accelRate: limited("accelRate"), decelRate: limited("decelRate"), freeLookSpeed: limited("freeLookSpeed") };
  };
  const options = readBooleans(src["options"], DEFAULT_OPTIONS);
  // (a save from before the video group with Bloom or Depth of Field turned off: the player's choice, kept as a Custom
  // Render Detail, not the automatic default's preset over it: RV-495, the user's lost settings)
  const video =
    !("video" in src) && (!options.bloom || !options.depthOfField)
      ? { ...readVideo(undefined), renderDetail: "custom" as const, chosen: true }
      : readVideo(src["video"]);
  return {
    bindings: readBindings(src["bindings"]),
    camera: readNumbers(src["camera"], saved ? DEFAULT_CAMERA_SETTINGS : MODERN_CAMERA, CAMERA_LIMITS),
    cameraKbm: inputCamera("cameraKbm", MODERN_CAMERA_KBM),
    cameraPad: inputCamera("cameraPad", MODERN_CAMERA_PAD),
    controller: readNumbers(src["controller"], DEFAULT_CONTROLLER_SETTINGS, CONTROLLER_LIMITS),
    options,
    audio: readNumbers(src["audio"], DEFAULT_AUDIO_SETTINGS, AUDIO_LIMITS),
    chat: readChat(src["chat"]),
    scoreboard: readScoreboard(src["scoreboard"]),
    interface: readInterface(src["interface"]),
    gameplay: readGameplay(src["gameplay"], old),
    video,
    training: readTraining(src["training"]),
  };
}

/** Custom training's settings: its numbers within their ranges, its switches */
function readTraining(v: unknown): TrainingSettings {
  const flags = readBooleans(v, TRAINING_DEFAULTS);
  return {
    ...readNumbers<TrainingNumbers>(v, TRAINING_DEFAULTS, TRAINING_LIMITS),
    skipReplay: flags.skipReplay,
    spawnOnGround: flags.spawnOnGround,
    unlimitedBoost: flags.unlimitedBoost,
  };
}

export function loadSettings(storage: Pick<Storage, "getItem"> | null = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? parseSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked (private mode): settings just won't persist
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
