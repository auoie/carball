// Player settings: bindings, camera, controller and audio. Saved in the browser (localStorage).
import { DEFAULT_CAMERA_SETTINGS, type CameraSettings } from "../camera/rlCamera";
import {
  ACTIONS,
  type Action,
  type Binding,
  type Bindings,
  DEFAULT_BINDINGS,
  type GamepadInput,
  type KeyboardInput,
} from "../input/bindings";

/** The game's Controls menu (ProfileGamepadSave_TA). The engine applies everything but the deadzone. */
export interface ControllerSettings {
  readonly deadzone: number; // controller deadzone, per stick axis (PlayerInput_X.GamepadDeadzone)
  readonly dodgeDeadzone: number; // DodgeInputThreshold
  readonly steeringSensitivity: number;
  readonly aerialSensitivity: number; // AirControlSensitivity
}

/** On/off options (ProfileCameraSave_TA, ProfilePCSave_TA). */
export interface Options {
  readonly ballCamToggle: boolean; // bToggleSecondaryCamera: press toggles (else hold)
  readonly rearCameraToggle: boolean; // bToggleRearCamera
  readonly invertSwivelPitch: boolean; // bInvertSwivelPitch
  readonly airPitchSafety: boolean; // bAirPitchSafetyEnabled (keyboard and mouse)
  readonly muted: boolean; // all sound off (M)
}

/** Volumes, 0..1. */
export interface AudioSettings {
  readonly master: number;
  readonly effects: number; // hits, jumps, pickups, goals
  readonly cars: number; // engines and boost
  readonly ambience: number; // the arena's soundscape
}

export interface Settings {
  readonly bindings: Bindings;
  readonly camera: CameraSettings;
  readonly controller: ControllerSettings;
  readonly options: Options;
  readonly audio: AudioSettings;
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
};

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
};

/** Default__ProfileCameraSave_TA, Default__ProfilePCSave_TA. */
export const DEFAULT_OPTIONS: Options = {
  ballCamToggle: true,
  rearCameraToggle: false,
  invertSwivelPitch: true,
  airPitchSafety: true,
  muted: false,
};

export const DEFAULT_SETTINGS: Settings = {
  bindings: DEFAULT_BINDINGS,
  camera: DEFAULT_CAMERA_SETTINGS,
  controller: DEFAULT_CONTROLLER_SETTINGS,
  options: DEFAULT_OPTIONS,
  audio: DEFAULT_AUDIO_SETTINGS,
};

const STORAGE_KEY = "rl-clone.settings.v1";

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
  for (const { id } of ACTIONS) {
    const b = src[id];
    if (!isRecord(b)) continue;
    // A missing slot keeps the default; an invalid one is cleared
    out[id] = {
      keyboard: "keyboard" in b ? (readKeyboardInput(b["keyboard"]) ?? null) : DEFAULT_BINDINGS[id].keyboard,
      gamepad: "gamepad" in b ? (readGamepadInput(b["gamepad"]) ?? null) : DEFAULT_BINDINGS[id].gamepad,
    };
  }
  return out;
}

/** Settings from untrusted data (storage, imports): every invalid or missing field takes its default. */
export function parseSettings(v: unknown): Settings {
  const src = isRecord(v) ? v : {};
  return {
    bindings: readBindings(src["bindings"]),
    camera: readNumbers(src["camera"], DEFAULT_CAMERA_SETTINGS, CAMERA_LIMITS),
    controller: readNumbers(src["controller"], DEFAULT_CONTROLLER_SETTINGS, CONTROLLER_LIMITS),
    options: readBooleans(src["options"], DEFAULT_OPTIONS),
    audio: readNumbers(src["audio"], DEFAULT_AUDIO_SETTINGS, AUDIO_LIMITS),
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
