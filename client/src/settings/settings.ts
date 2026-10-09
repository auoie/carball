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
  readonly muted: boolean; // all sound off (M)
  readonly flipIndicator: boolean; // show whether the car can dodge, and flip resets
  readonly autoSkipReplay: boolean; // bAutoSkipGoalReplay: always ready to skip goal replays
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
  readonly cameraKbm: InputCameraSettings;
  readonly cameraPad: InputCameraSettings;
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
  flipIndicator: true,
  autoSkipReplay: false,
};

export const DEFAULT_SETTINGS: Settings = {
  bindings: DEFAULT_BINDINGS,
  ...MODERN_PRESET,
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
      const used = [...saved].map((s) => out[s]);
      out[id] = {
        keyboard: used.some((b) => same(b.keyboard, out[id].keyboard)) ? null : out[id].keyboard,
        gamepad: used.some((b) => same(b.gamepad, out[id].gamepad)) ? null : out[id].gamepad,
      };
    }
  }
  return out;
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
  return {
    bindings: readBindings(src["bindings"]),
    camera: readNumbers(src["camera"], saved ? DEFAULT_CAMERA_SETTINGS : MODERN_CAMERA, CAMERA_LIMITS),
    cameraKbm: inputCamera("cameraKbm", MODERN_CAMERA_KBM),
    cameraPad: inputCamera("cameraPad", MODERN_CAMERA_PAD),
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
